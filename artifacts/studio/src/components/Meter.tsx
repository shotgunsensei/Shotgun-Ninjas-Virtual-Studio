import { useEffect, useRef, useState, useCallback } from "react";
import * as Tone from "tone";
import { useSettings } from "../lib/settings";

/**
 * Stereo level meter shared between channel strips and the master bus.
 * Pulls from a Tone.Meter on every animation frame and renders the
 * green/yellow/red headroom zones used throughout the studio.
 *
 * When `showClip` is true, a latching clip indicator is rendered next
 * to the bars; clicking it resets the latch.
 *
 * When the root has data-cb-safe="1" (colorblind-safe meters enabled),
 * clip zones use a striped pattern overlay and a ⚠ symbol instead of
 * relying on red/green color alone.
 */
export function StereoMeter({
  getMeter,
  getLevels,
  label,
  showClip = false,
  resetKey,
  onClip,
}: {
  getMeter?: () => Tone.Meter | undefined;
  getLevels?: () => { peakDb: [number, number]; rmsDb: [number, number] };
  label?: string;
  showClip?: boolean;
  resetKey?: number;
  onClip?: () => void;
}) {
  const [levels, setLevels] = useState<[number, number]>([0, 0]);
  const [peaksDb, setPeaksDb] = useState<[number, number]>([-Infinity, -Infinity]);
  const [clipped, setClipped] = useState<[boolean, boolean]>([false, false]);
  const peakHoldRef = useRef<{ db: [number, number]; until: [number, number] }>({
    db: [-Infinity, -Infinity],
    until: [0, 0],
  });
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;

  const cbSafe = useSettings((s) => s.colorblindSafeMeters);

  useEffect(() => {
    setClipped([false, false]);
  }, [resetKey]);

  useEffect(() => {
    let raf = 0;
    const FRAME_MS = 1000 / 30;
    let lastFrame = 0;
    const tick = (ts: number) => {
      if (ts - lastFrame < FRAME_MS || document.hidden) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastFrame = ts;
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
          dbL = typeof v === "number" ? v : v[0] ?? -Infinity;
          dbR = typeof v === "number" ? v : v[1] ?? dbL;
        }
      }
      if (dbL !== null && dbR !== null) {
        const normL = Math.max(0, Math.min(1, (dbL + 60) / 60));
        const normR = Math.max(0, Math.min(1, (dbR + 60) / 60));
        setLevels([normL, normR]);

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

        if (dbL >= 0 || dbR >= 0) {
          setClipped((prev) => {
            const nextL = prev[0] || dbL >= 0;
            const nextR = prev[1] || dbR >= 0;
            if (nextL === prev[0] && nextR === prev[1]) return prev;
            if (!prev[0] && !prev[1]) onClipRef.current?.();
            return [nextL, nextR];
          });
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getMeter, getLevels]);

  const peakDb = Math.max(peaksDb[0], peaksDb[1]);
  const clipping = peakDb >= -0.5;
  const anyClipped = clipped[0] || clipped[1];

  const resetClip = (e: React.MouseEvent) => {
    e.stopPropagation();
    setClipped([false, false]);
  };

  return (
    <div className="flex items-center gap-1">
      {label && (
        <span className="text-[9px] text-muted-foreground w-6 font-mono">{label}</span>
      )}
      <div
        className="flex-1 flex flex-col gap-[2px] min-w-[40px]"
        role="meter"
        aria-label={`Level meter${anyClipped ? " — clipping" : ""}`}
        aria-valuenow={Math.round(peakDb)}
        aria-valuemin={-60}
        aria-valuemax={0}
      >
        <MeterBar value={levels[0]} cbSafe={cbSafe} />
        <MeterBar value={levels[1]} cbSafe={cbSafe} />
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
            /* Colorblind-safe: use a warning icon + text instead of color alone */
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
        className={`text-[9px] font-mono w-7 text-right tabular-nums ${
          anyClipped || clipping ? "text-red-400" : "text-muted-foreground"
        }`}
        aria-live="off"
      >
        {Number.isFinite(peakDb) ? peakDb.toFixed(0) : "-∞"}
      </span>
    </div>
  );
}

export function MeterBar({ value, cbSafe = false }: { value: number; cbSafe?: boolean }) {
  // value: 0..1 normalized (-60..0 dB)
  // Thresholds in normalized units: -12 dB = 48/60 = 0.8, -3 dB = 57/60 = 0.95
  const greenW = Math.min(value, 0.8) * 100;
  const yellowW = Math.max(0, Math.min(value, 0.95) - 0.8) * 100;
  const redW = Math.max(0, value - 0.95) * 100;
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
