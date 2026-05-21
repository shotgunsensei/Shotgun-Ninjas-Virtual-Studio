import { useEffect, useRef, useState } from "react";
import { Gamepad2, Keyboard, Music, Mic2, X, ChevronDown } from "lucide-react";
import { useStore, getStore } from "../store";
import { useGamepad } from "../lib/performance/gamepad";
import { performanceRouter, DEFAULT_GAMEPAD_MAPPINGS } from "../lib/performance/router";
import { SCALE_LABELS, NOTE_NAMES } from "../lib/performance/scaleUtils";
import { CHORD_LABELS } from "../lib/performance/scaleUtils";
import { BASSLINE_PATTERN_LABELS } from "../lib/performance/bassline";
import type {
  InputSource,
  ScaleId,
  ChordType,
  BasslinePatternId,
  GamepadMapping,
  PerformanceSettings,
} from "../types";

const DEFAULT_PERF: PerformanceSettings = {
  open: false,
  inputSource: "midi",
  scaleLock: false,
  scaleRoot: 0,
  scaleId: "major",
  chordMode: false,
  chordType: "major_triad",
  basslineMode: false,
  basslinePatternId: "quarters",
  gamepadMappings: [...DEFAULT_GAMEPAD_MAPPINGS],
};

function getPerf(settings: PerformanceSettings | undefined): PerformanceSettings {
  return { ...DEFAULT_PERF, ...(settings ?? {}) };
}

export function PerformanceModePanel() {
  const rawPerf = useStore((s) => s.project.performance);
  const perf = getPerf(rawPerf);
  const tracks = useStore((s) => s.project.tracks);
  const gamepad = useGamepad();

  const patch = (delta: Partial<PerformanceSettings>) => {
    const next = { ...getPerf(getStore().state.project.performance), ...delta };
    getStore().patchProject({ performance: next });
    // Sync router config
    performanceRouter.configure({
      active: next.open,
      inputSource: next.inputSource,
      scaleLock: next.scaleLock,
      scaleRoot: next.scaleRoot,
      scaleId: next.scaleId,
      chordMode: next.chordMode,
      chordType: next.chordType,
      gamepadMappings: next.gamepadMappings ?? DEFAULT_GAMEPAD_MAPPINGS,
    });
  };

  // Keep router in sync with persisted settings on mount
  useEffect(() => {
    const p = getPerf(getStore().state.project.performance);
    performanceRouter.configure({
      active: p.open,
      inputSource: p.inputSource,
      scaleLock: p.scaleLock,
      scaleRoot: p.scaleRoot,
      scaleId: p.scaleId,
      chordMode: p.chordMode,
      chordType: p.chordType,
      gamepadMappings: p.gamepadMappings ?? DEFAULT_GAMEPAD_MAPPINGS,
    });
  }, []);

  if (!perf.open) return null;

  const INPUT_SOURCES: { id: InputSource; label: string; icon: React.ReactNode }[] = [
    { id: "midi", label: "MIDI", icon: <Music className="w-3.5 h-3.5" /> },
    { id: "keyboard", label: "QWERTY", icon: <Keyboard className="w-3.5 h-3.5" /> },
    { id: "gamepad", label: "Gamepad", icon: <Gamepad2 className="w-3.5 h-3.5" /> },
    { id: "gamepad", label: "Touch Pads", icon: <Mic2 className="w-3.5 h-3.5" /> },
  ];

  const melodicTracks = tracks.filter((t) =>
    t.kind === "piano" || t.kind === "guitar" || t.kind === "bass",
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-graphite border border-border rounded-t-xl sm:rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-graphite/90">
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs uppercase tracking-widest text-foreground font-semibold">
              Performance Mode
            </span>
          </div>
          <button
            onClick={() => patch({ open: false })}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close Performance Mode"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto max-h-[80vh]">
          {/* Input Source */}
          <Section title="Input Source">
            <div className="grid grid-cols-4 gap-2">
              {(["midi", "keyboard", "gamepad"] as InputSource[]).map((src) => {
                const icons = {
                  midi: <Music className="w-3.5 h-3.5" />,
                  keyboard: <Keyboard className="w-3.5 h-3.5" />,
                  gamepad: <Gamepad2 className="w-3.5 h-3.5" />,
                };
                const labels = {
                  midi: "MIDI",
                  keyboard: "QWERTY",
                  gamepad: "Gamepad",
                };
                const active = perf.inputSource === src;
                return (
                  <button
                    key={src}
                    onClick={() => patch({ inputSource: src })}
                    className={`flex flex-col items-center gap-1 py-2 px-3 rounded-md border text-xs font-mono transition-colors ${
                      active
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border hover:border-primary/40 text-muted-foreground"
                    }`}
                  >
                    {icons[src]}
                    {labels[src]}
                  </button>
                );
              })}
              {/* Touch Pads is a separate view, not an input source */}
              <a
                href="#pad-screen"
                onClick={(e) => {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent("studio:open-pad-screen"));
                }}
                className="flex flex-col items-center gap-1 py-2 px-3 rounded-md border border-border hover:border-primary/40 text-muted-foreground text-xs font-mono transition-colors cursor-pointer"
              >
                <Mic2 className="w-3.5 h-3.5" />
                Pad Screen
              </a>
            </div>

            {/* Gamepad status */}
            {perf.inputSource === "gamepad" && (
              <div
                className={`mt-2 text-[10px] font-mono px-2 py-1 rounded border ${
                  gamepad.connected
                    ? "border-neon/50 text-neon bg-neon/10"
                    : "border-border text-muted-foreground"
                }`}
              >
                {gamepad.connected
                  ? `Controller: ${gamepad.id.slice(0, 40)}${gamepad.id.length > 40 ? "…" : ""}`
                  : "No controller detected — connect a gamepad and press any button"}
              </div>
            )}

            {/* Keyboard octave display */}
            {perf.inputSource === "keyboard" && (
              <div className="mt-2 text-[10px] font-mono text-muted-foreground">
                Z–M = lower octave whites · Q–U = upper octave whites · 1/8 shift octave
              </div>
            )}
          </Section>

          {/* Scale Lock */}
          <Section title="Scale Lock">
            <div className="flex items-center gap-3 mb-3">
              <ToggleBtn
                active={perf.scaleLock}
                onToggle={() => patch({ scaleLock: !perf.scaleLock })}
                label={perf.scaleLock ? "On" : "Off"}
              />
              {perf.scaleLock && (
                <span className="text-[10px] font-mono text-primary animate-pulse">
                  Notes quantized to scale
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1 block">
                  Root
                </label>
                <select
                  value={perf.scaleRoot}
                  onChange={(e) => patch({ scaleRoot: Number(e.target.value) })}
                  className="w-full bg-background border border-border rounded px-2 h-7 font-mono text-xs"
                >
                  {NOTE_NAMES.map((name, i) => (
                    <option key={i} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1 block">
                  Scale
                </label>
                <select
                  value={perf.scaleId}
                  onChange={(e) => patch({ scaleId: e.target.value as ScaleId })}
                  className="w-full bg-background border border-border rounded px-2 h-7 font-mono text-xs"
                >
                  {(Object.keys(SCALE_LABELS) as ScaleId[]).map((id) => (
                    <option key={id} value={id}>
                      {SCALE_LABELS[id]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Section>

          {/* Chord Mode */}
          <Section title="Chord Mode">
            <div className="flex items-center gap-3 mb-3">
              <ToggleBtn
                active={perf.chordMode}
                onToggle={() => patch({ chordMode: !perf.chordMode })}
                label={perf.chordMode ? "On" : "Off"}
              />
              {perf.chordMode && (
                <span className="text-[10px] font-mono text-primary animate-pulse">
                  One note → full chord
                </span>
              )}
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1 block">
                Chord Type
              </label>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(CHORD_LABELS) as ChordType[]).filter((c) => c !== "none").map((ct) => (
                  <button
                    key={ct}
                    onClick={() => patch({ chordType: ct })}
                    className={`px-2 py-0.5 rounded border font-mono text-[10px] transition-colors ${
                      perf.chordType === ct
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {CHORD_LABELS[ct]}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          {/* One-Finger Bassline */}
          <Section title="One-Finger Bassline">
            <div className="flex items-center gap-3 mb-3">
              <ToggleBtn
                active={perf.basslineMode}
                onToggle={() => patch({ basslineMode: !perf.basslineMode })}
                label={perf.basslineMode ? "On" : "Off"}
              />
              {perf.basslineMode && (
                <span className="text-[10px] font-mono text-primary animate-pulse">
                  Note triggers rhythmic pattern
                </span>
              )}
            </div>
            {melodicTracks.length === 0 && (
              <p className="text-[10px] font-mono text-muted-foreground">
                No bass/melodic track found in project.
              </p>
            )}
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1 block">
                Pattern
              </label>
              <div className="flex gap-1">
                {(Object.keys(BASSLINE_PATTERN_LABELS) as BasslinePatternId[]).map((pid) => (
                  <button
                    key={pid}
                    onClick={() => patch({ basslinePatternId: pid })}
                    className={`flex-1 px-2 py-1 rounded border font-mono text-[10px] transition-colors ${
                      perf.basslinePatternId === pid
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {BASSLINE_PATTERN_LABELS[pid]}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          {/* Gamepad Mapping Panel */}
          {perf.inputSource === "gamepad" && (
            <Section title="Controller Mappings">
              <GamepadMappingPanel
                mappings={perf.gamepadMappings ?? DEFAULT_GAMEPAD_MAPPINGS}
                onUpdate={(m) => patch({ gamepadMappings: m })}
              />
            </Section>
          )}

          {/* Live Notes Playing Indicator */}
          <LiveNotesIndicator />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel-inset rounded-md p-3 space-y-2">
      <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function ToggleBtn({
  active,
  onToggle,
  label,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`px-3 py-1 rounded border font-mono text-xs transition-colors ${
        active
          ? "border-primary bg-primary/20 text-primary"
          : "border-border text-muted-foreground hover:border-primary/40"
      }`}
    >
      {label}
    </button>
  );
}

const DRUM_NOTES: { note: number; label: string }[] = [
  { note: 36, label: "Kick" },
  { note: 38, label: "Snare" },
  { note: 42, label: "Hi-Hat" },
  { note: 46, label: "Open Hat" },
  { note: 39, label: "Clap" },
  { note: 49, label: "Crash" },
  { note: 41, label: "Tom Lo" },
  { note: 43, label: "Tom Hi" },
  { note: 48, label: "FX" },
  { note: 45, label: "Tom Mid" },
  { note: 60, label: "C4" },
  { note: 62, label: "D4" },
  { note: 64, label: "E4" },
  { note: 65, label: "F4" },
  { note: 67, label: "G4" },
  { note: 69, label: "A4" },
];

interface BtnLayout {
  index: number;
  shortLabel: string;
  x: number;
  y: number;
}

const BUTTON_LAYOUT: BtnLayout[] = [
  { index: 6,  shortLabel: "LT",  x: 14.5, y: 7   },
  { index: 7,  shortLabel: "RT",  x: 85.5, y: 7   },
  { index: 4,  shortLabel: "LB",  x: 19,   y: 21  },
  { index: 5,  shortLabel: "RB",  x: 81,   y: 21  },
  { index: 14, shortLabel: "◄",   x: 20.5, y: 50  },
  { index: 12, shortLabel: "▲",   x: 29,   y: 40  },
  { index: 13, shortLabel: "▼",   x: 29,   y: 60  },
  { index: 15, shortLabel: "►",   x: 37.5, y: 50  },
  { index: 3,  shortLabel: "Y",   x: 68,   y: 33  },
  { index: 2,  shortLabel: "X",   x: 59.5, y: 44  },
  { index: 1,  shortLabel: "B",   x: 76.5, y: 44  },
  { index: 0,  shortLabel: "A",   x: 68,   y: 55  },
];

function GamepadDiagram({
  mappings,
  selectedBtn,
  onSelectBtn,
}: {
  mappings: GamepadMapping[];
  selectedBtn: number | null;
  onSelectBtn: (idx: number) => void;
}) {
  const noteLabel = (btnIndex: number) => {
    const m = mappings.find((x) => x.buttonIndex === btnIndex);
    if (!m) return "—";
    const dn = DRUM_NOTES.find((d) => d.note === m.note);
    return dn ? dn.label : `n${m.note}`;
  };

  return (
    <svg
      viewBox="0 0 400 230"
      className="w-full"
      style={{ maxHeight: 200 }}
      aria-label="Gamepad controller diagram"
    >
      {/* Controller body */}
      <rect x="55" y="35" width="290" height="145" rx="32" ry="32"
        fill="#1a1a2e" stroke="#334155" strokeWidth="2" />
      {/* Left grip */}
      <ellipse cx="105" cy="178" rx="48" ry="42"
        fill="#1a1a2e" stroke="#334155" strokeWidth="2" />
      {/* Right grip */}
      <ellipse cx="295" cy="178" rx="48" ry="42"
        fill="#1a1a2e" stroke="#334155" strokeWidth="2" />
      {/* Top notch / camera bump */}
      <rect x="160" y="30" width="80" height="22" rx="11"
        fill="#1a1a2e" stroke="#334155" strokeWidth="2" />

      {/* Center stripe */}
      <rect x="168" y="90" width="64" height="30" rx="8"
        fill="#0f172a" stroke="#334155" strokeWidth="1" opacity="0.7" />
      {/* Select / Start dots */}
      <circle cx="183" cy="105" r="5" fill="#334155" />
      <circle cx="217" cy="105" r="5" fill="#334155" />

      {/* D-pad cross shape */}
      <rect x="99" y="130" width="14" height="42" rx="3" fill="#0f172a" stroke="#334155" strokeWidth="1" />
      <rect x="85" y="144" width="42" height="14" rx="3" fill="#0f172a" stroke="#334155" strokeWidth="1" />

      {/* Face button cluster background */}
      <circle cx="272" cy="113" r="28" fill="#0f172a" stroke="#334155" strokeWidth="1" opacity="0.6" />

      {/* Now draw interactive button hotspots */}
      {BUTTON_LAYOUT.map((btn) => {
        const cx = (btn.x / 100) * 400;
        const cy = (btn.y / 100) * 230;
        const isSelected = selectedBtn === btn.index;
        const isShoulder = btn.index === 4 || btn.index === 5;
        const isTrigger = btn.index === 6 || btn.index === 7;
        const isDpad = [12, 13, 14, 15].includes(btn.index);
        const isFace = [0, 1, 2, 3].includes(btn.index);

        const faceColors: Record<number, string> = {
          0: "#22c55e",
          1: "#ef4444",
          2: "#3b82f6",
          3: "#eab308",
        };
        const fillColor = isSelected
          ? "#a855f7"
          : isFace
            ? faceColors[btn.index] + "44"
            : "#1e293b";
        const strokeColor = isSelected
          ? "#d946ef"
          : isFace
            ? faceColors[btn.index]
            : isDpad
              ? "#64748b"
              : "#475569";

        const rx = isTrigger ? 10 : isShoulder ? 9 : 8;
        const ry = isTrigger ? 6 : isShoulder ? 5.5 : 8;
        const label = noteLabel(btn.index);
        const truncated = label.length > 5 ? label.slice(0, 5) : label;

        return (
          <g
            key={btn.index}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectBtn(btn.index)}
            role="button"
            aria-label={`${btn.shortLabel}: ${label}`}
          >
            <ellipse
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={isSelected ? 1.5 : 1}
            />
            {/* Short button label (LT, RB, etc.) */}
            <text
              x={cx}
              y={cy - ry - 2}
              textAnchor="middle"
              fontSize="6"
              fill="#94a3b8"
              fontFamily="monospace"
            >
              {btn.shortLabel}
            </text>
            {/* Mapped sound label */}
            <text
              x={cx}
              y={cy + 1.5}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="5.5"
              fill={isSelected ? "#f0abfc" : "#e2e8f0"}
              fontFamily="monospace"
              fontWeight="600"
            >
              {truncated}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function GamepadMappingPanel({
  mappings,
  onUpdate,
}: {
  mappings: GamepadMapping[];
  onUpdate: (m: GamepadMapping[]) => void;
}) {
  const [selectedBtn, setSelectedBtn] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setSelectedBtn(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedMapping = selectedBtn !== null
    ? mappings.find((m) => m.buttonIndex === selectedBtn)
    : null;

  const BTN_FULL_LABELS: Record<number, string> = {
    0: "A / Cross", 1: "B / Circle", 2: "X / Square", 3: "Y / Triangle",
    4: "LB / L1", 5: "RB / R1", 6: "LT / L2", 7: "RT / R2",
    12: "D-Pad Up", 13: "D-Pad Down", 14: "D-Pad Left", 15: "D-Pad Right",
  };

  const handleSelectBtn = (idx: number) => {
    setSelectedBtn((prev) => (prev === idx ? null : idx));
  };

  const handleNoteChange = (note: number) => {
    const dn = DRUM_NOTES.find((d) => d.note === note);
    const next = mappings.map((x) =>
      x.buttonIndex === selectedBtn
        ? { ...x, note, label: `${BTN_FULL_LABELS[x.buttonIndex] ?? `Btn ${x.buttonIndex}`} → ${dn?.label ?? note}` }
        : x,
    );
    onUpdate(next);
  };

  return (
    <div className="space-y-2" ref={pickerRef}>
      <p className="text-[10px] font-mono text-muted-foreground">
        Click a button to reassign its sound.
      </p>

      <GamepadDiagram
        mappings={mappings}
        selectedBtn={selectedBtn}
        onSelectBtn={handleSelectBtn}
      />

      {selectedBtn !== null && (
        <div className="mt-1 p-2 bg-background border border-primary/40 rounded-md space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
          <p className="text-[10px] font-mono text-primary font-semibold">
            {BTN_FULL_LABELS[selectedBtn] ?? `Button ${selectedBtn}`}
          </p>
          <select
            autoFocus
            value={selectedMapping?.note ?? 36}
            onChange={(e) => handleNoteChange(Number(e.target.value))}
            className="w-full bg-background border border-border rounded px-2 h-7 font-mono text-xs"
          >
            {DRUM_NOTES.map(({ note, label }) => (
              <option key={note} value={note}>
                {label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setSelectedBtn(null)}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
          >
            Done
          </button>
        </div>
      )}

      <button
        onClick={() => { onUpdate([...DEFAULT_GAMEPAD_MAPPINGS]); setSelectedBtn(null); }}
        className="text-[10px] font-mono text-muted-foreground hover:text-foreground border border-border px-2 py-0.5 rounded"
      >
        Reset to defaults
      </button>
    </div>
  );
}

function LiveNotesIndicator() {
  const [activeNotes, setActiveNotes] = useState<number[]>([]);

  useEffect(() => {
    const unsub = performanceRouter.onNote((e) => {
      if (e.type === "noteon") {
        setActiveNotes((prev) => [...new Set([...prev, e.note])]);
        window.setTimeout(() => {
          setActiveNotes((prev) => prev.filter((n) => n !== e.note));
        }, 400);
      } else {
        setActiveNotes((prev) => prev.filter((n) => n !== e.note));
      }
    });
    return () => { unsub(); };
  }, []);

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
        Live Notes
      </span>
      <div className="flex gap-1 flex-wrap">
        {activeNotes.length === 0 ? (
          <span className="font-mono text-[10px] text-muted-foreground">—</span>
        ) : (
          activeNotes.map((n) => (
            <span
              key={n}
              className="font-mono text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded border border-primary/40 animate-pulse"
            >
              {NOTE_NAMES[n % 12]}{Math.floor(n / 12) - 1}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
