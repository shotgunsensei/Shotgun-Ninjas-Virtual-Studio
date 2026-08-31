import { openDB, type IDBPDatabase } from "idb";
import type {
  ChopLabPersistedState,
  Project,
  SampleLibraryItem,
  Track,
} from "../../types";
import { CURRENT_SCHEMA_VERSION, migrateProject } from "./migrate";
import { APP_NAME, APP_URL, APP_VERSION, CREATED_WITH } from "../version";
import { countPerf, timePerfAsync } from "../../utils/performanceDiagnostics";
import { blobContentFingerprint } from "./performanceGuards";
import { markSampleImport, timeSampleImport } from "../performance/sampleImportTrace";

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
      audioClips: Array<Omit<Project["tracks"][number]["audioClips"][number], "blob">>;
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

// Project persistence is intentionally process-wide and FIFO. Fingerprinting
// blobs can finish out of order, so letting each caller enter IndexedDB as soon
// as its hash resolves can make an older invocation overwrite a newer one.
// Internal operations call the unqueued implementations below when they are
// already inside this queue; queuing a public wrapper from a queued operation
// would wait on itself forever.
let persistenceWriteTail: Promise<void> = Promise.resolve();

type PersistenceTestGate = (
  operation: "save-project",
  project: Project,
) => void | Promise<void>;

async function waitForPersistenceTestGate(project: Project): Promise<void> {
  // The gate is compiled out of production builds. It gives the browser race
  // tests a deterministic boundary without slowing IndexedDB or replacing
  // native Blob/Worker APIs with timing-sensitive mocks.
  if (!import.meta.env.DEV) return;
  const gate = (
    globalThis as typeof globalThis & {
      __SN_TEST_PERSISTENCE_GATE__?: PersistenceTestGate;
    }
  ).__SN_TEST_PERSISTENCE_GATE__;
  await gate?.("save-project", project);
}

function enqueuePersistenceWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = persistenceWriteTail.then(operation, operation);
  persistenceWriteTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// ── blob fingerprint cache ────────────────────────────────────────────────
// Tracks which blob keys have already been written to IDB in this session
// (key → "size:type:lastModified"). If the fingerprint has not changed
// we skip the IDB put, avoiding redundant re-serialization of large audio
// blobs on every autosave tick when nothing has changed.
const blobFpCache = new Map<string, string>();

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

type BlobWriteKind = "sample" | "choplab" | "audio-clip";

interface PendingBlobWrite {
  key: string;
  blob: Blob;
  fingerprint: string;
  kind: BlobWriteKind;
}

/**
 * Serialize a Project and fingerprint its blobs before opening an IndexedDB
 * transaction. Blob.arrayBuffer()/crypto work yields to another event-loop
 * task; doing it inside a transaction lets browsers auto-commit that
 * transaction before the first put, which made fresh sample saves fail.
 */
async function serializeAndCollectBlobs(project: Project): Promise<{
  serialized: SerializedProject;
  blobWrites: PendingBlobWrite[];
}> {
  const blobWrites = new Map<string, PendingBlobWrite>();
  const serializedSamples = await Promise.all(
    (project.samples ?? []).map(async (s) => {
      if (s.blob) {
        const sampleBlob = s.blob;
        const fp = await timeSampleImport(
          "blob-fingerprint",
          () => blobContentFingerprint(sampleBlob),
          { kind: "sample", bytes: sampleBlob.size },
        );
        if (blobFpCache.get(s.blobKey) !== fp) {
          blobWrites.set(s.blobKey, {
            key: s.blobKey,
            blob: sampleBlob,
            fingerprint: fp,
            kind: "sample",
          });
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
      const sampleBlob = cl.sampleBlob;
      const sampleBlobKey = cl.sampleBlobKey;
      const fp = await timeSampleImport(
        "blob-fingerprint",
        () => blobContentFingerprint(sampleBlob),
        { kind: "choplab", bytes: sampleBlob.size },
      );
      if (blobFpCache.get(cl.sampleBlobKey) !== fp) {
        blobWrites.set(sampleBlobKey, {
          key: sampleBlobKey,
          blob: sampleBlob,
          fingerprint: fp,
          kind: "choplab",
        });
      }
    }
    // Strip the in-memory blob from the serialized form.
    const { sampleBlob: _sb, ...clRest } = cl;
    void _sb;
    serializedChopLab = clRest;
  }

  const serialized: SerializedProject = {
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
              const clipBlob = c.blob;
              const fp = await timeSampleImport(
                "blob-fingerprint",
                () => blobContentFingerprint(clipBlob),
                { kind: "audio-clip", bytes: clipBlob.size },
              );
              if (blobFpCache.get(blobKey) !== fp) {
                blobWrites.set(blobKey, {
                  key: blobKey,
                  blob: clipBlob,
                  fingerprint: fp,
                  kind: "audio-clip",
                });
              }
            }
            const { blob: _blob, ...persistedClip } = c;
            void _blob;
            return { ...persistedClip, blobKey };
          }),
        ),
      })),
    ),
  };
  return { serialized, blobWrites: Array.from(blobWrites.values()) };
}

async function flushBlobWrites(
  tx: ReturnType<IDBPDatabase<Schema>["transaction"]>,
  blobWrites: readonly PendingBlobWrite[],
): Promise<void> {
  // Queue every IDB request synchronously before awaiting. This keeps the
  // transaction active while the browser services the writes.
  const blobs = (
    tx as unknown as {
      objectStore: (name: string) => {
        put: (value: Blob, key: string) => Promise<unknown>;
      };
    }
  ).objectStore(BLOBS_STORE);
  await Promise.all(
    blobWrites.map((write) => {
      countPerf("sampleBlobWrites", 1, {
        kind: write.kind,
        bytes: write.blob.size,
      });
      return timeSampleImport(
        "indexeddb-blob-write",
        () => blobs.put(write.blob, write.key),
        { kind: write.kind, bytes: write.blob.size },
      ).then(() => {
        markSampleImport("sample-blob-written", {
          kind: write.kind,
          bytes: write.blob.size,
        });
      });
    }),
  );
}

async function saveProjectUnqueued(project: Project): Promise<void> {
  await waitForPersistenceTestGate(project);
  return timePerfAsync("project-save", async () => {
    const db = await getDb();
    const { serialized, blobWrites } = await serializeAndCollectBlobs(project);
    const tx = db.transaction([PROJECTS_STORE, BLOBS_STORE, META_STORE], "readwrite");
    await flushBlobWrites(tx, blobWrites);
    await tx.objectStore(PROJECTS_STORE).put(serialized, project.id);
    await tx
      .objectStore(META_STORE)
      .put({ lastProjectId: project.id }, META_LAST_PROJECT);
    const savedInfo: LastSavedInfo = { projectId: project.id, ts: Date.now() };
    await tx.objectStore(META_STORE).put(savedInfo, META_LAST_SAVED);
    // A durable save only supersedes a draft of the same project. Replacement
    // flows may intentionally keep an edited transient demo in the single
    // recovery slot while saving the new/imported/remixed destination.
    const pendingDraft = (await tx
      .objectStore(META_STORE)
      .get(META_DRAFT)) as DraftSnapshot | undefined;
    if (!pendingDraft || pendingDraft.projectId === project.id) {
      await tx.objectStore(META_STORE).delete(META_DRAFT);
    }
    await tx.done;
    for (const write of blobWrites) {
      blobFpCache.set(write.key, write.fingerprint);
    }
  }, {
    tracks: project.tracks.length,
    samples: project.samples?.length ?? 0,
  });
}

export function saveProject(project: Project): Promise<void> {
  return enqueuePersistenceWrite(() => saveProjectUnqueued(project));
}

export async function loadProject(id: string): Promise<Project | null> {
  return timePerfAsync("project-load", async () => {
    const db = await getDb();
    const raw = (await db.get(PROJECTS_STORE, id)) as SerializedProject | undefined;
    if (!raw) return null;
    return hydrateSerialized(raw, db);
  }, { projectId: id });
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
async function saveDraftUnqueued(project: Project): Promise<void> {
  return timePerfAsync("autosave", async () => {
    const db = await getDb();
    const { serialized, blobWrites } = await serializeAndCollectBlobs(project);
    const tx = db.transaction([BLOBS_STORE, META_STORE], "readwrite");
    await flushBlobWrites(tx, blobWrites);
    const snapshot: DraftSnapshot = {
      project: serialized,
      ts: Date.now(),
      projectId: project.id,
    };
    await tx.objectStore(META_STORE).put(snapshot, META_DRAFT);
    await tx.done;
    for (const write of blobWrites) {
      blobFpCache.set(write.key, write.fingerprint);
    }
  }, {
    tracks: project.tracks.length,
    samples: project.samples?.length ?? 0,
  });
}

export function saveDraft(project: Project): Promise<void> {
  return enqueuePersistenceWrite(() => saveDraftUnqueued(project));
}

/** Preserve the current source before replacing it with another project. */
export async function preserveProjectForReplacement(
  project: Project,
  isTransientProject: boolean,
): Promise<void> {
  if (isTransientProject) await saveDraft(project);
  else await saveProject(project);
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
async function relocateSampleBlobUnqueued(
  blobKey: string,
  blob: Blob,
): Promise<void> {
  const db = await getDb();
  await db.put(BLOBS_STORE, blob, blobKey);
}

export function relocateSampleBlob(
  blobKey: string,
  blob: Blob,
): Promise<void> {
  return enqueuePersistenceWrite(() => relocateSampleBlobUnqueued(blobKey, blob));
}

/**
 * Deep-clone a project under a new id and name so the user can branch
 * a session ("Save As" / "Duplicate"). Blobs are re-keyed and copied so
 * deleting the original doesn't strand the new project.
 */
function remapPadSampleKeys(
  padSamples: Track["padSamples"],
  sampleKeyMap: ReadonlyMap<string, string>,
): Track["padSamples"] {
  if (!padSamples) return undefined;
  return Object.fromEntries(
    Object.entries(padSamples).flatMap(([piece, sourceKey]) => {
      if (!sourceKey) return [];
      const destinationKey = sampleKeyMap.get(sourceKey);
      return destinationKey ? [[piece, destinationKey]] : [];
    }),
  ) as Track["padSamples"];
}

async function duplicateProjectUnqueued(
  source: Project,
  newName: string,
): Promise<Project> {
  const db = await getDb();
  const newId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const samplePlans = (source.samples ?? []).map((sample) => ({
    source: sample,
    destinationKey: `${newId}:sample:${sample.id}`,
  }));
  const sampleKeyMap = new Map(
    samplePlans.map(({ source: sample, destinationKey }) => [
      sample.blobKey,
      destinationKey,
    ]),
  );

  const tracks = await Promise.all(
    source.tracks.map(async (t) => ({
      ...t,
      padSamples: remapPadSampleKeys(t.padSamples, sampleKeyMap),
      audioClips: await Promise.all(
        t.audioClips.map(async (c) => {
          let blob = c.blob;
          if (!blob && c.blobKey) {
            blob = (await db.get(BLOBS_STORE, c.blobKey)) as
              | Blob
              | undefined;
          }
          const newKey = `${newId}:${t.id}:${c.id}`;
          return { ...c, blob, blobKey: newKey };
        }),
      ),
    })),
  );
  const samples = await Promise.all(
    samplePlans.map(async ({ source: s, destinationKey }) => {
      let blob = s.blob;
      if (!blob && s.blobKey) {
        blob = (await db.get(BLOBS_STORE, s.blobKey)) as
          | Blob
          | undefined;
      }
      return { ...s, blob, blobKey: destinationKey };
    }),
  );
  // Copy the ChopLab sample blob under the new project's key.
  let dupChopLab = source.chopLab;
  if (source.chopLab) {
    let sampleBlob = source.chopLab.sampleBlob;
    if (!sampleBlob && source.chopLab.sampleBlobKey) {
      sampleBlob = (await db.get(
        BLOBS_STORE,
        source.chopLab.sampleBlobKey,
      )) as Blob | undefined;
    }
    const newChopKey = `${newId}:choplab:sample`;
    dupChopLab = {
      ...source.chopLab,
      sampleBlobKey: newChopKey,
      sampleBlob,
    };
  }

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
  await saveProjectUnqueued(dup);
  return dup;
}

export function duplicateProject(
  source: Project,
  newName: string,
): Promise<Project> {
  return enqueuePersistenceWrite(() => duplicateProjectUnqueued(source, newName));
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
  project: Omit<Project, "tracks" | "samples" | "chopLab"> & {
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
    chopLab?: Omit<ChopLabPersistedState, "sampleBlob"> & {
      mimeType?: string;
      base64?: string;
    };
  };
}

export type ProjectExportMode = "project-only" | "project-with-samples";

/** Summary of an incoming JSON file used to populate the Import Summary
 *  modal so the user can review before replacing the active project. */
export interface ProjectImportSummary {
  project: Project;
  jsonText: string;
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
    if (i > 0 && i % (chunk * 128) === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
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
  return timePerfAsync("json-export", async () => {
    const embed = mode === "project-with-samples";
    const tracks: ProjectJsonV1["project"]["tracks"] = [];
    for (const t of project.tracks) {
      const audioClips: ProjectJsonV1["project"]["tracks"][number]["audioClips"] = [];
      for (const c of t.audioClips) {
        if (!c.blob || !embed) {
          const { blob: _b, ...rest } = c;
          void _b;
          audioClips.push(rest);
        } else {
          const { base64, mimeType } = await blobToBase64(c.blob);
          const { blob: _ignored, ...rest } = c;
          void _ignored;
          audioClips.push({ ...rest, base64, mimeType });
        }
      }
      tracks.push({ ...t, audioClips });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const samples: ProjectJsonV1["project"]["samples"] = [];
    for (const s of project.samples ?? []) {
        if (!s.blob || !embed) {
          const { blob: _b, ...rest } = s;
          void _b;
          samples.push(rest);
        } else {
          const { base64, mimeType } = await blobToBase64(s.blob);
          const { blob: _b, ...rest } = s;
          void _b;
          samples.push({ ...rest, base64, mimeType });
        }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    let chopLab: ProjectJsonV1["project"]["chopLab"];
    if (project.chopLab) {
      const { sampleBlob, ...persisted } = project.chopLab;
      if (embed && sampleBlob) {
        const encoded = await blobToBase64(sampleBlob);
        chopLab = { ...persisted, ...encoded };
      } else {
        chopLab = persisted;
      }
    }
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
        chopLab,
      } as ProjectJsonV1["project"],
    };
    return JSON.stringify(payload, null, 2);
  }, {
    mode,
    tracks: project.tracks.length,
    samples: project.samples?.length ?? 0,
  });
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
  const project = projectFromEnvelope(data, false);
  let noteClipCount = 0;
  let audioClipCount = 0;
  const missingSampleNames: string[] = [];
  for (const t of data.project.tracks) {
    noteClipCount += Array.isArray(t.noteClips) ? t.noteClips.length : 0;
    audioClipCount += Array.isArray(t.audioClips) ? t.audioClips.length : 0;
    for (const c of t.audioClips ?? []) {
      if (!c.base64) missingSampleNames.push(`${t.name} clip`);
    }
  }
  for (const s of data.project.samples ?? []) {
    if (!s.base64) missingSampleNames.push(s.name);
  }
  if (data.project.chopLab?.sampleName && !data.project.chopLab.base64) {
    missingSampleNames.push(`Chop Lab: ${data.project.chopLab.sampleName}`);
  }
  const isOlderAppVersion =
    !!data.brand && compareVersions(data.brand.appVersion, APP_VERSION) < 0;
  return {
    project,
    jsonText: text,
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
  return projectFromEnvelope(data, true);
}

function projectFromEnvelope(data: ProjectJsonV1, hydrateBlobs: boolean): Project {
  const newId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const p = data.project;
  const samplePlans = (p.samples ?? []).map((sample) => ({
    source: sample,
    destinationKey: `${newId}:sample:${sample.id}`,
  }));
  const sampleKeyMap = new Map(
    samplePlans.map(({ source: sample, destinationKey }) => [
      sample.blobKey,
      destinationKey,
    ]),
  );
  const tracks = p.tracks.map((t) => ({
    ...t,
    padSamples: remapPadSampleKeys(t.padSamples, sampleKeyMap),
    audioClips: t.audioClips.map((c) => {
      const blob =
        hydrateBlobs && c.base64 && c.mimeType
          ? base64ToBlob(c.base64, c.mimeType)
          : undefined;
      const blobKey = `${newId}:${t.id}:${c.id}`;
      const { base64: _b, mimeType: _m, ...rest } = c;
      void _b;
      void _m;
      return { ...rest, blob, blobKey };
    }),
  }));
  const samples = samplePlans.map(({ source: s, destinationKey }) => {
    const blob =
      hydrateBlobs && s.base64 && s.mimeType ? base64ToBlob(s.base64, s.mimeType) : undefined;
    const { base64: _b, mimeType: _m, ...rest } = s;
    void _b;
    void _m;
    return { ...rest, blob, blobKey: destinationKey } as SampleLibraryItem;
  });
  let chopLab: ChopLabPersistedState | undefined;
  if (p.chopLab) {
    const sampleBlob =
      hydrateBlobs && p.chopLab.base64 && p.chopLab.mimeType
        ? base64ToBlob(p.chopLab.base64, p.chopLab.mimeType)
        : undefined;
    const sampleBlobKey = `${newId}:choplab`;
    const { base64: _base64, mimeType: _mimeType, ...persisted } = p.chopLab;
    void _base64;
    void _mimeType;
    chopLab = { ...persisted, sampleBlob, sampleBlobKey };
  }
  // Funnel imported JSON through the migrator so old exports get the
  // same defaults / schema stamp as IndexedDB loads.
  const migrated = migrateProject({
    ...p,
    id: newId,
    tracks,
    samples,
    chopLab,
    updatedAt: Date.now(),
  }).project;
  return migrated;
}
