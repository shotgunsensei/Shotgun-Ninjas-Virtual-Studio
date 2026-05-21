import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { audio } from "../lib/audio/engine";
import { performanceRouter } from "../lib/performance/router";
import { useStore, getStore } from "../store";
import { midiNoteToName } from "../lib/midi/midi";
import { DRUM_PIECES } from "../lib/audio/engine";
import type { DrumPiece } from "../lib/audio/engine";
import { gamepadService } from "../lib/performance/gamepad";
import { DEFAULT_GAMEPAD_MAPPINGS } from "../lib/performance/router";

interface Pad {
  index: number;
  note: number;
  label: string;
  isDrum: boolean;
  drumPiece?: DrumPiece;
}

const DRUM_NOTE_MAP: Record<number, DrumPiece> = {
  36: "kick",
  38: "snare",
  42: "hat",
  46: "ohat",
  39: "clap",
  41: "tomLow",
  43: "tomHigh",
  49: "crash",
  48: "fx",
};

const DRUM_LABELS: Record<DrumPiece, string> = {
  kick: "Kick",
  snare: "Snare",
  hat: "Hi-Hat",
  ohat: "Open Hat",
  clap: "Clap",
  tomLow: "Tom Lo",
  tomHigh: "Tom Hi",
  crash: "Crash",
  fx: "FX",
};

const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F",
  "F#", "G", "G#", "A", "A#", "B",
];

function midiName(n: number) {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

function buildDrumPads(): Pad[] {
  const drumNotes = [36, 38, 42, 46, 39, 49, 41, 43, 48, 45, 60, 62, 64, 65, 67, 69];
  return drumNotes.map((note, i) => {
    const dp = DRUM_NOTE_MAP[note];
    return {
      index: i,
      note,
      label: dp ? DRUM_LABELS[dp] : midiName(note),
      isDrum: !!dp,
      drumPiece: dp,
    };
  });
}

export function PerformancePadScreen({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [pads] = useState<Pad[]>(buildDrumPads);
  const [hitMap, setHitMap] = useState<Record<number, boolean>>({});
  const [fullscreen, setFullscreen] = useState(false);
  const selectedTrack = useStore((s) =>
    s.project.tracks.find((t) => t.id === s.selectedTrackId) ?? s.project.tracks[0],
  );
  const drumTrack = useStore((s) =>
    s.project.tracks.find((t) => t.kind === "drums"),
  );

  const flash = useCallback((noteIndex: number) => {
    setHitMap((h) => ({ ...h, [noteIndex]: true }));
    window.setTimeout(() => {
      setHitMap((h) => ({ ...h, [noteIndex]: false }));
    }, 120);
  }, []);

  const triggerPad = useCallback(
    (pad: Pad) => {
      flash(pad.index);
      if (pad.isDrum && drumTrack && pad.drumPiece) {
        audio.triggerDrum(drumTrack.id, pad.drumPiece, 0.9);
      } else if (selectedTrack) {
        const note = midiNoteToName(pad.note);
        audio.triggerNote(selectedTrack.id, note, 0.25, 0.85);
      }
    },
    [drumTrack, selectedTrack, flash],
  );

  // Listen to performance router events
  useEffect(() => {
    const unsub = performanceRouter.onNote((e) => {
      if (e.type !== "noteon") return;
      const pad = pads.find((p) => p.note === e.note);
      if (pad) flash(pad.index);
    });
    return () => { unsub(); };
  }, [pads, flash]);

  // Listen to gamepad events when pad screen is open
  useEffect(() => {
    if (!open) return;
    const unsub = gamepadService.onButton((btnIdx, pressed) => {
      if (!pressed) return;
      const mapping = DEFAULT_GAMEPAD_MAPPINGS.find((m) => m.buttonIndex === btnIdx);
      if (!mapping) return;
      const pad = pads.find((p) => p.note === mapping.note);
      if (pad) triggerPad(pad);
    });
    return () => { unsub(); };
  }, [open, pads, triggerPad]);

  const toggleFullscreen = () => {
    if (fullscreen) {
      document.exitFullscreen?.().catch(() => undefined);
      setFullscreen(false);
    } else {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
      setFullscreen(true);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-graphite/80">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Performance Pads
          {drumTrack && (
            <span className="ml-2 text-primary">· {drumTrack.name}</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="text-muted-foreground hover:text-foreground p-1 rounded"
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded"
            aria-label="Close pad screen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 4x4 Pad Grid */}
      <div className="flex-1 p-3 grid grid-cols-4 grid-rows-4 gap-2">
        {pads.map((pad) => {
          const isHit = hitMap[pad.index];
          return (
            <button
              key={pad.index}
              onPointerDown={(e) => {
                e.preventDefault();
                triggerPad(pad);
              }}
              className={`
                touch-pad rounded-xl border-2 select-none
                flex flex-col items-center justify-center gap-1
                font-mono transition-all duration-75
                active:scale-95
                ${
                  isHit
                    ? "border-primary bg-primary/30 glow-red scale-[0.97]"
                    : "border-border bg-graphite/60 hover:border-primary/50 hover:bg-graphite/80"
                }
              `}
              style={{ touchAction: "none" }}
            >
              <span className="text-sm font-bold leading-none">
                {pad.label}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {pad.note}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-border text-[10px] font-mono text-muted-foreground flex items-center gap-4">
        <span>Touch / mouse / gamepad / MIDI</span>
        <span className="ml-auto">
          Selected: {selectedTrack?.name ?? "—"}
        </span>
      </div>
    </div>
  );
}
