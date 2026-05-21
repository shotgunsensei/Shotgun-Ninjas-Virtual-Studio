export type InstrumentKind = "piano" | "guitar" | "drums" | "bass" | "vocals";

export type PianoPreset = "grand" | "electric" | "synth";
export type GuitarPreset = "clean" | "crunch" | "acoustic";
export type DrumsPreset = "acoustic" | "electronic" | "trap";
export type BassPreset = "finger" | "synth" | "sub";
export type VocalsPreset = "clean" | "warm" | "lofi";

export type AnyPreset =
  | PianoPreset
  | GuitarPreset
  | DrumsPreset
  | BassPreset
  | VocalsPreset;

// ---- v2 sound model (additive, backward-compatible) ----
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

export interface DrumPieceSettings {
  volume: number;       // 0..1 multiplier on the piece channel
  pan: number;          // -1..1
  pitch: number;        // semitones, -12..+12
  decay: number;        // 0..1 (multiplier on default decay)
  cutoff: number;       // 0..1 (lowpass cutoff fraction)
  reverbSend: number;   // 0..1
  delaySend: number;    // 0..1
  muted: boolean;
  solo: boolean;
}

// ---- v2 mixer / effects rack / send buses ----

/** 3-band EQ + high-pass per channel strip. Gains are -12..+12 dB. */
export interface TrackEq {
  low: number;
  mid: number;
  high: number;
  hpfOn: boolean;
  hpfHz: number; // 20..400
}

/** Four named global send buses. Same ids on every track. */
export type SendBusId = "roomReverb" | "neonHall" | "tapeDelay" | "darkSlapback";

export const SEND_BUS_IDS: SendBusId[] = [
  "roomReverb",
  "neonHall",
  "tapeDelay",
  "darkSlapback",
];

export const SEND_BUS_LABELS: Record<SendBusId, string> = {
  roomReverb: "Room Reverb",
  neonHall: "Neon Hall",
  tapeDelay: "Tape Delay",
  darkSlapback: "Dark Slapback",
};

export type TrackSends = Record<SendBusId, number>; // 0..1

/** Per-track effect modules. All optional; engine creates the node on enable. */
export type FxModuleId =
  | "eq"
  | "compressor"
  | "saturation"
  | "delay"
  | "reverb"
  | "chorus"
  | "bitcrusher"
  | "stereoWidth";

export interface FxModuleSettings {
  enabled: boolean;
  /** Module preset id, or "custom" when params have been edited. */
  preset?: string;
  /** 0..1 wet/dry or amount. Some modules ignore this. */
  amount?: number;
  /** Module-specific params, 0..1 each. */
  params?: Record<string, number>;
}

export type FxRack = Partial<Record<FxModuleId, FxModuleSettings>>;

/** Channel-strip metadata (color, icon, source). */
export interface ChannelStripMeta {
  color?: string; // tailwind/hex token (e.g. "#ef4444")
  icon?: string;  // lucide icon name; UI maps to component
  sourceLabel?: string; // e.g. "MIDI", "Sample", "Live"
}

/** Master-bus mix settings, persisted on the project. */
export interface MasterBusSettings {
  limiterThresholdDb: number; // -24..0
  limiterGainDb: number; // -12..+12 (post-limiter makeup)
  glueEnabled: boolean;
  glueThresholdDb: number; // -36..0
  glueRatio: number; // 1..10
  glueAttack: number; // seconds 0..0.1
  glueRelease: number; // seconds 0.05..1
  softClip: boolean;
  width: number; // 0..2 (1 = natural, 0 = mono, 2 = wide)
}

export type MixPresetId =
  | "clean"
  | "punchy"
  | "loudDemo"
  | "lofiDust"
  | "darkCinematic"
  | "wideNeon";

export interface SoundParams {
  attack: number;       // 0..1 (mapped to 0..2s)
  decay: number;        // 0..1
  sustain: number;      // 0..1
  release: number;      // 0..1 (mapped to 0..3s)
  cutoff: number;       // 0..1
  resonance: number;    // 0..1
  reverbSend: number;   // 0..1
  delaySend: number;    // 0..1
  chorusSend: number;   // 0..1
  width: number;        // 0..1
  drive: number;        // 0..1
  glide: number;        // seconds 0..0.4
}

export type GrooveTemplateId =
  | "straight"
  | "slight-push"
  | "lazy-pocket"
  | "trap-bounce"
  | "boom-bap-drag"
  | "mechanical-tight"
  | "drunken-ninja";

export interface GrooveSettings {
  template: GrooveTemplateId;
  swing: number;           // 0..1 (additive on top of template swing)
  humanizeTiming: number;  // 0..1 (scales template ms variance)
  humanizeVelocity: number; // 0..1
  /** Optional per-16th-step probability overrides (length 16, values 0..1).
   *  When present, overrides the template's per-step probability. */
  stepProbability?: number[];
  /** Optional per-16th-step flam toggles (length 16). When true on a step,
   *  that step always flams regardless of template probability. */
  stepFlam?: boolean[];
}

export interface NoteEvent {
  // beats from start of clip
  time: number;
  // tone.js note string for melodic; for drums, this is the drum piece id
  note: string;
  // beats
  duration: number;
  velocity: number;
  // ---- v2 per-step fields (all optional, backward-compatible) ----
  /** 0..1 chance the step fires. Missing = always fires. */
  probability?: number;
  /** Beats of timing nudge applied at schedule time. */
  microTiming?: number;
  /** Number of quick hits to fire across the step (>=1). 1 = no retrigger. */
  retrigger?: number;
  /** If true, schedule a quiet grace-note slightly before the main hit. */
  flam?: boolean;
  /** If true, boost effective velocity (and render brighter). */
  accent?: boolean;
  /** Phase 11: If true, play audio clip reversed. */
  reversed?: boolean;
}

// ---- Phase 11: Automation & Modulation ----

/** Automatable parameter identifiers for the per-track automation engine. */
export type AutomationParamId =
  | "volume"
  | "pan"
  | "filterCutoff"
  | "reverbSend"
  | "delaySend"
  | "distortionAmount"
  | "pitch"
  | "sampleStart"
  | "effectWetDry";

/** Ordered list of all automatable param ids (used for pickers and iteration). */
export const AUTOMATION_PARAM_IDS: AutomationParamId[] = [
  "volume",
  "pan",
  "filterCutoff",
  "reverbSend",
  "delaySend",
  "distortionAmount",
  "pitch",
  "sampleStart",
  "effectWetDry",
];

export const AUTOMATION_PARAM_LABELS: Record<AutomationParamId, string> = {
  volume: "Volume",
  pan: "Pan",
  filterCutoff: "Filter Cutoff",
  reverbSend: "Reverb Send",
  delaySend: "Delay Send",
  distortionAmount: "Distortion",
  pitch: "Pitch",
  sampleStart: "Sample Start",
  effectWetDry: "FX Wet/Dry",
};

/** Default normalized value (0..1) for each automatable param. */
export const AUTOMATION_PARAM_DEFAULTS: Record<AutomationParamId, number> = {
  volume: 0.78,
  pan: 0.5,
  filterCutoff: 1,
  reverbSend: 0.1,
  delaySend: 0,
  distortionAmount: 0,
  pitch: 0.5,
  sampleStart: 0,
  effectWetDry: 0,
};

/** A single breakpoint on an automation curve: position in beats + normalized value. */
export interface AutomationBreakpoint {
  beat: number;
  value: number; // 0..1 normalized
}

export type AutomationInterpolation = "linear" | "smooth";

/** One automation lane for a single parameter on a track. */
export interface AutomationLane {
  id: string;
  param: AutomationParamId;
  breakpoints: AutomationBreakpoint[];
  interpolation: AutomationInterpolation;
}

// ---- Modulation Sources ----

export type ModulationSourceType =
  | "lfo"
  | "envelopeFollower"
  | "randomDrift"
  | "stepMod"
  | "sidechainEnv";

export interface LfoSettings {
  shape: "sine" | "triangle" | "square" | "sawtooth";
  rate: number;  // Hz, 0.01..20
  depth: number; // 0..1
  phase: number; // 0..360 degrees
}

export interface EnvelopeFollowerSettings {
  attack: number;     // 0..1
  release: number;    // 0..1
  sourceTrackId: string;
}

export interface RandomDriftSettings {
  rate: number;      // Hz, 0.01..10
  smoothing: number; // 0..1
}

export interface StepModSettings {
  steps: number[];   // up to 16 values, each 0..1
  rate: number;      // beats per step
  glide: number;     // 0..1
}

export interface SidechainEnvSettings {
  sourceTrackId: string;
  attack: number;
  release: number;
  depth: number;
}

export interface ModulationSource {
  id: string;
  type: ModulationSourceType;
  label: string;
  lfo?: LfoSettings;
  envelopeFollower?: EnvelopeFollowerSettings;
  randomDrift?: RandomDriftSettings;
  stepMod?: StepModSettings;
  sidechainEnv?: SidechainEnvSettings;
}

/** Routes one modulation source's output to a track parameter with a depth scale. */
export interface ModulationRouting {
  id: string;
  sourceId: string;
  trackId: string;
  param: AutomationParamId;
  depth: number; // -1..1 (0 = no effect, 1 = full positive, -1 = full negative)
}

/** Division selector for the step sequencer / piano roll. */
export type StepDivision = "1/4" | "1/8" | "1/16" | "1/16T" | "1/32";

export interface NoteClip {
  id: string;
  // beats
  start: number;
  // beats
  length: number;
  notes: NoteEvent[];
  /** Optional user-visible name for the clip block (e.g. "Verse hook"). */
  name?: string;
  /** Optional color (CSS hex/hsl) for color-coding clip blocks. */
  color?: string;
  // ---- v2 sequencer fields (all optional, backward-compatible) ----
  /** Number of bars (4/4). Falls back to round(length/4). */
  bars?: number;
  /** Step grid division. Falls back to "1/16". */
  division?: StepDivision;
  /** Optional scale highlight for melodic piano roll. */
  scaleRoot?: string;
  scaleMode?: "major" | "minor" | "pentMajor" | "pentMinor" | "dorian" | "chromatic";
}

export interface AudioClip {
  id: string;
  // beats
  start: number;
  // seconds — visible/audible length of the clip
  durationSec: number;
  /** Phase 11: If true, play this clip reversed. */
  reversed?: boolean;
  // seconds — playback offset into the underlying blob; advances when the
  // user trims the left edge so the audio that remains visible keeps
  // playing from the correct sample.
  offsetSec?: number;
  // seconds — full length of the underlying recording, captured when the
  // clip is added. Used to clamp resize so the user can't grow a trimmed
  // clip past the available audio. Falls back to durationSec when unset
  // (e.g. for clips created before this field existed).
  sourceDurationSec?: number;
  blob?: Blob; // not serialized to JSON; persisted separately
  blobKey?: string; // IndexedDB key
  /** Optional user-visible name for the clip block. */
  name?: string;
  /** Optional color (CSS hex/hsl) for color-coding clip blocks. */
  color?: string;
}

/** Named section flag dropped on the arrangement timeline. */
export type SectionLabel =
  | "Intro"
  | "Verse"
  | "Hook"
  | "Bridge"
  | "Outro"
  | string;

export interface Section {
  id: string;
  /** Bar position on the timeline (0-indexed). */
  bar: number;
  label: SectionLabel;
  /** Optional color for the flag; falls back to label-based palette. */
  color?: string;
}

export interface Track {
  id: string;
  name: string;
  kind: InstrumentKind;
  preset: AnyPreset;
  volume: number; // 0..1
  pan: number; // -1..1
  muted: boolean;
  solo: boolean;
  armed: boolean;
  noteClips: NoteClip[];
  audioClips: AudioClip[];
  fx: {
    reverb: number; // 0..1
    delay: number; // 0..1
    filter: number; // 0..1 (lowpass cutoff fraction)
  };
  // ---- v2 sound model (all optional, backward-compatible) ----
  /** New drum-kit id. When set, overrides the legacy `preset` for drums. */
  kitId?: DrumKitId;
  /** New melodic preset id from the preset library. Overrides legacy `preset`. */
  presetId?: string;
  /** Per-drum-piece mixer overrides. Each value can be partial. */
  pieceSettings?: Partial<Record<string, Partial<DrumPieceSettings>>>;
  /** Per-track sound parameters (ADSR / filter / sends / width). */
  sound?: Partial<SoundParams>;
  /** Per-track groove settings; missing means inherit project default. */
  groove?: Partial<GrooveSettings>;
  // ---- v2 mixer ----
  /** 3-band EQ + HPF; missing means flat / off. */
  eq?: TrackEq;
  /** Sends to the named global buses; missing means all zero. */
  sends?: Partial<TrackSends>;
  /** Per-track effect rack (modules + params). */
  fxRack?: FxRack;
  /** Channel-strip metadata (color, icon, source label). */
  meta?: ChannelStripMeta;
  /** Phase 11: Per-track automation lanes (one per param). */
  automationLanes?: AutomationLane[];
}

export type MidiTarget =
  | { kind: "transport-play" }
  | { kind: "transport-stop" }
  | { kind: "transport-record" }
  | { kind: "metronome-toggle" }
  | { kind: "track-volume"; trackId: string }
  | { kind: "track-pan"; trackId: string }
  | { kind: "track-send"; trackId: string; busId: SendBusId }
  | { kind: "track-eq"; trackId: string; band: "low" | "mid" | "high" | "hpf" }
  | { kind: "fx-amount"; trackId: string; moduleId: FxModuleId }
  | { kind: "drum-pad"; pad: string };

export interface MidiMapping {
  id: string;
  // matches incoming midi event signature
  signature: string; // e.g. "cc:74" or "note:36"
  target: MidiTarget;
  label: string;
}

/**
 * Sample library entry — an imported or recorded audio sample that can be
 * reused across the project (placed on a vocal/audio track, or assigned
 * to a drum pad). Blobs are persisted separately in IndexedDB via blobKey.
 */
export interface SampleLibraryItem {
  id: string;
  name: string;
  blobKey: string;
  durationSec: number;
  createdAt: number;
  blob?: Blob;
}

/**
 * Optional human-readable project metadata. Stamped on export, editable
 * via the Project Info dialog. None of these fields affect playback —
 * they're purely descriptive so shared `.snproj.json` files carry their
 * own context.
 */
export interface ProjectMetadata {
  /** Free-form creator / artist name. */
  creator?: string;
  /** Short description shown in the import summary. */
  description?: string;
  /** Free-form tag list. Trimmed, lowercased on save. */
  tags?: string[];
  /** Mood label (e.g. "chill", "aggressive"). */
  mood?: string;
  /** Genre label (e.g. "trap", "lofi"). */
  genre?: string;
}

export type ScaleId =
  | "chromatic"
  | "major"
  | "minor"
  | "pentatonic_major"
  | "pentatonic_minor"
  | "blues"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "harmonic_minor"
  | "whole_tone";

export type ChordType =
  | "none"
  | "power"
  | "major_triad"
  | "minor_triad"
  | "major7"
  | "minor7"
  | "dom7"
  | "sus2"
  | "sus4";

export type BasslinePatternId = "quarters" | "offbeat" | "walking";

export type InputSource = "midi" | "keyboard" | "gamepad";

export interface GamepadMapping {
  buttonIndex: number;
  note: number;
  label: string;
}

/** Performance mode preferences — persisted with the project. */
export interface PerformanceSettings {
  /** Whether the performance overlay is currently open. */
  open: boolean;
  /** Which input source feeds the performance layer. */
  inputSource: InputSource;
  /** Scale lock enabled. */
  scaleLock: boolean;
  /** Root note semitone (0=C … 11=B). */
  scaleRoot: number;
  /** Active scale mode. */
  scaleId: ScaleId;
  /** Chord mode enabled. */
  chordMode: boolean;
  /** Active chord type. */
  chordType: ChordType;
  /** One-finger bassline mode enabled. */
  basslineMode: boolean;
  /** Active bassline pattern. */
  basslinePatternId: BasslinePatternId;
  /** Gamepad button → MIDI note mappings. */
  gamepadMappings?: GamepadMapping[];
}

export interface Project {
  id: string;
  name: string;
  bpm: number;
  // bars in timeline (4/4)
  bars: number;
  loopEnabled: boolean;
  loopStartBeat: number;
  loopEndBeat: number;
  metronome: boolean;
  countIn: boolean;
  /** Length of the count-in in bars (1 or 2). Defaults to 1 if absent. */
  countInBars?: 1 | 2;
  masterVolume: number;
  tracks: Track[];
  midiMappings: MidiMapping[];
  /** Reusable sample library (imported files, recordings). */
  samples?: SampleLibraryItem[];
  /** Ordered list of section markers placed on the arrangement ruler. */
  sections?: Section[];
  updatedAt: number;
  /** Project-level groove. Per-track grooves override individual fields. */
  globalGroove?: Partial<GrooveSettings>;
  /** v2: master-bus mix settings (limiter / glue comp / soft-clip / width). */
  masterBus?: MasterBusSettings;
  /** v2: currently-applied mix preset id (purely informational; the
   *  actual values live on the tracks and `masterBus`). */
  mixPresetId?: MixPresetId;
  /** Project schema version. Stamped by `migrateProject` on every load
   *  so older files can be auto-upgraded. Missing = legacy v1. */
  schemaVersion?: number;
  /** Wall-clock time the project was first created. Defaulted to
   *  `updatedAt` for legacy projects on migration. */
  createdAt?: number;
  /** Human-readable metadata (creator, description, tags, mood, genre).
   *  All fields are optional and editable from the Project Info dialog. */
  metadata?: ProjectMetadata;
  /** Active Sound Library pack id (from soundLibrary.ts). Persisted so
   *  the pack badge shows correctly on reload. Does not affect playback
   *  directly — the kit/preset ids on each track are the authoritative
   *  sound selectors. */
  soundPackId?: string;
  /** Phase 13: Performance mode settings (persisted per project). */
  performance?: PerformanceSettings;
  /** Phase 11: Global modulation sources (LFO, Envelope Follower, etc.). */
  modulationSources?: ModulationSource[];
  /** Phase 11: Modulation routings (source → track param). */
  modulationRoutings?: ModulationRouting[];
}
