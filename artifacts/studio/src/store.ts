import { useSyncExternalStore } from "react";
import { audio } from "./lib/audio/engine";
import { firstPlayMark, getFirstPlayFlags } from "./lib/performance/firstPlayTrace";
import { trackListenerSubscription } from "./lib/performance/listenerTrace";
import { startPerfTimer } from "./utils/performanceDiagnostics";
import { DEFAULT_MASTER_BUS } from "./lib/audio/master-defaults";
import { applyMixPreset, DEFAULTS } from "./lib/audio/mixPresets";
import { wireTrackAutomationTargets } from "./lib/plugins/automation";
import { findPreset, presetSoundParams } from "./lib/audio/sounds/presets";
import type {
  AnyPreset,
  AutomationBreakpoint,
  AutomationInterpolation,
  AutomationLane,
  AutomationParamId,
  ChopLabPersistedState,
  DrumKitId,
  FxModuleId,
  FxModuleSettings,
  InstrumentKind,
  MasterBusSettings,
  MidiMapping,
  MidiMappingPreset,
  MidiTarget,
  MixPresetId,
  ModulationRouting,
  ModulationSource,
  ModulationSourceType,
  NoteClip,
  NoteEvent,
  Project,
  Section,
  SendBusId,
  Track,
  TrackEq,
} from "./types";
import { AUTOMATION_PARAM_DEFAULTS, SEND_BUS_LABELS } from "./types";

import type { ChopSliceSetting } from "./lib/audio/chopEngine";
export type { ChopSliceSetting };

const MIDI_PRESETS_KEY = "sn.midiMappingPresets";

function loadMidiPresetsFromStorage(): MidiMappingPreset[] {
  try {
    const raw = localStorage.getItem(MIDI_PRESETS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as MidiMappingPreset[];
  } catch {
    return [];
  }
}

function saveMidiPresetsToStorage(presets: MidiMappingPreset[]) {
  try {
    localStorage.setItem(MIDI_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // storage quota exceeded or private mode — fail silently
  }
}

/** A single clipping event recorded during the session. */
export interface ClipHistoryEntry {
  id: string;
  trackId: string;
  trackName: string;
  timestamp: number;
}

type Listener = () => void;

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export interface ChopLabState {
  showChopLab: boolean;
  /** Slice marker positions (seconds into the sample), sorted. */
  markers: number[];
  /** Per-slice settings — length === number of slices (markers.length + 1). */
  sliceSettings: ChopSliceSetting[];
  /** Currently selected pad/slice index (0-based), or null. */
  activeSliceIndex: number | null;
  /** Transient detection sensitivity (0..1). */
  sensitivity: number;
  /** BPM of the loaded sample (user-set or auto-detected). */
  sampleBpm: number;
  /** When true, slices are time-stretched to match the project BPM. */
  syncToBpm: boolean;
  /** Original filename of the loaded sample. */
  sampleName?: string;
  /** IDB blob key for the sample audio data. */
  sampleBlobKey?: string;
  /** In-memory blob (not persisted to project JSON; flushed to IDB on save). */
  sampleBlob?: Blob;
}

const DEFAULT_CHOP_LAB: ChopLabState = {
  showChopLab: false,
  markers: [],
  sliceSettings: [],
  activeSliceIndex: null,
  sensitivity: 0.5,
  sampleBpm: 120,
  syncToBpm: false,
};

/** Compare only fields captured by transport callbacks or used to construct a
 * playable voice. Mixer/UI edits must not invalidate the arrangement, while
 * same-count note edits, clip trims, kit/preset changes, and groove edits must. */
function projectSchedulingChanged(previous: Project, next: Project): boolean {
  if (previous === next) return false;
  if (previous.bpm !== next.bpm || previous.globalGroove !== next.globalGroove) {
    return true;
  }
  if (previous.tracks === next.tracks) return false;
  if (previous.tracks.length !== next.tracks.length) return true;

  for (let index = 0; index < previous.tracks.length; index++) {
    const before = previous.tracks[index];
    const after = next.tracks[index];
    if (before === after) continue;
    if (
      before.id !== after.id ||
      before.kind !== after.kind ||
      before.preset !== after.preset ||
      before.presetId !== after.presetId ||
      before.kitId !== after.kitId ||
      before.noteClips !== after.noteClips ||
      before.audioClips !== after.audioClips ||
      before.groove !== after.groove ||
      before.sound !== after.sound ||
      before.pieceSettings !== after.pieceSettings
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Session-only receipt for the most recently generated Sound Library sketch.
 * It deliberately lives outside Project so undo metadata is never exported or
 * autosaved, while still surviving lazy browser-tab unmounts.
 */
export interface PackSketchUndoState {
  projectId: string;
  packId: string;
  packName: string;
  clips: Array<{ trackId: string; clipId: string }>;
  previousSoundPackId?: string;
  previousBars: number;
  appliedBars: number;
  previousLoopEndBeat: number;
  appliedLoopEndBeat: number;
  tracks: Array<{
    trackId: string;
    previous: Pick<Track, "kitId" | "presetId" | "sound">;
    applied: Pick<Track, "kitId" | "presetId" | "sound">;
  }>;
}

class Store {
  private listeners = new Set<Listener>();
  state: {
    project: Project;
    projectRevision: number;
    transportScheduleRevision: number;
    panicRevision: number;
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
      channel: number;
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
    /**
     * Incrementing key broadcast to all per-track StereoMeter instances
     * so they clear their latched clip indicator in sync. Bumped by
     * `resetAllTrackClips()` which is called from the transport CLIP LED.
     */
    trackClipResetKey: number;
    /** Pending sample to surface in the SamplePreviewDialog. */
    pendingSample: {
      blob: Blob;
      defaultName: string;
      recordedTrackId?: string;
    } | null;
    /** Chop Lab panel state. */
    chopLab: ChopLabState;
    /** Accumulated clip events for the session log. */
    clipHistory: ClipHistoryEntry[];
    /** Bounded undo receipt for the latest generated Sound Library sketch. */
    lastPackSketch: PackSketchUndoState | null;
    /** Export range — shared between the timeline drag-region and the
     *  Export dialog so both stay in sync without prop drilling. */
    exportRangeMode: "whole" | "loop" | "custom";
    exportStartBar: number;
    exportEndBar: number;
    /** Named MIDI mapping preset banks, persisted to localStorage. */
    midiMappingPresets: MidiMappingPreset[];
  };

  constructor(project: Project) {
    this.state = {
      project,
      projectRevision: 0,
      transportScheduleRevision: 0,
      panicRevision: 0,
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
      trackClipResetKey: 0,
      pendingSample: null,
      chopLab: { ...DEFAULT_CHOP_LAB },
      clipHistory: [],
      lastPackSketch: null,
      exportRangeMode: "whole",
      exportStartBar: 1,
      exportEndBar: project.bars,
      midiMappingPresets: loadMidiPresetsFromStorage(),
    };
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    const untrack = trackListenerSubscription("store.subscribe", {
      listeners: this.listeners.size,
    });
    return () => {
      untrack();
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.state;

  set(updater: Partial<typeof this.state> | ((s: typeof this.state) => Partial<typeof this.state>)) {
    const patch = typeof updater === "function" ? updater(this.state) : updater;
    firstPlayMark("store.set", {
      keys: Object.keys(patch),
      isPlaying: patch.isPlaying,
      isRecording: patch.isRecording,
      audioUnlocked: patch.audioUnlocked,
    });
    const projectChanged =
      Object.prototype.hasOwnProperty.call(patch, "project") &&
      patch.project !== undefined &&
      patch.project !== this.state.project;
    const scheduleChanged =
      projectChanged && projectSchedulingChanged(this.state.project, patch.project!);
    this.state = {
      ...this.state,
      ...patch,
      projectRevision: projectChanged
        ? this.state.projectRevision + 1
        : patch.projectRevision ?? this.state.projectRevision,
      transportScheduleRevision: scheduleChanged
        ? this.state.transportScheduleRevision + 1
        : patch.transportScheduleRevision ?? this.state.transportScheduleRevision,
    };
    this.listeners.forEach((l) => l());
  }

  patchProject(patch: Partial<Project>) {
    firstPlayMark("store.patchProject", {
      keys: Object.keys(patch),
    });
    const project = { ...this.state.project, ...patch, updatedAt: Date.now() };
    const scheduleChanged = projectSchedulingChanged(this.state.project, project);
    this.state = {
      ...this.state,
      project,
      projectRevision: this.state.projectRevision + 1,
      transportScheduleRevision:
        this.state.transportScheduleRevision + (scheduleChanged ? 1 : 0),
    };
    if (patch.tracks) audio.setProjectTrackSnapshots(project.tracks);
    this.listeners.forEach((l) => l());
  }

  patchTrack(trackId: string, patch: Partial<Track>) {
    const tracks = this.state.project.tracks.map((t) =>
      t.id === trackId ? { ...t, ...patch } : t,
    );
    this.patchProject({ tracks });
  }

  /** Apply and persist a complete melodic preset in one authoritative path. */
  applyMelodicPreset(trackId: string, presetId: string): boolean {
    const track = this.state.project.tracks.find((item) => item.id === trackId);
    const preset = findPreset(presetId);
    if (!track || !preset || !preset.compatibleWith.includes(track.kind)) return false;
    const sound = { ...(track.sound ?? {}), ...presetSoundParams(preset) };
    this.patchTrack(trackId, { presetId, sound });
    audio.setMelodicPreset(trackId, presetId);
    audio.setSoundParams(trackId, sound);
    return true;
  }

  /** Apply and persist a drum kit without waiting for the next transport run. */
  applyDrumKit(trackId: string, kitId: DrumKitId): boolean {
    const track = this.state.project.tracks.find((item) => item.id === trackId);
    if (!track || track.kind !== "drums") return false;
    this.patchTrack(trackId, { kitId });
    audio.setKit(trackId, kitId);
    return true;
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

  resetAllTrackClips() {
    this.set({ trackClipResetKey: this.state.trackClipResetKey + 1 });
  }

  /** Record a clip event for a track into the session history log. */
  addClipEvent(trackId: string, trackName: string) {
    const entry: ClipHistoryEntry = {
      id: newId(),
      trackId,
      trackName,
      timestamp: Date.now(),
    };
    this.set({ clipHistory: [...this.state.clipHistory, entry] });
  }

  /** Clear all accumulated clip history for this session. */
  clearClipHistory() {
    this.set({ clipHistory: [] });
  }

  /** Set the export region to a bar range and switch to "custom" mode. */
  setExportRange(startBar: number, endBar: number) {
    const bars = this.state.project.bars;
    const s = Math.max(1, Math.min(bars, startBar));
    const e = Math.max(s + 1, Math.min(bars, endBar));
    this.set({ exportRangeMode: "custom", exportStartBar: s, exportEndBar: e });
  }

  /** Switch export range mode (whole / loop / custom). */
  setExportRangeMode(mode: "whole" | "loop" | "custom") {
    this.set({ exportRangeMode: mode });
  }

  /** Update the custom start/end bars without switching mode. */
  setExportRangeBars(startBar: number, endBar: number) {
    const bars = this.state.project.bars;
    const s = Math.max(1, Math.min(bars, startBar));
    const e = Math.max(s + 1, Math.min(bars, endBar));
    this.set({ exportStartBar: s, exportEndBar: e });
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

  addAudioClip(trackId: string, clip: { id: string; start: number; durationSec: number; blob: Blob; blobKey?: string }) {
    // Capture the original recording length so resize can later clamp
    // right-edge growth to the actual available audio.
    const stored = {
      ...clip,
      blobKey: clip.blobKey ?? `${this.state.project.id}:${trackId}:${clip.id}`,
      sourceDurationSec: clip.durationSec,
    };
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

  // ---- chop lab ops ----

  patchChopLab(patch: Partial<ChopLabState>) {
    const next = { ...this.state.chopLab, ...patch };
    // Sync serializable fields back to project.chopLab so they are
    // included in the next save / autosave without extra steps.
    const persisted: ChopLabPersistedState = {
      markers: next.markers,
      sliceSettings: next.sliceSettings,
      sensitivity: next.sensitivity,
      sampleName: next.sampleName,
      sampleBlobKey: next.sampleBlobKey,
      sampleBlob: next.sampleBlob,
    };
    this.state = {
      ...this.state,
      chopLab: next,
      project: { ...this.state.project, chopLab: persisted, updatedAt: Date.now() },
      projectRevision: this.state.projectRevision + 1,
    };
    this.listeners.forEach((l) => l());
  }

  /**
   * Record a newly-loaded sample file on both the runtime chopLab state
   * and project.chopLab so that the next save persists the blob to IDB.
   * Call this after decoding the AudioBuffer in ChopLab.tsx.
   */
  setChopLabSample(blob: Blob, sampleName: string, detectedBpm?: number) {
    const blobKey = `${this.state.project.id}:choplab:sample`;
    this.patchChopLab({
      sampleName,
      sampleBlobKey: blobKey,
      sampleBlob: blob,
      markers: [],
      sliceSettings: [],
      activeSliceIndex: null,
      ...(detectedBpm !== undefined ? { sampleBpm: detectedBpm } : {}),
    });
  }

  /** Clear the ChopLab sample and all markers/settings. */
  clearChopLabSample() {
    this.patchChopLab({
      sampleName: undefined,
      sampleBlobKey: undefined,
      sampleBlob: undefined,
      markers: [],
      sliceSettings: [],
      activeSliceIndex: null,
    });
  }

  setChopLabMarkers(markers: number[]) {
    const sorted = markers.slice().sort((a, b) => a - b);
    const count = Math.min(15, sorted.length); // max 15 = 16 slices total
    const trimmed = sorted.slice(0, count);
    const sliceCount = trimmed.length + 1;
    const cur = this.state.chopLab.sliceSettings;
    const DFLT: ChopSliceSetting = { reverse: false, pitch: 0, normalize: false, fadeIn: 0, fadeOut: 0, chokeGroup: "none" };
    // Pad/trim sliceSettings to match new slice count.
    const settings = Array.from({ length: sliceCount }, (_, i): ChopSliceSetting => ({
      ...DFLT,
      ...(cur[i] ?? {}),
    }));
    this.patchChopLab({ markers: trimmed, sliceSettings: settings });
  }

  addChopLabMarker(timeSec: number) {
    const markers = [...this.state.chopLab.markers, timeSec];
    this.setChopLabMarkers(markers);
  }

  deleteChopLabMarker(index: number) {
    const markers = this.state.chopLab.markers.filter((_, i) => i !== index);
    this.setChopLabMarkers(markers);
  }

  moveChopLabMarker(index: number, timeSec: number) {
    const markers = this.state.chopLab.markers.slice();
    markers[index] = timeSec;
    this.setChopLabMarkers(markers);
  }

  updateChopSliceSetting(index: number, patch: Partial<import("./lib/audio/chopEngine").ChopSliceSetting>) {
    const settings = this.state.chopLab.sliceSettings.slice();
    settings[index] = { ...settings[index], ...patch };
    this.patchChopLab({ sliceSettings: settings });
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

  renameMappingLabel(id: string, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const mappings = this.state.project.midiMappings.map((m) =>
      m.id === id ? { ...m, label: trimmed } : m,
    );
    this.patchProject({ midiMappings: mappings });
  }

  // ---- midi mapping preset ops ----

  /** Save the current midiMappings as a named preset bank. */
  saveMidiMappingPreset(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const preset: MidiMappingPreset = {
      id: newId(),
      name: trimmed,
      mappings: this.state.project.midiMappings.map((m) => ({ ...m })),
      createdAt: Date.now(),
    };
    const presets = [...this.state.midiMappingPresets, preset];
    this.set({ midiMappingPresets: presets });
    saveMidiPresetsToStorage(presets);
    this.setStatus(`Preset "${trimmed}" saved`, "info");
  }

  /** Recall a preset bank by id, replacing the current midiMappings. */
  loadMidiMappingPreset(id: string) {
    const preset = this.state.midiMappingPresets.find((p) => p.id === id);
    if (!preset) return;
    this.patchProject({ midiMappings: preset.mappings.map((m) => ({ ...m })) });
    this.setStatus(`Preset "${preset.name}" loaded`, "info");
  }

  /** Rename a saved preset bank. */
  renameMidiMappingPreset(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const presets = this.state.midiMappingPresets.map((p) =>
      p.id === id ? { ...p, name: trimmed } : p,
    );
    this.set({ midiMappingPresets: presets });
    saveMidiPresetsToStorage(presets);
  }

  /** Delete a saved preset bank. */
  deleteMidiMappingPreset(id: string) {
    const presets = this.state.midiMappingPresets.filter((p) => p.id !== id);
    this.set({ midiMappingPresets: presets });
    saveMidiPresetsToStorage(presets);
  }

  pushMidiMonitor(entry: { type: string; channel: number; data1: number; data2: number; device: string }) {
    const next = [
      { id: newId(), ts: Date.now(), ...entry },
      ...this.state.midiMonitor,
    ].slice(0, 20);
    this.set({ midiMonitor: next });
  }

  // ---- Phase 11: Audio clip reverse toggle ----

  /** Toggle the reversed flag on an audio clip and reschedule if transport is active. */
  toggleAudioClipReverse(trackId: string, clipId: string) {
    const t = this.state.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const audioClips = t.audioClips.map((c) =>
      c.id === clipId ? { ...c, reversed: !c.reversed } : c,
    );
    this.patchTrack(trackId, { audioClips });
  }

  // ---- Phase 11: Automation Lane CRUD ----

  /** Add a new automation lane for the given param on a track. Ignored if a lane for that param already exists. */
  addAutomationLane(trackId: string, param: AutomationParamId) {
    const t = this.state.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const existing = t.automationLanes ?? [];
    if (existing.some((l) => l.param === param)) return;
    const lane: AutomationLane = {
      id: newId(),
      param,
      breakpoints: [],
      interpolation: "linear",
    };
    const next = [...existing, lane];
    this.patchTrack(trackId, { automationLanes: next });
    audio.setTrackAutomation(trackId, next);
  }

  /** Update an automation lane's settings (interpolation mode, etc.). */
  updateAutomationLane(trackId: string, laneId: string, patch: Partial<Pick<AutomationLane, "interpolation">>) {
    const t = this.state.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const next = (t.automationLanes ?? []).map((l) =>
      l.id === laneId ? { ...l, ...patch } : l,
    );
    this.patchTrack(trackId, { automationLanes: next });
    audio.setTrackAutomation(trackId, next);
  }

  /** Remove an automation lane from a track. */
  removeAutomationLane(trackId: string, laneId: string) {
    const t = this.state.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const next = (t.automationLanes ?? []).filter((l) => l.id !== laneId);
    this.patchTrack(trackId, { automationLanes: next });
    audio.setTrackAutomation(trackId, next);
  }

  /** Replace all breakpoints on an automation lane. Called by the canvas editor on every drag. */
  setAutomationBreakpoints(trackId: string, laneId: string, breakpoints: AutomationBreakpoint[]) {
    const t = this.state.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const next = (t.automationLanes ?? []).map((l) =>
      l.id === laneId ? { ...l, breakpoints } : l,
    );
    this.patchTrack(trackId, { automationLanes: next });
    audio.setTrackAutomation(trackId, next);
  }

  // ---- Phase 11: Modulation Source CRUD ----

  /** Add a new modulation source of the given type. Returns the new source id. */
  addModulationSource(type: ModulationSourceType): string {
    const id = newId();
    const defaults = makeDefaultModSource(type, id);
    const sources = [...(this.state.project.modulationSources ?? []), defaults];
    this.patchProject({ modulationSources: sources });
    audio.setProjectModulation(sources, this.state.project.modulationRoutings ?? []);
    return id;
  }

  /** Update a modulation source's settings. */
  updateModulationSource(sourceId: string, patch: Partial<ModulationSource>) {
    const sources = (this.state.project.modulationSources ?? []).map((s) =>
      s.id === sourceId ? { ...s, ...patch } : s,
    );
    this.patchProject({ modulationSources: sources });
    audio.setProjectModulation(sources, this.state.project.modulationRoutings ?? []);
  }

  /** Remove a modulation source and all its routings. */
  removeModulationSource(sourceId: string) {
    const sources = (this.state.project.modulationSources ?? []).filter((s) => s.id !== sourceId);
    const routings = (this.state.project.modulationRoutings ?? []).filter((r) => r.sourceId !== sourceId);
    this.patchProject({ modulationSources: sources, modulationRoutings: routings });
    audio.setProjectModulation(sources, routings);
  }

  // ---- Phase 11: Modulation Routing CRUD ----

  /** Add a new modulation routing. Returns the new routing id. */
  addModulationRouting(routing: Omit<ModulationRouting, "id">): string {
    const id = newId();
    const r: ModulationRouting = { id, ...routing };
    const routings = [...(this.state.project.modulationRoutings ?? []), r];
    this.patchProject({ modulationRoutings: routings });
    audio.setProjectModulation(this.state.project.modulationSources ?? [], routings);
    return id;
  }

  /** Update a routing's depth or other settings. */
  updateModulationRouting(routingId: string, patch: Partial<Omit<ModulationRouting, "id">>) {
    const routings = (this.state.project.modulationRoutings ?? []).map((r) =>
      r.id === routingId ? { ...r, ...patch } : r,
    );
    this.patchProject({ modulationRoutings: routings });
    audio.setProjectModulation(this.state.project.modulationSources ?? [], routings);
  }

  /** Remove a modulation routing. */
  removeModulationRouting(routingId: string) {
    const routings = (this.state.project.modulationRoutings ?? []).filter((r) => r.id !== routingId);
    this.patchProject({ modulationRoutings: routings });
    audio.setProjectModulation(this.state.project.modulationSources ?? [], routings);
  }
}

/** Factory for creating a default ModulationSource of the given type. */
function makeDefaultModSource(type: ModulationSourceType, id: string): ModulationSource {
  const base = { id, type, label: `${type.charAt(0).toUpperCase()}${type.slice(1)}` };
  switch (type) {
    case "lfo":
      return { ...base, lfo: { shape: "sine", rate: 0.5, depth: 0.8, phase: 0 } };
    case "envelopeFollower":
      return { ...base, envelopeFollower: { attack: 0.01, release: 0.1, sourceTrackId: "" } };
    case "randomDrift":
      return { ...base, randomDrift: { rate: 0.3, smoothing: 0.85 } };
    case "stepMod":
      return { ...base, stepMod: { steps: [1, 0, 0.75, 0, 1, 0, 0.5, 0], rate: 0.5, glide: 0 } };
    case "sidechainEnv":
      return { ...base, sidechainEnv: { sourceTrackId: "", attack: 0.01, release: 0.2, depth: 0.8 } };
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
    case "drum-piece-volume": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      return `${t?.name ?? "Drums"} · ${target.pieceId} Volume`;
    }
    case "drum-piece-pan": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      return `${t?.name ?? "Drums"} · ${target.pieceId} Pan`;
    }
    case "drum-piece-pitch": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      return `${t?.name ?? "Drums"} · ${target.pieceId} Pitch`;
    }
    case "drum-piece-decay": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      return `${t?.name ?? "Drums"} · ${target.pieceId} Decay`;
    }
    case "drum-piece-cutoff": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      return `${t?.name ?? "Drums"} · ${target.pieceId} Cutoff`;
    }
    case "drum-piece-reverb": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      return `${t?.name ?? "Drums"} · ${target.pieceId} Reverb Send`;
    }
    case "drum-piece-delay": {
      const t = project.tracks.find((tr) => tr.id === target.trackId);
      return `${t?.name ?? "Drums"} · ${target.pieceId} Delay Send`;
    }
    case "chop-pad":
      return `Chop Lab Pad ${target.padIndex + 1}`;
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
  const endResetStore = startPerfTimer("project.resetStore", {
    tracks: project.tracks.length,
    name: project.name,
  });
  audio.replaceProject(project);
  try {
    const endStoreReplace = startPerfTimer("project.resetStore:replace", {
      tracks: project.tracks.length,
    });
    if (storeInstance) {
      // Mutate the existing instance so React subscriptions (bound to the
      // current Store via `useSyncExternalStore`) keep working. This is
      // important for in-place project swaps like `loadDemo` that don't
      // trigger a full page reload.
      const fresh = new Store(project).state;
      // Seed chopLab runtime state from the project's persisted chopLab field
      // so markers, slice settings, and sample name are available immediately.
      if (project.chopLab) {
        fresh.chopLab = {
          ...fresh.chopLab,
          markers: project.chopLab.markers,
          sliceSettings: project.chopLab.sliceSettings,
          sensitivity: project.chopLab.sensitivity,
          sampleName: project.chopLab.sampleName,
          sampleBlobKey: project.chopLab.sampleBlobKey,
          sampleBlob: project.chopLab.sampleBlob,
        };
      }
      storeInstance.set(fresh);
    } else {
      storeInstance = new Store(project);
      // Seed chopLab from project on first init too.
      if (project.chopLab) {
        storeInstance.state.chopLab = {
          ...storeInstance.state.chopLab,
          markers: project.chopLab.markers,
          sliceSettings: project.chopLab.sliceSettings,
          sensitivity: project.chopLab.sensitivity,
          sampleName: project.chopLab.sampleName,
          sampleBlobKey: project.chopLab.sampleBlobKey,
          sampleBlob: project.chopLab.sampleBlob,
        };
      }
    }
    endStoreReplace();
    // Re-seed engine-level globals from the freshly loaded project so
    // persisted humanization is active immediately, not on next user edit.
    audio.setGlobalGroove(project.globalGroove);
    flushMixToEngine(project);
    flushAutomationToEngine(project);
  } finally {
    endResetStore();
  }
}

/**
 * Push every track's automation lanes and the project's modulation sources
 * and routings to the engine. Called after loading a project so that
 * any saved automation data is active immediately on playback.
 */
export function flushAutomationToEngine(project: Project) {
  const endFlushAutomation = startPerfTimer("project.flushAutomationToEngine", {
    tracks: project.tracks.length,
  });
  for (const t of project.tracks) {
    if (t.automationLanes && t.automationLanes.length > 0) {
      audio.setTrackAutomation(t.id, t.automationLanes);
    }
  }
  audio.setProjectModulation(
    project.modulationSources ?? [],
    project.modulationRoutings ?? [],
  );
  endFlushAutomation();
}

/**
 * Push every track's EQ / sends / FX-rack and the master bus to the
 * engine. Called after applying a mix preset or restoring a project so
 * the audio state matches the data store on the next sound.
 */
export function flushMixToEngine(project: Project) {
  const endFlushMix = startPerfTimer("project.flushMixToEngine", {
    tracks: project.tracks.length,
  });
  firstPlayMark("flushMixToEngine:enter", {
    tracks: project.tracks.length,
  });
  if (getFirstPlayFlags().useMinimalAudioGraph) {
    firstPlayMark("flushMixToEngine:skipped-minimal-graph");
    endFlushMix();
    return;
  }
  try {
    if (project.masterBus) audio.setMasterBus(project.masterBus);
    for (const t of project.tracks) {
      const endTrack = startPerfTimer("project.flushMixToEngine:track", {
        trackId: t.id,
        kind: t.kind,
      });
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
      // Wire automatable plugin parameters for this track so the automation
      // system can address them via "{trackId}:{pluginId}:{parameterId}".
      wireTrackAutomationTargets(
        t.id,
        (moduleId, patch) => audio.setEffectModule(t.id, moduleId, patch),
        (params) => audio.setSoundParams(t.id, params),
      );
      endTrack();
    }
  } finally {
    endFlushMix();
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
    // v4 Phase 11 defaults
    automationLanes: [],
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

  // ---- Phase 11 demo: filter cutoff automation on piano + LFO → reverbSend ----
  const demoLfoId = newId();
  const demoRoutingId = newId();
  piano.automationLanes = [
    {
      id: newId(),
      param: "filterCutoff",
      interpolation: "smooth",
      breakpoints: [
        { beat: 0, value: 0.3 },
        { beat: 4, value: 0.85 },
        { beat: 8, value: 0.5 },
        { beat: 12, value: 0.95 },
        { beat: 16, value: 0.3 },
      ],
    },
  ];

  const demoModSources = [
    {
      id: demoLfoId,
      type: "lfo" as const,
      label: "Piano Shimmer",
      lfo: { shape: "sine" as const, rate: 0.25, depth: 0.6, phase: 0 },
    },
  ];

  const demoModRoutings = [
    {
      id: demoRoutingId,
      sourceId: demoLfoId,
      trackId: piano.id,
      param: "reverbSend" as const,
      depth: 0.4,
    },
  ];

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
    modulationSources: demoModSources,
    modulationRoutings: demoModRoutings,
    updatedAt: Date.now(),
  };
}
