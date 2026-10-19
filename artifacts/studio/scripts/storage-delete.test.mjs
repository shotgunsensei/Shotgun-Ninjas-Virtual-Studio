import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

let fallbackCompiler;
async function stripSource(source, filename) {
  if (typeof nodeModule.stripTypeScriptTypes === "function") {
    return nodeModule.stripTypeScriptTypes(source);
  }
  // Node 20 is still declared by the Replit workspace. Use the repository's
  // existing TypeScript devDependency there; Node 24 needs no dependency.
  fallbackCompiler ??= import("typescript").then(({ default: compiler }) => compiler);
  const compiler = await fallbackCompiler;
  return compiler.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: compiler.ScriptTarget.ES2022,
      module: compiler.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
  }).outputText;
}

// Native Node regression coverage for the real db.ts and migrate.ts. This
// adapter stages writes until tx.done and can roll back an injected commit
// failure. It does not model real IndexedDB locking, auto-commit, quota,
// cross-tab behavior, browser audio, or rendering. No real database is opened.
function memoryDatabase() {
  const stores = new Map(
    ["projects", "blobs", "meta"].map((name) => [name, new Map()]),
  );
  const requests = [];
  let failCommit = false;
  const objectStore = (tables, name) => {
    const values = tables.get(name);
    assert.ok(values, `Unexpected object store: ${name}`);
    return {
      async put(value, key) {
        requests.push({ operation: "put", store: name, key });
        values.set(key, structuredClone(value));
        return key;
      },
      async get(key) {
        return structuredClone(values.get(key));
      },
      async delete(key) {
        requests.push({ operation: "delete", store: name, key });
        values.delete(key);
      },
      async getAllKeys() {
        return [...values.keys()];
      },
    };
  };
  return {
    stores,
    requests,
    failNextCommit() {
      failCommit = true;
    },
    db: {
      objectStoreNames: { contains: (name) => stores.has(name) },
      get: (name, key) => objectStore(stores, name).get(key),
      put: (name, value, key) => objectStore(stores, name).put(value, key),
      delete: (name, key) => objectStore(stores, name).delete(key),
      transaction(names) {
        const staged = new Map(
          names.map((name) => [name, new Map(stores.get(name))]),
        );
        let completion;
        return {
          objectStore: (name) => objectStore(staged, name),
          get done() {
            completion ??= Promise.resolve().then(() => {
              if (failCommit) {
                failCommit = false;
                throw new Error("Injected transaction commit failure");
              }
              for (const [name, values] of staged) stores.set(name, values);
            });
            return completion;
          },
        };
      },
    },
  };
}

async function storageFixture(beforeFingerprint = async () => {}) {
  const adapter = memoryDatabase();
  const context = vm.createContext({
    Blob, URL, performance, btoa, atob, setTimeout, clearTimeout,
    window: { setTimeout, clearTimeout },
  });
  const modules = new Map();
  const stubs = {
    idb: { openDB: async () => adapter.db },
    "../version": {
      APP_NAME: "Storage test", APP_URL: "https://test.invalid",
      APP_VERSION: "1.0.0", CREATED_WITH: "Storage test",
    },
    "../../utils/performanceDiagnostics": {
      countPerf: () => {}, timePerfAsync: (_name, operation) => operation(),
    },
    "./performanceGuards": {
      async blobContentFingerprint(blob) {
        await beforeFingerprint(blob);
        const hash = createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex");
        return `sha256:${hash}:${blob.size}:${blob.type}`;
      },
    },
    "../performance/sampleImportTrace": {
      markSampleImport: () => {}, timeSampleImport: (_name, operation) => operation(),
    },
  };
  async function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const source = await stripSource(await readFile(filename, "utf8"), filename);
    const module = new vm.SourceTextModule(source, {
      context, identifier: filename,
      initializeImportMeta(meta) { meta.env = { DEV: false }; },
    });
    modules.set(filename, module);
    await module.link(async (specifier, referrer) => {
      if (stubs[specifier]) {
        const values = stubs[specifier];
        return new vm.SyntheticModule(Object.keys(values), function () {
          for (const [key, value] of Object.entries(values)) this.setExport(key, value);
        }, { context });
      }
      assert.ok(specifier.startsWith("."), `Unexpected dependency: ${specifier}`);
      const extension = path.extname(specifier) ? "" : ".ts";
      return load(path.resolve(path.dirname(referrer.identifier), specifier + extension));
    });
    return module;
  }
  const module = await load(fileURLToPath(new URL("../src/lib/storage/db.ts", import.meta.url)));
  await module.evaluate();
  return { storage: module.namespace, adapter };
}

function projectFixture(id) {
  return {
    id, name: "Project with all media", bpm: 100, bars: 4,
    loopEnabled: false, loopStartBeat: 0, loopEndBeat: 16,
    tracks: [{
      id: "voice", name: "Voice", kind: "vocals", preset: "clean",
      volume: 0.8, pan: 0, muted: false, solo: false, armed: false,
      noteClips: [], audioClips: [{
        id: "take", start: 0, durationSec: 1, blobKey: `${id}:voice:take`,
        blob: new Blob(["recording"], { type: "audio/wav" }),
      }], fx: { reverb: 0, delay: 0, filter: 1 },
    }],
    samples: [{
      id: "sample", name: "Sample", durationSec: 1, createdAt: 1,
      blobKey: `${id}:sample:sample`,
      blob: new Blob(["library"], { type: "audio/wav" }),
    }],
    chopLab: {
      markers: [], sliceSettings: [], sensitivity: 0.5, sampleName: "Chop",
      sampleBlobKey: `${id}:choplab`,
      sampleBlob: new Blob(["chop"], { type: "audio/wav" }),
    },
    midiMappings: [], updatedAt: 1,
  };
}

async function assertMedia(project) {
  assert.ok(project, "Project must hydrate");
  assert.equal(await project.tracks[0].audioClips[0].blob?.text(), "recording");
  assert.equal(await project.samples[0].blob?.text(), "library");
  assert.equal(await project.chopLab.sampleBlob?.text(), "chop");
}

test("deleting then re-saving the active project restores all three media classes", async () => {
  const { storage, adapter } = await storageFixture();
  const project = projectFixture("active-delete");
  await storage.saveProject(project);
  assert.equal(await storage.loadDraft(), null);
  assert.equal(adapter.stores.get("blobs").size, 3);
  await storage.deleteProject(project.id);
  assert.equal(await storage.loadProject(project.id), null);
  assert.equal(adapter.stores.get("blobs").size, 0);
  await storage.saveProject(project);
  assert.equal(adapter.stores.get("blobs").size, 3);
  await assertMedia(await storage.loadProject(project.id));
});

test("deleting a saved project retains its recovery draft media and removes unreferenced blobs", async () => {
  const { storage, adapter } = await storageFixture();
  const project = projectFixture("draft-delete");
  await storage.saveProject(project);
  await storage.saveDraft(project);
  adapter.stores.get("blobs").set(`${project.id}:unused`, new Blob(["unused"]));
  adapter.stores.get("blobs").set("other-project:sample", new Blob(["unrelated"]));
  await storage.deleteProject(project.id);
  assert.equal(await storage.loadProject(project.id), null);
  const draft = await storage.loadDraft();
  assert.equal(draft?.projectId, project.id);
  await assertMedia(await storage.hydrateDraft(draft));
  assert.equal(adapter.stores.get("blobs").has(`${project.id}:unused`), false);
  assert.equal(await adapter.stores.get("blobs").get("other-project:sample").text(), "unrelated");
});

test("deletion waits behind an earlier save with a blocked fingerprint", { timeout: 5_000 }, async () => {
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const { storage, adapter } = await storageFixture(async () => {
    entered();
    await gate;
  });
  const project = projectFixture("fifo-delete");
  const saving = storage.saveProject(project);
  await started;
  let deletionSettled = false;
  const deleting = storage.deleteProject(project.id).finally(() => { deletionSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  const overtookSave = deletionSettled;
  release();
  await Promise.all([saving, deleting]);
  assert.equal(overtookSave, false, "Delete must not overtake the queued save");
  assert.equal(await storage.loadProject(project.id), null);
  assert.equal(adapter.stores.get("blobs").size, 0);
});

test("failed deletion rolls back media and retains unchanged-blob cache entries", async () => {
  const { storage, adapter } = await storageFixture();
  const project = projectFixture("failed-delete");
  await storage.saveProject(project);
  adapter.failNextCommit();
  await assert.rejects(storage.deleteProject(project.id), /Injected transaction commit failure/);
  await assertMedia(await storage.loadProject(project.id));
  const writesBeforeResave = adapter.requests.filter((request) => request.store === "blobs" && request.operation === "put").length;
  await storage.saveProject(project);
  const writesAfterResave = adapter.requests.filter((request) => request.store === "blobs" && request.operation === "put").length;
  assert.equal(writesAfterResave, writesBeforeResave, "Failed deletion must not invalidate the committed blob cache");
  await assertMedia(await storage.loadProject(project.id));
});
