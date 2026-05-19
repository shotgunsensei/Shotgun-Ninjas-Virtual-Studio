/**
 * Pure pattern generators for the drum step sequencer.
 *
 * Every generator is a pure function over a `seed`, so the same seed
 * always produces the same pattern — making the output testable and
 * undo-friendly. Generators operate on a `StepGrid` (16ths from clip
 * start) and return a fresh array of `NoteEvent`s; they never mutate
 * the input.
 */

import type { NoteEvent } from "../../types";
import type { DrumPiece } from "./voices";

/** Small-state seeded PRNG (mulberry32). Deterministic across runs. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEP = 0.25; // beats per 16th
const PIECES_DRUM: DrumPiece[] = [
  "kick",
  "snare",
  "clap",
  "hat",
  "ohat",
  "tomLow",
  "tomHigh",
  "crash",
  "fx",
];

function step(beat: number, piece: DrumPiece, velocity = 0.9, extras: Partial<NoteEvent> = {}): NoteEvent {
  return {
    time: beat,
    note: piece,
    duration: STEP,
    velocity,
    ...extras,
  };
}

/** Keep only notes that belong to other pieces. */
function withoutPiece(notes: NoteEvent[], piece: DrumPiece): NoteEvent[] {
  return notes.filter((n) => n.note !== piece);
}

function withoutPieces(notes: NoteEvent[], pieces: DrumPiece[]): NoteEvent[] {
  const set = new Set<string>(pieces);
  return notes.filter((n) => !set.has(n.note));
}

/** Iterate every step beat within [0, totalBeats). */
function eachStep(totalBeats: number, fn: (beat: number, idx: number) => void) {
  const steps = Math.round(totalBeats / STEP);
  for (let i = 0; i < steps; i++) fn(i * STEP, i);
}

/**
 * Randomize a single lane on a fresh density curve. Density is roughly the
 * fraction of steps that fire. Backbeats (1/3) for snare, downbeats for kick
 * are nudged by their natural roles so the result still grooves.
 */
export function randomizeLane(
  notes: NoteEvent[],
  piece: DrumPiece,
  totalBeats: number,
  seed: number,
  densityHint?: number,
): NoteEvent[] {
  const rand = mulberry32(seed);
  const cleaned = withoutPiece(notes, piece);
  const out: NoteEvent[] = cleaned.slice();
  const density =
    densityHint ??
    (piece === "kick"
      ? 0.2
      : piece === "snare" || piece === "clap"
        ? 0.12
        : piece === "hat"
          ? 0.5
          : piece === "ohat"
            ? 0.08
            : 0.1);
  eachStep(totalBeats, (beat, idx) => {
    let p = density;
    const beatPos = idx % 4; // 0..3 within a beat
    const inBar = idx % 16;
    if (piece === "kick") {
      if (beatPos === 0 && (inBar === 0 || inBar === 8)) p = 0.95;
      else if (beatPos === 0) p = 0.4;
    } else if (piece === "snare" || piece === "clap") {
      if (beatPos === 0 && (inBar === 4 || inBar === 12)) p = 0.92;
      else p *= 0.3;
    } else if (piece === "hat") {
      if (beatPos === 0 || beatPos === 2) p = 0.85;
      else p = 0.45;
    }
    if (rand() < p) {
      const accent = beatPos === 0 && rand() < 0.35;
      out.push(step(beat, piece, accent ? 1 : 0.6 + rand() * 0.35, { accent }));
    }
  });
  return out;
}

/** Randomize the whole kit by re-rolling each piece independently. */
export function randomizeKit(
  notes: NoteEvent[],
  totalBeats: number,
  seed: number,
): NoteEvent[] {
  let out: NoteEvent[] = withoutPieces(notes, PIECES_DRUM);
  for (let i = 0; i < PIECES_DRUM.length; i++) {
    out = randomizeLane(out, PIECES_DRUM[i], totalBeats, seed + i * 1009);
  }
  return out;
}

/** Trap-style: rolling 16th hats with rests + accents, sub kick on 1/9, snare on 5/13. */
export function generateTrapHats(
  notes: NoteEvent[],
  totalBeats: number,
  seed: number,
): NoteEvent[] {
  const rand = mulberry32(seed);
  let out = withoutPieces(notes, ["kick", "snare", "hat", "ohat", "clap"]);
  eachStep(totalBeats, (beat, idx) => {
    const inBar = idx % 16;
    // hats: rolling 16ths with occasional double-time bursts
    const burst = inBar % 8 === 7 && rand() < 0.6;
    out.push(
      step(beat, "hat", burst ? 0.55 : inBar % 2 === 0 ? 0.75 : 0.5, {
        retrigger: burst ? 2 : 1,
        accent: inBar % 4 === 0,
      }),
    );
    // kick on 1 and just before the 3 (off-grid push)
    if (inBar === 0 || inBar === 8) out.push(step(beat, "kick", 1, { accent: true }));
    else if (inBar === 6 && rand() < 0.5) out.push(step(beat, "kick", 0.7));
    // snare/clap on 5 and 13
    if (inBar === 4 || inBar === 12) {
      out.push(step(beat, "snare", 0.85, { accent: true }));
      if (rand() < 0.5) out.push(step(beat, "clap", 0.55));
    }
  });
  return out;
}

/** Boom-bap groove: dusty kick on 1/3.5, snare on 2&4 with ghost notes. */
export function generateBoomBap(
  notes: NoteEvent[],
  totalBeats: number,
  seed: number,
): NoteEvent[] {
  const rand = mulberry32(seed);
  let out = withoutPieces(notes, ["kick", "snare", "hat", "ohat", "clap"]);
  eachStep(totalBeats, (beat, idx) => {
    const inBar = idx % 16;
    // hats: 8ths with light off-beat ghosting
    if (inBar % 2 === 0) {
      out.push(step(beat, "hat", inBar % 4 === 0 ? 0.85 : 0.6, { accent: inBar % 8 === 0 }));
    } else if (rand() < 0.35) {
      out.push(step(beat, "hat", 0.35, { probability: 0.7 }));
    }
    // kick on 1, "and of 2", and a swung pickup
    if (inBar === 0) out.push(step(beat, "kick", 1, { accent: true }));
    if (inBar === 6) out.push(step(beat, "kick", 0.85));
    if (inBar === 10 && rand() < 0.6) out.push(step(beat, "kick", 0.7, { microTiming: 0.04 }));
    // snare on 2 & 4 with ghost notes
    if (inBar === 4 || inBar === 12) out.push(step(beat, "snare", 0.9, { accent: true }));
    if ((inBar === 7 || inBar === 11) && rand() < 0.55) {
      out.push(step(beat, "snare", 0.25, { probability: 0.7 }));
    }
  });
  return out;
}

/** Cinematic: sparse, accented impacts — kick on 1, crash on 1, taiko fills. */
export function generateCinematic(
  notes: NoteEvent[],
  totalBeats: number,
  seed: number,
): NoteEvent[] {
  const rand = mulberry32(seed);
  let out = withoutPieces(notes, ["kick", "snare", "hat", "tomLow", "tomHigh", "crash", "fx"]);
  eachStep(totalBeats, (beat, idx) => {
    const inBar = idx % 16;
    const bar = Math.floor(idx / 16);
    if (inBar === 0 && bar % 2 === 0) {
      out.push(step(beat, "kick", 1, { accent: true }));
      if (bar === 0) out.push(step(beat, "crash", 0.85, { accent: true }));
    }
    if (inBar === 8) out.push(step(beat, "kick", 0.9, { accent: true }));
    if (inBar === 4 || inBar === 12) {
      out.push(step(beat, "snare", 0.95, { accent: true, flam: rand() < 0.4 }));
    }
    // taiko fill at bar end
    if (inBar === 14 && rand() < 0.7) out.push(step(beat, "tomLow", 0.7));
    if (inBar === 15 && rand() < 0.7) out.push(step(beat, "tomHigh", 0.75, { retrigger: 2 }));
    // sparse FX riser at first beat of every fourth bar
    if (inBar === 0 && bar % 4 === 0) out.push(step(beat, "fx", 0.6));
  });
  return out;
}

/** Simplify: drop low-velocity / low-probability hits and ghost notes. */
export function simplifyPattern(notes: NoteEvent[]): NoteEvent[] {
  return notes
    .filter((n) => n.velocity >= 0.45)
    .filter((n) => (n.probability ?? 1) >= 0.6)
    .map((n) => {
      const next: NoteEvent = { ...n };
      delete next.retrigger;
      delete next.flam;
      return next;
    });
}

/** Add quiet ghost snare/kick notes on weak 16ths around existing accents. */
export function addGhostNotes(
  notes: NoteEvent[],
  totalBeats: number,
  seed: number,
): NoteEvent[] {
  const rand = mulberry32(seed);
  const out = notes.slice();
  const hasAt = (beat: number, piece: string) =>
    out.some((n) => n.note === piece && Math.abs(n.time - beat) < 0.01);
  eachStep(totalBeats, (beat, idx) => {
    const inBar = idx % 16;
    if (inBar % 2 === 0) return; // weak 16ths only
    if (rand() < 0.35 && !hasAt(beat, "snare")) {
      out.push(step(beat, "snare", 0.22, { probability: 0.6 }));
    }
    if (rand() < 0.18 && !hasAt(beat, "kick")) {
      out.push(step(beat, "kick", 0.3, { probability: 0.55 }));
    }
  });
  return out;
}
