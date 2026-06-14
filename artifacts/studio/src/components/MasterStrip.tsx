import { AlertTriangle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { audio } from "../lib/audio/engine";
import { DEFAULT_MASTER_BUS } from "../lib/audio/master";
import { MIX_PRESETS } from "../lib/audio/mixPresets";
import { visualTicker } from "../lib/visualTicker";
import { getStore, useStore } from "../store";

export function MasterStrip() {
  const storedBus = useStore((s) => s.project.masterBus);
  const masterBus = storedBus ?? DEFAULT_MASTER_BUS;
  const masterVolume = useStore((s) => s.project.masterVolume);
  const mixPresetId = useStore((s) => s.project.mixPresetId);
  const clipped = useMasterClipped();

  const setBus = (patch: Partial<typeof masterBus>) =>
    getStore().setMasterBus(patch);

  return (
    <div className="flex-none w-56 border-l-2 border-primary/40 bg-graphite/80 p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wider text-primary">
          Master
        </span>
        {clipped && (
          <button
            onClick={() => {
              audio.resetMasterClip();
            }}
            className="flex items-center gap-1 text-[10px] font-mono uppercase text-red-400 bg-red-500/10 border border-red-500/40 rounded px-1.5 py-0.5"
            title="Click to reset clip indicator"
            data-testid="master-clip"
          >
            <AlertTriangle className="w-3 h-3" />
            CLIP
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[9px] text-muted-foreground w-6">VOL</span>
        <Slider
          value={[masterVolume * 100]}
          max={100}
          step={1}
          onValueChange={([v]) => {
            const vol = (v ?? 0) / 100;
            getStore().patchProject({ masterVolume: vol });
            audio.setMaster(vol);
          }}
        />
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[9px] text-muted-foreground w-10">WIDTH</span>
        <Slider
          value={[masterBus.width * 50]}
          max={100}
          step={1}
          onValueChange={([v]) => setBus({ width: ((v ?? 50) / 50) })}
        />
      </div>

      <div className="grid grid-cols-2 gap-1">
        <BusToggle
          label="GLUE"
          on={masterBus.glueEnabled}
          onChange={(on) => setBus({ glueEnabled: on })}
        />
        <BusToggle
          label="SOFT"
          on={masterBus.softClip}
          onChange={(on) => setBus({ softClip: on })}
        />
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[9px] text-muted-foreground w-10">LIMIT</span>
        <Slider
          value={[(masterBus.limiterThresholdDb + 24) * (100 / 24)]}
          max={100}
          step={1}
          onValueChange={([v]) => {
            const norm = (v ?? 0) / 100;
            setBus({ limiterThresholdDb: -24 + 24 * norm });
          }}
        />
        <span className="text-[9px] font-mono w-10 text-right text-muted-foreground">
          {masterBus.limiterThresholdDb.toFixed(1)}
        </span>
      </div>

      <div className="border-t border-border pt-2 mt-1">
        <div className="flex items-center gap-1 mb-1.5">
          <Sparkles className="w-3 h-3 text-primary" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Mix Presets
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {MIX_PRESETS.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              size="sm"
              data-testid={`mix-preset-${p.id}`}
              onClick={() => getStore().applyMixPreset(p.id)}
              title={p.description}
              className={`h-6 text-[10px] ${
                mixPresetId === p.id ? "border-primary text-primary" : ""
              }`}
            >
              {p.name}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BusToggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`text-[10px] font-mono py-1 rounded border ${
        on
          ? "bg-primary/20 border-primary/60 text-primary"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function useMasterClipped(): boolean {
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    // Poll the master clip latch at ~5 Hz via the shared ticker. It's a
    // binary indicator, so frame frequency is overkill.
    const MIN_INTERVAL_MS = 200;
    let lastTick = 0;
    return visualTicker.subscribe((ts) => {
      if (ts - lastTick < MIN_INTERVAL_MS) return;
      lastTick = ts;
      const c = audio.getMasterClipped();
      setClipped((prev) => (prev !== c ? c : prev));
    });
  }, []);
  return clipped;
}
