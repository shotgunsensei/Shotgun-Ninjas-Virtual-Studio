import { useEffect, useRef, useState } from "react";
import { Volume2, Trash2, Copy, Mic } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore, getStore } from "../store";
import { audio } from "../lib/audio/engine";
import type { AnyPreset, InstrumentKind, Track } from "../types";
import { MidiLearnButton } from "./MidiLearnButton";

const PRESETS: Record<InstrumentKind, { value: AnyPreset; label: string }[]> = {
  piano: [
    { value: "grand", label: "Grand" },
    { value: "electric", label: "Electric" },
    { value: "synth", label: "Synth" },
  ],
  guitar: [
    { value: "clean", label: "Clean" },
    { value: "crunch", label: "Crunch" },
    { value: "acoustic", label: "Acoustic" },
  ],
  drums: [
    { value: "acoustic", label: "Acoustic" },
    { value: "electronic", label: "Electronic" },
    { value: "trap", label: "Trap" },
  ],
  bass: [
    { value: "finger", label: "Finger" },
    { value: "synth", label: "Synth" },
    { value: "sub", label: "Sub" },
  ],
  vocals: [
    { value: "clean", label: "Clean" },
    { value: "warm", label: "Warm" },
    { value: "lofi", label: "Lo-Fi" },
  ],
};

function kindLabel(k: InstrumentKind) {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

export function ChannelStripsBar() {
  const project = useStore((s) => s.project);
  const selectedTrackId = useStore((s) => s.selectedTrackId);

  return (
    <div className="border-t border-border bg-graphite">
      <div className="flex overflow-x-auto">
        {project.tracks.map((t) => (
          <ChannelStrip
            key={t.id}
            track={t}
            selected={selectedTrackId === t.id}
          />
        ))}
      </div>
    </div>
  );
}

function ChannelStrip({ track, selected }: { track: Track; selected: boolean }) {
  const armOther = (armed: boolean) => {
    // at most one armed track; arming also auto-selects so MIDI/keyboard
    // performance input routes to the armed instrument
    if (armed) {
      const tracks = getStore().state.project.tracks.map((x) => ({
        ...x,
        armed: x.id === track.id,
      }));
      getStore().patchProject({ tracks });
      getStore().set({ selectedTrackId: track.id });
    } else {
      getStore().patchTrack(track.id, { armed: false });
    }
  };

  return (
    <div
      onClick={() => getStore().set({ selectedTrackId: track.id })}
      className={`flex-none w-44 border-r border-border p-3 flex flex-col gap-2 cursor-pointer ${
        selected ? "bg-primary/5" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className={`led inline-block w-2.5 h-2.5 rounded-full ${
              track.armed ? "text-primary bg-primary" : "text-muted-foreground/30 bg-muted-foreground/20"
            }`}
          />
          <span className="font-mono text-xs uppercase tracking-wider">
            {track.name}
          </span>
        </div>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
          {kindLabel(track.kind)}
        </span>
      </div>

      <Select
        value={track.preset}
        onValueChange={(v) => {
          getStore().patchTrack(track.id, { preset: v as AnyPreset });
          // schedule preset rebuild on engine
          requestAnimationFrame(() => {
            const t = getStore().state.project.tracks.find((x) => x.id === track.id);
            if (t) {
              audio.ensureTrack(t);
              audio.changePreset(t);
            }
          });
        }}
      >
        <SelectTrigger className="h-7 text-xs bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS[track.kind].map((p) => (
            <SelectItem key={p.value} value={p.value} className="text-xs">
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Volume2 className="w-3 h-3 text-muted-foreground" />
        <Slider
          value={[track.volume * 100]}
          max={100}
          step={1}
          onValueChange={([v]) => getStore().patchTrack(track.id, { volume: (v ?? 0) / 100 })}
        />
        <MidiLearnButton target={{ kind: "track-volume", trackId: track.id }} small />
      </div>

      <TrackMeter trackId={track.id} />

      <div className="flex items-center gap-1">
        <span className="text-[9px] text-muted-foreground w-6">PAN</span>
        <Slider
          value={[(track.pan + 1) * 50]}
          max={100}
          step={1}
          onValueChange={([v]) => getStore().patchTrack(track.id, { pan: ((v ?? 50) / 50) - 1 })}
        />
      </div>

      <div className="grid grid-cols-3 gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            getStore().patchTrack(track.id, { muted: !track.muted, solo: track.muted ? track.solo : false });
          }}
          className={`text-[10px] font-mono py-1 rounded border ${
            track.muted
              ? "bg-muted-foreground/30 border-muted-foreground/40 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          M
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            getStore().patchTrack(track.id, { solo: !track.solo });
          }}
          className={`text-[10px] font-mono py-1 rounded border ${
            track.solo
              ? "bg-yellow-500/30 border-yellow-500/60 text-yellow-300"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          S
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            armOther(!track.armed);
          }}
          className={`text-[10px] font-mono py-1 rounded border flex items-center justify-center gap-0.5 ${
            track.armed
              ? "bg-primary/30 border-primary/60 text-primary glow-red"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {track.kind === "vocals" ? <Mic className="w-3 h-3" /> : "R"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1 text-[9px] text-muted-foreground font-mono">
        <FxKnob
          label="REV"
          value={track.fx.reverb}
          onChange={(v) =>
            getStore().patchTrack(track.id, { fx: { ...track.fx, reverb: v } })
          }
        />
        <FxKnob
          label="DLY"
          value={track.fx.delay}
          onChange={(v) =>
            getStore().patchTrack(track.id, { fx: { ...track.fx, delay: v } })
          }
        />
        <FxKnob
          label="FLT"
          value={track.fx.filter}
          onChange={(v) =>
            getStore().patchTrack(track.id, { fx: { ...track.fx, filter: v } })
          }
        />
      </div>

      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] flex-1"
          onClick={(e) => {
            e.stopPropagation();
            getStore().duplicateClip(track.id);
          }}
        >
          <Copy className="w-3 h-3 mr-1" />
          Dup
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] flex-1"
          onClick={(e) => {
            e.stopPropagation();
            getStore().clearTrackClips(track.id);
          }}
        >
          <Trash2 className="w-3 h-3 mr-1" />
          Clr
        </Button>
      </div>
    </div>
  );
}

function TrackMeter({ trackId }: { trackId: string }) {
  // Two-channel post-fader level display (peak in dBFS), updated via rAF.
  // Color zones: green up to -12 dB, yellow -12..-3 dB, red above -3 dB.
  const [levels, setLevels] = useState<[number, number]>([0, 0]);
  const [peaksDb, setPeaksDb] = useState<[number, number]>([-Infinity, -Infinity]);
  const [clipped, setClipped] = useState<[boolean, boolean]>([false, false]);
  const peakHoldRef = useRef<{ db: [number, number]; until: [number, number] }>({
    db: [-Infinity, -Infinity],
    until: [0, 0],
  });

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const meter = audio.getTrackMeter(trackId);
      if (meter) {
        const v = meter.getValue();
        const dbL = typeof v === "number" ? v : v[0] ?? -Infinity;
        const dbR = typeof v === "number" ? v : v[1] ?? dbL;
        const normL = Math.max(0, Math.min(1, (dbL + 60) / 60));
        const normR = Math.max(0, Math.min(1, (dbR + 60) / 60));
        setLevels([normL, normR]);

        // peak-hold for ~800ms
        const now = performance.now();
        const hold = peakHoldRef.current;
        if (dbL >= hold.db[0] || now > hold.until[0]) {
          hold.db[0] = dbL;
          hold.until[0] = now + 800;
        }
        if (dbR >= hold.db[1] || now > hold.until[1]) {
          hold.db[1] = dbR;
          hold.until[1] = now + 800;
        }
        setPeaksDb([hold.db[0], hold.db[1]]);

        // latching clip detection at 0 dBFS
        if (dbL >= 0 || dbR >= 0) {
          setClipped((prev) => {
            const nextL = prev[0] || dbL >= 0;
            const nextR = prev[1] || dbR >= 0;
            if (nextL === prev[0] && nextR === prev[1]) return prev;
            return [nextL, nextR];
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trackId]);

  const peakDb = Math.max(peaksDb[0], peaksDb[1]);
  const clipping = peakDb >= -0.5;
  const anyClipped = clipped[0] || clipped[1];

  const resetClip = (e: React.MouseEvent) => {
    e.stopPropagation();
    setClipped([false, false]);
  };

  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-muted-foreground w-6 font-mono">LVL</span>
      <div className="flex-1 flex flex-col gap-[2px]">
        <MeterBar value={levels[0]} />
        <MeterBar value={levels[1]} />
      </div>
      <button
        type="button"
        onClick={resetClip}
        title={anyClipped ? "Clipping detected — click to reset" : "Clip indicator"}
        aria-label={anyClipped ? "Clip indicator active, click to reset" : "Clip indicator"}
        aria-pressed={anyClipped}
        className="flex flex-col gap-[2px] justify-center"
      >
        <span
          className={`block w-2 h-[5px] rounded-[1px] border ${
            clipped[0]
              ? "bg-red-500 border-red-300 shadow-[0_0_6px_2px_rgba(239,68,68,0.85)]"
              : "bg-red-500/10 border-red-500/30"
          }`}
        />
        <span
          className={`block w-2 h-[5px] rounded-[1px] border ${
            clipped[1]
              ? "bg-red-500 border-red-300 shadow-[0_0_6px_2px_rgba(239,68,68,0.85)]"
              : "bg-red-500/10 border-red-500/30"
          }`}
        />
      </button>
      <span
        className={`text-[9px] font-mono w-7 text-right tabular-nums ${
          anyClipped ? "text-red-400" : clipping ? "text-red-400" : "text-muted-foreground"
        }`}
      >
        {Number.isFinite(peakDb) ? peakDb.toFixed(0) : "-∞"}
      </span>
    </div>
  );
}

function MeterBar({ value }: { value: number }) {
  // value: 0..1 normalized (-60..0 dB)
  // Thresholds in normalized units: -12 dB = 48/60 = 0.8, -3 dB = 57/60 = 0.95
  const greenW = Math.min(value, 0.8) * 100;
  const yellowW = Math.max(0, Math.min(value, 0.95) - 0.8) * 100;
  const redW = Math.max(0, value - 0.95) * 100;
  return (
    <div className="relative h-[5px] w-full bg-background/80 rounded-sm overflow-hidden border border-border">
      <div
        className="absolute inset-y-0 left-0 bg-emerald-500"
        style={{ width: `${greenW}%` }}
      />
      <div
        className="absolute inset-y-0 bg-yellow-400"
        style={{ left: `${0.8 * 100}%`, width: `${yellowW}%` }}
      />
      <div
        className="absolute inset-y-0 bg-red-500"
        style={{ left: `${0.95 * 100}%`, width: `${redW}%` }}
      />
    </div>
  );
}

function FxKnob({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary h-1"
        onClick={(e) => e.stopPropagation()}
      />
      <span>{label}</span>
    </div>
  );
}
