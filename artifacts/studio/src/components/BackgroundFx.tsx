import { useMemo } from "react";
import { useWorld } from "../contexts/WorldContext";

/**
 * Atmospheric backdrop layer. Branches on the active Studio World's
 * `visualizerVariant` to render six distinct CSS + SVG environments.
 *
 * All animations are gated on `prefers-reduced-motion: no-preference` in the
 * stylesheet and the existing `studio-reduce-motion` toggle, so users with
 * motion sensitivity see a calm, static backdrop.
 */
export function BackgroundFx() {
  const { activeWorld } = useWorld();
  const variant = activeWorld.visualizerVariant;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {variant === "shuriken" && <ShurikenLayer />}
      {variant === "sparks" && <SparksLayer />}
      {variant === "rain" && <RainLayer />}
      {variant === "smoke" && <SmokeLayer />}
      {variant === "circuit" && <CircuitLayer />}
      {variant === "scanline" && <ScanlineLayer />}
    </div>
  );
}

// ── Shuriken (Dojo Dark) ─────────────────────────────────────────────────────

function ShurikenLayer() {
  const stars = useMemo(() => {
    const out: Array<{
      top: number; left: number; size: number;
      delay: number; duration: number; hue: "red" | "neon";
    }> = [];
    let seed = 1337;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 60; i++) {
      out.push({
        top: rand() * 100, left: rand() * 100, size: 1.5 + rand() * 2.5,
        delay: rand() * 6, duration: 3 + rand() * 5, hue: rand() > 0.7 ? "red" : "neon",
      });
    }
    return out;
  }, []);

  const shurikens = useMemo(() => [
    { top: 12, left: 8, size: 220, delay: 0, duration: 60, opacity: 0.05 },
    { top: 65, left: 78, size: 180, delay: -15, duration: 80, opacity: 0.04 },
    { top: 30, left: 55, size: 140, delay: -30, duration: 50, opacity: 0.035 },
    { top: 80, left: 18, size: 260, delay: -45, duration: 95, opacity: 0.04 },
    { top: 45, left: 92, size: 120, delay: -10, duration: 70, opacity: 0.05 },
  ], []);

  return (
    <>
      {shurikens.map((s, idx) => (
        <div
          key={idx}
          className="absolute studio-shuriken"
          style={{
            top: `${s.top}%`, left: `${s.left}%`,
            width: `${s.size}px`, height: `${s.size}px`,
            opacity: s.opacity,
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        >
          <ShurikenSvg />
        </div>
      ))}
      {stars.map((s, idx) => (
        <span
          key={idx}
          className="absolute rounded-full studio-twinkle"
          style={{
            top: `${s.top}%`, left: `${s.left}%`,
            width: `${s.size}px`, height: `${s.size}px`,
            background: s.hue === "red"
              ? "hsl(0 78% 60% / 0.7)" : "hsl(195 100% 65% / 0.7)",
            boxShadow: s.hue === "red"
              ? "0 0 6px hsl(0 78% 55% / 0.6)" : "0 0 6px hsl(195 100% 60% / 0.55)",
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </>
  );
}

function ShurikenSvg() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full"
      fill="hsl(0 78% 48%)" stroke="hsl(0 78% 55%)" strokeWidth="0.5">
      <path d="M50 5 L58 42 L95 50 L58 58 L50 95 L42 58 L5 50 L42 42 Z" />
      <circle cx="50" cy="50" r="4" fill="hsl(0 0% 5%)" />
    </svg>
  );
}

// ── Sparks (Demon Truck Garage) ──────────────────────────────────────────────

function SparksLayer() {
  const sparks = useMemo(() => {
    let seed = 2401;
    const rand = () => { seed = (seed * 6971 + 31337) % 196613; return seed / 196613; };
    return Array.from({ length: 28 }, () => ({
      left: rand() * 100,
      baseDelay: rand() * 4,
      duration: 1.5 + rand() * 3,
      size: 1.5 + rand() * 3,
      hue: rand() > 0.5 ? "orange" : "amber",
      drift: (rand() - 0.5) * 40,
    }));
  }, []);

  return (
    <>
      {sparks.map((s, i) => (
        <div
          key={i}
          className="absolute bottom-0 rounded-full studio-spark"
          style={{
            left: `${s.left}%`,
            width: `${s.size}px`,
            height: `${s.size * 4}px`,
            background: s.hue === "orange"
              ? "linear-gradient(to top, hsl(20 90% 55% / 0.9), hsl(35 90% 70% / 0.5) 50%, transparent)"
              : "linear-gradient(to top, hsl(40 90% 65% / 0.9), hsl(50 90% 80% / 0.4) 50%, transparent)",
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.baseDelay}s`,
            ["--spark-drift" as string]: `${s.drift}px`,
          }}
        />
      ))}
      {/* Glow pool at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 100%, hsl(20 90% 40% / 0.06) 0%, transparent 70%)" }}
      />
    </>
  );
}

// ── Rain (Neon Rooftop) ──────────────────────────────────────────────────────

function RainLayer() {
  const drops = useMemo(() => {
    let seed = 8811;
    const rand = () => { seed = (seed * 4421 + 17783) % 131071; return seed / 131071; };
    return Array.from({ length: 60 }, () => ({
      left: rand() * 102 - 1,
      delay: rand() * 2,
      duration: 0.4 + rand() * 0.6,
      height: 10 + rand() * 20,
      opacity: 0.2 + rand() * 0.5,
      hue: rand() > 0.6 ? "cyan" : "magenta",
    }));
  }, []);

  return (
    <>
      {drops.map((d, i) => (
        <div
          key={i}
          className="absolute top-0 studio-rain-drop"
          style={{
            left: `${d.left}%`,
            width: "1px",
            height: `${d.height}px`,
            background: d.hue === "cyan"
              ? "linear-gradient(to bottom, transparent, hsl(185 100% 60% / 0.8), transparent)"
              : "linear-gradient(to bottom, transparent, hsl(300 90% 60% / 0.6), transparent)",
            opacity: d.opacity,
            transform: "rotate(-8deg)",
            animationDuration: `${d.duration}s`,
            animationDelay: `${d.delay}s`,
          }}
        />
      ))}
      {/* City glow from below */}
      <div className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 30% 100%, hsl(300 90% 40% / 0.08) 0%, transparent 55%), radial-gradient(ellipse at 70% 100%, hsl(185 100% 40% / 0.07) 0%, transparent 55%)" }}
      />
    </>
  );
}

// ── Smoke (Lo-Fi Smoke Room) ─────────────────────────────────────────────────

function SmokeLayer() {
  const blobs = useMemo(() => {
    let seed = 3309;
    const rand = () => { seed = (seed * 5501 + 22229) % 161803; return seed / 161803; };
    return Array.from({ length: 8 }, (_, i) => ({
      left: 5 + rand() * 85,
      top: 10 + rand() * 70,
      size: 120 + rand() * 180,
      delay: i * -5 + rand() * -10,
      duration: 14 + rand() * 12,
      opacity: 0.04 + rand() * 0.05,
    }));
  }, []);

  return (
    <>
      {blobs.map((b, i) => (
        <div
          key={i}
          className="absolute rounded-full studio-smoke-drift blur-[40px]"
          style={{
            left: `${b.left}%`,
            top: `${b.top}%`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            background: "hsl(30 60% 50%)",
            opacity: b.opacity,
            animationDuration: `${b.duration}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
      {/* Amber lamp glow */}
      <div className="absolute top-0 left-0 right-0 h-64 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 20% 0%, hsl(40 80% 50% / 0.05) 0%, transparent 60%)" }}
      />
    </>
  );
}

// ── Circuit (Cyber Temple) ───────────────────────────────────────────────────

function CircuitLayer() {
  const nodes = useMemo(() => {
    let seed = 5577;
    const rand = () => { seed = (seed * 7723 + 40231) % 199999; return seed / 199999; };
    return Array.from({ length: 12 }, () => ({
      cx: 5 + rand() * 90,
      cy: 5 + rand() * 90,
      r: 2 + rand() * 4,
      delay: rand() * 4,
      duration: 2 + rand() * 3,
      gold: rand() > 0.5,
    }));
  }, []);

  return (
    <>
      {/* Grid overlay */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(hsl(270 80% 58% / 0.05) 1px, transparent 1px), linear-gradient(90deg, hsl(270 80% 58% / 0.05) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Pulsing node dots */}
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        {nodes.map((n, i) => (
          <circle
            key={i}
            cx={`${n.cx}%`}
            cy={`${n.cy}%`}
            r={n.r}
            fill={n.gold ? "hsl(48 90% 58%)" : "hsl(270 80% 65%)"}
            opacity={0.4}
            className="studio-circuit-node"
            style={{
              animationDuration: `${n.duration}s`,
              animationDelay: `${n.delay}s`,
            }}
          />
        ))}
        {/* A few horizontal trace lines */}
        {[20, 45, 68, 82].map((y, i) => (
          <line
            key={i}
            x1="0%" y1={`${y}%`} x2="100%" y2={`${y}%`}
            stroke={i % 2 === 0 ? "hsl(270 80% 58%)" : "hsl(48 90% 50%)"}
            strokeWidth="0.5"
            strokeOpacity="0.1"
          />
        ))}
        {[15, 38, 61, 79].map((x, i) => (
          <line
            key={i}
            x1={`${x}%`} y1="0%" x2={`${x}%`} y2="100%"
            stroke="hsl(270 80% 58%)"
            strokeWidth="0.5"
            strokeOpacity="0.07"
          />
        ))}
      </svg>
      {/* Purple / gold glow corners */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 0% 0%, hsl(270 80% 40% / 0.08) 0%, transparent 50%), radial-gradient(ellipse at 100% 100%, hsl(48 90% 40% / 0.07) 0%, transparent 45%)" }}
      />
    </>
  );
}

// ── Scanline (Arcade Alley) ──────────────────────────────────────────────────

function ScanlineLayer() {
  const pixels = useMemo(() => {
    let seed = 9932;
    const rand = () => { seed = (seed * 6267 + 28657) % 196418; return seed / 196418; };
    return Array.from({ length: 20 }, () => ({
      left: rand() * 98,
      top: rand() * 95,
      size: 3 + Math.floor(rand() * 3) * 3,
      delay: rand() * 6,
      duration: 0.8 + rand() * 1.5,
      yellow: rand() > 0.6,
    }));
  }, []);

  return (
    <>
      {/* CRT scanlines */}
      <div
        className="absolute inset-0 studio-scanline-overlay"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, hsl(120 100% 48% / 0.035) 4px)",
        }}
      />
      {/* Pixel glitches */}
      {pixels.map((p, i) => (
        <div
          key={i}
          className="absolute studio-pixel-blink"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.yellow ? "hsl(60 100% 55%)" : "hsl(120 100% 48%)",
            opacity: 0,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
      {/* Screen vignette */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 60%, hsl(0 0% 0% / 0.4) 100%)" }}
      />
      {/* Flicker band */}
      <div className="absolute inset-0 studio-crt-flicker pointer-events-none" />
    </>
  );
}
