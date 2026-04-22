import { useCallback } from "react";
import { Volume2, Trash2, Copy, Mic } from "lucide-react";
import { StereoMeter } from "./Meter";
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
  const getMeter = useCallback(() => audio.getTrackMeter(trackId), [trackId]);
  return <StereoMeter getMeter={getMeter} label="LVL" showClip />;
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
