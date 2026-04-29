import { useMemo } from "react";

/**
 * Atmospheric backdrop layer: drifting shuriken silhouettes plus twinkling
 * neon points behind the studio chrome. The whole thing is fixed-position,
 * `pointer-events: none`, and lives behind everything via negative z-index.
 *
 * Animations are gated on `prefers-reduced-motion: no-preference` in the
 * stylesheet so users with motion sensitivity get a clean static backdrop.
 */
export function BackgroundFx() {
  // Pre-computed positions/durations so the random layout is stable across
  // re-renders (otherwise stars would jump every render).
  const stars = useMemo(() => {
    const out: Array<{
      top: number;
      left: number;
      size: number;
      delay: number;
      duration: number;
      hue: "red" | "neon";
    }> = [];
    // Use a seeded PRNG so the visual stays consistent between hot reloads
    let seed = 1337;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 60; i++) {
      out.push({
        top: rand() * 100,
        left: rand() * 100,
        size: 1.5 + rand() * 2.5,
        delay: rand() * 6,
        duration: 3 + rand() * 5,
        hue: rand() > 0.7 ? "red" : "neon",
      });
    }
    return out;
  }, []);

  const shurikens = useMemo(
    () => [
      { top: 12, left: 8, size: 220, delay: 0, duration: 60, opacity: 0.05 },
      { top: 65, left: 78, size: 180, delay: -15, duration: 80, opacity: 0.04 },
      { top: 30, left: 55, size: 140, delay: -30, duration: 50, opacity: 0.035 },
      { top: 80, left: 18, size: 260, delay: -45, duration: 95, opacity: 0.04 },
      { top: 45, left: 92, size: 120, delay: -10, duration: 70, opacity: 0.05 },
    ],
    [],
  );

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Shuriken silhouettes — slow rotate + drift */}
      {shurikens.map((s, idx) => (
        <div
          key={idx}
          className="absolute studio-shuriken"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            opacity: s.opacity,
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        >
          <ShurikenSvg />
        </div>
      ))}

      {/* Twinkling neon/red points */}
      {stars.map((s, idx) => (
        <span
          key={idx}
          className="absolute rounded-full studio-twinkle"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            background:
              s.hue === "red"
                ? "hsl(0 78% 60% / 0.7)"
                : "hsl(195 100% 65% / 0.7)",
            boxShadow:
              s.hue === "red"
                ? "0 0 6px hsl(0 78% 55% / 0.6)"
                : "0 0 6px hsl(195 100% 60% / 0.55)",
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

function ShurikenSvg() {
  // Four-pointed shuriken silhouette
  return (
    <svg
      viewBox="0 0 100 100"
      className="w-full h-full"
      fill="hsl(0 78% 48%)"
      stroke="hsl(0 78% 55%)"
      strokeWidth="0.5"
    >
      <path d="M50 5 L58 42 L95 50 L58 58 L50 95 L42 58 L5 50 L42 42 Z" />
      <circle cx="50" cy="50" r="4" fill="hsl(0 0% 5%)" />
    </svg>
  );
}
