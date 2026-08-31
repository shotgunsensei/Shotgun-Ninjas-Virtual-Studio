import { useEffect, useRef, useState } from "react";
import type { LevelMeter } from "../lib/audio/meterTypes";
import { useSettings } from "../lib/settings";
import { visualTicker } from "../lib/visualTicker";

/**
 * Stereo level meter — canvas-based rewrite for Task #208 performance pass.
 *
 * Previous implementation called setLevels + setPeaksDb (React state) at 30 Hz
 * per instance, which triggered React reconcile on every frame × N tracks.
 * This version:
 *   - Draws directly to a <canvas> element — zero React state updates per frame
 *   - Uses the shared visualTicker singleton (one rAF loop for all meters)
 *   - Writes dB text and aria-valuenow directly to DOM refs
 *   - Only calls setState when the clipped latch actually changes (infrequent)
 *
 * MeterBar is kept as a named export for any callers that render individual bars.
 */

// ── canvas drawing ──────────────────────────────────────────────────────────

const GREEN  = "#10b981"; // emerald-500
const YELLOW = "#facc15"; // yellow-400
const RED    = "#ef4444"; // red-500
const WHITE  = "#ffffff";
const BG     = "rgba(0,0,0,0.4)";

/**
 * Draw two horizontal meter bars (L top, R bottom) into a canvas element.
 * Resizes the backing store whenever the CSS layout size changes.
 */
function drawMeters(
  canvas: HTMLCanvasElement,
  normL: number,
  normR: number,
  peakNormL: number,
  peakNormR: number,
  cbSafe: boolean,
): void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (W < 2 || H < 2) return;

  // Sync backing store size to layout size (avoids blurry or distorted bars).
  if (canvas.width !== W)  canvas.width  = W;
  if (canvas.height !== H) canvas.height = H;

  // Two bars of equal height with a 2 px gap.
  const barH = Math.max(1, Math.floor((H - 2) / 2));

  for (let ch = 0; ch < 2; ch++) {
    const norm     = ch === 0 ? normL     : normR;
    const peakNorm = ch === 0 ? peakNormL : peakNormR;
    const y        = ch * (barH + 2);

    // Background
    ctx.fillStyle = BG;
    ctx.fillRect(0, y, W, barH);

    // Green zone  0 → 80 % (−∞ to −12 dBFS)
    const greenPx = Math.round(Math.min(norm, 0.8) * W);
    if (greenPx > 0) {
      ctx.fillStyle = GREEN;
      ctx.fillRect(0, y, greenPx, barH);
    }

    // Yellow zone  80 % → 95 % (−12 to −3 dBFS)
    const yStart = Math.round(0.8  * W);
    const yEnd   = Math.round(Math.min(norm, 0.95) * W);
    if (yEnd > yStart) {
      ctx.fillStyle = YELLOW;
      ctx.fillRect(yStart, y, yEnd - yStart, barH);
    }

    // Red zone  95 % → 100 % (−3 to 0 dBFS)
    const rStart = Math.round(0.95 * W);
    const rEnd   = Math.round(norm * W);
    if (rEnd > rStart) {
      ctx.fillStyle = cbSafe ? WHITE : RED;
      ctx.fillRect(rStart, y, rEnd - rStart, barH);
    }

    // Peak hold marker (2 px wide)
    if (peakNorm > 0.01 && peakNorm <= 1) {
      const px = Math.min(W - 2, Math.round(peakNorm * W) - 1);
      ctx.fillStyle =
        peakNorm >= 0.95 ? (cbSafe ? WHITE : RED) :
        peakNorm >= 0.8  ? YELLOW : GREEN;
      ctx.fillRect(px, y, 2, barH);
    }
  }
}

// ── StereoMeter ─────────────────────────────────────────────────────────────

export function StereoMeter({
  getMeter,
  getLevels,
  label,
  showClip = false,
  resetKey,
  onClip,
}: {
  getMeter?: () => LevelMeter | undefined;
  getLevels?: () => { peakDb: [number, number]; rmsDb: [number, number] };
  label?: string;
  showClip?: boolean;
  resetKey?: number;
  onClip?: () => void;
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const dbSpanRef  = useRef<HTMLSpanElement>(null);
  const outerRef   = useRef<HTMLDivElement>(null);

  // Infrequent React state — only updated when the clip latch actually changes.
  const [clipped, setClipped] = useState<[boolean, boolean]>([false, false]);

  const peakHoldRef = useRef<{ db: [number, number]; until: [number, number] }>({
    db: [-Infinity, -Infinity],
    until: [0, 0],
  });

  // Ref-copies of data needed inside the visualTicker callback (avoids captures).
  const clippedRef  = useRef<[boolean, boolean]>([false, false]);
  const onClipRef   = useRef(onClip);
  onClipRef.current = onClip;

  const cbSafe    = useSettings((s) => s.colorblindSafeMeters);
  const cbSafeRef = useRef(cbSafe);
  cbSafeRef.current = cbSafe;

  // Sync clip latch ref whenever React state changes (e.g. after resetKey).
  useEffect(() => {
    setClipped([false, false]);
    clippedRef.current = [false, false];
  }, [resetKey]);

  // Main draw loop — subscribed to the shared visualTicker.
  useEffect(() => {
    const tick = () => {
      // ── sample levels ──────────────────────────────────────────────────
      let dbL: number | null = null;
      let dbR: number | null = null;

      if (getLevels) {
        const lv = getLevels();
        dbL = lv.peakDb[0];
        dbR = lv.peakDb[1];
      } else {
        const meter = getMeter?.();
        if (meter) {
          const v = meter.getValue();
          dbL = typeof v === "number" ? v : (v[0] ?? -Infinity);
          dbR = typeof v === "number" ? v : (v[1] ?? dbL);
        }
      }
      if (dbL === null || dbR === null) return;

      // ── normalise + peak hold ──────────────────────────────────────────
      const normL = Math.max(0, Math.min(1, (dbL + 60) / 60));
      const normR = Math.max(0, Math.min(1, (dbR + 60) / 60));

      const now  = performance.now();
      const hold = peakHoldRef.current;
      if (dbL >= hold.db[0] || now > hold.until[0]) {
        hold.db[0]    = dbL;
        hold.until[0] = now + 800;
      }
      if (dbR >= hold.db[1] || now > hold.until[1]) {
        hold.db[1]    = dbR;
        hold.until[1] = now + 800;
      }
      const peakNormL = Math.max(0, Math.min(1, (hold.db[0] + 60) / 60));
      const peakNormR = Math.max(0, Math.min(1, (hold.db[1] + 60) / 60));

      // ── canvas draw ────────────────────────────────────────────────────
      const canvas = canvasRef.current;
      if (canvas) {
        drawMeters(canvas, normL, normR, peakNormL, peakNormR, cbSafeRef.current);
      }

      // ── dB text (direct DOM write — no React re-render) ────────────────
      const peakDb    = Math.max(hold.db[0], hold.db[1]);
      const anyClipped = clippedRef.current[0] || clippedRef.current[1];
      const clipping  = peakDb >= -0.5;
      if (dbSpanRef.current) {
        dbSpanRef.current.textContent = Number.isFinite(peakDb)
          ? peakDb.toFixed(0)
          : "-∞";
        dbSpanRef.current.className = [
          "text-[9px] font-mono w-7 text-right tabular-nums",
          anyClipped || clipping ? "text-red-400" : "text-muted-foreground",
        ].join(" ");
      }

      // ── aria-valuenow (direct DOM write) ──────────────────────────────
      if (outerRef.current) {
        outerRef.current.setAttribute("aria-valuenow", String(Math.round(peakDb)));
      }

      // ── clip latch (React state — only when it changes) ────────────────
      if (dbL >= 0 || dbR >= 0) {
        const prev  = clippedRef.current;
        const nextL = prev[0] || dbL >= 0;
        const nextR = prev[1] || dbR >= 0;
        if (nextL !== prev[0] || nextR !== prev[1]) {
          if (!prev[0] && !prev[1]) onClipRef.current?.();
          clippedRef.current = [nextL, nextR];
          setClipped([nextL, nextR]);
        }
      }
    };

    return visualTicker.subscribe(tick);
  }, [getMeter, getLevels]);

  const resetClip = (e: React.MouseEvent) => {
    e.stopPropagation();
    setClipped([false, false]);
    clippedRef.current = [false, false];
  };

  const anyClipped = clipped[0] || clipped[1];
  const peakDb     = Math.max(peakHoldRef.current.db[0], peakHoldRef.current.db[1]);

  return (
    <div className="flex items-center gap-1">
      {label && (
        <span className="text-[9px] text-muted-foreground w-6 font-mono">{label}</span>
      )}
      <div
        ref={outerRef}
        className="flex-1 flex flex-col gap-[2px] min-w-[40px]"
        role="meter"
        aria-label={`Level meter${anyClipped ? " — clipping" : ""}`}
        aria-valuenow={Math.round(peakDb)}
        aria-valuemin={-60}
        aria-valuemax={0}
      >
        <canvas
          ref={canvasRef}
          className="w-full"
          style={{ height: "12px", display: "block" }}
          aria-hidden="true"
        />
      </div>
      {showClip && (
        <button
          type="button"
          onClick={resetClip}
          title={anyClipped ? "Clipping detected — click to reset" : "Clip indicator"}
          aria-label={anyClipped ? "Clip indicator active, click to reset" : "No clip"}
          aria-pressed={anyClipped}
          className="flex flex-col gap-[2px] justify-center"
        >
          {cbSafe ? (
            <span
              className={`block text-[9px] font-mono leading-none ${
                anyClipped ? "text-foreground font-bold" : "text-muted-foreground/40"
              }`}
              aria-hidden="true"
            >
              {anyClipped ? "⚠" : "○"}
            </span>
          ) : (
            <>
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
            </>
          )}
        </button>
      )}
      <span
        ref={dbSpanRef}
        className={`text-[9px] font-mono w-7 text-right tabular-nums ${
          anyClipped ? "text-red-400" : "text-muted-foreground"
        }`}
        aria-live="off"
      >
        {Number.isFinite(peakDb) ? peakDb.toFixed(0) : "-∞"}
      </span>
    </div>
  );
}

// ── MeterBar (kept for external callers) ────────────────────────────────────

export function MeterBar({ value, cbSafe = false }: { value: number; cbSafe?: boolean }) {
  const greenW  = Math.min(value, 0.8)  * 100;
  const yellowW = Math.max(0, Math.min(value, 0.95) - 0.8) * 100;
  const redW    = Math.max(0, value - 0.95) * 100;
  const isClipping = redW > 0;

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
        className={`absolute inset-y-0 ${cbSafe ? "bg-white meter-clip-zone" : "bg-red-500"}`}
        style={{ left: `${0.95 * 100}%`, width: `${redW}%` }}
        aria-hidden={!isClipping}
      />
    </div>
  );
}
