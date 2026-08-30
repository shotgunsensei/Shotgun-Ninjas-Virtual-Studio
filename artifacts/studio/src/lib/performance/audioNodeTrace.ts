type AudioTraceMap = Record<string, number>;

interface AudioTraceRecord {
  id: number;
  kind: string;
  type: string;
  stack: string;
  addedAt: number;
  detail?: Record<string, unknown>;
}

interface AudioNodeTraceSnapshot {
  enabled: boolean;
  installed: boolean;
  nodeCreates: AudioTraceMap;
  nodeDisconnects: AudioTraceMap;
  nodeStarts: AudioTraceMap;
  nodeStops: AudioTraceMap;
  listenerAdds: AudioTraceMap;
  listenerRemoves: AudioTraceMap;
  workletModules: AudioTraceMap;
  toneCreates: AudioTraceMap;
  toneDisposes: AudioTraceMap;
  toneActive: AudioTraceMap;
  activeAudioWorkletNodes: number;
  activeConstantSourceNodes: number;
  activeSourceNodes: number;
  activeAnalyzers: number;
  activeTrackVoices: number;
  activeScheduledPlayers: number;
  activeTransportEvents: number;
  leanDrumVoicesActive: number;
  leanDrumHitsScheduled: number;
  leanDrumHitsTriggered: number;
  leanOneShotSourcesCreated: number;
  leanOneShotSourcesEnded: number;
  leanOneShotSourcesDisconnected: number;
  leanOneShotSourcesActive: number;
  violations: Array<{ message: string; detail?: Record<string, unknown>; stack: string }>;
  suspectedLeaks: Array<{ label: string; count: number; stack: string }>;
  topStacks: Array<{ label: string; count: number; stack: string }>;
}

interface AudioNodeTraceApi {
  snapshot: () => AudioNodeTraceSnapshot;
  dumpTopStacks: (limit?: number) => AudioNodeTraceSnapshot["topStacks"];
  clear: () => void;
  start: () => void;
  stop: () => void;
  enabled: boolean;
}

declare global {
  interface Window {
    __SN_AUDIO_NODE_TRACE__?: AudioNodeTraceApi;
  }
}

const STORAGE_KEY = "sn:audioNodeTrace";
let cachedEnabled: boolean | null = null;

let installed = false;
let nextId = 1;
let originals:
  | {
      createMethods: Partial<Record<keyof BaseAudioContext, unknown>>;
      connect?: AudioNode["connect"];
      disconnect?: AudioNode["disconnect"];
      start?: AudioScheduledSourceNode["start"];
      stop?: AudioScheduledSourceNode["stop"];
      addEventListener?: EventTarget["addEventListener"];
      removeEventListener?: EventTarget["removeEventListener"];
      AudioWorkletNode?: typeof AudioWorkletNode;
      addModule?: AudioWorklet["addModule"];
    }
  | null = null;

const nodeCreates: AudioTraceMap = {};
const nodeDisconnects: AudioTraceMap = {};
const nodeStarts: AudioTraceMap = {};
const nodeStops: AudioTraceMap = {};
const listenerAdds: AudioTraceMap = {};
const listenerRemoves: AudioTraceMap = {};
const workletModules: AudioTraceMap = {};
const toneCreates: AudioTraceMap = {};
const toneDisposes: AudioTraceMap = {};
const toneActive: AudioTraceMap = {};
const leanCounters: AudioTraceMap = {};
const records = new Map<number, AudioTraceRecord>();
const nodeIds = new WeakMap<object, number>();
const nodeTypes = new WeakMap<object, string>();
const activeWorkletNodes = new Set<number>();
const activeConstantSourceNodes = new Set<number>();
const activeSourceNodes = new Set<number>();
const activeAnalyzers = new Set<number>();
const listenerRecords = new Map<string, number>();
const violations: AudioNodeTraceSnapshot["violations"] = [];

function isEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("snAudioNodeTrace") === "1") {
      cachedEnabled = true;
      return true;
    }
  } catch {
    // ignore
  }
  try {
    cachedEnabled = window.localStorage?.getItem(STORAGE_KEY) === "1";
    return cachedEnabled;
  } catch {
    cachedEnabled = false;
    return false;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? Math.round(performance.now()) : Date.now();
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

function inc(map: AudioTraceMap, key: string, delta = 1): void {
  map[key] = Math.max(0, (map[key] ?? 0) + delta);
}

function typeForNode(node: object, fallback: string): string {
  return nodeTypes.get(node) ?? (node as { constructor?: { name?: string } }).constructor?.name ?? fallback;
}

function idForNode(node: object, type: string): number {
  const existing = nodeIds.get(node);
  if (existing) return existing;
  const id = nextId++;
  nodeIds.set(node, id);
  nodeTypes.set(node, type);
  return id;
}

function record(kind: string, type: string, detail?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  const id = nextId++;
  records.set(id, {
    id,
    kind,
    type,
    stack: stackTrace(),
    addedAt: now(),
    detail,
  });
}

function recordNodeCreate(node: object, type: string): void {
  if (!isEnabled()) return;
  const id = idForNode(node, type);
  inc(nodeCreates, type);
  if (type === "AudioWorkletNode") activeWorkletNodes.add(id);
  if (type === "ConstantSourceNode") activeConstantSourceNodes.add(id);
  if (type === "AnalyserNode") activeAnalyzers.add(id);
  if (
    type === "AudioBufferSourceNode" ||
    type === "OscillatorNode" ||
    type === "ConstantSourceNode"
  ) {
    activeSourceNodes.add(id);
  }
  record("node-create", type);
}

function recordNodeInactive(node: object): void {
  const id = nodeIds.get(node);
  if (!id) return;
  activeWorkletNodes.delete(id);
  activeConstantSourceNodes.delete(id);
  activeSourceNodes.delete(id);
  activeAnalyzers.delete(id);
}

function listenerKey(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null): string {
  const targetId = idForNode(target, targetLabel(target));
  const listenerLabel = typeof listener === "function" ? listener.name || "anonymous" : "object";
  return `${targetId}:${type}:${listenerLabel}`;
}

function targetLabel(target: EventTarget): string {
  const ctor = (target as { constructor?: { name?: string } }).constructor?.name ?? "EventTarget";
  if (typeof AudioWorkletNode !== "undefined" && target instanceof AudioWorkletNode) return "AudioWorkletNode";
  if (typeof AudioScheduledSourceNode !== "undefined" && target instanceof AudioScheduledSourceNode) {
    return typeForNode(target, ctor);
  }
  if (typeof AudioNode !== "undefined" && target instanceof AudioNode) return typeForNode(target, ctor);
  if (typeof MessagePort !== "undefined" && target instanceof MessagePort) return "MessagePort";
  return ctor;
}

function isAudioTraceTarget(target: EventTarget): boolean {
  return (
    (typeof AudioNode !== "undefined" && target instanceof AudioNode) ||
    (typeof AudioWorkletNode !== "undefined" && target instanceof AudioWorkletNode) ||
    (typeof AudioScheduledSourceNode !== "undefined" && target instanceof AudioScheduledSourceNode) ||
    (typeof MessagePort !== "undefined" && target instanceof MessagePort)
  );
}

function summarizeStacks(limit = 20): AudioNodeTraceSnapshot["topStacks"] {
  const grouped = new Map<string, { label: string; count: number; stack: string }>();
  for (const r of records.values()) {
    const label = `${r.kind}:${r.type}`;
    const key = `${label}|${r.stack}`;
    const current = grouped.get(key);
    if (current) current.count += 1;
    else grouped.set(key, { label, stack: r.stack, count: 1 });
  }
  return Array.from(grouped.values()).sort((a, b) => b.count - a.count).slice(0, limit);
}

function activeTone(kind: string): number {
  return toneActive[kind] ?? 0;
}

export function getAudioNodeTraceSnapshot(): AudioNodeTraceSnapshot {
  const topStacks = summarizeStacks(20);
  return {
    enabled: isEnabled(),
    installed,
    nodeCreates: { ...nodeCreates },
    nodeDisconnects: { ...nodeDisconnects },
    nodeStarts: { ...nodeStarts },
    nodeStops: { ...nodeStops },
    listenerAdds: { ...listenerAdds },
    listenerRemoves: { ...listenerRemoves },
    workletModules: { ...workletModules },
    toneCreates: { ...toneCreates },
    toneDisposes: { ...toneDisposes },
    toneActive: { ...toneActive },
    activeAudioWorkletNodes: activeWorkletNodes.size,
    activeConstantSourceNodes: activeConstantSourceNodes.size,
    activeSourceNodes: activeSourceNodes.size,
    activeAnalyzers: activeAnalyzers.size + activeTone("analyser"),
    activeTrackVoices: activeTone("trackVoice"),
    activeScheduledPlayers: activeTone("scheduledPlayer"),
    activeTransportEvents: activeTone("transportEvent"),
    leanDrumVoicesActive: leanCounters.leanDrumVoicesActive ?? 0,
    leanDrumHitsScheduled: leanCounters.leanDrumHitsScheduled ?? 0,
    leanDrumHitsTriggered: leanCounters.leanDrumHitsTriggered ?? 0,
    leanOneShotSourcesCreated: leanCounters.leanOneShotSourcesCreated ?? 0,
    leanOneShotSourcesEnded: leanCounters.leanOneShotSourcesEnded ?? 0,
    leanOneShotSourcesDisconnected: leanCounters.leanOneShotSourcesDisconnected ?? 0,
    leanOneShotSourcesActive: leanCounters.leanOneShotSourcesActive ?? 0,
    violations: violations.slice(-50),
    suspectedLeaks: topStacks.filter((entry) => entry.count > 5),
    topStacks,
  };
}

export function trackToneCreate(kind: string, label?: string): void {
  if (!isEnabled()) return;
  const key = label ? `${kind}:${label}` : kind;
  inc(toneCreates, key);
  inc(toneActive, kind);
  record("tone-create", key);
}

export function trackToneDispose(kind: string, label?: string): void {
  if (!isEnabled()) return;
  const key = label ? `${kind}:${label}` : kind;
  inc(toneDisposes, key);
  inc(toneActive, kind, -1);
  record("tone-dispose", key);
}

export function recordLeanDrumTrace(
  event:
    | "voice-created"
    | "voice-disposed"
    | "hit-scheduled"
    | "hit-triggered"
    | "source-created"
    | "source-ended"
    | "source-disconnected"
    | "reused-track-nodes",
  detail?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  switch (event) {
    case "voice-created":
      inc(leanCounters, "leanDrumVoicesActive");
      break;
    case "voice-disposed":
      inc(leanCounters, "leanDrumVoicesActive", -1);
      break;
    case "hit-scheduled":
      inc(leanCounters, "leanDrumHitsScheduled");
      break;
    case "hit-triggered":
      inc(leanCounters, "leanDrumHitsTriggered");
      break;
    case "source-created":
      inc(leanCounters, "leanOneShotSourcesCreated");
      inc(leanCounters, "leanOneShotSourcesActive");
      break;
    case "source-ended":
      inc(leanCounters, "leanOneShotSourcesEnded");
      break;
    case "source-disconnected":
      inc(leanCounters, "leanOneShotSourcesDisconnected");
      inc(leanCounters, "leanOneShotSourcesActive", -1);
      break;
    case "reused-track-nodes":
      inc(leanCounters, "leanDrumTrackNodeReuse");
      break;
  }
  record("lean-drum", event, detail);
}

export function trackAudioTraceTransportEvent(id: number, label: string): void {
  if (!isEnabled()) return;
  inc(toneCreates, `transportEvent:${label}`);
  inc(toneActive, "transportEvent");
  record("transport-schedule", label, { id });
}

export function untrackAudioTraceTransportEvent(id: number, label?: string): void {
  if (!isEnabled()) return;
  inc(toneDisposes, `transportEvent:${label ?? "unknown"}`);
  inc(toneActive, "transportEvent", -1);
  record("transport-clear", label ?? "unknown", { id });
}

export function recordAudioWorkletViolation(message: string, detail?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  violations.push({ message, detail, stack: stackTrace() });
  if (violations.length > 100) violations.shift();
  // eslint-disable-next-line no-console
  console.warn(`[studio-audio-node-trace] ${message}`, detail ?? "");
}

function clearAudioNodeTrace(): void {
  for (const map of [
    nodeCreates,
    nodeDisconnects,
    nodeStarts,
    nodeStops,
    listenerAdds,
    listenerRemoves,
    workletModules,
    toneCreates,
    toneDisposes,
    toneActive,
    leanCounters,
  ]) {
    for (const key of Object.keys(map)) delete map[key];
  }
  records.clear();
  listenerRecords.clear();
  activeWorkletNodes.clear();
  activeConstantSourceNodes.clear();
  activeSourceNodes.clear();
  activeAnalyzers.clear();
  violations.length = 0;
}

function api(): AudioNodeTraceApi {
  return {
    enabled: isEnabled(),
    snapshot: getAudioNodeTraceSnapshot,
    dumpTopStacks: (limit = 20) => summarizeStacks(limit),
    clear: clearAudioNodeTrace,
    start: startAudioNodeTrace,
    stop: uninstallAudioNodeTrace,
  };
}

export function installAudioNodeTrace(): void {
  if (typeof window === "undefined") return;
  window.__SN_AUDIO_NODE_TRACE__ = api();
}

export function startAudioNodeTrace(): void {
  if (installed || typeof window === "undefined" || !isEnabled()) {
    if (typeof window !== "undefined") window.__SN_AUDIO_NODE_TRACE__ = api();
    return;
  }
  installed = true;
  originals = { createMethods: {} };

  const createMethodNames = [
    "createConstantSource",
    "createGain",
    "createBiquadFilter",
    "createIIRFilter",
    "createOscillator",
    "createBufferSource",
    "createStereoPanner",
    "createDynamicsCompressor",
    "createConvolver",
    "createDelay",
    "createAnalyser",
  ] as const;

  for (const methodName of createMethodNames) {
    const original = BaseAudioContext.prototype[methodName];
    if (typeof original !== "function") continue;
    originals.createMethods[methodName] = original;
    (BaseAudioContext.prototype[methodName] as unknown) = function patchedCreateNode(
      this: BaseAudioContext,
      ...args: unknown[]
    ) {
      const node = (original as (...callArgs: unknown[]) => object).apply(this, args);
      recordNodeCreate(node, (node as { constructor?: { name?: string } }).constructor?.name ?? methodName);
      return node;
    };
  }

  originals.connect = AudioNode.prototype.connect;
  originals.disconnect = AudioNode.prototype.disconnect;
  AudioNode.prototype.connect = function patchedConnect(this: AudioNode, ...args: unknown[]) {
    record("node-connect", typeForNode(this, "AudioNode"));
    return (originals!.connect as (...callArgs: unknown[]) => unknown).apply(this, args);
  } as AudioNode["connect"];
  AudioNode.prototype.disconnect = function patchedDisconnect(this: AudioNode, ...args: unknown[]) {
    const type = typeForNode(this, "AudioNode");
    inc(nodeDisconnects, type);
    record("node-disconnect", type);
    recordNodeInactive(this);
    return (originals!.disconnect as (...callArgs: unknown[]) => unknown).apply(this, args);
  } as AudioNode["disconnect"];

  if (typeof AudioScheduledSourceNode !== "undefined") {
    originals.start = AudioScheduledSourceNode.prototype.start;
    originals.stop = AudioScheduledSourceNode.prototype.stop;
    AudioScheduledSourceNode.prototype.start = function patchedStart(
      this: AudioScheduledSourceNode,
      ...args: unknown[]
    ) {
      const type = typeForNode(this, "AudioScheduledSourceNode");
      inc(nodeStarts, type);
      record("node-start", type);
      return (originals!.start as (...callArgs: unknown[]) => unknown).apply(this, args);
    } as AudioScheduledSourceNode["start"];
    AudioScheduledSourceNode.prototype.stop = function patchedStop(
      this: AudioScheduledSourceNode,
      ...args: unknown[]
    ) {
      const type = typeForNode(this, "AudioScheduledSourceNode");
      inc(nodeStops, type);
      record("node-stop", type);
      recordNodeInactive(this);
      return (originals!.stop as (...callArgs: unknown[]) => unknown).apply(this, args);
    } as AudioScheduledSourceNode["stop"];
  }

  originals.addEventListener = EventTarget.prototype.addEventListener;
  originals.removeEventListener = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function patchedAdd(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (isAudioTraceTarget(this)) {
      const label = `${targetLabel(this)}:${type}`;
      inc(listenerAdds, label);
      listenerRecords.set(listenerKey(this, type, listener), 1);
      record("listener-add", label);
    }
    return originals!.addEventListener!.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function patchedRemove(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (isAudioTraceTarget(this)) {
      const label = `${targetLabel(this)}:${type}`;
      inc(listenerRemoves, label);
      listenerRecords.delete(listenerKey(this, type, listener));
      record("listener-remove", label);
    }
    return originals!.removeEventListener!.call(this, type, listener, options);
  };

  if (typeof AudioWorklet !== "undefined" && AudioWorklet.prototype.addModule) {
    originals.addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function patchedAddModule(
      this: AudioWorklet,
      moduleURL: string | URL,
      options?: WorkletOptions,
    ) {
      const label = typeof moduleURL === "string" ? moduleURL.slice(0, 80) : "URL";
      inc(workletModules, label);
      record("worklet-addModule", label);
      return originals!.addModule!.call(this, moduleURL, options);
    };
  }

  if (typeof AudioWorkletNode !== "undefined") {
    originals.AudioWorkletNode = window.AudioWorkletNode;
    const OriginalAudioWorkletNode = originals.AudioWorkletNode;
    const PatchedAudioWorkletNode = function patchedAudioWorkletNode(
      this: AudioWorkletNode,
      context: BaseAudioContext,
      name: string,
      options?: AudioWorkletNodeOptions,
    ) {
      const node = new OriginalAudioWorkletNode(context, name, options);
      recordNodeCreate(node, "AudioWorkletNode");
      record("worklet-node-create", name);
      return node;
    } as unknown as typeof AudioWorkletNode;
    PatchedAudioWorkletNode.prototype = OriginalAudioWorkletNode.prototype;
    Object.setPrototypeOf(PatchedAudioWorkletNode, OriginalAudioWorkletNode);
    window.AudioWorkletNode = PatchedAudioWorkletNode;
  }

  window.__SN_AUDIO_NODE_TRACE__ = api();
}

export function uninstallAudioNodeTrace(): void {
  if (!installed || !originals || typeof window === "undefined") return;
  for (const [methodName, original] of Object.entries(originals.createMethods)) {
    (BaseAudioContext.prototype as unknown as Record<string, unknown>)[methodName] = original;
  }
  if (originals.connect) AudioNode.prototype.connect = originals.connect;
  if (originals.disconnect) AudioNode.prototype.disconnect = originals.disconnect;
  if (originals.start && typeof AudioScheduledSourceNode !== "undefined") {
    AudioScheduledSourceNode.prototype.start = originals.start;
  }
  if (originals.stop && typeof AudioScheduledSourceNode !== "undefined") {
    AudioScheduledSourceNode.prototype.stop = originals.stop;
  }
  if (originals.addEventListener) EventTarget.prototype.addEventListener = originals.addEventListener;
  if (originals.removeEventListener) EventTarget.prototype.removeEventListener = originals.removeEventListener;
  if (originals.addModule && typeof AudioWorklet !== "undefined") AudioWorklet.prototype.addModule = originals.addModule;
  if (originals.AudioWorkletNode) window.AudioWorkletNode = originals.AudioWorkletNode;
  installed = false;
  originals = null;
  clearAudioNodeTrace();
  window.__SN_AUDIO_NODE_TRACE__ = api();
}

installAudioNodeTrace();
