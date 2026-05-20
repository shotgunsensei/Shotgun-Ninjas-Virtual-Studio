/**
 * Automation hooks for plugin parameters.
 *
 * Each plugin parameter with `automatable: true` can be registered as
 * an automation target using the addressing scheme:
 *   "{trackId}:{pluginId}:{parameterId}"
 *
 * The automation system calls `applyAutomationValue` at playback time to
 * push a value to the engine.  Currently wired to the effect and sound
 * parameter setters — future automation lane infrastructure will drive this.
 */

import { pluginRegistry } from "./registry";
import { parseAutoAddress, type AutomationAddress } from "./types";
import type { FxModuleId, FxModuleSettings } from "../../types";
import { PLUGIN_ID_TO_FX_MODULE } from "./builtins";

// ─── Automation target registry ───────────────────────────────────────────────

/**
 * A setter function that the automation system calls to apply a value
 * (normalised 0..1 or unit-appropriate) to the engine.
 */
export type AutomationSetter = (value: number) => void;

/** All registered automation targets keyed by address. */
const automationTargets = new Map<AutomationAddress, AutomationSetter>();

/**
 * Register an automation target.  If the address is already taken the
 * new setter replaces the old one (last-write wins for dynamic tracks).
 */
export function registerAutomationTarget(
  address: AutomationAddress,
  setter: AutomationSetter,
): void {
  automationTargets.set(address, setter);
}

/**
 * Unregister all automation targets for a given trackId.
 * Call this when a track is removed or its voice rebuilt.
 */
export function unregisterTrackAutomationTargets(trackId: string): void {
  for (const key of automationTargets.keys()) {
    if (key.startsWith(`${trackId}:`)) {
      automationTargets.delete(key);
    }
  }
}

/**
 * Apply an automation value to the engine.
 * Returns false if the address is not registered (noop), true on success.
 */
export function applyAutomationValue(
  address: AutomationAddress,
  value: number,
): boolean {
  const setter = automationTargets.get(address);
  if (!setter) return false;
  setter(value);
  return true;
}

/** Return all currently registered automation target addresses. */
export function getAllAutomationAddresses(): AutomationAddress[] {
  return Array.from(automationTargets.keys());
}

/**
 * Return all automatable parameter addresses for a plugin on a specific track.
 * Useful for building an automation lane picker.
 */
export function getPluginAutomationAddresses(
  trackId: string,
  pluginId: string,
): AutomationAddress[] {
  const manifest = pluginRegistry.getById(pluginId);
  if (!manifest) return [];
  return manifest.parameters
    .filter((p) => p.automatable)
    .map((p) => `${trackId}:${pluginId}:${p.id}`);
}

// ─── Engine-wired target setup ────────────────────────────────────────────────

/**
 * Wire up automatable parameters for all effect plugins on a track.
 * Call this once per track after the engine voice is created/rebuilt.
 *
 * `effectSetter` is the engine's `setEffectModule` bound to the trackId.
 * `soundSetter` is the engine's `setSoundParams` bound to the trackId.
 */
export function wireTrackAutomationTargets(
  trackId: string,
  effectSetter: (moduleId: FxModuleId, patch: Partial<FxModuleSettings>) => void,
  soundSetter: (params: Record<string, number>) => void,
): void {
  unregisterTrackAutomationTargets(trackId);

  const effectPlugins = pluginRegistry.getByKind("effect");
  for (const manifest of effectPlugins) {
    const fxModuleId = PLUGIN_ID_TO_FX_MODULE[manifest.id] as FxModuleId | undefined;
    if (!fxModuleId) continue;

    for (const param of manifest.parameters) {
      if (!param.automatable) continue;
      const address = `${trackId}:${manifest.id}:${param.id}`;

      if (param.id === "amount") {
        registerAutomationTarget(address, (value) => {
          effectSetter(fxModuleId, { amount: value });
        });
      } else {
        registerAutomationTarget(address, (value) => {
          effectSetter(fxModuleId, { params: { [param.id]: value } });
        });
      }
    }
  }

  const instrumentPlugins = pluginRegistry.getByKind("instrument");
  for (const manifest of instrumentPlugins) {
    for (const param of manifest.parameters) {
      if (!param.automatable) continue;
      const address = `${trackId}:${manifest.id}:${param.id}`;
      registerAutomationTarget(address, (value) => {
        soundSetter({ [param.id]: value });
      });
    }
  }
}

/**
 * Get the human-readable label for an automation address.
 * Returns null if the address is not valid.
 */
export function getAutomationLabel(address: AutomationAddress): string | null {
  const parsed = parseAutoAddress(address);
  if (!parsed) return null;
  const manifest = pluginRegistry.getById(parsed.pluginId);
  if (!manifest) return null;
  const param = manifest.parameters.find((p) => p.id === parsed.parameterId);
  if (!param) return null;
  return `${manifest.name} › ${param.label}`;
}
