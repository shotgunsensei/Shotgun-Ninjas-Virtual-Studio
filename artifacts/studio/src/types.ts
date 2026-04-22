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
}
