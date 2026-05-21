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
  if (a.kind === "chop-pad" && b.kind === "chop-pad") return a.padIndex === b.padIndex;
  return true;
}

/** Converts a raw MIDI signature like "cc:74" or "note:36" into a short
 *  human-readable label that fits inside the indicator button, e.g. "CC74" or "N36". */
function formatSignature(sig: string): string {
  if (!sig) return "";
  const [type, num] = sig.split(":");
  if (!num) return sig.toUpperCase().slice(0, 5);
  if (type === "cc") return `CC${num}`;
  if (type === "note") return `N${num}`;
  return `${type.toUpperCase()}${num}`.slice(0, 5);
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

  const heightClass = small ? "h-7" : "h-8";

  if (mine) {
    const label = formatSignature(mine.signature);
    return (
      <button
        onClick={onClick}
        title={`MIDI: ${mine.signature} — click to remove mapping`}
        className={`group relative inline-flex items-center justify-center gap-0.5 rounded-md border px-1 ${heightClass} bg-neon/15 border-neon/50 text-neon hover:bg-red-500/20 hover:border-red-400/60 hover:text-red-300 transition-colors`}
        style={{ minWidth: small ? "1.75rem" : "2rem" }}
      >
        <span className="font-mono text-[8px] leading-none tracking-tight group-hover:hidden">
          {label}
        </span>
        <span className="font-mono text-[8px] leading-none tracking-tight hidden group-hover:inline">
          ×
        </span>
      </button>
    );
  }

  if (learning) {
    return (
      <button
        onClick={onClick}
        title="Press a key or move a control..."
        className={`relative inline-flex items-center justify-center rounded-md border ${heightClass} px-1 bg-primary/30 border-primary text-primary animate-pulse`}
        style={{ minWidth: small ? "1.75rem" : "2rem" }}
      >
        <Brain className="w-3 h-3" />
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      title="MIDI Learn"
      className={`relative inline-flex items-center justify-center rounded-md border ${heightClass} ${small ? "w-7" : "w-8"} border-border text-muted-foreground hover:text-foreground`}
    >
      <Brain className="w-3.5 h-3.5" />
    </button>
  );
}
