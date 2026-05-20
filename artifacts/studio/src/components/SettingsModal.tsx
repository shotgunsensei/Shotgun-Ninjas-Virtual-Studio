import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { RotateCcw, KeyRound, Trash2 } from "lucide-react";
import {
  DEFAULT_SETTINGS,
  resetSettings,
  setSettings,
  useSettings,
} from "../lib/settings";
import { THEMES } from "../lib/themes";
import { SHORTCUTS } from "./ShortcutOverlay";
import { useMidi } from "../lib/midi/midi";
import { getStore, useStore } from "../store";

/**
 * Project-wide settings modal. Backed by `lib/settings.ts` and split
 * into five sections that map onto the Phase 3 polish spec. The MIDI
 * tab is intentionally surfaced even though the MIDI runtime is a
 * separate task — values persist into the same store the runtime will
 * read from once it ships.
 */
export function SettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const s = useSettings();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>Settings</span>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm("Reset all studio settings to defaults?")
                ) {
                  resetSettings();
                }
              }}
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
              aria-label="Reset settings"
            >
              <RotateCcw className="w-3 h-3" />
              Reset all
            </button>
          </DialogTitle>
          <DialogDescription>
            Saved locally to this browser. Free, no account.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="audio" className="w-full">
          <TabsList className="grid grid-cols-5 w-full bg-graphite/60">
            <TabsTrigger value="audio">Audio</TabsTrigger>
            <TabsTrigger value="ui">UI</TabsTrigger>
            <TabsTrigger value="project">Project</TabsTrigger>
            <TabsTrigger value="keyboard">Keyboard</TabsTrigger>
            <TabsTrigger value="midi">MIDI</TabsTrigger>
          </TabsList>

          <TabsContent value="audio" className="space-y-3 pt-3">
            <NumberRow
              label="Default BPM"
              hint="Used when creating a new project."
              value={s.defaultBpm}
              min={40}
              max={240}
              onChange={(v) => setSettings({ defaultBpm: v })}
            />
            <SelectRow
              label="Default kit"
              hint="The drum kit for new drum tracks."
              value={s.defaultKit}
              options={[
                { value: "boombap", label: "Boom Bap" },
                { value: "trap", label: "Trap" },
                { value: "cyberpunk", label: "Cyberpunk" },
                { value: "lofi", label: "Lo-Fi" },
                { value: "cinematic", label: "Cinematic" },
              ]}
              onChange={(v) =>
                setSettings({
                  defaultKit: v as typeof DEFAULT_SETTINGS.defaultKit,
                })
              }
            />
            <SliderRow
              label="Default master volume"
              hint="Applied to fresh projects."
              value={s.defaultMasterVolume}
              onChange={(v) => setSettings({ defaultMasterVolume: v })}
            />
            <SliderRow
              label="Metronome volume"
              value={s.metronomeVolume}
              onChange={(v) => setSettings({ metronomeVolume: v })}
            />
            <SelectRow
              label="Latency mode"
              hint="Trade latency vs CPU. Takes effect on next audio start."
              value={s.latencyMode}
              options={[
                { value: "balanced", label: "Balanced" },
                { value: "low", label: "Low (live play)" },
                { value: "playback", label: "Playback (smoothest)" },
              ]}
              onChange={(v) =>
                setSettings({
                  latencyMode: v as typeof DEFAULT_SETTINGS.latencyMode,
                })
              }
            />
          </TabsContent>

          <TabsContent value="ui" className="space-y-3 pt-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                Theme
              </div>
              <div className="grid grid-cols-2 gap-2">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSettings({ themeId: t.id })}
                    className={`text-left border rounded-md p-2 transition-colors ${
                      s.themeId === t.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent/40"
                    }`}
                  >
                    <div className="font-mono text-xs uppercase tracking-wider">
                      {t.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-snug">
                      {t.description}
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Themes are purely cosmetic — they never change how your music
                sounds.
              </p>
            </div>
            <ToggleRow
              label="Compact mode"
              hint="Tighter spacing for smaller displays."
              value={s.compactMode}
              onChange={(v) => setSettings({ compactMode: v })}
            />
            <ToggleRow
              label="Show tooltips"
              hint="Hover hints on advanced controls."
              value={s.showTooltips}
              onChange={(v) => setSettings({ showTooltips: v })}
            />
            <ToggleRow
              label="Reduce animations"
              hint="Stops the drifting backdrop and meter glow."
              value={s.reduceAnimations}
              onChange={(v) => setSettings({ reduceAnimations: v })}
            />
            <SelectRow
              label="Default workspace view"
              value={s.defaultWorkspaceView}
              options={[
                { value: "compose", label: "Compose" },
                { value: "mix", label: "Mix" },
                { value: "perform", label: "Perform" },
              ]}
              onChange={(v) =>
                setSettings({
                  defaultWorkspaceView:
                    v as typeof DEFAULT_SETTINGS.defaultWorkspaceView,
                })
              }
            />
          </TabsContent>

          <TabsContent value="project" className="space-y-3 pt-3">
            <ToggleRow
              label="Auto-save"
              hint="Quietly save your project to this browser as you work."
              value={s.autosaveEnabled}
              onChange={(v) => setSettings({ autosaveEnabled: v })}
            />
            <SelectRow
              label="Auto-save interval"
              value={String(s.autosaveIntervalMs)}
              options={[
                { value: "500", label: "500 ms (fast)" },
                { value: "1500", label: "1.5 s (default)" },
                { value: "5000", label: "5 s" },
                { value: "15000", label: "15 s" },
              ]}
              onChange={(v) =>
                setSettings({ autosaveIntervalMs: Number(v) || 1500 })
              }
            />
            <ToggleRow
              label="Restore last project on launch"
              value={s.restoreLastProjectOnLaunch}
              onChange={(v) => setSettings({ restoreLastProjectOnLaunch: v })}
            />
            <ToggleRow
              label="Confirm before overwriting"
              hint="Ask before New replaces the current project."
              value={s.confirmBeforeOverwrite}
              onChange={(v) => setSettings({ confirmBeforeOverwrite: v })}
            />
          </TabsContent>

          <TabsContent value="keyboard" className="space-y-3 pt-3">
            <ToggleRow
              label="Show shortcuts button"
              hint="Display the keyboard icon in the header."
              value={s.showShortcutsButton}
              onChange={(v) => setSettings({ showShortcutsButton: v })}
            />
            <div className="border border-border rounded-md p-3 bg-background/40">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <KeyRound className="w-3 h-3" />
                  Shortcut reference
                </div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Press <kbd className="px-1 py-0.5 border border-border rounded">?</kbd> anywhere
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                {SHORTCUTS.map((sc) => (
                  <div
                    key={sc.label}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="truncate">{sc.label}</span>
                    <span className="flex gap-1">
                      {sc.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="px-1.5 py-0.5 rounded border border-border bg-graphite font-mono text-[9px] uppercase"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Built-in shortcuts aren't customizable yet — coming in a
                future update.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="midi" className="space-y-3 pt-3">
            <MidiSection />
            <ToggleRow
              label="MIDI passthrough"
              hint="Forward incoming notes to the selected track's instrument. When off, only learned mappings respond."
              value={s.midiPassthrough}
              onChange={(v) => setSettings({ midiPassthrough: v })}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function NumberRow({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) =>
          onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))
        }
        className="bg-background border border-border rounded-md h-7 w-20 text-center font-mono text-sm"
      />
    </Row>
  );
}

function SliderRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <div className="flex items-center gap-2 w-44">
        <Slider
          value={[Math.round(value * 100)]}
          max={100}
          step={1}
          onValueChange={([v]) => onChange((v ?? 0) / 100)}
        />
        <span className="font-mono text-xs w-8 text-right">
          {Math.round(value * 100)}
        </span>
      </div>
    </Row>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <Switch checked={value} onCheckedChange={onChange} />
    </Row>
  );
}

function SelectRow({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background border border-border rounded-md h-7 px-2 font-mono text-xs"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="flex-1 min-w-0">
        <div className="text-sm">{label}</div>
        {hint && (
          <div className="text-[10px] text-muted-foreground leading-snug">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * MIDI section for the Settings modal. Strict opt-in: no permission is
 * requested and no Web MIDI API calls are made until the user clicks
 * "Enable MIDI". Renders a clear fallback message on browsers that
 * don't expose Web MIDI at all.
 */
function MidiSection() {
  const midi = useMidi();
  const mappings = useStore((s) => s.project.midiMappings);
  const learnId = useStore((s) => s.midiLearnTargetId);

  if (midi.status === "unsupported") {
    return (
      <div className="border border-border rounded-md p-3 bg-background/40 space-y-1">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          MIDI controller
        </div>
        <p className="text-xs leading-snug">
          MIDI control is not supported in this browser. The studio still
          works normally with mouse, touch, and keyboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="border border-border rounded-md p-3 bg-background/40 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            MIDI controller
          </div>
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
          <>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Strictly opt-in. Click below to grant browser MIDI access and
              connect a hardware controller.
            </p>
            <Button size="sm" onClick={midi.requestAccess}>
              Enable MIDI
            </Button>
          </>
        )}

        {midi.status === "denied" && (
          <p className="text-[11px] text-destructive leading-snug">
            Permission denied. Reload the page and grant MIDI access to use
            a controller.
          </p>
        )}

        {midi.status === "ready" && (
          <Row
            label="MIDI input"
            hint={
              midi.inputs.length === 0
                ? "No controllers detected. Plug one in and it will appear."
                : "Choose which connected device to listen to."
            }
          >
            <select
              value={midi.selectedId ?? ""}
              disabled={midi.inputs.length === 0}
              onChange={(e) => midi.selectInput(e.target.value || null)}
              className="bg-background border border-border rounded-md h-7 px-2 font-mono text-xs disabled:opacity-50"
            >
              <option value="">(none)</option>
              {midi.inputs.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Row>
        )}
      </div>

      <div className="border border-border rounded-md p-3 bg-background/40 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            MIDI Learn mappings
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="font-mono text-[10px] h-6"
              disabled={mappings.length === 0}
              onClick={() => {
                const blob = new Blob(
                  [JSON.stringify(mappings, null, 2)],
                  { type: "application/json" },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "midi-mappings.json";
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                getStore().setStatus("MIDI mappings exported", "info");
              }}
            >
              Export
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="font-mono text-[10px] h-6"
              disabled={mappings.length === 0 && !learnId}
              onClick={() => {
                if (!window.confirm("Clear all MIDI mappings for this project?"))
                  return;
                if (learnId) getStore().cancelMidiLearn();
                for (const m of [...mappings]) getStore().removeMapping(m.id);
                getStore().setStatus("All MIDI mappings reset", "info");
              }}
            >
              Reset all
            </Button>
          </div>
        </div>
        {mappings.length === 0 ? (
          <p className="text-[11px] text-muted-foreground leading-snug">
            None yet. Click any brain icon next to a control (transport,
            metronome, channel volume, drum pad) and then move a knob or
            press a key on your controller to bind it.
          </p>
        ) : (
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {mappings.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-2 panel-inset rounded px-2 py-1"
              >
                <div className="text-[11px] font-mono truncate">
                  <span className="text-foreground/90">{m.label}</span>{" "}
                  <span className="text-muted-foreground">
                    {m.signature || "(learning…)"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => getStore().removeMapping(m.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove mapping for ${m.label}`}
                  title="Remove mapping"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-muted-foreground leading-snug">
          Mappings persist with your project. Sysex is never requested.
        </p>
      </div>
    </div>
  );
}
