import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("studio.onboardingShown", "1"));
  await page.goto("/studio?disableAudio=1", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 20_000 });
});

test("custom instrument audio survives save, draft, Save As, source deletion and portable import", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const [{ defaultProject }, storage] = await Promise.all([
      import("/src/store.ts"), import("/src/lib/storage/db.ts"),
    ]);
    const project = defaultProject();
    project.id = `custom-persistence-${Date.now()}`;
    const track = project.tracks.find((candidate) => candidate.kind === "piano")!;
    track.sampleInstrument = { blobKey: `${project.id}:sample:voice`, rootNote: 57 };
    project.tracks = [track];
    project.samples = [{
      id: "voice", name: "Custom voice", blobKey: track.sampleInstrument.blobKey,
      durationSec: 1, createdAt: Date.now(), blob: new Blob(["custom-source-bytes"], { type: "audio/wav" }),
    }];
    await storage.saveProject(project);
    const saved = (await storage.loadProject(project.id))!;
    await storage.saveDraft(saved);
    const draft = await storage.hydrateDraft((await storage.loadDraft())!);
    const duplicate = await storage.duplicateProject(saved, "Independent custom copy");
    await storage.deleteProject(project.id);
    const independent = (await storage.loadProject(duplicate.id))!;
    const imported = storage.parseProjectJson(await storage.projectToJson(independent));
    const snapshots = await Promise.all([saved, draft, independent, imported].map(async (snapshot) => ({
      rootNote: snapshot.tracks[0].sampleInstrument?.rootNote,
      matchingKey: snapshot.tracks[0].sampleInstrument?.blobKey === snapshot.samples?.[0].blobKey,
      audio: await snapshot.samples?.[0].blob?.text(),
    })));
    await storage.deleteProject(duplicate.id);
    await storage.clearDraft();
    return { snapshots, changedKey: duplicate.samples![0].blobKey !== project.samples[0].blobKey };
  });
  expect(result.changedKey).toBe(true);
  for (const snapshot of result.snapshots) {
    expect(snapshot).toEqual({ rootNote: 57, matchingKey: true, audio: "custom-source-bytes" });
  }
});

test("WAV and MP3 transpose a custom source by octaves and report missing/corrupt sources as silent", async ({ page }) => {
  test.setTimeout(90_000);
  const result = await page.evaluate(async () => {
    const [{ defaultProject }, { renderProject, exportDawPack }] = await Promise.all([
      import("/src/store.ts"), import("/src/lib/audio/export.ts"),
    ]);
    const sampleRate = 44_100;
    const frames = sampleRate * 2;
    const bytes = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(bytes);
    const write = (offset: number, word: string) => {
      for (let index = 0; index < word.length; index++) view.setUint8(offset + index, word.charCodeAt(index));
    };
    write(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true);
    write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, "data"); view.setUint32(40, frames * 2, true);
    for (let frame = 0; frame < frames; frame++) {
      view.setInt16(44 + frame * 2, Math.round(Math.sin(frame / sampleRate * Math.PI * 880) * 0.5 * 32767), true);
    }
    const project = defaultProject();
    const track = project.tracks.find((candidate) => candidate.kind === "piano")!;
    track.sampleInstrument = { blobKey: "custom-octave", rootNote: 69 };
    track.presetId = "keys.grand-piano"; // Must never be substituted on decode failure.
    track.fx = { reverb: 0, delay: 0, filter: 1 };
    track.fxRack = {};
    track.sends = { roomReverb: 0, neonHall: 0, tapeDelay: 0, darkSlapback: 0 };
    track.sound = { attack: 0.005, release: 0.3, cutoff: 1, resonance: 0, drive: 0, width: 0.5, reverbSend: 0, delaySend: 0, chorusSend: 0 };
    track.eq = { low: 0, mid: 0, high: 0, hpfOn: false, hpfHz: 20 };
    track.muted = false; track.solo = false; track.volume = 1; track.pan = 0;
    track.audioClips = [];
    track.noteClips = [{
      id: "octaves", start: 0, length: 6,
      notes: ["A3", "A4", "A5"].map((note, index) => ({ time: index * 2, note, duration: 0.4, velocity: 0.8 })),
    }];
    project.tracks = [track]; project.bpm = 120; project.bars = 2;
    project.samples = [{ id: "voice", name: "Octave source", blobKey: "custom-octave", durationSec: 2, createdAt: 0, blob: new Blob([bytes], { type: "audio/wav" }) }];
    const options = { customStartBeat: 0, customEndBeat: 6 };
    const wav = await renderProject(project, "wav", undefined, options);
    const mp3 = await renderProject(project, "mp3", undefined, options);
    const context = new AudioContext();
    const analyze = async (blob: Blob) => {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      const samples = buffer.getChannelData(0);
      const frequencies = [0.08, 1.08, 2.08].map((time) => {
        const start = Math.floor(time * buffer.sampleRate);
        const count = Math.floor(0.16 * buffer.sampleRate);
        let crossings = 0;
        for (let i = start + 1; i < start + count; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
        return crossings / (count / buffer.sampleRate);
      });
      let peak = 0;
      for (const value of samples) peak = Math.max(peak, Math.abs(value));
      return { frequencies, peak };
    };
    try {
      const wavAudio = await analyze(wav.blob);
      const mp3Audio = await analyze(mp3.blob);
      project.samples[0].blob = undefined;
      const missing = await renderProject(project, "wav", undefined, options);
      project.samples[0].blob = new Blob(["invalid audio"], { type: "audio/wav" });
      const corrupt = await renderProject(project, "wav", undefined, options);
      const dawPack = await exportDawPack(project, "{}", [], options);
      const { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
      const zip = await JSZip.loadAsync(await dawPack.arrayBuffer());
      const packReadme = await zip.file("README.txt")!.async("string");
      return {
        wavAudio, mp3Audio, missingAudio: await analyze(missing.blob), corruptAudio: await analyze(corrupt.blob),
        missingWarnings: missing.warnings, corruptWarnings: corrupt.warnings,
        packReadme,
      };
    } finally {
      await context.close();
    }
  });
  for (const audio of [result.wavAudio, result.mp3Audio]) {
    expect(audio.peak).toBeGreaterThan(0.02);
    for (const [index, frequency] of [220, 440, 880].entries()) {
      expect(Math.abs(audio.frequencies[index] - frequency)).toBeLessThan(12);
    }
  }
  expect(result.missingAudio.peak).toBe(0);
  expect(result.corruptAudio.peak).toBe(0);
  expect(result.missingWarnings?.join(" ")).toContain("Custom instrument source unavailable");
  expect(result.corruptWarnings?.join(" ")).toContain("Custom instrument sources could not be decoded");
  expect(result.packReadme).toContain("Custom instrument sources could not be decoded");
});
