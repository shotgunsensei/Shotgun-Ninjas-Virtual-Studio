import type { SoundPack } from "../audio/sounds/soundLibrary";
import type { NoteClip, NoteEvent, Track } from "../../types";

/** Sound Library previews always cover two 4/4 bars on a 1/16-note grid. */
export const PACK_SKETCH_BARS = 2;
export const PACK_SKETCH_STEPS_PER_BAR = 16;
export const PACK_SKETCH_STEP_BEATS = 0.25;
export const PACK_SKETCH_LENGTH_BEATS = 8;

const PACK_SKETCH_TOTAL_STEPS = PACK_SKETCH_BARS * PACK_SKETCH_STEPS_PER_BAR;
const DRUM_HIT_DURATION_BEATS = PACK_SKETCH_STEP_BEATS;
const DRUM_HIT_VELOCITY = 0.8;
const MELODY_DEFAULT_VELOCITY = 0.72;
const MELODY_GATE_RATIO = 0.94;

export interface PackSketchIds {
  drumClipId: string;
  /** Required when the pack has a demo melody. */
  melodicClipId?: string;
}

export interface CreatePackSketchInput {
  pack: SoundPack;
  drumTrack: Track;
  /** Required when the pack has a demo melody. */
  melodicTrack?: Track;
  /** Absolute arrangement beat where both generated clips begin. */
  startBeat: number;
  /** Caller-owned IDs keep this converter deterministic and side-effect free. */
  ids: PackSketchIds;
}

export interface PackSketchTrackResult {
  /** A new track value with the generated clip appended. */
  track: Track;
  /** The same generated clip reference appended to `track.noteClips`. */
  clip: NoteClip;
}

export interface PackSketchResult {
  packId: string;
  startBeat: number;
  lengthBeats: typeof PACK_SKETCH_LENGTH_BEATS;
  drum: PackSketchTrackResult;
  melodic?: PackSketchTrackResult;
}

function requireNonEmptyId(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function makeClip(
  id: string,
  startBeat: number,
  name: string,
  color: string | undefined,
  notes: NoteEvent[],
): NoteClip {
  return {
    id,
    start: startBeat,
    length: PACK_SKETCH_LENGTH_BEATS,
    bars: PACK_SKETCH_BARS,
    division: "1/16",
    name,
    color,
    notes,
  };
}

/**
 * Expand a Sound Pack's preview data into editable two-bar note clips.
 *
 * This intentionally mirrors `SoundLibraryPanel` preview timing while doing
 * no scheduling, audio graph work, ID generation, or store mutation:
 *
 * - each drum grid is read as 16 steps and repeated for both bars;
 * - a melody confined to steps 0..15 repeats in bar two;
 * - a melody containing any step at 16 or later is treated as an authored
 *   two-bar phrase and plays once;
 * - melodic note lengths use the preview's 94% gate with a one-step minimum.
 *
 * Input pack and track values are never mutated. Returned tracks are shallow
 * copies with new note-clip arrays, ready for a caller to apply explicitly.
 */
export function createPackSketch({
  pack,
  drumTrack,
  melodicTrack,
  startBeat,
  ids,
}: CreatePackSketchInput): PackSketchResult {
  if (!Number.isFinite(startBeat) || startBeat < 0) {
    throw new Error("startBeat must be a finite, non-negative number");
  }
  if (drumTrack.kind !== "drums") {
    throw new Error("drumTrack must be a drums track");
  }

  const drumClipId = requireNonEmptyId(ids.drumClipId, "drumClipId");
  const patternPieces = Object.keys(pack.demoPattern) as Array<keyof typeof pack.demoPattern>;
  const drumNotes: NoteEvent[] = [];

  // Preserve the preview's step-major scheduling order. Only the first 16
  // entries of each grid participate, because the preview uses step % 16.
  for (let step = 0; step < PACK_SKETCH_TOTAL_STEPS; step += 1) {
    const patternStep = step % PACK_SKETCH_STEPS_PER_BAR;
    for (const piece of patternPieces) {
      if (!pack.demoPattern[piece]?.[patternStep]) continue;
      drumNotes.push({
        time: step * PACK_SKETCH_STEP_BEATS,
        note: piece,
        duration: DRUM_HIT_DURATION_BEATS,
        velocity: DRUM_HIT_VELOCITY,
      });
    }
  }

  const drumClip = makeClip(
    drumClipId,
    startBeat,
    `${pack.name} · Drums`,
    drumTrack.meta?.color,
    drumNotes,
  );
  const nextDrumTrack: Track = {
    ...drumTrack,
    kitId: pack.kitId,
    noteClips: [...drumTrack.noteClips, drumClip],
  };

  const result: PackSketchResult = {
    packId: pack.id,
    startBeat,
    lengthBeats: PACK_SKETCH_LENGTH_BEATS,
    drum: { track: nextDrumTrack, clip: drumClip },
  };

  const demoMelody = pack.demoMelody;
  if (!demoMelody?.length) return result;

  if (!melodicTrack) {
    throw new Error("melodicTrack is required when the pack has a demo melody");
  }
  if (melodicTrack.kind === "drums" || melodicTrack.kind === "vocals") {
    throw new Error("melodicTrack must be a pitched instrument track");
  }
  const melodicClipId = requireNonEmptyId(ids.melodicClipId, "melodicClipId");
  const offsets = demoMelody.some((event) => event.step >= PACK_SKETCH_STEPS_PER_BAR)
    ? [0]
    : [0, PACK_SKETCH_STEPS_PER_BAR];
  const melodicNotes: NoteEvent[] = [];

  for (const offset of offsets) {
    for (const event of demoMelody) {
      const step = event.step + offset;
      if (step >= PACK_SKETCH_TOTAL_STEPS) continue;
      melodicNotes.push({
        time: step * PACK_SKETCH_STEP_BEATS,
        note: event.note,
        duration: Math.max(
          PACK_SKETCH_STEP_BEATS,
          event.lengthSteps * PACK_SKETCH_STEP_BEATS * MELODY_GATE_RATIO,
        ),
        velocity: event.velocity ?? MELODY_DEFAULT_VELOCITY,
      });
    }
  }

  const melodicClip = makeClip(
    melodicClipId,
    startBeat,
    `${pack.name} · Melody`,
    melodicTrack.meta?.color,
    melodicNotes,
  );
  const nextMelodicTrack: Track = {
    ...melodicTrack,
    presetId: pack.presetId ?? melodicTrack.presetId,
    noteClips: [...melodicTrack.noteClips, melodicClip],
  };

  return {
    ...result,
    melodic: { track: nextMelodicTrack, clip: melodicClip },
  };
}
