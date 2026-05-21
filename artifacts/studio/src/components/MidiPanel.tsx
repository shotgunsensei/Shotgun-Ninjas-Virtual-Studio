import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore, getStore } from "../store";
import { useMidi } from "../lib/midi/midi";

export function MidiPanel() {
  const midi = useMidi();
  const project = useStore((s) => s.project);
  const monitor = useStore((s) => s.midiMonitor);
  const presets = useStore((s) => s.midiMappingPresets);

  const liveValues = useMemo(() => {
    const map: Record<string, { value: number; ts: number }> = {};
    for (const entry of monitor) {
      const sig =
        entry.type === "cc"
          ? `cc:${entry.data1}`
          : entry.type === "noteon" || entry.type === "noteoff"
            ? `note:${entry.data1}`
            : null;
      if (sig && !(sig in map)) {
        map[sig] = { value: entry.data2, ts: entry.ts };
      }
    }
    return map;
  }, [monitor]);

  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const prevTsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const newFlash: string[] = [];
    for (const m of project.midiMappings) {
      const live = liveValues[m.signature];
      if (!live) continue;
      const prev = prevTsRef.current[m.id];
      if (prev === undefined || live.ts > prev) {
        prevTsRef.current[m.id] = live.ts;
        newFlash.push(m.id);
      }
    }
    if (newFlash.length === 0) return;
    setFlashIds((prev) => {
      const next = new Set(prev);
      for (const id of newFlash) next.add(id);
      return next;
    });
    const timer = setTimeout(() => {
      setFlashIds((prev) => {
        const next = new Set(prev);
        for (const id of newFlash) next.delete(id);
        return next;
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [liveValues, project.midiMappings]);

  // ---- preset save state ----
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState("");
  const presetInputRef = useRef<HTMLInputElement>(null);

  const handleStartSave = () => {
    setPresetNameInput("");
    setSavingPreset(true);
    setTimeout(() => presetInputRef.current?.focus(), 0);
  };

  const handleConfirmSave = () => {
    const name = presetNameInput.trim();
    if (!name) return;
    getStore().saveMidiMappingPreset(name);
    setSavingPreset(false);
    setPresetNameInput("");
  };

  const handleCancelSave = () => {
    setSavingPreset(false);
    setPresetNameInput("");
  };

  // ---- preset rename state ----
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleStartRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameInput(currentName);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const handleConfirmRename = () => {
    if (!renamingId) return;
    getStore().renameMidiMappingPreset(renamingId, renameInput);
    setRenamingId(null);
    setRenameInput("");
  };

  const handleCancelRename = () => {
    setRenamingId(null);
    setRenameInput("");
  };

  return (
    <div className="panel p-3 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          MIDI
        </span>
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
            midi.status === "ready"
              ? "bg-neon/20 text-neon"
              : midi.status === "denied" || midi.status === "error"
                ? "bg-destructive/30 text-destructive-foreground"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {midi.status}
        </span>
      </div>

      {midi.status === "no-access-yet" && (
        <Button size="sm" onClick={midi.requestAccess} className="mb-2">
          Enable MIDI
        </Button>
      )}
      {midi.status === "unsupported" && (
        <p className="text-[11px] text-muted-foreground font-mono mb-2">
          Web MIDI is not supported in this browser. Use Chrome or Edge.
        </p>
      )}
      {midi.status === "denied" && (
        <p className="text-[11px] text-destructive font-mono mb-2">
          Permission denied. Reload and grant MIDI access to use a controller.
        </p>
      )}

      {midi.status === "ready" && (
        <div className="mb-2">
          <Select
            value={midi.selectedId ?? ""}
            onValueChange={(v) => midi.selectInput(v || null)}
          >
            <SelectTrigger className="bg-background h-8 text-xs">
              <SelectValue placeholder="Select MIDI input" />
            </SelectTrigger>
            <SelectContent>
              {midi.inputs.length === 0 && (
                <SelectItem value="__none" disabled>
                  No MIDI inputs detected
                </SelectItem>
              )}
              {midi.inputs.map((i) => (
                <SelectItem key={i.id} value={i.id} className="text-xs">
                  {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ---- Mappings section ---- */}
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mt-1 mb-1">
        Mappings
      </div>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {project.midiMappings.length === 0 && (
          <p className="text-[11px] text-muted-foreground font-mono">
            None. Click any brain icon to learn a mapping.
          </p>
        )}
        {project.midiMappings.map((m) => {
          const live = liveValues[m.signature];
          const isFlashing = flashIds.has(m.id);
          const pct = live ? Math.round((live.value / 127) * 100) : null;
          return (
            <div
              key={m.id}
              className={`flex items-center justify-between gap-2 panel-inset rounded px-2 py-1 transition-colors duration-150 ${
                isFlashing ? "bg-neon/10 ring-1 ring-neon/30" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-mono truncate">
                  <span className="text-foreground/90">{m.label}</span>{" "}
                  <span className="text-muted-foreground">{m.signature}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-75 ${
                        isFlashing ? "bg-neon" : "bg-neon/40"
                      }`}
                      style={{ width: pct !== null ? `${pct}%` : "0%" }}
                    />
                  </div>
                  <span
                    className={`text-[10px] font-mono tabular-nums w-6 text-right ${
                      isFlashing
                        ? "text-neon"
                        : pct !== null
                          ? "text-muted-foreground"
                          : "text-muted-foreground/40"
                    }`}
                  >
                    {pct !== null ? live!.value : "—"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => getStore().removeMapping(m.id)}
                className="text-muted-foreground hover:text-destructive flex-shrink-0"
                aria-label="Remove mapping"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* ---- Preset Banks section ---- */}
      <div className="flex items-center justify-between mt-3 mb-1">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          Preset Banks
        </span>
        {!savingPreset && (
          <button
            onClick={handleStartSave}
            disabled={project.midiMappings.length === 0}
            className="text-muted-foreground hover:text-neon disabled:opacity-30 disabled:cursor-not-allowed"
            title={
              project.midiMappings.length === 0
                ? "Add mappings first"
                : "Save current mappings as a preset"
            }
            aria-label="Save preset"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {savingPreset && (
        <div className="flex items-center gap-1 mb-1">
          <input
            ref={presetInputRef}
            type="text"
            value={presetNameInput}
            onChange={(e) => setPresetNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirmSave();
              if (e.key === "Escape") handleCancelSave();
            }}
            placeholder="Preset name…"
            className="flex-1 bg-background border border-border rounded px-2 py-0.5 text-[11px] font-mono outline-none focus:border-neon/50"
          />
          <button
            onClick={handleConfirmSave}
            disabled={!presetNameInput.trim()}
            className="text-neon hover:text-neon/80 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Confirm save"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleCancelSave}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Cancel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="space-y-1 max-h-32 overflow-y-auto">
        {presets.length === 0 && (
          <p className="text-[11px] text-muted-foreground font-mono">
            No presets yet. Save the current mappings with +.
          </p>
        )}
        {presets.map((preset) => (
          <div
            key={preset.id}
            className="flex items-center gap-1 panel-inset rounded px-2 py-1"
          >
            {renamingId === preset.id ? (
              <>
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmRename();
                    if (e.key === "Escape") handleCancelRename();
                  }}
                  className="flex-1 bg-background border border-border rounded px-1.5 py-0.5 text-[11px] font-mono outline-none focus:border-neon/50"
                />
                <button
                  onClick={handleConfirmRename}
                  disabled={!renameInput.trim()}
                  className="text-neon hover:text-neon/80 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                  aria-label="Confirm rename"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  onClick={handleCancelRename}
                  className="text-muted-foreground hover:text-destructive flex-shrink-0"
                  aria-label="Cancel rename"
                >
                  <X className="w-3 h-3" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => getStore().loadMidiMappingPreset(preset.id)}
                  className="flex-1 text-left text-[11px] font-mono truncate text-foreground/90 hover:text-neon transition-colors"
                  title={`Load "${preset.name}" (${preset.mappings.length} mappings)`}
                >
                  {preset.name}
                  <span className="text-muted-foreground ml-1">
                    ({preset.mappings.length})
                  </span>
                </button>
                <button
                  onClick={() => handleStartRename(preset.id, preset.name)}
                  className="text-muted-foreground hover:text-foreground flex-shrink-0"
                  aria-label="Rename preset"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={() => getStore().deleteMidiMappingPreset(preset.id)}
                  className="text-muted-foreground hover:text-destructive flex-shrink-0"
                  aria-label="Delete preset"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ---- Monitor section ---- */}
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mt-3 mb-1">
        Monitor
      </div>
      <div className="flex-1 overflow-y-auto panel-inset rounded p-1.5 font-mono text-[10px] leading-tight">
        {monitor.length === 0 && (
          <span className="text-muted-foreground">No MIDI traffic yet.</span>
        )}
        {monitor.map((e) => (
          <div key={e.id} className="flex justify-between gap-2">
            <span className="text-neon/90">{e.type}</span>
            <span className="text-foreground/60">ch{e.channel}</span>
            <span className="text-muted-foreground">
              {e.data1}, {e.data2}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
