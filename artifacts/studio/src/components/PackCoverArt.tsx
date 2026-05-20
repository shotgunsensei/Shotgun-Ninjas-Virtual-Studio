import type { CoverArtConfig } from "../lib/audio/sounds/soundLibrary";

interface Props {
  art: CoverArtConfig;
  size?: number;
  className?: string;
}

/**
 * Procedural CSS/SVG cover art — no external image files.
 * Each theme renders a unique visual identity for its pack.
 */
export function PackCoverArt({ art, size = 120, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={className}
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* Background */}
      <rect width="120" height="120" fill={art.bg} />
      {renderTheme(art)}
    </svg>
  );
}

function renderTheme(art: CoverArtConfig) {
  switch (art.theme) {
    case "ninja-shuriken":
      return <NinjaShuriken accent={art.accent} accent2={art.accent2} />;
    case "demon-truck":
      return <DemonTruck accent={art.accent} accent2={art.accent2} />;
    case "smoke-room":
      return <SmokeRoom accent={art.accent} accent2={art.accent2} />;
    case "neon-dojo":
      return <NeonDojo accent={art.accent} accent2={art.accent2} />;
    case "trailer":
      return <Trailer accent={art.accent} accent2={art.accent2} />;
    case "garage":
      return <Garage accent={art.accent} accent2={art.accent2} />;
    case "dirt":
      return <Dirt accent={art.accent} accent2={art.accent2} />;
    case "cyber":
      return <Cyber accent={art.accent} accent2={art.accent2} />;
    case "arcade":
      return <Arcade accent={art.accent} accent2={art.accent2} />;
  }
}

/* ── Theme: Ninja Shuriken ─────────────────────────────────── */
function NinjaShuriken({ accent, accent2 }: { accent: string; accent2: string }) {
  return (
    <g>
      {/* Radial glow */}
      <radialGradient id="sn-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor={accent} stopOpacity="0.25" />
        <stop offset="100%" stopColor={accent} stopOpacity="0" />
      </radialGradient>
      <circle cx="60" cy="60" r="55" fill="url(#sn-glow)" />
      {/* Shuriken blades */}
      {[0, 90, 180, 270].map((deg) => (
        <g key={deg} transform={`rotate(${deg} 60 60)`}>
          <polygon points="60,20 68,52 60,60 52,52" fill={accent} opacity="0.9" />
        </g>
      ))}
      {/* Center ring */}
      <circle cx="60" cy="60" r="10" fill={accent2} />
      <circle cx="60" cy="60" r="5" fill="#000" />
      {/* Thin speed lines */}
      {[-30, 30, 90, 150].map((deg) => (
        <line
          key={deg}
          x1="60" y1="60"
          x2={60 + 48 * Math.cos((deg * Math.PI) / 180)}
          y2={60 + 48 * Math.sin((deg * Math.PI) / 180)}
          stroke={accent}
          strokeWidth="0.5"
          opacity="0.3"
        />
      ))}
    </g>
  );
}

/* ── Theme: Demon Truck ────────────────────────────────────── */
function DemonTruck({ accent, accent2 }: { accent: string; accent2: string }) {
  return (
    <g>
      {/* Sub-wave rings */}
      {[30, 45, 58, 70].map((r, i) => (
        <circle
          key={r}
          cx="60" cy="80"
          r={r}
          fill="none"
          stroke={i === 0 ? accent : accent2}
          strokeWidth={i === 0 ? 2 : 0.75}
          opacity={1 - i * 0.2}
        />
      ))}
      {/* 808 number */}
      <text
        x="60" y="55"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="monospace"
        fontSize="26"
        fontWeight="bold"
        fill={accent}
        letterSpacing="2"
      >
        808
      </text>
      {/* Ground bar */}
      <rect x="20" y="82" width="80" height="3" rx="1" fill={accent} opacity="0.8" />
      {/* Flame streaks */}
      {[25, 45, 65, 85, 95].map((x, i) => (
        <line
          key={x}
          x1={x} y1="110"
          x2={x + (i % 2 === 0 ? -4 : 4)} y2="88"
          stroke={i % 2 === 0 ? accent : accent2}
          strokeWidth={i % 3 === 0 ? 1.5 : 0.8}
          opacity="0.6"
        />
      ))}
    </g>
  );
}

/* ── Theme: Smoke Room ─────────────────────────────────────── */
function SmokeRoom({ accent, accent2 }: { accent: string; accent2: string }) {
  return (
    <g>
      {/* Vinyl record */}
      <circle cx="60" cy="60" r="44" fill={accent2} opacity="0.3" />
      <circle cx="60" cy="60" r="44" fill="none" stroke={accent2} strokeWidth="1" />
      {/* Grooves */}
      {[38, 32, 26, 20, 14].map((r) => (
        <circle key={r} cx="60" cy="60" r={r} fill="none" stroke={accent} strokeWidth="0.4" opacity="0.4" />
      ))}
      <circle cx="60" cy="60" r="8" fill={accent} opacity="0.7" />
      <circle cx="60" cy="60" r="3" fill="#111" />
      {/* Grain texture dots */}
      {[
        [30,30],[90,40],[20,70],[95,80],[40,100],[75,105],[15,50],[100,55],
        [50,20],[70,15],[35,85],[85,25],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="0.8" fill={accent} opacity="0.25" />
      ))}
      {/* Warm vignette */}
      <radialGradient id="sr-vig" cx="50%" cy="50%" r="50%">
        <stop offset="60%" stopColor={accent2} stopOpacity="0" />
        <stop offset="100%" stopColor={accent2} stopOpacity="0.5" />
      </radialGradient>
      <circle cx="60" cy="60" r="60" fill="url(#sr-vig)" />
    </g>
  );
}

/* ── Theme: Neon Dojo ──────────────────────────────────────── */
function NeonDojo({ accent, accent2 }: { accent: string; accent2: string }) {
  return (
    <g>
      {/* Grid lines */}
      {[20,40,60,80,100].map((v) => (
        <g key={v}>
          <line x1={v} y1="0" x2={v} y2="120" stroke={accent} strokeWidth="0.4" opacity="0.2" />
          <line x1="0" y1={v} x2="120" y2={v} stroke={accent} strokeWidth="0.4" opacity="0.2" />
        </g>
      ))}
      {/* Diamond shape */}
      <polygon
        points="60,18 92,60 60,102 28,60"
        fill="none"
        stroke={accent}
        strokeWidth="2"
        opacity="0.9"
      />
      <polygon
        points="60,30 80,60 60,90 40,60"
        fill={accent}
        opacity="0.15"
        stroke={accent2}
        strokeWidth="1"
      />
      {/* Glowing cross */}
      <line x1="60" y1="30" x2="60" y2="90" stroke={accent} strokeWidth="1.5" opacity="0.8" />
      <line x1="28" y1="60" x2="92" y2="60" stroke={accent} strokeWidth="1.5" opacity="0.8" />
      {/* Center dot */}
      <circle cx="60" cy="60" r="5" fill={accent} />
      <circle cx="60" cy="60" r="2.5" fill={accent2} />
      {/* Corner accents */}
      {[[10,10],[110,10],[10,110],[110,110]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={accent} opacity="0.5" />
      ))}
    </g>
  );
}

/* ── Theme: Trailer ────────────────────────────────────────── */
function Trailer({ accent, accent2 }: { accent: string; accent2: string }) {
  return (
    <g>
      {/* Dark atmosphere */}
      <radialGradient id="tr-atm" cx="50%" cy="30%" r="70%">
        <stop offset="0%" stopColor={accent2} stopOpacity="0.15" />
        <stop offset="100%" stopColor="#000" stopOpacity="0" />
      </radialGradient>
      <rect width="120" height="120" fill="url(#tr-atm)" />
      {/* Impact shockwave lines */}
      {[18, 30, 42, 54].map((r, i) => (
        <circle
          key={r}
          cx="60" cy="60"
          r={r}
          fill="none"
          stroke={i === 0 ? accent : accent2}
          strokeWidth={i === 0 ? 2.5 : 0.8}
          opacity={1 - i * 0.22}
          strokeDasharray={i > 0 ? "4 2" : undefined}
        />
      ))}
      {/* Impact star */}
      {[0, 45, 90, 135].map((deg) => (
        <line
          key={deg}
          x1="60" y1="60"
          x2={60 + 54 * Math.cos((deg * Math.PI) / 180)}
          y2={60 + 54 * Math.sin((deg * Math.PI) / 180)}
          stroke={accent}
          strokeWidth="1.5"
          opacity="0.7"
        />
      ))}
      {/* Solid center */}
      <circle cx="60" cy="60" r="9" fill={accent} />
      <circle cx="60" cy="60" r="4" fill="#111" />
    </g>
  );
}

/* ── Theme: Garage ─────────────────────────────────────────── */
function Garage({ accent, accent2 }: { accent: string; accent2: string }) {
  return (
    <g>
      {/* Rough grain background */}
      {Array.from({ length: 30 }, (_, i) => {
        const x = (i * 37 + 11) % 120;
        const y = (i * 53 + 7) % 120;
        return <circle key={i} cx={x} cy={y} r="1.2" fill={accent2} opacity="0.15" />;
      })}
      {/* Drum stick cross */}
      <line x1="25" y1="95" x2="95" y2="25" stroke={accent} strokeWidth="5" strokeLinecap="round" opacity="0.85" />
      <line x1="25" y1="25" x2="95" y2="95" stroke={accent2} strokeWidth="5" strokeLinecap="round" opacity="0.85" />
      {/* Tip circles */}
      <circle cx="25" cy="25" r="5" fill={accent} />
      <circle cx="95" cy="25" r="5" fill={accent} />
      <circle cx="25" cy="95" r="5" fill={accent2} />
      <circle cx="95" cy="95" r="5" fill={accent2} />
      {/* Center bang */}
      <circle cx="60" cy="60" r="14" fill={accent} opacity="0.3" />
      <circle cx="60" cy="60" r="7" fill={accent} />
      {/* Rough border */}
      <rect x="8" y="8" width="104" height="104" rx="2" fill="none" stroke={accent} strokeWidth="2" opacity="0.4" strokeDasharray="6 3" />
    </g>
  );
}

/* ── Theme: Dirt ───────────────────────────────────────────── */
function Dirt({ accent, accent2 }: { accent: string; accent2: string }) {
  return (
    <g>
      {/* Earthy horizon */}
      <rect x="0" y="72" width="120" height="48" fill={accent2} opacity="0.3" />
      <line x1="0" y1="72" x2="120" y2="72" stroke={accent} strokeWidth="1.5" opacity="0.6" />
      {/* Swamp ripples */}
      {[85, 95, 105].map((y, i) => (
        <ellipse key={y} cx="60" cy={y} rx={30 + i * 8} ry="4" fill="none" stroke={accent} strokeWidth="0.7" opacity={0.4 - i * 0.1} />
      ))}
      {/* Groove wave */}
      <path
        d="M 10 60 Q 35 45 60 60 Q 85 75 110 60"
        fill="none"
        stroke={accent}
        strokeWidth="2.5"
        opacity="0.8"
      />
      <path
        d="M 10 65 Q 35 50 60 65 Q 85 80 110 65"
        fill="none"
        stroke={accent2}
        strokeWidth="1"
        opacity="0.5"
      />
      {/* Sun / moon */}
      <circle cx="60" cy="38" r="16" fill="none" stroke={accent} strokeWidth="2" opacity="0.7" />
      <circle cx="60" cy="38" r="8" fill={accent} opacity="0.5" />
      {/* Dust specks */}
      {[15,28,45,72,88,105].map((x, i) => (
        <circle key={x} cx={x} cy={55 + (i % 3) * 3} r="1" fill={accent2} opacity="0.5" />
      ))}
    </g>
  );
}

/* ── Theme: Cyber ──────────────────────────────────────────── */
function Cyber({ accent, accent2 }: { accent: string; accent2: string }) {
  return (
    <g>
      {/* Circuit grid */}
      {[0, 20, 40, 60, 80, 100, 120].map((v) => (
        <g key={v}>
          <line x1={v} y1="0" x2={v} y2="120" stroke={accent} strokeWidth="0.3" opacity="0.15" />
          <line x1="0" y1={v} x2="120" y2={v} stroke={accent} strokeWidth="0.3" opacity="0.15" />
        </g>
      ))}
      {/* Neon glow lines */}
      <linearGradient id="cy-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={accent} />
        <stop offset="100%" stopColor={accent2} />
      </linearGradient>
      {/* Hex shape */}
      <polygon
        points="60,15 95,37.5 95,82.5 60,105 25,82.5 25,37.5"
        fill="none"
        stroke="url(#cy-grad)"
        strokeWidth="2"
        opacity="0.9"
      />
      <polygon
        points="60,28 82,41 82,79 60,92 38,79 38,41"
        fill={accent}
        opacity="0.08"
        stroke={accent}
        strokeWidth="0.75"
      />
      {/* Data nodes */}
      {[[60,15],[95,37.5],[95,82.5],[60,105],[25,82.5],[25,37.5]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={accent} opacity="0.9" />
      ))}
      {/* Center burst */}
      <circle cx="60" cy="60" r="18" fill={accent} opacity="0.07" />
      <circle cx="60" cy="60" r="6" fill={accent} />
      <circle cx="60" cy="60" r="2" fill="#fff" opacity="0.8" />
    </g>
  );
}

/* ── Theme: Arcade ─────────────────────────────────────────── */
function Arcade({ accent, accent2 }: { accent: string; accent2: string }) {
  return (
    <g>
      {/* Pixel grid background */}
      {Array.from({ length: 6 }, (_, row) =>
        Array.from({ length: 6 }, (_, col) => {
          const on = (row + col) % 2 === 0;
          return on ? (
            <rect
              key={`${row}-${col}`}
              x={col * 20}
              y={row * 20}
              width="20"
              height="20"
              fill={accent}
              opacity="0.05"
            />
          ) : null;
        })
      )}
      {/* Ghost sprite — 8-bit style */}
      {/* Body */}
      <rect x="36" y="30" width="48" height="44" rx="24" fill={accent} opacity="0.85" />
      {/* Bottom scallops */}
      <rect x="36" y="62" width="48" height="12" fill={accent} opacity="0.85" />
      <ellipse cx="44" cy="74" rx="8" ry="8" fill="black" opacity="0.8" />
      <ellipse cx="60" cy="74" rx="8" ry="8" fill="black" opacity="0.8" />
      <ellipse cx="76" cy="74" rx="8" ry="8" fill="black" opacity="0.8" />
      {/* Eyes */}
      <ellipse cx="50" cy="50" rx="8" ry="9" fill="#fff" />
      <ellipse cx="70" cy="50" rx="8" ry="9" fill="#fff" />
      <ellipse cx="52" cy="52" rx="4" ry="5" fill={accent2} />
      <ellipse cx="72" cy="52" rx="4" ry="5" fill={accent2} />
      {/* Pixel sparkles */}
      {[[15,20],[100,30],[110,70],[10,90],[105,100]].map(([x,y],i) => (
        <rect key={i} x={x-2} y={y-2} width="4" height="4" fill={accent} opacity="0.6" />
      ))}
    </g>
  );
}
