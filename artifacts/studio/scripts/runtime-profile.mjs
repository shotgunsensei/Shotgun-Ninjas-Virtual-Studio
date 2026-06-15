import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.STUDIO_PROFILE_URL ?? "http://127.0.0.1:5173";
const PLAYBACK_MINUTES = Number(process.env.STUDIO_PROFILE_MINUTES ?? "10");
const OUT_DIR = join(process.cwd(), "runtime-profile");
const RUN_ID = Date.now();
const OUT_PATH = join(OUT_DIR, `runtime-profile-${RUN_ID}.json`);
const METRICS_TIMEOUT_MS = 10_000;

mkdirSync(OUT_DIR, { recursive: true });

function wavBytes({ seconds, sampleRate = 44100, frequency = 220 }) {
  const frames = Math.floor(seconds * sampleRate);
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.25;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }
  return Array.from(bytes);
}

async function installProfileHooks(page) {
  await page.addInitScript(() => {
    window.__SN_RUNTIME_PROFILE__ = {
      longTasks: [],
      controllerChanges: 0,
    };
    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__SN_RUNTIME_PROFILE__.longTasks.push({
              name: entry.name,
              startTime: Math.round(entry.startTime),
              duration: Math.round(entry.duration),
            });
          }
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        window.__SN_RUNTIME_PROFILE__.longTaskObserverError = true;
      }
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.__SN_RUNTIME_PROFILE__.controllerChanges += 1;
      });
    }
    try {
      localStorage.setItem("studio.onboardingShown", "1");
    } catch {
      // ignore storage errors
    }
  });
}

async function browserMetrics(page, cdp) {
  const perf = await cdp.send("Performance.getMetrics");
  const metric = Object.fromEntries(perf.metrics.map((m) => [m.name, m.value]));
  const dom = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    bodyPerf: document.body.dataset.perf ?? "",
    hidden: document.hidden,
    elements: document.querySelectorAll("*").length,
    canvases: document.querySelectorAll("canvas").length,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    serviceWorkerController: !!navigator.serviceWorker?.controller,
    serviceWorkerScript:
      navigator.serviceWorker?.controller?.scriptURL ?? null,
    cacheNames:
      "caches" in window ? caches.keys().catch(() => []) : Promise.resolve([]),
    longTasks: window.__SN_RUNTIME_PROFILE__?.longTasks ?? [],
    controllerChanges: window.__SN_RUNTIME_PROFILE__?.controllerChanges ?? 0,
  }));
  return {
    jsHeapUsedMB: Number(((metric.JSHeapUsedSize ?? 0) / 1024 / 1024).toFixed(2)),
    jsHeapTotalMB: Number(((metric.JSHeapTotalSize ?? 0) / 1024 / 1024).toFixed(2)),
    nodes: metric.Nodes ?? null,
    jsEventListeners: metric.JSEventListeners ?? null,
    documents: metric.Documents ?? null,
    frames: metric.Frames ?? null,
    taskDurationSec: Number((metric.TaskDuration ?? 0).toFixed(3)),
    layoutCount: metric.LayoutCount ?? null,
    recalcStyleCount: metric.RecalcStyleCount ?? null,
    dom,
  };
}

function summarizeLongTasks(before, after) {
  const beforeCount = before?.dom?.longTasks?.length ?? 0;
  const tasks = (after?.dom?.longTasks ?? []).slice(beforeCount);
  const durations = tasks.map((t) => t.duration);
  return {
    count: tasks.length,
    maxMs: durations.length ? Math.max(...durations) : 0,
    totalMs: durations.reduce((a, b) => a + b, 0),
    top: tasks.sort((a, b) => b.duration - a.duration).slice(0, 10),
  };
}

function scenarioTimeoutMs(name) {
  if (name.includes("10-minute")) return PLAYBACK_MINUTES * 60_000 + 90_000;
  if (name.includes("wav-export")) return 180_000;
  if (name.includes("service-worker")) return 180_000;
  return 90_000;
}

function emptyMetrics(error) {
  return {
    jsHeapUsedMB: 0,
    jsHeapTotalMB: 0,
    nodes: null,
    jsEventListeners: null,
    documents: null,
    frames: null,
    taskDurationSec: 0,
    layoutCount: null,
    recalcStyleCount: null,
    dom: {
      title: "",
      url: "",
      bodyPerf: "",
      hidden: null,
      elements: 0,
      canvases: 0,
      dialogs: 0,
      serviceWorkerController: null,
      serviceWorkerScript: null,
      cacheNames: [],
      longTasks: [],
      controllerChanges: 0,
      metricsError: error?.message || String(error),
    },
  };
}

async function scenario(name, page, cdp, fn) {
  console.log(`START ${name}`);
  let before;
  const started = Date.now();
  const result = { name, status: "pass", error: null, notes: [] };
  try {
    before = await metricsWithTimeout(page, cdp, `${name}:before`);
  } catch (err) {
    before = emptyMetrics(err);
    result.status = "fail";
    result.error = err?.stack || err?.message || String(err);
    result.durationMs = Date.now() - started;
    result.before = before;
    result.after = before;
    result.delta = { jsHeapUsedMB: 0, nodes: null, jsEventListeners: null, taskDurationSec: 0 };
    result.longTasks = { count: 0, maxMs: 0, totalMs: 0, top: [] };
    console.log(`END ${name} ${result.status} ${result.durationMs}ms`);
    return result;
  }
  try {
    const timeoutMs = scenarioTimeoutMs(name);
    await Promise.race([
      fn(result),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Scenario timed out after ${timeoutMs} ms`)), timeoutMs),
      ),
    ]);
  } catch (err) {
    result.status = "fail";
    result.error = err?.stack || err?.message || String(err);
  }
  let after;
  try {
    after = await metricsWithTimeout(page, cdp, `${name}:after`);
  } catch (err) {
    result.status = "fail";
    result.error = `${result.error ? `${result.error}\n` : ""}${err?.stack || err?.message || String(err)}`;
    after = before;
  }
  result.durationMs = Date.now() - started;
  result.before = before;
  result.after = after;
  result.delta = {
    jsHeapUsedMB: Number((after.jsHeapUsedMB - before.jsHeapUsedMB).toFixed(2)),
    nodes: after.nodes != null && before.nodes != null ? after.nodes - before.nodes : null,
    jsEventListeners:
      after.jsEventListeners != null && before.jsEventListeners != null
        ? after.jsEventListeners - before.jsEventListeners
        : null,
    taskDurationSec: Number((after.taskDurationSec - before.taskDurationSec).toFixed(3)),
  };
  result.longTasks = summarizeLongTasks(before, after);
  console.log(`END ${name} ${result.status} ${result.durationMs}ms`);
  return result;
}

async function metricsWithTimeout(page, cdp, label) {
  return Promise.race([
    browserMetrics(page, cdp),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Metrics collection timed out for ${label}`)), METRICS_TIMEOUT_MS),
    ),
  ]);
}

async function clickMaybe(page, locator, timeout = 2_000) {
  try {
    await locator.first().click({ timeout, noWaitAfter: true });
    return true;
  } catch {
    return false;
  }
}

async function openStudio(page) {
  await page.goto(`${BASE_URL}/studio`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("header", { timeout: 30_000 });
}

async function loadDemo(page, id) {
  await page.getByTestId("open-load-dialog").click({ noWaitAfter: true });
  await page.getByTestId("demo-list").waitFor({ timeout: 10_000 });
  await page.getByTestId(`demo-load-${id}`).click({ noWaitAfter: true });
  await page.getByTestId("demo-list").waitFor({ state: "hidden", timeout: 20_000 });
}

async function enableAudio(page) {
  await clickMaybe(page, page.getByRole("button", { name: /tap to enable audio/i }), 45_000);
  await page.waitForTimeout(1_000);
}

async function playPauseStopPanic(page) {
  await page.getByRole("button", { name: /^play$/i }).click({ noWaitAfter: true });
  await page.waitForTimeout(1_000);
  await page.getByRole("button", { name: /^pause$/i }).click({ noWaitAfter: true });
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /^play$/i }).click({ noWaitAfter: true });
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /^stop$/i }).click({ noWaitAfter: true });
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /panic/i }).click({ noWaitAfter: true });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^play$/i }).click({ noWaitAfter: true });
  await page.waitForTimeout(1_500);
}

async function toggleMixer(page, count) {
  for (let i = 0; i < count; i++) {
    const hidden = await clickMaybe(page, page.getByRole("button", { name: /hide mixer/i }), 1_000);
    if (!hidden) await clickMaybe(page, page.getByRole("button", { name: /show mixer/i }), 1_000);
    await page.waitForTimeout(150);
  }
  await clickMaybe(page, page.getByRole("button", { name: /show mixer/i }), 1_000);
}

async function toggleMuteSolo(page, count) {
  const strips = page.locator('[data-testid^="channel-strip-"]');
  const stripCount = await strips.count();
  for (let i = 0; i < count && stripCount > 0; i++) {
    const strip = strips.nth(i % stripCount);
    await strip.locator("button", { hasText: /^M$/ }).click();
    await page.waitForTimeout(80);
    await strip.locator("button", { hasText: /^S$/ }).click();
    await page.waitForTimeout(80);
  }
}

async function switchPresets(page, count) {
  await clickMaybe(page, page.getByRole("button", { name: /show mixer/i }), 1_000);
  const strip = page.locator('[data-testid^="channel-strip-"]').filter({ hasText: /piano|bass|guitar/i }).first();
  await strip.click({ timeout: 5_000 });
  const loadButtons = page.locator("button", { hasText: /^Load$/ });
  const available = await loadButtons.count();
  if (available === 0) throw new Error("No preset Load buttons available");
  for (let i = 0; i < count; i++) {
    const idx = i % Math.min(available, 8);
    await loadButtons.nth(idx).click();
    await page.waitForTimeout(250);
  }
}

async function importSample(page, bytes, name) {
  await page.evaluate(
    ({ bytes, name }) => {
      const file = new File([new Uint8Array(bytes)], name, { type: "audio/wav" });
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    { bytes, name },
  );
  await page.getByRole("dialog", { name: /import sample/i }).waitFor({ timeout: 20_000 });
}

async function saveSampleDialog(page) {
  await clickMaybe(page, page.getByRole("button", { name: /save sample/i }), 15_000);
  await page.waitForTimeout(2_000);
}

async function exportProjectJson(page) {
  await page.getByRole("button", { name: /export/i }).click();
  await page.getByTestId("export-project-only").waitFor({ timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    page.getByTestId("export-project-only").click(),
  ]);
  const path = await download.path();
  return path;
}

async function exportWav(page) {
  await page.getByRole("button", { name: /export/i }).click();
  await page.getByTestId("export-wav").waitFor({ timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    page.getByTestId("export-wav").click(),
  ]);
  return download.path();
}

async function importProjectJson(page, filePath) {
  await page.getByRole("button", { name: /export/i }).click();
  await page.getByTestId("import-from-disk").waitFor({ timeout: 10_000 });
  await page.getByTestId("import-from-disk").click();
  await page.locator('input[accept="application/json,.json"]').setInputFiles(filePath);
  await page.getByTestId("import-summary").waitFor({ timeout: 20_000 });
  await page.getByTestId("import-summary-confirm").click();
  await page.waitForTimeout(2_000);
}

async function malformedJsonImport(page) {
  const badPath = join(OUT_DIR, "malformed.snproj.json");
  writeFileSync(badPath, "{ bad json", "utf8");
  await page.getByRole("button", { name: /export/i }).click();
  await page.getByTestId("import-from-disk").waitFor({ timeout: 10_000 });
  await page.getByTestId("import-from-disk").click();
  await page.locator('input[accept="application/json,.json"]').setInputFiles(badPath);
  await page.waitForTimeout(2_000);
}

async function serviceWorkerUpdateSimulation(page, result) {
  const beforeCaches = await page.evaluate(() => caches.keys());
  execFileSync("npm.cmd", ["run", "build"], { cwd: process.cwd(), stdio: "pipe" });
  const update = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { registered: false };
    await reg.update();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    return {
      registered: true,
      hasController: !!navigator.serviceWorker.controller,
      installing: reg.installing?.state ?? null,
      waiting: reg.waiting?.state ?? null,
      active: reg.active?.state ?? null,
      controllerChanges: window.__SN_RUNTIME_PROFILE__?.controllerChanges ?? 0,
      caches: await caches.keys(),
    };
  });
  result.notes.push({ beforeCaches, update });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await installProfileHooks(page);

  const consoleMessages = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => pageErrors.push(err.stack || err.message));

  const results = [];
  const browserVersion = await browser.version();
  const writeSummary = () => {
    const partial = {
      date: new Date().toISOString(),
      browser: browserVersion,
      productionPreviewUrl: BASE_URL,
      playbackMinutes: PLAYBACK_MINUTES,
      consoleMessages,
      pageErrors,
      scenarios: results,
    };
    writeFileSync(OUT_PATH, JSON.stringify(partial, null, 2));
  };

  results.push(await scenario("cold-load", page, cdp, async () => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body", { timeout: 15_000 });
    await openStudio(page);
  }));
  writeSummary();

  results.push(await scenario("audio-startup-panic-replay", page, cdp, async (r) => {
    await enableAudio(page);
    await playPauseStopPanic(page);
    r.notes.push("Headless Chromium can verify transport UI and post-panic replay state, not actual speaker audibility.");
  }));
  writeSummary();

  results.push(await scenario("load-trap-and-10-minute-playback-mixer-scope", page, cdp, async (r) => {
    await loadDemo(page, "trap-starter");
    await enableAudio(page);
    await page.getByRole("button", { name: /^play$/i }).click();
    await clickMaybe(page, page.getByRole("button", { name: /show mixer/i }), 1_000);
    await clickMaybe(page, page.getByRole("button", { name: /toggle audio diagnostics panel/i }), 2_000);
    const checkpoints = Math.max(1, Math.floor(PLAYBACK_MINUTES * 2));
    for (let i = 0; i < checkpoints; i++) {
      await page.waitForTimeout((PLAYBACK_MINUTES * 60_000) / checkpoints);
      const snap = await browserMetrics(page, cdp);
      r.notes.push({
        minute: Number((((i + 1) * PLAYBACK_MINUTES) / checkpoints).toFixed(1)),
        heapMB: snap.jsHeapUsedMB,
        nodes: snap.nodes,
        listeners: snap.jsEventListeners,
        longTasks: snap.dom.longTasks.length,
      });
    }
  }));
  writeSummary();

  results.push(await scenario("mixer-stress", page, cdp, async () => {
    await toggleMixer(page, 20);
    await toggleMuteSolo(page, 20);
  }));
  writeSummary();

  results.push(await scenario("visualizer-performance-mode-stress", page, cdp, async () => {
    await clickMaybe(page, page.getByRole("button", { name: /toggle audio diagnostics panel/i }), 2_000);
    await clickMaybe(page, page.getByRole("button", { name: /toggle audio diagnostics panel/i }), 2_000);
    await page.getByRole("button", { name: /toggle performance mode/i }).click();
    await page.waitForTimeout(1_000);
    await page.getByRole("button", { name: /toggle performance mode/i }).click();
    await page.waitForTimeout(1_000);
  }));
  writeSummary();

  results.push(await scenario("repeated-preset-switching", page, cdp, async () => {
    await switchPresets(page, 20);
  }));
  writeSummary();

  results.push(await scenario("repeated-project-load-unload", page, cdp, async () => {
    const ids = ["trap-starter", "boom-bap-dojo", "cyber-ninja", "lofi-smoke-loop"];
    for (let i = 0; i < 20; i++) {
      await loadDemo(page, ids[i % ids.length]);
      await page.waitForTimeout(200);
    }
  }));
  writeSummary();

  results.push(await scenario("sample-import-small-and-large", page, cdp, async (r) => {
    await importSample(page, wavBytes({ seconds: 1 }), "runtime-small.wav");
    await saveSampleDialog(page);
    await importSample(page, wavBytes({ seconds: 30 }), "runtime-large.wav");
    await saveSampleDialog(page);
    r.notes.push("Large sample is generated locally as 30 seconds mono WAV, about 2.6 MB, below the app's 20 MB warning threshold.");
  }));
  writeSummary();

  results.push(await scenario("save-load-autosave", page, cdp, async (r) => {
    await page.keyboard.press("s");
    await page.waitForTimeout(9_500);
    await page.getByTestId("project-name-input").fill(`Runtime Profile ${Date.now()}`);
    await page.waitForTimeout(9_500);
    await page.getByTestId("open-load-dialog").click();
    await page.getByTestId("demo-list").waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    r.notes.push("Autosave behavior inferred from no freeze/console errors; production diagnostics counters are not exposed.");
  }));
  writeSummary();

  let exportedJsonPath = null;
  results.push(await scenario("json-export-import-and-malformed-json", page, cdp, async () => {
    exportedJsonPath = await exportProjectJson(page);
    await importProjectJson(page, exportedJsonPath);
    await malformedJsonImport(page);
  }));
  writeSummary();

  results.push(await scenario("wav-export-default-and-demo", page, cdp, async (r) => {
    const defaultPath = await exportWav(page);
    r.notes.push({ defaultPath });
    await loadDemo(page, "trap-starter");
    const demoPath = await exportWav(page);
    r.notes.push({ demoPath });
  }));
  writeSummary();

  results.push(await scenario("service-worker-cache-update-simulation", page, cdp, async (r) => {
    await serviceWorkerUpdateSimulation(page, r);
  }));
  writeSummary();

  const summary = {
    date: new Date().toISOString(),
    browser: browserVersion,
    productionPreviewUrl: BASE_URL,
    playbackMinutes: PLAYBACK_MINUTES,
    consoleMessages,
    pageErrors,
    scenarios: results,
  };
  writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(OUT_PATH);

  await browser.close();

  const failed = results.filter((r) => r.status !== "pass");
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
