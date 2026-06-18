import { lazy, Suspense, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { Header } from "./components/Header";
import { StudioFooter } from "./components/Footer";
import { TransportBar } from "./components/TransportBar";
import { Timeline } from "./components/Timeline";
import { ChannelStripsBar } from "./components/ChannelStrip";
import { CorruptionRecoveryDialog } from "./components/CorruptionRecoveryDialog";
import { MissingSamplesDialog, type MissingSampleEntry } from "./components/MissingSamplesDialog";
import { ChangelogDialog } from "./components/ChangelogDialog";
// MidiPanel is heavier than the rest of the inspector (pulls in the
// MIDI runtime + device listing) and lives in a collapsible aside, so
// lazy-loading it keeps the initial bundle smaller without affecting
// users who never open the right-hand inspector.
const MidiPanel = lazy(() =>
  import("./components/MidiPanel").then((m) => ({ default: m.MidiPanel })),
);
const ModulationPanel = lazy(() =>
  import("./components/ModulationPanel").then((m) => ({ default: m.ModulationPanel })),
);
const HelpDialog = lazy(() =>
  import("./components/HelpDialog").then((m) => ({ default: m.HelpDialog })),
);
const ChopLab = lazy(() =>
  import("./components/instruments/ChopLab").then((m) => ({ default: m.ChopLab })),
);
import { StatusToast } from "./components/StatusToast";
import { PwaUpdateToast } from "./components/PwaUpdateToast";
import { BackgroundFx } from "./components/BackgroundFx";
import { Logo } from "./components/Logo";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applySideEffects, getSettings, subscribeSettings } from "./lib/settings";
import { APP_NAME, APP_VERSION } from "./lib/version";
import { DropZone } from "./components/DropZone";
import { SamplePreviewDialog } from "./components/SamplePreviewDialog";
import { StudioErrorBoundary } from "./components/ErrorBoundary";
import { LeftBrowser } from "./components/LeftBrowser";
import { applyTheme, getStoredThemeId } from "./lib/themes";
import { WorldProvider } from "./contexts/WorldContext";
import { applyWorldTheme, findWorld, getStoredWorldId } from "./lib/worlds";
import { Keyboard } from "./components/instruments/Keyboard";
import { GuitarPanel } from "./components/instruments/GuitarPanel";
import { DrumPads } from "./components/instruments/DrumPads";
import { PianoRoll } from "./components/instruments/PianoRoll";
import { VocalsPanel } from "./components/instruments/VocalsPanel";
import { PresetBrowser } from "./components/PresetBrowser";
import { GroovePanel } from "./components/GroovePanel";
import { MelodicParams } from "./components/MelodicParams";
import { EffectsRack } from "./components/EffectsRack";
import { useTransport } from "./hooks/useTransport";
import { audio } from "./lib/audio/engine";
import { getChopEngine } from "./lib/audio/chopEngine";
import { vocalRecorder, noteRecorder } from "./lib/audio/recorder";
import { defaultProject, getStore, resetStore, useStore } from "./store";
import {
  getLastProjectId,
  getLastSavedInfo,
  loadDraft,
  loadProject,
  saveDraft,
  saveProject,
  clearDraft,
  hydrateDraft,
} from "./lib/storage/db";
import { checkProjectHealth, type HealthReport } from "./lib/storage/health";
import { HealthBanner } from "./components/HealthBanner";
import { RecoveryBanner } from "./components/RecoveryBanner";
import { useMidiEvents, midiBus } from "./lib/midi/midi";
import type { DrumPiece } from "./lib/audio/engine";
import { initPluginSystem } from "./lib/plugins";
import { useSettings } from "./lib/settings";
import { useViewport } from "./hooks/use-mobile";
import { MobileStudio } from "./components/MobileStudio";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { PerformanceModePanel } from "./components/PerformanceModePanel";
import { PerformancePadScreen } from "./components/PerformancePadScreen";
import { performanceRouter } from "./lib/performance/router";
import { midiNoteToName } from "./lib/midi/midi";
import { basslinePattern } from "./lib/performance/bassline";
import {
  countPerf,
  perfMark,
  startPerfTimer,
  trackInterval,
} from "./utils/performanceDiagnostics";
import { markSampleImport } from "./lib/performance/sampleImportTrace";
import {
  assertSampleImportAllowed,
  formatBytes,
  isLargeSample,
  isStorageCriticalOperationActive,
} from "./lib/storage/performanceGuards";

let bootstrapped = false;
let bootstrapPromise: Promise<void> | null = null;

/**
 * Pending draft recovery info populated during bootstrap. The UI reads
 * this to decide whether to render the RecoveryBanner. We don't
 * auto-restore the draft so the user can decide whether to keep the
 * unsaved work or discard it.
 */
interface BootstrapResult {
  health: HealthReport | null;
  draftAvailable: {
    ts: number;
    /** The draft is for the project that the user just loaded. */
    forCurrentProject: boolean;
  } | null;
  /** Non-null when the saved project JSON could not be deserialized. */
  corruption: { rawJson: string | null } | null;
  /** Missing samples detected after project load. */
  missingSamples: MissingSampleEntry[];
}
let bootstrapResult: BootstrapResult = {
  health: null,
  draftAvailable: null,
  corruption: null,
  missingSamples: [],
};

function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const endStartup = startPerfTimer("app-startup");
    // Register all built-in instrument and effect plugins before the engine
    // starts so the plugin browser and automation hooks are ready immediately.
    initPluginSystem();
    const settings = getSettings();
    let project = null;
    let corruptRawJson: string | null = null;
    try {
      const lastId = await getLastProjectId();
      // Honor the "Restore last project on launch" preference — when the
      // user has turned it off we always boot into a fresh project.
      if (lastId && settings.restoreLastProjectOnLaunch) {
        project = await loadProject(lastId);
      }
    } catch (err) {
      console.error("bootstrap load failed", err);
      // Try to preserve the raw JSON for the corruption recovery dialog
      // so the user can download it for manual inspection.
      try {
        corruptRawJson = JSON.stringify((err as { raw?: unknown }).raw ?? null);
      } catch {
        corruptRawJson = null;
      }
      bootstrapResult.corruption = { rawJson: corruptRawJson };
      project = null;
    }
    if (!project && !bootstrapResult.corruption) {
      // Normal first-run: no saved project.
      project = defaultProject();
      resetStore(project);
      let shown = false;
      try {
        shown = localStorage.getItem("studio.onboardingShown") === "1";
      } catch {
        /* ignore */
      }
      if (!shown) getStore().set({ showOnboarding: true });
    } else if (!project && bootstrapResult.corruption) {
      // Corrupted project: start fresh silently; the dialog will show.
      project = defaultProject();
      resetStore(project);
    } else if (project) {
      resetStore(project);
    }
    // Do not realize track voices during bootstrap. First-play profiling
    // showed eager graph construction here could block audio startup before
    // the user ever pressed Play; transport prep now owns bounded scheduling.
    // Project health: surface missing samples / orphaned data so the
    // user can act on it before they edit on top of broken state.
    try {
      bootstrapResult.health = checkProjectHealth(project!);
    } catch (err) {
      console.error("health check failed", err);
    }
    // Collect missing samples for the MissingSamplesDialog wizard.
    try {
      const missing: MissingSampleEntry[] = [];
      for (const s of (project!.samples ?? [])) {
        if (s.blobKey && !s.blob) {
          missing.push({
            sampleId: s.id,
            blobKey: s.blobKey,
            name: s.name,
          });
        }
      }
      for (const t of project!.tracks) {
        for (const c of t.audioClips ?? []) {
          if (c.blobKey && !c.blob) {
            missing.push({
              sampleId: c.id,
              blobKey: c.blobKey,
              name: c.name ?? `Clip on ${t.name}`,
              trackName: t.name,
            });
          }
        }
      }
      bootstrapResult.missingSamples = missing;
    } catch (err) {
      console.error("missing samples scan failed", err);
    }
    // Draft recovery: offer the user a chance to recover a draft
    // snapshot if it's newer than the last durable save for this
    // project. Drafts from a different project are kept (in case the
    // user navigates back) but not surfaced here.
    try {
      const [draft, lastSaved] = await Promise.all([
        loadDraft(),
        getLastSavedInfo(),
      ]);
      if (
        draft &&
        draft.projectId === project!.id &&
        (!lastSaved ||
          lastSaved.projectId !== project!.id ||
          draft.ts > lastSaved.ts + 250)
      ) {
        bootstrapResult.draftAvailable = {
          ts: draft.ts,
          forCurrentProject: true,
        };
      }
    } catch (err) {
      console.error("draft recovery check failed", err);
    }
    bootstrapped = true;
    endStartup();
  })();
  return bootstrapPromise;
}

function getBootstrapResult(): BootstrapResult {
  return bootstrapResult;
}

function clearBootstrapResult(key: "health" | "draftAvailable" | "corruption" | "missingSamples") {
  if (key === "missingSamples") {
    bootstrapResult = { ...bootstrapResult, missingSamples: [] };
  } else {
    bootstrapResult = { ...bootstrapResult, [key]: null };
  }
}

// Apply the persisted theme + UI preferences synchronously at module-
// eval time so the very first render doesn't flash the default palette
// or scroll past unwanted animations.
if (typeof document !== "undefined") {
  try {
    // Apply world theme (which includes all CSS vars) — falls back to
    // the plain theme-only path when no world is stored yet.
    const storedWorldId = getStoredWorldId();
    const world = findWorld(storedWorldId);
    if (world) {
      applyWorldTheme(world);
    } else {
      applyTheme(getStoredThemeId());
    }
    applySideEffects();
  } catch {
    /* SSR-safe no-op */
  }
}

/**
 * Match a stored mapping signature against an incoming event signature.
 *
 * Event signatures always include channel (e.g. "cc:1:74", "note:2:36").
 * Mapping signatures may be channel-aware ("cc:1:74") or channel-agnostic
 * ("cc:74") for backward compatibility. A channel-agnostic mapping fires on
 * any channel; a channel-aware mapping only fires when the channel matches.
 */
function midiSigMatch(mappingSig: string, eventSig: string): boolean {
  if (!mappingSig || !eventSig) return false;
  const mParts = mappingSig.split(":");
  const eParts = eventSig.split(":");
  if (mParts[0] !== eParts[0]) return false;
  if (mParts.length === 2) {
    // channel-agnostic: "cc:74" — compare data number only (last part of event)
    return mParts[1] === eParts[eParts.length - 1];
  }
  // channel-aware: "cc:1:74" — must match both channel and data number
  return mParts[1] === eParts[1] && mParts[2] === eParts[2];
}

export default function App() {
  useEffect(() => {
    perfMark("app-startup:app-mounted");
  }, []);
  const [ready, setReady] = useState<boolean>(bootstrapped);
  useEffect(() => {
    if (bootstrapped) {
      setReady(true);
      return;
    }
    let cancelled = false;
    bootstrap().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!ready) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-foreground gap-4">
        <Logo className="w-20 h-20 studio-loading-pulse" />
        <div className="text-center leading-tight">
          <div className="font-display text-lg tracking-[0.3em]">
            {APP_NAME.toUpperCase()}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.4em] text-primary mt-1 studio-loading-pulse">
            Tuning the dojo…
          </div>
        </div>
      </div>
    );
  }
  return (
    <WorldProvider>
      <TooltipProvider delayDuration={250}>
        <StudioErrorBoundary
          onPanic={() => {
            audio.panicStopAll();
            getStore().set((s) => ({
              transportScheduleRevision: s.transportScheduleRevision + 1,
              panicRevision: s.panicRevision + 1,
            }));
          }}
        >
          <Studio />
        </StudioErrorBoundary>
      </TooltipProvider>
    </WorldProvider>
  );
}

const COLLAPSE_KEYS = {
  left: "studio.collapse.left",
  right: "studio.collapse.right",
  mixer: "studio.collapse.mixer",
} as const;

function readCollapse(key: string): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(key) === "1";
}
function writeCollapse(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* quota */
  }
}

function Studio() {
  // Narrow selector: returns a stable Track reference via Immer structural
  // sharing — only re-renders Studio when the SELECTED track itself changes,
  // not when a different track's fader/step moves.
  const selectedTrack = useStore(
    (s) => s.project.tracks.find((t) => t.id === s.selectedTrackId) ?? s.project.tracks[0],
  );
  const { play, pause, stop, record } = useTransport();
  const isPlaying = useStore((s) => s.isPlaying);
  const selectedClipId = useStore((s) => s.selectedClipId);

  const [leftCollapsed, setLeftCollapsed] = useState(() =>
    readCollapse(COLLAPSE_KEYS.left),
  );
  const [rightCollapsed, setRightCollapsed] = useState(() =>
    readCollapse(COLLAPSE_KEYS.right),
  );
  const [mixerCollapsed, setMixerCollapsed] = useState(() =>
    readCollapse(COLLAPSE_KEYS.mixer),
  );
  useEffect(() => writeCollapse(COLLAPSE_KEYS.left, leftCollapsed), [leftCollapsed]);
  useEffect(() => writeCollapse(COLLAPSE_KEYS.right, rightCollapsed), [rightCollapsed]);
  useEffect(() => writeCollapse(COLLAPSE_KEYS.mixer, mixerCollapsed), [mixerCollapsed]);

  // Performance pad screen (fullscreen 4×4 grid)
  const [padScreenOpen, setPadScreenOpen] = useState(false);

  // Initialize the unified performance router once and wire it to the audio engine.
  useEffect(() => {
    performanceRouter.initialize();

    // Wire bassline pattern to the audio engine so it can trigger notes
    basslinePattern.setPlayNote((trackId, note, velocity, duration) => {
      const durSec = duration === "8n" ? 0.25 : 0.5;
      audio.triggerNote(trackId, note, durSec, velocity);
    });

    // Route performance note events → audio engine
    const unsub = performanceRouter.onNote((e) => {
      if (e.type !== "noteon") return;
      const store = getStore();
      const project = store.state.project;

      const perf = project.performance;
      if (!perf) return;

      const note = midiNoteToName(e.note);
      const velocity = typeof e.velocity === "number" ? e.velocity : 0.85;

      // Bassline mode: route to first bass track if enabled
      if (perf.basslineMode) {
        const bassTrack = project.tracks.find(
          (t) => t.kind === "bass" || t.kind === "piano",
        );
        if (bassTrack) {
          basslinePattern.trigger(bassTrack.id, e.note, perf.basslinePatternId);
          return;
        }
      }

      // Drum notes (36-51 range) → drum track
      if (e.note >= 36 && e.note <= 51) {
        const drumTrack = project.tracks.find((t) => t.kind === "drums");
        if (drumTrack) {
          const PIECES = ["kick","snare","hat","ohat","clap","tomLow","tomHigh","crash","fx"] as DrumPiece[];
          const piece = PIECES[e.note - 36] as DrumPiece | undefined;
          if (piece) {
            audio.triggerDrum(drumTrack.id, piece, velocity);
            return;
          }
        }
      }

      // Melodic notes → selected track (if melodic)
      const selectedId = store.state.selectedTrackId;
      const selectedTrackNow = project.tracks.find((t) => t.id === selectedId);
      const target = (selectedTrackNow?.kind === "piano" || selectedTrackNow?.kind === "guitar" || selectedTrackNow?.kind === "bass")
        ? selectedTrackNow
        : project.tracks.find((t) => t.kind === "piano" || t.kind === "guitar" || t.kind === "bass");
      if (target) {
        audio.triggerNote(target.id, note, 0.5, velocity);
      }
    });

    // Handle pad screen open event from PerformanceModePanel
    const onPadScreenOpen = () => setPadScreenOpen(true);
    window.addEventListener("studio:open-pad-screen", onPadScreenOpen);

    return () => {
      unsub();
      window.removeEventListener("studio:open-pad-screen", onPadScreenOpen);
      performanceRouter.teardown();
      basslinePattern.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clipboard for clip copy/paste (in-memory, simple JSON snapshot)
  const clipboardRef = useRef<{
    kind: "note" | "audio";
    trackId: string;
    clipId: string;
  } | null>(null);

  // Single document-level shortcut handler. Skip the handler entirely when
  // focus is on an editable element so typing in inputs, textareas, and
  // contenteditable surfaces keeps working naturally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const editable =
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t && t.isContentEditable);
      if (editable) return;

      const meta = e.metaKey || e.ctrlKey;
      const key = e.key;

      if (e.code === "Space") {
        e.preventDefault();
        if (isPlaying) pause();
        else play();
        return;
      }
      if (key === "Enter") {
        e.preventDefault();
        stop();
        return;
      }
      if (key === "Escape") {
        // Esc is the documented "panic stop" — hard-cuts in-flight audio
        // and any stuck voices in addition to stopping the transport.
        audio.panicStopAll();
        getStore().set((s) => ({
          transportScheduleRevision: s.transportScheduleRevision + 1,
          panicRevision: s.panicRevision + 1,
        }));
        stop();
        return;
      }

      // Save: spec contract — plain `S` (and Cmd/Ctrl+S) saves the project
      // when focus is not in an editable field. The QWERTY instrument keybed
      // attaches its own keydown listener and will still trigger the note;
      // that is an accepted trade-off for the spec'd shortcut.
      if (key === "s" || key === "S") {
        e.preventDefault();
        saveProject(getStore().state.project)
          .then(() => getStore().setStatus("Project saved", "info"))
          .catch((err) =>
            getStore().setStatus(`Save failed: ${err.message}`, "error"),
          );
        return;
      }
      if (meta && (key === "c" || key === "C")) {
        const sel = getStore().state.selectedClipId;
        if (!sel) return;
        for (const tr of getStore().state.project.tracks) {
          if (tr.noteClips.some((c) => c.id === sel)) {
            clipboardRef.current = { kind: "note", trackId: tr.id, clipId: sel };
            getStore().setStatus("Clip copied", "info");
            return;
          }
          if (tr.audioClips.some((c) => c.id === sel)) {
            clipboardRef.current = { kind: "audio", trackId: tr.id, clipId: sel };
            getStore().setStatus("Clip copied", "info");
            return;
          }
        }
        return;
      }
      if (meta && (key === "v" || key === "V")) {
        const cb = clipboardRef.current;
        if (!cb) return;
        getStore().duplicateClipById(cb.trackId, cb.clipId);
        getStore().setStatus("Clip pasted", "info");
        return;
      }

      // Single-key shortcuts
      if (key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("studio:open-shortcuts"));
        return;
      }
      if (key === "r" || key === "R") {
        e.preventDefault();
        record();
        return;
      }
      if (key === "m" || key === "M") {
        e.preventDefault();
        const cur = getStore().state.project.metronome;
        getStore().patchProject({ metronome: !cur });
        return;
      }
      if (key === "b" || key === "B") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("studio:open-export"));
        return;
      }
      if (key === "f" || key === "F") {
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => undefined);
        } else {
          document.documentElement.requestFullscreen?.().catch(() =>
            getStore().setStatus("Fullscreen blocked by the browser.", "warn"),
          );
        }
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        const sel = getStore().state.selectedClipId;
        if (!sel) return;
        const tracks = getStore().state.project.tracks;
        for (const tr of tracks) {
          if (
            tr.noteClips.some((c) => c.id === sel) ||
            tr.audioClips.some((c) => c.id === sel)
          ) {
            getStore().removeClip(tr.id, sel);
            return;
          }
        }
        return;
      }
      // 1..8 focus tracks
      if (/^[1-8]$/.test(key)) {
        const idx = parseInt(key, 10) - 1;
        const tracks = getStore().state.project.tracks;
        const target = tracks[idx];
        if (target) {
          getStore().set({ selectedTrackId: target.id });
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying, play, pause, record, stop, selectedClipId]);

  // First-note + sample-loading toasts: surface a one-time confirmation
  // when audio actually starts producing sound (helps users self-diagnose
  // whether keys/black notes triggered correctly), and a transient hint
  // while sampled instruments are downloading their buffers.
  useEffect(() => {
    const onFirstQwerty = () => {
      getStore().setStatus(
        "Sound on — A S D F play white keys, W E T Y U O P [ ] \\ play sharps",
        "info",
      );
    };
    const onFirstMidi = () => {
      getStore().setStatus(
        "MIDI input live — your controller is playing the studio",
        "info",
      );
    };
    const onLoading = () => {
      getStore().setStatus("Loading instrument samples…", "info");
    };
    const onLoaded = () => {
      getStore().setStatus("Instruments ready", "info");
    };
    window.addEventListener("studio:first-qwerty-note", onFirstQwerty);
    window.addEventListener("studio:first-midi-note", onFirstMidi);
    window.addEventListener("studio:samples-loading", onLoading);
    window.addEventListener("studio:samples-loaded", onLoaded);
    return () => {
      window.removeEventListener("studio:first-qwerty-note", onFirstQwerty);
      window.removeEventListener("studio:first-midi-note", onFirstMidi);
      window.removeEventListener("studio:samples-loading", onLoading);
      window.removeEventListener("studio:samples-loaded", onLoaded);
    };
  }, []);

  // central MIDI router: bind midi events to mappings + monitor
  useMidiEvents(
    (e) => {
      // monitor
      getStore().pushMidiMonitor({
        type: e.type,
        channel: e.channel + 1, // store as 1-based
        data1: e.data1,
        data2: e.data2,
        device: e.device,
      });
      const store = getStore();
      // if learning, bind — but respect the device's default channel filter
      if (store.state.midiLearnTargetId && (e.type === "noteon" || e.type === "cc")) {
        const defaultCh = midiBus.selectedDeviceChannel;
        const eventCh = e.channel + 1; // 1-based
        if (defaultCh !== 0 && eventCh !== defaultCh) {
          // Wrong channel for this device — skip so only the preferred channel learns
          return;
        }
        store.bindMidiLearn(e.signature, e.device);
        store.setStatus(`MIDI learned: ${e.signature}`, "info");
        return;
      }
      // otherwise: dispatch any matching mapping
      // signaturesMatch handles both channel-aware ("cc:1:74") and channel-agnostic
      // ("cc:74") stored signatures for backward compatibility.
      const matches = store.state.project.midiMappings.filter((m) =>
        midiSigMatch(m.signature, e.signature),
      );
      for (const m of matches) {
        switch (m.target.kind) {
          case "transport-play":
            if (e.type === "noteon") {
              if (store.state.isPlaying) pause();
              else play();
            }
            break;
          case "transport-stop":
            if (e.type === "noteon") stop();
            break;
          case "transport-record":
            if (e.type === "noteon") record();
            break;
          case "metronome-toggle":
            if (e.type === "noteon") {
              const cur = store.state.project.metronome;
              store.patchProject({ metronome: !cur });
            }
            break;
          case "track-volume": {
            if (e.type !== "cc") break;
            const v = e.data2 / 127;
            store.patchTrack(m.target.trackId, { volume: v });
            break;
          }
          case "track-pan": {
            if (e.type !== "cc") break;
            const v = (e.data2 / 127) * 2 - 1;
            store.patchTrack(m.target.trackId, { pan: v });
            break;
          }
          case "track-send": {
            if (e.type !== "cc") break;
            store.setTrackSend(m.target.trackId, m.target.busId, e.data2 / 127);
            break;
          }
          case "track-eq": {
            if (e.type !== "cc") break;
            if (m.target.band === "hpf") {
              const hz = 20 + (e.data2 / 127) * 380;
              store.setTrackEq(m.target.trackId, { hpfHz: hz, hpfOn: true });
            } else {
              const db = (e.data2 / 127) * 24 - 12;
              store.setTrackEq(m.target.trackId, { [m.target.band]: db });
            }
            break;
          }
          case "fx-amount": {
            if (e.type !== "cc") break;
            store.setFxModule(m.target.trackId, m.target.moduleId, {
              amount: e.data2 / 127,
              preset: "custom",
            });
            break;
          }
          case "drum-pad": {
            if (e.type !== "noteon") break;
            const drumTrack = store.state.project.tracks.find((t) => t.kind === "drums");
            if (!drumTrack) break;
            audio.triggerDrum(drumTrack.id, m.target.pad as DrumPiece, e.data2 / 127);
            if (store.state.isRecording && noteRecorder.isActiveFor(drumTrack.id)) {
              noteRecorder.hit(drumTrack.id, m.target.pad, e.data2 / 127);
            }
            break;
          }
          case "drum-piece-volume": {
            if (e.type !== "cc") break;
            const dpvt = m.target as { kind: "drum-piece-volume"; trackId: string; pieceId: string };
            const vol = e.data2 / 127;
            const tr = store.state.project.tracks.find((t) => t.id === dpvt.trackId);
            if (!tr) break;
            const cur = tr.pieceSettings ?? {};
            const next = { ...cur, [dpvt.pieceId]: { ...(cur[dpvt.pieceId] ?? {}), volume: vol } };
            audio.setPieceSetting(dpvt.trackId, dpvt.pieceId as DrumPiece, { volume: vol }, next);
            store.patchTrack(dpvt.trackId, { pieceSettings: next });
            break;
          }
          case "drum-piece-pan": {
            if (e.type !== "cc") break;
            const dppt = m.target as { kind: "drum-piece-pan"; trackId: string; pieceId: string };
            const pan = (e.data2 / 127) * 2 - 1;
            const tr = store.state.project.tracks.find((t) => t.id === dppt.trackId);
            if (!tr) break;
            const cur = tr.pieceSettings ?? {};
            const next = { ...cur, [dppt.pieceId]: { ...(cur[dppt.pieceId] ?? {}), pan } };
            audio.setPieceSetting(dppt.trackId, dppt.pieceId as DrumPiece, { pan }, next);
            store.patchTrack(dppt.trackId, { pieceSettings: next });
            break;
          }
          case "drum-piece-pitch": {
            if (e.type !== "cc") break;
            const dpitt = m.target as { kind: "drum-piece-pitch"; trackId: string; pieceId: string };
            const pitch = (e.data2 / 127) * 24 - 12;
            const tr = store.state.project.tracks.find((t) => t.id === dpitt.trackId);
            if (!tr) break;
            const cur = tr.pieceSettings ?? {};
            const next = { ...cur, [dpitt.pieceId]: { ...(cur[dpitt.pieceId] ?? {}), pitch } };
            audio.setPieceSetting(dpitt.trackId, dpitt.pieceId as DrumPiece, { pitch }, next);
            store.patchTrack(dpitt.trackId, { pieceSettings: next });
            break;
          }
          case "drum-piece-decay": {
            if (e.type !== "cc") break;
            const t = m.target as { kind: "drum-piece-decay"; trackId: string; pieceId: string };
            const decay = e.data2 / 127;
            const tr = store.state.project.tracks.find((tk) => tk.id === t.trackId);
            if (!tr) break;
            const cur = tr.pieceSettings ?? {};
            const next = { ...cur, [t.pieceId]: { ...(cur[t.pieceId] ?? {}), decay } };
            audio.setPieceSetting(t.trackId, t.pieceId as DrumPiece, { decay }, next);
            store.patchTrack(t.trackId, { pieceSettings: next });
            break;
          }
          case "drum-piece-cutoff": {
            if (e.type !== "cc") break;
            const t = m.target as { kind: "drum-piece-cutoff"; trackId: string; pieceId: string };
            const cutoff = e.data2 / 127;
            const tr = store.state.project.tracks.find((tk) => tk.id === t.trackId);
            if (!tr) break;
            const cur = tr.pieceSettings ?? {};
            const next = { ...cur, [t.pieceId]: { ...(cur[t.pieceId] ?? {}), cutoff } };
            audio.setPieceSetting(t.trackId, t.pieceId as DrumPiece, { cutoff }, next);
            store.patchTrack(t.trackId, { pieceSettings: next });
            break;
          }
          case "drum-piece-reverb": {
            if (e.type !== "cc") break;
            const t = m.target as { kind: "drum-piece-reverb"; trackId: string; pieceId: string };
            const reverbSend = e.data2 / 127;
            const tr = store.state.project.tracks.find((tk) => tk.id === t.trackId);
            if (!tr) break;
            const cur = tr.pieceSettings ?? {};
            const next = { ...cur, [t.pieceId]: { ...(cur[t.pieceId] ?? {}), reverbSend } };
            audio.setPieceSetting(t.trackId, t.pieceId as DrumPiece, { reverbSend }, next);
            store.patchTrack(t.trackId, { pieceSettings: next });
            break;
          }
          case "drum-piece-delay": {
            if (e.type !== "cc") break;
            const t = m.target as { kind: "drum-piece-delay"; trackId: string; pieceId: string };
            const delaySend = e.data2 / 127;
            const tr = store.state.project.tracks.find((tk) => tk.id === t.trackId);
            if (!tr) break;
            const cur = tr.pieceSettings ?? {};
            const next = { ...cur, [t.pieceId]: { ...(cur[t.pieceId] ?? {}), delaySend } };
            audio.setPieceSetting(t.trackId, t.pieceId as DrumPiece, { delaySend }, next);
            store.patchTrack(t.trackId, { pieceSettings: next });
            break;
          }
          case "chop-pad": {
            if (e.type !== "noteon") break;
            const velocity = e.data2 / 127;
            getChopEngine().triggerSlice(m.target.padIndex, undefined, velocity);
            break;
          }
        }
      }
    },
    [play, pause, stop, record],
  );

  // ---- autosave + draft snapshot loop ----
  // Two independent signals keep the user's work safe:
  //   1. A configurable periodic "real" autosave that writes to the
  //      durable project record. Interval comes from user settings
  //      (off / 15s / 30s / 60s). Skipped for transient demo projects.
  //   2. A short-debounced "draft" snapshot that always runs on dirty
  //      state, even for transient projects, so a crash or accidental
  //      tab close can be recovered via Recover Unsaved Project.
  const isTransient = useStore((s) => s.isTransientProject);
  // projectRef always holds the latest snapshot — kept fresh by the store
  // subscription below so the render path never needs to subscribe to project.
  const projectRef = useRef(getStore().state.project);
  const projectRevisionRef = useRef(getStore().state.projectRevision);
  const dirtyRef = useRef(false);
  const dirtyRevisionRef = useRef(projectRevisionRef.current);
  const savedProjectRevisionRef = useRef(projectRevisionRef.current);
  const savedDraftRevisionRef = useRef(projectRevisionRef.current);
  const draftSaveInFlightRef = useRef(false);
  const draftTimerRef = useRef<number | null>(null);
  const [autosaveSec, setAutosaveSec] = useState(
    () => getSettings().autosaveIntervalSec,
  );
  useEffect(() => subscribeSettings((s) => setAutosaveSec(s.autosaveIntervalSec)), []);

  // Single store subscription that handles both dirty-marking and the
  // debounced draft write. Runs outside React's render cycle so fader
  // moves, step toggles, and note edits never cause Studio to re-render
  // just to keep the autosave timer up to date.
  useEffect(() => {
    const queueDraftSave = () => {
      if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = window.setTimeout(() => {
        draftTimerRef.current = null;
        if (!dirtyRef.current) return;
        if (projectRevisionRef.current <= savedDraftRevisionRef.current) {
          countPerf("skippedAutosaves", 1, { reason: "clean-draft-revision" });
          return;
        }
        if (Tone.getTransport().state === "started") {
          countPerf("skippedAutosaves", 1, { reason: "transport-started" });
          queueDraftSave();
          return;
        }
        if (isStorageCriticalOperationActive()) {
          countPerf("skippedAutosaves", 1, { reason: "critical-storage-operation" });
          queueDraftSave();
          return;
        }
        if (draftSaveInFlightRef.current) {
          countPerf("skippedAutosaves", 1, { reason: "draft-save-in-flight" });
          queueDraftSave();
          return;
        }
        const revision = projectRevisionRef.current;
        const snapshot = projectRef.current;
        draftSaveInFlightRef.current = true;
        countPerf("autosaveAttempts", 1, { kind: "draft" });
        saveDraft(snapshot)
          .then(() => {
            if (projectRevisionRef.current === revision) {
              savedDraftRevisionRef.current = revision;
            }
          })
          .catch(() => { /* ignore quota / serialization errors */ })
          .finally(() => {
            draftSaveInFlightRef.current = false;
          });
      }, 8000);
    };
    return getStore().subscribe(() => {
      const store = getStore();
      const next = store.state.project;
      const nextRevision = store.state.projectRevision;
      if (next === projectRef.current) return;
      projectRef.current = next;
      projectRevisionRef.current = nextRevision;
      dirtyRef.current = true;
      dirtyRevisionRef.current = nextRevision;
      queueDraftSave();
    });
  }, []);

  // Periodic real autosave on a user-configurable interval. 0 disables
  // (manual Save still works). Always writes when dirty, regardless of
  // debounce — the user explicitly opted into this cadence.
  useEffect(() => {
    if (autosaveSec === 0) return;
    if (isTransient) return;
    const untrackInterval = trackInterval("periodic-project-autosave");
    const handle = window.setInterval(() => {
      if (!dirtyRef.current) {
        countPerf("skippedAutosaves", 1, { reason: "clean-project" });
        return;
      }
      if (projectRevisionRef.current <= savedProjectRevisionRef.current) {
        dirtyRef.current = false;
        countPerf("skippedAutosaves", 1, { reason: "clean-project-revision" });
        return;
      }
      if (isStorageCriticalOperationActive()) {
        countPerf("skippedAutosaves", 1, { reason: "critical-storage-operation" });
        return;
      }
      const snap = projectRef.current;
      const revision = projectRevisionRef.current;
      countPerf("autosaveAttempts", 1, { kind: "periodic-project" });
      saveProject(snap)
        .then(() => {
          if (projectRevisionRef.current === revision) {
            savedProjectRevisionRef.current = revision;
            savedDraftRevisionRef.current = Math.max(savedDraftRevisionRef.current, revision);
            dirtyRef.current = dirtyRevisionRef.current > revision;
          }
        })
        .catch(() => {
          /* ignore quota errors — next tick will retry */
        });
    }, autosaveSec * 1000);
    return () => {
      window.clearInterval(handle);
      untrackInterval();
    };
  }, [autosaveSec, isTransient]);

  // beforeunload: best-effort flush of the draft slot so a tab close
  // mid-edit still leaves the most recent state recoverable. We can't
  // await async work here, but saveDraft kicks off the IDB write
  // immediately and most browsers will let it complete.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (!dirtyRef.current) return;
      try {
        countPerf("autosaveAttempts", 1, { kind: "beforeunload-draft" });
        saveDraft(projectRef.current);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const handleDroppedAudioFiles = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    markSampleImport("file-drop", {
      bytes: f.size,
      type: f.type,
      name: f.name,
    });
    try {
      markSampleImport("metadata-validation:start", { bytes: f.size, type: f.type });
      assertSampleImportAllowed(f);
      markSampleImport("metadata-validation:ok", { bytes: f.size, type: f.type });
      if (isLargeSample(f)) {
        getStore().setStatus(
          `Large sample (${formatBytes(f.size)}). Import may take a moment.`,
          "warn",
        );
      }
      perfMark("sample-import:drop", { size: f.size, type: f.type });
      getStore().set({
        pendingSample: {
          blob: f,
          defaultName: f.name.replace(/\.[^.]+$/, "") || "Imported",
        },
      });
      markSampleImport("ui-state:pending-sample", { bytes: f.size, type: f.type });
    } catch (err) {
      markSampleImport("metadata-validation:error", {
        bytes: f.size,
        type: f.type,
        error: (err as Error).message,
      });
      getStore().setStatus((err as Error).message, "error");
    }
  };

  // ---- health + recovery banners (populated by bootstrap) ----
  const [healthReport, setHealthReport] = useState<HealthReport | null>(
    () => getBootstrapResult().health,
  );
  const [draftAvailable, setDraftAvailable] = useState<{ ts: number } | null>(
    () => {
      const r = getBootstrapResult().draftAvailable;
      return r ? { ts: r.ts } : null;
    },
  );

  // ---- Corruption recovery dialog ----
  const [corruptionInfo, setCorruptionInfo] = useState<{ rawJson: string | null } | null>(
    () => getBootstrapResult().corruption,
  );

  // ---- Missing samples wizard ----
  const [missingSamples, setMissingSamples] = useState<MissingSampleEntry[]>(
    () => getBootstrapResult().missingSamples,
  );
  const [missingSamplesOpen, setMissingSamplesOpen] = useState(
    () => getBootstrapResult().missingSamples.length > 0,
  );

  // ---- Changelog auto-open on version bump ----
  const [changelogOpen, setChangelogOpen] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("studio.lastSeenVersion");
      if (stored !== APP_VERSION) {
        // New version detected — auto-open the changelog once, then mark seen.
        if (stored !== null) {
          setChangelogOpen(true);
        }
        localStorage.setItem("studio.lastSeenVersion", APP_VERSION);
      }
    } catch {
      /* localStorage unavailable */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Backup reminder (session count) ----
  useEffect(() => {
    try {
      const n = parseInt(localStorage.getItem("studio.sessionCount") ?? "0", 10);
      const next = (isNaN(n) ? 0 : n) + 1;
      localStorage.setItem("studio.sessionCount", String(next));
      const threshold = getSettings().backupReminderSessions;
      if (threshold > 0 && next % threshold === 0) {
        window.setTimeout(() => {
          getStore().setStatus(
            "You've been here a while — consider exporting a backup (.snproj.json).",
            "info",
          );
        }, 4000);
      }
    } catch {
      /* ignore */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ---- Corruption recovery handlers ----
  const onCorruptionRestoreAutosave = async () => {
    try {
      const snap = await loadDraft();
      if (snap) {
        const recovered = await hydrateDraft(snap);
        audio.stop();
        resetStore(recovered);
        // Track graph realization is deferred to transport prep.
        setHealthReport(checkProjectHealth(recovered));
        getStore().setStatus("Autosave restored", "info");
      } else {
        getStore().setStatus("No autosave found — starting fresh", "warn");
      }
    } catch (err) {
      getStore().setStatus(`Recovery failed: ${(err as Error).message}`, "error");
    } finally {
      setCorruptionInfo(null);
      clearBootstrapResult("corruption");
    }
  };

  const onCorruptionStartFresh = () => {
    setCorruptionInfo(null);
    clearBootstrapResult("corruption");
    getStore().set({ showOnboarding: true });
  };

  const onRecoverDraft = async () => {
    try {
      const snap = await loadDraft();
      if (!snap) {
        setDraftAvailable(null);
        clearBootstrapResult("draftAvailable");
        return;
      }
      const recovered = await hydrateDraft(snap);
      audio.stop();
      resetStore(recovered);
      // Track graph realization is deferred to transport prep.
      setDraftAvailable(null);
      clearBootstrapResult("draftAvailable");
      setHealthReport(checkProjectHealth(recovered));
      getStore().setStatus("Unsaved work restored", "info");
    } catch (err) {
      getStore().setStatus(
        `Recovery failed: ${(err as Error).message}`,
        "error",
      );
    }
  };
  const onDiscardDraft = async () => {
    try {
      await clearDraft();
    } catch {
      /* ignore */
    }
    setDraftAvailable(null);
    clearBootstrapResult("draftAvailable");
  };

  // stop vocals on unmount safety
  useEffect(() => {
    return () => {
      getStore().state.project.tracks.forEach((t) => {
        if (t.kind === "vocals") audio.stopVocalMonitor(t.id);
      });
      if (vocalRecorder.isActive()) vocalRecorder.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const viewport = useViewport();
  const isTablet = viewport === "tablet";

  // Tablet drawer state — at <1024px the side panels and mixer slide in
  // over the timeline so the arrangement stays the focus. We never
  // unmount the Header/TransportBar, so audio state and the user's
  // collapse preferences keep working across resizes.
  const [tabletDrawer, setTabletDrawer] = useState<
    "left" | "right" | "mixer" | null
  >(null);

  // Render the simplified phone shell — Header still mounts (hidden) so
  // its dialog state and event listeners (Save / Load / Export / etc.)
  // remain available to the mobile menu.
  if (viewport === "mobile") {
    return (
      <div className="h-full flex flex-col text-foreground overflow-hidden relative">
        <BackgroundFx />
        <div className="hidden" aria-hidden>
          <Header />
        </div>
        <MobileStudio />
        <Suspense fallback={null}>
          <HelpDialog />
        </Suspense>
        <StatusToast />
        <DropZone onFiles={handleDroppedAudioFiles} />
        <PendingSampleHost />
      </div>
    );
  }

  const showInlineLeft = !isTablet && !leftCollapsed;
  const showInlineRight = !isTablet && !rightCollapsed;
  const showInlineMixer = !isTablet && !mixerCollapsed;

  const onShowLeft = () => {
    if (isTablet) setTabletDrawer("left");
    else setLeftCollapsed(false);
  };
  const onShowRight = () => {
    if (isTablet) setTabletDrawer("right");
    else setRightCollapsed(false);
  };
  const onShowMixer = () => {
    if (isTablet) setTabletDrawer("mixer");
    else setMixerCollapsed(false);
  };

  return (
    <div className="h-full flex flex-col text-foreground overflow-hidden relative">
      {/* Skip-to-content link for keyboard-only users */}
      <a href="#studio-main-content" className="skip-to-content">
        Skip to main content
      </a>
      {/* ARIA live region: announces transport state changes to screen readers */}
      <TransportAnnouncer />
      <BackgroundFx />
      <Header />
      {draftAvailable && (
        <RecoveryBanner
          draftTs={draftAvailable.ts}
          onRecover={onRecoverDraft}
          onDiscard={onDiscardDraft}
        />
      )}
      {healthReport && healthReport.issues.length > 0 && (
        <HealthBanner
          report={healthReport}
          onDismiss={() => {
            setHealthReport(null);
            clearBootstrapResult("health");
          }}
        />
      )}
      <TransportBar />
      {/* Performance Mode overlay — rendered above everything else */}
      <PerformanceModePanel />
      <PerformancePadScreen
        open={padScreenOpen}
        onClose={() => setPadScreenOpen(false)}
      />
      <div className="flex flex-1 overflow-hidden">
        {/* Left browser: inline on desktop, drawer trigger on tablet. */}
        {showInlineLeft ? (
          <aside className="w-56 border-r border-border bg-graphite/70 backdrop-blur flex flex-col overflow-hidden">
            <PanelHeader
              title="Tracks"
              onCollapse={() => setLeftCollapsed(true)}
              collapseIcon="left"
            />
            <LeftBrowser />
          </aside>
        ) : (
          <CollapsedRail label="Tracks" side="left" onExpand={onShowLeft} />
        )}

        {/* Center: arrangement timeline + collapsible mixer drawer */}
        <div
          id="studio-main-content"
          className="flex-1 flex flex-col overflow-hidden min-w-0"
          tabIndex={-1}
        >
          <div className="flex-1 overflow-hidden">
            <Timeline />
          </div>
          {showInlineMixer ? (
            <div className="border-t border-border">
              <div className="h-6 flex items-center justify-between px-3 bg-graphite/80 border-b border-border">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Mixer
                </span>
                <button
                  type="button"
                  onClick={() => setMixerCollapsed(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Hide mixer"
                  title="Hide mixer"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <ChannelStripsBar />
            </div>
          ) : (
            <button
              type="button"
              onClick={onShowMixer}
              className="h-9 border-t border-border bg-graphite/80 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-accent/30"
              aria-label="Show mixer"
              title="Show mixer"
            >
              <ChevronUp className="w-3 h-3" />
              Mixer
            </button>
          )}
        </div>

        {/* Right inspector */}
        {showInlineRight ? (
          <aside className="w-80 border-l border-border bg-graphite/80 backdrop-blur flex flex-col overflow-hidden">
            <PanelHeader
              title={`Selected · ${selectedTrack?.name ?? "—"}`}
              onCollapse={() => setRightCollapsed(true)}
              collapseIcon="right"
            />
            <div className="p-3 border-b border-border overflow-y-auto">
              {selectedTrack && <SelectedInstrument trackId={selectedTrack.id} />}
            </div>
            <RightInspectorTabs />
          </aside>
        ) : (
          <CollapsedRail label="Inspector" side="right" onExpand={onShowRight} />
        )}
      </div>

      {/* Tablet drawers — overlay the timeline so the user gets the full
          studio surface without permanently sacrificing arrangement width. */}
      {isTablet && (
        <>
          <Drawer
            open={tabletDrawer === "left"}
            onOpenChange={(o) => !o && setTabletDrawer(null)}
            direction="left"
          >
            <DrawerContent className="h-full w-[20rem] max-w-[85vw] left-0 right-auto rounded-none border-r bg-graphite flex flex-col">
              <DrawerHeader className="text-left p-3 border-b border-border">
                <DrawerTitle className="font-mono uppercase tracking-widest text-xs">
                  Tracks
                </DrawerTitle>
              </DrawerHeader>
              <div className="flex-1 overflow-hidden">
                <LeftBrowser />
              </div>
            </DrawerContent>
          </Drawer>
          <Drawer
            open={tabletDrawer === "right"}
            onOpenChange={(o) => !o && setTabletDrawer(null)}
            direction="right"
          >
            <DrawerContent className="h-full w-[24rem] max-w-[90vw] right-0 left-auto rounded-none border-l bg-graphite flex flex-col">
              <DrawerHeader className="text-left p-3 border-b border-border">
                <DrawerTitle className="font-mono uppercase tracking-widest text-xs">
                  Selected · {selectedTrack?.name ?? "—"}
                </DrawerTitle>
              </DrawerHeader>
              <div className="flex-1 overflow-y-auto touch-scroll p-3 space-y-3">
                {selectedTrack && (
                  <SelectedInstrument trackId={selectedTrack.id} />
                )}
                <Suspense
                  fallback={
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Loading MIDI…
                    </div>
                  }
                >
                  <MidiPanel />
                </Suspense>
              </div>
            </DrawerContent>
          </Drawer>
          <Drawer
            open={tabletDrawer === "mixer"}
            onOpenChange={(o) => !o && setTabletDrawer(null)}
          >
            <DrawerContent className="max-h-[80vh] bg-graphite">
              <DrawerHeader className="text-left">
                <DrawerTitle className="font-mono uppercase tracking-widest text-xs">
                  Mixer
                </DrawerTitle>
              </DrawerHeader>
              <div className="overflow-x-auto overflow-y-auto touch-scroll pb-4">
                <ChannelStripsBar />
              </div>
            </DrawerContent>
          </Drawer>
        </>
      )}

      <Suspense fallback={null}>
        <HelpDialog />
      </Suspense>
      <StatusToast />
      <PwaUpdateToast />
      <DropZone onFiles={handleDroppedAudioFiles} />
      <PendingSampleHost />
      <StudioFooter />

      {/* Corruption recovery — blocks all interaction until resolved */}
      <CorruptionRecoveryDialog
        open={!!corruptionInfo}
        rawJson={corruptionInfo?.rawJson ?? null}
        onRestoreAutosave={onCorruptionRestoreAutosave}
        onStartFresh={onCorruptionStartFresh}
      />

      {/* Missing samples wizard */}
      <MissingSamplesDialog
        open={missingSamplesOpen && missingSamples.length > 0}
        entries={missingSamples}
        onClose={() => {
          setMissingSamplesOpen(false);
          setMissingSamples([]);
          clearBootstrapResult("missingSamples");
        }}
        onMuteTrack={(sampleId) => {
          const tracks = getStore().state.project.tracks.map((t) => {
            const hasMissing = t.audioClips.some((c) => c.id === sampleId);
            if (hasMissing) return { ...t, muted: true };
            return t;
          });
          getStore().patchProject({ tracks });
        }}
      />

      {/* Changelog — auto-opens on version bump */}
      <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
    </div>
  );
}

function PanelHeader({
  title,
  onCollapse,
  collapseIcon,
}: {
  title: string;
  onCollapse: () => void;
  collapseIcon: "left" | "right";
}) {
  const Icon = collapseIcon === "left" ? ChevronLeft : ChevronRight;
  return (
    <div className="h-7 flex items-center justify-between px-3 border-b border-border bg-graphite/80">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground truncate">
        {title}
      </span>
      <button
        type="button"
        onClick={onCollapse}
        className="text-muted-foreground hover:text-foreground"
        aria-label={`Hide ${title}`}
        title={`Hide ${title}`}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

type RightTab = "midi" | "mod";

function RightInspectorTabs() {
  const [tab, setTab] = useState<RightTab>("midi");
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border/60 shrink-0">
        {(["midi", "mod"] as RightTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 h-7 font-mono text-[10px] uppercase tracking-widest transition-colors ${
              tab === t
                ? "bg-neon/10 text-neon border-b-2 border-neon"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "midi" ? "MIDI" : "MOD"}
          </button>
        ))}
      </div>
      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === "midi" ? (
          <div className="p-3 h-full overflow-y-auto">
            <Suspense
              fallback={
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Loading MIDI…
                </div>
              }
            >
              <MidiPanel />
            </Suspense>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="p-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Loading MOD…
              </div>
            }
          >
            <ModulationPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function CollapsedRail({
  label,
  side,
  onExpand,
}: {
  label: string;
  side: "left" | "right";
  onExpand: () => void;
}) {
  const Icon = side === "left" ? ChevronRight : ChevronLeft;
  const border = side === "left" ? "border-r" : "border-l";
  return (
    <button
      type="button"
      onClick={onExpand}
      className={`w-6 ${border} border-border bg-graphite/70 hover:bg-accent/30 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground`}
      aria-label={`Show ${label}`}
      title={`Show ${label}`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        {label}
      </span>
    </button>
  );
}

function PendingSampleHost() {
  const pending = useStore((s) => s.pendingSample);
  return (
    <SamplePreviewDialog
      open={!!pending}
      blob={pending?.blob ?? null}
      defaultName={pending?.defaultName ?? "Sample"}
      recordedTrackId={pending?.recordedTrackId}
      onClose={() => getStore().set({ pendingSample: null })}
    />
  );
}

/**
 * Hidden ARIA live region that announces transport state changes to screen
 * readers. Renders nothing visible — only the text inside aria-live is heard.
 */
function TransportAnnouncer() {
  const isPlaying = useStore((s) => s.isPlaying);
  const isRecording = useStore((s) => s.isRecording);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (isRecording) {
      setMessage("Recording started");
    } else if (isPlaying) {
      setMessage("Playback started");
    } else {
      setMessage("Stopped");
    }
  }, [isPlaying, isRecording]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only absolute w-px h-px overflow-hidden"
      style={{ clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
    >
      {message}
    </div>
  );
}

function SelectedInstrument({ trackId }: { trackId: string }) {
  const track = useStore((s) => s.project.tracks.find((t) => t.id === trackId));
  const showChopLab = useStore((s) => s.chopLab.showChopLab);
  if (!track) return null;
  const instrument = (() => {
    switch (track.kind) {
      case "piano":
      case "bass":
        return <Keyboard track={track} />;
      case "guitar":
        return <GuitarPanel track={track} />;
      case "drums":
        return showChopLab ? (
          <Suspense
            fallback={
              <div className="panel-inset rounded-md p-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Loading Chop Lab...
              </div>
            }
          >
            <ChopLab track={track} />
          </Suspense>
        ) : (
          <DrumPads track={track} />
        );
      case "vocals":
        return <VocalsPanel track={track} />;
    }
  })();
  const isMelodic =
    track.kind === "piano" || track.kind === "guitar" || track.kind === "bass";
  const isDrums = track.kind === "drums";
  return (
    <div className="space-y-3">
      {isDrums && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => getStore().patchChopLab({ showChopLab: false })}
            className={`text-[10px] font-mono px-2 py-0.5 border rounded transition-colors ${
              !showChopLab
                ? "border-primary/60 text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:border-primary/40"
            }`}
          >
            Drum Pads
          </button>
          <button
            onClick={() => getStore().patchChopLab({ showChopLab: true })}
            className={`text-[10px] font-mono px-2 py-0.5 border rounded transition-colors ${
              showChopLab
                ? "border-red-500 text-red-400 bg-red-500/10"
                : "border-border text-muted-foreground hover:border-red-500/60 hover:text-red-400"
            }`}
            title="Chop Lab — load a sample, slice it, play the pads"
          >
            ✂ Chop Lab
          </button>
        </div>
      )}
      {instrument}
      {isMelodic && <PianoRoll track={track} />}
      {isMelodic && <PresetBrowser track={track} />}
      {isMelodic && <MelodicParams track={track} />}
      {track.kind !== "vocals" && <GroovePanel track={track} />}
      <EffectsRack track={track} />
    </div>
  );
}
