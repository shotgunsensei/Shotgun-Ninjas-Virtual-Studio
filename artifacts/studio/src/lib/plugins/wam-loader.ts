/**
 * External WAM loading is deliberately fail-closed during stabilization.
 *
 * Importing an arbitrary URL executes that module in the Studio page origin.
 * A try/catch is only an error boundary; it cannot isolate DOM, storage,
 * project data, or network credentials. The former implementation also
 * registered metadata without creating an audio processor, so it implied
 * working extension support that did not exist.
 *
 * Re-enable this only after a genuine WAM host provides an AudioWorklet-backed
 * lifecycle, explicit user trust, integrity/version metadata, parameter
 * routing, bypass, and deterministic disposal.
 */

import { pluginRegistry } from "./registry";
import type { PluginManifest } from "./types";

export const REMOTE_WAM_LOADING_SUPPORTED = false;

export interface WamLoadSuccess {
  ok: true;
  manifest: PluginManifest;
}

export interface WamLoadFailure {
  ok: false;
  error: string;
}

export type WamLoadResult = WamLoadSuccess | WamLoadFailure;

/** Retained as a stable API for callers while remote execution is disabled. */
export async function loadWamPlugin(_url: string): Promise<WamLoadResult> {
  return {
    ok: false,
    error:
      "External WAM loading is unavailable while the isolated audio-plugin host is being completed. Built-in instruments and effects remain available.",
  };
}

export function getLoadedWamPlugins(): PluginManifest[] {
  return pluginRegistry.getAll().filter((manifest) => !!manifest.wamUrl);
}
