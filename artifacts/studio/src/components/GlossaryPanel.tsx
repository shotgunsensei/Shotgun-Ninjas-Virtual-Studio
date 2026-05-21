import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BookOpen, ExternalLink } from "lucide-react";

export interface GlossaryTerm {
  term: string;
  definition: string;
  tryItEvent?: string;
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    term: "BPM",
    definition:
      "Beats Per Minute — how fast your track moves. A higher BPM means a faster tempo. Typical values: hip-hop 85–95, house 120–130, techno 140–160.",
    tryItEvent: "studio:glossary-highlight-bpm",
  },
  {
    term: "Swing",
    definition:
      "A groove feel that pushes every other 16th note slightly late, giving the beat a shuffle or bounce rather than a perfectly rigid grid.",
    tryItEvent: "studio:glossary-highlight-swing",
  },
  {
    term: "Velocity",
    definition:
      "How hard a note is hit, expressed as 0–127. Higher velocity = louder and brighter. Varied velocities make a pattern feel human rather than robotic.",
  },
  {
    term: "Compression",
    definition:
      "Reduces the dynamic range of a sound — quieter parts get louder, louder parts get quieter — so the overall level feels more consistent and punchy.",
  },
  {
    term: "Limiter",
    definition:
      "An extreme compressor that prevents audio from ever going above a set ceiling, protecting speakers from damage and keeping mixes from clipping.",
  },
  {
    term: "Pan",
    definition:
      "Where a sound sits in the left-right stereo field. Center (0) plays through both speakers equally; hard left/right plays through only one side.",
  },
  {
    term: "Send",
    definition:
      "Routing a copy of a track's signal to a shared effects bus (like reverb or delay) so multiple tracks can share the same effect without each needing their own.",
  },
  {
    term: "EQ",
    definition:
      "Equalizer — boosts or cuts specific frequency ranges (low, mid, high) to shape the tone of a sound. Cutting mud in the low-mids or adding air in the highs are common moves.",
  },
  {
    term: "Reverb",
    definition:
      "Simulates sound bouncing off walls in a space — a small room feels intimate, a hall or cathedral sounds epic. Adds depth and space to dry sounds.",
  },
  {
    term: "Delay",
    definition:
      "Records and plays back a copy of the sound after a set time. Short delays thicken sounds; longer, repeating delays create echo effects rhythmically tied to BPM.",
  },
  {
    term: "Clipping",
    definition:
      "When audio exceeds 0 dBFS (the maximum digital level), the waveform is chopped off flat, creating harsh distortion. The meters turn red as a warning.",
  },
];

interface GlossaryPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Pre-scroll to this term when the panel opens */
  initialTerm?: string;
}

export function GlossaryPanel({
  open,
  onOpenChange,
  initialTerm,
}: GlossaryPanelProps) {
  const [search, setSearch] = useState("");
  const termRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const filtered = GLOSSARY_TERMS.filter(
    (t) =>
      !search ||
      t.term.toLowerCase().includes(search.toLowerCase()) ||
      t.definition.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    if (!open || !initialTerm) return;
    const timeout = setTimeout(() => {
      const el = termRefs.current[initialTerm];
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      el?.focus();
    }, 120);
    return () => clearTimeout(timeout);
  }, [open, initialTerm]);

  function handleTryIt(event?: string) {
    if (!event) return;
    onOpenChange(false);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent(event));
    }, 200);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[80vh] flex flex-col"
        aria-label="Music glossary"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            Music Glossary
          </DialogTitle>
          <DialogDescription>
            Plain-English definitions for the terms you'll see in the studio.
          </DialogDescription>
        </DialogHeader>

        <input
          type="search"
          placeholder="Search terms…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search glossary terms"
          className="w-full bg-background border border-border rounded-md h-8 px-3 font-mono text-sm mb-1"
        />

        <div
          className="flex-1 overflow-y-auto space-y-0 pr-1"
          role="list"
          aria-label="Glossary entries"
        >
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No terms match "{search}".
            </p>
          )}
          {filtered.map((entry) => (
            <div
              key={entry.term}
              role="listitem"
              tabIndex={0}
              ref={(el) => { termRefs.current[entry.term] = el; }}
              className="py-3 border-b border-border last:border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              id={`glossary-${entry.term.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-mono text-sm font-semibold text-primary uppercase tracking-wider">
                  {entry.term}
                </span>
                {entry.tryItEvent && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 font-mono text-[10px] gap-1"
                    onClick={() => handleTryIt(entry.tryItEvent)}
                    aria-label={`Try ${entry.term} — highlights the control in the studio`}
                  >
                    <ExternalLink className="w-3 h-3" />
                    Try it
                  </Button>
                )}
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed">
                {entry.definition}
              </p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Small inline "?" button that opens the glossary scrolled to a specific term. */
export function GlossaryLink({
  term,
  onOpen,
}: {
  term: string;
  onOpen: (term: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(term)}
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground/60 font-mono text-[9px] leading-none transition-colors ml-0.5"
      aria-label={`What is ${term}? Open glossary`}
      title={`What is ${term}?`}
    >
      ?
    </button>
  );
}
