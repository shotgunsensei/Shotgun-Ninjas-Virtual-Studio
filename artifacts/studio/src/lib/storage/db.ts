import { openDB, type IDBPDatabase } from "idb";
import type { Project, SampleLibraryItem } from "../../types";

const DB_NAME = "shotgun-ninjas-studio";
const DB_VERSION = 1;
const PROJECTS_STORE = "projects";
const BLOBS_STORE = "blobs";
const META_STORE = "meta";

interface Schema {
  projects: { key: string; value: SerializedProject };
  blobs: { key: string; value: Blob };
  meta: { key: string; value: { lastProjectId?: string } };
}

interface SerializedProject extends Omit<Project, "tracks" | "samples"> {
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
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

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

export async function saveProject(project: Project): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([PROJECTS_STORE, BLOBS_STORE, META_STORE], "readwrite");

  const serializedSamples = await Promise.all(
    (project.samples ?? []).map(async (s) => {
      if (s.blob) {
        await tx.objectStore(BLOBS_STORE).put(s.blob, s.blobKey);
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

  const serialized: SerializedProject = {
    ...project,
    updatedAt: Date.now(),
    samples: serializedSamples,
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
              await tx.objectStore(BLOBS_STORE).put(c.blob, blobKey);
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

  await tx.objectStore(PROJECTS_STORE).put(serialized, project.id);
  await tx.objectStore(META_STORE).put({ lastProjectId: project.id }, "lastProject");
  await tx.done;
}

export async function loadProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const raw = (await db.get(PROJECTS_STORE, id)) as SerializedProject | undefined;
  if (!raw) return null;
  const tracks = await Promise.all(
    raw.tracks.map(async (t) => ({
      ...t,
      audioClips: await Promise.all(
        t.audioClips.map(async (c) => {
          const blob = c.blobKey ? await db.get(BLOBS_STORE, c.blobKey) : undefined;
          return { ...c, blob };
        }),
      ),
    })),
  );
  const samples = await Promise.all(
    (raw.samples ?? []).map(async (s) => {
      const blob = s.blobKey ? await db.get(BLOBS_STORE, s.blobKey) : undefined;
      return { ...s, blob } as SampleLibraryItem;
    }),
  );
  return { ...raw, tracks, samples } as Project;
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
  const meta = (await db.get(META_STORE, "lastProject")) as
    | { lastProjectId?: string }
    | undefined;
  return meta?.lastProjectId ?? null;
}

export async function setLastProjectId(id: string): Promise<void> {
  const db = await getDb();
  await db.put(META_STORE, { lastProjectId: id }, "lastProject");
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
  await tx.done;

  const dup: Project = {
    ...source,
    id: newId,
    name: newName,
    tracks,
    samples,
    updatedAt: Date.now(),
  };
  await saveProject(dup);
  return dup;
}

// ---------- JSON export / import ----------

interface ProjectJsonV1 {
  format: "shotgun-ninjas-studio-project";
  version: 1;
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

export async function projectToJson(project: Project): Promise<string> {
  const tracks = await Promise.all(
    project.tracks.map(async (t) => ({
      ...t,
      audioClips: await Promise.all(
        t.audioClips.map(async (c) => {
          if (!c.blob) return { ...c, blob: undefined };
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
      if (!s.blob) {
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
  const payload: ProjectJsonV1 = {
    format: "shotgun-ninjas-studio-project",
    version: 1,
    project: { ...project, tracks, samples } as ProjectJsonV1["project"],
  };
  return JSON.stringify(payload, null, 2);
}

export function parseProjectJson(text: string): Project {
  const data = JSON.parse(text) as ProjectJsonV1;
  if (
    !data ||
    typeof data !== "object" ||
    data.format !== "shotgun-ninjas-studio-project" ||
    data.version !== 1 ||
    !data.project
  ) {
    throw new Error("Not a valid Shotgun Ninjas Studio project file");
  }
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
  return {
    ...p,
    id: newId,
    tracks,
    samples,
    updatedAt: Date.now(),
  } as Project;
}
