import { useState } from "react";
import { X, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { getStore, useStore } from "../store";
import type {
  ModulationSource,
  ModulationSourceType,
  ModulationRouting,
  Track,
} from "../types";
import { AUTOMATION_PARAM_LABELS, AUTOMATION_PARAM_IDS } from "../types";

// ---- type metadata ---------------------------------------------------------

const SOURCE_TYPE_LABELS: Record<ModulationSourceType, string> = {
  lfo: "LFO",
  envelopeFollower: "Env Follower",
  randomDrift: "Random Drift",
  stepMod: "Step Mod",
  sidechainEnv: "Sidechain",
};

const SOURCE_TYPE_ICONS: Record<ModulationSourceType, string> = {
  lfo: "∿",
  envelopeFollower: "⌇",
  randomDrift: "≋",
  stepMod: "▬",
  sidechainEnv: "↓",
};

const ALL_SOURCE_TYPES: ModulationSourceType[] = [
  "lfo",
  "envelopeFollower",
  "randomDrift",
  "stepMod",
  "sidechainEnv",
];

// ---- helpers ----------------------------------------------------------------

function SmallKnob({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col items-center gap-0.5 cursor-pointer">
      <span className="font-mono text-[8px] text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-12 accent-neon cursor-pointer"
        style={{ height: 4 }}
      />
      <span className="font-mono text-[9px] text-foreground/70">
        {format ? format(value) : value.toFixed(2)}
      </span>
    </label>
  );
}

// ---- source row components --------------------------------------------------

function LfoSourceRow({ source }: { source: ModulationSource }) {
  const s = source.lfo ?? { shape: "sine" as const, rate: 1, depth: 1, phase: 0 };
  const shapes = ["sine", "triangle", "square", "sawtooth"] as const;
  return (
    <div className="flex flex-wrap gap-3 items-end pt-2">
      <label className="flex flex-col gap-0.5">
        <span className="font-mono text-[8px] text-muted-foreground uppercase tracking-wider">Shape</span>
        <select
          className="bg-background/60 border border-border/60 rounded text-[10px] font-mono px-1 py-0.5 text-foreground"
          value={s.shape}
          onChange={(e) =>
            getStore().updateModulationSource(source.id, {
              lfo: { ...s, shape: e.target.value as typeof s.shape },
            })
          }
        >
          {shapes.map((sh) => (
            <option key={sh} value={sh}>{sh}</option>
          ))}
        </select>
      </label>
      <SmallKnob
        label="Rate Hz"
        value={s.rate}
        min={0.01}
        max={20}
        step={0.01}
        format={(v) => `${v.toFixed(2)}Hz`}
        onChange={(v) => getStore().updateModulationSource(source.id, { lfo: { ...s, rate: v } })}
      />
      <SmallKnob
        label="Depth"
        value={s.depth}
        onChange={(v) => getStore().updateModulationSource(source.id, { lfo: { ...s, depth: v } })}
      />
      <SmallKnob
        label="Phase°"
        value={s.phase}
        min={0}
        max={360}
        step={1}
        format={(v) => `${v.toFixed(0)}°`}
        onChange={(v) => getStore().updateModulationSource(source.id, { lfo: { ...s, phase: v } })}
      />
    </div>
  );
}

function RandomDriftRow({ source }: { source: ModulationSource }) {
  const s = source.randomDrift ?? { rate: 0.5, smoothing: 0.85 };
  return (
    <div className="flex gap-3 items-end pt-2">
      <SmallKnob
        label="Rate"
        value={s.rate}
        min={0.01}
        max={5}
        step={0.01}
        onChange={(v) =>
          getStore().updateModulationSource(source.id, { randomDrift: { ...s, rate: v } })
        }
      />
      <SmallKnob
        label="Smooth"
        value={s.smoothing}
        onChange={(v) =>
          getStore().updateModulationSource(source.id, { randomDrift: { ...s, smoothing: v } })
        }
      />
    </div>
  );
}

function StepModRow({ source }: { source: ModulationSource }) {
  const s = source.stepMod ?? { steps: [1, 0, 0.75, 0, 1, 0, 0.5, 0], rate: 0.5, glide: 0 };
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex gap-1 items-end">
        {s.steps.map((v, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5">
            <div
              className="w-4 bg-neon/20 border border-neon/40 rounded-t cursor-ns-resize"
              style={{ height: `${Math.round(v * 28) + 4}px` }}
              onMouseDown={(e) => {
                e.preventDefault();
                const startY = e.clientY;
                const startV = v;
                const onMove = (ev: MouseEvent) => {
                  const dv = (startY - ev.clientY) / 60;
                  const nv = Math.max(0, Math.min(1, startV + dv));
                  const next = [...s.steps];
                  next[i] = nv;
                  getStore().updateModulationSource(source.id, { stepMod: { ...s, steps: next } });
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            />
          </div>
        ))}
        <button
          type="button"
          className="text-neon/60 hover:text-neon font-mono text-[10px] pb-1"
          onClick={() => {
            if (s.steps.length < 16) {
              getStore().updateModulationSource(source.id, {
                stepMod: { ...s, steps: [...s.steps, 0.5] },
              });
            }
          }}
          title="Add step"
        >
          +
        </button>
        {s.steps.length > 1 && (
          <button
            type="button"
            className="text-red-400/60 hover:text-red-400 font-mono text-[10px] pb-1"
            onClick={() =>
              getStore().updateModulationSource(source.id, {
                stepMod: { ...s, steps: s.steps.slice(0, -1) },
              })
            }
            title="Remove step"
          >
            −
          </button>
        )}
      </div>
      <div className="flex gap-3 items-end">
        <SmallKnob
          label="Rate (b)"
          value={s.rate}
          min={0.0625}
          max={4}
          step={0.0625}
          format={(v) => `${v.toFixed(2)}b`}
          onChange={(v) => getStore().updateModulationSource(source.id, { stepMod: { ...s, rate: v } })}
        />
        <SmallKnob
          label="Glide"
          value={s.glide}
          onChange={(v) => getStore().updateModulationSource(source.id, { stepMod: { ...s, glide: v } })}
        />
      </div>
    </div>
  );
}

function EnvFollowerRow({ source, tracks }: { source: ModulationSource; tracks: Track[] }) {
  const s = source.envelopeFollower ?? { attack: 0.01, release: 0.1, sourceTrackId: "" };
  return (
    <div className="flex flex-wrap gap-3 items-end pt-2">
      <label className="flex flex-col gap-0.5">
        <span className="font-mono text-[8px] text-muted-foreground uppercase tracking-wider">Source Track</span>
        <select
          className="bg-background/60 border border-border/60 rounded text-[10px] font-mono px-1 py-0.5 text-foreground"
          value={s.sourceTrackId}
          onChange={(e) =>
            getStore().updateModulationSource(source.id, {
              envelopeFollower: { ...s, sourceTrackId: e.target.value },
            })
          }
        >
          <option value="">— pick track —</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <SmallKnob
        label="Attack"
        value={s.attack}
        min={0.001}
        max={0.5}
        step={0.001}
        format={(v) => `${(v * 1000).toFixed(0)}ms`}
        onChange={(v) =>
          getStore().updateModulationSource(source.id, { envelopeFollower: { ...s, attack: v } })
        }
      />
      <SmallKnob
        label="Release"
        value={s.release}
        min={0.01}
        max={2}
        step={0.01}
        format={(v) => `${(v * 1000).toFixed(0)}ms`}
        onChange={(v) =>
          getStore().updateModulationSource(source.id, { envelopeFollower: { ...s, release: v } })
        }
      />
    </div>
  );
}

function SidechainRow({ source, tracks }: { source: ModulationSource; tracks: Track[] }) {
  const s = source.sidechainEnv ?? { sourceTrackId: "", attack: 0.01, release: 0.2, depth: 0.8 };
  return (
    <div className="flex flex-wrap gap-3 items-end pt-2">
      <label className="flex flex-col gap-0.5">
        <span className="font-mono text-[8px] text-muted-foreground uppercase tracking-wider">Source Track</span>
        <select
          className="bg-background/60 border border-border/60 rounded text-[10px] font-mono px-1 py-0.5 text-foreground"
          value={s.sourceTrackId}
          onChange={(e) =>
            getStore().updateModulationSource(source.id, {
              sidechainEnv: { ...s, sourceTrackId: e.target.value },
            })
          }
        >
          <option value="">— pick track —</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <SmallKnob
        label="Attack"
        value={s.attack}
        min={0.001}
        max={0.5}
        step={0.001}
        format={(v) => `${(v * 1000).toFixed(0)}ms`}
        onChange={(v) =>
          getStore().updateModulationSource(source.id, { sidechainEnv: { ...s, attack: v } })
        }
      />
      <SmallKnob
        label="Release"
        value={s.release}
        min={0.01}
        max={2}
        step={0.01}
        format={(v) => `${(v * 1000).toFixed(0)}ms`}
        onChange={(v) =>
          getStore().updateModulationSource(source.id, { sidechainEnv: { ...s, release: v } })
        }
      />
      <SmallKnob
        label="Depth"
        value={s.depth}
        onChange={(v) =>
          getStore().updateModulationSource(source.id, { sidechainEnv: { ...s, depth: v } })
        }
      />
    </div>
  );
}

// ---- source card ------------------------------------------------------------

function SourceCard({
  source,
  tracks,
}: {
  source: ModulationSource;
  tracks: Track[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border/50 rounded bg-background/30 mb-1.5">
      <div className="flex items-center justify-between px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-neon font-mono text-sm">{SOURCE_TYPE_ICONS[source.type]}</span>
          <div className="flex flex-col">
            <input
              className="bg-transparent font-mono text-[11px] text-foreground w-28 outline-none border-b border-transparent hover:border-border focus:border-neon"
              value={source.label}
              onChange={(e) =>
                getStore().updateModulationSource(source.id, { label: e.target.value })
              }
            />
            <span className="font-mono text-[9px] text-muted-foreground">
              {SOURCE_TYPE_LABELS[source.type]}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground p-0.5"
            onClick={() => setExpanded((x) => !x)}
            title={expanded ? "Collapse" : "Expand settings"}
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-red-400 p-0.5"
            onClick={() => getStore().removeModulationSource(source.id)}
            title="Remove source"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-2 pb-2 border-t border-border/30">
          {source.type === "lfo" && <LfoSourceRow source={source} />}
          {source.type === "randomDrift" && <RandomDriftRow source={source} />}
          {source.type === "stepMod" && <StepModRow source={source} />}
          {source.type === "envelopeFollower" && (
            <EnvFollowerRow source={source} tracks={tracks} />
          )}
          {source.type === "sidechainEnv" && (
            <SidechainRow source={source} tracks={tracks} />
          )}
        </div>
      )}
    </div>
  );
}

// ---- routing row ------------------------------------------------------------

function RoutingRow({
  routing,
  sources,
  tracks,
}: {
  routing: ModulationRouting;
  sources: ModulationSource[];
  tracks: Track[];
}) {
  const src = sources.find((s) => s.id === routing.sourceId);
  const track = tracks.find((t) => t.id === routing.trackId);

  return (
    <div className="flex items-center gap-2 border border-border/40 rounded px-2 py-1.5 mb-1 bg-background/20">
      <span className="font-mono text-[10px] text-neon/80 w-5 text-center shrink-0">
        {src ? SOURCE_TYPE_ICONS[src.type] : "?"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] text-foreground truncate">
          {src?.label ?? "Unknown"}{" "}
          <span className="text-muted-foreground">→</span>{" "}
          {track?.name ?? "Unknown"}: {AUTOMATION_PARAM_LABELS[routing.param]}
        </div>
      </div>
      <SmallKnob
        label="Depth"
        value={(routing.depth + 1) / 2}
        format={(v) => `${Math.round((v * 2 - 1) * 100)}%`}
        onChange={(v) =>
          getStore().updateModulationRouting(routing.id, { depth: v * 2 - 1 })
        }
      />
      <button
        type="button"
        className="text-muted-foreground hover:text-red-400 shrink-0"
        onClick={() => getStore().removeModulationRouting(routing.id)}
        title="Remove routing"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ---- add-routing dialog (inline form) --------------------------------------

function AddRoutingForm({
  sources,
  tracks,
  onClose,
}: {
  sources: ModulationSource[];
  tracks: Track[];
  onClose: () => void;
}) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? "");
  const [param, setParam] = useState<string>(AUTOMATION_PARAM_IDS[0]);

  const onAdd = () => {
    if (!sourceId || !trackId || !param) return;
    getStore().addModulationRouting({
      sourceId,
      trackId,
      param: param as import("../types").AutomationParamId,
      depth: 0.5,
    });
    onClose();
  };

  return (
    <div className="border border-neon/30 rounded bg-background/40 p-2 mb-2">
      <div className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">Source</span>
          <select
            className="bg-background/60 border border-border/60 rounded text-[10px] font-mono px-1 py-0.5 text-foreground"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {SOURCE_TYPE_ICONS[s.type]} {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">Track</span>
          <select
            className="bg-background/60 border border-border/60 rounded text-[10px] font-mono px-1 py-0.5 text-foreground"
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
          >
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">Parameter</span>
          <select
            className="bg-background/60 border border-border/60 rounded text-[10px] font-mono px-1 py-0.5 text-foreground"
            value={param}
            onChange={(e) => setParam(e.target.value)}
          >
            {AUTOMATION_PARAM_IDS.map((p) => (
              <option key={p} value={p}>{AUTOMATION_PARAM_LABELS[p]}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          className="flex-1 h-6 rounded bg-neon/20 border border-neon/40 text-neon text-[10px] font-mono hover:bg-neon/30"
          onClick={onAdd}
        >
          Add
        </button>
        <button
          type="button"
          className="flex-1 h-6 rounded border border-border/60 text-muted-foreground text-[10px] font-mono hover:text-foreground"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---- main panel ------------------------------------------------------------

export function ModulationPanel() {
  const sources = useStore((s) => s.project.modulationSources ?? []);
  const routings = useStore((s) => s.project.modulationRoutings ?? []);
  const tracks = useStore((s) => s.project.tracks);
  const [addingSource, setAddingSource] = useState(false);
  const [addingRouting, setAddingRouting] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sources */}
      <div className="border-b border-border/60 p-2 overflow-y-auto" style={{ maxHeight: "55%" }}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Modulation Sources
          </span>
          <button
            type="button"
            className="flex items-center gap-0.5 font-mono text-[9px] text-neon/70 hover:text-neon"
            onClick={() => setAddingSource((x) => !x)}
            title="Add modulation source"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>

        {addingSource && (
          <div className="flex flex-wrap gap-1 mb-2 p-1 border border-neon/20 rounded bg-background/20">
            {ALL_SOURCE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground hover:text-neon hover:border-neon/40"
                onClick={() => {
                  getStore().addModulationSource(type);
                  setAddingSource(false);
                }}
              >
                {SOURCE_TYPE_ICONS[type]} {SOURCE_TYPE_LABELS[type]}
              </button>
            ))}
            <button
              type="button"
              className="font-mono text-[9px] px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setAddingSource(false)}
            >
              Cancel
            </button>
          </div>
        )}

        {sources.length === 0 ? (
          <p className="font-mono text-[10px] text-muted-foreground italic text-center py-2">
            No sources — click Add above
          </p>
        ) : (
          sources.map((s) => <SourceCard key={s.id} source={s} tracks={tracks} />)
        )}
      </div>

      {/* Routings */}
      <div className="flex-1 p-2 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Routings
          </span>
          {sources.length > 0 && tracks.length > 0 && (
            <button
              type="button"
              className="flex items-center gap-0.5 font-mono text-[9px] text-neon/70 hover:text-neon"
              onClick={() => setAddingRouting((x) => !x)}
              title="Add routing"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          )}
        </div>

        {addingRouting && sources.length > 0 && (
          <AddRoutingForm
            sources={sources}
            tracks={tracks}
            onClose={() => setAddingRouting(false)}
          />
        )}

        {routings.length === 0 ? (
          <p className="font-mono text-[10px] text-muted-foreground italic text-center py-2">
            No routings — add a source first, then wire it here
          </p>
        ) : (
          routings.map((r) => (
            <RoutingRow key={r.id} routing={r} sources={sources} tracks={tracks} />
          ))
        )}
      </div>
    </div>
  );
}
