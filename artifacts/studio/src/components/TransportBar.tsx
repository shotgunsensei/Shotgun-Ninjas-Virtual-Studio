import { useCallback, useEffect } from "react";
import { Play, Pause, Square, Circle, Volume2, AlertOctagon } from "lucide-react";
import { StereoMeter } from "./Meter";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useStore, getStore } from "../store";
import { audio } from "../lib/audio/engine";
import { noteRecorder, vocalRecorder } from "../lib/audio/recorder";
import { useTransport } from "../hooks/useTransport";
import { MidiLearnButton } from "./MidiLearnButton";

export function TransportBar() {
  const project = useStore((s) => s.project);
  const isRecording = useStore((s) => s.isRecording);
  const isPlaying = useStore((s) => s.isPlaying);
  const countingIn = useStore((s) => s.countingIn);
  const countInBeat = useStore((s) => s.countInBeat);
  const audioUnlocked = useStore((s) => s.audioUnlocked);
  const { play, pause, stop, record } = useTransport();

  // keep engine in sync with project bpm/master/loop/metronome
  useEffect(() => {
    audio.setBpm(project.bpm);
  }, [project.bpm]);
  useEffect(() => {
    audio.setMaster(project.masterVolume);
  }, [project.masterVolume]);
  useEffect(() => {
    audio.setLoop(project.loopEnabled, project.loopStartBeat, project.loopEndBeat);
  }, [project.loopEnabled, project.loopStartBeat, project.loopEndBeat]);
  useEffect(() => {
    audio.setMetronome(project.metronome);
  }, [project.metronome]);

  return (
    <div className="h-16 border-b border-border flex items-center px-4 gap-3 bg-graphite/60 backdrop-blur">
      <div className="flex items-center gap-1.5">
        <Button
          size="icon"
          variant="outline"
          onClick={isPlaying ? pause : play}
          className="h-10 w-10 rounded-md"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 fill-current" />
          )}
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={stop}
          className="h-10 w-10 rounded-md"
          aria-label="Stop"
        >
          <Square className="w-4 h-4 fill-current" />
        </Button>
        <Button
          size="icon"
          variant={isRecording || countingIn ? "destructive" : "outline"}
          onClick={record}
          className={`h-10 w-10 rounded-md ${
            isRecording ? "glow-red animate-pulse" : ""
          }`}
          aria-label="Record"
        >
          <Circle className="w-3.5 h-3.5 fill-current" />
        </Button>
        <MidiLearnButton target={{ kind: "transport-play" }} small />
        <MidiLearnButton target={{ kind: "transport-stop" }} small />
        <MidiLearnButton target={{ kind: "transport-record" }} small />
        <Button
          size="icon"
          variant="outline"
          onClick={async () => {
            // Tear down any in-flight recording before silencing the
            // engine so the mic stream / recorder state can't linger.
            const timers = getStore().state.countInTimers;
            if (timers.interval !== null) window.clearInterval(timers.interval);
            if (timers.timeout !== null) window.clearTimeout(timers.timeout);
            try {
              if (vocalRecorder.isActive()) await vocalRecorder.stop();
            } catch {
              // ignore
            }
            try {
              noteRecorder.stop();
            } catch {
              // ignore
            }
            audio.panicStopAll();
            getStore().set({
              isPlaying: false,
              isRecording: false,
              countingIn: false,
              countInBeat: 0,
              countInTimers: { interval: null, timeout: null },
            });
            // Count-in may have force-enabled the engine metronome even
            // when the project metronome toggle is off. Re-sync engine
            // state to the user's saved project setting so the next
            // playback honors their preference.
            try {
              audio.setMetronome(getStore().state.project.metronome);
            } catch {
              // ignore
            }
            getStore().setStatus("Panic — all notes released", "warn");
          }}
          className="h-8 w-8 rounded-md ml-1 border-red-500/50 text-red-400 hover:bg-red-500/15 hover:text-red-300"
          aria-label="Panic — stop all sound"
          title="Panic — release all notes and tails"
        >
          <AlertOctagon className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="h-8 w-px bg-border" />

      <div className="flex flex-col items-center">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
          BPM
        </label>
        <input
          type="number"
          min={40}
          max={240}
          value={project.bpm}
          onChange={(e) =>
            getStore().patchProject({ bpm: Math.max(40, Math.min(240, Number(e.target.value) || 0)) })
          }
          className="bg-background border border-border rounded-md w-16 h-7 text-center font-mono text-sm"
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Metronome
        </label>
        <Switch
          checked={project.metronome}
          onCheckedChange={(v) => getStore().patchProject({ metronome: v })}
        />
        <MidiLearnButton target={{ kind: "metronome-toggle" }} small />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Count-in
        </label>
        <select
          value={project.countIn ? `${project.countInBars ?? 1}` : "0"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "0") {
              getStore().patchProject({ countIn: false });
            } else {
              getStore().patchProject({
                countIn: true,
                countInBars: v === "2" ? 2 : 1,
              });
            }
          }}
          className="bg-background border border-border rounded-md h-7 px-2 font-mono text-xs"
        >
          <option value="0">Off</option>
          <option value="1">1 bar</option>
          <option value="2">2 bars</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Loop
        </label>
        <Switch
          checked={project.loopEnabled}
          onCheckedChange={(v) => getStore().patchProject({ loopEnabled: v })}
        />
      </div>

      {countingIn && (
        <div className="font-mono text-primary text-sm uppercase tracking-widest animate-pulse">
          Count-in {countInBeat + 1}/4
        </div>
      )}

      <div className="flex-1" />

      {!audioUnlocked && (
        <button
          className="px-3 h-9 rounded-md bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest glow-red"
          onClick={async () => {
            await audio.unlock();
            getStore().set({ audioUnlocked: true });
          }}
        >
          Tap to Enable Audio
        </button>
      )}

      <MasterMeter bpm={project.bpm} pulsing={isPlaying} />

      <div className="flex items-center gap-2 min-w-[180px]">
        <Volume2 className="w-4 h-4 text-muted-foreground" />
        <Slider
          value={[project.masterVolume * 100]}
          max={100}
          step={1}
          onValueChange={([v]) =>
            getStore().patchProject({ masterVolume: (v ?? 0) / 100 })
          }
        />
        <span className="font-mono text-xs w-8 text-right">
          {Math.round(project.masterVolume * 100)}
        </span>
      </div>
    </div>
  );
}

/**
 * Master meter wrapped in a tempo-synced glow ring. The CSS animation runs
 * for one beat (60/bpm seconds) so the highlight visually breathes with the
 * project tempo whenever the transport is rolling.
 */
function MasterMeter({ bpm, pulsing }: { bpm: number; pulsing: boolean }) {
  const getLevels = useCallback(() => audio.getMasterLevels(), []);
  const beatSec = 60 / Math.max(40, Math.min(240, bpm));
  return (
    <div
      className={`flex items-center min-w-[110px] px-2 py-1 rounded-md panel-inset ${
        pulsing ? "master-pulse-active" : ""
      }`}
      style={{ ["--master-pulse-duration" as string]: `${beatSec}s` }}
    >
      <StereoMeter getLevels={getLevels} label="MAS" showClip />
    </div>
  );
}
