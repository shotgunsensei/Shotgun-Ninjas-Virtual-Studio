type StartupSoundEvent = {
  at: number;
  name: string;
  detail?: Record<string, unknown>;
};

type StartupSoundTraceApi = {
  mark: (name: string, detail?: Record<string, unknown>) => void;
  snapshot: () => StartupSoundEvent[];
  clear: () => void;
};

const STORAGE_KEY = "sn:startupSoundTrace";
const QUERY_KEY = "snStartupSoundTrace";
const MAX_EVENTS = 500;
const events: StartupSoundEvent[] = [];
let cachedTraceEnabled: boolean | null = null;

function shouldTrace(): boolean {
  if (cachedTraceEnabled !== null) return cachedTraceEnabled;
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    cachedTraceEnabled =
      params.get(QUERY_KEY) === "1" || window.localStorage.getItem(STORAGE_KEY) === "1";
    return cachedTraceEnabled;
  } catch {
    cachedTraceEnabled = false;
    return false;
  }
}

export function isStartupSoundTraceEnabled(): boolean {
  return shouldTrace();
}

export function markStartupSound(name: string, detail?: Record<string, unknown>): void {
  if (!shouldTrace()) return;
  events.push({
    at: performance.now(),
    name,
    detail,
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function installStartupSoundTrace(): void {
  if (typeof window === "undefined") return;
  const api: StartupSoundTraceApi = {
    mark: markStartupSound,
    snapshot: () => events.slice(),
    clear: () => {
      events.length = 0;
    },
  };
  Object.defineProperty(window, "__SN_STARTUP_SOUND_TRACE__", {
    value: api,
    configurable: true,
  });
}

declare global {
  interface Window {
    __SN_STARTUP_SOUND_TRACE__?: StartupSoundTraceApi;
  }
}
