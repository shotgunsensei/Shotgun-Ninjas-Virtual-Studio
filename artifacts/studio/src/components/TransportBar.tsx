import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Square, Circle, Volume2, AlertOctagon, AlertTriangle, RadioTower, Gamepad2, Activity, History, Trash2, ExternalLink } from "lucide-react";
import { WorldPickerButton } from "./WorldPicker";
import { StereoMeter } from "./Meter";
import { MasterScope } from "./MasterScope";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useStore, getStore } from "../store";
import type { ClipHistoryEntry } from "../store";
import { audio } from "../lib/audio/engine";
import { noteRecorder, vocalRecorder } from "../lib/audio/recorder";
import { useTransport } from "../hooks/useTransport";
import { MidiLearnButton } from "./MidiLearnButton";
import { Tip } from "./Tip";
import { useSettings } from "../lib/settings";
import { OfflineReadyIndicator } from "./PwaInstallControls";
import { useMidi, useMidiEvents, midiNoteToName } from "../lib/midi/midi";
import { DEFAULT_GAMEPAD_MAPPINGS } from "../lib/performance/router";
import { useGamepad } from "../lib/performance/gamepad";
import { visualTicker } from "../lib/visualTicker";

const AudioDiagnosticsPanel = lazy(() =>
  import("./AudioDiagnosticsPanel").then((m) => ({ default: m.AudioDiagnosticsPanel })),
);

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
  const [diagOpen, setDiagOpen] = useState(false);

  useEffect(() => { audio.setBpm(bpm); }, [bpm]);
  useEffect(() => { audio.setMaster(masterVolume); }, [masterVolume]);
  useEffect(() => {
    audio.setLoop(loopEnabled, loopStartBeat, loopEndBeat);
  }, [loopEnabled, loopStartBeat, loopEndBeat]);
  useEffect(() => { audio.setMetronome(metronome); }, [metronome]);
  useEffect(() => { audio.setMetronomeVolume(metronomeVolume); }, [metronomeVolume]);
  useEffect(() => { audio.setSwing(globalSwing); }, [globalSwing]);

  return (
    <div className="relative">
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
        <MidiActivityIndicator />
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
            getStore().set((s) => ({
              transportScheduleRevision: s.transportScheduleRevision + 1,
            }));
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
        <div className="flex items-center gap-0.5">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
            BPM
          </label>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("studio:open-glossary", { detail: { term: "BPM" } }))}
            className="inline-flex items-center justify-center w-3 h-3 rounded-full border border-muted-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground/60 font-mono text-[8px] leading-none transition-colors"
            aria-label="What is BPM? Open glossary"
            title="What is BPM?"
          >?</button>
        </div>
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
            aria-label="BPM — project tempo"
            aria-valuenow={bpm}
            aria-valuemin={40}
            aria-valuemax={240}
          />
        </Tip>
      </div>

      <div className="flex flex-col items-center min-w-[88px]">
        <div className="flex items-center gap-0.5">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Swing
          </label>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("studio:open-glossary", { detail: { term: "Swing" } }))}
            className="inline-flex items-center justify-center w-3 h-3 rounded-full border border-muted-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground/60 font-mono text-[8px] leading-none transition-colors"
            aria-label="What is Swing? Open glossary"
            title="What is Swing?"
          >?</button>
        </div>
        <div className="flex items-center gap-1 w-full">
          <Slider
            value={[Math.round(globalSwing * 100)]}
            max={100}
            step={1}
            onValueChange={([v]) =>
              getStore().setGlobalGroove({ swing: (v ?? 0) / 100 })
            }
            aria-label="Swing amount"
            aria-valuenow={Math.round(globalSwing * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
          <span className="font-mono text-[10px] w-6 text-right tabular-nums" aria-hidden>
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

      <PerformanceButton />
      <WorldPickerButton />

      <div className="flex-1" />

      {!audioUnlocked && (
        <button
          className="px-3 h-9 rounded-md bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest glow-red"
          onClick={async () => {
            await audio.unlock();
            window.requestAnimationFrame(() => {
              getStore().set({ audioUnlocked: true });
            });
          }}
        >
          Tap to Enable Audio
        </button>
      )}

      <OfflineReadyIndicator />
      <MasterScope width={96} height={28} />
      <MasterMeter bpm={bpm} pulsing={isPlaying} />
      <ProjectClipBadge />
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

      <Tip label="Audio diagnostics panel">
        <Button
          size="icon"
          variant={diagOpen ? "secondary" : "ghost"}
          onClick={() => setDiagOpen((v) => !v)}
          className={`h-7 w-7 rounded-md ${diagOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          aria-label="Toggle audio diagnostics panel"
        >
          <Activity className="w-3.5 h-3.5" />
        </Button>
      </Tip>
    </div>
    {diagOpen && (
      <Suspense fallback={null}>
        <AudioDiagnosticsPanel open={diagOpen} onClose={() => setDiagOpen(false)} />
      </Suspense>
    )}
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
  const lastTextRef = useRef("1.1.1");
  useEffect(() => {
    if (!isPlaying) return;
    // Use the shared visualTicker so this loop pauses automatically when the
    // tab is hidden and shares one rAF with all other subscribers.
    return visualTicker.subscribe(() => {
      if (spanRef.current) {
        const beats = audio.positionBeats();
        const bar = Math.floor(beats / 4) + 1;
        const beat = Math.floor(beats % 4) + 1;
        const step = Math.floor((beats * 4) % 4) + 1;
        const next = `${bar}.${beat}.${step}`;
        if (next !== lastTextRef.current) {
          lastTextRef.current = next;
          spanRef.current.textContent = next;
        }
      }
    });
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
  const clippedRef = useRef(false);
  const lastWarnRef = useRef(0);
  useEffect(() => {
    // Use the shared visualTicker so this loop pauses automatically when the
    // tab is hidden and shares one rAF with all other meters.
    return visualTicker.subscribe(() => {
      const lv = audio.getMasterLevels().peakDb;
      const peak = Math.max(lv[0], lv[1]);
      if (peak >= -0.1 && Number.isFinite(peak)) {
        if (!clippedRef.current) {
          clippedRef.current = true;
          setClipped(true);
        }
        // Surface a toast at most once every 5 s so the user notices
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
    });
  }, []);
  if (!clipped) return null;
  return (
    <Tip label="Master clipped — click to clear">
      <button
        type="button"
        onClick={() => {
          clippedRef.current = false;
          setClipped(false);
        }}
        className="flex items-center gap-1 px-2 h-7 rounded-md border border-red-500/60 bg-red-500/15 text-red-300 font-mono text-[10px] uppercase tracking-widest studio-clip-led"
        aria-label="Master clipped, click to reset"
      >
        <AlertTriangle className="w-3 h-3" />
        Clip
      </button>
    </Tip>
  );
}

/**
 * Glowing dot in the transport bar that pulses on every incoming MIDI noteon
 * or CC and shows the last note name / CC number for ~1 s.
 * Also displays the selected MIDI device name (truncated) when a device is
 * active. Hidden entirely when MIDI status is not 'ready'.
 */
function MidiActivityIndicator() {
  const { status, selectedId, inputs } = useMidi();
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useMidiEvents((e) => {
    if (e.type !== "noteon" && e.type !== "cc") return;
    const text = e.type === "noteon" ? midiNoteToName(e.data1) : `CC${e.data1}`;
    setLabel(text);
    setActive(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setActive(false);
    }, 1000);
  });

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  if (status !== "ready") return null;

  const deviceName = selectedId
    ? (inputs.find((i) => i.id === selectedId)?.name ?? null)
    : null;

  const tipLabel = deviceName
    ? `MIDI: ${deviceName} — last incoming note or CC`
    : "MIDI activity — no device selected";

  return (
    <Tip label={tipLabel}>
      <div className="flex items-center gap-1.5 px-1.5 h-7 rounded-md border border-border bg-background/50 select-none max-w-[160px]">
        <span
          className={`inline-block shrink-0 w-2 h-2 rounded-full transition-colors duration-75 ${
            active
              ? "bg-primary shadow-[0_0_6px_2px_hsl(var(--primary)/0.7)]"
              : "bg-muted-foreground/30"
          }`}
          aria-hidden
        />
        <span className="font-mono text-[10px] w-7 shrink-0 tabular-nums text-primary leading-none">
          {active ? label : "MIDI"}
        </span>
        {deviceName && (
          <span className="font-mono text-[10px] text-muted-foreground leading-none min-w-0 flex-1 truncate">
            {deviceName}
          </span>
        )}
      </div>
    </Tip>
  );
}

/**
 * Project-wide latching CLIP LED in the transport bar.
 *
 * Polls every track's Tone.Meter through the shared visualTicker. As soon as any track peaks
 * at or above 0 dBFS the LED latches red and records a ClipHistoryEntry.
 * Clicking the LED toggles the clip history popover. The history log
 * persists for the session and can be cleared manually.
 */
function ProjectClipBadge() {
  const [clippedIds, setClippedIds] = useState<Set<string>>(new Set());
  const clippedIdsRef = useRef<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const lastWarnRef = useRef(0);
  // Per-track throttle: don't log the same track more than once per 2 s.
  const lastClipLogRef = useRef<Map<string, number>>(new Map());
  const clipHistory = useStore((s) => s.clipHistory);

  useEffect(() => {
    return visualTicker.subscribe(() => {
      const { isPlaying, project } = getStore().state;
      if (!isPlaying && !historyOpen) return;
      const newClips: Array<{ id: string; name: string }> = [];
      for (const t of project.tracks) {
        const meter = audio.getTrackMeter(t.id);
        if (!meter) continue;
        const v = meter.getValue();
        const dbL = typeof v === "number" ? v : (v[0] ?? -Infinity);
        const dbR = typeof v === "number" ? v : (v[1] ?? dbL);
        if (dbL >= 0 || dbR >= 0) newClips.push({ id: t.id, name: t.name });
      }
      if (newClips.length > 0) {
        const now = performance.now();
        const next = new Set(clippedIdsRef.current);
        let changed = false;
        for (const { id, name } of newClips) {
          if (!next.has(id)) { next.add(id); changed = true; }
          // Throttle per-track history entries to once per 2 s.
          const lastLogged = lastClipLogRef.current.get(id) ?? 0;
          if (now - lastLogged > 2000) {
            lastClipLogRef.current.set(id, now);
            getStore().addClipEvent(id, name);
          }
        }
        if (changed) {
          clippedIdsRef.current = next;
          if (now - lastWarnRef.current > 5000) {
            lastWarnRef.current = now;
            getStore().setStatus(
              `Track clipping detected — check channel strips.`,
              "warn",
            );
          }
          setClippedIds(next);
        }
      }
    });
  }, [historyOpen]);

  const anyClipped = clippedIds.size > 0;
  const hasHistory = clipHistory.length > 0;

  const handleLedClick = () => {
    if (anyClipped) {
      // Highlight clipped channel strips.
      const ids = Array.from(clippedIds);
      for (const id of ids) {
        const el = document.querySelector(`[data-testid="channel-strip-${id}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
          el.classList.add("ring-2", "ring-red-500", "ring-offset-1");
          setTimeout(() => el.classList.remove("ring-2", "ring-red-500", "ring-offset-1"), 2000);
        }
      }
      getStore().resetAllTrackClips();
      clippedIdsRef.current = new Set();
      setClippedIds(clippedIdsRef.current);
    }
    setHistoryOpen((o) => !o);
  };

  if (!anyClipped && !hasHistory) return null;

  return (
    <div className="relative">
      <Tip label={anyClipped ? `${clippedIds.size} track(s) clipped — click to locate & open log` : "Clip history — click to view"}>
        <button
          type="button"
          onClick={handleLedClick}
          className={`flex items-center gap-1 px-2 h-7 rounded-md border font-mono text-[10px] uppercase tracking-widest studio-clip-led ${
            anyClipped
              ? "border-red-500/60 bg-red-500/15 text-red-300 animate-pulse"
              : "border-orange-500/40 bg-orange-500/10 text-orange-300"
          }`}
          aria-label="Clip history, click to open"
          aria-expanded={historyOpen}
        >
          {anyClipped ? <RadioTower className="w-3 h-3" /> : <History className="w-3 h-3" />}
          {anyClipped ? `Clip (${clippedIds.size})` : "Clip Log"}
          {hasHistory && !anyClipped && (
            <span className="ml-0.5 text-[9px] opacity-70">{clipHistory.length}</span>
          )}
        </button>
      </Tip>

      {historyOpen && (
        <ClipHistoryPanel onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  );
}

/**
 * Popover panel that shows the session clip history log.
 * Appears above the transport bar, anchored to the CLIP LED.
 */
function ClipHistoryPanel({ onClose }: { onClose: () => void }) {
  const clipHistory = useStore((s) => s.clipHistory);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const scrollToTrack = (trackId: string) => {
    const el = document.querySelector(`[data-testid="channel-strip-${trackId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      el.classList.add("ring-2", "ring-red-500", "ring-offset-1");
      setTimeout(() => el.classList.remove("ring-2", "ring-red-500", "ring-offset-1"), 2000);
    }
    onClose();
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  // Show most-recent entries first.
  const sorted = [...clipHistory].reverse();

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full right-0 mb-2 w-72 rounded-lg border border-red-500/30 bg-graphite shadow-2xl z-50 overflow-hidden"
      role="dialog"
      aria-label="Clip history log"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background/50">
        <div className="flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-red-400" />
          <span className="font-mono text-[11px] uppercase tracking-widest text-foreground">
            Clip History
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            ({clipHistory.length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Tip label="Clear clip history">
            <button
              type="button"
              onClick={() => getStore().clearClipHistory()}
              className="flex items-center gap-1 h-6 px-1.5 rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-500/40 font-mono text-[10px] transition-colors"
              aria-label="Clear clip history"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          </Tip>
          <button
            type="button"
            onClick={onClose}
            className="h-6 w-6 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground text-xs transition-colors"
            aria-label="Close clip history"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div className="max-h-64 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="px-3 py-4 text-center font-mono text-[11px] text-muted-foreground">
            No clip events this session.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((entry: ClipHistoryEntry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-red-500/5 group"
              >
                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-red-500/60" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[11px] text-foreground truncate">
                    {entry.trackName}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {formatTime(entry.timestamp)}
                  </div>
                </div>
                <Tip label={`Go to ${entry.trackName} channel strip`}>
                  <button
                    type="button"
                    onClick={() => scrollToTrack(entry.trackId)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-500/40 transition-all"
                    aria-label={`Scroll to ${entry.trackName}`}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </Tip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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

/**
 * Performance Mode button in the transport bar.
 * Opens the performance overlay panel. Shows a gamepad icon;
 * glows when performance mode is active or a gamepad is connected.
 */
function PerformanceButton() {
  const perfOpen = useStore((s) => s.project.performance?.open ?? false);
  const gamepad = useGamepad();

  const toggle = () => {
    const cur = getStore().state.project.performance;
    const next = { ...(cur ?? {}), open: !perfOpen };
    getStore().patchProject({ performance: next as import("../types").PerformanceSettings });
  };

  return (
    <Tip label="Performance Mode — controllers, scale lock, chord mode">
      <button
        type="button"
        onClick={toggle}
        className={`flex items-center gap-1 h-8 px-2 rounded-md border font-mono text-[10px] transition-colors ${
          perfOpen
            ? "border-primary bg-primary/20 text-primary glow-red"
            : gamepad.connected
              ? "border-neon/50 text-neon hover:bg-neon/10"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
        }`}
        aria-label="Toggle Performance Mode"
        aria-pressed={perfOpen}
      >
        <Gamepad2 className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Perform</span>
        {gamepad.connected && !perfOpen && (
          <span className="w-1.5 h-1.5 rounded-full bg-neon ml-0.5" />
        )}
      </button>
    </Tip>
  );
}
