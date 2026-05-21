/**
 * AudioDiagnosticsPanel — Phase 6 Pro Audio Engine
 *
 * Collapsible real-time panel accessible from the transport bar. Polls
 * the audio engine and browser APIs at 4 Hz and displays:
 *   - AudioContext state, sample rate, base/output latency
 *   - Current BPM, scheduled event count, active voice count
 *   - Peak output level in dBFS (from the existing master Meter)
 *   - Dropped visual frames (rAF delta > 33 ms)
 *   - Live CPU pressure via AudioWorklet round-trip timing (green→yellow→red)
 *   - Browser capability flags (AudioWorklet, MIDI, SharedArrayBuffer,
 *     OfflineAudioContext)
 */

import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { Activity, X, AlertTriangle } from "lucide-react";
import { audio } from "../lib/audio/engine";
import { lookaheadScheduler } from "../lib/audio/lookahead-scheduler";
import { workletManager } from "../lib/audio/worklet-manager";
import { useStore } from "../store";

// CPU pressure thresholds (ms round-trip from main → audio worklet → main).
// A single 128-sample buffer at 44.1 kHz is ~2.9 ms.
// Round-trips well above that indicate the audio thread is struggling.
const CPU_YELLOW_MS = 8;   // > 8 ms → moderate load
const CPU_RED_MS    = 20;  // > 20 ms → heavy load / risk of glitches

interface DiagSnap {
  contextState: string;
  sampleRate: number | null;
  baseLatencyMs: number | null;
  outputLatencyMs: number | null;
  bpm: number;
  scheduledEvents: number;
  activeVoices: number;
  peakDbL: number;
  peakDbR: number;
  droppedFrames: number;
  cpuRoundTripMs: number | null;
  // capability flags
  capWorklet: boolean;
  capMidi: boolean;
  capSab: boolean;
  capOffline: boolean;
  // worklet state
  workletReady: boolean;
  workletFallback: boolean;
  // oversampling
  oversampleOn: boolean;
}

function getCapabilities() {
  if (typeof window === "undefined") {
    return { capWorklet: false, capMidi: false, capSab: false, capOffline: false };
  }
  return {
    capWorklet: typeof AudioWorkletNode !== "undefined",
    capMidi: "requestMIDIAccess" in navigator,
    capSab: typeof SharedArrayBuffer !== "undefined",
    capOffline: typeof OfflineAudioContext !== "undefined",
  };
}

const CAPS = getCapabilities();

function cpuPressureLevel(ms: number | null): "unknown" | "low" | "medium" | "high" {
  if (ms === null) return "unknown";
  if (ms >= CPU_RED_MS) return "high";
  if (ms >= CPU_YELLOW_MS) return "medium";
  return "low";
}

function Flag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${
        ok
          ? "border-primary/50 text-primary"
          : "border-muted text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5 border-b border-border/30">
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className={`font-mono text-[10px] tabular-nums ${warn ? "text-yellow-400" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

function PeakBar({ dbL, dbR }: { dbL: number; dbR: number }) {
  const toPercent = (db: number) => {
    if (!isFinite(db) || db < -60) return 0;
    return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  };
  const color = (db: number) =>
    db > -3 ? "bg-red-500" : db > -12 ? "bg-yellow-400" : "bg-primary";

  return (
    <div className="flex flex-col gap-0.5 mt-1">
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-muted-foreground w-3">L</span>
        <div className="flex-1 h-1.5 bg-background/60 rounded-full overflow-hidden border border-border/30">
          <div
            className={`h-full rounded-full transition-all duration-75 ${color(dbL)}`}
            style={{ width: `${toPercent(dbL)}%` }}
          />
        </div>
        <span className="font-mono text-[9px] w-10 text-right tabular-nums text-foreground">
          {isFinite(dbL) ? `${dbL.toFixed(1)}` : "-∞"}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-muted-foreground w-3">R</span>
        <div className="flex-1 h-1.5 bg-background/60 rounded-full overflow-hidden border border-border/30">
          <div
            className={`h-full rounded-full transition-all duration-75 ${color(dbR)}`}
            style={{ width: `${toPercent(dbR)}%` }}
          />
        </div>
        <span className="font-mono text-[9px] w-10 text-right tabular-nums text-foreground">
          {isFinite(dbR) ? `${dbR.toFixed(1)}` : "-∞"}
        </span>
      </div>
    </div>
  );
}

function CpuPressureBar({ roundTripMs }: { roundTripMs: number | null }) {
  const level = cpuPressureLevel(roundTripMs);

  // Map round-trip to a 0-100 fill (cap display at 40 ms)
  const fillPct =
    roundTripMs === null
      ? 0
      : Math.min(100, (roundTripMs / 40) * 100);

  const barColor =
    level === "high"    ? "bg-red-500" :
    level === "medium"  ? "bg-yellow-400" :
    level === "low"     ? "bg-primary" :
    "bg-muted";

  const labelColor =
    level === "high"   ? "text-red-400" :
    level === "medium" ? "text-yellow-400" :
    level === "low"    ? "text-primary" :
    "text-muted-foreground";

  const levelLabel =
    level === "high"    ? "HIGH" :
    level === "medium"  ? "MED" :
    level === "low"     ? "LOW" :
    "—";

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1 mb-0.5">
        <div className="flex-1 h-2 bg-background/60 rounded-full overflow-hidden border border-border/30">
          <div
            className={`h-full rounded-full transition-all duration-200 ${barColor}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
        <span className={`font-mono text-[9px] w-8 text-right tabular-nums font-bold ${labelColor}`}>
          {levelLabel}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-muted-foreground uppercase tracking-widest">
          Round-trip
        </span>
        <span className="font-mono text-[9px] tabular-nums text-foreground">
          {roundTripMs !== null ? `${roundTripMs.toFixed(1)} ms` : "—"}
        </span>
      </div>
    </div>
  );
}

export function AudioDiagnosticsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [snap, setSnap] = useState<DiagSnap | null>(null);
  const droppedFramesRef = useRef(0);
  const lastRafTsRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const oversampleOn = useStore((s) => !!(s.project.masterBus?.oversample));

  // rAF dropped-frame monitor — runs independently
  useEffect(() => {
    let running = true;
    const tick = (ts: number) => {
      if (!running) return;
      const last = lastRafTsRef.current;
      if (last !== null && ts - last > 33) droppedFramesRef.current++;
      lastRafTsRef.current = ts;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // 4 Hz polling loop
  useEffect(() => {
    if (!open) return;

    const poll = () => {
      try {
        const rawCtx = Tone.getContext().rawContext as AudioContext | undefined;
        const ctxAny = rawCtx as (AudioContext & { baseLatency?: number; outputLatency?: number }) | undefined;

        // Kick off the CPU probe if the worklet is ready and probe not yet started.
        if (rawCtx && workletManager.ready) {
          workletManager.startCpuProbe(rawCtx as AudioContext);
          workletManager.pingCpu();
        }

        const levels = audio.getMasterLevels();
        const peakDbL = levels.peakDb[0] ?? -Infinity;
        const peakDbR = levels.peakDb[1] ?? peakDbL;

        setSnap({
          contextState: rawCtx?.state ?? "suspended",
          sampleRate: rawCtx?.sampleRate ?? null,
          baseLatencyMs:
            typeof ctxAny?.baseLatency === "number"
              ? Math.round(ctxAny.baseLatency * 1000)
              : null,
          outputLatencyMs:
            typeof ctxAny?.outputLatency === "number"
              ? Math.round(ctxAny.outputLatency * 1000)
              : null,
          bpm: audio.getBpm(),
          scheduledEvents: lookaheadScheduler.scheduledEventCount,
          activeVoices: audio.getActiveVoiceCount(),
          peakDbL,
          peakDbR,
          droppedFrames: droppedFramesRef.current,
          cpuRoundTripMs: workletManager.lastRoundTripMs,
          ...CAPS,
          workletReady: workletManager.ready,
          workletFallback: workletManager.fallback,
          oversampleOn,
        });
      } catch {
        // ignore if audio context not yet initialized
      }
    };

    poll();
    const id = setInterval(poll, 250);
    return () => clearInterval(id);
  }, [open, oversampleOn]);

  if (!open) return null;

  const highVoices = (snap?.activeVoices ?? 0) > 6;
  const cpuLevel = cpuPressureLevel(snap?.cpuRoundTripMs ?? null);
  const showCpuWarn = cpuLevel === "high" || cpuLevel === "medium";

  return (
    <div className="absolute top-full left-0 right-0 z-50 bg-graphite/95 border-b border-border backdrop-blur-sm shadow-xl">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-primary" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
              Audio Diagnostics
            </span>
            {showCpuWarn && (
              <span
                className={`flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded border ${
                  cpuLevel === "high"
                    ? "text-red-400 bg-red-500/10 border-red-500/30"
                    : "text-yellow-400 bg-yellow-400/10 border-yellow-400/30"
                }`}
              >
                <AlertTriangle className="w-3 h-3" />
                {cpuLevel === "high" ? "CPU overload — reduce voices or disable effects" : "CPU pressure — approaching limit"}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close diagnostics"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {snap ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-0">
            {/* Column 1: AudioContext */}
            <div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
                Context
              </div>
              <Row label="State" value={snap.contextState} />
              <Row
                label="Sample rate"
                value={snap.sampleRate ? `${snap.sampleRate} Hz` : "—"}
              />
              <Row
                label="Base latency"
                value={snap.baseLatencyMs != null ? `${snap.baseLatencyMs} ms` : "—"}
              />
              <Row
                label="Output latency"
                value={snap.outputLatencyMs != null ? `${snap.outputLatencyMs} ms` : "—"}
              />
            </div>

            {/* Column 2: Transport */}
            <div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
                Transport
              </div>
              <Row label="BPM" value={snap.bpm.toFixed(1)} />
              <Row label="Sched. events" value={String(snap.scheduledEvents)} />
              <Row
                label="Active voices"
                value={String(snap.activeVoices)}
                warn={highVoices}
              />
              <Row
                label="Dropped frames"
                value={String(snap.droppedFrames)}
                warn={snap.droppedFrames > 5}
              />
            </div>

            {/* Column 3: Levels */}
            <div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
                Peak Output (dBFS)
              </div>
              <PeakBar dbL={snap.peakDbL} dbR={snap.peakDbR} />
              <div className="mt-2">
                <Row
                  label="Worklet engine"
                  value={snap.workletReady ? "active" : snap.workletFallback ? "fallback" : "pending"}
                />
                <Row
                  label="Oversampling"
                  value={snap.oversampleOn ? "2× ON" : "off"}
                />
              </div>
            </div>

            {/* Column 4: CPU Pressure + Browser Support */}
            <div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
                CPU Pressure
              </div>
              {snap.workletReady ? (
                <CpuPressureBar roundTripMs={snap.cpuRoundTripMs} />
              ) : (
                <div className="text-[9px] text-muted-foreground font-mono mt-1">
                  {snap.workletFallback ? "Worklet unavailable" : "Awaiting worklet…"}
                </div>
              )}
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1 mt-3">
                Browser Support
              </div>
              <div className="flex flex-wrap gap-1">
                <Flag label="AudioWorklet" ok={snap.capWorklet} />
                <Flag label="Web MIDI" ok={snap.capMidi} />
                <Flag label="SharedArrayBuffer" ok={snap.capSab} />
                <Flag label="OfflineAudioContext" ok={snap.capOffline} />
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground font-mono">
            Initializing…
          </div>
        )}
      </div>
    </div>
  );
}
