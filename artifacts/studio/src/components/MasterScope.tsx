import { useEffect, useRef } from "react";
import { audio } from "../lib/audio/engine";
import { useSettings } from "../lib/settings";
import { visualTicker } from "../lib/visualTicker";
import { startPerfTimer } from "../utils/performanceDiagnostics";

/**
 * Tiny master oscilloscope drawn on a canvas. Pulls a waveform from a
 * lazily-created Tone.Analyser hanging off the master input. Cheap enough
 * to run at 60fps and respects `prefers-reduced-motion` by drawing a
 * single static line at idle.
 */
export function MasterScope({
  width = 96,
  height = 28,
}: {
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const performanceMode = useSettings((s) => s.performanceMode);
  useEffect(() => {
    const endMountTiming = startPerfTimer("visualizer-mount", { component: "MasterScope" });
    const c = canvasRef.current;
    if (!c) {
      endMountTiming();
      return;
    }
    const ctx = c.getContext("2d");
    if (!ctx) {
      endMountTiming();
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr;
    c.height = height * dpr;
    ctx.scale(dpr, dpr);

    const analyser = audio.getMasterAnalyser?.(performanceMode ? 128 : 256);
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const stroke =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--neon")
        .trim() || "195 100% 55%";
    const bg =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--graphite-2")
        .trim() || "0 0% 13%";

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = `hsl(${bg} / 0.4)`;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = `hsl(${stroke})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const mid = height / 2;
      if (!analyser) {
        ctx.moveTo(0, mid);
        ctx.lineTo(width, mid);
        ctx.stroke();
        return;
      }
      const values = analyser.getValue() as Float32Array;
      const n = values.length;
      const sampleStride = performanceMode ? 2 : 1;
      const points = Math.ceil(n / sampleStride);
      const step = width / Math.max(1, points - 1);
      for (let i = 0, point = 0; i < n; i += sampleStride, point++) {
        const v = Math.max(-1, Math.min(1, values[i] ?? 0));
        const x = point * step;
        const y = mid - v * (mid * 0.9);
        if (point === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    let unsubscribe: (() => void) | null = null;
    if (prefersReduced) {
      draw();
    } else {
      unsubscribe = visualTicker.subscribe(draw);
    }
    endMountTiming();
    return () => {
      const endUnmountTiming = startPerfTimer("visualizer-unmount", { component: "MasterScope" });
      unsubscribe?.();
      endUnmountTiming();
    };
  }, [width, height, performanceMode]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="rounded-sm border border-border"
      aria-label="Master oscilloscope"
    />
  );
}
