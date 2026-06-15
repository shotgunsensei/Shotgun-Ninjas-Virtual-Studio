export interface FirstPlayTraceEvent {
  t: number;
  phase: string;
  detail?: Record<string, unknown>;
  durationMs?: number;
}

interface FirstPlayTraceApi {
  dump: () => FirstPlayTraceEvent[];
  clear: () => void;
  mark: (phase: string, detail?: Record<string, unknown>) => void;
  measure: (
    phase: string,
    start: number,
    end: number,
    detail?: Record<string, unknown>,
  ) => void;
  isEnabled: () => boolean;
  currentPhase: () => string;
  flags: () => FirstPlayFlags;
}

export interface FirstPlayFlags {
  trace: boolean;
  disableProjectSchedules: boolean;
  disableTransportCallbacks: boolean;
  disableGraphBuildOnPlay: boolean;
  useMinimalAudioGraph: boolean;
  disableWorldAudio: boolean;
  disableAnalyzers: boolean;
}

declare global {
  interface Window {
    __SN_FIRST_PLAY_TRACE__?: FirstPlayTraceApi;
  }
}

const MAX_EVENTS = 600;
const STORAGE_KEY = "sn:firstPlayTrace";

const events: FirstPlayTraceEvent[] = [];
let observer: PerformanceObserver | null = null;
let current = "idle";

function params(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

export function getFirstPlayFlags(): FirstPlayFlags {
  const search = params();
  const has = (name: string) => search?.has(name) ?? false;
  let storageTrace = false;
  try {
    storageTrace = window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    storageTrace = false;
  }
  return {
    trace: has("snFirstPlayTrace") || storageTrace,
    disableProjectSchedules: has("snDisableProjectSchedules"),
    disableTransportCallbacks: has("snDisableTransportCallbacks"),
    disableGraphBuildOnPlay: has("snDisableGraphBuildOnPlay"),
    useMinimalAudioGraph: has("snUseMinimalAudioGraph"),
    disableWorldAudio: has("snDisableWorldAudio"),
    disableAnalyzers: has("snDisableAnalyzers"),
  };
}

export function isFirstPlayTraceEnabled(): boolean {
  return getFirstPlayFlags().trace;
}

export function firstPlayMark(phase: string, detail?: Record<string, unknown>): void {
  if (!isFirstPlayTraceEnabled()) return;
  current = phase;
  events.push({
    t: Math.round(performance.now() * 10) / 10,
    phase,
    detail,
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function firstPlayMeasure(
  phase: string,
  start: number,
  end: number,
  detail?: Record<string, unknown>,
): void {
  if (!isFirstPlayTraceEnabled()) return;
  events.push({
    t: Math.round(end * 10) / 10,
    phase,
    detail,
    durationMs: Math.round((end - start) * 10) / 10,
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function firstPlayDump(): FirstPlayTraceEvent[] {
  return events.slice();
}

export function firstPlayClear(): void {
  events.splice(0, events.length);
  current = "idle";
}

export function installFirstPlayTrace(): void {
  if (typeof window === "undefined" || window.__SN_FIRST_PLAY_TRACE__) return;
  window.__SN_FIRST_PLAY_TRACE__ = {
    dump: firstPlayDump,
    clear: firstPlayClear,
    mark: firstPlayMark,
    measure: firstPlayMeasure,
    isEnabled: isFirstPlayTraceEnabled,
    currentPhase: () => current,
    flags: getFirstPlayFlags,
  };

  if (!isFirstPlayTraceEnabled() || !("PerformanceObserver" in window)) return;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const attribution = (entry as PerformanceEntry & { attribution?: unknown }).attribution;
        firstPlayMark("longtask", {
          startTime: Math.round(entry.startTime),
          duration: Math.round(entry.duration),
          currentPhase: current,
          attribution,
        });
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    observer = null;
  }
}

export function uninstallFirstPlayTrace(): void {
  observer?.disconnect();
  observer = null;
}
