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
  if (a.kind === "drum-pad" && b.kind === "drum-pad") return a.pad === b.pad;
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
