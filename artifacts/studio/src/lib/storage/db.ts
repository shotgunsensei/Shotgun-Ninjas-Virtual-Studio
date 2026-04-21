import { openDB, type IDBPDatabase } from "idb";
import type { Project } from "../../types";

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

interface SerializedProject extends Omit<Project, "tracks"> {
  tracks: Array<
    Omit<Project["tracks"][number], "audioClips"> & {
      audioClips: Array<{
        id: string;
        start: number;
        durationSec: number;
        blobKey?: string;
      }>;
    }
  >;
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

  const serialized: SerializedProject = {
    ...project,
    updatedAt: Date.now(),
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
  return { ...raw, tracks } as Project;
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
  await db.delete(PROJECTS_STORE, id);
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
