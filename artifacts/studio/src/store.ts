import { useSyncExternalStore } from "react";
import type {
  AnyPreset,
  InstrumentKind,
  MidiMapping,
  MidiTarget,
  NoteClip,
  NoteEvent,
  Project,
  Track,
} from "./types";

type Listener = () => void;

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

class Store {
  private listeners = new Set<Listener>();
  state: {
    project: Project;
    selectedTrackId: string;
    audioUnlocked: boolean;
    isRecording: boolean;
    isPlaying: boolean;
    countingIn: boolean;
    countInBeat: number;
    midiLearnTargetId: string | null;
    midiMonitor: Array<{
      id: string;
      type: string;
      data1: number;
      data2: number;
      device: string;
      ts: number;
    }>;
    showOnboarding: boolean;
    showHelp: boolean;
    statusMessage: string | null;
    statusVariant: "info" | "warn" | "error" | null;
    vocalDeviceId: string | null;
    countInTimers: { interval: number | null; timeout: number | null };
  };

  constructor(project: Project) {
    this.state = {
      project,
      selectedTrackId: project.tracks[0]?.id ?? "",
      audioUnlocked: false,
      isRecording: false,
      isPlaying: false,
      countingIn: false,
      countInBeat: 0,
      midiLearnTargetId: null,
      midiMonitor: [],
      showOnboarding: false,
      showHelp: false,
      statusMessage: null,
      statusVariant: null,
      vocalDeviceId: null,
      countInTimers: { interval: null, timeout: null },
    };
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.state;

  set(updater: Partial<typeof this.state> | ((s: typeof this.state) => Partial<typeof this.state>)) {
    const patch = typeof updater === "function" ? updater(this.state) : updater;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  patchProject(patch: Partial<Project>) {
    this.state = {
      ...this.state,
      project: { ...this.state.project, ...patch, updatedAt: Date.now() },
    };
    this.listeners.forEach((l) => l());
  }

  patchTrack(trackId: string, patch: Partial<Track>) {
    const tracks = this.state.project.tracks.map((t) =>
      t.id === trackId ? { ...t, ...patch } : t,
    );
    this.patchProject({ tracks });
  }

  setStatus(message: string | null, variant: "info" | "warn" | "error" | null = "info") {
    this.set({ statusMessage: message, statusVariant: variant });
    if (message) {
      window.setTimeout(() => {
        if (this.state.statusMessage === message) {
          this.set({ statusMessage: null, statusVariant: null });
        }
      }, 5000);
    }
  }

  // ---- track ops ----
  addNoteClip(trackId: string, clip: NoteClip) {
    const tracks = this.state.project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      // v1: replace existing clip on the same track to keep things simple
      return { ...t, noteClips: [clip] };
    });
    this.patchProject({ tracks });
  }

  addAudioClip(trackId: string, clip: { id: string; start: number; durationSec: number; blob: Blob }) {
    const tracks = this.state.project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      return { ...t, audioClips: [clip] };
    });
    this.patchProject({ tracks });
  }

  clearTrackClips(trackId: string) {
    this.patchTrack(trackId, { noteClips: [], audioClips: [] });
  }

  duplicateClip(trackId: string) {
    const t = this.state.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    if (t.noteClips.length > 0) {
      const c = t.noteClips[0];
      const dup: NoteClip = {
        id: newId(),
        start: c.start + c.length,
        length: c.length,
        notes: c.notes.map((n) => ({ ...n })),
      };
      this.patchTrack(trackId, { noteClips: [c, dup] });
    } else if (t.audioClips.length > 0) {
      // audio duplicate: reuse blob, offset by clip duration in beats
      const c = t.audioClips[0];
      const beatsPerSecond = this.state.project.bpm / 60;
      const lengthBeats = c.durationSec * beatsPerSecond;
      const dup = {
        id: newId(),
        start: c.start + lengthBeats,
        durationSec: c.durationSec,
        blob: c.blob,
        blobKey: c.blobKey,
      };
      this.patchTrack(trackId, { audioClips: [c, dup] });
    }
  }

  // ---- midi mapping ops ----
  beginMidiLearn(target: MidiTarget) {
    const id = newId();
    const label = midiTargetLabel(target, this.state.project);
    const mapping: MidiMapping = { id, signature: "", target, label };
    this.set({
      midiLearnTargetId: id,
      project: {
        ...this.state.project,
        midiMappings: [...this.state.project.midiMappings, mapping],
      },
    });
  }

  cancelMidiLearn() {
    if (!this.state.midiLearnTargetId) return;
    const mappings = this.state.project.midiMappings.filter(
      (m) => m.id !== this.state.midiLearnTargetId,
    );
    this.set({
      midiLearnTargetId: null,
      project: { ...this.state.project, midiMappings: mappings },
    });
  }

  bindMidiLearn(signature: string, deviceLabel: string) {
    const id = this.state.midiLearnTargetId;
    if (!id) return;
    const mappings = this.state.project.midiMappings.map((m) =>
      m.id === id ? { ...m, signature, label: `${m.label} ← ${deviceLabel}` } : m,
    );
    this.set({
      midiLearnTargetId: null,
      project: { ...this.state.project, midiMappings: mappings },
    });
  }

  removeMapping(id: string) {
    const mappings = this.state.project.midiMappings.filter((m) => m.id !== id);
    this.patchProject({ midiMappings: mappings });
  }

  pushMidiMonitor(entry: { type: string; data1: number; data2: number; device: string }) {
    const next = [
      { id: newId(), ts: Date.now(), ...entry },
      ...this.state.midiMonitor,
    ].slice(0, 20);
    this.set({ midiMonitor: next });
  }
}

export function midiTargetLabel(target: MidiTarget, project: Project): string {
  switch (target.kind) {
    case "transport-play":
      return "Transport: Play";
    case "transport-stop":
      return "Transport: Stop";
    case "transport-record":
      return "Transport: Record";
    case "metronome-toggle":
      return "Metronome";
    case "track-volume": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      return `${t?.name ?? "Track"} Volume`;
    }
    case "drum-pad":
      return `Drum Pad: ${target.pad}`;
  }
}

let storeInstance: Store | null = null;
export function getStore(initial?: Project) {
  if (!storeInstance) {
    if (!initial) throw new Error("Store not initialized");
    storeInstance = new Store(initial);
  }
  return storeInstance;
}

export function resetStore(project: Project) {
  storeInstance = new Store(project);
  // notify nothing — caller should re-render from root
}

export function useStore<T>(selector: (s: Store["state"]) => T): T {
  const store = getStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot()),
  );
}

export { Store };

// ---- factory helpers ----

export function makeId() {
  return newId();
}

export function makeTrack(
  kind: InstrumentKind,
  name: string,
  preset: AnyPreset,
): Track {
  return {
    id: newId(),
    name,
    kind,
    preset,
    volume: 0.78,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    noteClips: [],
    audioClips: [],
    fx: { reverb: kind === "vocals" ? 0.25 : 0.1, delay: 0, filter: 1 },
  };
}

export function defaultProject(): Project {
  return seedDemoProject();
}

// ---- demo project ----
// 4-bar loop. Beats are 0..16. Notes are encoded as Tone note strings for melodic, drum piece names for drums.
function seedDemoProject(): Project {
  const piano = makeTrack("piano", "Piano", "electric");
  const guitar = makeTrack("guitar", "Guitar", "clean");
  const drums = makeTrack("drums", "Drums", "acoustic");
  const bass = makeTrack("bass", "Bass", "finger");
  const vocals = makeTrack("vocals", "Vocals", "warm");
  vocals.armed = true;
  vocals.fx.reverb = 0.4;

  // Drums: kick on 1 & 3, snare on 2 & 4, hats on 8ths
  const drumNotes: NoteEvent[] = [];
  for (let bar = 0; bar < 4; bar++) {
    const base = bar * 4;
    drumNotes.push({ time: base + 0, note: "kick", duration: 0.25, velocity: 0.95 });
    drumNotes.push({ time: base + 2, note: "kick", duration: 0.25, velocity: 0.85 });
    drumNotes.push({ time: base + 1, note: "snare", duration: 0.25, velocity: 0.9 });
    drumNotes.push({ time: base + 3, note: "snare", duration: 0.25, velocity: 0.9 });
    for (let h = 0; h < 8; h++) {
      drumNotes.push({
        time: base + h * 0.5,
        note: "hat",
        duration: 0.125,
        velocity: h % 2 === 0 ? 0.55 : 0.4,
      });
    }
  }
  drums.noteClips = [{ id: makeId(), start: 0, length: 16, notes: drumNotes }];

  // Bass: A2 root walking
  const bassPattern = ["A2", "A2", "E2", "E2", "F2", "F2", "G2", "G2"];
  const bassNotes: NoteEvent[] = bassPattern.map((n, i) => ({
    time: i * 2,
    note: n,
    duration: 1.5,
    velocity: 0.85,
  }));
  bass.noteClips = [{ id: makeId(), start: 0, length: 16, notes: bassNotes }];

  // Piano: chords every two beats: Am, Am, E, E, F, F, G, G
  const chords: Record<string, string[]> = {
    Am: ["A3", "C4", "E4"],
    E: ["E3", "G#3", "B3"],
    F: ["F3", "A3", "C4"],
    G: ["G3", "B3", "D4"],
  };
  const progression = ["Am", "Am", "E", "E", "F", "F", "G", "G"];
  const pianoNotes: NoteEvent[] = [];
  progression.forEach((c, i) => {
    chords[c].forEach((n) => {
      pianoNotes.push({ time: i * 2, note: n, duration: 1.8, velocity: 0.7 });
    });
  });
  piano.noteClips = [{ id: makeId(), start: 0, length: 16, notes: pianoNotes }];

  // Guitar: arpeggio top notes of chords
  const guitarNotes: NoteEvent[] = [];
  progression.forEach((c, i) => {
    const top = chords[c][2];
    guitarNotes.push({ time: i * 2, note: top, duration: 0.4, velocity: 0.7 });
    guitarNotes.push({ time: i * 2 + 1, note: top, duration: 0.4, velocity: 0.6 });
  });
  guitar.noteClips = [{ id: makeId(), start: 0, length: 16, notes: guitarNotes }];

  return {
    id: newId(),
    name: "Cyber Dojo Demo",
    bpm: 96,
    bars: 4,
    loopEnabled: true,
    loopStartBeat: 0,
    loopEndBeat: 16,
    metronome: false,
    countIn: true,
    masterVolume: 0.8,
    tracks: [piano, guitar, drums, bass, vocals],
    midiMappings: [],
    updatedAt: Date.now(),
  };
}
