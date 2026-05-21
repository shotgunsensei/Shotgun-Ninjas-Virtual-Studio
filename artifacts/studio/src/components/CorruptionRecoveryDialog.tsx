import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, RotateCcw, Trash2, Download } from "lucide-react";

/**
 * Shown when the app detects that the saved project JSON cannot be
 * deserialized (schema corruption, truncated IndexedDB write, etc.).
 * Gives the user three safe exits: restore the last autosave draft,
 * wipe and start fresh, or download the raw corrupt JSON for manual
 * inspection before deciding.
 */
export function CorruptionRecoveryDialog({
  open,
  rawJson,
  onRestoreAutosave,
  onStartFresh,
}: {
  open: boolean;
  rawJson: string | null;
  onRestoreAutosave: () => void;
  onStartFresh: () => void;
}) {
  const downloadRaw = () => {
    if (!rawJson) return;
    const blob = new Blob([rawJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `sn-studio-corrupt-project-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-yellow-400">
            <AlertTriangle className="w-4 h-4 flex-none" />
            Project could not be loaded
          </DialogTitle>
          <DialogDescription>
            The saved project file appears to be corrupted or unreadable.
            Choose how you'd like to recover.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 pt-1">
          <ActionButton
            icon={<RotateCcw className="w-4 h-4 text-primary" />}
            title="Restore last autosave"
            description="Load the most recent automatic backup snapshot, if one exists."
            onClick={onRestoreAutosave}
            primary
          />
          <ActionButton
            icon={<Trash2 className="w-4 h-4 text-muted-foreground" />}
            title="Start a fresh project"
            description="Discard the corrupted file and open a blank project."
            onClick={onStartFresh}
          />
          {rawJson && (
            <ActionButton
              icon={<Download className="w-4 h-4 text-muted-foreground" />}
              title="Download raw data"
              description="Save the corrupt JSON so you can inspect or manually repair it."
              onClick={downloadRaw}
            />
          )}
        </div>

        <p className="text-[10px] text-muted-foreground pt-1 leading-snug">
          Corruption can happen if the browser tab closed mid-save or site
          storage was cleared. Your audio samples stored separately may still
          be intact.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function ActionButton({
  icon,
  title,
  description,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-start gap-3 border rounded-md p-3 transition-colors ${
        primary
          ? "border-primary/50 bg-primary/10 hover:bg-primary/20"
          : "border-border hover:border-primary/40 hover:bg-primary/5"
      }`}
    >
      <span className="mt-0.5 flex-none">{icon}</span>
      <div>
        <div className="font-mono text-xs font-medium">{title}</div>
        <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
          {description}
        </div>
      </div>
    </button>
  );
}
