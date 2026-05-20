import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { Header } from "./components/Header";
import { StudioFooter } from "./components/Footer";
import { TransportBar } from "./components/TransportBar";
import { Timeline } from "./components/Timeline";
import { ChannelStripsBar } from "./components/ChannelStrip";
// MidiPanel is heavier than the rest of the inspector (pulls in the
// MIDI runtime + device listing) and lives in a collapsible aside, so
// lazy-loading it keeps the initial bundle smaller without affecting
// users who never open the right-hand inspector.
const MidiPanel = lazy(() =>
  import("./components/MidiPanel").then((m) => ({ default: m.MidiPanel })),
);
import { HelpDialog } from "./components/HelpDialog";
import { StatusToast } from "./components/StatusToast";
import { PwaUpdateToast } from "./components/PwaUpdateToast";
import { BackgroundFx } from "./components/BackgroundFx";
import { Logo } from "./components/Logo";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applySideEffects, getSettings, subscribeSettings } from "./lib/settings";
import { APP_NAME } from "./lib/version";
import { DropZone } from "./components/DropZone";
import { SamplePreviewDialog } from "./components/SamplePreviewDialog";
import { StudioErrorBoundary } from "./components/ErrorBoundary";
import { LeftBrowser } from "./components/LeftBrowser";
import { applyTheme, getStoredThemeId } from "./lib/themes";
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
import { vocalRecorder, noteRecorder } from "./lib/audio/recorder";
import { defaultProject, flushMixToEngine, getStore, resetStore, useStore } from "./store";
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
import { useMidiEvents } from "./lib/midi/midi";
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
}
let bootstrapResult: BootstrapResult = { health: null, draftAvailable: null };

function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    // Register all built-in instrument and effect plugins before the engine
    // starts so the plugin browser and automation hooks are ready immediately.
    initPluginSystem();
    const settings = getSettings();
    let project = null;
    try {
      const lastId = await getLastProjectId();
      // Honor the "Restore last project on launch" preference — when the
      // user has turned it off we always boot into a fresh project.
      if (lastId && settings.restoreLastProjectOnLaunch) {
        project = await loadProject(lastId);
      }
    } catch (err) {
      console.error("bootstrap load failed", err);
      project = null;
    }
    if (!project) {
      project = defaultProject();
      resetStore(project);
      let shown = false;
      try {
        shown = localStorage.getItem("studio.onboardingShown") === "1";
      } catch {
        /* ignore */
      }
      if (!shown) getStore().set({ showOnboarding: true });
    } else {
      resetStore(project);
    }
    try {
      for (const t of project.tracks) audio.ensureTrack(t);
      flushMixToEngine(project);
    } catch (err) {
      console.error("bootstrap engine init failed", err);
    }
    // Project health: surface missing samples / orphaned data so the
    // user can act on it before they edit on top of broken state.
    try {
      bootstrapResult.health = checkProjectHealth(project);
    } catch (err) {
      console.error("health check failed", err);
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
        draft.projectId === project.id &&
        (!lastSaved ||
          lastSaved.projectId !== project.id ||
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
  })();
  return bootstrapPromise;
}

function getBootstrapResult(): BootstrapResult {
  return bootstrapResult;
}

function clearBootstrapResult(key: "health" | "draftAvailable") {
  bootstrapResult = { ...bootstrapResult, [key]: null };
}

// Apply the persisted theme + UI preferences synchronously at module-
// eval time so the very first render doesn't flash the default palette
// or scroll past unwanted animations.
if (typeof document !== "undefined") {
  try {
    applyTheme(getStoredThemeId());
    applySideEffects();
  } catch {
    /* SSR-safe no-op */
  }
}

export default function App() {
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
    <TooltipProvider delayDuration={250}>
      <StudioErrorBoundary onPanic={() => audio.panicStopAll()}>
        <Studio />
      </StudioErrorBoundary>
    </TooltipProvider>
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
        data1: e.data1,
        data2: e.data2,
        device: e.device,
      });
      const store = getStore();
      // if learning, bind
      if (store.state.midiLearnTargetId && (e.type === "noteon" || e.type === "cc")) {
        store.bindMidiLearn(e.signature, e.device);
        store.setStatus(`MIDI learned: ${e.signature}`, "info");
        return;
      }
      // otherwise: dispatch any matching mapping
      const matches = store.state.project.midiMappings.filter(
        (m) => m.signature === e.signature,
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
  const dirtyRef = useRef(false);
  const lastSavedAtRef = useRef<number>(getStore().state.project.updatedAt);
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
    let isFirst = true;
    return getStore().subscribe(() => {
      const next = getStore().state.project;
      if (next === projectRef.current) return;
      projectRef.current = next;
      if (isFirst) { isFirst = false; return; }
      dirtyRef.current = true;
      if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = window.setTimeout(() => {
        saveDraft(next).catch(() => { /* ignore quota / serialization errors */ });
      }, 800);
    });
  }, []);

  // Periodic real autosave on a user-configurable interval. 0 disables
  // (manual Save still works). Always writes when dirty, regardless of
  // debounce — the user explicitly opted into this cadence.
  useEffect(() => {
    if (autosaveSec === 0) return;
    if (isTransient) return;
    const handle = window.setInterval(() => {
      if (!dirtyRef.current) return;
      const snap = projectRef.current;
      saveProject(snap)
        .then(() => {
          lastSavedAtRef.current = Date.now();
          dirtyRef.current = false;
        })
        .catch(() => {
          /* ignore quota errors — next tick will retry */
        });
    }, autosaveSec * 1000);
    return () => window.clearInterval(handle);
  }, [autosaveSec, isTransient]);

  // beforeunload: best-effort flush of the draft slot so a tab close
  // mid-edit still leaves the most recent state recoverable. We can't
  // await async work here, but saveDraft kicks off the IDB write
  // immediately and most browsers will let it complete.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (!dirtyRef.current) return;
      try {
        saveDraft(projectRef.current);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

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
      for (const t of recovered.tracks) audio.ensureTrack(t);
      flushMixToEngine(recovered);
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
        <HelpDialog />
        <StatusToast />
        <DropZone
          onFiles={(files) => {
            const f = files[0];
            if (!f) return;
            getStore().set({
              pendingSample: {
                blob: f,
                defaultName: f.name.replace(/\.[^.]+$/, "") || "Imported",
              },
            });
          }}
        />
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
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
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
            <div className="p-3 flex-1 overflow-hidden">
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

      <HelpDialog />
      <StatusToast />
      <PwaUpdateToast />
      <DropZone
        onFiles={(files) => {
          const f = files[0];
          if (!f) return;
          getStore().set({
            pendingSample: {
              blob: f,
              defaultName: f.name.replace(/\.[^.]+$/, "") || "Imported",
            },
          });
        }}
      />
      <PendingSampleHost />
      <StudioFooter />
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

function SelectedInstrument({ trackId }: { trackId: string }) {
  const track = useStore((s) => s.project.tracks.find((t) => t.id === trackId));
  if (!track) return null;
  const instrument = (() => {
    switch (track.kind) {
      case "piano":
      case "bass":
        return <Keyboard track={track} />;
      case "guitar":
        return <GuitarPanel track={track} />;
      case "drums":
        return <DrumPads track={track} />;
      case "vocals":
        return <VocalsPanel track={track} />;
    }
  })();
  const isMelodic =
    track.kind === "piano" || track.kind === "guitar" || track.kind === "bass";
  return (
    <div className="space-y-3">
      {instrument}
      {isMelodic && <PianoRoll track={track} />}
      {isMelodic && <PresetBrowser track={track} />}
      {isMelodic && <MelodicParams track={track} />}
      {track.kind !== "vocals" && <GroovePanel track={track} />}
      <EffectsRack track={track} />
    </div>
  );
}
