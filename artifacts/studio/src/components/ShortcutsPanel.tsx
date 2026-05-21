import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

export interface ShortcutEntry {
  keys: string[];
  label: string;
}

export interface ShortcutCategory {
  category: string;
  shortcuts: ShortcutEntry[];
}

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    category: "Transport",
    shortcuts: [
      { keys: ["Space"], label: "Play / Pause" },
      { keys: ["Enter"], label: "Stop & return to start" },
      { keys: ["R"], label: "Toggle record" },
      { keys: ["M"], label: "Toggle metronome" },
      { keys: ["F"], label: "Toggle fullscreen" },
    ],
  },
  {
    category: "Project",
    shortcuts: [
      { keys: ["Ctrl/⌘", "S"], label: "Save project" },
      { keys: ["Ctrl/⌘", "Shift", "S"], label: "Save project as…" },
      { keys: ["Ctrl/⌘", "N"], label: "New project" },
      { keys: ["Ctrl/⌘", "O"], label: "Open / Load project" },
      { keys: ["B"], label: "Bounce / Export audio" },
    ],
  },
  {
    category: "Editing",
    shortcuts: [
      { keys: ["Ctrl/⌘", "C"], label: "Copy selected clip" },
      { keys: ["Ctrl/⌘", "V"], label: "Paste clip" },
      { keys: ["Ctrl/⌘", "Z"], label: "Undo" },
      { keys: ["Ctrl/⌘", "Shift", "Z"], label: "Redo" },
      { keys: ["Del"], label: "Delete selected clip" },
    ],
  },
  {
    category: "Navigation",
    shortcuts: [
      { keys: ["1", "…", "8"], label: "Focus track 1–8" },
      { keys: ["Tab"], label: "Move focus to next control" },
      { keys: ["Shift", "Tab"], label: "Move focus to previous control" },
      { keys: ["↑ / ↓"], label: "Adjust focused knob or value" },
      { keys: ["Esc"], label: "Close dialog / panic stop" },
    ],
  },
  {
    category: "Mixer & Channels",
    shortcuts: [
      { keys: ["Ctrl/⌘", "M"], label: "Mute focused track" },
      { keys: ["Ctrl/⌘", "L"], label: "Solo focused track" },
    ],
  },
  {
    category: "Piano Roll",
    shortcuts: [
      { keys: ["Ctrl/⌘", "A"], label: "Select all notes" },
      { keys: ["Shift", "↑ / ↓"], label: "Transpose selected notes ±1 semitone" },
      { keys: ["Ctrl/⌘", "↑ / ↓"], label: "Transpose selected notes ±1 octave" },
      { keys: ["Ctrl/⌘", "D"], label: "Duplicate selected notes" },
    ],
  },
  {
    category: "Help & Overlays",
    shortcuts: [
      { keys: ["?"], label: "Open keyboard shortcuts" },
      { keys: ["Ctrl/⌘", ","], label: "Open settings" },
    ],
  },
];

interface ShortcutsPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ShortcutsPanel({ open, onOpenChange }: ShortcutsPanelProps) {
  const [search, setSearch] = useState("");

  const filtered: ShortcutCategory[] = SHORTCUT_CATEGORIES
    .map((cat) => ({
      ...cat,
      shortcuts: cat.shortcuts.filter(
        (s) =>
          !search ||
          s.label.toLowerCase().includes(search.toLowerCase()) ||
          s.keys.some((k) => k.toLowerCase().includes(search.toLowerCase())),
      ),
    }))
    .filter((cat) => cat.shortcuts.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[80vh] flex flex-col"
        aria-label="Keyboard shortcut reference"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Shortcuts are ignored when typing in text fields.
          </DialogDescription>
        </DialogHeader>

        <input
          type="search"
          placeholder="Search shortcuts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search keyboard shortcuts"
          className="w-full bg-background border border-border rounded-md h-8 px-3 font-mono text-sm mb-1"
        />

        <div
          className="flex-1 overflow-y-auto space-y-4 pr-1"
          role="list"
          aria-label="Keyboard shortcut categories"
        >
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No shortcuts match "{search}".
            </p>
          )}
          {filtered.map((cat) => (
            <section key={cat.category} role="listitem" aria-label={cat.category}>
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary mb-1.5 pb-1 border-b border-border">
                {cat.category}
              </div>
              <div className="space-y-1">
                {cat.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex items-center justify-between gap-3 px-2 py-1.5 rounded border border-border bg-background/40"
                  >
                    <span className="text-sm">{shortcut.label}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {shortcut.keys.map((k, i) => (
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
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
