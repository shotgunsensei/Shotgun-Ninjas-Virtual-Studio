import { useEffect, useRef, useState } from "react";
import { audio } from "../../lib/audio/engine";
import { noteRecorder } from "../../lib/audio/recorder";
import { useMidiEvents, midiNoteToName } from "../../lib/midi/midi";
import { useStore } from "../../store";
import { getSettings } from "../../lib/settings";
import type { Track } from "../../types";

/**
 * QWERTY → relative MIDI offset map. The base offset sits on the lower of
 * the two visible octaves; adding `(octave - 4) * 12` shifts the whole
 * mapping when the user transposes. Both lower- and upper-octave sharps
 * are covered so every visible black key is reachable from the keyboard.
 */
const QWERTY_MAP: Record<string, number> = {
  // Lower-octave whites: a s d f g h j -> C4..B4
  a: 60,
  s: 62,
  d: 64,
  f: 65,
  g: 67,
  h: 69,
  j: 71,
  // Upper-octave whites: k l ; ' -> C5 D5 E5 F5
  k: 72,
  l: 74,
  ";": 76,
  "'": 77,
  // Lower-octave sharps: w e t y u -> C#4 D#4 F#4 G#4 A#4
  w: 61,
  e: 63,
  t: 66,
  y: 68,
  u: 70,
  // Upper-octave sharps: o p [ ] \ -> C#5 D#5 F#5 G#5 A#5
  // (every visible black key in the rendered 2-octave range has a binding)
  o: 73,
  p: 75,
  "[": 78,
  "]": 80,
  "\\": 82,
};

/**
 * Reverse map: relative semitone offset from the lower visible C
 * -> QWERTY label, used to label every visible key. The QWERTY map is
 * authored against C4 (midi 60), so subtracting 60 gives the offset
 * within the rendered 2-octave range that the user is currently viewing.
 */
const OFFSET_TO_LETTER: Record<number, string> = (() => {
  const out: Record<number, string> = {};
  for (const [key, midi] of Object.entries(QWERTY_MAP)) out[midi - 60] = key;
  return out;
})();

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteLabel(midi: number) {
  const oct = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${oct}`;
}

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
      e.preventDefault();
      const midi = map + (octave - 4) * 12;
      if (heldRef.current.has(midi)) return;
      const note = midiNoteToName(midi);
      audio.startNote(track.id, note, 0.85, "qwerty");
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
      // MIDI passthrough toggle gates the implicit "play the selected
      // instrument" behavior. When off, only explicit learned mappings
      // respond — useful for users who want their controller bound only
      // to specific knobs/pads.
      if (!getSettings().midiPassthrough) return;
      if (e.type === "noteon") {
        const note = midiNoteToName(e.data1);
        audio.startNote(track.id, note, e.data2 / 127, "midi");
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
    <div className="p-3 panel panel-glow">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {track.name} · Keyboard
        </span>
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-muted-foreground">Octave</span>
          <button
            onClick={() => setOctave((o) => Math.max(0, o - 1))}
            className="px-2 border border-border rounded hover-elevate"
            aria-label="Octave down"
          >
            −
          </button>
          <span className="w-6 text-center">{octave}</span>
          <button
            onClick={() => setOctave((o) => Math.min(7, o + 1))}
            className="px-2 border border-border rounded hover-elevate"
            aria-label="Octave up"
          >
            +
          </button>
        </div>
      </div>
      <div className="relative h-32 select-none flex">
        {whites.map((midi) => {
          const isHeld = held.has(midi);
          const offset = midi - startNote;
          const letter = OFFSET_TO_LETTER[offset];
          const showOctaveLabel = midi % 12 === 0;
          return (
            <button
              key={midi}
              onMouseDown={(e) => {
                e.preventDefault();
                trigger(midi);
              }}
              className={`flex-1 h-full border border-border rounded-b-md flex flex-col items-center justify-end pb-1 font-mono text-[10px] transition-colors ${
                isHeld
                  ? "bg-primary/40 text-foreground"
                  : "bg-foreground/95 text-background/80 hover:bg-foreground"
              }`}
              aria-label={noteLabel(midi)}
            >
              {showOctaveLabel && (
                <span className="text-[9px] opacity-70 leading-none">
                  {noteLabel(midi)}
                </span>
              )}
              {letter && (
                <span
                  className={`uppercase font-semibold mt-0.5 leading-none ${
                    isHeld ? "text-foreground" : "text-background"
                  }`}
                >
                  {letter === ";" || letter === "'" ? letter : letter.toUpperCase()}
                </span>
              )}
            </button>
          );
        })}
        {blacks.map(({ midi, offset }) => {
          const isHeld = held.has(midi);
          const noteOffset = midi - startNote;
          const letter = OFFSET_TO_LETTER[noteOffset];
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
              className={`absolute top-0 h-2/3 rounded-b-md border border-black z-10 flex items-end justify-center pb-1 font-mono text-[9px] uppercase font-semibold transition-colors ${
                isHeld
                  ? "bg-primary glow-red text-primary-foreground"
                  : "bg-graphite-2 text-foreground/85 hover:bg-graphite-2/80"
              }`}
              aria-label={noteLabel(midi)}
            >
              {letter ?? ""}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground">
        <span>
          Notes: <kbd className="text-foreground">A S D F G H J K L ; '</kbd>
        </span>
        <span>
          Sharps: <kbd className="text-foreground">W E T Y U O P [ ] \</kbd>
        </span>
      </div>
    </div>
  );
}
