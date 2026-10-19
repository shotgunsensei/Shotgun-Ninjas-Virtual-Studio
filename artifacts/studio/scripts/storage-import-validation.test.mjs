import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// No real IDB, browser, audio engine or provider is opened. Actual storage,
// migration and validation modules run in a fresh VM; unrelated diagnostics,
// branding and the IDB boundary are replaced. Node 20 can use the existing
// TypeScript devDependency; Node 24 uses native stripping without dependencies.
let fallbackCompiler;
async function stripSource(source, filename) {
  if (typeof nodeModule.stripTypeScriptTypes === "function") return nodeModule.stripTypeScriptTypes(source);
  fallbackCompiler ??= import("typescript").then(({ default: compiler }) => compiler);
  const compiler = await fallbackCompiler;
  return compiler.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: compiler.ScriptTarget.ES2022, module: compiler.ModuleKind.ESNext, verbatimModuleSyntax: true },
  }).outputText;
}

async function fixture() {
  let databaseCalls = 0;
  let mediaDecodes = 0;
  const context = vm.createContext({
    Blob, URL, performance, btoa, setTimeout, clearTimeout,
    atob(value) { mediaDecodes++; return atob(value); },
    window: { setTimeout, clearTimeout },
  });
  const modules = new Map();
  const stubs = {
    idb: { async openDB() { databaseCalls++; throw new Error("Unexpected database access during import validation"); } },
    "../version": { APP_NAME: "Test", APP_URL: "https://test.invalid", APP_VERSION: "1.0.0", CREATED_WITH: "Test" },
    "../../utils/performanceDiagnostics": { countPerf: () => {}, timePerfAsync: (_name, operation) => operation() },
    "./performanceGuards": { blobContentFingerprint: async () => "unused" },
    "../performance/sampleImportTrace": { markSampleImport: () => {}, timeSampleImport: (_name, operation) => operation() },
    "./audio/engine": { audio: {} },
    "../utils/performanceDiagnostics": { startPerfTimer: () => () => {} },
  };
  async function synthetic(values) {
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  }
  async function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    let rawSource = await readFile(filename, "utf8");
    if (filename.replaceAll("\\", "/").endsWith("/src/store.ts")) {
      // Execute the actual pure factory tail without importing React/Tone.
      // Keep its actual ID helper and data; runtime store actions must not run.
      const idHelper = rawSource.match(/const newId = \(\) =>[\s\S]*?;/)?.[0];
      const factoryStart = rawSource.indexOf("export function makeId()");
      assert.ok(idHelper && factoryStart !== -1, "Store factory anchors changed");
      rawSource = `${idHelper}\n${rawSource.slice(factoryStart)}\n` +
        'export function getStore() { throw new Error("Unexpected runtime store access"); }\n' +
        'export function resetStore() { throw new Error("Unexpected runtime store reset"); }\n';
    }
    const source = await stripSource(rawSource, filename);
    const module = new vm.SourceTextModule(source, {
      context, identifier: filename,
      initializeImportMeta(meta) { meta.env = { DEV: false }; meta.url = new URL(`file:///${filename.replaceAll("\\", "/")}`).href; },
    });
    modules.set(filename, module);
    await module.link(async (specifier, referrer) => {
      if (stubs[specifier]) return synthetic(stubs[specifier]);
      if (specifier.startsWith("node:")) return synthetic(await import(specifier));
      assert.ok(specifier.startsWith("."), `Unexpected dependency: ${specifier}`);
      return load(path.resolve(path.dirname(referrer.identifier), specifier + (path.extname(specifier) ? "" : ".ts")));
    });
    return module;
  }
  const storage = await load(fileURLToPath(new URL("../src/lib/storage/db.ts", import.meta.url)));
  await storage.evaluate();
  return { storage: storage.namespace, load, databaseCalls: () => databaseCalls, mediaDecodes: () => mediaDecodes };
}

function envelope() {
  return {
    format: "shotgun-ninjas-studio-project", version: 2,
    project: {
      id: "import-source", name: "Valid import", bpm: 100, bars: 4,
      loopEnabled: false, loopStartBeat: 0, loopEndBeat: 16, midiMappings: [],
      tracks: [{
        id: "keys", name: "Keys", kind: "piano", preset: "electric",
        noteClips: [{ id: "notes", start: 0, length: 4,
          notes: [{ time: 0, duration: 1, velocity: 0.8, note: "C4" }] }],
        audioClips: [{ id: "audio", start: 0, durationSec: 1,
          blobKey: "import-source:keys:audio", base64: "YXVkaW8=", mimeType: "audio/wav" }],
      }], samples: [],
    },
  };
}

const malformed = [
  ["null track", (p) => { p.tracks = [null]; }],
  ["non-object track", (p) => { p.tracks = [[]]; }],
  ["null note clips", (p) => { p.tracks[0].noteClips = null; }],
  ["non-array audio clips", (p) => { p.tracks[0].audioClips = {}; }],
  ["null note clip", (p) => { p.tracks[0].noteClips = [null]; }],
  ["null audio clip", (p) => { p.tracks[0].audioClips = [null]; }],
  ["null notes", (p) => { p.tracks[0].noteClips[0].notes = null; }],
  ["missing notes", (p) => { delete p.tracks[0].noteClips[0].notes; }],
  ["non-array notes", (p) => { p.tracks[0].noteClips[0].notes = "C4"; }],
  ["null note", (p) => { p.tracks[0].noteClips[0].notes = [null]; }],
  ["non-object note", (p) => { p.tracks[0].noteClips[0].notes = [[]]; }],
  ["non-string note name", (p) => { p.tracks[0].noteClips[0].notes[0].note = {}; }],
  ["non-number note time", (p) => { p.tracks[0].noteClips[0].notes[0].time = "0"; }],
  ["negative note duration", (p) => { p.tracks[0].noteClips[0].notes[0].duration = -1; }],
  ["non-number velocity", (p) => { p.tracks[0].noteClips[0].notes[0].velocity = null; }],
  ["zero clip length", (p) => { p.tracks[0].noteClips[0].length = 0; }],
  ["non-number audio duration", (p) => { p.tracks[0].audioClips[0].durationSec = "1"; }],
  ["unsupported track kind", (p) => { p.tracks[0].kind = "unknown"; }],
  ["duplicate track id", (p) => { p.tracks.push(structuredClone(p.tracks[0])); }],
  ["duplicate clip id", (p) => { p.tracks[0].audioClips[0].id = "notes"; }],
  ["null library array", (p) => { p.samples = null; }],
  ["null library entry", (p) => { p.samples = [null]; }],
  ["missing library sample name", (p) => { p.samples = [{ id: "s", blobKey: "sample", durationSec: 0 }]; }],
  ["missing library sample duration", (p) => { p.samples = [{ id: "s", blobKey: "sample", name: "Source" }]; }],
  ["null sections array", (p) => { p.sections = null; }],
  ["null MIDI target", (p) => { p.midiMappings = [{ id: "m", target: null }]; }],
  ["null automation breakpoints", (p) => { p.tracks[0].automationLanes = [{ id: "lane", param: "volume", breakpoints: null }]; }],
  ["non-array Chop markers", (p) => { p.chopLab = { markers: {} }; }],
  ["zero BPM", (p) => { p.bpm = 0; }],
  ["malformed embedded base64", (p) => { p.tracks[0].audioClips[0].base64 = "!!!!"; }],
  ["misplaced base64 padding", (p) => { p.tracks[0].audioClips[0].base64 = "Y=Vk"; }],
  ["embedded media without MIME type", (p) => { delete p.tracks[0].audioClips[0].mimeType; }],
];

for (const [name, mutate] of malformed) {
  test(`both import paths reject ${name} before storage or embedded-media decoding`, async () => {
    const current = await fixture();
    const input = envelope();
    mutate(input.project);
    const text = JSON.stringify(input);
    assert.throws(() => current.storage.summarizeProjectJson(text), /Invalid project file:/);
    assert.throws(() => current.storage.parseProjectJson(text), /Invalid project file:/);
    assert.equal(current.databaseCalls(), 0);
    assert.equal(current.mediaDecodes(), 0);
  });
}

test("JSON numeric overflow is rejected even inside optional nested settings", async () => {
  const current = await fixture();
  const text = JSON.stringify(envelope()).replace('"bpm":100', '"bpm":1e309');
  assert.throws(() => current.storage.summarizeProjectJson(text), /finite number/);
  const nested = envelope();
  nested.project.tracks[0].sound = { release: "OVERFLOW" };
  const nestedText = JSON.stringify(nested).replace('"OVERFLOW"', '1e309');
  assert.throws(() => current.storage.parseProjectJson(nestedText), /finite number/);
  assert.equal(current.databaseCalls(), 0);
  assert.equal(current.mediaDecodes(), 0);
});

test("bad brand values and excessive structure depth/work are rejected during summary", async () => {
  const current = await fixture();
  const badBrand = envelope();
  badBrand.brand = { appVersion: {} };
  assert.throws(() => current.storage.summarizeProjectJson(JSON.stringify(badBrand)), /brand.appVersion/);
  const deep = envelope();
  deep.project.extra = Array.from({ length: 33 }).reduce((value) => ({ nested: value }), {});
  assert.throws(() => current.storage.parseProjectJson(JSON.stringify(deep)), /nested too deeply/);
  const wide = envelope();
  wide.project.extra = Array(1_000_001).fill(null);
  assert.throws(() => current.storage.summarizeProjectJson(JSON.stringify(wide)), /structure budget/);
  assert.equal(current.databaseCalls(), 0);
  assert.equal(current.mediaDecodes(), 0);
});

test("v1/v2 imports preserve notes and media while legacy missing clip arrays receive defaults", async () => {
  const current = await fixture();
  for (const version of [1, 2]) {
    const input = envelope();
    input.version = version;
    const imported = current.storage.parseProjectJson(JSON.stringify(input));
    assert.equal(imported.tracks[0].noteClips[0].notes[0].note, "C4");
    assert.equal(await imported.tracks[0].audioClips[0].blob.text(), "audio");
    assert.notEqual(imported.id, input.project.id);
    const roundtrip = current.storage.parseProjectJson(await current.storage.projectToJson(imported));
    assert.equal(await roundtrip.tracks[0].audioClips[0].blob.text(), "audio");
    delete input.project.tracks[0].noteClips;
    delete input.project.tracks[0].audioClips;
    const legacy = current.storage.parseProjectJson(JSON.stringify(input));
    assert.equal(legacy.tracks[0].noteClips.length, 0);
    assert.equal(legacy.tracks[0].audioClips.length, 0);
  }
  assert.equal(current.databaseCalls(), 0);
});

test("legacy clip IDs can be reused on different tracks", async () => {
  const current = await fixture();
  const input = envelope();
  input.project.tracks.push({ ...structuredClone(input.project.tracks[0]), id: "other-keys" });
  const summary = current.storage.summarizeProjectJson(JSON.stringify(input));
  const imported = current.storage.parseProjectJson(JSON.stringify(input));
  assert.equal(summary.trackCount, 2);
  assert.equal(imported.tracks[0].noteClips[0].id, imported.tracks[1].noteClips[0].id);
  assert.notEqual(imported.tracks[0].audioClips[0].blobKey, imported.tracks[1].audioClips[0].blobKey);
});

test("blank library sample names remain valid strings", async () => {
  const current = await fixture();
  for (const name of ["", " "]) {
    const input = envelope();
    input.project.samples = [{ id: "sample", name, durationSec: 0, blobKey: "missing-source" }];
    const imported = current.storage.parseProjectJson(JSON.stringify(input));
    assert.equal(imported.samples[0].name, name);
  }
});

test("actual default and all demo data factories export and import without audio dependencies", async () => {
  const current = await fixture();
  const factories = await current.load(fileURLToPath(new URL("../src/store.ts", import.meta.url)));
  await factories.evaluate();
  const demos = await current.load(fileURLToPath(new URL("../src/lib/demos.ts", import.meta.url)));
  await demos.evaluate();
  const projects = [factories.namespace.defaultProject(), ...demos.namespace.DEMOS.map((demo) => demo.build())];
  assert.equal(projects.length, 9);
  for (const project of projects) {
    const text = await current.storage.projectToJson(project);
    const summary = current.storage.summarizeProjectJson(text);
    const imported = current.storage.parseProjectJson(text);
    assert.equal(summary.project.name, project.name);
    assert.equal(imported.bpm, project.bpm);
    assert.equal(imported.bars, project.bars);
    const notes = (value) => JSON.stringify(value.tracks.map((track) => ({ kind: track.kind, clips: track.noteClips })));
    assert.equal(notes(imported), notes(project), project.name);
  }
  assert.equal(current.databaseCalls(), 0);
});

// Run the repository's unchanged JSON roundtrip/custom-source and migration
// fixtures against the same actual modules to catch compatibility regressions.
const compatibility = await fixture();
for (const name of ["storage-json", "storage-migration"]) {
  const module = await compatibility.load(fileURLToPath(new URL(`./${name}.test.ts`, import.meta.url)));
  await module.evaluate();
}
