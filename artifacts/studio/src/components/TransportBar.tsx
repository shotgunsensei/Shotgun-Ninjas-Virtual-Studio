import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Square, Circle, Volume2, AlertOctagon, AlertTriangle } from "lucide-react";
import { StereoMeter } from "./Meter";
import { MasterScope } from "./MasterScope";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useStore, getStore } from "../store";
import { audio } from "../lib/audio/engine";
import { noteRecorder, vocalRecorder } from "../lib/audio/recorder";
import { useTransport } from "../hooks/useTransport";
import { MidiLearnButton } from "./MidiLearnButton";
import { Tip } from "./Tip";
import { useSettings } from "../lib/settings";
import { OfflineReadyIndicator } from "./PwaInstallControls";

export function TransportBar() {
  const bpm = useStore((s) => s.project.bpm);
  const masterVolume = useStore((s) => s.project.masterVolume);
  const loopEnabled = useStore((s) => s.project.loopEnabled);
  const loopStartBeat = useStore((s) => s.project.loopStartBeat);
  const loopEndBeat = useStore((s) => s.project.loopEndBeat);
  const metronome = useStore((s) => s.project.metronome);
  const countIn = useStore((s) => s.project.countIn);
  const countInBars = useStore((s) => s.project.countInBars);
  const globalSwing = useStore((s) => s.project.globalGroove?.swing ?? 0);
  const isRecording = useStore((s) => s.isRecording);
  const isPlaying = useStore((s) => s.isPlaying);
  const countingIn = useStore((s) => s.countingIn);
  const countInBeat = useStore((s) => s.countInBeat);
  const audioUnlocked = useStore((s) => s.audioUnlocked);
  const { play, pause, stop, record } = useTransport();
  const metronomeVolume = useSettings((s) => s.metronomeVolume);

  useEffect(() => { audio.setBpm(bpm); }, [bpm]);
  useEffect(() => { audio.setMaster(masterVolume); }, [masterVolume]);
  useEffect(() => {
    audio.setLoop(loopEnabled, loopStartBeat, loopEndBeat);
  }, [loopEnabled, loopStartBeat, loopEndBeat]);
  useEffect(() => { audio.setMetronome(metronome); }, [metronome]);
  useEffect(() => { audio.setMetronomeVolume(metronomeVolume); }, [metronomeVolume]);
  useEffect(() => { audio.setSwing(globalSwing); }, [globalSwing]);

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
        <Tip label="Project tempo (40–240)">
          <input
            type="number"
            min={40}
            max={240}
            value={bpm}
            onChange={(e) =>
              getStore().patchProject({ bpm: Math.max(40, Math.min(240, Number(e.target.value) || 0)) })
            }
            className="bg-background border border-border rounded-md w-16 h-7 text-center font-mono text-sm"
          />
        </Tip>
      </div>

      <div className="flex flex-col items-center min-w-[88px]">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Swing
        </label>
        <div className="flex items-center gap-1 w-full">
          <Slider
            value={[Math.round(globalSwing * 100)]}
            max={100}
            step={1}
            onValueChange={([v]) =>
              getStore().setGlobalGroove({ swing: (v ?? 0) / 100 })
            }
          />
          <span className="font-mono text-[10px] w-6 text-right tabular-nums">
            {Math.round(globalSwing * 100)}
          </span>
        </div>
      </div>

      <PositionReadout isPlaying={isPlaying} />

      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Metronome
        </label>
        <Switch
          checked={metronome}
          onCheckedChange={(v) => getStore().patchProject({ metronome: v })}
        />
        <MidiLearnButton target={{ kind: "metronome-toggle" }} small />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Count-in
        </label>
        <select
          value={countIn ? `${countInBars ?? 1}` : "0"}
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
          checked={loopEnabled}
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

      <OfflineReadyIndicator />
      <MasterScope width={96} height={28} />
      <MasterMeter bpm={bpm} pulsing={isPlaying} />
      <MasterClipBadge />

      <div className="flex items-center gap-2 min-w-[180px]">
        <Volume2 className="w-4 h-4 text-muted-foreground" />
        <Slider
          value={[masterVolume * 100]}
          max={100}
          step={1}
          onValueChange={([v]) =>
            getStore().patchProject({ masterVolume: (v ?? 0) / 100 })
          }
        />
        <span className="font-mono text-xs w-8 text-right">
          {Math.round(masterVolume * 100)}
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
/**
 * Bar.beat.step transport readout polled from the engine while playback
 * is rolling. Writes directly to a DOM span instead of calling setState
 * so it never causes a React re-render during playback.
 */
function PositionReadout({ isPlaying }: { isPlaying: boolean }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      if (ts - last > 60) {
        last = ts;
        if (spanRef.current) {
          const beats = audio.positionBeats();
          const bar = Math.floor(beats / 4) + 1;
          const beat = Math.floor(beats % 4) + 1;
          const step = Math.floor((beats * 4) % 4) + 1;
          spanRef.current.textContent = `${bar}.${beat}.${step}`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);
  return (
    <Tip label="Bar . beat . sixteenth (musical position)">
      <div className="flex flex-col items-center px-2 py-1 rounded-md panel-inset min-w-[78px]">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
          Position
        </span>
        <span ref={spanRef} className="font-mono text-sm tabular-nums text-primary">
          1.1.1
        </span>
      </div>
    </Tip>
  );
}

/**
 * Latching clip-warning badge that sits next to the master meter. Polls
 * the engine's peak meter and lights up red when the master ever exceeds
 * -0.1 dBFS; clicking the badge clears the latch.
 */
function MasterClipBadge() {
  const [clipped, setClipped] = useState(false);
  const lastWarnRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const lv = audio.getMasterLevels().peakDb;
      const peak = Math.max(lv[0], lv[1]);
      if (peak >= -0.1 && Number.isFinite(peak)) {
        setClipped(true);
        // Surface a toast at most once every 5s so the user notices
        // without getting spammed during a long loud section.
        const now = performance.now();
        if (now - lastWarnRef.current > 5000) {
          lastWarnRef.current = now;
          getStore().setStatus(
            `Master clipped (${peak.toFixed(1)} dBFS) — lower master volume.`,
            "warn",
          );
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!clipped) return null;
  return (
    <Tip label="Master clipped — click to clear">
      <button
        type="button"
        onClick={() => setClipped(false)}
        className="flex items-center gap-1 px-2 h-7 rounded-md border border-red-500/60 bg-red-500/15 text-red-300 font-mono text-[10px] uppercase tracking-widest studio-clip-led"
        aria-label="Master clipped, click to reset"
      >
        <AlertTriangle className="w-3 h-3" />
        Clip
      </button>
    </Tip>
  );
}

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
