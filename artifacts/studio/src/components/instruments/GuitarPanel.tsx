import { useEffect, useRef, useState } from "react";
import { audio } from "../../lib/audio/engine";
import { noteRecorder } from "../../lib/audio/recorder";
import { useMidiEvents, midiNoteToName } from "../../lib/midi/midi";
import { useStore } from "../../store";
import type { Track } from "../../types";

type ChordDef = {
  name: string;
  notes: string[];
  key: string;
};

const CHORDS: ChordDef[] = [
  { name: "Em", key: "1", notes: ["E2", "B2", "E3", "G3", "B3", "E4"] },
  { name: "G", key: "2", notes: ["G2", "B2", "D3", "G3", "B3", "G4"] },
  { name: "D", key: "3", notes: ["D3", "A3", "D4", "F#4"] },
  { name: "A", key: "4", notes: ["A2", "E3", "A3", "C#4", "E4"] },
  { name: "C", key: "5", notes: ["C3", "E3", "G3", "C4", "E4"] },
  { name: "Am", key: "6", notes: ["A2", "E3", "A3", "C4", "E4"] },
  { name: "F", key: "7", notes: ["F2", "C3", "F3", "A3", "C4", "F4"] },
  { name: "Dm", key: "8", notes: ["D3", "A3", "D4", "F4"] },
];

type Direction = "down" | "up";

export function GuitarPanel({ track }: { track: Track }) {
  const isRecording = useStore((s) => s.isRecording);
  const project = useStore((s) => s.project);
  const [direction, setDirection] = useState<Direction>("down");
  const [pluckMode, setPluckMode] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const heldRef = useRef<Map<string, string[]>>(new Map());

  const strum = (chord: ChordDef) => {
    const notes = direction === "down" ? chord.notes : [...chord.notes].reverse();
    setActive(chord.name);
    window.setTimeout(() => setActive((cur) => (cur === chord.name ? null : cur)), 220);
    const stagger = pluckMode ? 0.06 : 0.022; // seconds between strings
    notes.forEach((n, i) => {
      const delayMs = i * stagger * 1000;
      window.setTimeout(() => {
        const vel = pluckMode ? 0.85 : 0.7 + Math.random() * 0.2;
        audio.startNote(track.id, n, vel);
        if (isRecording) noteRecorder.noteOn(track.id, n, vel);
        // auto-release after a moment
        window.setTimeout(() => {
          audio.endNote(track.id, n);
          if (isRecording) noteRecorder.noteOff(track.id, n);
        }, 320);
      }, delayMs);
    });
  };

  // QWERTY: 1..8 strum chords
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const c = CHORDS.find((c) => c.key === e.key);
      if (c) {
        e.preventDefault();
        strum(c);
      }
      if (e.key === "/") {
        setDirection((d) => (d === "down" ? "up" : "down"));
      }
    };
    window.addEventListener("keydown", onDown);
    return () => window.removeEventListener("keydown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, isRecording, direction, pluckMode]);

  // MIDI: noteon below 48 selects chord index (36..43); above 48 = single pluck note
  useMidiEvents(
    (e) => {
      const owned = project.midiMappings.some((m) => m.signature === e.signature);
      if (owned) return;
      if (e.type === "noteon") {
        if (e.data1 >= 36 && e.data1 <= 43) {
          const c = CHORDS[e.data1 - 36];
          if (c) strum(c);
        } else {
          const note = midiNoteToName(e.data1);
          const v = e.data2 / 127;
          audio.startNote(track.id, note, v);
          if (isRecording) noteRecorder.noteOn(track.id, note, v);
          heldRef.current.set(`midi-${e.data1}`, [note]);
        }
      } else if (e.type === "noteoff") {
        const held = heldRef.current.get(`midi-${e.data1}`);
        if (held) {
          held.forEach((n) => {
            audio.endNote(track.id, n);
            if (isRecording) noteRecorder.noteOff(track.id, n);
          });
          heldRef.current.delete(`midi-${e.data1}`);
        }
      }
    },
    [track.id, isRecording, project.midiMappings, direction, pluckMode],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {track.name} · {pluckMode ? "Pluck" : "Strum"} {direction === "down" ? "↓" : "↑"}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setDirection((d) => (d === "down" ? "up" : "down"))}
            className="px-2 py-1 text-[10px] font-mono panel-inset rounded hover:border-primary/60 border border-border"
          >
            {direction === "down" ? "Down ↓" : "Up ↑"}
          </button>
          <button
            onClick={() => setPluckMode((p) => !p)}
            className={`px-2 py-1 text-[10px] font-mono rounded border ${
              pluckMode ? "border-neon text-neon" : "panel-inset border-border"
            }`}
          >
            {pluckMode ? "Pluck" : "Strum"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {CHORDS.map((c) => (
          <button
            key={c.name}
            onMouseDown={() => strum(c)}
            className={`aspect-square panel-inset rounded-md border-2 flex flex-col items-center justify-center transition-colors ${
              active === c.name
                ? "border-primary bg-primary/30 glow-red"
                : "border-border hover:border-primary/60"
            }`}
          >
            <span className="font-mono text-base font-semibold">{c.name}</span>
            <span className="font-mono text-[9px] text-muted-foreground mt-0.5">
              {c.key}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground font-mono">
        Press 1–8 to strum chords, "/" toggles direction. Pluck mode arpeggiates
        slower. Arm + Record to capture a take.
      </p>
    </div>
  );
}
