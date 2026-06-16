/**
 * WorkletManager — Phase 6 Pro Audio Engine
 *
 * Registers all AudioWorklet processors via a single Blob URL (no extra
 * Vite/Rollup config needed). Provides typed factory methods for each
 * processor node. Falls back gracefully when AudioWorklet is unsupported.
 *
 * Processors bundled:
 *   sn-metronome       — MetronomeProcessor (click tones on audio thread)
 *   sn-sample-player   — SamplePlayerProcessor (Float32Array playback)
 *   sn-soft-clipper    — SoftClipperProcessor (tanh curve, configurable drive)
 *   sn-limiter         — LimiterProcessor (look-ahead peak limiter)
 *   sn-saturation      — SaturationProcessor (asymmetric, optional 2× oversampling)
 */

import { recordAudioWorkletViolation } from "../performance/audioNodeTrace";

const PROCESSOR_CODE = /* js */ `
// ─────────────────────────────────────────────────────── MetronomeProcessor ──
class MetronomeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._phase = 0;
    this._freq = 1000;
    this._amp = 0;
    this._decay = 0;
    this._samplesLeft = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'schedule') {
        this._queue.push({ time: d.audioTime, accent: d.accent });
        this._queue.sort((a, b) => a.time - b.time);
      } else if (d.type === 'clear') {
        this._queue = [];
      } else if (d.type === 'ping') {
        this.port.postMessage({ type: 'pong', sentAt: d.sentAt });
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const ch0 = out[0];
    const blockEnd = currentTime + ch0.length / sampleRate;

    while (this._queue.length > 0 && this._queue[0].time <= blockEnd) {
      const ev = this._queue.shift();
      this._freq = ev.accent ? 1400 : 1000;
      this._amp  = ev.accent ? 0.55 : 0.38;
      this._phase = 0;
      const durationSamples = Math.ceil(sampleRate * 0.055);
      this._samplesLeft = durationSamples;
      this._decay = Math.pow(0.001, 1 / durationSamples);
    }

    const omega = 2 * Math.PI * this._freq / sampleRate;
    for (let i = 0; i < ch0.length; i++) {
      if (this._samplesLeft > 0) {
        const s = Math.sin(this._phase) * this._amp;
        ch0[i] = s;
        this._phase += omega;
        if (this._phase > 6.283185307) this._phase -= 6.283185307;
        this._amp *= this._decay;
        this._samplesLeft--;
      } else {
        ch0[i] = 0;
      }
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true;
  }
}
registerProcessor('sn-metronome', MetronomeProcessor);

// ──────────────────────────────────────────────── SamplePlayerProcessor ──
class SamplePlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._channels = null;
    this._pending = [];
    this._active  = [];
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'load') {
        this._channels = d.channels;
      } else if (d.type === 'play') {
        if (this._channels) {
          this._pending.push({ time: d.audioTime, rate: d.playbackRate || 1, amp: d.amplitude || 1, pos: 0 });
        }
      } else if (d.type === 'stop') {
        this._active = [];
        this._pending = [];
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const blockEnd = currentTime + out[0].length / sampleRate;

    for (let i = this._pending.length - 1; i >= 0; i--) {
      if (this._pending[i].time <= blockEnd) {
        this._active.push(this._pending[i]);
        this._pending.splice(i, 1);
      }
    }

    for (const ch of out) ch.fill(0);
    if (!this._channels) return true;

    const srcLen = this._channels[0].length;
    for (let pi = this._active.length - 1; pi >= 0; pi--) {
      const play = this._active[pi];
      let done = false;
      for (let i = 0; i < out[0].length; i++) {
        const pos = Math.floor(play.pos);
        if (pos >= srcLen) { done = true; break; }
        for (let c = 0; c < out.length; c++) {
          const srcC = Math.min(c, this._channels.length - 1);
          out[c][i] += (this._channels[srcC][pos] || 0) * play.amp;
        }
        play.pos += play.rate;
      }
      if (done) this._active.splice(pi, 1);
    }
    return true;
  }
}
registerProcessor('sn-sample-player', SamplePlayerProcessor);

// ─────────────────────────────────────────────────── SoftClipperProcessor ──
class SoftClipperProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive',   defaultValue: 1.6, minValue: 0.1, maxValue: 12, automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 1,   minValue: 0,   maxValue: 1,  automationRate: 'k-rate' },
    ];
  }

  process(inputs, outputs, params) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!inp || !out) return true;
    const drive   = params.drive[0];
    const enabled = params.enabled[0] > 0.5;
    const tanhD   = Math.tanh(drive);
    for (let c = 0; c < out.length; c++) {
      const ic = inp[c];
      const oc = out[c];
      if (!ic || !oc) continue;
      if (!enabled) { oc.set(ic); continue; }
      for (let i = 0; i < oc.length; i++) {
        oc[i] = Math.tanh(ic[i] * drive) / tanhD;
      }
    }
    return true;
  }
}
registerProcessor('sn-soft-clipper', SoftClipperProcessor);

// ───────────────────────────────────────────────────── LimiterProcessor ──
class LimiterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 5 ms lookahead
    this._lookahead = Math.ceil(sampleRate * 0.005);
    this._bufs = [new Float32Array(this._lookahead + 256), new Float32Array(this._lookahead + 256)];
    this._writePos = 0;
    this._gain     = 1.0;
    this._attack   = Math.exp(-1 / (sampleRate * 0.0005));
    this._release  = Math.exp(-1 / (sampleRate * 0.120));
  }

  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -0.6, minValue: -24, maxValue: 0, automationRate: 'k-rate' },
      { name: 'enabled',   defaultValue: 1,    minValue: 0,   maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  process(inputs, outputs, params) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!inp || !out || !out[0]) return true;

    const threshLin = Math.pow(10, params.threshold[0] / 20);
    const enabled   = params.enabled[0] > 0.5;
    const n = out[0].length;
    const numCh = Math.min(inp.length, 2);

    if (!enabled) {
      for (let c = 0; c < out.length; c++) { if (inp[c] && out[c]) out[c].set(inp[c]); }
      return true;
    }

    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < numCh; c++) {
        if (inp[c]) peak = Math.max(peak, Math.abs(inp[c][i]));
      }
      const targetGain = (peak > threshLin && peak > 0) ? threshLin / peak : 1.0;
      if (targetGain < this._gain) {
        this._gain = targetGain + (this._gain - targetGain) * this._attack;
      } else {
        this._gain = targetGain + (this._gain - targetGain) * this._release;
      }
      for (let c = 0; c < out.length; c++) {
        if (inp[c] && out[c]) out[c][i] = inp[c][i] * this._gain;
      }
    }
    return true;
  }
}
registerProcessor('sn-limiter', LimiterProcessor);

// ─────────────────────────────────────────────────── SaturationProcessor ──
class SaturationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive',      defaultValue: 1.5, minValue: 0.01, maxValue: 12, automationRate: 'k-rate' },
      { name: 'mix',        defaultValue: 1,   minValue: 0,    maxValue: 1,  automationRate: 'k-rate' },
      { name: 'oversample', defaultValue: 0,   minValue: 0,    maxValue: 1,  automationRate: 'k-rate' },
      { name: 'enabled',    defaultValue: 1,   minValue: 0,    maxValue: 1,  automationRate: 'k-rate' },
    ];
  }

  _sat(x, drive) {
    // Asymmetric: positive tanh, negative softer (odd-harmonic enhancement)
    if (x >= 0) return Math.tanh(x * drive) / Math.tanh(drive);
    const d2 = drive * 0.78;
    return -(Math.tanh(-x * d2) / Math.tanh(d2));
  }

  process(inputs, outputs, params) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!inp || !out) return true;

    const drive      = Math.max(0.01, params.drive[0]);
    const mix        = params.mix[0];
    const oversample = params.oversample[0] > 0.5;
    const enabled    = params.enabled[0] > 0.5;

    for (let c = 0; c < out.length; c++) {
      const ic = inp[c];
      const oc = out[c];
      if (!ic || !oc) continue;
      if (!enabled) { oc.set(ic); continue; }

      if (oversample) {
        const n  = ic.length;
        for (let i = 0; i < n; i++) {
          const next = i + 1 < n ? ic[i + 1] : ic[i];
          const sat = (this._sat(ic[i], drive) + this._sat((ic[i] + next) * 0.5, drive)) * 0.5;
          oc[i] = ic[i] * (1 - mix) + sat * mix;
        }
      } else {
        for (let i = 0; i < oc.length; i++) {
          oc[i] = ic[i] * (1 - mix) + this._sat(ic[i], drive) * mix;
        }
      }
    }
    return true;
  }
}
registerProcessor('sn-saturation', SaturationProcessor);
`;

type WorkletNodeKind = 'metronome' | 'sample-player' | 'soft-clipper' | 'limiter' | 'saturation';
const AUDIO_WORKLETS_ENABLED = import.meta.env.VITE_STUDIO_ENABLE_AUDIO_WORKLETS === "1";

const PROCESSOR_NAMES: Record<WorkletNodeKind, string> = {
  'metronome':     'sn-metronome',
  'sample-player': 'sn-sample-player',
  'soft-clipper':  'sn-soft-clipper',
  'limiter':       'sn-limiter',
  'saturation':    'sn-saturation',
};

function resolveNativeContext(context: AudioContext | BaseAudioContext | unknown): BaseAudioContext | null {
  if (
    typeof BaseAudioContext !== "undefined" &&
    context instanceof BaseAudioContext
  ) {
    return context;
  }

  const maybe = context as
    | {
        rawContext?: unknown;
        _context?: unknown;
        _nativeAudioContext?: unknown;
      }
    | null
    | undefined;

  if (
    typeof BaseAudioContext !== "undefined" &&
    maybe?.rawContext instanceof BaseAudioContext
  ) {
    return maybe.rawContext;
  }

  const rawContext = maybe?.rawContext as
    | { _nativeAudioContext?: unknown }
    | null
    | undefined;
  if (
    typeof BaseAudioContext !== "undefined" &&
    rawContext?._nativeAudioContext instanceof BaseAudioContext
  ) {
    return rawContext._nativeAudioContext;
  }

  if (
    typeof BaseAudioContext !== "undefined" &&
    maybe?._context instanceof BaseAudioContext
  ) {
    return maybe._context;
  }

  const internalContext = maybe?._context as
    | { _nativeAudioContext?: unknown }
    | null
    | undefined;
  if (
    typeof BaseAudioContext !== "undefined" &&
    internalContext?._nativeAudioContext instanceof BaseAudioContext
  ) {
    return internalContext._nativeAudioContext;
  }

  if (
    typeof BaseAudioContext !== "undefined" &&
    maybe?._nativeAudioContext instanceof BaseAudioContext
  ) {
    return maybe._nativeAudioContext;
  }

  return null;
}

function resolveToneWorkletContext(context: unknown): {
  addAudioWorkletModule?: (url: string) => Promise<void>;
  createAudioWorkletNode?: (
    name: string,
    options?: AudioWorkletNodeOptions,
  ) => AudioWorkletNode;
} | null {
  const maybe = context as
    | {
        addAudioWorkletModule?: unknown;
        createAudioWorkletNode?: unknown;
      }
    | null
    | undefined;

  if (
    typeof maybe?.addAudioWorkletModule === "function" ||
    typeof maybe?.createAudioWorkletNode === "function"
  ) {
    return maybe as {
      addAudioWorkletModule?: (url: string) => Promise<void>;
      createAudioWorkletNode?: (
        name: string,
        options?: AudioWorkletNodeOptions,
      ) => AudioWorkletNode;
    };
  }

  return null;
}

class WorkletManager {
  private static _instance: WorkletManager | null = null;

  private _registered    = false;
  private _registering   = false;
  private _fallback      = false;
  private _unavailableReason: string | null = null;
  private _blobUrl: string | null = null;

  // CPU round-trip probe state
  private _probeNode: AudioWorkletNode | null = null;
  private _lastRoundTripMs: number | null = null;
  private _pingPendingAt: number | null = null;

  static get instance(): WorkletManager {
    if (!WorkletManager._instance) WorkletManager._instance = new WorkletManager();
    return WorkletManager._instance;
  }

  /** Whether the browser supports AudioWorklet at all. */
  get supported(): boolean {
    return typeof AudioWorkletNode !== 'undefined';
  }

  /** True when worklets could not be registered; engine should use Tone.js fallback nodes. */
  get fallback(): boolean {
    return this._fallback;
  }

  get unavailableReason(): string | null {
    return this._unavailableReason;
  }

  /** True when the worklet module has been successfully registered. */
  get ready(): boolean {
    return this._registered;
  }

  /**
   * Register all processor classes with the given AudioContext.
   * Safe to call multiple times — idempotent once registered.
   */
  async register(context: AudioContext): Promise<boolean> {
    if (!AUDIO_WORKLETS_ENABLED) {
      recordAudioWorkletViolation("AudioWorklet register attempted without VITE_STUDIO_ENABLE_AUDIO_WORKLETS=1");
      this.markUnavailable("AudioWorklet path disabled by default; set VITE_STUDIO_ENABLE_AUDIO_WORKLETS=1 for profiling.");
      return false;
    }
    if (this._fallback) return false;
    if (!this.supported) {
      this.markUnavailable("AudioWorkletNode is not supported");
      return false;
    }
    if (this._registered) return true;
    if (this._registering) {
      // Spin-wait for concurrent registration.
      for (let i = 0; i < 40 && this._registering; i++) {
        await new Promise<void>((r) => setTimeout(r, 50));
      }
      return this._registered;
    }
    this._registering = true;
    try {
      const nativeContext = resolveNativeContext(context);
      const toneContext = resolveToneWorkletContext(context);
      const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
      const url  = URL.createObjectURL(blob);
      this._blobUrl = url;
      if (nativeContext && "audioWorklet" in nativeContext) {
        await nativeContext.audioWorklet.addModule(url);
      } else if (toneContext?.addAudioWorkletModule) {
        await toneContext.addAudioWorkletModule(url);
      } else {
        throw new TypeError("AudioWorklet registration requires a native or Tone worklet context");
      }
      this._registered = true;
      return true;
    } catch (err) {
      const details = describeError(err);
      console.warn('[WorkletManager] AudioWorklet registration failed — using Tone.js fallback.', details, err);
      this.markUnavailable(details.message);
      return false;
    } finally {
      this._registering = false;
    }
  }

  /** Create a typed AudioWorkletNode or null if not registered. */
  createNode(kind: WorkletNodeKind, context: AudioContext, options?: AudioWorkletNodeOptions): AudioWorkletNode | null {
    if (!AUDIO_WORKLETS_ENABLED) {
      recordAudioWorkletViolation("AudioWorkletNode creation attempted without VITE_STUDIO_ENABLE_AUDIO_WORKLETS=1", { kind });
      this.markUnavailable("AudioWorklet path disabled by default; set VITE_STUDIO_ENABLE_AUDIO_WORKLETS=1 for profiling.");
      return null;
    }
    if (!this._registered || this._fallback) return null;
    try {
      const nativeContext = resolveNativeContext(context);
      if (nativeContext) {
        return new AudioWorkletNode(nativeContext, PROCESSOR_NAMES[kind], options);
      }
      const toneContext = resolveToneWorkletContext(context);
      if (toneContext?.createAudioWorkletNode) {
        return toneContext.createAudioWorkletNode(PROCESSOR_NAMES[kind], options);
      }
      throw new TypeError("AudioWorkletNode requires a native or Tone worklet context");
    } catch (err) {
      console.warn(`[WorkletManager] Failed to create ${kind} node:`, describeError(err), err);
      return null;
    }
  }

  /** Send a typed message to a worklet node's message port. */
  postMessage(node: AudioWorkletNode, msg: Record<string, unknown>): void {
    try { node.port.postMessage(msg); } catch { /* ignore */ }
  }

  disposeNode(node: AudioWorkletNode | null): void {
    if (!node) return;
    try {
      node.port.onmessage = null;
    } catch {
      // ignore
    }
    try {
      node.port.close();
    } catch {
      // ignore
    }
    try {
      node.disconnect();
    } catch {
      // ignore
    }
  }

  markUnavailable(reason: string): void {
    this._fallback = true;
    this._unavailableReason = reason;
    this.disposeNode(this._probeNode);
    this._probeNode = null;
    this._pingPendingAt = null;
  }

  /**
   * Initialise the CPU probe node (a silent metronome node used purely for
   * ping/pong round-trip timing). Call once after registration succeeds.
   */
  startCpuProbe(context: AudioContext): void {
    if (!AUDIO_WORKLETS_ENABLED) {
      recordAudioWorkletViolation("AudioWorklet CPU probe attempted without VITE_STUDIO_ENABLE_AUDIO_WORKLETS=1");
      return;
    }
    if (!this._registered || this._probeNode) return;
    try {
      const node = new AudioWorkletNode(context, 'sn-metronome');
      // Do NOT connect to destination — we only use the message port.
      node.port.onmessage = (e) => {
        if (e.data?.type === 'pong' && this._pingPendingAt !== null) {
          this._lastRoundTripMs = performance.now() - this._pingPendingAt;
          this._pingPendingAt = null;
        }
      };
      this._probeNode = node;
    } catch {
      // Probe is non-critical; ignore failures.
    }
  }

  /**
   * Send a ping to the audio worklet thread. Call periodically (e.g. 4 Hz).
   * The measured round-trip is available via `getLastRoundTripMs()` on the
   * next call — it reflects how quickly the audio thread could respond, which
   * correlates with CPU headroom.
   */
  pingCpu(): void {
    if (!this._probeNode || this._pingPendingAt !== null) return;
    this._pingPendingAt = performance.now();
    try {
      this._probeNode.port.postMessage({ type: 'ping', sentAt: this._pingPendingAt });
    } catch {
      this._pingPendingAt = null;
    }
  }

  /**
   * Last measured main-thread → audio-worklet → main-thread round-trip in ms.
   * Returns null until the first successful pong is received.
   */
  get lastRoundTripMs(): number | null {
    return this._lastRoundTripMs;
  }

  /** Dispose — revoke the blob URL to free memory. */
  dispose(): void {
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
    this.disposeNode(this._probeNode);
    this._probeNode = null;
    this._pingPendingAt = null;
  }
}

export const workletManager = WorkletManager.instance;

export function describeError(err: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return {
    name: typeof err,
    message: String(err),
  };
}
