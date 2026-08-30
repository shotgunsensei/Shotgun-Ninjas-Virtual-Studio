/**
 * Plugin Registry — singleton Map of all registered PluginManifests.
 *
 * Usage:
 *   import { pluginRegistry } from "./registry";
 *   pluginRegistry.register(manifest);
 *   pluginRegistry.getByKind("effect");
 */

import type { PluginKind, PluginManifest } from "./types";

class PluginRegistry {
  private manifests = new Map<string, PluginManifest>();

  /**
   * Register a plugin manifest. Logs a warning in dev mode if the id
   * is already taken (duplicate registration is a no-op).
   */
  register(manifest: PluginManifest): void {
    if (this.manifests.has(manifest.id)) {
      if (import.meta.env?.DEV ?? false) {
        console.warn(
          `[PluginRegistry] Duplicate plugin id "${manifest.id}" — ignoring re-registration.`,
        );
      }
      return;
    }
    this.manifests.set(manifest.id, manifest);
  }

  /**
   * Register or replace a plugin manifest. Unlike register(), this always
   * overwrites an existing entry — intended for runtime WAM plugin reloads.
   */
  forceRegister(manifest: PluginManifest): void {
    this.manifests.set(manifest.id, manifest);
  }

  /**
   * Unregister a plugin by id. Safe to call even if the id doesn't exist.
   */
  unregister(id: string): void {
    this.manifests.delete(id);
  }

  /** Return the manifest for a given id, or undefined if not found. */
  getById(id: string): PluginManifest | undefined {
    return this.manifests.get(id);
  }

  /** Return all manifests of a given kind in registration order. */
  getByKind(kind: PluginKind): PluginManifest[] {
    const results: PluginManifest[] = [];
    for (const m of this.manifests.values()) {
      if (m.kind === kind) results.push(m);
    }
    return results;
  }

  /** Return all registered manifests in registration order. */
  getAll(): PluginManifest[] {
    return Array.from(this.manifests.values());
  }

  /** Return the total count of registered plugins. */
  get size(): number {
    return this.manifests.size;
  }

  /**
   * Check whether a plugin id is registered.
   */
  has(id: string): boolean {
    return this.manifests.has(id);
  }
}

/** Singleton registry instance. Imported directly by all consumers. */
export const pluginRegistry = new PluginRegistry();
