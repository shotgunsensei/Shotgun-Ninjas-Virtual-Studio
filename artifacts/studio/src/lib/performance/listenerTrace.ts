type ListenerSource = "dom" | "subscription" | "interval" | "timeout" | "raf" | "transport";

interface ListenerRecord {
  id: number;
  source: ListenerSource;
  label: string;
  type?: string;
  target?: string;
  stack: string;
  addedAt: number;
  detail?: Record<string, unknown>;
}

interface ListenerTraceSnapshot {
  enabled: boolean;
  activeTotal: number;
  activeEventListeners: number;
  activeSubscriptions: number;
  activeIntervals: number;
  activeTimeouts: number;
  activeRafs: number;
  activeTransportEvents: number;
  byType: Record<string, number>;
  byTarget: Record<string, number>;
  byLabel: Record<string, number>;
  duplicateStacks: Array<{ label: string; type?: string; count: number; stack: string }>;
  topStacks: Array<{ label: string; type?: string; count: number; stack: string }>;
  records: Array<Pick<ListenerRecord, "id" | "source" | "label" | "type" | "target" | "addedAt" | "detail">>;
}

interface ListenerTraceApi {
  snapshot: () => ListenerTraceSnapshot;
  dumpTopStacks: (limit?: number) => ListenerTraceSnapshot["topStacks"];
  clear: () => void;
  start: () => void;
  stop: () => void;
  enabled: boolean;
}

declare global {
  interface Window {
    __SN_LISTENER_TRACE__?: ListenerTraceApi;
  }
}

const STORAGE_KEY = "sn:listenerTrace";
let cachedEnabled: boolean | null = null;
const records = new Map<number, ListenerRecord>();
let nextId = 1;
let installed = false;
const NULL_LISTENER = {};
let domRecordIds = new WeakMap<EventTarget, Map<string, WeakMap<object, number[]>>>();
let originals:
  | {
      addEventListener: typeof EventTarget.prototype.addEventListener;
      removeEventListener: typeof EventTarget.prototype.removeEventListener;
    }
  | null = null;

function isEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("snListenerTrace") === "1") {
      cachedEnabled = true;
      return true;
    }
  } catch {
    // ignore URL parsing failures
  }
  try {
    cachedEnabled = window.localStorage?.getItem(STORAGE_KEY) === "1";
    return cachedEnabled;
  } catch {
    cachedEnabled = false;
    return false;
  }
}

function stackTrace(): string {
  try {
    return (new Error().stack ?? "")
      .split("\n")
      .slice(3, 11)
      .map((line) => line.trim())
      .join("\n");
  } catch {
    return "";
  }
}

function now(): number {
  return typeof performance !== "undefined" ? Math.round(performance.now()) : Date.now();
}

function captureOption(options?: boolean | AddEventListenerOptions): boolean {
  return typeof options === "boolean" ? options : !!options?.capture;
}

function listenerObject(listener: EventListenerOrEventListenerObject | null): object {
  return listener ?? NULL_LISTENER;
}

function domKey(type: string, capture: boolean): string {
  return `${type}:${capture ? 1 : 0}`;
}

function trackDomRecord(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  capture: boolean,
  id: number,
): void {
  if (!id) return;
  let byType = domRecordIds.get(target);
  if (!byType) {
    byType = new Map();
    domRecordIds.set(target, byType);
  }
  const key = domKey(type, capture);
  let byListener = byType.get(key);
  if (!byListener) {
    byListener = new WeakMap();
    byType.set(key, byListener);
  }
  const listenerRef = listenerObject(listener);
  const ids = byListener.get(listenerRef) ?? [];
  ids.push(id);
  byListener.set(listenerRef, ids);
}

function takeDomRecord(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  capture: boolean,
): number | null {
  const byType = domRecordIds.get(target);
  const byListener = byType?.get(domKey(type, capture));
  const ids = byListener?.get(listenerObject(listener));
  const id = ids?.pop();
  return id ?? null;
}

function targetLabel(target: EventTarget): string {
  if (typeof window !== "undefined" && target === window) return "Window";
  if (typeof document !== "undefined" && target === document) return "Document";
  if (typeof navigator !== "undefined" && target === navigator.serviceWorker) return "ServiceWorkerContainer";
  if (typeof HTMLElement !== "undefined" && target instanceof HTMLElement) {
    const id = target.id ? `#${target.id}` : "";
    const cls = target.className && typeof target.className === "string"
      ? `.${target.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "";
    return `${target.tagName.toLowerCase()}${id}${cls}`;
  }
  return target.constructor?.name ?? "EventTarget";
}

function addRecord(record: Omit<ListenerRecord, "id" | "addedAt" | "stack"> & { stack?: string }): number {
  if (!isEnabled()) return 0;
  const id = nextId++;
  records.set(id, {
    id,
    addedAt: now(),
    stack: record.stack ?? stackTrace(),
    ...record,
  });
  return id;
}

function removeRecord(id: number): void {
  if (id) records.delete(id);
}

function findDomRecord(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  capture: boolean,
): number | null {
  return takeDomRecord(target, type, listener, capture);
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function summarizeStacks(limit = 20): ListenerTraceSnapshot["topStacks"] {
  const grouped = new Map<string, { label: string; type?: string; stack: string; count: number }>();
  for (const record of records.values()) {
    const key = `${record.source}|${record.label}|${record.type ?? ""}|${record.stack}`;
    const current = grouped.get(key);
    if (current) current.count += 1;
    else grouped.set(key, {
      label: record.label,
      type: record.type,
      stack: record.stack,
      count: 1,
    });
  }
  return Array.from(grouped.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function getListenerTraceSnapshot(): ListenerTraceSnapshot {
  const byType: Record<string, number> = {};
  const byTarget: Record<string, number> = {};
  const byLabel: Record<string, number> = {};
  let activeEventListeners = 0;
  let activeSubscriptions = 0;
  let activeIntervals = 0;
  let activeTimeouts = 0;
  let activeRafs = 0;
  let activeTransportEvents = 0;

  for (const record of records.values()) {
    increment(byLabel, record.label);
    if (record.type) increment(byType, record.type);
    if (record.target) increment(byTarget, record.target);
    if (record.source === "dom") activeEventListeners += 1;
    if (record.source === "subscription") activeSubscriptions += 1;
    if (record.source === "interval") activeIntervals += 1;
    if (record.source === "timeout") activeTimeouts += 1;
    if (record.source === "raf") activeRafs += 1;
    if (record.source === "transport") activeTransportEvents += 1;
  }

  const topStacks = summarizeStacks(20);
  return {
    enabled: isEnabled(),
    activeTotal: records.size,
    activeEventListeners,
    activeSubscriptions,
    activeIntervals,
    activeTimeouts,
    activeRafs,
    activeTransportEvents,
    byType,
    byTarget,
    byLabel,
    duplicateStacks: topStacks.filter((entry) => entry.count > 1),
    topStacks,
    records: Array.from(records.values()).slice(-200).map((record) => ({
      id: record.id,
      source: record.source,
      label: record.label,
      type: record.type,
      target: record.target,
      addedAt: record.addedAt,
      detail: record.detail ? { ...record.detail, listener: undefined } : undefined,
    })),
  };
}

export function trackListenerSubscription(label: string, detail?: Record<string, unknown>): () => void {
  const id = addRecord({ source: "subscription", label, detail });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    removeRecord(id);
  };
}

export function trackListenerTransportEvent(id: number, label: string): void {
  addRecord({ source: "transport", label, type: "Tone.Transport", detail: { transportId: id } });
}

export function untrackListenerTransportEvent(id: number): void {
  for (const [recordId, record] of records) {
    if (record.source === "transport" && record.detail?.transportId === id) {
      records.delete(recordId);
    }
  }
}

function api(): ListenerTraceApi {
  return {
    enabled: isEnabled(),
    snapshot: getListenerTraceSnapshot,
    dumpTopStacks: (limit = 20) => summarizeStacks(limit),
    clear: () => {
      records.clear();
      domRecordIds = new WeakMap();
    },
    start: startListenerTrace,
    stop: uninstallListenerTrace,
  };
}

export function installListenerTrace(): void {
  if (typeof window === "undefined") return;
  window.__SN_LISTENER_TRACE__ = api();
}

export function startListenerTrace(): void {
  if (installed || typeof window === "undefined" || !isEnabled()) {
    if (typeof window !== "undefined") window.__SN_LISTENER_TRACE__ = api();
    return;
  }
  installed = true;
  originals = {
    addEventListener: EventTarget.prototype.addEventListener,
    removeEventListener: EventTarget.prototype.removeEventListener,
  };

  EventTarget.prototype.addEventListener = function patchedAddEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const capture = captureOption(options);
    const id = addRecord({
      source: "dom",
      label: `${targetLabel(this)}:${type}`,
      type,
      target: targetLabel(this),
      detail: { capture },
    });
    trackDomRecord(this, type, listener, capture, id);
    return originals!.addEventListener.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function patchedRemoveEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    const capture = captureOption(options);
    const id = findDomRecord(this, type, listener, capture);
    if (id !== null) removeRecord(id);
    return originals!.removeEventListener.call(this, type, listener, options);
  };

  window.__SN_LISTENER_TRACE__ = api();
}

export function uninstallListenerTrace(): void {
  if (!installed || !originals || typeof window === "undefined") return;
  EventTarget.prototype.addEventListener = originals.addEventListener;
  EventTarget.prototype.removeEventListener = originals.removeEventListener;
  records.clear();
  domRecordIds = new WeakMap();
  installed = false;
  originals = null;
  window.__SN_LISTENER_TRACE__ = api();
}

installListenerTrace();
