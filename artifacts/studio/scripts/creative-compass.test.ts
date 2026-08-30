import assert from "node:assert/strict";
import test from "node:test";
import {
  CREATIVE_ROOTS,
  CREATIVE_SCALE_LABELS,
  analyzeCreativeProject,
  barsRequiredForClip,
  creativeScaleFromScaleId,
  createCreativeSeed,
  createCreativeVariation,
  isMidiInCreativeScale,
  nextCreativeClipStart,
  type CreativeRecipe,
  type CreativeScale,
} from "../src/lib/creative/creativeCompass";
import type { NoteClip, Project, Track } from "../src/types";

function makeTrack(id: string, kind: Track["kind"], noteClips: NoteClip[] = []): Track {
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
    noteClips,
    audioClips: [],
    fx: { reverb: 0, delay: 0, filter: 1 },
    meta: { color: "#ef4444" },
  };
}

function makeProject(tracks: Track[]): Project {
  return {
    id: "project",
    name: "Creative test",
    bpm: 100,
    bars: 4,
    loopEnabled: false,
    loopStartBeat: 0,
    loopEndBeat: 16,
    metronome: false,
    countIn: false,
    masterVolume: 0.8,
    tracks,
    midiMappings: [],
    updatedAt: 1,
  };
}

const pitchNameMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ALL_SCALES = Object.keys(CREATIVE_SCALE_LABELS) as CreativeScale[];
const EXPECTED_CLIP_MODES: Record<CreativeScale, NonNullable<NoteClip["scaleMode"]>> = {
  major: "major",
  minor: "minor",
  pentatonic_major: "pentMajor",
  pentatonic_minor: "pentMinor",
  dorian: "dorian",
};

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function noteToMidi(note: string): number {
  const match = /^([A-G])(#?)(-?\d+)$/.exec(note);
  assert.ok(match, `expected a pitched note, received ${note}`);
  const pitch = pitchNameMap[match[1] as keyof typeof pitchNameMap];
  return (Number(match[3]) + 1) * 12 + pitch + (match[2] === "#" ? 1 : 0);
}

test("analysis recommends the missing musical foundation without judging the song", () => {
  const drums = makeTrack("drums", "drums");
  const piano = makeTrack("piano", "piano");
  const bass = makeTrack("bass", "bass");
  const project = makeProject([drums, piano, bass]);

  const empty = analyzeCreativeProject(project, piano.id);
  assert.equal(empty.recommendedRecipe, "groove");
  assert.equal(empty.targetTrackId, drums.id);
  assert.equal(empty.completedStages, 0);
  assert.deepEqual(empty.stages.map((stage) => stage.label), [
    "Pulse",
    "Home",
    "Weight",
    "Contrast",
  ]);

  const filled = makeProject([
    makeTrack("drums", "drums", [
      {
        id: "beat",
        start: 0,
        length: 8,
        notes: [0, 1, 2, 3].map((time) => ({
          time,
          note: "kick",
          duration: 0.25,
          velocity: 0.8,
        })),
      },
    ]),
    makeTrack("piano", "piano", [
      {
        id: "harmony",
        start: 0,
        length: 8,
        notes: ["A3", "C4", "E4"].map((note) => ({
          time: 0,
          note,
          duration: 2,
          velocity: 0.7,
        })),
      },
    ]),
    makeTrack("bass", "bass", [
      {
        id: "bassline",
        start: 0,
        length: 8,
        notes: [{ time: 0, note: "A2", duration: 1, velocity: 0.8 }],
      },
    ]),
  ]);
  filled.sections = [
    { id: "a", bar: 0, label: "Verse" },
    { id: "b", bar: 4, label: "Hook" },
  ];

  const complete = analyzeCreativeProject(filled, "piano");
  assert.equal(complete.completedStages, 4);
  assert.equal(complete.recommendedRecipe, "motif");
  assert.match(complete.nextMove.title, /memorable identity/i);
});

test("performance scale identity preserves major and minor pentatonic modes", () => {
  assert.equal(creativeScaleFromScaleId("major"), "major");
  assert.equal(creativeScaleFromScaleId("minor"), "minor");
  assert.equal(creativeScaleFromScaleId("dorian"), "dorian");
  assert.equal(creativeScaleFromScaleId("pentatonic_major"), "pentatonic_major");
  assert.equal(creativeScaleFromScaleId("pentatonic_minor"), "pentatonic_minor");
});

test("melodic seeds are correct for every root, scale, and recipe", () => {
  const track = makeTrack("keys", "piano");
  const before = structuredClone(track);
  const recipes: Exclude<CreativeRecipe, "groove">[] = ["motif", "chords", "pulse"];

  for (let rootSemitone = 0; rootSemitone < 12; rootSemitone += 1) {
    for (const scale of ALL_SCALES) {
      for (const recipe of recipes) {
        const seed = `${rootSemitone}:${scale}:${recipe}`;
        const first = createCreativeSeed({
          id: `${seed}-a`,
          track,
          start: 12,
          rootSemitone,
          scale,
          recipe,
          seed,
        });
        const second = createCreativeSeed({
          id: `${seed}-b`,
          track,
          start: 12,
          rootSemitone,
          scale,
          recipe,
          seed,
        });
        assert.deepEqual(first.notes, second.notes, seed);
        assert.equal(first.start, 12);
        assert.equal(first.length, 8);
        assert.equal(first.bars, 2);
        assert.equal(first.scaleRoot, CREATIVE_ROOTS[rootSemitone]);
        assert.equal(first.scaleMode, EXPECTED_CLIP_MODES[scale]);
        assert.ok(first.notes.length > 0);
        assert.ok(first.notes.every((note) => note.time >= 0 && note.time < 8));
        assert.ok(first.notes.every((note) => note.duration > 0));
        assert.ok(first.notes.every((note) => note.velocity > 0 && note.velocity <= 1));
        assert.ok(
          first.notes.every((note) =>
            isMidiInCreativeScale(noteToMidi(note.note), rootSemitone, scale),
          ),
          `out-of-scale note for ${seed}`,
        );

        if (recipe === "chords") {
          const chordRootPitchClasses = first.notes
            .filter((_, index) => index % 3 === 0)
            .map((note) => mod12(noteToMidi(note.note)));
          assert.equal(
            new Set(chordRootPitchClasses).size,
            4,
            `chord roots must remain distinct for root=${rootSemitone}, scale=${scale}`,
          );
        }

        if (recipe === "pulse") {
          const allowedPitchClasses = new Set([
            rootSemitone,
            mod12(rootSemitone + 7),
          ]);
          assert.ok(
            first.notes.every((note) =>
              allowedPitchClasses.has(mod12(noteToMidi(note.note))),
            ),
            `pulse must use only root and fifth for root=${rootSemitone}, scale=${scale}`,
          );
        }
      }
    }
  }

  assert.deepEqual(track, before);
});

test("a drum target safely coerces every seed request to a two-bar groove", () => {
  const drums = makeTrack("drums", "drums");
  const clip = createCreativeSeed({
    id: "groove",
    track: drums,
    start: 0,
    rootSemitone: 0,
    scale: "major",
    recipe: "chords",
    seed: "drum seed",
  });

  assert.match(clip.name ?? "", /Pocket groove/);
  assert.ok(clip.notes.some((note) => note.note === "kick"));
  assert.ok(clip.notes.some((note) => note.note === "snare"));
  assert.ok(clip.notes.some((note) => note.note === "hat" || note.note === "ohat"));
  assert.ok(clip.notes.every((note) => note.time >= 0 && note.time < 8));
});

test("variations preserve their source and create three meaningfully different edits", () => {
  const track = makeTrack("lead", "guitar");
  const source = createCreativeSeed({
    id: "source",
    track,
    start: 0,
    rootSemitone: 2,
    scale: "dorian",
    recipe: "motif",
    seed: "source",
  });
  const before = structuredClone(source);
  const answer = createCreativeVariation({
    id: "answer",
    track,
    source,
    start: 8,
    variation: "answer",
    rootSemitone: 2,
    scale: "dorian",
  });
  const lift = createCreativeVariation({
    id: "lift",
    track,
    source,
    start: 8,
    variation: "lift",
    rootSemitone: 2,
    scale: "dorian",
  });
  const pocket = createCreativeVariation({
    id: "pocket",
    track,
    source,
    start: 8,
    variation: "pocket",
    rootSemitone: 2,
    scale: "dorian",
  });

  assert.deepEqual(source, before);
  assert.notDeepEqual(answer.notes, source.notes);
  assert.notDeepEqual(lift.notes, source.notes);
  assert.notDeepEqual(pocket.notes, source.notes);
  assert.notDeepEqual(answer.notes, lift.notes);
  assert.equal(answer.start, 8);
  assert.equal(lift.scaleMode, "dorian");
  assert.ok(pocket.notes.every((note) => note.time < 8));
});

test("answer variations resolve to the nearest tonic for every root and scale", () => {
  const track = makeTrack("lead", "guitar");

  for (let rootSemitone = 0; rootSemitone < 12; rootSemitone += 1) {
    for (const scale of ALL_SCALES) {
      const tonic = `${CREATIVE_ROOTS[rootSemitone]}4`;
      const source: NoteClip = {
        id: `source-${rootSemitone}-${scale}`,
        start: 0,
        length: 8,
        notes: [{ time: 0, note: tonic, duration: 0.5, velocity: 0.8 }],
      };
      const answer = createCreativeVariation({
        id: `answer-${rootSemitone}-${scale}`,
        track,
        source,
        start: 8,
        variation: "answer",
        rootSemitone,
        scale,
      });

      assert.equal(
        answer.notes.at(-1)?.note,
        tonic,
        `answer tonic moved octaves for root=${rootSemitone}, scale=${scale}`,
      );
    }
  }
});

test("variations reject empty source clips", () => {
  const track = makeTrack("lead", "guitar");
  const source: NoteClip = { id: "empty", start: 0, length: 8, notes: [] };

  for (const variation of ["answer", "lift", "pocket"] as const) {
    assert.throws(
      () =>
        createCreativeVariation({
          id: variation,
          track,
          source,
          start: 8,
          variation,
          rootSemitone: 0,
          scale: "major",
        }),
      /source clip must contain at least one note/,
    );
  }
});

test("placement accounts for both note and audio clips and expands bars minimally", () => {
  const track = makeTrack("hybrid", "piano", [
    { id: "notes", start: 3, length: 5, notes: [] },
  ]);
  track.audioClips = [
    {
      id: "audio",
      start: 9,
      durationSec: 2,
      blobKey: "audio",
    },
  ];

  assert.equal(nextCreativeClipStart(track, 120), 16);
  assert.equal(
    barsRequiredForClip({ id: "next", start: 16, length: 8, notes: [] }),
    6,
  );
});
