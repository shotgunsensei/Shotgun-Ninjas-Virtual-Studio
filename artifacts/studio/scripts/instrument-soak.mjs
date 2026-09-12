// Opt-in real-time regression: node scripts/instrument-soak.mjs
// Uses installed Chrome and a separate Vite port/cache; writes ignored runtime-profile evidence.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const studioRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const durationSeconds = Number(process.env.STUDIO_SOAK_SECONDS ?? 600);
assert.ok(Number.isFinite(durationSeconds) && durationSeconds >= 10);
const port = Number(process.env.STUDIO_SOAK_PORT ?? 5182);
const output = resolve(studioRoot, "runtime-profile", "instrument-soak");
await mkdir(output, { recursive: true });
Object.assign(process.env, { PORT: String(port), BASE_PATH: "/", REPL_ID: "", NODE_ENV: "test" });
const result = { startedAt: new Date().toISOString(), durationSeconds, port, errors: [], checkpoints: [], actions: [] };
let browser;
let server;
try {
  server = await createServer({
    root: studioRoot,
    configFile: resolve(studioRoot, "vite.config.ts"),
    cacheDir: resolve(studioRoot, "node_modules", ".vite-instrument-soak"),
    server: { host: "127.0.0.1", port, strictPort: true, hmr: false },
    clearScreen: false,
  });
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => result.errors.push({ type: "pageerror", message: error.message }));
  page.on("console", message => { if (message.type() === "error") result.errors.push({ type: "console", message: message.text() }); });
  page.on("crash", () => result.errors.push({ type: "crash" }));
  await page.addInitScript(() => localStorage.setItem("studio.onboardingShown", "1"));
  await page.goto(`http://127.0.0.1:${port}/studio?snAudioNodeTrace=1`, { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor();
  assert.equal(await page.locator("vite-error-overlay").count(), 0);
  await page.getByRole("button", { name: /Tap to Enable Audio/i }).first().click();
  result.initialUi = await page.evaluate(() => ({
    title: document.title, bodyCharacters: document.body.innerText.length,
    controls: Array.from(document.querySelectorAll("button")).slice(0, 18).map(button => button.ariaLabel || button.title || button.textContent?.trim()),
  }));
  await page.screenshot({ path: resolve(output, "loaded.png") });

  result.setup = await page.evaluate(async () => {
    const [{ audio }, { getStore }] = await Promise.all([import("/src/lib/audio/engine.ts"), import("/src/store.ts")]);
    const store = getStore();
    const base = store.state.project.tracks.find(track => track.kind === "piano");
    if (!base) throw new Error("Default piano track missing");
    const presets = ["keys.vcsl-steinway-grand", "keys.vcsl-french-harpsichord", "keys.vcsl-pipe-organ", "bell.vcsl-marimba", "bell.vcsl-glockenspiel"];
    const noteSets = [["C3", "E3", "G3", "C4"], ["C4", "E4", "G4", "C5"], ["C3", "G3", "C4", "E4"], ["C4", "G4", "E4", "C5"], ["C6", "E6", "G6", "C7"], ["A2", "A3", "E4", "A4"]];
    const tracks = [...presets, undefined].map((presetId, index) => ({
      ...base, id: `soak-${index}`, name: presetId ?? "Custom A3 instrument", presetId,
      muted: false, solo: false, volume: .35, pan: (index - 2.5) * .1, audioClips: [],
      noteClips: [{ id: `soak-clip-${index}`, start: 0, length: 16, notes: Array.from({ length: 32 }, (_, n) => ({
        time: n * .5, duration: index === 2 ? .7 : .4, note: noteSets[index][n % 4], velocity: .65,
      })) }],
      sampleInstrument: index === 5 ? { blobKey: "soak:sample-a3", rootNote: 57 } : undefined,
    }));
    const rate = 44100, frames = rate * 2, bytes = new ArrayBuffer(44 + frames * 2), wave = new DataView(bytes);
    const ascii = (offset, text) => { for (let n = 0; n < text.length; n++) wave.setUint8(offset + n, text.charCodeAt(n)); };
    ascii(0, "RIFF"); wave.setUint32(4, 36 + frames * 2, true); ascii(8, "WAVEfmt ");
    wave.setUint32(16, 16, true); wave.setUint16(20, 1, true); wave.setUint16(22, 1, true);
    wave.setUint32(24, rate, true); wave.setUint32(28, rate * 2, true); wave.setUint16(32, 2, true); wave.setUint16(34, 16, true);
    ascii(36, "data"); wave.setUint32(40, frames * 2, true);
    for (let n = 0; n < frames; n++) wave.setInt16(44 + n * 2, Math.round(10000 * Math.sin(2 * Math.PI * 220 * n / rate)), true);
    store.patchProject({ bpm: 120, loopEnabled: true, loopStartBeat: 0, loopEndBeat: 16, tracks,
      samples: [{ id: "soak-sample", name: "Custom A3 recording", blobKey: "soak:sample-a3", durationSec: 2, createdAt: 1, blob: new Blob([bytes], { type: "audio/wav" }) }] });
    audio.removeAllTracksExcept(tracks.map(track => track.id));
    for (let index = 0; index < presets.length; index++) store.applyMelodicPreset(tracks[index].id, presets[index]);
    for (const track of store.state.project.tracks) audio.ensureTrack(track, { mode: "tone", reason: "ten-minute-instrument-soak", allowHeavy: true });
    audio.setLoop(true, 0, 16);
    await audio.whenSampleWorkSettled(60_000);
    store.set({ selectedTrackId: tracks[5].id });
    return { voices: audio.getVoiceSoundSelectorSnapshot(), custom: audio.getSampleInstrumentSnapshot(), playback: audio.getPlaybackDiagnosticSnapshot() };
  });
  assert.equal(result.setup.custom[0]?.status, "ready");
  assert.equal(result.setup.playback.samplerPromotions.pending.length, 0);
  assert.equal(result.setup.playback.samplerPromotions.active, null);
  await page.evaluate(async () => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    const probe = { started: performance.now(), last: performance.now(), ticks: 0, maxGapMs: 0, peakDb: -Infinity, trackPeaks: {}, maxCustomSources: 0, windowPeakDb: -Infinity, silentSince: null, longestSilenceMs: 0 };
    window.__instrumentSoak = probe;
    window.__instrumentSoakTimer = setInterval(() => {
      const now = performance.now(); probe.maxGapMs = Math.max(probe.maxGapMs, now - probe.last); probe.last = now; probe.ticks++;
      const peak = Math.max(...audio.getMasterLevels().peakDb);
      probe.peakDb = Math.max(probe.peakDb, peak); probe.windowPeakDb = Math.max(probe.windowPeakDb, peak);
      if (peak < -65) { probe.silentSince ??= now; probe.longestSilenceMs = Math.max(probe.longestSilenceMs, now - probe.silentSince); } else probe.silentSince = null;
      const custom = audio.getSampleInstrumentSnapshot()[0];
      probe.maxCustomSources = Math.max(probe.maxCustomSources, custom?.activeSources ?? 0);
      if (probe.ticks % 10 === 0) for (let n = 0; n < 6; n++) {
        const level = audio.getTrackMeter(`soak-${n}`)?.getValue();
        const peak = Math.max(...[level].flat());
        probe.trackPeaks[`soak-${n}`] = Math.max(probe.trackPeaks[`soak-${n}`] ?? -Infinity, peak);
      }
    }, 50);
  });
  await page.getByRole("button", { name: "Play", exact: true }).first().click();
  await page.getByRole("button", { name: "Pause", exact: true }).first().waitFor();
  console.log("SOAK_STARTED", JSON.stringify({ durationSeconds, output, tracks: 6 }));
  const started = Date.now();
  let checkpoint = 0;
  while (Date.now() - started < durationSeconds * 1000) {
    await new Promise(resolve => setTimeout(resolve, Math.min(30_000, durationSeconds * 1000 - (Date.now() - started))));
    const state = await page.evaluate(async () => {
      const [{ audio }, { visualTicker }] = await Promise.all([import("/src/lib/audio/engine.ts"), import("/src/lib/visualTicker.ts")]);
      const probe = window.__instrumentSoak;
      const output = { ...probe, elapsedSeconds: (performance.now() - probe.started) / 1000,
        playback: audio.getPlaybackDiagnosticSnapshot(), custom: audio.getSampleInstrumentSnapshot(),
        heapBytes: performance.memory?.usedJSHeapSize, visualSubscribers: visualTicker.subscriberCount };
      probe.windowPeakDb = -Infinity;
      return output;
    });
    result.checkpoints.push(state);
    assert.equal(state.playback.playbackState, "playing");
    assert.equal(state.playback.contextState, "running");
    assert.ok(state.windowPeakDb > -60, "Audio disappeared for a checkpoint window");
    assert.ok(state.maxCustomSources <= 32, "Unbounded custom sample sources");
    assert.ok(state.playback.samplerPromotions.cache.decodedBytes <= 64 * 1024 * 1024);
    if ([0, 5, 11].includes(checkpoint++)) {
      const hide = page.getByRole("button", { name: "Hide mixer", exact: true });
      if (await hide.isVisible()) await hide.click();
      const before = Date.now();
      await page.getByRole("button", { name: "Show mixer", exact: true }).click();
      await page.getByRole("button", { name: "Hide mixer", exact: true }).waitFor();
      result.actions.push({ action: "open-mixer-during-playback", elapsedSeconds: state.elapsedSeconds, durationMs: Date.now() - before });
      const scope = page.getByLabel("Master oscilloscope", { exact: true });
      assert.ok(await scope.isVisible());
      const first = await scope.evaluate(canvas => canvas.toDataURL());
      await page.waitForTimeout(200);
      const second = await scope.evaluate(canvas => canvas.toDataURL());
      result.actions.push({ action: "oscilloscope-redraws-during-playback", changed: first !== second });
      assert.notEqual(first, second, "Master oscilloscope is frozen");
      await page.screenshot({ path: resolve(output, `playing-${checkpoint}.png`) });
    }
    await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2));
    console.log("SOAK_CHECKPOINT", JSON.stringify({ seconds: state.elapsedSeconds, ticks: state.ticks, maxGapMs: state.maxGapMs, peakDb: state.windowPeakDb, heapMiB: state.heapBytes / 1048576, maxSources: state.maxCustomSources }));
  }
  await page.evaluate(() => clearInterval(window.__instrumentSoakTimer));
  await page.getByRole("button", { name: "Stop", exact: true }).first().click();
  await page.waitForTimeout(1500);
  result.afterStop = await page.evaluate(async () => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    return { playback: audio.getPlaybackState(), peakDb: Math.max(...audio.getMasterLevels().peakDb), custom: audio.getSampleInstrumentSnapshot() };
  });
  assert.equal(result.afterStop.playback, "stopped");
  assert.equal(result.afterStop.custom[0]?.activeSources, 0);
  assert.ok(result.afterStop.peakDb < -65);
  await page.getByRole("button", { name: "Play", exact: true }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /^Panic/ }).first().click();
  await page.waitForTimeout(500);
  result.afterPanic = await page.evaluate(async () => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    return { playback: audio.getPlaybackState(), peakDb: Math.max(...audio.getMasterLevels().peakDb), custom: audio.getSampleInstrumentSnapshot() };
  });
  assert.equal(result.afterPanic.custom[0]?.activeSources, 0);
  assert.ok(result.afterPanic.peakDb < -65);
  assert.deepEqual(result.errors, []);
  result.completedAt = new Date().toISOString();
  result.passed = true;
  await page.screenshot({ path: resolve(output, "after-panic.png") });
} catch (error) {
  result.passed = false;
  result.failure = error.stack;
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2));
  await browser?.close();
  await server?.close();
  console.log("SOAK_RESULT", JSON.stringify({ passed: result.passed, output, failure: result.failure }));
}
