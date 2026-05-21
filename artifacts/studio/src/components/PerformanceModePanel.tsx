import { useEffect, useState } from "react";
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

function GamepadMappingPanel({
  mappings,
  onUpdate,
}: {
  mappings: GamepadMapping[];
  onUpdate: (m: GamepadMapping[]) => void;
}) {
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

  const BTN_LABELS: Record<number, string> = {
    0: "A/Cross", 1: "B/Circle", 2: "X/Square", 3: "Y/Tri",
    4: "LB/L1", 5: "RB/R1", 6: "LT/L2", 7: "RT/R2",
    12: "D-Up", 13: "D-Down", 14: "D-Left", 15: "D-Right",
  };

  return (
    <div className="space-y-1">
      {mappings.map((m, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground w-16 shrink-0">
            {BTN_LABELS[m.buttonIndex] ?? `Btn ${m.buttonIndex}`}
          </span>
          <select
            value={m.note}
            onChange={(e) => {
              const next = mappings.map((x, j) =>
                j === i ? { ...x, note: Number(e.target.value) } : x,
              );
              onUpdate(next);
            }}
            className="flex-1 bg-background border border-border rounded px-1 h-6 font-mono text-[10px]"
          >
            {DRUM_NOTES.map(({ note, label }) => (
              <option key={note} value={note}>
                {note} — {label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button
        onClick={() => onUpdate([...DEFAULT_GAMEPAD_MAPPINGS])}
        className="mt-1 text-[10px] font-mono text-muted-foreground hover:text-foreground border border-border px-2 py-0.5 rounded"
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
