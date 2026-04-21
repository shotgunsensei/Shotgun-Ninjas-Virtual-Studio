import { useEffect, useMemo, useState } from "react";
import { audio, type DrumPiece, DRUM_PIECES } from "../../lib/audio/engine";
import { noteRecorder } from "../../lib/audio/recorder";
import { useMidiEvents } from "../../lib/midi/midi";
import { useStore, getStore, makeId } from "../../store";
import { MidiLearnButton } from "../MidiLearnButton";
import type { Track, NoteEvent, NoteClip } from "../../types";

const PAD_KEYS: Record<string, DrumPiece> = {
  q: "kick",
  w: "snare",
  e: "clap",
  r: "hat",
  a: "ohat",
  s: "tomLow",
  d: "tomHigh",
  f: "crash",
};

const LABELS: Record<DrumPiece, string> = {
  kick: "Kick",
  snare: "Snare",
  clap: "Clap",
  hat: "Hat",
  ohat: "O-Hat",
  tomLow: "Tom L",
  tomHigh: "Tom H",
  crash: "Crash",
};

const STEPS_PER_BEAT = 4; // 16th notes
const STEP_DURATION_BEATS = 1 / STEPS_PER_BEAT;

function clipPatternBeats(clip: NoteClip | undefined, fallback = 4): number {
  return clip?.length ?? fallback;
}

function isOn(notes: NoteEvent[], piece: DrumPiece, beat: number): boolean {
  // tolerance for floats
  const tol = 0.01;
  return notes.some(
    (n) => n.note === piece && Math.abs(n.time - beat) < tol,
  );
}

function toggleStep(clip: NoteClip, piece: DrumPiece, beat: number): NoteClip {
  if (isOn(clip.notes, piece, beat)) {
    return {
      ...clip,
      notes: clip.notes.filter(
        (n) => !(n.note === piece && Math.abs(n.time - beat) < 0.01),
      ),
    };
  }
  return {
    ...clip,
    notes: [
      ...clip.notes,
      {
        time: beat,
        note: piece,
        duration: STEP_DURATION_BEATS,
        velocity: 0.9,
      },
    ],
  };
}

export function DrumPads({ track }: { track: Track }) {
  const isRecording = useStore((s) => s.isRecording);
  const project = useStore((s) => s.project);
  const isPlaying = useStore((s) => s.isPlaying);

  const clip = track.noteClips[0];
  const patternBeats = clipPatternBeats(clip, 4);
  const totalSteps = Math.round(patternBeats * STEPS_PER_BEAT);

  const stepBeats = useMemo(
    () => Array.from({ length: totalSteps }, (_, i) => i * STEP_DURATION_BEATS),
    [totalSteps],
  );

  // Live "current step" indicator while playing
  const playheadStep = usePlayheadStep(isPlaying, patternBeats);

  const hit = (piece: DrumPiece) => {
    audio.triggerDrum(track.id, piece, 0.95);
    if (isRecording) noteRecorder.hit(track.id, piece, 0.95);
  };

  const onToggle = (piece: DrumPiece, beat: number) => {
    const baseClip: NoteClip =
      clip ?? {
        id: makeId(),
        start: 0,
        length: patternBeats,
        notes: [],
      };
    const next = toggleStep(baseClip, piece, beat);
    getStore().addNoteClip(track.id, next);
  };

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const p = PAD_KEYS[e.key.toLowerCase()];
      if (!p) return;
      hit(p);
    };
    window.addEventListener("keydown", onDown);
    return () => window.removeEventListener("keydown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, isRecording]);

  // direct MIDI: notes 36..43 -> drum pieces (skip if user-mapped)
  useMidiEvents(
    (e) => {
      if (e.type !== "noteon") return;
      const idx = e.data1 - 36;
      if (idx >= 0 && idx < DRUM_PIECES.length) {
        const customMapped = project.midiMappings.find(
          (m) => m.signature === e.signature && m.target.kind === "drum-pad",
        );
        if (!customMapped) hit(DRUM_PIECES[idx]);
      }
    },
    [track.id, isRecording, project.midiMappings],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {track.name} · Pads
        </span>
        <span className="font-mono text-[10px] text-muted-foreground hidden sm:inline">
          Q W E R / A S D F
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {DRUM_PIECES.map((p) => (
          <div key={p} className="relative">
            <button
              onMouseDown={() => hit(p)}
              className="w-full aspect-square panel-inset rounded-md border-2 border-border hover:border-primary/60 active:bg-primary/30 active:glow-red transition-colors flex flex-col items-center justify-center"
            >
              <span className="font-mono text-xs font-semibold">{LABELS[p]}</span>
              <span className="font-mono text-[9px] text-muted-foreground mt-1">
                {Object.entries(PAD_KEYS).find(([, v]) => v === p)?.[0]?.toUpperCase() ?? ""}
              </span>
            </button>
            <div className="absolute top-1 right-1">
              <MidiLearnButton target={{ kind: "drum-pad", pad: p }} small />
            </div>
          </div>
        ))}
      </div>

      {/* Step sequencer */}
      <div className="panel-inset rounded-md p-2">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Step Sequencer · {totalSteps} steps · 16ths
          </span>
          <button
            onClick={() => {
              if (!clip) return;
              getStore().addNoteClip(track.id, { ...clip, notes: [] });
            }}
            className="text-[10px] font-mono px-2 py-0.5 border border-border rounded hover:border-primary/60"
          >
            Clear
          </button>
        </div>
        <div className="space-y-1">
          {DRUM_PIECES.map((piece) => (
            <div key={piece} className="flex items-center gap-1">
              <div className="w-12 font-mono text-[9px] text-muted-foreground">
                {LABELS[piece]}
              </div>
              <div className="flex gap-0.5 flex-1">
                {stepBeats.map((beat, i) => {
                  const on = clip ? isOn(clip.notes, piece, beat) : false;
                  const isBeat = i % STEPS_PER_BEAT === 0;
                  const isAtPlayhead = isPlaying && i === playheadStep;
                  return (
                    <button
                      key={i}
                      onClick={() => onToggle(piece, beat)}
                      className={`flex-1 h-4 rounded-[2px] border transition-colors ${
                        on
                          ? "bg-primary border-primary glow-red"
                          : isBeat
                            ? "bg-graphite/80 border-border"
                            : "bg-graphite/40 border-border/60"
                      } ${isAtPlayhead ? "ring-1 ring-neon" : ""}`}
                      aria-label={`${LABELS[piece]} step ${i + 1}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground font-mono">
        Click cells to edit the pattern — it plays in the timeline. Pad hits also
        record live to a take when armed.
      </p>
    </div>
  );
}

function usePlayheadStep(isPlaying: boolean, patternBeats: number) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!isPlaying || patternBeats <= 0) return;
    let raf = 0;
    const tick = () => {
      const pos = audio.positionBeats() % patternBeats;
      setStep(Math.floor(pos * STEPS_PER_BEAT));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, patternBeats]);
  return step;
}
