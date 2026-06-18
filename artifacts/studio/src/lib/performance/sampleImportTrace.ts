type TraceDetail = Record<string, string | number | boolean | null | undefined>;

interface SampleImportEvent {
  kind: "mark" | "measure";
  stage: string;
  at: number;
  durationMs?: number;
  detail?: TraceDetail;
}

interface SampleImportTraceApi {
  clear: () => void;
  mark: (stage: string, detail?: TraceDetail) => void;
  measure: (stage: string, startMs: number, detail?: TraceDetail) => number;
  snapshot: () => {
    enabled: boolean;
    events: SampleImportEvent[];
    measures: SampleImportEvent[];
  };
}

declare global {
  interface Window {
    __SN_SAMPLE_IMPORT_TRACE__?: SampleImportTraceApi;
  }
}

const MAX_EVENTS = 300;
const events: SampleImportEvent[] = [];

function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      new URLSearchParams(window.location.search).get("snSampleImportTrace") === "1" ||
      window.localStorage.getItem("sn:sampleImportTrace") === "1"
    );
  } catch {
    return false;
  }
}

function push(event: SampleImportEvent): void {
  if (!isEnabled()) return;
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

function sanitizeDetail(detail?: TraceDetail): TraceDetail | undefined {
  if (!detail) return undefined;
  const out: TraceDetail = {};
  for (const [key, value] of Object.entries(detail)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value == null
    ) {
      out[key] = value;
    }
  }
  return out;
}

export function markSampleImport(stage: string, detail?: TraceDetail): void {
  push({
    kind: "mark",
    stage,
    at: Math.round(performance.now()),
    detail: sanitizeDetail(detail),
  });
}

export function measureSampleImport(
  stage: string,
  startMs: number,
  detail?: TraceDetail,
): number {
  const durationMs = Math.round(performance.now() - startMs);
  push({
    kind: "measure",
    stage,
    at: Math.round(performance.now()),
    durationMs,
    detail: sanitizeDetail(detail),
  });
  return durationMs;
}

export async function timeSampleImport<T>(
  stage: string,
  fn: () => Promise<T>,
  detail?: TraceDetail,
): Promise<T> {
  const startMs = performance.now();
  try {
    return await fn();
  } finally {
    measureSampleImport(stage, startMs, detail);
  }
}

export function installSampleImportTrace(): void {
  if (typeof window === "undefined" || window.__SN_SAMPLE_IMPORT_TRACE__) return;
  window.__SN_SAMPLE_IMPORT_TRACE__ = {
    clear: () => {
      events.length = 0;
    },
    mark: markSampleImport,
    measure: measureSampleImport,
    snapshot: () => ({
      enabled: isEnabled(),
      events: [...events],
      measures: events.filter((event) => event.kind === "measure"),
    }),
  };
}
