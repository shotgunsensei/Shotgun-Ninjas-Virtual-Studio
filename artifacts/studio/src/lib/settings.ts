import { useSyncExternalStore } from "react";
import { applyTheme, type ThemeId } from "./themes";
import { visualTicker } from "./visualTicker";

/**
 * Studio-wide user settings. Persisted to localStorage under a single
 * key. Independent of project state so the same preferences carry across
 * every project the user opens.
 */

export type LatencyMode = "balanced" | "low" | "playback";
export type WorkspaceView = "compose" | "mix" | "perform";
export type UIMode = "beginner" | "expert";

/** Periodic real-autosave cadence options (in seconds; 0 = off). */
export type AutosaveIntervalSec = 0 | 15 | 30 | 60;

export const DEFAULT_AUTOSAVE_INTERVAL_SEC: Exclude<AutosaveIntervalSec, 0> = 30;

export const AUTOSAVE_OPTIONS: Array<{
  value: AutosaveIntervalSec;
  label: string;
}> = [
  { value: 0, label: "Off" },
  { value: 15, label: "15s" },
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
];

export interface StudioSettings {
  // Audio
  defaultBpm: number;
  defaultKit: "trap" | "boombap" | "cyberpunk" | "lofi" | "cinematic";
  defaultMasterVolume: number; // 0..1
  metronomeVolume: number; // 0..1
  latencyMode: LatencyMode;

  // UI
  themeId: ThemeId;
  compactMode: boolean;
  showTooltips: boolean;
  reduceAnimations: boolean;
  defaultWorkspaceView: WorkspaceView;

  // Project
  autosaveEnabled: boolean;
  autosaveIntervalSec: AutosaveIntervalSec;
  restoreLastProjectOnLaunch: boolean;
  confirmBeforeOverwrite: boolean;

  // Keyboard
  showShortcutsButton: boolean;

  // MIDI
  midiEnabled: boolean;
  midiInputId: string | null;
  midiPassthrough: boolean;
  /**
   * Per-device default channel preference. Key is the MIDI input device ID.
   * Value is 1-16 for a specific channel, or 0 meaning "any channel".
   */
  midiDeviceChannels: Record<string, number>;

  // Phase 6: Pro Audio Engine
  latencyOffsetMs: number;
  oversampleEnabled: boolean;

  // Export dialog — persisted so values survive dialog close / page reload
  exportRangeMode: "whole" | "loop" | "custom";
  exportStartBar: number;
  /** Stored as an absolute bar number; clamped to project.bars on read. */
  exportEndBar: number;

  // Phase 17: Release Engineering & Trust Layer
  /** Show a backup reminder toast every N sessions. 0 = disabled. */
  backupReminderSessions: number;

  // Phase 16: Accessibility & Learning Mode
  colorblindSafeMeters: boolean;
  uiMode: UIMode;

  // Performance Stabilization Pass
  /** When true: reduces meter FPS, disables background FX, strips CSS glows. */
  performanceMode: boolean;
}

export const DEFAULT_SETTINGS: StudioSettings = {
  defaultBpm: 96,
  defaultKit: "boombap",
  defaultMasterVolume: 0.8,
  metronomeVolume: 0.7,
  latencyMode: "balanced",

  themeId: "dojo-dark",
  compactMode: false,
  showTooltips: true,
  reduceAnimations: false,
  defaultWorkspaceView: "compose",

  autosaveEnabled: true,
  autosaveIntervalSec: DEFAULT_AUTOSAVE_INTERVAL_SEC,
  restoreLastProjectOnLaunch: true,
  confirmBeforeOverwrite: true,

  showShortcutsButton: true,

  midiEnabled: false,
  midiInputId: null,
  midiPassthrough: true,
  midiDeviceChannels: {},

  latencyOffsetMs: 0,
  oversampleEnabled: false,

  exportRangeMode: "whole",
  exportStartBar: 1,
  exportEndBar: 9999,

  backupReminderSessions: 5,
  colorblindSafeMeters: false,
  uiMode: "beginner",

  performanceMode: false,
};

const STORAGE_KEY = "studio.settings.v1";

type StoredSettings = Omit<
  Partial<StudioSettings>,
  "autosaveEnabled" | "autosaveIntervalSec"
> & {
  autosaveEnabled?: unknown;
  autosaveIntervalSec?: unknown;
  /** Legacy Settings-modal field that the stabilized runtime never consumed. */
  autosaveIntervalMs?: unknown;
};

function isAutosaveIntervalSec(value: unknown): value is AutosaveIntervalSec {
  return value === 0 || value === 15 || value === 30 || value === 60;
}

/**
 * Safely migrate the retired millisecond control to the bounded cadence used
 * by the storage runtime. Values below 15 seconds map to the fastest supported
 * cadence rather than re-introducing high-frequency IndexedDB serialization.
 */
function migrateLegacyAutosaveInterval(value: unknown): AutosaveIntervalSec | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0) return 0;
  if (value <= 15_000) return 15;
  if (value <= 30_000) return 30;
  return 60;
}

/** Normalize persisted v1 settings without dropping unrelated preferences. */
export function normalizeStoredSettings(input: unknown): StudioSettings {
  const stored = input && typeof input === "object" ? (input as StoredSettings) : {};
  const {
    autosaveEnabled: rawEnabled,
    autosaveIntervalSec: rawIntervalSec,
    autosaveIntervalMs: rawIntervalMs,
    ...otherSettings
  } = stored;
  const currentInterval = isAutosaveIntervalSec(rawIntervalSec)
    ? rawIntervalSec
    : undefined;
  const legacyInterval = migrateLegacyAutosaveInterval(rawIntervalMs);
  const migratedInterval = currentInterval ?? legacyInterval;
  const disabledByStoredInterval = migratedInterval === 0;
  const autosaveEnabled =
    !disabledByStoredInterval &&
    (typeof rawEnabled === "boolean"
      ? rawEnabled
      : DEFAULT_SETTINGS.autosaveEnabled);
  const autosaveIntervalSec = autosaveEnabled
    ? migratedInterval && migratedInterval > 0
      ? migratedInterval
      : DEFAULT_AUTOSAVE_INTERVAL_SEC
    : 0;

  return {
    ...DEFAULT_SETTINGS,
    ...(otherSettings as Partial<StudioSettings>),
    autosaveEnabled,
    autosaveIntervalSec,
  };
}

export function isAutosaveActive(
  settings: Pick<StudioSettings, "autosaveEnabled" | "autosaveIntervalSec">,
): boolean {
  return settings.autosaveEnabled && settings.autosaveIntervalSec > 0;
}

function loadInitial(): StudioSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeStoredSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let state: StudioSettings = loadInitial();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

export function getSettings(): StudioSettings {
  return state;
}

export function setAutosaveInterval(value: AutosaveIntervalSec) {
  setSettings({
    autosaveEnabled: value !== 0,
    autosaveIntervalSec: value,
  });
}

export function setAutosaveEnabled(enabled: boolean) {
  setSettings({
    autosaveEnabled: enabled,
    autosaveIntervalSec: enabled
      ? state.autosaveIntervalSec || DEFAULT_AUTOSAVE_INTERVAL_SEC
      : 0,
  });
}

export function subscribeSettings(fn: (s: StudioSettings) => void): () => void {
  const wrapper = () => fn(state);
  listeners.add(wrapper);
  return () => {
    listeners.delete(wrapper);
  };
}

export function setSettings(patch: Partial<StudioSettings>) {
  const next = { ...state, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "autosaveEnabled")) {
    next.autosaveIntervalSec = next.autosaveEnabled
      ? next.autosaveIntervalSec || DEFAULT_AUTOSAVE_INTERVAL_SEC
      : 0;
  } else if (Object.prototype.hasOwnProperty.call(patch, "autosaveIntervalSec")) {
    next.autosaveEnabled = next.autosaveIntervalSec !== 0;
  }
  state = normalizeStoredSettings(next);
  persist();
  listeners.forEach((l) => l());
  applySideEffects(state);
}

export function resetSettings() {
  state = { ...DEFAULT_SETTINGS };
  persist();
  listeners.forEach((l) => l());
  applySideEffects(state);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings<T = StudioSettings>(
  selector: (s: StudioSettings) => T = (s) => s as unknown as T,
): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

/**
 * Side-effects that follow a settings change. Themes, html-level
 * modifier classes, and the body data-attribute for animation gating
 * all live here so callers can `setSettings({ ... })` and forget.
 */
export function applySideEffects(s: StudioSettings = state) {
  if (typeof document === "undefined") return;
  try {
    applyTheme(s.themeId);
  } catch {
    /* ignore */
  }
  const root = document.documentElement;
  root.classList.toggle("studio-compact", s.compactMode);
  root.classList.toggle("studio-reduce-motion", s.reduceAnimations);
  // data-reduced-motion: allows CSS targeting with a single attribute selector
  // (used to gate pulse, LED glows, drifting backdrops, meter transitions)
  root.dataset.reducedMotion = s.reduceAnimations ? "1" : "0";
  // data-cb-safe: colorblind-safe meter mode
  root.dataset.cbSafe = s.colorblindSafeMeters ? "1" : "0";
  // data-ui-mode: beginner / expert
  root.dataset.uiMode = s.uiMode ?? "beginner";
  root.dataset.workspaceView = s.defaultWorkspaceView;
  // Performance Mode: data-perf="true" activates CSS overrides that strip
  // expensive box-shadow, blur, and glow effects from dense grids.
  document.body.dataset.perf = s.performanceMode ? "true" : "";
  // Throttle the shared visual ticker to 15 fps in performance mode.
  visualTicker.setFpsCap(s.performanceMode ? 15 : 25);
}

// Apply once at module-load so the first paint already reflects the
// stored UI preferences (no flash of large/animated chrome).
if (typeof document !== "undefined") {
  applySideEffects(state);
}
