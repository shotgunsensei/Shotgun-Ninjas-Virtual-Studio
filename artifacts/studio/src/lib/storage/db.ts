import { openDB, type IDBPDatabase } from "idb";
import type { ChopLabPersistedState, Project, SampleLibraryItem } from "../../types";
import { CURRENT_SCHEMA_VERSION, migrateProject } from "./migrate";
import { APP_NAME, APP_URL, APP_VERSION, CREATED_WITH } from "../version";

const DB_NAME = "shotgun-ninjas-studio";
/** v1 — initial projects/blobs/meta stores.
 *  v2 — phase 3: add draft slot in `meta` (no new object stores, but we
 *       bump the version so the upgrade callback can scrub stale data). */
const DB_VERSION = 2;
const PROJECTS_STORE = "projects";
const BLOBS_STORE = "blobs";
const META_STORE = "meta";

const META_LAST_PROJECT = "lastProject";
const META_DRAFT = "draft";
const META_LAST_SAVED = "lastSaved";

interface Schema {
  projects: { key: string; value: SerializedProject };
  blobs: { key: string; value: Blob };
  meta: {
    key: string;
    value:
      | { lastProjectId?: string }
      | DraftSnapshot
      | LastSavedInfo;
  };
}

/** ChopLab state as stored in IDB — sampleBlob is excluded; only the key is kept. */
type SerializedChopLab = Omit<ChopLabPersistedState, "sampleBlob">;

interface SerializedProject extends Omit<Project, "tracks" | "samples" | "chopLab"> {
  tracks: Array<
    Omit<Project["tracks"][number], "audioClips"> & {
      audioClips: Array<{
        id: string;
        start: number;
        durationSec: number;
        offsetSec?: number;
        sourceDurationSec?: number;
        blobKey?: string;
      }>;
    }
  >;
  samples?: Array<Omit<SampleLibraryItem, "blob">>;
  chopLab?: SerializedChopLab;
}

export interface DraftSnapshot {
  project: SerializedProject;
  ts: number;
  /** Project id the draft belongs to — recovery only offers the draft
   *  when the user lands back on the same project. */
  projectId: string;
}

export interface LastSavedInfo {
  projectId: string;
  ts: number;
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

// ── blob fingerprint cache ────────────────────────────────────────────────
// Tracks which blob keys have already been written to IDB in this session
// (key → "size:type:lastModified"). If the fingerprint has not changed
// we skip the IDB put, avoiding redundant re-serialization of large audio
// blobs on every autosave tick when nothing has changed.
const blobFpCache = new Map<string, string>();

function blobFingerprint(blob: Blob): string {
  const lm = (blob as unknown as { lastModified?: number }).lastModified ?? 0;
  return `${blob.size}:${blob.type}:${lm}`;
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          db.createObjectStore(PROJECTS_STORE);
        }
        if (!db.objectStoreNames.contains(BLOBS_STORE)) {
          db.createObjectStore(BLOBS_STORE);
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Serialize a Project to the IDB-friendly shape and flush every blob
 * referenced by the project into the BLOBS_STORE under a stable key.
 * Used by both `saveProject` (writes the project record + meta) and
 * `saveDraft` (writes only the draft slot, keeping the durable record
 * untouched until the user actually saves).
 */
async function serializeAndFlushBlobs(
  project: Project,
  tx: ReturnType<IDBPDatabase<Schema>["transaction"]>,
): Promise<SerializedProject> {
  // idb's typed transaction narrows objectStore(...) based on the
  // store-name tuple it was created with; pulling the store out once
  // (via a cast) avoids re-narrowing on every blob write.
  const blobs = (
    tx as unknown as {
      objectStore: (name: string) => {
        put: (value: Blob, key: string) => Promise<unknown>;
      };
    }
  ).objectStore(BLOBS_STORE);
  const serializedSamples = await Promise.all(
    (project.samples ?? []).map(async (s) => {
      if (s.blob) {
        const fp = blobFingerprint(s.blob);
        if (blobFpCache.get(s.blobKey) !== fp) {
          await blobs.put(s.blob, s.blobKey);
          blobFpCache.set(s.blobKey, fp);
        }
      }
      return {
        id: s.id,
        name: s.name,
        blobKey: s.blobKey,
        durationSec: s.durationSec,
        createdAt: s.createdAt,
      };
    }),
  );
  // Flush chopLab sample blob if present.
  let serializedChopLab: SerializedChopLab | undefined;
  if (project.chopLab) {
    const cl = project.chopLab;
    if (cl.sampleBlob && cl.sampleBlobKey) {
      const fp = blobFingerprint(cl.sampleBlob);
      if (blobFpCache.get(cl.sampleBlobKey) !== fp) {
        await blobs.put(cl.sampleBlob, cl.sampleBlobKey);
        blobFpCache.set(cl.sampleBlobKey, fp);
      }
    }
    // Strip the in-memory blob from the serialized form.
    const { sampleBlob: _sb, ...clRest } = cl;
    void _sb;
    serializedChopLab = clRest;
  }

  return {
    ...project,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: Date.now(),
    samples: serializedSamples,
    chopLab: serializedChopLab,
    tracks: await Promise.all(
      project.tracks.map(async (t) => ({
        ...t,
        audioClips: await Promise.all(
          t.audioClips.map(async (c) => {
            let blobKey = c.blobKey;
            if (c.blob && !blobKey) {
              blobKey = `${project.id}:${t.id}:${c.id}`;
            }
            if (c.blob && blobKey) {
              const fp = blobFingerprint(c.blob);
              if (blobFpCache.get(blobKey) !== fp) {
                await blobs.put(c.blob, blobKey);
                blobFpCache.set(blobKey, fp);
              }
            }
            return {
              id: c.id,
              start: c.start,
              durationSec: c.durationSec,
              offsetSec: c.offsetSec,
              sourceDurationSec: c.sourceDurationSec,
              blobKey,
            };
          }),
        ),
      })),
    ),
  };
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([PROJECTS_STORE, BLOBS_STORE, META_STORE], "readwrite");
  const serialized = await serializeAndFlushBlobs(project, tx);
  await tx.objectStore(PROJECTS_STORE).put(serialized, project.id);
  await tx
    .objectStore(META_STORE)
    .put({ lastProjectId: project.id }, META_LAST_PROJECT);
  const savedInfo: LastSavedInfo = { projectId: project.id, ts: Date.now() };
  await tx.objectStore(META_STORE).put(savedInfo, META_LAST_SAVED);
  // Saving makes any pending draft obsolete — clear it so the recovery
  // prompt won't re-offer stale data on next load.
  await tx.objectStore(META_STORE).delete(META_DRAFT);
  await tx.done;
}

export async function loadProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const raw = (await db.get(PROJECTS_STORE, id)) as SerializedProject | undefined;
  if (!raw) return null;
  return hydrateSerialized(raw, db);
}

async function hydrateSerialized(
  raw: SerializedProject,
  db: IDBPDatabase<Schema>,
): Promise<Project> {
  // Migrate first so the rest of the hydration sees a v{current}-shaped
  // project; then re-attach blobs by key.
  const migrated = migrateProject(raw).project;
  const tracks = await Promise.all(
    migrated.tracks.map(async (t) => ({
      ...t,
      audioClips: await Promise.all(
        (t.audioClips ?? []).map(async (c) => {
          const blob = c.blobKey
            ? ((await db.get(BLOBS_STORE, c.blobKey)) as Blob | undefined)
            : undefined;
          return { ...c, blob };
        }),
      ),
    })),
  );
  const samples = await Promise.all(
    (migrated.samples ?? []).map(async (s) => {
      const blob = s.blobKey
        ? ((await db.get(BLOBS_STORE, s.blobKey)) as Blob | undefined)
        : undefined;
      return { ...s, blob } as SampleLibraryItem;
    }),
  );
  // Re-attach the chopLab sample blob if a key is stored.
  let chopLab = migrated.chopLab;
  if (chopLab?.sampleBlobKey) {
    const sampleBlob = (await db.get(
      BLOBS_STORE,
      chopLab.sampleBlobKey,
    )) as Blob | undefined;
    chopLab = { ...chopLab, sampleBlob };
  }
  return { ...migrated, tracks, samples, chopLab };
}

export async function listProjects(): Promise<
  Array<{ id: string; name: string; updatedAt: number }>
> {
  const db = await getDb();
  const keys = (await db.getAllKeys(PROJECTS_STORE)) as string[];
  const out: Array<{ id: string; name: string; updatedAt: number }> = [];
  for (const k of keys) {
    const proj = (await db.get(PROJECTS_STORE, k)) as SerializedProject | undefined;
    if (proj) out.push({ id: proj.id, name: proj.name, updatedAt: proj.updatedAt });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  // also drop any vocal blobs we stored under this project's namespace so
  // IndexedDB doesn't bloat up over time
  const tx = db.transaction([PROJECTS_STORE, BLOBS_STORE], "readwrite");
  const blobKeys = (await tx.objectStore(BLOBS_STORE).getAllKeys()) as string[];
  await Promise.all(
    blobKeys
      .filter((k) => typeof k === "string" && k.startsWith(`${id}:`))
      .map((k) => tx.objectStore(BLOBS_STORE).delete(k)),
  );
  await tx.objectStore(PROJECTS_STORE).delete(id);
  await tx.done;
}

export async function getLastProjectId(): Promise<string | null> {
  const db = await getDb();
  const meta = (await db.get(META_STORE, META_LAST_PROJECT)) as
    | { lastProjectId?: string }
    | undefined;
  return meta?.lastProjectId ?? null;
}

export async function setLastProjectId(id: string): Promise<void> {
  const db = await getDb();
  await db.put(META_STORE, { lastProjectId: id }, META_LAST_PROJECT);
}

export async function getLastSavedInfo(): Promise<LastSavedInfo | null> {
  const db = await getDb();
  const info = (await db.get(META_STORE, META_LAST_SAVED)) as
    | LastSavedInfo
    | undefined;
  return info ?? null;
}

// ---------- draft slot (autosaved unsaved work) ----------

/**
 * Write the current in-memory project to a dedicated "draft" slot in
 * IDB. Separate from the durable project record so a crash before the
 * user explicitly saves doesn't corrupt the last good save. The draft
 * carries its own timestamp so recovery can decide whether it's newer
 * than the last saved version.
 */
export async function saveDraft(project: Project): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([BLOBS_STORE, META_STORE], "readwrite");
  const serialized = await serializeAndFlushBlobs(project, tx);
  const snapshot: DraftSnapshot = {
    project: serialized,
    ts: Date.now(),
    projectId: project.id,
  };
  await tx.objectStore(META_STORE).put(snapshot, META_DRAFT);
  await tx.done;
}

export async function loadDraft(): Promise<DraftSnapshot | null> {
  const db = await getDb();
  const snap = (await db.get(META_STORE, META_DRAFT)) as DraftSnapshot | undefined;
  return snap ?? null;
}

export async function clearDraft(): Promise<void> {
  const db = await getDb();
  await db.delete(META_STORE, META_DRAFT);
}

/** Hydrate a draft snapshot's serialized project (re-attach blobs). */
export async function hydrateDraft(snap: DraftSnapshot): Promise<Project> {
  const db = await getDb();
  return hydrateSerialized(snap.project, db);
}

/**
 * Replace a missing sample blob (project-level sample library) with a
 * user-supplied file. The new blob is written to IDB under the
 * sample's existing blobKey so the next load resolves it cleanly.
 */
export async function relocateSampleBlob(
  blobKey: string,
  blob: Blob,
): Promise<void> {
  const db = await getDb();
  await db.put(BLOBS_STORE, blob, blobKey);
}

/**
 * Deep-clone a project under a new id and name so the user can branch
 * a session ("Save As" / "Duplicate"). Blobs are re-keyed and copied so
 * deleting the original doesn't strand the new project.
 */
export async function duplicateProject(
  source: Project,
  newName: string,
): Promise<Project> {
  const db = await getDb();
  const newId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const tx = db.transaction([BLOBS_STORE], "readwrite");
  const tracks = await Promise.all(
    source.tracks.map(async (t) => ({
      ...t,
      audioClips: await Promise.all(
        t.audioClips.map(async (c) => {
          let blob = c.blob;
          if (!blob && c.blobKey) {
            blob = (await tx.objectStore(BLOBS_STORE).get(c.blobKey)) as
              | Blob
              | undefined;
          }
          const newKey = `${newId}:${t.id}:${c.id}`;
          if (blob) {
            await tx.objectStore(BLOBS_STORE).put(blob, newKey);
          }
          return { ...c, blob, blobKey: blob ? newKey : undefined };
        }),
      ),
    })),
  );
  const samples = await Promise.all(
    (source.samples ?? []).map(async (s) => {
      let blob = s.blob;
      if (!blob && s.blobKey) {
        blob = (await tx.objectStore(BLOBS_STORE).get(s.blobKey)) as
          | Blob
          | undefined;
      }
      const newKey = `${newId}:sample:${s.id}`;
      if (blob) await tx.objectStore(BLOBS_STORE).put(blob, newKey);
      return { ...s, blob, blobKey: newKey };
    }),
  );
  // Copy the ChopLab sample blob under the new project's key.
  let dupChopLab = source.chopLab;
  if (source.chopLab) {
    let sampleBlob = source.chopLab.sampleBlob;
    if (!sampleBlob && source.chopLab.sampleBlobKey) {
      sampleBlob = (await tx.objectStore(BLOBS_STORE).get(
        source.chopLab.sampleBlobKey,
      )) as Blob | undefined;
    }
    const newChopKey = `${newId}:choplab:sample`;
    if (sampleBlob) {
      await tx.objectStore(BLOBS_STORE).put(sampleBlob, newChopKey);
    }
    dupChopLab = {
      ...source.chopLab,
      sampleBlobKey: sampleBlob ? newChopKey : source.chopLab.sampleBlobKey,
      sampleBlob,
    };
  }
  await tx.done;

  const dup: Project = {
    ...source,
    id: newId,
    name: newName,
    tracks,
    samples,
    chopLab: dupChopLab,
    updatedAt: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
  await saveProject(dup);
  return dup;
}

// ---------- JSON export / import ----------

/**
 * Brand + provenance block stamped on every export so a `.snproj.json`
 * file always tells you which app produced it.
 */
export interface ProjectJsonBrand {
  createdWith: string;
  appName: string;
  appUrl: string;
  appVersion: string;
  /** Project schema version (mirrors `project.schemaVersion`). */
  schemaVersion: number;
  exportedAt: number;
  /** "project-only" omits embedded blobs; "project-with-samples"
   *  embeds base64 sample blobs alongside the references. */
  exportMode: "project-only" | "project-with-samples";
}

interface ProjectJsonV1 {
  format: "shotgun-ninjas-studio-project";
  /** v1 = legacy (no brand block).
   *  v2 = adds `brand`, optional embedded blobs gated on exportMode. */
  version: 1 | 2;
  brand?: ProjectJsonBrand;
  project: Omit<Project, "tracks" | "samples"> & {
    tracks: Array<
      Omit<Project["tracks"][number], "audioClips"> & {
        audioClips: Array<{
          id: string;
          start: number;
          durationSec: number;
          offsetSec?: number;
          sourceDurationSec?: number;
          blobKey?: string;
          mimeType?: string;
          base64?: string;
        }>;
      }
    >;
    samples?: Array<Omit<SampleLibraryItem, "blob"> & { mimeType?: string; base64?: string }>;
  };
}

export type ProjectExportMode = "project-only" | "project-with-samples";

/** Summary of an incoming JSON file used to populate the Import Summary
 *  modal so the user can review before replacing the active project. */
export interface ProjectImportSummary {
  project: Project;
  brand?: ProjectJsonBrand;
  trackCount: number;
  noteClipCount: number;
  audioClipCount: number;
  sampleCount: number;
  /** Samples referenced by the project that have no embedded blob — the
   *  user will need to re-import these manually after the project
   *  loads. */
  missingSampleNames: string[];
  /** True when `brand.appVersion` is older than the running app. */
  isOlderAppVersion: boolean;
}

async function blobToBase64(blob: Blob): Promise<{ base64: string; mimeType: string }> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
    );
  }
  return { base64: btoa(bin), mimeType: blob.type || "application/octet-stream" };
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/**
 * Serialize a project to a `.snproj.json` payload.
 *
 *   "project-with-samples" — embeds every audio-clip and sample-library
 *      blob as base64 so the file is fully portable.
 *   "project-only" — keeps the project structure but strips embedded
 *      audio so the file stays small (collaborators will need to relink
 *      missing samples on the other side).
 */
export async function projectToJson(
  project: Project,
  mode: ProjectExportMode = "project-with-samples",
): Promise<string> {
  const embed = mode === "project-with-samples";
  const tracks = await Promise.all(
    project.tracks.map(async (t) => ({
      ...t,
      audioClips: await Promise.all(
        t.audioClips.map(async (c) => {
          if (!c.blob || !embed) {
            const { blob: _b, ...rest } = c;
            void _b;
            return rest;
          }
          const { base64, mimeType } = await blobToBase64(c.blob);
          const { blob: _ignored, ...rest } = c;
          void _ignored;
          return { ...rest, base64, mimeType };
        }),
      ),
    })),
  );
  const samples = await Promise.all(
    (project.samples ?? []).map(async (s) => {
      if (!s.blob || !embed) {
        const { blob: _b, ...rest } = s;
        void _b;
        return rest;
      }
      const { base64, mimeType } = await blobToBase64(s.blob);
      const { blob: _b, ...rest } = s;
      void _b;
      return { ...rest, base64, mimeType };
    }),
  );
  const now = Date.now();
  const brand: ProjectJsonBrand = {
    createdWith: CREATED_WITH,
    appName: APP_NAME,
    appUrl: APP_URL,
    appVersion: APP_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: now,
    exportMode: mode,
  };
  const payload: ProjectJsonV1 = {
    format: "shotgun-ninjas-studio-project",
    version: 2,
    brand,
    project: {
      ...project,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: project.createdAt ?? project.updatedAt ?? now,
      updatedAt: now,
      tracks,
      samples,
    } as ProjectJsonV1["project"],
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * True when any sample blob would be dropped if the project was
 * exported in "project-only" mode but the user has embedded samples in
 * mind. Used by the Export dialog to surface a warning.
 */
export function projectHasUnembeddableSamples(project: Project): {
  hasMissing: boolean;
  missingNames: string[];
} {
  const missing: string[] = [];
  for (const s of project.samples ?? []) {
    if (!s.blob) missing.push(s.name);
  }
  for (const t of project.tracks) {
    for (const c of t.audioClips) {
      if (!c.blob && !c.blobKey) missing.push(`${t.name} clip`);
    }
  }
  return { hasMissing: missing.length > 0, missingNames: missing };
}

function parseEnvelope(text: string): ProjectJsonV1 {
  let data: ProjectJsonV1;
  try {
    data = JSON.parse(text) as ProjectJsonV1;
  } catch (err) {
    throw new Error(`File is not valid JSON: ${(err as Error).message}`);
  }
  if (
    !data ||
    typeof data !== "object" ||
    data.format !== "shotgun-ninjas-studio-project" ||
    (data.version !== 1 && data.version !== 2) ||
    !data.project ||
    !Array.isArray((data.project as { tracks?: unknown[] }).tracks)
  ) {
    throw new Error("Not a valid Shotgun Ninjas Studio project file");
  }
  return data;
}

/**
 * Parse a `.snproj.json` payload and build an import summary without
 * touching the active store. Surface this to the user via the Import
 * Summary modal so they can confirm before replacing their project.
 */
export function summarizeProjectJson(text: string): ProjectImportSummary {
  const data = parseEnvelope(text);
  const project = parseProjectJson(text);
  let noteClipCount = 0;
  let audioClipCount = 0;
  const missingSampleNames: string[] = [];
  for (const t of project.tracks) {
    noteClipCount += t.noteClips.length;
    audioClipCount += t.audioClips.length;
    for (const c of t.audioClips) {
      if (!c.blob) missingSampleNames.push(`${t.name} clip`);
    }
  }
  for (const s of project.samples ?? []) {
    if (!s.blob) missingSampleNames.push(s.name);
  }
  const isOlderAppVersion =
    !!data.brand && compareVersions(data.brand.appVersion, APP_VERSION) < 0;
  return {
    project,
    brand: data.brand,
    trackCount: project.tracks.length,
    noteClipCount,
    audioClipCount,
    sampleCount: (project.samples ?? []).length,
    missingSampleNames,
    isOlderAppVersion,
  };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function parseProjectJson(text: string): Project {
  const data = parseEnvelope(text);
  const newId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const p = data.project;
  const tracks = p.tracks.map((t) => ({
    ...t,
    audioClips: t.audioClips.map((c) => {
      const blob =
        c.base64 && c.mimeType
          ? base64ToBlob(c.base64, c.mimeType)
          : undefined;
      const blobKey = blob ? `${newId}:${t.id}:${c.id}` : undefined;
      const { base64: _b, mimeType: _m, ...rest } = c;
      void _b;
      void _m;
      return { ...rest, blob, blobKey };
    }),
  }));
  const samples = (p.samples ?? []).map((s) => {
    const blob =
      s.base64 && s.mimeType ? base64ToBlob(s.base64, s.mimeType) : undefined;
    const blobKey = `${newId}:sample:${s.id}`;
    const { base64: _b, mimeType: _m, ...rest } = s;
    void _b;
    void _m;
    return { ...rest, blob, blobKey } as SampleLibraryItem;
  });
  // Funnel imported JSON through the migrator so old exports get the
  // same defaults / schema stamp as IndexedDB loads.
  const migrated = migrateProject({
    ...p,
    id: newId,
    tracks,
    samples,
    updatedAt: Date.now(),
  }).project;
  return migrated;
}
