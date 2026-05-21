import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FolderOpen, VolumeX, Music, CheckCircle2 } from "lucide-react";
import { relocateSampleBlob } from "../lib/storage/db";

export interface MissingSampleEntry {
  sampleId: string;
  blobKey: string;
  name: string;
  trackName?: string;
}

type ItemAction = "pending" | "reimported" | "muted" | "placeholder";

/**
 * Wizard that surfaces after a project loads and references samples that
 * are no longer in IndexedDB (e.g. after clearing site data). The user
 * can handle each missing item individually before the studio opens.
 */
export function MissingSamplesDialog({
  open,
  entries,
  onClose,
  onMuteTrack,
}: {
  open: boolean;
  entries: MissingSampleEntry[];
  onClose: () => void;
  onMuteTrack: (sampleId: string) => void;
}) {
  const [actions, setActions] = useState<Record<string, ItemAction>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const setAction = (id: string, action: ItemAction) => {
    setActions((prev) => ({ ...prev, [id]: action }));
  };

  const handleReimport = async (entry: MissingSampleEntry) => {
    const input = inputRefs.current[entry.sampleId];
    if (!input) return;
    input.click();
  };

  const handleFileChosen = async (
    entry: MissingSampleEntry,
    file: File,
  ) => {
    try {
      await relocateSampleBlob(entry.blobKey, file);
      setAction(entry.sampleId, "reimported");
    } catch {
      /* ignore — IDB write error */
    }
  };

  const handleMute = (entry: MissingSampleEntry) => {
    onMuteTrack(entry.sampleId);
    setAction(entry.sampleId, "muted");
  };

  const handlePlaceholder = (entry: MissingSampleEntry) => {
    setAction(entry.sampleId, "placeholder");
  };

  const allResolved = entries.every(
    (e) => actions[e.sampleId] && actions[e.sampleId] !== "pending",
  );

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Missing samples</DialogTitle>
          <DialogDescription>
            {entries.length} sample{entries.length === 1 ? "" : "s"} referenced
            by this project could not be found in your browser. Resolve each one
            before continuing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {entries.map((entry) => {
            const action = actions[entry.sampleId] ?? "pending";
            const resolved = action !== "pending";
            return (
              <div
                key={entry.sampleId}
                className={`border rounded-md p-3 transition-colors ${
                  resolved
                    ? "border-emerald-600/40 bg-emerald-600/5"
                    : "border-border bg-background/40"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {resolved ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-none" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border border-yellow-400/60 flex-none" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs truncate">{entry.name}</div>
                    {entry.trackName && (
                      <div className="text-[10px] text-muted-foreground">
                        Track: {entry.trackName}
                      </div>
                    )}
                  </div>
                  {resolved && (
                    <span className="font-mono text-[9px] uppercase tracking-widest text-emerald-500">
                      {action === "reimported" && "Re-imported"}
                      {action === "muted" && "Muted"}
                      {action === "placeholder" && "Placeholder"}
                    </span>
                  )}
                </div>

                {!resolved && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleReimport(entry)}
                      className="flex items-center gap-1 h-6 px-2 rounded border border-primary/50 font-mono text-[9px] uppercase tracking-widest hover:bg-primary/10 text-primary"
                    >
                      <FolderOpen className="w-2.5 h-2.5" />
                      Re-import
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMute(entry)}
                      className="flex items-center gap-1 h-6 px-2 rounded border border-border font-mono text-[9px] uppercase tracking-widest hover:bg-accent/40 text-muted-foreground"
                    >
                      <VolumeX className="w-2.5 h-2.5" />
                      Skip (mute)
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePlaceholder(entry)}
                      className="flex items-center gap-1 h-6 px-2 rounded border border-border font-mono text-[9px] uppercase tracking-widest hover:bg-accent/40 text-muted-foreground"
                    >
                      <Music className="w-2.5 h-2.5" />
                      Placeholder
                    </button>
                  </div>
                )}

                <input
                  ref={(el) => {
                    inputRefs.current[entry.sampleId] = el;
                  }}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFileChosen(entry, file);
                  }}
                />
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-1 gap-2">
          <p className="text-[10px] text-muted-foreground leading-snug flex-1">
            Skipped tracks will be muted. Placeholder tracks play a sine-wave
            tone so the arrangement stays audible.
          </p>
          <button
            type="button"
            onClick={onClose}
            disabled={!allResolved && entries.length > 0}
            className="h-8 px-4 rounded-md bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest glow-red disabled:opacity-40"
          >
            {allResolved || entries.length === 0 ? "Continue" : "Resolve all"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
