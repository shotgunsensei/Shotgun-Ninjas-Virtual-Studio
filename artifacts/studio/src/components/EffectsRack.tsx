import { Power, RotateCcw } from "lucide-react";
import { getStore, useStore } from "../store";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FxModuleId, FxModuleSettings, Track } from "../types";
import { MidiLearnButton } from "./MidiLearnButton";

interface ModuleDef {
  id: FxModuleId;
  label: string;
  amountLabel: string;
  presets: { id: string; label: string; amount: number; params?: Record<string, number> }[];
}

const MODULES: ModuleDef[] = [
  {
    id: "eq",
    label: "EQ / Filter",
    amountLabel: "Tilt",
    presets: [
      { id: "flat", label: "Flat", amount: 0.5 },
      { id: "bright", label: "Bright", amount: 0.7 },
      { id: "warm", label: "Warm", amount: 0.3 },
    ],
  },
  {
    id: "compressor",
    label: "Compressor",
    amountLabel: "Amount",
    presets: [
      { id: "gentle", label: "Gentle Glue", amount: 0.3 },
      { id: "punch", label: "Punch", amount: 0.6, params: { threshold: 0.55, ratio: 0.5 } },
      { id: "smash", label: "Smash", amount: 0.85, params: { threshold: 0.45, ratio: 0.8 } },
    ],
  },
  {
    id: "saturation",
    label: "Saturation",
    amountLabel: "Drive",
    presets: [
      { id: "tape", label: "Tape", amount: 0.3 },
      { id: "tube", label: "Tube", amount: 0.5 },
      { id: "fuzz", label: "Fuzz", amount: 0.85 },
    ],
  },
  {
    id: "delay",
    label: "Delay",
    amountLabel: "Wet",
    presets: [
      { id: "slap", label: "Slap", amount: 0.2 },
      { id: "quarter", label: "1/4", amount: 0.35 },
      { id: "dub", label: "Dub", amount: 0.6 },
    ],
  },
  {
    id: "reverb",
    label: "Reverb",
    amountLabel: "Wet",
    presets: [
      { id: "room", label: "Room", amount: 0.2 },
      { id: "hall", label: "Hall", amount: 0.45 },
      { id: "cathedral", label: "Cathedral", amount: 0.7 },
    ],
  },
  {
    id: "chorus",
    label: "Chorus",
    amountLabel: "Depth",
    presets: [
      { id: "subtle", label: "Subtle", amount: 0.25 },
      { id: "lush", label: "Lush", amount: 0.55 },
      { id: "swirl", label: "Swirl", amount: 0.85 },
    ],
  },
  {
    id: "bitcrusher",
    label: "Bitcrusher",
    amountLabel: "Crush",
    presets: [
      { id: "12bit", label: "12-bit", amount: 0.3, params: { bits: 0.35 } },
      { id: "8bit", label: "8-bit", amount: 0.6, params: { bits: 0.6 } },
      { id: "4bit", label: "4-bit", amount: 0.9, params: { bits: 0.9 } },
    ],
  },
  {
    id: "stereoWidth",
    label: "Stereo Width",
    amountLabel: "Width",
    presets: [
      { id: "mono", label: "Mono", amount: 0 },
      { id: "natural", label: "Natural", amount: 0.5 },
      { id: "wide", label: "Wide", amount: 0.9 },
    ],
  },
];

export function EffectsRack({ track }: { track: Track }) {
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Effects Rack
      </div>
      <div className="space-y-1.5">
        {MODULES.map((m) => (
          <ModuleRow key={m.id} module={m} track={track} />
        ))}
      </div>
    </div>
  );
}

function ModuleRow({ module, track }: { module: ModuleDef; track: Track }) {
  const stored = useStore(
    (s) =>
      s.project.tracks.find((t) => t.id === track.id)?.fxRack?.[module.id],
  );
  const enabled = stored?.enabled ?? false;
  const amount = stored?.amount ?? 0.5;
  const presetId = stored?.preset ?? "";

  const patch = (p: Partial<FxModuleSettings>) =>
    getStore().setFxModule(track.id, module.id, p);

  return (
    <div
      className={`rounded border ${
        enabled ? "border-primary/40 bg-primary/5" : "border-border bg-background/40"
      } px-2 py-1.5`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <button
          onClick={() => patch({ enabled: !enabled })}
          className={`flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider ${
            enabled ? "text-primary" : "text-muted-foreground"
          }`}
          aria-pressed={enabled}
          data-testid={`fx-toggle-${module.id}`}
        >
          <Power className="w-3 h-3" />
          {module.label}
        </button>
        <div className="flex items-center gap-1">
          <Select
            value={presetId || "_"}
            onValueChange={(v) => {
              if (v === "_") return;
              const p = module.presets.find((x) => x.id === v);
              if (!p) return;
              patch({
                enabled: true,
                preset: p.id,
                amount: p.amount,
                params: p.params ?? {},
              });
            }}
          >
            <SelectTrigger className="h-5 text-[10px] bg-background w-20">
              <SelectValue placeholder="Preset" />
            </SelectTrigger>
            <SelectContent>
              {module.presets.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-[10px]">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={() => getStore().resetFxModule(track.id, module.id)}
            className="text-muted-foreground hover:text-foreground"
            title="Reset"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>
      {enabled && (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[9px] text-muted-foreground w-10">{module.amountLabel}</span>
          <Slider
            value={[amount * 100]}
            max={100}
            step={1}
            onValueChange={([v]) => patch({ amount: (v ?? 0) / 100, preset: "custom" })}
          />
          <MidiLearnButton
            target={{ kind: "fx-amount", trackId: track.id, moduleId: module.id }}
            small
          />
        </div>
      )}
    </div>
  );
}
