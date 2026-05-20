import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CHANGELOG } from "../lib/version";

/**
 * Small read-only changelog modal. Surfaces what shipped in each
 * studio release so users can quickly orient themselves after an
 * update. Kept short — long-form release notes live on the marketing
 * site.
 */
export function ChangelogDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
          <DialogDescription>
            Recent updates to the Shotgun Ninjas studio.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {CHANGELOG.map((entry) => (
            <div
              key={entry.version}
              className="border border-border rounded-md p-3 bg-background/40"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="font-mono text-xs uppercase tracking-widest text-primary">
                  v{entry.version}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {entry.date}
                </div>
              </div>
              <ul className="space-y-1 text-sm">
                {entry.highlights.map((h, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-foreground/85 leading-snug"
                  >
                    <span className="text-primary mt-1.5 w-1 h-1 rounded-full bg-primary flex-none" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
