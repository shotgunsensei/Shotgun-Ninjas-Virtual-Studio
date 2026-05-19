import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";

/**
 * Stereo level meter shared between channel strips and the master bus.
 * Pulls from a Tone.Meter on every animation frame and renders the
 * green/yellow/red headroom zones used throughout the studio.
 *
 * When `showClip` is true, a latching clip indicator is rendered next
 * to the bars; clicking it resets the latch.
 */
export function StereoMeter({
  getMeter,
  getLevels,
  label,
  showClip = false,
}: {
  getMeter?: () => Tone.Meter | undefined;
  /**
   * Alternative cheap-to-poll source returning a reused {peakDb, rmsDb}
   * object. Used by the master meter so it reads through the engine
   * facade's `getMasterLevels()` rather than touching the raw meter.
   */
  getLevels?: () => { peakDb: [number, number]; rmsDb: [number, number] };
  label?: string;
  showClip?: boolean;
}) {
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
      <div className="flex-1 flex flex-col gap-[2px] min-w-[40px]">
        <MeterBar value={levels[0]} />
        <MeterBar value={levels[1]} />
      </div>
      {showClip && (
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
      )}
      <span
        className={`text-[9px] font-mono w-7 text-right tabular-nums ${
          anyClipped || clipping ? "text-red-400" : "text-muted-foreground"
        }`}
      >
        {Number.isFinite(peakDb) ? peakDb.toFixed(0) : "-∞"}
      </span>
    </div>
  );
}

export function MeterBar({ value }: { value: number }) {
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
