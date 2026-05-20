import { useSyncExternalStore } from "react";
import { audio } from "./lib/audio/engine";
import { DEFAULT_MASTER_BUS } from "./lib/audio/master";
import { applyMixPreset, DEFAULTS } from "./lib/audio/mixPresets";
import type {
  AnyPreset,
  FxModuleId,
  FxModuleSettings,
  InstrumentKind,
  MasterBusSettings,
  MidiMapping,
  MidiTarget,
  MixPresetId,
  NoteClip,
  NoteEvent,
  Project,
  Section,
  SendBusId,
  Track,
  TrackEq,
} from "./types";
import { SEND_BUS_LABELS } from "./types";

type Listener = () => void;

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

class Store {
  private listeners = new Set<Listener>();
  state: {
    project: Project;
    selectedTrackId: string;
    selectedClipId: string | null;
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
    dropTargetTrackId: string | null;
    showOnboarding: boolean;
    showHelp: boolean;
    /** True when the current project came from `loadDemo` and has never
     * been explicitly saved by the user. The autosave loop skips this
     * project so demos don't pollute the saved-projects list. Cleared on
     * Save / Save As or when a real project is loaded. */
    isTransientProject: boolean;
    /** When true, the Header opens its Load/Demo picker dialog. Set by
     * other components (e.g. HelpDialog "Load a Demo" shortcut) to
     * surface the demo picker without duplicating the dialog markup. */
    requestOpenLoadDialog: boolean;
    statusMessage: string | null;
    statusVariant: "info" | "warn" | "error" | null;
    vocalDeviceId: string | null;
    countInTimers: { interval: number | null; timeout: number | null };
    /** Pending sample to surface in the SamplePreviewDialog. */
    pendingSample: {
      blob: Blob;
      defaultName: string;
      recordedTrackId?: string;
    } | null;
  };

  constructor(project: Project) {
    this.state = {
      project,
      selectedTrackId: project.tracks[0]?.id ?? "",
      selectedClipId: null,
      audioUnlocked: false,
      isRecording: false,
      isPlaying: false,
      countingIn: false,
      countInBeat: 0,
      midiLearnTargetId: null,
      midiMonitor: [],
      dropTargetTrackId: null,
      showOnboarding: false,
      showHelp: false,
      isTransientProject: false,
      requestOpenLoadDialog: false,
      statusMessage: null,
      statusVariant: null,
      vocalDeviceId: null,
      countInTimers: { interval: null, timeout: null },
      pendingSample: null,
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

  // ---- v2 mixer ops ----

  /** Patch the EQ on a single track and forward the diff to the engine. */
  setTrackEq(trackId: string, patch: Partial<TrackEq>) {
    const t = this.state.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const cur = t.eq ?? DEFAULTS.flatEq();
    const next: TrackEq = { ...cur, ...patch };
    this.patchTrack(trackId, { eq: next });
    audio.setTrackEq(trackId, patch);
    // Edits invalidate the mix preset id (project is no longer "pure preset").
    if (this.state.project.mixPresetId) {
      this.patchProject({ mixPresetId: undefined });
    }
  }

  /** Patch one send amount (0..1) and forward to the engine. */
  setTrackSend(trackId: string, busId: SendBusId, amount: number) {
    const t = this.state.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const cur = { ...DEFAULTS.zeroSends(), ...(t.sends ?? {}) };
    cur[busId] = Math.max(0, Math.min(1, amount));
    this.patchTrack(trackId, { sends: cur });
    audio.setTrackSend(trackId, busId, cur[busId]);
    if (this.state.project.mixPresetId) {
      this.patchProject({ mixPresetId: undefined });
    }
  }

  /** Patch a single FX module on a track (enable/disable + tweak). */
  setFxModule(
    trackId: string,
    moduleId: FxModuleId,
    patch: Partial<FxModuleSettings>,
  ) {
    const t = this.state.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const rack = { ...(t.fxRack ?? {}) };
    const cur = rack[moduleId] ?? { enabled: false };
    const next: FxModuleSettings = { ...cur, ...patch };
    rack[moduleId] = next;
    this.patchTrack(trackId, { fxRack: rack });
    audio.setEffectModule(trackId, moduleId, next);
    if (this.state.project.mixPresetId) {
      this.patchProject({ mixPresetId: undefined });
    }
  }

  /** Reset an FX module back to disabled defaults. */
  resetFxModule(trackId: string, moduleId: FxModuleId) {
    this.setFxModule(trackId, moduleId, { enabled: false, amount: 0.5, params: {} });
  }

  /** Patch master-bus settings and push the diff to the engine. */
  setMasterBus(patch: Partial<MasterBusSettings>) {
    const cur = this.state.project.masterBus ?? { ...DEFAULT_MASTER_BUS };
    const next = { ...cur, ...patch };
    this.patchProject({ masterBus: next });
    audio.setMasterBus(patch);
  }

  /** Apply one of the 6 named mix presets. Rewrites per-track mix fields
   *  + master bus in one shot, then flushes the new values to the engine. */
  applyMixPreset(id: MixPresetId) {
    const next = applyMixPreset(this.state.project, id);
    this.state = { ...this.state, project: next };
    this.listeners.forEach((l) => l());
    flushMixToEngine(next);
    this.setStatus(`Mix preset applied: ${id}`, "info");
  }

  /** Update the project-wide groove default. Pushed to engine so the
   *  next scheduleClip merges it under per-track overrides. */
  setGlobalGroove(patch: Partial<import("./types").GrooveSettings>) {
    const cur = this.state.project.globalGroove ?? {};
    const merged = { ...cur, ...patch };
    audio.setGlobalGroove(merged);
    this.patchProject({ globalGroove: merged });
  }

  /** Stamp a groove onto every track in one click — useful for "apply
   *  current pocket to the whole arrangement". */
  applyGrooveToAllTracks(g: Partial<import("./types").GrooveSettings>) {
    const tracks = this.state.project.tracks.map((t) => ({
      ...t,
      groove: { ...(t.groove ?? {}), ...g },
    }));
    this.patchProject({ tracks });
  }

  /** Clear a single track's groove overrides so it falls back to the
   *  project-wide global groove. */
  resetTrackGroove(trackId: string) {
    const tracks = this.state.project.tracks.map((t) =>
      t.id === trackId ? { ...t, groove: undefined } : t,
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
    // Append the take alongside any existing clips so songwriters can
    // layer multiple passes on the same track.
    const tracks = this.state.project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      return { ...t, noteClips: [...t.noteClips, clip] };
    });
    this.patchProject({ tracks });
  }

  updateNoteClip(trackId: string, clip: NoteClip) {
    // In-place replacement of an existing clip identified by id (used for
    // editing a clip's notes such as the drum step sequencer). Falls back
    // to append if no clip with that id exists.
    const tracks = this.state.project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const idx = t.noteClips.findIndex((c) => c.id === clip.id);
      if (idx === -1) return { ...t, noteClips: [...t.noteClips, clip] };
      const next = t.noteClips.slice();
      next[idx] = clip;
      return { ...t, noteClips: next };
    });
    this.patchProject({ tracks });
  }

  addAudioClip(trackId: string, clip: { id: string; start: number; durationSec: number; blob: Blob }) {
    // Capture the original recording length so resize can later clamp
    // right-edge growth to the actual available audio.
    const stored = { ...clip, sourceDurationSec: clip.durationSec };
    const tracks = this.state.project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      return { ...t, audioClips: [...t.audioClips, stored] };
    });
    this.patchProject({ tracks });
  }

  removeClip(trackId: string, clipId: string) {
    const tracks = this.state.project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        noteClips: t.noteClips.filter((c) => c.id !== clipId),
        audioClips: t.audioClips.filter((c) => c.id !== clipId),
      };
    });
    this.patchProject({ tracks });
    if (this.state.selectedClipId === clipId) {
      this.set({ selectedClipId: null });
    }
  }

  /**
   * Resize a clip by dragging one of its edges. `deltaBeats` is signed:
   *   - right edge: positive grows the clip, negative shrinks it.
   *   - left edge: positive trims from the front (start moves right, length
   *     shrinks); negative grows the front. The visible musical content
   *     stays anchored to the same absolute beat positions, matching the
   *     drag preview.
   * Snapped to the same 0.25-beat grid as moveClip and clamped so the clip
   * never has a non-positive length and never starts before beat 0.
   */
  resizeClip(
    trackId: string,
    clipId: string,
    edge: "left" | "right",
    deltaBeats: number,
  ) {
    const SNAP = 0.25;
    const MIN_LEN = SNAP;
    const bpm = this.state.project.bpm;
    const beatsPerSecond = bpm / 60;
    const tracks = this.state.project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const noteClips = t.noteClips.map((c) => {
        if (c.id !== clipId) return c;
        if (edge === "right") {
          const newLength = Math.max(MIN_LEN, c.length + deltaBeats);
          return { ...c, length: newLength };
        }
        // left edge: clamp shift so start stays >= 0 and length stays > 0
        const shift = Math.max(
          -c.start,
          Math.min(c.length - MIN_LEN, deltaBeats),
        );
        return {
          ...c,
          start: c.start + shift,
          length: c.length - shift,
          // shift note times so the visible musical content stays in place;
          // notes that fall outside [0, length) are kept in the data so the
          // user can grow the clip back, but the engine filters them at
          // schedule time.
          notes: c.notes.map((n) => ({ ...n, time: n.time - shift })),
        };
      });
      const audioClips = t.audioClips.map((c) => {
        if (c.id !== clipId) return c;
        const minLenSec = MIN_LEN / beatsPerSecond;
        const offset = c.offsetSec ?? 0;
        // The full underlying recording length. For clips that predate
        // the field, fall back to the current visible window so we never
        // grow past where audio is known to exist.
        const sourceDuration = c.sourceDurationSec ?? offset + c.durationSec;
        if (edge === "right") {
          const deltaSec = deltaBeats / beatsPerSecond;
          // Cap growth to the audio remaining after the current offset.
          const maxLenSec = Math.max(minLenSec, sourceDuration - offset);
          const newDuration = Math.max(
            minLenSec,
            Math.min(maxLenSec, c.durationSec + deltaSec),
          );
          return { ...c, durationSec: newDuration };
        }
        // left edge: shrinking moves start right and reduces durationSec by
        // the same musical amount; offsetSec advances so playback skips the
        // trimmed sample range.
        // beat-shift clamps:
        //   shift <= durationSec - minLenSec (in beats)  -> length stays > 0
        //   shift >= -start                              -> start stays >= 0
        //   shift >= -offsetSec_in_beats                 -> can't expand past sample 0
        const offsetBeats = offset * beatsPerSecond;
        const maxShrinkBeats = c.durationSec * beatsPerSecond - MIN_LEN;
        const shift = Math.max(
          Math.max(-c.start, -offsetBeats),
          Math.min(maxShrinkBeats, deltaBeats),
        );
        const shiftSec = shift / beatsPerSecond;
        return {
          ...c,
          start: c.start + shift,
          durationSec: c.durationSec - shiftSec,
          offsetSec: offset + shiftSec,
        };
      });
      return { ...t, noteClips, audioClips };
    });
    this.patchProject({ tracks });
  }

  moveClip(
    trackId: string,
    clipId: string,
    newStart: number,
    destTrackId?: string,
  ) {
    const start = Math.max(0, newStart);
    const src = this.state.project.tracks.find((t) => t.id === trackId);
    if (!src) return;
    const dest =
      destTrackId && destTrackId !== trackId
        ? this.state.project.tracks.find((t) => t.id === destTrackId)
        : null;

    if (!dest) {
      // same-track move (existing behavior)
      const tracks = this.state.project.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          noteClips: t.noteClips.map((c) =>
            c.id === clipId ? { ...c, start } : c,
          ),
          audioClips: t.audioClips.map((c) =>
            c.id === clipId ? { ...c, start } : c,
          ),
        };
      });
      this.patchProject({ tracks });
      return;
    }

    // Cross-track move. Honor the same compatibility rules surfaced by
    // canDropClipOnTrack so callers don't have to repeat the check.
    const noteClip = src.noteClips.find((c) => c.id === clipId);
    const audioClip = src.audioClips.find((c) => c.id === clipId);
    if (noteClip) {
      if (dest.kind === "vocals") return;
      const tracks = this.state.project.tracks.map((t) => {
        if (t.id === trackId) {
          return {
            ...t,
            noteClips: t.noteClips.filter((c) => c.id !== clipId),
          };
        }
        if (t.id === destTrackId) {
          return {
            ...t,
            noteClips: [...t.noteClips, { ...noteClip, start }],
          };
        }
        return t;
      });
      this.patchProject({ tracks });
      this.set({ selectedTrackId: destTrackId! });
    } else if (audioClip) {
      if (dest.kind !== "vocals") return;
      const tracks = this.state.project.tracks.map((t) => {
        if (t.id === trackId) {
          return {
            ...t,
            audioClips: t.audioClips.filter((c) => c.id !== clipId),
          };
        }
        if (t.id === destTrackId) {
          return {
            ...t,
            audioClips: [...t.audioClips, { ...audioClip, start }],
          };
        }
        return t;
      });
      this.patchProject({ tracks });
      this.set({ selectedTrackId: destTrackId! });
    }
  }

  selectClip(clipId: string | null) {
    this.set({ selectedClipId: clipId });
  }

  clearTrackClips(trackId: string) {
    this.patchTrack(trackId, { noteClips: [], audioClips: [] });
    this.set({ selectedClipId: null });
  }

  /** Rename a clip block on the arrangement timeline. */
  renameClip(trackId: string, clipId: string, name: string) {
    const trimmed = name.trim();
    const tracks = this.state.project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        noteClips: t.noteClips.map((c) =>
          c.id === clipId ? { ...c, name: trimmed || undefined } : c,
        ),
        audioClips: t.audioClips.map((c) =>
          c.id === clipId ? { ...c, name: trimmed || undefined } : c,
        ),
      };
    });
    this.patchProject({ tracks });
  }

  /** Set a color-code on a clip block (CSS color). Pass null to clear. */
  setClipColor(trackId: string, clipId: string, color: string | null) {
    const value = color || undefined;
    const tracks = this.state.project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        noteClips: t.noteClips.map((c) =>
          c.id === clipId ? { ...c, color: value } : c,
        ),
        audioClips: t.audioClips.map((c) =>
          c.id === clipId ? { ...c, color: value } : c,
        ),
      };
    });
    this.patchProject({ tracks });
  }

  /** Duplicate a specific clip on its track, placing the copy right after it. */
  duplicateClipById(trackId: string, clipId: string) {
    const t = this.state.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const note = t.noteClips.find((c) => c.id === clipId);
    if (note) {
      const dup: NoteClip = {
        ...note,
        id: newId(),
        start: note.start + note.length,
        notes: note.notes.map((n) => ({ ...n })),
      };
      this.patchTrack(trackId, { noteClips: [...t.noteClips, dup] });
      this.set({ selectedClipId: dup.id });
      return;
    }
    const audioClip = t.audioClips.find((c) => c.id === clipId);
    if (audioClip) {
      const beatsPerSecond = this.state.project.bpm / 60;
      const lengthBeats = audioClip.durationSec * beatsPerSecond;
      const dup = {
        ...audioClip,
        id: newId(),
        start: audioClip.start + lengthBeats,
      };
      this.patchTrack(trackId, { audioClips: [...t.audioClips, dup] });
      this.set({ selectedClipId: dup.id });
    }
  }

  // ---- section ops ----
  addSection(bar: number, label: string) {
    const sections = [...(this.state.project.sections ?? [])];
    const totalBars = this.state.project.bars;
    const clamped = Math.max(0, Math.min(totalBars, Math.round(bar)));
    const s: Section = { id: newId(), bar: clamped, label };
    sections.push(s);
    sections.sort((a, b) => a.bar - b.bar);
    this.patchProject({ sections });
  }

  renameSection(id: string, label: string) {
    const sections = (this.state.project.sections ?? []).map((s) =>
      s.id === id ? { ...s, label } : s,
    );
    this.patchProject({ sections });
  }

  moveSection(id: string, bar: number) {
    const totalBars = this.state.project.bars;
    const clamped = Math.max(0, Math.min(totalBars, Math.round(bar)));
    const sections = (this.state.project.sections ?? [])
      .map((s) => (s.id === id ? { ...s, bar: clamped } : s))
      .sort((a, b) => a.bar - b.bar);
    this.patchProject({ sections });
  }

  removeSection(id: string) {
    const sections = (this.state.project.sections ?? []).filter(
      (s) => s.id !== id,
    );
    this.patchProject({ sections });
  }

  /** Set the loop region in beats; clamps so start < end and within bars. */
  setLoopRegion(startBeat: number, endBeat: number) {
    const totalBeats = this.state.project.bars * 4;
    const SNAP = 0.25;
    const snap = (b: number) =>
      Math.max(0, Math.min(totalBeats, Math.round(b / SNAP) * SNAP));
    let s = snap(startBeat);
    let e = snap(endBeat);
    if (e <= s) e = Math.min(totalBeats, s + SNAP);
    this.patchProject({ loopStartBeat: s, loopEndBeat: e });
  }

  duplicateClip(trackId: string) {
    const t = this.state.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const selectedId = this.state.selectedClipId;
    const selectedNote = selectedId
      ? t.noteClips.find((c) => c.id === selectedId)
      : undefined;
    const selectedAudio = selectedId
      ? t.audioClips.find((c) => c.id === selectedId)
      : undefined;
    const noteSrc = selectedNote ?? t.noteClips[0];
    const audioSrc = selectedAudio ?? t.audioClips[0];
    if (selectedNote || (!selectedAudio && noteSrc)) {
      if (!noteSrc) return;
      const dup: NoteClip = {
        id: newId(),
        start: noteSrc.start + noteSrc.length,
        length: noteSrc.length,
        notes: noteSrc.notes.map((n) => ({ ...n })),
      };
      this.patchTrack(trackId, { noteClips: [...t.noteClips, dup] });
    } else if (audioSrc) {
      const beatsPerSecond = this.state.project.bpm / 60;
      const lengthBeats = audioSrc.durationSec * beatsPerSecond;
      const dup = {
        id: newId(),
        start: audioSrc.start + lengthBeats,
        durationSec: audioSrc.durationSec,
        offsetSec: audioSrc.offsetSec,
        sourceDurationSec: audioSrc.sourceDurationSec,
        blob: audioSrc.blob,
        blobKey: audioSrc.blobKey,
      };
      this.patchTrack(trackId, { audioClips: [...t.audioClips, dup] });
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

export function canDropClipOnTrack(
  clipKind: "note" | "audio",
  destKind: Track["kind"],
): boolean {
  if (clipKind === "note") return destKind !== "vocals";
  return destKind === "vocals";
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
    case "track-pan": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      return `${t?.name ?? "Track"} Pan`;
    }
    case "track-send": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      return `${t?.name ?? "Track"} Send: ${SEND_BUS_LABELS[target.busId]}`;
    }
    case "track-eq": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      const band = target.band === "hpf" ? "HPF" : target.band.toUpperCase();
      return `${t?.name ?? "Track"} EQ ${band}`;
    }
    case "fx-amount": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      return `${t?.name ?? "Track"} FX: ${target.moduleId}`;
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
  if (storeInstance) {
    // Mutate the existing instance so React subscriptions (bound to the
    // current Store via `useSyncExternalStore`) keep working. This is
    // important for in-place project swaps like `loadDemo` that don't
    // trigger a full page reload.
    const fresh = new Store(project).state;
    storeInstance.set(fresh);
  } else {
    storeInstance = new Store(project);
  }
  // Re-seed engine-level globals from the freshly loaded project so
  // persisted humanization is active immediately, not on next user edit.
  audio.setGlobalGroove(project.globalGroove);
  flushMixToEngine(project);
}

/**
 * Push every track's EQ / sends / FX-rack and the master bus to the
 * engine. Called after applying a mix preset or restoring a project so
 * the audio state matches the data store on the next sound.
 */
export function flushMixToEngine(project: Project) {
  if (project.masterBus) audio.setMasterBus(project.masterBus);
  for (const t of project.tracks) {
    if (t.eq) audio.setTrackEq(t.id, t.eq);
    if (t.sends) {
      for (const [busId, amount] of Object.entries(t.sends) as [
        SendBusId,
        number,
      ][]) {
        audio.setTrackSend(t.id, busId, amount);
      }
    }
    if (t.fxRack) {
      for (const [moduleId, settings] of Object.entries(t.fxRack) as [
        FxModuleId,
        FxModuleSettings,
      ][]) {
        audio.setEffectModule(t.id, moduleId, settings);
      }
    }
  }
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

const KIND_COLOR: Record<InstrumentKind, string> = {
  piano: "#7dd3fc",
  guitar: "#fbbf24",
  drums: "#f97316",
  bass: "#a78bfa",
  vocals: "#ef4444",
};
const KIND_ICON: Record<InstrumentKind, string> = {
  piano: "Piano",
  guitar: "Guitar",
  drums: "Drum",
  bass: "AudioWaveform",
  vocals: "Mic",
};
const KIND_SOURCE: Record<InstrumentKind, string> = {
  piano: "MIDI",
  guitar: "MIDI",
  drums: "Sample",
  bass: "MIDI",
  vocals: "Live",
};

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
    // v2 defaults — flat EQ, zero sends, empty FX rack, channel meta.
    eq: { low: 0, mid: 0, high: 0, hpfOn: false, hpfHz: 80 },
    sends: { roomReverb: 0, neonHall: 0, tapeDelay: 0, darkSlapback: 0 },
    fxRack: {},
    meta: {
      color: KIND_COLOR[kind],
      icon: KIND_ICON[kind],
      sourceLabel: KIND_SOURCE[kind],
    },
  };
}

export function defaultProject(): Project {
  return seedDemoProject();
}

// ---- demo project ----
// 4-bar loop. Beats are 0..16. Notes are encoded as Tone note strings for melodic, drum piece names for drums.
function seedDemoProject(): Project {
  const piano = makeTrack("piano", "Piano", "electric");
  piano.presetId = "keys.electric";
  const guitar = makeTrack("guitar", "Guitar", "clean");
  guitar.presetId = "guitar.clean";
  const drums = makeTrack("drums", "Drums", "acoustic");
  drums.kitId = "boombap";
  const bass = makeTrack("bass", "Bass", "finger");
  bass.presetId = "bass.808";
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
