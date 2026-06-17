import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.STUDIO_PROFILE_URL ?? "http://127.0.0.1:5173";
const PLAYBACK_MINUTES = Number(process.env.STUDIO_PROFILE_MINUTES ?? "10");
const MATRIX_ONLY = process.env.STUDIO_PROFILE_MATRIX_ONLY === "1";
const FRESH_TRAP_ONLY = process.env.STUDIO_PROFILE_FRESH_TRAP_ONLY === "1";
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
    firstPlayTrace: window.__SN_FIRST_PLAY_TRACE__?.dump?.() ?? [],
    firstPlayFlags: window.__SN_FIRST_PLAY_TRACE__?.flags?.() ?? null,
    listenerTrace: window.__SN_LISTENER_TRACE__?.snapshot?.() ?? null,
    audioNodeTrace: window.__SN_AUDIO_NODE_TRACE__?.snapshot?.() ?? null,
    audioEngineStatus: window.__SN_AUDIO_ENGINE_STATUS__?.voiceModes?.() ?? null,
    overlays: Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog, [data-radix-portal], .modal, .overlay'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role"),
        testId: el.getAttribute("data-testid"),
        ariaLabel: el.getAttribute("aria-label"),
        text: (el.textContent ?? "").replace(/\s+/g, " ").slice(0, 160),
      }))
      .slice(0, 10),
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
      firstPlayTrace: [],
      firstPlayFlags: null,
      listenerTrace: null,
      audioNodeTrace: null,
      audioEngineStatus: null,
      overlays: [],
      metricsError: error?.message || String(error),
    },
  };
}

function audioNodeDelta(before, after, field) {
  return (after.dom.audioNodeTrace?.[field] ?? 0) - (before.dom.audioNodeTrace?.[field] ?? 0);
}

function audioNodeMapDelta(before, after, mapName, key) {
  return (after.dom.audioNodeTrace?.[mapName]?.[key] ?? 0) - (before.dom.audioNodeTrace?.[mapName]?.[key] ?? 0);
}

function audioNodeCounterDelta(before, after, key) {
  return (after.dom.audioNodeTrace?.[key] ?? 0) - (before.dom.audioNodeTrace?.[key] ?? 0);
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
    await prepareScenarioUi(page, result, `${name}:before`);
    await Promise.race([
      fn(result),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Scenario timed out after ${timeoutMs} ms`)), timeoutMs),
      ),
    ]);
  } catch (err) {
    result.status = "fail";
    result.error = err?.stack || err?.message || String(err);
    await captureFailureState(page, result, name).catch(() => {});
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
    visualTickerSubscribers:
      (after.dom.listenerTrace?.byLabel?.visualTicker ?? 0) -
      (before.dom.listenerTrace?.byLabel?.visualTicker ?? 0),
    storeSubscriptions:
      (after.dom.listenerTrace?.byLabel?.["store.subscribe"] ?? 0) -
      (before.dom.listenerTrace?.byLabel?.["store.subscribe"] ?? 0),
    transportEvents:
      (after.dom.listenerTrace?.activeTransportEvents ?? 0) -
      (before.dom.listenerTrace?.activeTransportEvents ?? 0),
    traceActiveTotal:
      (after.dom.listenerTrace?.activeTotal ?? 0) -
      (before.dom.listenerTrace?.activeTotal ?? 0),
    audioWorkletNodes: audioNodeDelta(before, after, "activeAudioWorkletNodes"),
    audioConstantSourceNodes: audioNodeDelta(before, after, "activeConstantSourceNodes"),
    audioSourceNodes: audioNodeDelta(before, after, "activeSourceNodes"),
    audioAnalyzers: audioNodeDelta(before, after, "activeAnalyzers"),
    audioTrackVoices: audioNodeDelta(before, after, "activeTrackVoices"),
    audioScheduledPlayers: audioNodeDelta(before, after, "activeScheduledPlayers"),
    audioTransportEvents: audioNodeDelta(before, after, "activeTransportEvents"),
    constantSourceCreates: audioNodeMapDelta(before, after, "nodeCreates", "ConstantSourceNode"),
    gainNodeCreates: audioNodeMapDelta(before, after, "nodeCreates", "GainNode"),
    bufferSourceCreates: audioNodeMapDelta(before, after, "nodeCreates", "AudioBufferSourceNode"),
    oscillatorCreates: audioNodeMapDelta(before, after, "nodeCreates", "OscillatorNode"),
    leanDrumHitsScheduled: audioNodeCounterDelta(before, after, "leanDrumHitsScheduled"),
    leanDrumHitsTriggered: audioNodeCounterDelta(before, after, "leanDrumHitsTriggered"),
    leanOneShotSourcesCreated: audioNodeCounterDelta(before, after, "leanOneShotSourcesCreated"),
    leanOneShotSourcesEnded: audioNodeCounterDelta(before, after, "leanOneShotSourcesEnded"),
    leanOneShotSourcesDisconnected: audioNodeCounterDelta(before, after, "leanOneShotSourcesDisconnected"),
    leanOneShotSourcesActive: after.dom.audioNodeTrace?.leanOneShotSourcesActive ?? null,
    voiceModes: after.dom.audioEngineStatus?.counts ?? null,
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

async function togglePerformanceMode(page) {
  const locator = page.getByRole("button", { name: /toggle performance mode/i });
  if (await clickMaybe(page, locator, 5_000)) return true;
  return page.evaluate(() => {
    const button = Array.from(document.querySelectorAll("button")).find((el) =>
      /toggle performance mode/i.test(el.getAttribute("aria-label") ?? ""),
    );
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  }).catch(() => false);
}

async function dismissBlockingOverlays(page) {
  await clickMaybe(page, page.getByRole("button", { name: /^skip$/i }), 2_000);
  await clickMaybe(page, page.getByRole("button", { name: /^close$/i }), 2_000);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
}

async function visibleOverlaySummary(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog, [data-radix-portal], .modal, .overlay'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role"),
        testId: el.getAttribute("data-testid"),
        ariaLabel: el.getAttribute("aria-label"),
        text: (el.textContent ?? "").replace(/\s+/g, " ").slice(0, 180),
      }))
      .slice(0, 12),
  );
}

async function prepareScenarioUi(page, result, label) {
  if (page.isClosed()) return;
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(150).catch(() => {});
  const overlays = await visibleOverlaySummary(page).catch(() => []);
  if (overlays.length) {
    result.notes.push({ uiState: { label, overlays } });
  }
}

async function captureFailureState(page, result, name) {
  const safeName = name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  const screenshotPath = join(OUT_DIR, `${safeName}-${RUN_ID}-failure.png`);
  const domSummary = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    activeElement: {
      tag: document.activeElement?.tagName ?? null,
      text: (document.activeElement?.textContent ?? "").replace(/\s+/g, " ").slice(0, 160),
      ariaLabel: document.activeElement?.getAttribute("aria-label") ?? null,
      testId: document.activeElement?.getAttribute("data-testid") ?? null,
    },
    overlays: Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog, [data-radix-portal], .modal, .overlay'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role"),
        testId: el.getAttribute("data-testid"),
        ariaLabel: el.getAttribute("aria-label"),
        text: (el.textContent ?? "").replace(/\s+/g, " ").slice(0, 260),
      }))
      .slice(0, 12),
    buttons: Array.from(document.querySelectorAll("button"))
      .map((button) => ({
        text: (button.textContent ?? "").replace(/\s+/g, " ").slice(0, 80),
        ariaLabel: button.getAttribute("aria-label"),
        testId: button.getAttribute("data-testid"),
        disabled: button.hasAttribute("disabled"),
      }))
      .slice(0, 80),
  }));
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  result.notes.push({ failureState: { screenshotPath, domSummary } });
}

async function captureListenerTrace(page, result, label) {
  const snapshot = await page.evaluate((snapLabel) => ({
    label: snapLabel,
    at: Math.round(performance.now()),
    snapshot: window.__SN_LISTENER_TRACE__?.snapshot?.() ?? null,
  }), label);
  result.notes.push({ listenerTrace: snapshot });
  return snapshot;
}

async function captureAudioNodeTrace(page, result, label) {
  const snapshot = await page.evaluate((snapLabel) => ({
    label: snapLabel,
    at: Math.round(performance.now()),
    snapshot: window.__SN_AUDIO_NODE_TRACE__?.snapshot?.() ?? null,
    voiceModes: window.__SN_AUDIO_ENGINE_STATUS__?.voiceModes?.() ?? null,
    topStacks: window.__SN_AUDIO_NODE_TRACE__?.dumpTopStacks?.(10) ?? [],
  }), label);
  result.notes.push({ audioNodeTrace: snapshot });
  return snapshot;
}

async function openStudio(page, query = "") {
  await page.goto(`${BASE_URL}/studio${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("header", { timeout: 30_000 });
  await page.evaluate(() => window.__SN_LISTENER_TRACE__?.start?.()).catch(() => undefined);
  await page.evaluate(() => window.__SN_AUDIO_NODE_TRACE__?.start?.()).catch(() => undefined);
}

async function clearBrowserState(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.evaluate(async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("studio.onboardingShown", "1");
    } catch {
      // ignore
    }
    try {
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
    } catch {
      // ignore
    }
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs ?? []).map((reg) => reg.unregister()));
    } catch {
      // ignore
    }
  }).catch(() => {});
}

async function freshTrapStarterLeanValidation(page, cdp, result) {
  await clearBrowserState(page);
  await openStudio(
    page,
    "?snListenerTrace=1&snAudioNodeTrace=1&snFirstPlayTrace=1&snLeanDrumValidation=1",
  );
  await captureAudioNodeTrace(page, result, "fresh-trap:loaded");
  await enableAudio(page);
  await captureAudioNodeTrace(page, result, "fresh-trap:after-enable");
  await loadDemo(page, "trap-starter");
  await captureAudioNodeTrace(page, result, "fresh-trap:after-load");
  await page.getByRole("button", { name: /^play$/i }).click({ noWaitAfter: true });
  await page.waitForTimeout(750);
  await clickMaybe(page, page.getByRole("button", { name: /^stop$/i }), 5_000);
  await page.waitForTimeout(1_250);
  await captureAudioNodeTrace(page, result, "fresh-trap:after-arm-and-schedule");
  await page.getByRole("button", { name: /^play$/i }).click({ noWaitAfter: true });
  await page.waitForTimeout(2_000);
  const duringPlay = await captureAudioNodeTrace(page, result, "fresh-trap:during-play");
  const metricsDuringPlay = await browserMetrics(page, cdp);
  result.notes.push({
    freshTrapDuringPlayMetrics: {
      heapMB: metricsDuringPlay.jsHeapUsedMB,
      nodes: metricsDuringPlay.nodes,
      listeners: metricsDuringPlay.jsEventListeners,
      longTasks: metricsDuringPlay.dom.longTasks.length,
      overlays: metricsDuringPlay.dom.overlays,
    },
  });
  await clickMaybe(page, page.getByRole("button", { name: /^stop$/i }), 5_000);
  await page.waitForTimeout(1_500);
  const afterStop = await captureAudioNodeTrace(page, result, "fresh-trap:after-stop-idle");
  const counts = duringPlay.voiceModes?.counts ?? {};
  const trace = duringPlay.snapshot ?? {};
  const cleanupTrace = afterStop.snapshot ?? {};
  const failures = [];
  if ((counts.lean ?? 0) <= 0) failures.push("voiceModes.lean was not > 0 during Trap Starter playback");
  if ((trace.leanDrumHitsTriggered ?? 0) <= 0) failures.push("leanDrumHitsTriggered did not increase");
  if ((trace.leanOneShotSourcesCreated ?? 0) <= 0) failures.push("leanOneShotSourcesCreated did not increase");
  if ((trace.nodeCreates?.ConstantSourceNode ?? 0) > 5) failures.push("ConstantSourceNode creates exceeded near-zero target");
  if ((trace.activeAudioWorkletNodes ?? 0) !== 0) failures.push("AudioWorkletNode was created by default");
  if ((cleanupTrace.leanOneShotSourcesActive ?? 0) !== 0) failures.push("lean one-shot sources remained active after stop/idle");
  result.notes.push({
    freshTrapAssertions: {
      counts,
      leanDrumHitsScheduled: trace.leanDrumHitsScheduled ?? 0,
      leanDrumHitsTriggered: trace.leanDrumHitsTriggered ?? 0,
      leanOneShotSourcesCreated: trace.leanOneShotSourcesCreated ?? 0,
      leanOneShotSourcesEnded: trace.leanOneShotSourcesEnded ?? 0,
      leanOneShotSourcesDisconnected: trace.leanOneShotSourcesDisconnected ?? 0,
      leanOneShotSourcesActiveAfterStop: cleanupTrace.leanOneShotSourcesActive ?? null,
      activeAudioWorkletNodes: trace.activeAudioWorkletNodes ?? null,
      constantSourceCreates: trace.nodeCreates?.ConstantSourceNode ?? 0,
      gainNodeCreates: trace.nodeCreates?.GainNode ?? 0,
      failures,
    },
  });
  if (failures.length) throw new Error(`Fresh Trap Starter lean validation failed: ${failures.join("; ")}`);
}

async function firstPlayProbe(page, result) {
  await enableAudio(page);
  const enableSnap = await page.evaluate(() => ({
    audioButtonVisible: !!document.querySelector('button[aria-label="Play"]'),
    trace: window.__SN_FIRST_PLAY_TRACE__?.dump?.() ?? [],
  }));
  result.notes.push({ enableAudio: enableSnap });

  const playClickReturned = await clickMaybe(page, page.locator('button[aria-label="Play"]'), 10_000);
  await page.waitForTimeout(1_500);
  const pauseAppears = await page.locator('button[aria-label="Pause"]').count().then((n) => n > 0).catch(() => false);
  const state = await page.evaluate(() => ({
    pauseAppears: !!document.querySelector('button[aria-label="Pause"]'),
    playAppears: !!document.querySelector('button[aria-label="Play"]'),
    trace: window.__SN_FIRST_PLAY_TRACE__?.dump?.() ?? [],
  }));
  result.notes.push({
    playClickReturned,
    pauseAppears,
    domState: state,
    ensureTrackDuringPlay: state.trace.filter((e) => e.phase === "ensureTrack:enter" && e.detail?.duringPlay),
    buildVoiceDuringPlay: state.trace.filter((e) => e.phase === "buildVoice:enter"),
  });
  if (!playClickReturned) throw new Error("Play click did not return");
  if (!pauseAppears && !state.pauseAppears) throw new Error("Pause did not appear after Play");
}

async function loadDemo(page, id) {
  await page.getByTestId("open-load-dialog").click({ noWaitAfter: true });
  await page.getByTestId("demo-list").waitFor({ timeout: 10_000 });
  await page.getByTestId(`demo-load-${id}`).click({ noWaitAfter: true });
  await page.getByTestId("demo-list").waitFor({ state: "hidden", timeout: 20_000 });
}

async function resetStudioScenario(page, demoId = "trap-starter") {
  await openStudio(page, "?snListenerTrace=1&snAudioNodeTrace=1");
  await prepareScenarioUi(page, { notes: [] }, "scenario-reset");
  if (demoId) await loadDemo(page, demoId);
  await enableAudio(page);
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

async function toggleMixer(page, count, result) {
  if (result) await captureListenerTrace(page, result, "mixer:before-cycles");
  for (let i = 0; i < count; i++) {
    const hidden = await clickMaybe(page, page.getByRole("button", { name: /hide mixer/i }), 1_000);
    if (!hidden) await clickMaybe(page, page.getByRole("button", { name: /show mixer/i }), 1_000);
    if (result && [0, 4, 19].includes(i)) {
      await captureListenerTrace(page, result, `mixer:after-toggle-${i + 1}`);
    }
    await page.waitForTimeout(150);
  }
  await clickMaybe(page, page.getByRole("button", { name: /show mixer/i }), 1_000);
  if (result) await captureListenerTrace(page, result, "mixer:after-open");
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
  await dismissBlockingOverlays(page);
  return path;
}

async function exportWav(page) {
  await page.getByRole("button", { name: /export/i }).click();
  await page.getByTestId("export-wav").waitFor({ timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    page.getByTestId("export-wav").click(),
  ]);
  const path = await download.path();
  await dismissBlockingOverlays(page);
  return path;
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
  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/c", "npm", "run", "build"], { cwd: process.cwd(), stdio: "pipe" });
  } else {
    execFileSync("npm", ["run", "build"], { cwd: process.cwd(), stdio: "pipe" });
  }
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

  const firstPlayMatrix = [
    ["first-play-baseline", "?snFirstPlayTrace=1"],
    ["first-play-no-project-schedules", "?snFirstPlayTrace=1&snDisableProjectSchedules=1"],
    ["first-play-no-transport-callbacks", "?snFirstPlayTrace=1&snDisableTransportCallbacks=1"],
    ["first-play-no-graph-build-during-play", "?snFirstPlayTrace=1&snDisableGraphBuildOnPlay=1"],
    ["first-play-minimal-audio-graph", "?snFirstPlayTrace=1&snUseMinimalAudioGraph=1"],
    ["first-play-no-world-audio", "?snFirstPlayTrace=1&snDisableWorldAudio=1"],
    ["first-play-no-analyzers", "?snFirstPlayTrace=1&snDisableAnalyzers=1"],
  ];

  if (FRESH_TRAP_ONLY) {
    results.push(await scenario("fresh-trap-starter-lean-validation", page, cdp, async (r) => {
      await freshTrapStarterLeanValidation(page, cdp, r);
    }));
    writeSummary();
    console.log(OUT_PATH);
    await browser.close();
    if (results.some((r) => r.status !== "pass")) process.exitCode = 1;
    return;
  }

  for (const [name, query] of firstPlayMatrix) {
    const matrixPage = await context.newPage();
    const matrixCdp = await context.newCDPSession(matrixPage);
    await matrixCdp.send("Performance.enable");
    await installProfileHooks(matrixPage);
    matrixPage.on("console", (msg) => {
      if (["error", "warning"].includes(msg.type())) {
        consoleMessages.push({ type: msg.type(), text: `[${name}] ${msg.text()}` });
      }
    });
    matrixPage.on("pageerror", (err) =>
      pageErrors.push(`[${name}] ${err.stack || err.message}`),
    );
    results.push(await scenario(name, matrixPage, matrixCdp, async (r) => {
      await openStudio(matrixPage, query);
      await firstPlayProbe(matrixPage, r);
    }));
    await matrixPage.close().catch(() => {});
    writeSummary();
  }

  if (MATRIX_ONLY) {
    console.log(OUT_PATH);
    await browser.close();
    return;
  }

  results.push(await scenario("cold-load", page, cdp, async () => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body", { timeout: 15_000 });
    await openStudio(page, "?snListenerTrace=1&snAudioNodeTrace=1");
  }));
  writeSummary();

  results.push(await scenario("audio-startup-panic-replay", page, cdp, async (r) => {
    await captureAudioNodeTrace(page, r, "audio-startup:before-enable");
    await enableAudio(page);
    await captureAudioNodeTrace(page, r, "audio-startup:after-enable");
    await playPauseStopPanic(page);
    await captureAudioNodeTrace(page, r, "audio-startup:after-panic-replay");
    r.notes.push("Headless Chromium can verify transport UI and post-panic replay state, not actual speaker audibility.");
  }));
  writeSummary();

  results.push(await scenario("load-trap-and-10-minute-playback-mixer-scope", page, cdp, async (r) => {
    await captureAudioNodeTrace(page, r, "trap-starter:before-load");
    await loadDemo(page, "trap-starter");
    await captureAudioNodeTrace(page, r, "trap-starter:after-load");
    await enableAudio(page);
    await page.getByRole("button", { name: /^play$/i }).click();
    await captureAudioNodeTrace(page, r, "trap-starter:after-play");
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
        audioNodeTrace: snap.dom.audioNodeTrace
          ? {
              activeTrackVoices: snap.dom.audioNodeTrace.activeTrackVoices,
              activeScheduledPlayers: snap.dom.audioNodeTrace.activeScheduledPlayers,
              activeTransportEvents: snap.dom.audioNodeTrace.activeTransportEvents,
              activeAudioWorkletNodes: snap.dom.audioNodeTrace.activeAudioWorkletNodes,
              constantSourceCreates: snap.dom.audioNodeTrace.nodeCreates?.ConstantSourceNode ?? 0,
              gainNodeCreates: snap.dom.audioNodeTrace.nodeCreates?.GainNode ?? 0,
              voiceModes: snap.dom.audioEngineStatus?.counts ?? null,
            }
          : null,
      });
    }
  }));
  writeSummary();

  results.push(await scenario("mixer-stress", page, cdp, async (r) => {
    await captureListenerTrace(page, r, "mixer:before-stress");
    await captureAudioNodeTrace(page, r, "mixer:before-stress");
    await toggleMixer(page, 20, r);
    await toggleMuteSolo(page, 20);
    await captureListenerTrace(page, r, "mixer:after-mute-solo");
    await captureAudioNodeTrace(page, r, "mixer:after-mute-solo");
    await clickMaybe(page, page.getByRole("button", { name: /hide mixer/i }), 1_000);
    await page.waitForTimeout(5_000);
    await captureListenerTrace(page, r, "mixer:after-close-idle");
    await captureAudioNodeTrace(page, r, "mixer:after-close-idle");
  }));
  writeSummary();

  results.push(await scenario("visualizer-performance-mode-stress", page, cdp, async (r) => {
    await resetStudioScenario(page, "trap-starter");
    await captureListenerTrace(page, r, "visualizer:before-stress");
    await captureAudioNodeTrace(page, r, "visualizer:before-stress");
    await clickMaybe(page, page.getByRole("button", { name: /toggle audio diagnostics panel/i }), 2_000);
    await captureListenerTrace(page, r, "visualizer:after-open");
    await captureAudioNodeTrace(page, r, "visualizer:after-open");
    await clickMaybe(page, page.getByRole("button", { name: /toggle audio diagnostics panel/i }), 2_000);
    await page.waitForTimeout(1_000);
    await captureListenerTrace(page, r, "visualizer:after-close");
    await captureAudioNodeTrace(page, r, "visualizer:after-close");
    if (!(await togglePerformanceMode(page))) {
      throw new Error("Performance Mode toggle unavailable after visualizer close");
    }
    await page.waitForTimeout(1_000);
    await captureListenerTrace(page, r, "visualizer:perf-on");
    if (!(await togglePerformanceMode(page))) {
      throw new Error("Performance Mode toggle unavailable for reset");
    }
    await page.waitForTimeout(1_000);
    await captureListenerTrace(page, r, "visualizer:perf-off");
  }));
  writeSummary();

  results.push(await scenario("repeated-preset-switching", page, cdp, async (r) => {
    await resetStudioScenario(page, "trap-starter");
    await captureAudioNodeTrace(page, r, "preset-switch:before");
    await switchPresets(page, 20);
    await captureAudioNodeTrace(page, r, "preset-switch:after");
  }));
  writeSummary();

  results.push(await scenario("repeated-project-load-unload", page, cdp, async (r) => {
    await resetStudioScenario(page, null);
    const ids = ["trap-starter", "boom-bap-dojo", "cyber-ninja", "lofi-smoke-loop"];
    for (let i = 0; i < 20; i++) {
      await loadDemo(page, ids[i % ids.length]);
      if ([0, 4, 9, 19].includes(i)) {
        await captureListenerTrace(page, r, `project-load:after-${i + 1}`);
        await captureAudioNodeTrace(page, r, `project-load:after-${i + 1}`);
      }
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(5_000);
    await captureListenerTrace(page, r, "project-load:after-idle");
    await captureAudioNodeTrace(page, r, "project-load:after-idle");
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
    await resetStudioScenario(page, "trap-starter");
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
    await resetStudioScenario(page, "trap-starter");
    exportedJsonPath = await exportProjectJson(page);
    await importProjectJson(page, exportedJsonPath);
    await malformedJsonImport(page);
  }));
  writeSummary();

  results.push(await scenario("wav-export-default-and-demo", page, cdp, async (r) => {
    await resetStudioScenario(page, "trap-starter");
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
  console.table(results.map((r) => ({
    scenario: r.name,
    status: r.status,
    durationMs: r.durationMs,
    largestLongTaskMs: r.longTasks?.maxMs ?? 0,
    totalLongTaskMs: r.longTasks?.totalMs ?? 0,
    heapDeltaMB: r.delta?.jsHeapUsedMB ?? null,
    domNodesDelta: r.delta?.nodes ?? null,
    jsListenersDelta: r.delta?.jsEventListeners ?? null,
    traceActiveDelta: r.delta?.traceActiveTotal ?? null,
    visualTickerDelta: r.delta?.visualTickerSubscribers ?? null,
    transportEventsDelta: r.delta?.transportEvents ?? null,
    audioWorkletNodesDelta: r.delta?.audioWorkletNodes ?? null,
    activeTrackVoicesDelta: r.delta?.audioTrackVoices ?? null,
    scheduledPlayersDelta: r.delta?.audioScheduledPlayers ?? null,
    audioTransportDelta: r.delta?.audioTransportEvents ?? null,
    constantSourceCreatesDelta: r.delta?.constantSourceCreates ?? null,
    gainNodeCreatesDelta: r.delta?.gainNodeCreates ?? null,
    leanHitsScheduledDelta: r.delta?.leanDrumHitsScheduled ?? null,
    leanHitsTriggeredDelta: r.delta?.leanDrumHitsTriggered ?? null,
    leanSourcesCreatedDelta: r.delta?.leanOneShotSourcesCreated ?? null,
    leanSourcesEndedDelta: r.delta?.leanOneShotSourcesEnded ?? null,
    leanSourcesDisconnectedDelta: r.delta?.leanOneShotSourcesDisconnected ?? null,
    leanSourcesActive: r.delta?.leanOneShotSourcesActive ?? null,
    voiceModes: r.delta?.voiceModes ? JSON.stringify(r.delta.voiceModes) : null,
  })));
  console.log(OUT_PATH);

  await browser.close();

  const failed = results.filter((r) => r.status !== "pass");
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
