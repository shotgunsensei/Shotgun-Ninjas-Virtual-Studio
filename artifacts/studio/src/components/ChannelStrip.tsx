import { memo, useCallback } from "react";
import * as Icons from "lucide-react";
import { Volume2, Trash2, Copy, Mic, Sliders } from "lucide-react";
import { StereoMeter } from "./Meter";
import { MasterStrip } from "./MasterStrip";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore, getStore } from "../store";
import { audio } from "../lib/audio/engine";
import type { AnyPreset, InstrumentKind, MidiTarget, SendBusId, Track, TrackEq } from "../types";
import { SEND_BUS_IDS, SEND_BUS_LABELS } from "../types";
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

const DEFAULT_EQ: TrackEq = { low: 0, mid: 0, high: 0, hpfOn: false, hpfHz: 80 };

function kindLabel(k: InstrumentKind) {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

function fxRackEnabledCount(track: Track): number {
  const r = track.fxRack;
  if (!r) return 0;
  let n = 0;
  for (const k of Object.keys(r)) {
    if (r[k as keyof typeof r]?.enabled) n++;
  }
  return n;
}

export function ChannelStripsBar() {
  const tracks = useStore((s) => s.project.tracks);
  const selectedTrackId = useStore((s) => s.selectedTrackId);

  return (
    <div className="border-t border-border bg-graphite">
      <div className="flex overflow-x-auto">
        {tracks.map((t) => (
          <ChannelStrip
            key={t.id}
            track={t}
            selected={selectedTrackId === t.id}
          />
        ))}
        <MasterStrip />
      </div>
    </div>
  );
}

// Memoized — when the user nudges one slider, the patched Track object
// gets a new identity but the other tracks in `project.tracks` keep
// theirs. memo() then skips re-render for every strip that didn't
// change, saving a lot of DOM work in projects with many tracks.
const ChannelStrip = memo(function ChannelStrip({
  track,
  selected,
}: {
  track: Track;
  selected: boolean;
}) {
  const armOther = (armed: boolean) => {
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

  const color = track.meta?.color ?? "#7dd3fc";
  const iconName = track.meta?.icon ?? "Music";
  const Icon =
    (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[iconName] ??
    Icons.Music;
  const sourceLabel = track.meta?.sourceLabel ?? "MIDI";
  const eq = track.eq ?? DEFAULT_EQ;
  const fxCount = fxRackEnabledCount(track);

  return (
    <div
      onClick={() => getStore().set({ selectedTrackId: track.id })}
      data-testid={`channel-strip-${track.id}`}
      className={`flex-none w-48 border-r border-border p-2 flex flex-col gap-1.5 cursor-pointer ${
        selected ? "bg-primary/5" : ""
      }`}
      style={{ borderTop: `2px solid ${color}` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`led inline-block w-2 h-2 rounded-full flex-none ${
              track.armed ? "text-primary bg-primary" : "bg-muted-foreground/20"
            }`}
          />
          <span className="flex-none" style={{ color }}>
            <Icon className="w-3 h-3" />
          </span>
          <span className="font-mono text-xs uppercase tracking-wider truncate">
            {track.name}
          </span>
        </div>
        <span className="text-[8px] uppercase tracking-widest text-muted-foreground flex-none">
          {sourceLabel}
        </span>
      </div>

      <div className="flex items-center justify-between text-[8px] text-muted-foreground uppercase">
        <span>{kindLabel(track.kind)}</span>
      </div>

      <Select
        value={track.preset}
        onValueChange={(v) => {
          getStore().patchTrack(track.id, { preset: v as AnyPreset });
          requestAnimationFrame(() => {
            const t = getStore().state.project.tracks.find((x) => x.id === track.id);
            if (t) {
              audio.ensureTrack(t);
              audio.changePreset(t);
            }
          });
        }}
      >
        <SelectTrigger className="h-6 text-[10px] bg-background">
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
        <MidiLearnButton target={{ kind: "track-pan", trackId: track.id }} small />
      </div>

      <div className="grid grid-cols-3 gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            getStore().patchTrack(track.id, { muted: !track.muted, solo: track.muted ? track.solo : false });
          }}
          className={`text-[10px] font-mono py-0.5 rounded border ${
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
          className={`text-[10px] font-mono py-0.5 rounded border ${
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
          className={`text-[10px] font-mono py-0.5 rounded border flex items-center justify-center gap-0.5 ${
            track.armed
              ? "bg-primary/30 border-primary/60 text-primary glow-red"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {track.kind === "vocals" ? <Mic className="w-3 h-3" /> : "R"}
        </button>
      </div>

      {/* 3-band EQ */}
      <div className="grid grid-cols-3 gap-1">
        <EqKnob
          label="LO"
          value={eq.low}
          onChange={(v) => getStore().setTrackEq(track.id, { low: v })}
          learnTarget={{ kind: "track-eq", trackId: track.id, band: "low" }}
        />
        <EqKnob
          label="MID"
          value={eq.mid}
          onChange={(v) => getStore().setTrackEq(track.id, { mid: v })}
          learnTarget={{ kind: "track-eq", trackId: track.id, band: "mid" }}
        />
        <EqKnob
          label="HI"
          value={eq.high}
          onChange={(v) => getStore().setTrackEq(track.id, { high: v })}
          learnTarget={{ kind: "track-eq", trackId: track.id, band: "high" }}
        />
      </div>

      {/* HPF */}
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            getStore().setTrackEq(track.id, { hpfOn: !eq.hpfOn });
          }}
          className={`text-[9px] font-mono px-1 py-0.5 rounded border ${
            eq.hpfOn
              ? "bg-primary/20 border-primary/60 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
          data-testid={`hpf-toggle-${track.id}`}
        >
          HPF
        </button>
        <Slider
          value={[eq.hpfHz]}
          min={20}
          max={400}
          step={1}
          onValueChange={([v]) => getStore().setTrackEq(track.id, { hpfHz: v ?? 80 })}
        />
        <span className="text-[8px] font-mono text-muted-foreground w-7 text-right">{Math.round(eq.hpfHz)}</span>
        <MidiLearnButton target={{ kind: "track-eq", trackId: track.id, band: "hpf" }} small />
      </div>

      {/* 4 sends */}
      <div className="space-y-0.5">
        {SEND_BUS_IDS.map((id) => (
          <SendRow key={id} trackId={track.id} busId={id} amount={track.sends?.[id] ?? 0} />
        ))}
      </div>

      {/* FX toggle (rack inspector lives in side panel) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          getStore().set({ selectedTrackId: track.id });
        }}
        data-testid={`fx-open-${track.id}`}
        className={`flex items-center justify-center gap-1 text-[10px] font-mono py-1 rounded border ${
          fxCount > 0
            ? "bg-primary/15 border-primary/40 text-primary"
            : "border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        <Sliders className="w-3 h-3" />
        FX {fxCount > 0 ? `(${fxCount})` : ""}
      </button>

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
});

function TrackMeter({ trackId }: { trackId: string }) {
  const getMeter = useCallback(() => audio.getTrackMeter(trackId), [trackId]);
  return <StereoMeter getMeter={getMeter} label="LVL" showClip />;
}

function EqKnob({
  label,
  value,
  onChange,
  learnTarget,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  learnTarget?: MidiTarget;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-0.5 w-full">
        <input
          type="range"
          min={-12}
          max={12}
          step={0.5}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full accent-primary h-1"
          onClick={(e) => e.stopPropagation()}
        />
        {learnTarget && <MidiLearnButton target={learnTarget} small />}
      </div>
      <span className="text-[8px] text-muted-foreground font-mono">
        {label}{value !== 0 ? ` ${value > 0 ? "+" : ""}${value.toFixed(0)}` : ""}
      </span>
    </div>
  );
}

function SendRow({
  trackId,
  busId,
  amount,
}: {
  trackId: string;
  busId: SendBusId;
  amount: number;
}) {
  const short = SEND_BUS_LABELS[busId].split(" ")[0].slice(0, 3).toUpperCase();
  return (
    <div className="flex items-center gap-1" title={`Send: ${SEND_BUS_LABELS[busId]}`}>
      <span className="text-[8px] font-mono text-muted-foreground w-7">{short}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={amount}
        onChange={(e) => getStore().setTrackSend(trackId, busId, parseFloat(e.target.value))}
        onClick={(e) => e.stopPropagation()}
        className="w-full accent-primary h-1"
        data-testid={`send-${busId}-${trackId}`}
      />
      <MidiLearnButton target={{ kind: "track-send", trackId, busId }} small />
    </div>
  );
}
