import { useEffect, useMemo, useRef } from "react";
import { Header } from "./components/Header";
import { TransportBar } from "./components/TransportBar";
import { Timeline } from "./components/Timeline";
import { ChannelStripsBar } from "./components/ChannelStrip";
import { MidiPanel } from "./components/MidiPanel";
import { HelpDialog } from "./components/HelpDialog";
import { StatusToast } from "./components/StatusToast";
import { BackgroundFx } from "./components/BackgroundFx";
import { DropZone } from "./components/DropZone";
import { SamplePreviewDialog } from "./components/SamplePreviewDialog";
import { Keyboard } from "./components/instruments/Keyboard";
import { GuitarPanel } from "./components/instruments/GuitarPanel";
import { DrumPads } from "./components/instruments/DrumPads";
import { PianoRoll } from "./components/instruments/PianoRoll";
import { VocalsPanel } from "./components/instruments/VocalsPanel";
import { PresetBrowser } from "./components/PresetBrowser";
import { GroovePanel } from "./components/GroovePanel";
import { MelodicParams } from "./components/MelodicParams";
import { useTransport } from "./hooks/useTransport";
import { audio } from "./lib/audio/engine";
import { vocalRecorder, noteRecorder } from "./lib/audio/recorder";
import { defaultProject, getStore, resetStore, useStore } from "./store";
import { getLastProjectId, loadProject, saveProject } from "./lib/storage/db";
import { useMidiEvents } from "./lib/midi/midi";
import type { DrumPiece } from "./lib/audio/engine";

let bootstrapped = false;
let bootstrapPromise: Promise<void> | null = null;

function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    let project = null;
    try {
      const lastId = await getLastProjectId();
      if (lastId) project = await loadProject(lastId);
    } catch {
      project = null;
    }
    if (!project) {
      project = defaultProject();
      resetStore(project);
      // first-run: show onboarding
      getStore().set({ showOnboarding: true });
    } else {
      resetStore(project);
    }
    // ensure all engine voices exist
    for (const t of project.tracks) audio.ensureTrack(t);
    bootstrapped = true;
  })();
  return bootstrapPromise;
}

export default function App() {
  // synchronously kick off bootstrap; return loader until ready
  if (!bootstrapped) {
    throw bootstrap();
  }
  return <Studio />;
}

function Studio() {
  const project = useStore((s) => s.project);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectedTrack = useMemo(
    () => project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0],
    [project.tracks, selectedTrackId],
  );
  const { play, pause, stop, record } = useTransport();
  const isPlaying = useStore((s) => s.isPlaying);

  // global keyboard shortcuts (excluding text inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (isPlaying) pause();
        else play();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        record();
      } else if (e.key === "Escape") {
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying, play, pause, record, stop]);

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

  // autosave debounced
  const saveTimerRef = useRef<number | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveProject(projectRef.current).catch(() => {
        /* ignore quota errors */
      });
    }, 1500);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [project]);

  // stop vocals on unmount safety
  useEffect(() => {
    return () => {
      project.tracks.forEach((t) => {
        if (t.kind === "vocals") audio.stopVocalMonitor(t.id);
      });
      if (vocalRecorder.isActive()) vocalRecorder.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full flex flex-col text-foreground overflow-hidden relative">
      <BackgroundFx />
      <Header />
      <TransportBar />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <Timeline />
          <ChannelStripsBar />
        </div>
        <div className="w-80 border-l border-border bg-graphite/80 backdrop-blur flex flex-col overflow-hidden">
          <div className="p-3 border-b border-border">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              Selected · {selectedTrack?.name ?? "—"}
            </div>
            {selectedTrack && <SelectedInstrument trackId={selectedTrack.id} />}
          </div>
          <div className="p-3 flex-1 overflow-hidden">
            <MidiPanel />
          </div>
        </div>
      </div>
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
    </div>
  );
}
