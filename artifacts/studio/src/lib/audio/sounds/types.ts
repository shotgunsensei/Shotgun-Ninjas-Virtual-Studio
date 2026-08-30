/**
 * Sound model types for v2.
 *
 * Defines the data-driven schema for drum kits, melodic presets, and
 * sample layers. Kits and presets live as plain data in `kits.ts` and
 * `presets.ts`; the resolver in `samples.ts` fetches declared local layer
 * URLs and, when at least one file is reachable, loads it via Tone.
 * When no files are reachable the engine falls back to Tone-based
 * synthesis from the recipe. The factory VCSL instruments ship as local,
 * lazy-loaded WAV assets; other definitions may remain synthesis-only.
 */

import type { DrumPiece } from "../voices";

export type DrumKitId =
  | "trap"
  | "boombap"
  | "cyberpunk"
  | "lofi"
  | "cinematic"
  | "demontruck"
  | "neondojo"
  | "garageband"
  | "southerndirt"
  | "cybertrap"
  | "arcadeghosts";

export type DrumCategory =
  | "kick"
  | "snare"
  | "clap"
  | "hat"
  | "perc"
  | "crash"
  | "fx";

export interface SampleLayer {
  id: string;
  url: string;
  /** Velocity window 0..1 (inclusive). */
  minVelocity: number;
  maxVelocity: number;
  /** Root note for pitched samples (Tone note string). */
  rootNote?: string;
  /** Round-robin group identifier — samples sharing a group rotate. */
  roundRobinGroup?: string;
}

/**
 * Synthesis recipe used when no real samples are available. Each kit
 * piece authors a recipe + per-piece defaults so the fallback voice
 * still has a distinct character (the trap kick differs from boom-bap).
 */
export interface DrumSynthRecipe {
  engine: "kick" | "snare" | "clap" | "hat" | "tom" | "crash" | "fx";
  // Common knobs (subset used by each engine).
  pitch?: number; // base midi pitch
  decay?: number; // seconds
  octaves?: number;
  pitchDecay?: number; // membrane synth quirk
  noise?: "white" | "pink" | "brown";
  highpass?: number; // hz
  lowpass?: number; // hz
  Q?: number;
  drive?: number; // 0..1
  bodyLevelDb?: number;
  clickLevelDb?: number;
  layers?: number; // round-robin pool depth (default 3)
  pitchSpread?: number; // semitones of per-hit randomization for realism
}

export interface DrumPieceDef {
  id: DrumPiece;
  name: string;
  category: DrumCategory;
  /** Sample layers — empty array means "fallback synth only". */
  layers: SampleLayer[];
  synth: DrumSynthRecipe;
  chokeGroup?: string;
  defaultVolume: number; // 0..1
  defaultPan: number; // -1..1
  defaultPitch: number; // semitones
  defaultDecay: number; // 0..1
  defaultCutoff: number; // 0..1 of 20..20k log-ish
  defaultReverbSend: number; // 0..1
  defaultDelaySend: number; // 0..1
}

export interface DrumKitDef {
  id: DrumKitId;
  name: string;
  description: string;
  pieces: Record<DrumPiece, DrumPieceDef>;
}

// ---------- melodic presets ----------

export type MelodicPresetCategory =
  | "Keys"
  | "Bass"
  | "Pluck"
  | "Pad"
  | "Lead"
  | "Bell"
  | "Brass";

export type MelodicEngine =
  | "fmkeys"
  | "polysaw"
  | "monosaw"
  | "pluck"
  | "pad"
  | "bell"
  | "sub"
  | "808"
  | "brass"
  | "softkeys"
  | "sampler";

export interface MelodicSynthRecipe {
  engine: MelodicEngine;
  attack: number; // 0..1 (0..2 s)
  decay: number; // 0..1
  sustain: number; // 0..1
  release: number; // 0..1 (0..3 s)
  cutoff: number; // 0..1
  resonance: number; // 0..1
  width: number; // 0..1 stereo spread
  drive: number; // 0..1
  glide: number; // seconds (0..0.4)
  reverbSend: number; // 0..1
  delaySend: number; // 0..1
  chorusSend: number; // 0..1
  mono?: boolean;
  octave?: number; // transpose
  pitchEnv?: number; // semitones decay env (for 808 etc.)
  sidechain?: number; // 0..1 simulated duck depth
}

/**
 * Short, workflow-level guidance shown beside an instrument. This is kept
 * as preset data so the browser can teach timbre and arrangement without a
 * heavyweight tutorial runtime or generic AI-generated advice.
 */
export interface PresetLearningGuide {
  family: string;
  register: string;
  character: string;
  listeningCue: string;
  creativeMove: string;
}

export interface MelodicPresetDef {
  id: string;
  name: string;
  category: MelodicPresetCategory;
  description: string;
  layers?: SampleLayer[];
  guide?: PresetLearningGuide;
  synth: MelodicSynthRecipe;
  /** Kinds this preset is appropriate for. UI uses this to filter the
   * browser when the user is on a specific track kind. */
  compatibleWith: ("piano" | "guitar" | "bass" | "drums" | "vocals")[];
}
