/**
 * Scale Lock and Chord Mode utilities.
 *
 * Pure functions — no side effects, safe to call from any context.
 */

import type { ScaleId, ChordType } from "../../types";
export type { ScaleId, ChordType };

export const SCALE_LABELS: Record<ScaleId, string> = {
  chromatic: "Chromatic",
  major: "Major",
  minor: "Minor",
  pentatonic_major: "Pent. Major",
  pentatonic_minor: "Pent. Minor",
  blues: "Blues",
  dorian: "Dorian",
  phrygian: "Phrygian",
  lydian: "Lydian",
  mixolydian: "Mixolydian",
  locrian: "Locrian",
  harmonic_minor: "Harm. Minor",
  whole_tone: "Whole Tone",
};

export const CHORD_LABELS: Record<ChordType, string> = {
  none: "None",
  power: "Power (5th)",
  major_triad: "Major Triad",
  minor_triad: "Minor Triad",
  major7: "Major 7th",
  minor7: "Minor 7th",
  dom7: "Dom 7th",
  sus2: "Sus 2",
  sus4: "Sus 4",
};

/** Interval arrays (semitones from root, within one octave). */
const SCALE_INTERVALS: Record<ScaleId, number[]> = {
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

/** Chord interval offsets from root (semitones). */
const CHORD_INTERVALS: Record<ChordType, number[]> = {
  none: [0],
  power: [0, 7],
  major_triad: [0, 4, 7],
  minor_triad: [0, 3, 7],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

/** Note names for the root picker. */
export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F",
  "F#", "G", "G#", "A", "A#", "B",
] as const;

/**
 * Quantize a MIDI note number to the nearest note in the given scale.
 * Returns a note within [0, 127].
 */
export function quantizeToScale(
  note: number,
  rootSemitone: number,
  scale: ScaleId,
): number {
  const boundedNote = Math.max(0, Math.min(127, note));
  if (scale === "chromatic") return boundedNote;

  const intervals = SCALE_INTERVALS[scale];
  const root = ((Math.round(rootSemitone) % 12) + 12) % 12;

  let bestNote = boundedNote;
  let bestDist = Infinity;
  for (const iv of intervals) {
    const pitchClass = (root + iv) % 12;
    const distanceToLower = ((boundedNote - pitchClass) % 12 + 12) % 12;
    const lower = boundedNote - distanceToLower;

    // Compare absolute MIDI candidates rather than pitch-class distance alone.
    // The previous implementation could identify the next octave's root as the
    // nearest pitch class, then reconstruct it in the current octave and jump
    // down by eleven semitones. Checking both adjacent candidates preserves the
    // octave displacement. Ties resolve downward for deterministic behavior.
    for (const candidate of [lower, lower + 12]) {
      if (candidate < 0 || candidate > 127) continue;
      const dist = Math.abs(candidate - boundedNote);
      if (dist < bestDist || (dist === bestDist && candidate < bestNote)) {
        bestDist = dist;
        bestNote = candidate;
      }
    }
  }

  return bestNote;
}

/**
 * Expand a single root MIDI note into a chord array.
 * The root note is always the first element.
 */
export function expandToChord(note: number, chordType: ChordType): number[] {
  const intervals = CHORD_INTERVALS[chordType];
  return intervals.map((iv) => Math.max(0, Math.min(127, note + iv)));
}
