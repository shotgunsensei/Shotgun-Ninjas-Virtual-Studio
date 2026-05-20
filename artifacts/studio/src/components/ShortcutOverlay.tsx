import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export interface ShortcutDef {
  keys: string[];
  label: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: ["Space"], label: "Play / Pause" },
  { keys: ["Enter"], label: "Stop transport" },
  { keys: ["R"], label: "Toggle record" },
  { keys: ["M"], label: "Toggle metronome" },
  { keys: ["S"], label: "Save project" },
  { keys: ["B"], label: "Bounce / Export" },
  { keys: ["Del"], label: "Delete selected clip" },
  { keys: ["Ctrl/⌘", "C"], label: "Copy selected clip" },
  { keys: ["Ctrl/⌘", "V"], label: "Paste clip" },
  { keys: ["1", "…", "8"], label: "Focus track 1-8" },
  { keys: ["F"], label: "Toggle fullscreen" },
  { keys: ["?"], label: "Open this shortcut overlay" },
  { keys: ["Esc"], label: "Close dialogs / panic stop" },
];

export function ShortcutOverlay({
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
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts ignore typing in text fields.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-1.5 max-h-[60vh] overflow-y-auto">
          {SHORTCUTS.map((s) => (
            <div
              key={s.label}
              className="flex items-center justify-between gap-3 px-2 py-1.5 rounded border border-border bg-background/40"
            >
              <span className="text-sm">{s.label}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, i) => (
                  <kbd
                    key={i}
                    className="px-1.5 py-0.5 rounded border border-border bg-graphite font-mono text-[10px] uppercase tracking-wider"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
