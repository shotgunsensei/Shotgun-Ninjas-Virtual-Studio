/**
 * Plugin system types — Phase 10: Internal Plugin/Extension Architecture.
 *
 * Framework-agnostic so it can later align with the WAM (Web Audio Modules)
 * spec. Only primitive types here; no Tone.js imports, no React.
 *
 * Addressing scheme for automation targets:
 *   "{trackId}:{pluginId}:{parameterId}"
 * e.g. "abc123:effect.reverb:amount"
 */

export type PluginKind = "instrument" | "effect";

export type PluginStatus = "active" | "disabled" | "errored";

/**
 * Describes a single automatable parameter exposed by a plugin.
 * min/max/defaultValue use the same 0..1 (or unit-appropriate) scale
 * as the rest of the engine's normalised values.
 */
export interface PluginParameterDescriptor {
  id: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  /** When true this parameter can be targeted by an automation lane. */
  automatable: boolean;
  /** Optional display unit hint ("dB", "%", "Hz", "s", etc.). */
  unit?: string;
  /** Step size for discrete params (omit for continuous). */
  step?: number;
}

/**
 * The shared manifest contract for every instrument or effect plugin.
 *
 * factory: returns the DSP object (or null on failure). Instrument
 *   plugins return a MelodicVoice / DrumKit abstraction; effect plugins
 *   return an object whose set() method accepts parameter patches.
 *   Both shapes are opaque here — the engine host unwraps them.
 */
export interface PluginManifest<TInstance = unknown> {
  /** Stable, unique identifier. Use dot-namespacing: "instrument.bass.808" */
  id: string;
  kind: PluginKind;
  name: string;
  /** Semver string. */
  version: string;
  /** Human-readable category label for grouping in the browser. */
  category: string;
  /** Short description displayed in the plugin browser. */
  description?: string;
  /** Parameter descriptors (empty array for plugins with no exposed params). */
  parameters: PluginParameterDescriptor[];
  /**
   * Factory function. Called by the engine host when a track needs a new
   * instance of this plugin. Returns the DSP instance or throws/returns null
   * on error. The host wraps this in a try/catch (sandbox boundary).
   */
  factory: () => TInstance | null;
  /**
   * Optional teardown — called when the plugin is disabled or unregistered.
   * Must be idempotent (safe to call more than once).
   */
  dispose?: (instance: TInstance) => void;
  /**
   * Set when this plugin was loaded from an external WAM URL at runtime.
   * Undefined for all built-in plugins.
   */
  wamUrl?: string;
}

/**
 * Per-track plugin state held in the store.  Tracks which plugins are
 * disabled or have errored so the UI and engine can reflect that state
 * without re-querying the registry.
 */
export interface TrackPluginState {
  /** Set of plugin ids explicitly disabled on this track. */
  disabledPlugins: string[];
  /** Map of pluginId → error message for plugins that threw during factory. */
  erroredPlugins: Record<string, string>;
}

/**
 * Automation target address — a fully-qualified string reference to a
 * plugin parameter on a specific track.
 * Format: "{trackId}:{pluginId}:{parameterId}"
 */
export type AutomationAddress = string;

/** Build a canonical automation address. */
export function buildAutoAddress(
  trackId: string,
  pluginId: string,
  parameterId: string,
): AutomationAddress {
  return `${trackId}:${pluginId}:${parameterId}`;
}

/** Parse an automation address back into its components. Returns null if invalid. */
export function parseAutoAddress(
  address: AutomationAddress,
): { trackId: string; pluginId: string; parameterId: string } | null {
  const parts = address.split(":");
  if (parts.length !== 3) return null;
  const [trackId, pluginId, parameterId] = parts;
  if (!trackId || !pluginId || !parameterId) return null;
  return { trackId, pluginId, parameterId };
}
