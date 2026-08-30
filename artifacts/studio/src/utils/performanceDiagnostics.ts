import {
  trackListenerTransportEvent,
  untrackListenerTransportEvent,
} from "../lib/performance/listenerTrace";
import {
  trackAudioTraceTransportEvent,
  untrackAudioTraceTransportEvent,
} from "../lib/performance/audioNodeTrace";

type CounterName =
  | "activeRafLoops"
  | "activeIntervals"
  | "activeToneTransportEventIds"
  | "activeAudioResources"
  | "autosaveAttempts"
  | "skippedAutosaves"
  | "sampleBlobWrites";

type PerfDetail = Record<string, unknown>;

interface PerfSnapshot {
  enabled: boolean;
  logsEnabled: boolean;
  counters: Record<string, number>;
  activeTransportEvents: number[];
  measures: Array<{ name: string; duration: number; startTime: number }>;
}

interface PerfApi {
  snapshot: () => PerfSnapshot;
  reset: () => void;
  enableLogs: () => void;
  disableLogs: () => void;
  counters: Record<string, number>;
}

declare global {
  interface Window {
    __SN_PERF_DIAGNOSTICS__?: PerfApi;
  }
}

const DEV = import.meta.env?.DEV ?? false;
const counters: Record<string, number> = {
  activeRafLoops: 0,
  activeIntervals: 0,
  activeToneTransportEventIds: 0,
  activeAudioResources: 0,
  autosaveAttempts: 0,
  skippedAutosaves: 0,
  sampleBlobWrites: 0,
};
const activeTransportEvents = new Set<number>();
let seq = 0;

function canUsePerformance(): boolean {
  return DEV && typeof performance !== "undefined";
}

function logsEnabled(): boolean {
  if (!DEV || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem("studio.perfDiagnostics.logs") === "1";
  } catch {
    return false;
  }
}

function log(message: string, detail?: PerfDetail): void {
  if (!logsEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug(`[studio-perf] ${message}`, detail ?? "");
}

export function perfMark(name: string, detail?: PerfDetail): string {
  if (!canUsePerformance()) return name;
  const markName = `studio:${name}`;
  try {
    performance.mark(markName, detail ? { detail } : undefined);
  } catch {
    performance.mark(markName);
  }
  return markName;
}

export function perfMeasure(
  name: string,
  startMark: string,
  endMark?: string,
  detail?: PerfDetail,
): number | null {
  if (!canUsePerformance()) return null;
  const measureName = `studio:${name}`;
  try {
    if (endMark) performance.measure(measureName, startMark, endMark);
    else performance.measure(measureName, startMark);
    const entries = performance.getEntriesByName(measureName, "measure");
    const duration = entries[entries.length - 1]?.duration ?? null;
    if (duration !== null) {
      log(`${name} ${duration.toFixed(1)}ms`, detail);
    }
    return duration;
  } catch {
    return null;
  }
}

export function startPerfTimer(name: string, detail?: PerfDetail): () => number | null {
  if (!canUsePerformance()) return () => null;
  const id = ++seq;
  const start = perfMark(`${name}:start:${id}`, detail);
  return () => {
    const end = perfMark(`${name}:end:${id}`, detail);
    return perfMeasure(name, start, end, detail);
  };
}

export async function timePerfAsync<T>(
  name: string,
  fn: () => Promise<T>,
  detail?: PerfDetail,
): Promise<T> {
  const end = startPerfTimer(name, detail);
  try {
    return await fn();
  } finally {
    end();
  }
}

export function countPerf(name: CounterName | string, delta = 1, detail?: PerfDetail): void {
  if (!DEV) return;
  counters[name] = Math.max(0, (counters[name] ?? 0) + delta);
  log(`${name}=${counters[name]}`, detail);
}

export function trackRafLoop(label: string): () => void {
  countPerf("activeRafLoops", 1, { label });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    countPerf("activeRafLoops", -1, { label });
  };
}

export function trackInterval(label: string): () => void {
  countPerf("activeIntervals", 1, { label });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    countPerf("activeIntervals", -1, { label });
  };
}

export function trackTransportEvent(id: number, label: string): number {
  trackListenerTransportEvent(id, label);
  trackAudioTraceTransportEvent(id, label);
  if (!DEV) return id;
  if (!activeTransportEvents.has(id)) {
    activeTransportEvents.add(id);
    counters.activeToneTransportEventIds = activeTransportEvents.size;
    log(`transport event +${id}`, { label, count: activeTransportEvents.size });
  }
  return id;
}

export function untrackTransportEvent(id: number, label?: string): void {
  untrackListenerTransportEvent(id);
  untrackAudioTraceTransportEvent(id, label);
  if (!DEV) return;
  if (activeTransportEvents.delete(id)) {
    counters.activeToneTransportEventIds = activeTransportEvents.size;
    log(`transport event -${id}`, { label, count: activeTransportEvents.size });
  }
}

export function trackAudioResource(label: string): () => void {
  countPerf("activeAudioResources", 1, { label });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    countPerf("activeAudioResources", -1, { label });
  };
}

export function getPerfSnapshot(): PerfSnapshot {
  const measures = canUsePerformance()
    ? performance
        .getEntriesByType("measure")
        .filter((entry) => entry.name.startsWith("studio:"))
        .slice(-100)
        .map((entry) => ({
          name: entry.name,
          duration: entry.duration,
          startTime: entry.startTime,
        }))
    : [];
  return {
    enabled: DEV,
    logsEnabled: logsEnabled(),
    counters: { ...counters },
    activeTransportEvents: Array.from(activeTransportEvents),
    measures,
  };
}

export function resetPerfDiagnostics(): void {
  if (!DEV) return;
  for (const key of Object.keys(counters)) counters[key] = 0;
  activeTransportEvents.clear();
  if (canUsePerformance()) {
    performance.clearMarks();
    performance.clearMeasures();
  }
}

export function installPerfDiagnostics(): void {
  if (!DEV || typeof window === "undefined") return;
  window.__SN_PERF_DIAGNOSTICS__ = {
    snapshot: getPerfSnapshot,
    reset: resetPerfDiagnostics,
    enableLogs: () => {
      try {
        localStorage.setItem("studio.perfDiagnostics.logs", "1");
      } catch {
        // ignore
      }
    },
    disableLogs: () => {
      try {
        localStorage.removeItem("studio.perfDiagnostics.logs");
      } catch {
        // ignore
      }
    },
    counters,
  };
}

installPerfDiagnostics();
