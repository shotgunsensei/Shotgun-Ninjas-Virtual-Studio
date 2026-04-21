import { useEffect, useRef, useState } from "react";
import { audio } from "../../lib/audio/engine";
import { noteRecorder } from "../../lib/audio/recorder";
import { useMidiEvents, midiNoteToName } from "../../lib/midi/midi";
import { useStore } from "../../store";
import type { Track } from "../../types";

const QWERTY_MAP: Record<string, number> = {
  // White keys: a s d f g h j k -> C4..C5
  a: 60,
  s: 62,
  d: 64,
  f: 65,
  g: 67,
  h: 69,
  j: 71,
  k: 72,
  l: 74,
  // black: w e t y u
  w: 61,
  e: 63,
  t: 66,
  y: 68,
  u: 70,
  o: 73,
};

export function Keyboard({ track }: { track: Track }) {
  const isRecording = useStore((s) => s.isRecording);
  const project = useStore((s) => s.project);
  const [held, setHeld] = useState<Set<number>>(new Set());
  const heldRef = useRef(held);
  heldRef.current = held;
  const [octave, setOctave] = useState(track.kind === "bass" ? 2 : 4);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const map = QWERTY_MAP[e.key.toLowerCase()];
      if (map === undefined) return;
      const midi = map + (octave - 4) * 12;
      if (heldRef.current.has(midi)) return;
      const note = midiNoteToName(midi);
      audio.startNote(track.id, note, 0.85);
      if (isRecording) noteRecorder.noteOn(track.id, note, 0.85);
      setHeld((h) => new Set(h).add(midi));
    };
    const onUp = (e: KeyboardEvent) => {
      const map = QWERTY_MAP[e.key.toLowerCase()];
      if (map === undefined) return;
      const midi = map + (octave - 4) * 12;
      const note = midiNoteToName(midi);
      audio.endNote(track.id, note);
      if (isRecording) noteRecorder.noteOff(track.id, note);
      setHeld((h) => {
        const n = new Set(h);
        n.delete(midi);
        return n;
      });
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [track.id, isRecording, octave]);

  useMidiEvents(
    (e) => {
      // if any user mapping owns this signature, defer to the central router
      const owned = project.midiMappings.some((m) => m.signature === e.signature);
      if (owned) return;
      if (e.type === "noteon") {
        const note = midiNoteToName(e.data1);
        audio.startNote(track.id, note, e.data2 / 127);
        if (isRecording) noteRecorder.noteOn(track.id, note, e.data2 / 127);
        setHeld((h) => new Set(h).add(e.data1));
      } else if (e.type === "noteoff") {
        const note = midiNoteToName(e.data1);
        audio.endNote(track.id, note);
        if (isRecording) noteRecorder.noteOff(track.id, note);
        setHeld((h) => {
          const n = new Set(h);
          n.delete(e.data1);
          return n;
        });
      }
    },
    [track.id, isRecording, project.midiMappings],
  );

  // Render 2 octaves of keyboard
  const startMidi = octave * 12 + 12; // C{octave+1}? actually MIDI C4=60 -> octave param=4
  const startNote = octave * 12 + 12; // C(octave). For octave=4 => 60 = C4
  const numKeys = 24; // 2 octaves
  const whites: number[] = [];
  const blacks: { midi: number; offset: number }[] = [];
  let wIdx = 0;
  for (let i = 0; i < numKeys; i++) {
    const midi = startNote + i;
    const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
    if (!isBlack) {
      whites.push(midi);
      wIdx++;
    } else {
      blacks.push({ midi, offset: wIdx });
    }
  }

  const trigger = (midi: number) => {
    const note = midiNoteToName(midi);
    audio.triggerNote(track.id, note, 0.4, 0.85);
    if (isRecording) {
      noteRecorder.noteOn(track.id, note, 0.85);
      window.setTimeout(() => noteRecorder.noteOff(track.id, note), 250);
    }
  };

  return (
    <div className="p-3 panel">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {track.name} · Keyboard
        </span>
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-muted-foreground">Octave</span>
          <button
            onClick={() => setOctave((o) => Math.max(0, o - 1))}
            className="px-2 border border-border rounded hover-elevate"
          >
            −
          </button>
          <span className="w-6 text-center">{octave}</span>
          <button
            onClick={() => setOctave((o) => Math.min(7, o + 1))}
            className="px-2 border border-border rounded hover-elevate"
          >
            +
          </button>
          <span className="text-muted-foreground ml-2 hidden sm:inline">
            (a s d f g h j k for notes, w e t y u for sharps)
          </span>
        </div>
      </div>
      <div className="relative h-32 select-none flex">
        {whites.map((midi) => {
          const isHeld = held.has(midi);
          return (
            <button
              key={midi}
              onMouseDown={(e) => {
                e.preventDefault();
                trigger(midi);
              }}
              className={`flex-1 h-full border border-border rounded-b-md flex items-end justify-center pb-1 font-mono text-[10px] ${
                isHeld
                  ? "bg-primary/40 text-foreground"
                  : "bg-foreground/95 text-background/70 hover:bg-foreground"
              }`}
            >
              {midi % 12 === 0 ? `C${Math.floor(midi / 12) - 1}` : ""}
            </button>
          );
        })}
        {blacks.map(({ midi, offset }) => {
          const isHeld = held.has(midi);
          return (
            <button
              key={midi}
              onMouseDown={(e) => {
                e.preventDefault();
                trigger(midi);
              }}
              style={{
                left: `calc(${(offset / whites.length) * 100}% - ${100 / whites.length / 3}%)`,
                width: `${(100 / whites.length) * 0.6}%`,
              }}
              className={`absolute top-0 h-2/3 rounded-b-md border border-black z-10 ${
                isHeld ? "bg-primary glow-red" : "bg-graphite-2"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
