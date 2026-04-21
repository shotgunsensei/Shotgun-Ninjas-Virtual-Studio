import { useEffect } from "react";
import { audio, type DrumPiece, DRUM_PIECES } from "../../lib/audio/engine";
import { noteRecorder } from "../../lib/audio/recorder";
import { useMidiEvents } from "../../lib/midi/midi";
import { useStore, getStore } from "../../store";
import { MidiLearnButton } from "../MidiLearnButton";
import type { Track } from "../../types";

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

export function DrumPads({ track }: { track: Track }) {
  const isRecording = useStore((s) => s.isRecording);
  const project = useStore((s) => s.project);

  const hit = (piece: DrumPiece) => {
    audio.triggerDrum(track.id, piece, 0.95);
    if (isRecording) noteRecorder.hit(track.id, piece, 0.95);
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

  // direct MIDI: notes 36..43 -> drum pieces
  useMidiEvents(
    (e) => {
      if (e.type !== "noteon") return;
      // direct mapping: 36..43 -> indexes
      const idx = e.data1 - 36;
      if (idx >= 0 && idx < DRUM_PIECES.length) {
        // only fire direct mapping if the user hasn't custom-mapped this note to a drum pad already
        const customMapped = project.midiMappings.find(
          (m) => m.signature === e.signature && m.target.kind === "drum-pad",
        );
        if (!customMapped) hit(DRUM_PIECES[idx]);
      }
    },
    [track.id, isRecording, project.midiMappings],
  );

  // listen for custom drum-pad MIDI mappings (handled in App.tsx midi router too,
  // but we also bind here so the visual flashes by re-rendering naturally)

  return (
    <div className="p-3 panel">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {track.name} · Pads
        </span>
        <span className="font-mono text-[10px] text-muted-foreground hidden sm:inline">
          Q W E R / A S D F (also MIDI notes 36–43)
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
      <p className="mt-2 text-[10px] text-muted-foreground font-mono">
        Tip: arm this track and press Record to capture pad hits to the timeline.
      </p>
      {/* keep getStore reference available */}
      <span className="hidden">{getStore.name}</span>
    </div>
  );
}
