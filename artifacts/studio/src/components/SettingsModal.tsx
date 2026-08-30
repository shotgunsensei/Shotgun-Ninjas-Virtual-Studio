import { useState } from "react";
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
import { RotateCcw, KeyRound, Trash2, Gauge, Globe, Accessibility } from "lucide-react";
import * as Tone from "tone";
import {
  AUTOSAVE_OPTIONS,
  DEFAULT_AUTOSAVE_INTERVAL_SEC,
  DEFAULT_SETTINGS,
  resetSettings,
  setAutosaveEnabled,
  setAutosaveInterval,
  setSettings,
  type AutosaveIntervalSec,
  useSettings,
} from "../lib/settings";
import { THEMES } from "../lib/themes";
import { SHORTCUTS } from "./ShortcutOverlay";
import { useMidi } from "../lib/midi/midi";
import { getStore, useStore } from "../store";
import { lookaheadScheduler } from "../lib/audio/lookahead-scheduler";
import { audio } from "../lib/audio/engine";
import { useWorld } from "../contexts/WorldContext";
import { WorldPickerModal } from "./WorldPicker";

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
          <TabsList className="grid grid-cols-7 w-full bg-graphite/60">
            <TabsTrigger value="audio">Audio</TabsTrigger>
            <TabsTrigger value="ui">UI</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
            <TabsTrigger value="project">Project</TabsTrigger>
            <TabsTrigger value="keyboard">Keys</TabsTrigger>
            <TabsTrigger value="midi">MIDI</TabsTrigger>
            <TabsTrigger value="interop">Formats</TabsTrigger>
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

            {/* ── Phase 6: Pro Audio Engine ──────────────────────────────── */}
            <div className="border-t border-border pt-3 mt-1">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                <Gauge className="w-3 h-3" />
                Pro Audio Engine
              </div>

              <ToggleRow
                label="2× Oversampling (saturation)"
                hint="Reduces aliasing in the master saturation stage. Costs extra CPU — a warning appears in the diagnostics panel at high voice counts."
                value={s.oversampleEnabled}
                onChange={(v) => {
                  setSettings({ oversampleEnabled: v });
                  // Sync to the master chain immediately.
                  import("../lib/audio/master").then(({ MasterChain: _ }) => {
                    import("../lib/audio/engine").then(({ audio }) => {
                      audio.setMasterBus({ oversample: v });
                    });
                  });
                }}
              />

              <WorkletDrumsToggleRow />

              <LatencyCalibrationRow
                latencyOffsetMs={s.latencyOffsetMs}
                onChange={(ms) => {
                  setSettings({ latencyOffsetMs: ms });
                  lookaheadScheduler.setLatencyOffset(ms);
                }}
              />
            </div>
          </TabsContent>

          <TabsContent value="ui" className="space-y-3 pt-3">
            <StudioWorldRow />
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
                    aria-pressed={s.themeId === t.id}
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
                sounds. The "High Contrast" theme targets WCAG AA contrast ratios.
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
              hint="Stops the drifting backdrop, LED glows, tempo-synced pulse, and all transition effects."
              value={s.reduceAnimations}
              onChange={(v) => setSettings({ reduceAnimations: v })}
            />
            <ToggleRow
              label="Performance mode"
              hint="Reduces meter update rate to 15 fps, hides background particle effects, and strips expensive CSS glows. Recommended on older or lower-powered devices."
              value={s.performanceMode}
              onChange={(v) => setSettings({ performanceMode: v })}
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

            {/* ── UI Mode ─────────────────────────────────────────────── */}
            <div className="border-t border-border pt-3 mt-1">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                Experience level
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["beginner", "expert"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSettings({ uiMode: mode })}
                    aria-pressed={s.uiMode === mode}
                    className={`text-left border rounded-md p-2 transition-colors ${
                      s.uiMode === mode
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent/40"
                    }`}
                  >
                    <div className="font-mono text-xs uppercase tracking-wider capitalize">
                      {mode}
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-snug">
                      {mode === "beginner"
                        ? "Hides EQ bands, sends, swing %, probability & micro-timing behind a 'Show advanced' expander. Tooltips always on."
                        : "Shows all controls at once — full access to every knob and parameter."}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="access" className="space-y-3 pt-3">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              <Accessibility className="w-3 h-3" />
              Accessibility
            </div>
            <ToggleRow
              label="Colorblind-safe meters"
              hint="Replaces red/green clip indicators with a striped pattern and ⚠ symbol so clipping is visible without relying on color alone."
              value={s.colorblindSafeMeters}
              onChange={(v) => setSettings({ colorblindSafeMeters: v })}
            />
            <ToggleRow
              label="Reduce animations"
              hint="Also found in the UI tab. Suppresses the tempo-synced pulse, LED glows, drifting backdrop, and all CSS transitions."
              value={s.reduceAnimations}
              onChange={(v) => setSettings({ reduceAnimations: v })}
            />
            <div className="border-t border-border pt-3">
              <p className="text-[10px] text-muted-foreground leading-snug">
                <strong className="text-foreground">Keyboard navigation:</strong> Every control is reachable by Tab. Use Space/Enter to activate buttons. Focus rings follow the active theme color.
              </p>
            </div>
            <div className="border-t border-border pt-3">
              <p className="text-[10px] text-muted-foreground leading-snug">
                <strong className="text-foreground">Screen reader support:</strong> Transport state, track names, meter levels, and control changes are announced via ARIA live regions and labels.
              </p>
            </div>
            <div className="border-t border-border pt-3">
              <p className="text-[10px] text-muted-foreground leading-snug">
                <strong className="text-foreground">High Contrast theme:</strong> Select "High Contrast" in the UI → Theme section for WCAG AA contrast ratios and bold borders on all interactive elements.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="project" className="space-y-3 pt-3">
            <ToggleRow
              label="Auto-save"
              hint="Save the project and its recovery draft to this browser as you work."
              value={s.autosaveEnabled}
              onChange={setAutosaveEnabled}
            />
            <SelectRow
              label="Auto-save interval"
              hint="Cadence for durable project saves; recovery drafts use a separate safe debounce."
              value={String(
                s.autosaveIntervalSec || DEFAULT_AUTOSAVE_INTERVAL_SEC,
              )}
              options={AUTOSAVE_OPTIONS.filter((option) => option.value !== 0).map(
                (option) => ({ value: String(option.value), label: option.label }),
              )}
              disabled={!s.autosaveEnabled}
              onChange={(v) =>
                setAutosaveInterval(Number(v) as AutosaveIntervalSec)
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
            <SelectRow
              label="Backup reminder"
              hint="Show a reminder to export a project backup every N sessions. Set to 0 to disable."
              value={String(s.backupReminderSessions)}
              options={[
                { value: "0", label: "Off" },
                { value: "3", label: "Every 3 sessions" },
                { value: "5", label: "Every 5 sessions (default)" },
                { value: "10", label: "Every 10 sessions" },
                { value: "20", label: "Every 20 sessions" },
              ]}
              onChange={(v) => setSettings({ backupReminderSessions: Number(v) || 0 })}
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

          <TabsContent value="interop">
            <InteropTabContent />
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

/**
 * A/B toggle for the AudioWorklet sample player path on kick and snare.
 * Reads the live engine flag (not persisted — resets to `true` on reload,
 * which is the desired default). Useful for A/B comparison during a session.
 */
function WorkletDrumsToggleRow() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return (audio as unknown as { getWorkletDrumsEnabled?: () => boolean })
        .getWorkletDrumsEnabled?.() ?? true;
    } catch {
      return true;
    }
  });

  const workletReady = audio.getWorkletStatus().ready;

  return (
    <Row
      label="Worklet drum player (kick & snare)"
      hint={
        workletReady
          ? "Routes kick and snare through the audio thread for sample-accurate timing. Toggle to A/B compare against the main-thread Tone.Player path."
          : "AudioWorklet path is disabled by default during stabilization. Set VITE_STUDIO_ENABLE_AUDIO_WORKLETS=1 for profiling builds."
      }
    >
      <Switch
        checked={enabled}
        disabled={!workletReady}
        onCheckedChange={(v) => {
          setEnabled(v);
          try {
            (audio as unknown as { setWorkletDrumsEnabled?: (on: boolean) => void })
              .setWorkletDrumsEnabled?.(v);
          } catch {
            // ignore if audio not yet unlocked
          }
        }}
      />
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
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label} hint={hint}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="bg-background border border-border rounded-md h-7 px-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-50"
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
/**
 * Latency calibration row — reads AudioContext.baseLatency + outputLatency
 * from the browser and lets the user fine-tune or manually enter a value.
 * The measured value is stored in settings.latencyOffsetMs and applied to
 * the LookaheadScheduler so it compensates for measured output delay.
 */
function LatencyCalibrationRow({
  latencyOffsetMs,
  onChange,
}: {
  latencyOffsetMs: number;
  onChange: (ms: number) => void;
}) {
  const [measuring, setMeasuring] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);

  const handleMeasure = async () => {
    setMeasuring(true);
    try {
      const rawCtx = Tone.getContext().rawContext as AudioContext & {
        baseLatency?: number;
        outputLatency?: number;
      };
      const base   = typeof rawCtx.baseLatency   === "number" ? rawCtx.baseLatency   : 0;
      const output = typeof rawCtx.outputLatency === "number" ? rawCtx.outputLatency : 0;
      const totalMs = Math.round((base + output) * 1000);
      setMeasured(totalMs);
      onChange(totalMs);
    } catch {
      setMeasured(null);
    } finally {
      setMeasuring(false);
    }
  };

  return (
    <Row
      label="Output latency offset"
      hint="Milliseconds the scheduler subtracts from audio event times to compensate for measured output delay."
    >
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={500}
          step={1}
          value={latencyOffsetMs}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="bg-background border border-border rounded-md h-7 w-16 text-center font-mono text-sm"
        />
        <span className="font-mono text-[10px] text-muted-foreground">ms</span>
        <Button
          size="sm"
          variant="outline"
          className="font-mono text-[10px] h-7"
          disabled={measuring}
          onClick={handleMeasure}
          title="Read AudioContext.baseLatency + outputLatency from browser"
        >
          {measuring ? "…" : "Measure"}
        </Button>
        {measured !== null && (
          <span className="font-mono text-[10px] text-primary">
            ={measured} ms
          </span>
        )}
      </div>
    </Row>
  );
}

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

function InteropTabContent() {
  const formats = [
    {
      id: "midi",
      label: "MIDI (.mid)",
      icon: "🎹",
      desc: "Standard MIDI File (SMF Type 1). Export all instrument and drum tracks — import into Ableton, Logic, FL Studio, Reaper, GarageBand, and any notation app.",
      status: "supported" as const,
    },
    {
      id: "stems",
      label: "Stems WAV (.wav)",
      icon: "🎛️",
      desc: "One isolated WAV per track, zipped together. Gives mixers and collaborators independent control over every element of the arrangement.",
      status: "supported" as const,
    },
    {
      id: "musicxml",
      label: "MusicXML 4.0 (.musicxml)",
      icon: "🎼",
      desc: "Open standard for music notation. Import into MuseScore, Sibelius, Finale, Dorico, or Noteflight for printing, arranging or orchestration.",
      status: "supported" as const,
    },
    {
      id: "snproj",
      label: "Project File (.snproj.json)",
      icon: "📁",
      desc: "Re-importable project snapshot with all track data, clip positions, BPM and mixer settings. Use to share sessions with other Shotgun Ninjas users or keep backups.",
      status: "supported" as const,
    },
    {
      id: "dawpack",
      label: "DAW Pack (.zip)",
      icon: "📦",
      desc: "One-click bundle: full mix WAV + individual stems + MIDI files + project file + README with BPM, track listing and export timestamp.",
      status: "supported" as const,
    },
    {
      id: "dawproject",
      label: "DAWproject (.dawproject)",
      icon: "🔮",
      desc: "Universal DAW interchange format supported by Bitwig, Reaper, and others. Full session graph export including automation lanes.",
      status: "coming-soon" as const,
      link: "https://dawproject.org",
    },
  ];

  return (
    <div className="space-y-3 pt-3 max-h-96 overflow-y-auto pr-1">
      <p className="text-[11px] text-muted-foreground leading-snug">
        Shotgun Ninjas exports to open formats so you can continue working in any DAW — no lock-in.
        All exports respect the current export range (loop region or full project).
      </p>
      <div className="space-y-2">
        {formats.map((f) => (
          <div
            key={f.id}
            className={`border rounded-md p-3 ${
              f.status === "coming-soon"
                ? "border-border bg-background/30 opacity-70"
                : "border-border bg-background/50"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">{f.icon}</span>
                <span className="font-mono text-xs font-medium">{f.label}</span>
              </div>
              {f.status === "coming-soon" ? (
                <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border border-border rounded px-1.5 py-0.5 shrink-0">
                  Coming Soon
                </span>
              ) : (
                <span className="font-mono text-[9px] uppercase tracking-widest text-emerald-500 border border-emerald-500/30 rounded px-1.5 py-0.5 shrink-0">
                  Supported
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug mt-1.5 ml-6">
              {f.desc}
              {f.link && (
                <>
                  {" "}
                  <a
                    href={f.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Spec ↗
                  </a>
                </>
              )}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Open the Export dialog (Ctrl/⌘+E) to access all supported formats.
      </p>
    </div>
  );
}

/**
 * Studio World row for the UI settings tab — shows the active world name
 * and a button to open the world picker modal.
 */
function StudioWorldRow() {
  const { activeWorld } = useWorld();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="border border-border rounded-md p-3 bg-background/40">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
        <Globe className="w-3 h-3" />
        Studio World
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {activeWorld.swatchColors.map((color, i) => (
                <div
                  key={i}
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <span className="font-mono text-xs font-semibold">
              {activeWorld.name}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {activeWorld.tagline}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPickerOpen(true)}
          className="shrink-0 h-7 text-[10px] font-mono uppercase tracking-widest"
        >
          Change
        </Button>
      </div>
      <WorldPickerModal open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}
