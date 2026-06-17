type ExportTraceCounters = Record<string, number>;

export interface ExportTraceEvent {
  type: string;
  at: number;
  detail?: Record<string, unknown>;
}

export interface ExportTraceSnapshot {
  enabled: boolean;
  counters: ExportTraceCounters;
  lastRoute: string | null;
  lastPreflight: Record<string, unknown> | null;
  lastResult: Record<string, unknown> | null;
  events: ExportTraceEvent[];
}

interface ExportTraceApi {
  snapshot: () => ExportTraceSnapshot;
  clear: () => void;
  enabled: boolean;
}

declare global {
  interface Window {
    __SN_EXPORT_TRACE__?: ExportTraceApi;
  }
}

const STORAGE_KEY = "sn:exportTrace";
const counters: ExportTraceCounters = {};
const events: ExportTraceEvent[] = [];
let lastRoute: string | null = null;
let lastPreflight: Record<string, unknown> | null = null;
let lastResult: Record<string, unknown> | null = null;

function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("snExportTrace") === "1") return true;
  } catch {
    // ignore
  }
  try {
    return window.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? Math.round(performance.now()) : Date.now();
}

function inc(key: string, delta = 1): void {
  counters[key] = Math.max(0, (counters[key] ?? 0) + delta);
}

function push(type: string, detail?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  events.push({ type, at: now(), detail });
  if (events.length > 250) events.shift();
}

export function recordExportTrace(type: string, detail?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  switch (type) {
    case "preflight":
      lastPreflight = detail ?? null;
      break;
    case "route":
      lastRoute = typeof detail?.route === "string" ? detail.route : lastRoute;
      break;
    case "result":
    case "error":
      lastResult = { type, ...(detail ?? {}) };
      break;
    case "native-track":
      inc("nativeTracks");
      break;
    case "native-note":
      inc("nativeNotesScheduled");
      break;
    case "native-drum-hit":
      inc("nativeDrumHitsScheduled");
      break;
    case "native-source":
      inc("nativeSourcesCreated");
      break;
    case "native-audio-clip":
      inc("nativeAudioClipsScheduled");
      break;
    case "native-yield":
      inc("nativeYields");
      break;
  }
  push(type, detail);
}

function snapshot(): ExportTraceSnapshot {
  return {
    enabled: isEnabled(),
    counters: { ...counters },
    lastRoute,
    lastPreflight,
    lastResult,
    events: events.slice(-100),
  };
}

function clear(): void {
  for (const key of Object.keys(counters)) delete counters[key];
  events.length = 0;
  lastRoute = null;
  lastPreflight = null;
  lastResult = null;
}

function api(): ExportTraceApi {
  return {
    enabled: isEnabled(),
    snapshot,
    clear,
  };
}

export function installExportTrace(): void {
  if (typeof window === "undefined") return;
  window.__SN_EXPORT_TRACE__ = api();
}

installExportTrace();
