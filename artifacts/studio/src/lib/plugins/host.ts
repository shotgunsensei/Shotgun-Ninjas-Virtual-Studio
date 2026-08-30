/**
 * Plugin Host — error boundary for trusted plugin factory calls.
 *
 * Wraps every plugin factory in a try/catch so a broken plugin cannot
 * silence a track. On failure the host logs the error, marks the plugin
 * as "errored" in the provided callback, and returns null so the engine
 * can reconnect the chain without the failed node.
 *
 * This does not provide a security sandbox. Only bundled/trusted factories may
 * run here; remote code remains disabled until a separately isolated WAM host
 * exists.
 */

import { pluginRegistry } from "./registry";
import type { PluginManifest } from "./types";

export interface HostCreateResult<T> {
  instance: T | null;
  error: string | null;
}

/**
 * Safely invoke a trusted plugin's factory function inside an error boundary.
 *
 * @param pluginId  - The plugin id to instantiate.
 * @param onError   - Called with the error message when the factory throws.
 *                    Use this to mark the plugin as errored in your store.
 * @returns         The result object — `instance` is null on failure.
 */
export function hostCreate<T = unknown>(
  pluginId: string,
  onError?: (pluginId: string, message: string) => void,
): HostCreateResult<T> {
  const manifest = pluginRegistry.getById(pluginId) as PluginManifest<T> | undefined;
  if (!manifest) {
    const message = `Plugin "${pluginId}" is not registered.`;
    onError?.(pluginId, message);
    return { instance: null, error: message };
  }

  try {
    const instance = manifest.factory();
    return { instance: instance as T | null, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PluginHost] Factory error for "${pluginId}":`, err);
    onError?.(pluginId, message);
    return { instance: null, error: message };
  }
}

/**
 * Safely invoke a plugin's dispose function.
 * Silently swallows any teardown errors — dispose must not crash the engine.
 */
export function hostDispose<T = unknown>(
  pluginId: string,
  instance: T,
): void {
  const manifest = pluginRegistry.getById(pluginId) as PluginManifest<T> | undefined;
  if (!manifest?.dispose) return;
  try {
    manifest.dispose(instance);
  } catch (err) {
    console.warn(`[PluginHost] Dispose error for "${pluginId}":`, err);
  }
}

/**
 * Determine whether a plugin should be bypassed given the current track
 * plugin state.  Returns the reason string or null if it should be active.
 */
export function shouldBypassPlugin(
  pluginId: string,
  disabledPlugins: string[],
  erroredPlugins: Record<string, string>,
): string | null {
  if (disabledPlugins.includes(pluginId)) return "disabled";
  if (erroredPlugins[pluginId]) return `errored: ${erroredPlugins[pluginId]}`;
  return null;
}
