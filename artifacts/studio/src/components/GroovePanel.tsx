import { useState } from "react";
import { audio } from "../lib/audio/engine";
import { getStore, useStore } from "../store";
import { GROOVE_TEMPLATE_LIST, getGroove } from "../lib/audio/sounds/groove";
import type { GrooveSettings, GrooveTemplateId, Track } from "../types";

/**
 * GroovePanel — picks one of the named groove templates and tunes the
 * humanization knobs (swing / timing-jitter / velocity-jitter), with a
 * 16-step probability + flam grid for fine-grained control. Two scopes:
 *   - "Track" (default): writes to `track.groove`.
 *   - "Global": writes to `project.globalGroove`, which is merged under
 *     every track's per-track overrides at schedule time.
 * The engine reads the merged groove lazily in `scheduleClip`.
 */
export function GroovePanel({ track }: { track: Track }) {
  const globalGroove = useStore((s) => s.project.globalGroove);
  const [scope, setScope] = useState<"track" | "global">("track");
  // Effective groove (template + global + track) — what the engine
  // actually uses. Shown only in Track scope so the user sees the merged
  // result they hear.
  const effective = getGroove(track.groove, globalGroove);
  // Global-scope view: template defaults + global overrides only, with
  // track overrides intentionally excluded so editing Global doesn't
  // silently absorb track-scoped values.
  const globalView = getGroove(undefined, globalGroove);
  // What the panel displays/edits depends on scope.
  const view = scope === "track" ? effective : globalView;
  const active = scope === "track" ? (track.groove ?? {}) : (globalGroove ?? {});

  const patch = (next: Partial<GrooveSettings>) => {
    if (scope === "track") {
      const merged: Partial<GrooveSettings> = { ...(track.groove ?? {}), ...next };
      audio.setTrackGroove(track.id, merged);
      getStore().patchTrack(track.id, { groove: merged });
    } else {
      getStore().setGlobalGroove(next);
    }
  };

  const applyToAll = () => {
    const g = scope === "track" ? (track.groove ?? effective) : (globalGroove ?? globalView);
    getStore().applyGrooveToAllTracks(g);
    getStore().setStatus("Groove applied to all tracks", "info");
  };

  const resetTrack = () => {
    getStore().resetTrackGroove(track.id);
    getStore().setStatus("Track groove cleared — using global", "info");
  };

  const stepProb = view.stepProbability ?? new Array(16).fill(1);
  const stepFlam = view.stepFlam ?? new Array(16).fill(false);

  const setStepProb = (idx: number, v: number) => {
    // Base off the active scope's own values (or scope-appropriate
    // defaults), never the merged effective view — otherwise Global
    // edits inherit track step values.
    const base = active.stepProbability ?? view.stepProbability ?? stepProb;
    const arr = base.slice();
    arr[idx] = v;
    patch({ stepProbability: arr });
  };
  const toggleStepFlam = (idx: number) => {
    const base = active.stepFlam ?? view.stepFlam ?? stepFlam;
    const arr = base.slice();
    arr[idx] = !arr[idx];
    patch({ stepFlam: arr });
  };

  return (
    <div className="panel-inset rounded-md p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Groove
        </span>
        <div className="flex items-center gap-1">
          <ScopeBtn active={scope === "track"} onClick={() => setScope("track")}>
            Track
          </ScopeBtn>
          <ScopeBtn active={scope === "global"} onClick={() => setScope("global")}>
            Global
          </ScopeBtn>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1">
        {GROOVE_TEMPLATE_LIST.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => patch({ template: tpl.id as GrooveTemplateId })}
            title={tpl.description}
            className={`text-[10px] font-mono px-1.5 py-1 rounded border truncate transition-colors ${
              view.template === tpl.id
                ? "border-primary text-primary"
                : "border-border hover:border-primary/60"
            }`}
          >
            {tpl.name}
          </button>
        ))}
      </div>

      <Knob
        label="Swing"
        value={view.swing}
        onChange={(v) => patch({ swing: v })}
      />
      <Knob
        label="Humanize Timing"
        value={view.humanizeTiming}
        onChange={(v) => patch({ humanizeTiming: v })}
      />
      <Knob
        label="Humanize Velocity"
        value={view.humanizeVelocity}
        onChange={(v) => patch({ humanizeVelocity: v })}
      />

      <div className="space-y-1">
        <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          Per-step probability & flam ({scope})
        </div>
        <div
          className="grid gap-px"
          style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
        >
          {Array.from({ length: 16 }, (_, i) => {
            const p = stepProb[i] ?? 1;
            const f = stepFlam[i] ?? false;
            return (
              <div key={i} className="flex flex-col items-stretch gap-px">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={p}
                  onChange={(e) => setStepProb(i, parseFloat(e.target.value))}
                  className="w-full h-2 accent-primary"
                  title={`step ${i + 1}: ${Math.round(p * 100)}%`}
                />
                <button
                  onClick={() => toggleStepFlam(i)}
                  className={`text-[8px] font-mono leading-none py-0.5 rounded border ${
                    f
                      ? "bg-primary/30 border-primary text-primary"
                      : "border-border hover:border-primary/40"
                  }`}
                  title={`step ${i + 1} flam`}
                >
                  F
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-1 pt-1">
        <button
          onClick={applyToAll}
          className="flex-1 text-[10px] font-mono px-1.5 py-1 rounded border border-border hover:border-primary/60"
        >
          Apply → all tracks
        </button>
        <button
          onClick={resetTrack}
          className="flex-1 text-[10px] font-mono px-1.5 py-1 rounded border border-border hover:border-primary/60"
          title="Clear this track's overrides"
        >
          Reset track
        </button>
      </div>

      <p className="text-[9px] font-mono text-muted-foreground">
        Track values override global. Step grid edits the active scope.
      </p>
    </div>
  );
}

function ScopeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
        active ? "border-primary text-primary" : "border-border text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Knob({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9px] text-muted-foreground w-28 truncate">
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-3 accent-primary"
      />
      <span className="font-mono text-[9px] text-foreground/80 w-8 text-right">
        {Math.round(value * 100)}
      </span>
    </div>
  );
}
