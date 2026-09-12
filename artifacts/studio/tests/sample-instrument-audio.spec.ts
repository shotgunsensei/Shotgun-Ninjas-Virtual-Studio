import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page): Promise<string> {
  await page.addInitScript(() => localStorage.setItem("studio.onboardingShown", "1"));
  await page.goto("/studio", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("button", { name: /Tap to Enable Audio/i }).first().click();
  return page.evaluate(async () => {
    const [{ audio }, { getStore }] = await Promise.all([
      import("/src/lib/audio/engine.ts"), import("/src/store.ts"),
    ]);
    const rate = 44100;
    const frames = rate * 4;
    const bytes = new ArrayBuffer(44 + frames * 2);
    const data = new DataView(bytes);
    const ascii = (offset: number, text: string) => {
      for (let n = 0; n < text.length; n++) data.setUint8(offset + n, text.charCodeAt(n));
    };
    ascii(0, "RIFF"); data.setUint32(4, 36 + frames * 2, true);
    ascii(8, "WAVE"); ascii(12, "fmt "); data.setUint32(16, 16, true);
    data.setUint16(20, 1, true); data.setUint16(22, 1, true);
    data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true);
    data.setUint16(32, 2, true); data.setUint16(34, 16, true);
    ascii(36, "data"); data.setUint32(40, frames * 2, true);
    for (let n = 0; n < frames; n++) data.setInt16(44 + n * 2, Math.round(12000 * Math.sin(2 * Math.PI * 220 * n / rate)), true);
    const store = getStore();
    const base = store.state.project.tracks.find((track) => track.kind === "piano")!;
    const track = {
      ...base, noteClips: [], audioClips: [], muted: false, solo: false,
      sampleInstrument: { blobKey: "test:melodic", rootNote: 57 },
      fx: { reverb: 0, delay: 0, filter: 1 },
      sound: { ...base.sound, attack: .005, release: .3, cutoff: 1, reverbSend: 0, delaySend: 0 },
    };
    store.patchProject({ tracks: [track], samples: [{
      id: "melodic", name: "Pure A3", blobKey: "test:melodic", durationSec: 4,
      createdAt: 1, blob: new Blob([bytes], { type: "audio/wav" }),
    }] });
    audio.removeAllTracksExcept([track.id]);
    audio.ensureTrack(track);
    return track.id;
  });
}

test("one recording transposes chords, follows mixer and sound controls, and bounds/stops voices", async ({ page }) => {
  const id = await prepare(page);
  await expect.poll(() => page.evaluate(async () => (await import("/src/lib/audio/engine.ts")).audio.getSampleInstrumentSnapshot()[0]?.status)).toBe("ready");
  const result = await page.evaluate(async (trackId) => {
    const [{ audio }, { getStore }] = await Promise.all([
      import("/src/lib/audio/engine.ts"), import("/src/store.ts"),
    ]);
    audio.startNote(trackId, "A2"); audio.startNote(trackId, "A3"); audio.startNote(trackId, "A4");
    const chord = audio.getSampleInstrumentSnapshot()[0];
    await new Promise((resolve) => setTimeout(resolve, 160));
    const level = audio.getTrackMeter(trackId)!.getValue();
    getStore().patchTrack(trackId, { volume: .25, pan: -.5 });
    audio.setTrackVolume(trackId, .25); audio.setTrackPan(trackId, -.5);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const mixer = audio.getVoiceMixSnapshot().find((voice) => voice.trackId === trackId);
    audio.stop();
    const afterStop = audio.getSampleInstrumentSnapshot()[0].activeSources;
    const pitchNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    for (let midi = 0; midi < 50; midi++) audio.startNote(trackId, `${pitchNames[midi % 12]}${Math.floor(midi / 12) - 1}`);
    const bounded = audio.getSampleInstrumentSnapshot()[0].activeSources;
    audio.panicStopAll();
    const afterPanic = audio.getSampleInstrumentSnapshot()[0].activeSources;
    return { chord, level, mixer, afterStop, bounded, afterPanic };
  }, id);
  expect(result.chord.playbackRates.sort()).toEqual([.5, 1, 2]);
  expect(Math.max(...[result.level].flat())).toBeGreaterThan(-60);
  expect(result.mixer?.pan).toBeCloseTo(-.5);
  expect(result.mixer?.volumeDb).toBeCloseTo(20 * Math.log10(.25));
  expect(result.afterStop).toBe(0);
  expect(result.bounded).toBe(32);
  expect(result.afterPanic).toBe(0);
});

test("missing, corrupt and relinked samples keep selector ownership without factory substitution", async ({ page }) => {
  const id = await prepare(page);
  const result = await page.evaluate(async (trackId) => {
    const [{ audio }, { getStore }] = await Promise.all([import("/src/lib/audio/engine.ts"), import("/src/store.ts")]);
    const store = getStore();
    const sample = store.state.project.samples![0];
    store.patchProject({ samples: [{ ...sample, blob: undefined }] });
    audio.startNote(trackId, "A3");
    const missing = audio.getSampleInstrumentSnapshot()[0];
    const missingSelector = audio.getVoiceSoundSelectorSnapshot().find((voice) => voice.trackId === trackId);
    store.patchProject({ samples: [{ ...sample, blob: new Blob(["invalid audio"]) }] });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const corrupt = audio.getSampleInstrumentSnapshot()[0];
    store.patchProject({ samples: [sample] });
    return { missing, missingSelector, corrupt };
  }, id);
  expect(result.missing.status).toBe("missing");
  expect(result.missing.activeSources).toBe(0);
  expect(result.missingSelector?.presetId).toBeUndefined();
  expect(result.missingSelector?.sampleInstrument?.blobKey).toBe("test:melodic");
  expect(result.corrupt.status).toBe("error");
  await expect.poll(() => page.evaluate(async () => (await import("/src/lib/audio/engine.ts")).audio.getSampleInstrumentSnapshot()[0]?.status)).toBe("ready");
});

test("late decode cannot revive a sample after factory selection, track deletion or project replacement", async ({ page }) => {
  const id = await prepare(page);
  const result = await page.evaluate(async (trackId) => {
    const [{ audio }, { getStore }, { SampleInstrumentVoice }] = await Promise.all([
      import("/src/lib/audio/engine.ts"), import("/src/store.ts"), import("/src/lib/audio/sampleInstrumentVoice.ts"),
    ]);
    const store = getStore();
    const sample = store.state.project.samples![0];
    const bytes = await sample.blob!.arrayBuffer();
    let finish!: (bytes: ArrayBuffer) => void;
    const delayed = new Blob([bytes], { type: "audio/wav" });
    delayed.arrayBuffer = () => new Promise<ArrayBuffer>((resolve) => { finish = resolve; });
    store.patchProject({ samples: [{ ...sample, blob: delayed }] });
    const loading = audio.getSampleInstrumentSnapshot()[0].status;
    store.applyMelodicPreset(trackId, "keys.soft");
    finish(bytes.slice(0));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const factory = audio.getVoiceSoundSelectorSnapshot().find((voice) => voice.trackId === trackId);
    // A pending standalone decoder exercises disposal before Blob reading
    // completes; it must never retain PCM or allocate delayed sources.
    let finishDisposed!: (bytes: ArrayBuffer) => void;
    delayed.arrayBuffer = () => new Promise<ArrayBuffer>((resolve) => { finishDisposed = resolve; });
    const disposed = new SampleInstrumentVoice(57, delayed);
    disposed.dispose(); finishDisposed(bytes.slice(0)); await disposed.ready;
    disposed.triggerAttack("A3");
    const disposedState = disposed.snapshot();
    store.patchProject({ tracks: store.state.project.tracks.map((track) => ({ ...track, sampleInstrument: { blobKey: sample.blobKey, rootNote: 57 } })), samples: [sample] });
    audio.removeTrack(trackId);
    const afterDelete = audio.getSampleInstrumentSnapshot();
    audio.replaceProject({ ...store.state.project, tracks: [], samples: [] });
    return { loading, factory, disposedState, afterDelete, afterReplace: audio.getSampleInstrumentSnapshot() };
  }, id);
  expect(result.loading).toBe("loading");
  expect(result.factory?.presetId).toBe("keys.soft");
  expect(result.factory?.sampleInstrument).toBeUndefined();
  expect(result.disposedState.activeSources).toBe(0);
  expect(result.afterDelete).toEqual([]);
  expect(result.afterReplace).toEqual([]);
});
