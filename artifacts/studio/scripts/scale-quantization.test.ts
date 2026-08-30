import assert from "node:assert/strict";
import test from "node:test";
import {
  SCALE_LABELS,
  quantizeToScale,
} from "../src/lib/performance/scaleUtils";
import type { ScaleId } from "../src/types";

const EXPECTED_INTERVALS: Record<ScaleId, readonly number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  whole_tone: [0, 2, 4, 6, 8, 10],
};

const SCALE_IDS = Object.keys(SCALE_LABELS) as ScaleId[];

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function referenceNearest(note: number, root: number, scale: ScaleId): number {
  const boundedNote = Math.max(0, Math.min(127, note));
  const allowed = new Set(EXPECTED_INTERVALS[scale]);
  let bestNote = 0;
  let bestDistance = Infinity;

  // Iterating upward makes the reference's tie rule explicit: keep the lower
  // candidate when two scale notes are equally close.
  for (let candidate = 0; candidate <= 127; candidate += 1) {
    if (!allowed.has(mod12(candidate - root))) continue;
    const distance = Math.abs(candidate - boundedNote);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestNote = candidate;
    }
  }

  return bestNote;
}

test("scale catalog and exhaustive reference cover the same modes", () => {
  assert.deepEqual(
    [...SCALE_IDS].sort(),
    (Object.keys(EXPECTED_INTERVALS) as ScaleId[]).sort(),
  );
});

test("quantization preserves octave displacement at scale boundaries", () => {
  assert.equal(quantizeToScale(71, 0, "pentatonic_major"), 72);
  assert.equal(quantizeToScale(61, 2, "pentatonic_major"), 62);
  assert.equal(quantizeToScale(23, 0, "pentatonic_major"), 24);
  assert.equal(quantizeToScale(71, 0, "pentatonic_minor"), 70);
});

test("quantization matches the nearest absolute MIDI note for every root, scale, and input", () => {
  for (let root = 0; root < 12; root += 1) {
    for (const scale of SCALE_IDS) {
      for (let note = 0; note <= 127; note += 1) {
        const actual = quantizeToScale(note, root, scale);
        const expected = referenceNearest(note, root, scale);
        assert.equal(
          actual,
          expected,
          `note=${note}, root=${root}, scale=${scale}`,
        );
        assert.ok(actual >= 0 && actual <= 127);
        assert.ok(
          EXPECTED_INTERVALS[scale].includes(mod12(actual - root)),
          `result is outside scale: note=${note}, root=${root}, scale=${scale}, result=${actual}`,
        );
      }
    }
  }
});

test("quantization remains bounded at the MIDI range edges", () => {
  assert.equal(quantizeToScale(-12, 0, "chromatic"), 0);
  assert.equal(quantizeToScale(200, 0, "chromatic"), 127);
  assert.equal(quantizeToScale(0, 2, "pentatonic_major"), 2);
  assert.equal(
    quantizeToScale(127, 2, "pentatonic_major"),
    referenceNearest(127, 2, "pentatonic_major"),
  );
});
