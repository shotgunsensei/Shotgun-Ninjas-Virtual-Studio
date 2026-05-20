import { useState, useMemo } from "react";
import {
  Play,
  Pause,
  Square,
  Circle,
  Menu,
  Sliders,
  Layers,
  HelpCircle,
  Download,
  Save,
  FolderOpen,
  FilePlus2,
  Settings as SettingsIcon,
  Info,
  Maximize2,
  Keyboard as KeyboardIcon,
  Volume2,
  AlertOctagon,
} from "lucide-react";
import { useStore, getStore } from "../store";
import { audio } from "../lib/audio/engine";
import { useTransport } from "../hooks/useTransport";
import { Logo } from "./Logo";
import { ChannelStripsBar } from "./ChannelStrip";
import { LeftBrowser } from "./LeftBrowser";
import { Keyboard } from "./instruments/Keyboard";
import { GuitarPanel } from "./instruments/GuitarPanel";
import { DrumPads } from "./instruments/DrumPads";
import { VocalsPanel } from "./instruments/VocalsPanel";
import { Slider } from "@/components/ui/slider";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { noteRecorder, vocalRecorder } from "../lib/audio/recorder";

/**
 * Performance/sketch shell for phones (<600px). Prioritizes pads,
 * transport, simple sequencer, project load/save, export, and demo
 * loading. Secondary surfaces (mixer, full track browser) live behind
 * a bottom drawer so the user can stay focused on the instrument they
 * are currently playing.
 *
 * No audio state is owned here — every store + engine call mirrors what
 * the desktop Studio does, so switching between layouts on a window
 * resize doesn't restart playback or lose project state.
 */
export function MobileStudio() {
  const project = useStore((s) => s.project);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectedTrack = useMemo(
    () =>
      project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0],
    [project.tracks, selectedTrackId],
  );

  const isPlaying = useStore((s) => s.isPlaying);
  const isRecording = useStore((s) => s.isRecording);
  const audioUnlocked = useStore((s) => s.audioUnlocked);
  const { play, pause, stop, record } = useTransport();

  const [menuOpen, setMenuOpen] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [tracksOpen, setTracksOpen] = useState(false);

  return (
    <div className="h-full flex flex-col text-foreground overflow-hidden bg-background">
      {/* Compact header */}
      <header className="h-12 flex items-center px-3 gap-2 border-b border-border bg-graphite shrink-0">
        <Logo className="w-7 h-7" />
        <input
          value={project.name}
          onChange={(e) => getStore().patchProject({ name: e.target.value })}
          className="flex-1 min-w-0 h-8 bg-background border border-border rounded-md px-2 font-mono text-sm"
          aria-label="Project name"
        />
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="h-9 w-9 rounded-md border border-border flex items-center justify-center hover-elevate active-elevate"
          aria-label="Menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Compact transport */}
      <div className="h-14 px-3 flex items-center gap-2 border-b border-border bg-graphite/60 shrink-0 touch-scroll-x overflow-x-auto">
        <button
          type="button"
          onClick={isPlaying ? pause : play}
          className="touch-pad h-11 w-11 shrink-0 rounded-md border border-border bg-background flex items-center justify-center hover-elevate active-elevate"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5" />
          ) : (
            <Play className="w-5 h-5 fill-current" />
          )}
        </button>
        <button
          type="button"
          onClick={stop}
          className="touch-pad h-11 w-11 shrink-0 rounded-md border border-border bg-background flex items-center justify-center hover-elevate active-elevate"
          aria-label="Stop"
        >
          <Square className="w-4 h-4 fill-current" />
        </button>
        <button
          type="button"
          onClick={record}
          className={`touch-pad h-11 w-11 shrink-0 rounded-md border flex items-center justify-center hover-elevate active-elevate ${
            isRecording
              ? "bg-primary/80 border-primary text-primary-foreground glow-red animate-pulse"
              : "bg-background border-border"
          }`}
          aria-label="Record"
        >
          <Circle className="w-4 h-4 fill-current" />
        </button>
        <button
          type="button"
          onClick={async () => {
            const timers = getStore().state.countInTimers;
            if (timers.interval !== null) window.clearInterval(timers.interval);
            if (timers.timeout !== null) window.clearTimeout(timers.timeout);
            try {
              if (vocalRecorder.isActive()) await vocalRecorder.stop();
            } catch {
              /* ignore */
            }
            try {
              noteRecorder.stop();
            } catch {
              /* ignore */
            }
            audio.panicStopAll();
            getStore().set({
              isPlaying: false,
              isRecording: false,
              countingIn: false,
              countInBeat: 0,
              countInTimers: { interval: null, timeout: null },
            });
            try {
              audio.setMetronome(getStore().state.project.metronome);
            } catch {
              /* ignore */
            }
            getStore().setStatus("Panic — all notes released", "warn");
          }}
          className="touch-pad h-11 w-11 shrink-0 rounded-md border border-red-500/50 text-red-400 flex items-center justify-center hover-elevate active-elevate"
          aria-label="Panic — stop all sound"
          title="Panic"
        >
          <AlertOctagon className="w-4 h-4" />
        </button>
        <div className="flex flex-col items-center px-2 shrink-0">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
            BPM
          </span>
          <input
            type="number"
            min={40}
            max={240}
            value={project.bpm}
            onChange={(e) =>
              getStore().patchProject({
                bpm: Math.max(40, Math.min(240, Number(e.target.value) || 0)),
              })
            }
            className="bg-background border border-border rounded-md w-14 h-7 text-center font-mono text-xs"
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0 min-w-[130px]">
          <Volume2 className="w-4 h-4 text-muted-foreground" />
          <Slider
            value={[project.masterVolume * 100]}
            max={100}
            step={1}
            onValueChange={([v]) =>
              getStore().patchProject({ masterVolume: (v ?? 0) / 100 })
            }
          />
        </div>
      </div>

      {!audioUnlocked && (
        <div className="px-3 py-2 border-b border-border bg-graphite/40 shrink-0">
          <button
            type="button"
            className="w-full h-11 rounded-md bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest glow-red"
            onClick={async () => {
              await audio.unlock();
              getStore().set({ audioUnlocked: true });
            }}
          >
            Tap to Enable Audio
          </button>
        </div>
      )}

      {/* Track tabs — horizontal scroll to switch the focused instrument */}
      <div className="border-b border-border bg-graphite/40 shrink-0">
        <div className="flex overflow-x-auto touch-scroll-x">
          {project.tracks.map((t) => {
            const active = t.id === selectedTrack?.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => getStore().set({ selectedTrackId: t.id })}
                className={`px-3 py-2 font-mono text-[11px] uppercase tracking-widest whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground"
                }`}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main instrument area */}
      <main className="flex-1 overflow-y-auto touch-scroll p-3">
        {selectedTrack && (
          <MobileInstrumentPanel trackId={selectedTrack.id} kind={selectedTrack.kind} />
        )}
      </main>

      {/* Bottom action bar */}
      <div className="h-14 px-2 grid grid-cols-3 gap-2 border-t border-border bg-graphite shrink-0">
        <ActionButton
          icon={<Layers className="w-4 h-4" />}
          label="Tracks"
          onClick={() => setTracksOpen(true)}
        />
        <ActionButton
          icon={<Sliders className="w-4 h-4" />}
          label="Mixer"
          onClick={() => setMixerOpen(true)}
        />
        <ActionButton
          icon={<Download className="w-4 h-4" />}
          label="Export"
          onClick={() => window.dispatchEvent(new CustomEvent("studio:open-export"))}
        />
      </div>

      {/* Menu drawer */}
      <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
        <DrawerContent className="max-h-[85vh] bg-graphite">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-mono uppercase tracking-widest text-sm">
              Menu
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 grid grid-cols-2 gap-2 overflow-y-auto touch-scroll">
            <MenuItem
              icon={<FilePlus2 className="w-4 h-4" />}
              label="New"
              onClick={() => {
                setMenuOpen(false);
                window.dispatchEvent(new CustomEvent("studio:new-project"));
              }}
            />
            <MenuItem
              icon={<Save className="w-4 h-4" />}
              label="Save"
              onClick={() => {
                setMenuOpen(false);
                window.dispatchEvent(new CustomEvent("studio:save"));
              }}
            />
            <MenuItem
              icon={<Save className="w-4 h-4" />}
              label="Save As"
              onClick={() => {
                setMenuOpen(false);
                window.dispatchEvent(new CustomEvent("studio:save-as"));
              }}
            />
            <MenuItem
              icon={<FolderOpen className="w-4 h-4" />}
              label="Load / Demos"
              onClick={() => {
                setMenuOpen(false);
                window.dispatchEvent(new CustomEvent("studio:open-load"));
              }}
            />
            <MenuItem
              icon={<Download className="w-4 h-4" />}
              label="Export"
              onClick={() => {
                setMenuOpen(false);
                window.dispatchEvent(new CustomEvent("studio:open-export"));
              }}
            />
            <MenuItem
              icon={<HelpCircle className="w-4 h-4" />}
              label="Help"
              onClick={() => {
                setMenuOpen(false);
                getStore().set({ showHelp: true });
              }}
            />
            <MenuItem
              icon={<KeyboardIcon className="w-4 h-4" />}
              label="Shortcuts"
              onClick={() => {
                setMenuOpen(false);
                window.dispatchEvent(new CustomEvent("studio:open-shortcuts"));
              }}
            />
            <MenuItem
              icon={<SettingsIcon className="w-4 h-4" />}
              label="Settings"
              onClick={() => {
                setMenuOpen(false);
                window.dispatchEvent(new CustomEvent("studio:open-settings"));
              }}
            />
            <MenuItem
              icon={<Info className="w-4 h-4" />}
              label="About"
              onClick={() => {
                setMenuOpen(false);
                window.dispatchEvent(new CustomEvent("studio:open-about"));
              }}
            />
            <MenuItem
              icon={<Maximize2 className="w-4 h-4" />}
              label="Fullscreen"
              onClick={() => {
                setMenuOpen(false);
                if (document.fullscreenElement) {
                  document.exitFullscreen().catch(() => undefined);
                } else {
                  document.documentElement
                    .requestFullscreen?.()
                    .catch(() =>
                      getStore().setStatus("Fullscreen blocked.", "warn"),
                    );
                }
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Mixer drawer */}
      <Drawer open={mixerOpen} onOpenChange={setMixerOpen}>
        <DrawerContent className="max-h-[85vh] bg-graphite">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-mono uppercase tracking-widest text-sm">
              Mixer
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-x-auto overflow-y-auto touch-scroll pb-4">
            <ChannelStripsBar />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Tracks / browser drawer */}
      <Drawer open={tracksOpen} onOpenChange={setTracksOpen}>
        <DrawerContent className="max-h-[85vh] bg-graphite">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-mono uppercase tracking-widest text-sm">
              Tracks &amp; Browser
            </DrawerTitle>
          </DrawerHeader>
          <div className="h-[60vh] overflow-hidden flex flex-col">
            <LeftBrowser />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function MobileInstrumentPanel({
  trackId,
  kind,
}: {
  trackId: string;
  kind: string;
}) {
  const track = useStore((s) => s.project.tracks.find((t) => t.id === trackId));
  if (!track) return null;
  switch (kind) {
    case "drums":
      return <DrumPads track={track} />;
    case "piano":
    case "bass":
      return <Keyboard track={track} />;
    case "guitar":
      return <GuitarPanel track={track} />;
    case "vocals":
      return <VocalsPanel track={track} />;
    default:
      return null;
  }
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="touch-pad rounded-md border border-border bg-background hover-elevate active-elevate flex flex-col items-center justify-center gap-0.5"
    >
      {icon}
      <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </button>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="touch-pad rounded-md border border-border bg-background hover-elevate active-elevate flex items-center gap-2 px-3 py-3 text-left"
    >
      {icon}
      <span className="font-mono text-xs uppercase tracking-widest">
        {label}
      </span>
    </button>
  );
}

