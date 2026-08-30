import { readFile, readdir, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(packageDir, "dist", "public");
const manifestPath = path.join(distDir, ".vite", "manifest.json");

const limits = {
  landing: { rawJs: 250_000, gzipJs: 80_000 },
  studio: { rawJs: 1_350_000, gzipJs: 380_000 },
  sharedCss: { raw: 160_000, gzip: 25_000 },
  largestLazyGzip: 200_000,
};

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entries = Object.entries(manifest);
const mainKey = entries.find(([, value]) => value.isEntry)?.[0];
const appKey = entries.find(([, value]) =>
  value.src?.replaceAll("\\", "/").endsWith("src/App.tsx") ||
  (value.name === "App" && value.isDynamicEntry),
)?.[0];
const landingKey = entries.find(([, value]) => value.src?.replaceAll("\\", "/").endsWith("src/pages/LandingPage.tsx"))?.[0];

if (!mainKey || !appKey || !landingKey) {
  throw new Error(`Bundle manifest is missing required entries (main=${mainKey}, app=${appKey}, landing=${landingKey}).`);
}

function collectInitialFiles(startKeys) {
  const visited = new Set();
  const files = new Set();
  const css = new Set();
  const visit = (key) => {
    if (!key || visited.has(key)) return;
    visited.add(key);
    const entry = manifest[key];
    if (!entry) return;
    if (entry.file) files.add(entry.file);
    for (const cssFile of entry.css ?? []) css.add(cssFile);
    for (const dependency of entry.imports ?? []) visit(dependency);
  };
  for (const key of startKeys) visit(key);
  return { files, css };
}

async function sizes(relativeFiles, extension) {
  let raw = 0;
  let gzip = 0;
  for (const relativeFile of relativeFiles) {
    if (!relativeFile.endsWith(extension)) continue;
    const bytes = await readFile(path.join(distDir, relativeFile));
    raw += bytes.byteLength;
    gzip += gzipSync(bytes, { level: 9 }).byteLength;
  }
  return { raw, gzip };
}

function kb(bytes) {
  return `${(bytes / 1000).toFixed(2)} kB`;
}

function assertAtMost(label, actual, maximum) {
  if (actual > maximum) {
    throw new Error(`${label} is ${kb(actual)}; budget is ${kb(maximum)}.`);
  }
}

const landing = collectInitialFiles([mainKey, landingKey]);
const studio = collectInitialFiles([mainKey, appKey]);
const landingJs = await sizes(landing.files, ".js");
const studioJs = await sizes(studio.files, ".js");
const studioCss = await sizes(studio.css, ".css");

assertAtMost("Landing JS raw", landingJs.raw, limits.landing.rawJs);
assertAtMost("Landing JS gzip", landingJs.gzip, limits.landing.gzipJs);
assertAtMost("Studio initial JS raw", studioJs.raw, limits.studio.rawJs);
assertAtMost("Studio initial JS gzip", studioJs.gzip, limits.studio.gzipJs);
assertAtMost("Shared CSS raw", studioCss.raw, limits.sharedCss.raw);
assertAtMost("Shared CSS gzip", studioCss.gzip, limits.sharedCss.gzip);

const assetDir = path.join(distDir, "assets");
const assetNames = await readdir(assetDir);
let largestLazy = { name: "", gzip: 0 };
for (const name of assetNames) {
  if (!name.endsWith(".js")) continue;
  const relativeFile = `assets/${name}`;
  if (studio.files.has(relativeFile) || landing.files.has(relativeFile)) continue;
  const bytes = await readFile(path.join(assetDir, name));
  const gzip = gzipSync(bytes, { level: 9 }).byteLength;
  if (gzip > largestLazy.gzip) largestLazy = { name, gzip };
}
assertAtMost("Largest lazy JS chunk gzip", largestLazy.gzip, limits.largestLazyGzip);

const maps = [];
async function findMaps(directory) {
  for (const name of await readdir(directory)) {
    const absolute = path.join(directory, name);
    const info = await stat(absolute);
    if (info.isDirectory()) await findMaps(absolute);
    else if (name.endsWith(".map")) maps.push(absolute);
  }
}
await findMaps(distDir);
if (maps.length > 0) throw new Error(`Public source maps found: ${maps.join(", ")}`);

const serviceWorker = await readFile(path.join(distDir, "sw.js"), "utf8");
for (const forbidden of ["App-", "audio-vendor-", "lamejs-", "jszip.min-"]) {
  if (serviceWorker.includes(forbidden)) {
    throw new Error(`Service worker eagerly precaches lazy chunk pattern: ${forbidden}`);
  }
}
if (serviceWorker.includes(".wav")) {
  throw new Error("Service worker must not eagerly list factory WAV files in its shell precache.");
}
if (!serviceWorker.includes('/samples/factory/vcsl/')) {
  throw new Error("Service worker is missing on-demand factory instrument caching.");
}

console.log("Bundle budgets passed");
console.log(`  Landing initial JS: ${kb(landingJs.raw)} raw / ${kb(landingJs.gzip)} gzip`);
console.log(`  Studio initial JS:  ${kb(studioJs.raw)} raw / ${kb(studioJs.gzip)} gzip`);
console.log(`  Shared CSS:          ${kb(studioCss.raw)} raw / ${kb(studioCss.gzip)} gzip`);
console.log(`  Largest lazy chunk:  ${largestLazy.name} / ${kb(largestLazy.gzip)} gzip`);
