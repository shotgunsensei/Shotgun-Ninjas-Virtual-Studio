import assert from "node:assert/strict";
import test from "node:test";
import type { SoundPack } from "../src/lib/audio/sounds/soundLibrary";
import {
  PACK_SKETCH_LENGTH_BEATS,
  createPackSketch,
} from "../src/lib/creative/packSketch";
import type { Track } from "../src/types";

function makeTrack(id: string, kind: Track["kind"]): Track {
  return {
    id,
    name: `${kind} track`,
    kind,
    preset: kind === "drums" ? "trap" : kind === "guitar" ? "clean" : "electric",
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    noteClips: [
      {
        id: `${id}-existing`,
        start: 0,
        length: 4,
        notes: [{ time: 0, note: kind === "drums" ? "kick" : "C4", duration: 0.25, velocity: 0.5 }],
      },
    ],
    audioClips: [],
    fx: { reverb: 0, delay: 0, filter: 1 },
    meta: { color: kind === "drums" ? "#ff0044" : "#00ccff" },
  };
}

function makePack(overrides: Partial<SoundPack> = {}): SoundPack {
  return {
    id: "test-pack",
    name: "Test Pack",
    tagline: "Pure data",
    description: "A deterministic test pack.",
    category: "Signature",
    kitId: "lofi",
    presetId: "keys.soft",
    coverArt: {
      bg: "#000000",
      accent: "#ffffff",
      accent2: "#888888",
      theme: "ninja-shuriken",
    },
    demoPattern: {
      kick: [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
      snare: [false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    },
    ...overrides,
  };
}

test("converts the 16-step drum preview into an editable two-bar clip", () => {
  const pack = makePack();
  const drumTrack = makeTrack("drums", "drums");
  const packBefore = structuredClone(pack);
  const trackBefore = structuredClone(drumTrack);

  const sketch = createPackSketch({
    pack,
    drumTrack,
    startBeat: 12,
    ids: { drumClipId: "drum-clip" },
  });

  assert.equal(sketch.packId, pack.id);
  assert.equal(sketch.startBeat, 12);
  assert.equal(sketch.lengthBeats, PACK_SKETCH_LENGTH_BEATS);
  assert.deepEqual(
    sketch.drum.clip.notes.map((note) => [note.time, note.note]),
    [
      [0, "kick"],
      [1, "snare"],
      [3.75, "kick"],
      [4, "kick"],
      [5, "snare"],
      [7.75, "kick"],
    ],
  );
  assert.ok(sketch.drum.clip.notes.every((note) => note.duration === 0.25));
  assert.ok(sketch.drum.clip.notes.every((note) => note.velocity === 0.8));
  assert.deepEqual(
    {
      id: sketch.drum.clip.id,
      start: sketch.drum.clip.start,
      length: sketch.drum.clip.length,
      bars: sketch.drum.clip.bars,
      division: sketch.drum.clip.division,
      color: sketch.drum.clip.color,
    },
    {
      id: "drum-clip",
      start: 12,
      length: 8,
      bars: 2,
      division: "1/16",
      color: "#ff0044",
    },
  );
  assert.equal(sketch.drum.track.kitId, pack.kitId);
  assert.equal(sketch.drum.track.noteClips.length, drumTrack.noteClips.length + 1);
  assert.strictEqual(sketch.drum.track.noteClips.at(-1), sketch.drum.clip);
  assert.deepEqual(pack, packBefore);
  assert.deepEqual(drumTrack, trackBefore);
});

test("repeats a one-bar melody and preserves the preview gate and velocity rules", () => {
  const pack = makePack({
    demoMelody: [
      { step: 0, note: "C4", lengthSteps: 4, velocity: 0.61 },
      { step: 15, note: "G4", lengthSteps: 2 },
    ],
  });
  const drumTrack = makeTrack("drums", "drums");
  const melodicTrack = makeTrack("keys", "piano");
  const packBefore = structuredClone(pack);
  const drumBefore = structuredClone(drumTrack);
  const melodicBefore = structuredClone(melodicTrack);

  const sketch = createPackSketch({
    pack,
    drumTrack,
    melodicTrack,
    startBeat: 4,
    ids: { drumClipId: "drums-id", melodicClipId: "melody-id" },
  });

  assert.ok(sketch.melodic);
  assert.deepEqual(
    sketch.melodic.clip.notes.map((note) => ({
      time: note.time,
      note: note.note,
      duration: note.duration,
      velocity: note.velocity,
    })),
    [
      { time: 0, note: "C4", duration: 0.94, velocity: 0.61 },
      { time: 3.75, note: "G4", duration: 0.47, velocity: 0.72 },
      { time: 4, note: "C4", duration: 0.94, velocity: 0.61 },
      { time: 7.75, note: "G4", duration: 0.47, velocity: 0.72 },
    ],
  );
  assert.equal(sketch.melodic.clip.id, "melody-id");
  assert.equal(sketch.melodic.clip.start, 4);
  assert.equal(sketch.melodic.track.presetId, pack.presetId);
  assert.strictEqual(sketch.melodic.track.noteClips.at(-1), sketch.melodic.clip);
  assert.deepEqual(pack, packBefore);
  assert.deepEqual(drumTrack, drumBefore);
  assert.deepEqual(melodicTrack, melodicBefore);
});

test("plays an authored two-bar melody once and drops events beyond the preview", () => {
  const pack = makePack({
    demoMelody: [
      { step: 2, note: "A3", lengthSteps: 0 },
      { step: 16, note: "C4", lengthSteps: 4, velocity: 0.8 },
      { step: 31, note: "E4", lengthSteps: 1 },
      { step: 32, note: "G4", lengthSteps: 4 },
    ],
  });

  const sketch = createPackSketch({
    pack,
    drumTrack: makeTrack("drums", "drums"),
    melodicTrack: makeTrack("lead", "guitar"),
    startBeat: 0,
    ids: { drumClipId: "drums-id", melodicClipId: "melody-id" },
  });

  assert.deepEqual(
    sketch.melodic?.clip.notes.map((note) => [note.time, note.note, note.duration]),
    [
      [0.5, "A3", 0.25],
      [4, "C4", 0.94],
      [7.75, "E4", 0.25],
    ],
  );
});

test("requires caller-owned melody inputs and rejects invalid track/start values", () => {
  const melodicPack = makePack({
    demoMelody: [{ step: 0, note: "C4", lengthSteps: 1 }],
  });
  const drums = makeTrack("drums", "drums");

  assert.throws(
    () =>
      createPackSketch({
        pack: melodicPack,
        drumTrack: drums,
        startBeat: 0,
        ids: { drumClipId: "drums-id" },
      }),
    /melodicTrack is required/,
  );
  assert.throws(
    () =>
      createPackSketch({
        pack: melodicPack,
        drumTrack: drums,
        melodicTrack: makeTrack("keys", "piano"),
        startBeat: 0,
        ids: { drumClipId: "drums-id" },
      }),
    /melodicClipId must be a non-empty string/,
  );
  assert.throws(
    () =>
      createPackSketch({
        pack: makePack(),
        drumTrack: makeTrack("keys", "piano"),
        startBeat: 0,
        ids: { drumClipId: "drums-id" },
      }),
    /drumTrack must be a drums track/,
  );
  assert.throws(
    () =>
      createPackSketch({
        pack: makePack(),
        drumTrack: drums,
        startBeat: Number.NaN,
        ids: { drumClipId: "drums-id" },
      }),
    /startBeat must be a finite, non-negative number/,
  );
});

test("has no timer, audio, or global-ID side effects", () => {
  const originalSetTimeout = globalThis.setTimeout;
  let timeoutCalls = 0;
  globalThis.setTimeout = ((..._args: Parameters<typeof setTimeout>) => {
    timeoutCalls += 1;
    throw new Error("pack sketch must not schedule timers");
  }) as typeof setTimeout;

  try {
    const sketch = createPackSketch({
      pack: makePack(),
      drumTrack: makeTrack("drums", "drums"),
      startBeat: 8,
      ids: { drumClipId: "injected-id" },
    });
    assert.equal(sketch.drum.clip.id, "injected-id");
    assert.equal(timeoutCalls, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});
