/**
 * WAM (Web Audio Modules 2) runtime loader.
 *
 * Fetches an external WAM2-compatible plugin URL, reads its descriptor,
 * builds a PluginManifest that fits our internal contract, and registers
 * it in the pluginRegistry via forceRegister() so reloading the same URL
 * always reflects the latest version.
 *
 * The factory stored in the manifest keeps a reference to the raw WAM
 * module export so the engine host can call it later. The PluginHost
 * sandbox (host.ts) wraps the factory in the same try/catch boundary as
 * built-in plugins, so a broken WAM cannot crash the engine.
 *
 * WAM2 descriptor shape (subset we care about):
 *   descriptor.id        — stable plugin id (vendor.name format)
 *   descriptor.name      — display name
 *   descriptor.version   — semver string
 *   descriptor.vendor    — author / vendor string
 *   descriptor.description
 *   descriptor.keywords  — string[]  (used as category hint)
 *   getParameterInfo()   — returns Record<string, WamParameterInfo>
 *
 * We degrade gracefully: missing fields fall back to sensible defaults
 * derived from the URL so a partial or non-standard module still loads.
 */

import { pluginRegistry } from "./registry";
import type { PluginManifest, PluginParameterDescriptor } from "./types";

// ─── WAM2 type shims (no official @types package yet) ────────────────────────

interface WamParameterInfo {
  label?: string;
  type?: "float" | "int" | "boolean" | "choice";
  defaultValue?: number;
  minValue?: number;
  maxValue?: number;
  discreteStepCount?: number;
}

interface WamDescriptor {
  id?: string;
  name?: string;
  version?: string;
  vendor?: string;
  description?: string;
  keywords?: string[];
  isInstrument?: boolean;
}

interface WamModule {
  descriptor?: WamDescriptor;
  default?: {
    descriptor?: WamDescriptor;
    getParameterInfo?: () => Record<string, WamParameterInfo> | Promise<Record<string, WamParameterInfo>>;
  };
  getParameterInfo?: () => Record<string, WamParameterInfo> | Promise<Record<string, WamParameterInfo>>;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface WamLoadSuccess {
  ok: true;
  manifest: PluginManifest;
}

export interface WamLoadFailure {
  ok: false;
  error: string;
}

export type WamLoadResult = WamLoadSuccess | WamLoadFailure;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a stable plugin id from a URL when the descriptor lacks one. */
function idFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const slug = parts[parts.length - 1]?.replace(/\.[^.]+$/, "") ?? "wam-plugin";
    return `wam.external.${slug.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
  } catch {
    return "wam.external.unknown";
  }
}

/** Convert a WAM parameter info map to our PluginParameterDescriptor array. */
function buildParameters(
  info: Record<string, WamParameterInfo>,
): PluginParameterDescriptor[] {
  return Object.entries(info).map(([id, p]) => ({
    id,
    label: p.label ?? id,
    min: p.minValue ?? 0,
    max: p.maxValue ?? 1,
    defaultValue: p.defaultValue ?? 0,
    automatable: true,
    step: p.discreteStepCount && p.discreteStepCount > 0
      ? (((p.maxValue ?? 1) - (p.minValue ?? 0)) / p.discreteStepCount)
      : undefined,
  }));
}

/** Resolve the descriptor from whatever shape the module exports. */
function resolveDescriptor(mod: WamModule): WamDescriptor {
  if (mod.descriptor) return mod.descriptor;
  if (mod.default?.descriptor) return mod.default.descriptor;
  return {};
}

/** Resolve parameter info, calling the function if present. */
async function resolveParameterInfo(
  mod: WamModule,
): Promise<Record<string, WamParameterInfo>> {
  const fn = mod.getParameterInfo ?? mod.default?.getParameterInfo;
  if (!fn) return {};
  try {
    const result = await fn();
    return result ?? {};
  } catch {
    return {};
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Load a WAM2 plugin from a URL, register it in the global pluginRegistry,
 * and return the resulting manifest.
 *
 * Errors are caught and returned as WamLoadFailure so callers never need
 * to wrap this in their own try/catch.
 *
 * @param url  Fully-qualified URL pointing to the WAM2 ES module entry point.
 */
export async function loadWamPlugin(url: string): Promise<WamLoadResult> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return { ok: false, error: "URL cannot be empty." };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return { ok: false, error: "Invalid URL — please enter a fully-qualified https:// address." };
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return { ok: false, error: "Only http:// and https:// URLs are supported." };
  }

  let mod: WamModule;
  try {
    mod = (await import(/* @vite-ignore */ trimmedUrl)) as WamModule;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Failed to load module from "${trimmedUrl}": ${msg}`,
    };
  }

  const descriptor = resolveDescriptor(mod);
  const paramInfo = await resolveParameterInfo(mod);

  const pluginId = descriptor.id
    ? `wam.${descriptor.id}`
    : idFromUrl(trimmedUrl);

  const isInstrument = descriptor.isInstrument === true;
  const kind = isInstrument ? "instrument" : "effect";

  const name = descriptor.name ?? parsedUrl.pathname.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "WAM Plugin";
  const version = descriptor.version ?? "0.0.0";
  const vendor = descriptor.vendor ?? "Unknown";
  const description = descriptor.description ?? `External WAM plugin by ${vendor}`;

  const categoryHint = descriptor.keywords?.[0] ?? (isInstrument ? "WAM Instruments" : "WAM Effects");
  const category = categoryHint.charAt(0).toUpperCase() + categoryHint.slice(1);

  const parameters = buildParameters(paramInfo);

  const rawModule = mod;

  const manifest: PluginManifest = {
    id: pluginId,
    kind,
    name,
    version,
    category,
    description,
    parameters,
    wamUrl: trimmedUrl,
    factory: () => {
      return {
        wamUrl: trimmedUrl,
        pluginId,
        _rawModule: rawModule,
      };
    },
  };

  pluginRegistry.forceRegister(manifest);

  if (import.meta.env.DEV) {
    console.log(`[WamLoader] Registered WAM plugin "${pluginId}" from ${trimmedUrl}`);
  }

  return { ok: true, manifest };
}

/**
 * Return all currently-registered WAM plugins (those with a wamUrl).
 * Useful for persisting / restoring a user's plugin list across sessions.
 */
export function getLoadedWamPlugins(): PluginManifest[] {
  return pluginRegistry.getAll().filter((m) => !!m.wamUrl);
}
