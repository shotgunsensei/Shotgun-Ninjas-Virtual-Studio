import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore, getStore } from "../store";
import { useMidi } from "../lib/midi/midi";

export function MidiPanel() {
  const midi = useMidi();
  const project = useStore((s) => s.project);
  const monitor = useStore((s) => s.midiMonitor);

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

      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mt-1 mb-1">
        Mappings
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {project.midiMappings.length === 0 && (
          <p className="text-[11px] text-muted-foreground font-mono">
            None. Click any brain icon to learn a mapping.
          </p>
        )}
        {project.midiMappings.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between gap-2 panel-inset rounded px-2 py-1"
          >
            <div className="text-[11px] font-mono truncate">
              <span className="text-foreground/90">{m.label}</span>{" "}
              <span className="text-muted-foreground">{m.signature}</span>
            </div>
            <button
              onClick={() => getStore().removeMapping(m.id)}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Remove mapping"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

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
            <span className="text-muted-foreground">
              {e.data1}, {e.data2}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
