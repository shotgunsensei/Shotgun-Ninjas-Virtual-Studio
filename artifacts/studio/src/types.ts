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
  | "cinematic";

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
}

export interface NoteClip {
  id: string;
  // beats
  start: number;
  // beats
  length: number;
  notes: NoteEvent[];
}

export interface AudioClip {
  id: string;
  // beats
  start: number;
  // seconds — visible/audible length of the clip
  durationSec: number;
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
}

export type MidiTarget =
  | { kind: "transport-play" }
  | { kind: "transport-stop" }
  | { kind: "transport-record" }
  | { kind: "metronome-toggle" }
  | { kind: "track-volume"; trackId: string }
  | { kind: "drum-pad"; pad: string };

export interface MidiMapping {
  id: string;
  // matches incoming midi event signature
  signature: string; // e.g. "cc:74" or "note:36"
  target: MidiTarget;
  label: string;
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
  masterVolume: number;
  tracks: Track[];
  midiMappings: MidiMapping[];
  updatedAt: number;
  /** Project-level groove. Per-track grooves override individual fields. */
  globalGroove?: Partial<GrooveSettings>;
}
