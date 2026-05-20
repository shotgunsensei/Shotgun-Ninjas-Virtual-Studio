import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import type { ProjectImportSummary } from "../lib/storage/db";

/**
 * Confirm-before-replace modal shown after a `.snproj.json` import.
 * Lets the user review what's in the file (title, BPM, counts, missing
 * samples) before the active project gets swapped out.
 */
export function ImportSummaryDialog({
  summary,
  onCancel,
  onConfirm,
}: {
  summary: ProjectImportSummary | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const open = !!summary;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import project</DialogTitle>
          <DialogDescription>
            Loading this file will replace your current project. Your saved
            sessions in Load are not touched.
          </DialogDescription>
        </DialogHeader>
        {summary && (
          <div className="space-y-3" data-testid="import-summary">
            <div className="border border-border rounded-md p-3 bg-background space-y-1">
              <div className="font-mono text-sm">{summary.project.name}</div>
              {summary.project.metadata?.creator && (
                <div className="text-xs text-muted-foreground">
                  by {summary.project.metadata.creator}
                </div>
              )}
              {summary.project.metadata?.description && (
                <div className="text-xs text-muted-foreground italic">
                  {summary.project.metadata.description}
                </div>
              )}
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary pt-1">
                {summary.project.bpm} BPM · {summary.trackCount} tracks ·{" "}
                {summary.noteClipCount} note clips · {summary.audioClipCount} audio clips ·{" "}
                {summary.sampleCount} samples
              </div>
              {(summary.project.metadata?.genre ||
                summary.project.metadata?.mood ||
                (summary.project.metadata?.tags?.length ?? 0) > 0) && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {summary.project.metadata?.genre && (
                    <Pill>{summary.project.metadata.genre}</Pill>
                  )}
                  {summary.project.metadata?.mood && (
                    <Pill>{summary.project.metadata.mood}</Pill>
                  )}
                  {summary.project.metadata?.tags?.map((t) => (
                    <Pill key={t}>#{t}</Pill>
                  ))}
                </div>
              )}
            </div>

            {summary.brand && (
              <div className="text-[10px] font-mono text-muted-foreground">
                Made with {summary.brand.appName} v{summary.brand.appVersion}
                {summary.isOlderAppVersion && " — older version, will be upgraded on open."}
              </div>
            )}

            {summary.missingSampleNames.length > 0 && (
              <div className="flex gap-2 items-start border border-amber-500/40 bg-amber-500/10 rounded-md p-2 text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-wider text-amber-200">
                    Missing audio ({summary.missingSampleNames.length})
                  </div>
                  <div className="text-muted-foreground mt-1 break-words">
                    {summary.missingSampleNames.slice(0, 6).join(", ")}
                    {summary.missingSampleNames.length > 6 && "…"}
                  </div>
                  <div className="text-muted-foreground/80 mt-1">
                    You can re-import these from the sample browser after the project loads.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            data-testid="import-summary-confirm"
          >
            Replace project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-widest text-primary border border-primary/40 rounded px-1.5 py-0.5">
      {children}
    </span>
  );
}
