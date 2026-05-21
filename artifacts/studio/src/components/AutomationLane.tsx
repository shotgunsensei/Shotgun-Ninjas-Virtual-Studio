import { memo, useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getStore, useStore } from "../store";
import { evalBreakpoints } from "../lib/audio/engine";
import type { AutomationBreakpoint, AutomationLane, Track } from "../types";
import { AUTOMATION_PARAM_LABELS, AUTOMATION_PARAM_IDS } from "../types";

const PX_PER_BEAT = 32;
const LANE_HEIGHT = 52; // px
const POINT_RADIUS = 5;
const HIT_RADIUS = 8; // click hit area

// Neon colour matching the studio theme
const ACCENT = "#39ff14";

// ---- helpers ----------------------------------------------------------------

function valueToY(v: number, h: number) {
  return (1 - v) * (h - 2) + 1;
}

function yToValue(y: number, h: number) {
  return Math.max(0, Math.min(1, 1 - (y - 1) / (h - 2)));
}

function beatToPx(beat: number) {
  return beat * PX_PER_BEAT;
}

function pxToBeat(px: number) {
  return px / PX_PER_BEAT;
}

function nearestBreakpointIdx(
  bps: AutomationBreakpoint[],
  px: number,
  py: number,
  h: number,
): number {
  let best = -1;
  let bestDist = HIT_RADIUS * HIT_RADIUS + 1;
  bps.forEach((bp, i) => {
    const bx = beatToPx(bp.beat);
    const by = valueToY(bp.value, h);
    const d = (px - bx) ** 2 + (py - by) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

// ---- drawing ----------------------------------------------------------------

function drawLane(
  canvas: HTMLCanvasElement,
  breakpoints: AutomationBreakpoint[],
  interpolation: "linear" | "smooth",
  totalBeats: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, w, h);

  // Beat grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let b = 0; b <= totalBeats; b++) {
    const x = beatToPx(b);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  if (breakpoints.length === 0) {
    // Mid-line hint
    ctx.strokeStyle = "rgba(57,255,20,0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  // Build path for curve
  const sorted = [...breakpoints].sort((a, b) => a.beat - b.beat);
  const STEPS = Math.max(2, w);

  ctx.beginPath();
  let started = false;
  for (let px = 0; px <= STEPS; px++) {
    const beat = (px / STEPS) * totalBeats;
    const v = evalBreakpoints(sorted, beat, interpolation);
    const x = beatToPx(beat);
    const y = valueToY(v, h);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }

  // Filled area
  ctx.lineTo(beatToPx(totalBeats), h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = "rgba(57,255,20,0.12)";
  ctx.fill();

  // Curve line
  ctx.beginPath();
  started = false;
  for (let px = 0; px <= STEPS; px++) {
    const beat = (px / STEPS) * totalBeats;
    const v = evalBreakpoints(sorted, beat, interpolation);
    const x = beatToPx(beat);
    const y = valueToY(v, h);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Breakpoint circles
  sorted.forEach((bp) => {
    const x = beatToPx(bp.beat);
    const y = valueToY(bp.value, h);
    ctx.beginPath();
    ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

// ---- component --------------------------------------------------------------

interface AutomationLaneStripProps {
  track: Track;
  lane: AutomationLane;
  totalBeats: number;
}

export const AutomationLaneStrip = memo(function AutomationLaneStrip({
  track,
  lane,
  totalBeats,
}: AutomationLaneStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ idx: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; beat: number; value: number } | null>(null);

  const canvasWidth = totalBeats * PX_PER_BEAT;

  // Re-draw whenever data changes
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = canvasWidth;
    c.height = LANE_HEIGHT;
    drawLane(c, lane.breakpoints, lane.interpolation, totalBeats);
  }, [lane.breakpoints, lane.interpolation, totalBeats, canvasWidth]);

  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  };

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const { px, py } = getCanvasPos(e);
      const h = LANE_HEIGHT;
      const idx = nearestBreakpointIdx(lane.breakpoints, px, py, h);

      if (idx !== -1) {
        // Start dragging existing point
        dragRef.current = { idx };
      } else {
        // Add new breakpoint
        const beat = Math.max(0, Math.min(totalBeats, pxToBeat(px)));
        const value = yToValue(py, h);
        const snappedBeat = Math.round(beat * 4) / 4;
        const next = [...lane.breakpoints, { beat: snappedBeat, value }].sort(
          (a, b) => a.beat - b.beat,
        );
        getStore().setAutomationBreakpoints(track.id, lane.id, next);
        dragRef.current = {
          idx: next.findIndex((b) => b.beat === snappedBeat && b.value === value),
        };
      }
    },
    [lane.breakpoints, lane.id, track.id, totalBeats],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { px, py } = getCanvasPos(e);
      if (dragRef.current !== null) {
        e.preventDefault();
        const beat = Math.max(0, Math.min(totalBeats, pxToBeat(px)));
        const snappedBeat = Math.round(beat * 4) / 4;
        const value = yToValue(py, LANE_HEIGHT);
        const next = lane.breakpoints.map((bp, i) =>
          i === dragRef.current!.idx ? { beat: snappedBeat, value } : bp,
        );
        setTooltip({ x: px, beat: snappedBeat, value });
        getStore().setAutomationBreakpoints(track.id, lane.id, next);
      } else {
        // Show tooltip without dragging
        const h = LANE_HEIGHT;
        const idx = nearestBreakpointIdx(lane.breakpoints, px, py, h);
        if (idx !== -1) {
          const bp = lane.breakpoints[idx];
          setTooltip({ x: px, beat: bp.beat, value: bp.value });
        } else {
          setTooltip(null);
        }
      }
    },
    [lane.breakpoints, lane.id, track.id, totalBeats],
  );

  const onMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const { px, py } = getCanvasPos(e);
      const idx = nearestBreakpointIdx(lane.breakpoints, px, py, LANE_HEIGHT);
      if (idx !== -1) {
        const next = lane.breakpoints.filter((_, i) => i !== idx);
        getStore().setAutomationBreakpoints(track.id, lane.id, next);
      }
    },
    [lane.breakpoints, lane.id, track.id],
  );

  const onMouseLeave = () => {
    setTooltip(null);
    dragRef.current = null;
  };

  return (
    <div className="relative border-t border-border/50 bg-black/20" style={{ height: LANE_HEIGHT }}>
      {/* Param label + controls */}
      <div className="absolute left-0 top-0 bottom-0 z-10 flex flex-col justify-between py-0.5 px-1.5 bg-graphite/60 border-r border-border/40 pointer-events-none">
        <span className="font-mono text-[9px] text-neon/80 truncate max-w-[60px] leading-tight">
          {AUTOMATION_PARAM_LABELS[lane.param]}
        </span>
        <button
          type="button"
          className="pointer-events-auto text-muted-foreground hover:text-white font-mono text-[9px] leading-none text-left"
          title={`Interpolation: ${lane.interpolation}`}
          onClick={() =>
            getStore().updateAutomationLane(track.id, lane.id, {
              interpolation: lane.interpolation === "linear" ? "smooth" : "linear",
            })
          }
        >
          {lane.interpolation === "linear" ? "╱" : "∿"}
        </button>
      </div>
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="block cursor-crosshair"
        style={{ marginLeft: 68 }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onContextMenu={onContextMenu}
        title="Left-click: add/drag point · Right-click: delete point"
      />
      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute top-1 pointer-events-none bg-black/80 text-neon text-[9px] font-mono px-1 rounded leading-tight z-20"
          style={{ left: tooltip.x + 68 + 4, transform: "translateX(0)" }}
        >
          {tooltip.beat.toFixed(2)}b · {(tooltip.value * 100).toFixed(0)}%
        </div>
      )}
      {/* Delete lane button */}
      <button
        type="button"
        className="absolute top-0.5 right-0.5 z-20 w-4 h-4 flex items-center justify-center rounded-sm text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
        onClick={() => getStore().removeAutomationLane(track.id, lane.id)}
        title="Remove automation lane"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  );
});

// ---- Add-lane row -----------------------------------------------------------

export function AddAutomationLaneRow({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const lanes = track.automationLanes ?? [];
  const usedParams = new Set(lanes.map((l) => l.param));
  const available = AUTOMATION_PARAM_IDS.filter((p) => !usedParams.has(p));

  if (available.length === 0) return null;

  return (
    <div className="border-t border-border/30 bg-black/10">
      {open ? (
        <div className="flex flex-wrap gap-1 p-1 pl-[72px]">
          {available.map((param) => (
            <button
              key={param}
              type="button"
              className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-neon/40 text-neon/70 hover:bg-neon/10 hover:text-neon"
              onClick={() => {
                getStore().addAutomationLane(track.id, param);
                setOpen(false);
              }}
            >
              {AUTOMATION_PARAM_LABELS[param]}
            </button>
          ))}
          <button
            type="button"
            className="font-mono text-[9px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="w-full h-5 flex items-center gap-1 pl-[72px] font-mono text-[9px] text-muted-foreground hover:text-neon hover:bg-neon/5"
          onClick={() => setOpen(true)}
        >
          <span className="text-neon/60">+</span> Add automation lane
        </button>
      )}
    </div>
  );
}
