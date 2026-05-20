import { useSyncExternalStore } from "react";
import { applyTheme, type ThemeId } from "./themes";

/**
 * Studio-wide user settings. Persisted to localStorage under a single
 * key. Independent of project state so the same preferences carry across
 * every project the user opens.
 *
 * MIDI fields are present even though the MIDI implementation is a
 * separate task — the settings UI exposes them today and the runtime
 * will read from the same store once it ships.
 */

export type LatencyMode = "balanced" | "low" | "playback";
export type WorkspaceView = "compose" | "mix" | "perform";

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
  autosaveIntervalMs: number;
  restoreLastProjectOnLaunch: boolean;
  confirmBeforeOverwrite: boolean;

  // Keyboard
  showShortcutsButton: boolean;

  // MIDI (UI exposed; consumed once the MIDI task lands)
  midiEnabled: boolean;
  midiInputId: string | null;
  midiPassthrough: boolean;
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
  autosaveIntervalMs: 1500,
  restoreLastProjectOnLaunch: true,
  confirmBeforeOverwrite: true,

  showShortcutsButton: true,

  midiEnabled: false,
  midiInputId: null,
  midiPassthrough: true,
};

const STORAGE_KEY = "studio.settings.v1";

function loadInitial(): StudioSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<StudioSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
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

export function setSettings(patch: Partial<StudioSettings>) {
  state = { ...state, ...patch };
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
  root.dataset.workspaceView = s.defaultWorkspaceView;
}

// Apply once at module-load so the first paint already reflects the
// stored UI preferences (no flash of large/animated chrome).
if (typeof document !== "undefined") {
  applySideEffects(state);
}
