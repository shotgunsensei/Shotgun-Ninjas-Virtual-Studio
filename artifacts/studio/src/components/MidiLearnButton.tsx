import { Brain } from "lucide-react";
import { useStore, getStore, midiTargetLabel } from "../store";
import type { MidiTarget } from "../types";

interface Props {
  target: MidiTarget;
  small?: boolean;
}

function targetMatches(a: MidiTarget, b: MidiTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "track-volume" && b.kind === "track-volume") return a.trackId === b.trackId;
  if (a.kind === "track-pan" && b.kind === "track-pan") return a.trackId === b.trackId;
  if (a.kind === "track-send" && b.kind === "track-send") return a.trackId === b.trackId && a.busId === b.busId;
  if (a.kind === "track-eq" && b.kind === "track-eq") return a.trackId === b.trackId && a.band === b.band;
  if (a.kind === "fx-amount" && b.kind === "fx-amount") return a.trackId === b.trackId && a.moduleId === b.moduleId;
  if (a.kind === "drum-pad" && b.kind === "drum-pad") return a.pad === b.pad;
  if (a.kind === "drum-piece-volume" && b.kind === "drum-piece-volume") return a.trackId === b.trackId && a.pieceId === b.pieceId;
  if (a.kind === "drum-piece-pan" && b.kind === "drum-piece-pan") return a.trackId === b.trackId && a.pieceId === b.pieceId;
  if (a.kind === "drum-piece-pitch" && b.kind === "drum-piece-pitch") return a.trackId === b.trackId && a.pieceId === b.pieceId;
  return true;
}

export function MidiLearnButton({ target, small = false }: Props) {
  const project = useStore((s) => s.project);
  const learnId = useStore((s) => s.midiLearnTargetId);
  const mappings = project.midiMappings;
  const mine = mappings.find((m) => targetMatches(m.target, target) && m.signature);
  const learning = mappings.find((m) => m.id === learnId && targetMatches(m.target, target));

  const onClick = () => {
    if (mine) {
      getStore().removeMapping(mine.id);
      getStore().setStatus(`Cleared MIDI mapping for ${midiTargetLabel(target, project)}`, "info");
      return;
    }
    if (learning) {
      getStore().cancelMidiLearn();
      return;
    }
    getStore().beginMidiLearn(target);
    getStore().setStatus(
      `MIDI Learn: move a control or press a key to bind to ${midiTargetLabel(target, project)}`,
      "info",
    );
  };

  const sizeClass = small ? "h-7 w-7" : "h-8 w-8";
  const colorClass = mine
    ? "bg-neon/20 border-neon/60 text-neon"
    : learning
      ? "bg-primary/30 border-primary text-primary animate-pulse"
      : "border-border text-muted-foreground hover:text-foreground";

  return (
    <button
      onClick={onClick}
      title={
        mine
          ? `MIDI: ${mine.signature} (click to clear)`
          : learning
            ? "Press a key or move a control..."
            : "MIDI Learn"
      }
      className={`relative inline-flex items-center justify-center rounded-md border ${sizeClass} ${colorClass}`}
    >
      <Brain className="w-3.5 h-3.5" />
    </button>
  );
}
