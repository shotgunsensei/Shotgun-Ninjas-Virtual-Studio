import { useEffect, useRef } from "react";
import { audio } from "../lib/audio/engine";

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
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr;
    c.height = height * dpr;
    ctx.scale(dpr, dpr);

    let raf = 0;
    const analyser = audio.getMasterAnalyser?.();
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const stroke = () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--neon")
        .trim() || "195 100% 55%";
    const bg = () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--graphite-2")
        .trim() || "0 0% 13%";

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = `hsl(${bg()} / 0.4)`;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = `hsl(${stroke()})`;
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
      const step = width / Math.max(1, n - 1);
      for (let i = 0; i < n; i++) {
        const v = Math.max(-1, Math.min(1, values[i] ?? 0));
        const x = i * step;
        const y = mid - v * (mid * 0.9);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    const tick = () => {
      // Skip canvas redraws when the tab is hidden. The transport keeps
      // running so the analyser still has fresh data when we resume.
      if (!document.hidden) draw();
      raf = requestAnimationFrame(tick);
    };
    if (prefersReduced) {
      draw();
    } else {
      raf = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="rounded-sm border border-border"
      aria-label="Master oscilloscope"
    />
  );
}
