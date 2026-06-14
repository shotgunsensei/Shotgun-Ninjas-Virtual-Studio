import * as Tone from "tone";
import type { MasterBusSettings, SendBusId } from "../../types";
import { SEND_BUS_IDS } from "../../types";
import { describeError, workletManager } from "./worklet-manager";
import { trackInterval } from "../../utils/performanceDiagnostics";

/**
 * Master safety chain (v2, Phase 6 upgrade).
 *
 * Every track channel feeds into `input`. The chain then runs:
 *   input -> glueComp -> softClip -> [saturation*] -> width -> safetyComp -> limiter -> makeup -> Destination
 *
 * (* saturation stage added in Phase 6 when AudioWorklet is available)
 *
 * Phase 6 additions:
 *   - Three AudioWorkletProcessor nodes (SoftClipper, Saturation, Limiter) inserted
 *     when worklets are available, keeping the Tone.js nodes as fallback.
 *   - 2× oversampling option for the saturation stage (CPU-intensive — warn in diagnostics).
 *   - All parameter changes use linearRampToValueAtTime / rampTo for anti-click.
 *
 * In addition, the master owns 4 named global send buses (Room Reverb, Neon Hall,
 * Tape Delay, Dark Slapback). Each track taps its post-fader signal into any
 * combination of these buses via dedicated send gains.
 *
 * `getClipped()` returns a latched flag set whenever the post-limiter peak ever
 * crosses -0.1 dBFS. The UI calls `resetClip()` to clear it.
 */

export interface SendBusNode {
  id: SendBusId;
  input: Tone.Gain;
  fx: Tone.Freeverb | Tone.JCReverb | Tone.FeedbackDelay;
}

export const DEFAULT_MASTER_BUS: MasterBusSettings = {
  limiterThresholdDb: -0.6,
  limiterGainDb: 0,
  glueEnabled: true,
  glueThresholdDb: -14,
  glueRatio: 2,
  glueAttack: 0.025,
  glueRelease: 0.18,
  softClip: false,
  width: 1,
  oversample: false,
};

export class MasterChain {
  readonly input: Tone.Channel;
  private glueComp: Tone.Compressor;
  private safetyComp: Tone.Compressor;
  private limiter: Tone.Limiter;
  private makeup: Tone.Gain;
  private softClipper: Tone.WaveShaper;
  private widener: Tone.StereoWidener;
  private meter: Tone.Meter;
  private peakMeter: Tone.Meter;
  private buses: Map<SendBusId, SendBusNode>;
  private settings: MasterBusSettings = { ...DEFAULT_MASTER_BUS };
  private clipped = false;
  private clipCheckId: number | null = null;
  private untrackClipCheckInterval: (() => void) | null = null;

  private levels: { peakDb: [number, number]; rmsDb: [number, number] } = {
    peakDb: [-Infinity, -Infinity],
    rmsDb: [-Infinity, -Infinity],
  };

  // Phase 6: AudioWorklet DSP nodes (null = worklets not yet registered / unsupported)
  private softClipperWorklet: AudioWorkletNode | null = null;
  private saturationWorklet: AudioWorkletNode | null = null;
  private limiterWorklet: AudioWorkletNode | null = null;
  private workletsActive = false;
  private workletParamTimer: number | null = null;

  constructor() {
    this.input = new Tone.Channel({ volume: 0 });
    this.glueComp = new Tone.Compressor({
      threshold: this.settings.glueThresholdDb,
      ratio: this.settings.glueRatio,
      attack: this.settings.glueAttack,
      release: this.settings.glueRelease,
      knee: 8,
    });
    this.safetyComp = new Tone.Compressor({
      threshold: -6,
      ratio: 4,
      attack: 0.005,
      release: 0.1,
      knee: 4,
    });
    this.limiter = new Tone.Limiter(this.settings.limiterThresholdDb);
    this.makeup = new Tone.Gain(1);
    this.softClipper = new Tone.WaveShaper(makeIdentityCurve(), 2048);
    this.widener = new Tone.StereoWidener({ width: 0.5 });
    this.meter = new Tone.Meter({ smoothing: 0.7 });
    this.peakMeter = new Tone.Meter({ smoothing: 0 });

    this.input.chain(
      this.glueComp,
      this.softClipper,
      this.widener,
      this.safetyComp,
      this.limiter,
      this.makeup,
      Tone.getDestination(),
    );
    this.makeup.connect(this.meter);
    this.makeup.connect(this.peakMeter);

    this.buses = new Map();
    for (const id of SEND_BUS_IDS) {
      const fx = makeBusFx(id);
      const input = new Tone.Gain(1);
      input.connect(fx);
      fx.connect(this.input);
      this.buses.set(id, { id, input, fx });
    }

    this.applySettings(this.settings);
    this.startClipWatcher();
  }

  // ── Phase 6: AudioWorklet integration ───────────────────────────────────

  /**
   * Call after AudioWorklet registration succeeds. Inserts the three worklet
   * processors into the master chain, replacing the Tone.js WaveShaper and
   * augmenting the Tone.Limiter. Falls back silently if node creation fails.
   */
  initWorklets(): void {
    if (workletManager.fallback || !workletManager.ready) return;
    const toneCtx = Tone.getContext() as unknown as AudioContext;

    const clip = workletManager.createNode("soft-clipper", toneCtx);
    const sat  = workletManager.createNode("saturation",   toneCtx);
    const lim  = workletManager.createNode("limiter",      toneCtx);

    if (!clip || !sat || !lim) {
      workletManager.disposeNode(clip);
      workletManager.disposeNode(sat);
      workletManager.disposeNode(lim);
      workletManager.markUnavailable("Master worklet node creation returned null");
      return;
    }

    this.softClipperWorklet = clip;
    this.saturationWorklet  = sat;
    this.limiterWorklet     = lim;

    try {
      // ── Rewire: glueComp -> softClipperWorklet -> saturationWorklet -> softClipper (identity) -> widener ──
      this.glueComp.disconnect(this.softClipper);
      // Tone.ToneAudioNode.connect accepts raw AudioNodes via the underlying AudioNode.
      const rawGlue = getOutputNode(this.glueComp);
      const rawClip = getInputNode(this.softClipper);

      rawGlue.connect(this.softClipperWorklet);
      this.softClipperWorklet.connect(this.saturationWorklet);
      this.saturationWorklet.connect(rawClip);

      // Set WaveShaper to identity so it becomes a pass-through.
      this.softClipper.curve = makeIdentityCurve();

      // ── Rewire: safetyComp -> limiterWorklet -> limiter ──
      this.safetyComp.disconnect(this.limiter);
      const rawSafety = getOutputNode(this.safetyComp);
      const rawLim    = getInputNode(this.limiter);

      rawSafety.connect(this.limiterWorklet);
      this.limiterWorklet.connect(rawLim);

      // Park Tone.Limiter at 0 dBFS so worklet limiter is the active gate.
      this.limiter.threshold.value = 0;

      this.workletsActive = true;

      // Sync initial settings to worklet parameters.
      this._applyWorkletParams();
    } catch (err) {
      const details = describeError(err);
      console.warn("[MasterChain] Worklet rewire failed — keeping Tone.js chain.", details, err);
      this.cleanupFailedWorklets();
      this.restoreToneFallbackChain();
      workletManager.markUnavailable(
        `MasterChain worklet rewire failed: ${details.name}: ${details.message}`,
      );
    }
  }

  private cleanupFailedWorklets(): void {
    this.workletsActive = false;
    if (this.workletParamTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.workletParamTimer);
      this.workletParamTimer = null;
    }
    workletManager.disposeNode(this.softClipperWorklet);
    workletManager.disposeNode(this.saturationWorklet);
    workletManager.disposeNode(this.limiterWorklet);
    this.softClipperWorklet = null;
    this.saturationWorklet = null;
    this.limiterWorklet = null;
  }

  private restoreToneFallbackChain(): void {
    const nodes: Tone.ToneAudioNode[] = [
      this.input,
      this.glueComp,
      this.softClipper,
      this.widener,
      this.safetyComp,
      this.limiter,
      this.makeup,
    ];
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    }
    this.limiter.threshold.value = this.settings.limiterThresholdDb;
    this.softClipper.curve = this.settings.softClip
      ? makeSoftClipCurve()
      : makeIdentityCurve();
    this.input.chain(
      this.glueComp,
      this.softClipper,
      this.widener,
      this.safetyComp,
      this.limiter,
      this.makeup,
      Tone.getDestination(),
    );
    this.makeup.connect(this.meter);
    this.makeup.connect(this.peakMeter);
  }

  /** Sync current settings to worklet AudioParams. */
  private _applyWorkletParams(): void {
    if (!this.workletsActive) return;
    if (this.workletParamTimer !== null) return;
    this.workletParamTimer = window.setTimeout(() => {
      this.workletParamTimer = null;
      this.flushWorkletParams();
    }, 33);
  }

  private flushWorkletParams(): void {
    if (!this.workletsActive) return;
    const s = this.settings;

    // Soft clipper: enable only when softClip setting is on.
    if (this.softClipperWorklet) {
      const p = this.softClipperWorklet.parameters as unknown as Map<string, AudioParam>;
      const enabled = p.get("enabled");
      const drive   = p.get("drive");
      if (enabled) enabled.value = s.softClip ? 1 : 0;
      if (drive)   drive.value   = 1.6;
    }

    // Saturation: always mildly active for warmth; oversample controls 2× mode.
    if (this.saturationWorklet) {
      const p = this.saturationWorklet.parameters as unknown as Map<string, AudioParam>;
      const enabled    = p.get("enabled");
      const drive      = p.get("drive");
      const mix        = p.get("mix");
      const oversample = p.get("oversample");
      if (enabled)    enabled.value    = 1;
      if (drive)      drive.value      = 1.3;
      if (mix)        mix.value        = 0.15; // mild default warmth
      if (oversample) oversample.value = s.oversample ? 1 : 0;
    }

    // Limiter: threshold + enabled.
    if (this.limiterWorklet) {
      const p = this.limiterWorklet.parameters as unknown as Map<string, AudioParam>;
      const threshold = p.get("threshold");
      const enabled   = p.get("enabled");
      if (threshold) threshold.value = clamp(s.limiterThresholdDb, -24, 0);
      if (enabled)   enabled.value   = 1;
    }
  }

  /** Enable or disable 2× oversampling on the saturation worklet. */
  setOversampling(on: boolean): void {
    this.settings = { ...this.settings, oversample: on };
    this._applyWorkletParams();
  }

  // ── send buses ──────────────────────────────────────────────────────────

  getBus(id: SendBusId): SendBusNode | undefined {
    return this.buses.get(id);
  }

  getBuses(): SendBusNode[] {
    return SEND_BUS_IDS.map((id) => this.buses.get(id)!).filter(Boolean);
  }

  // ── meter ───────────────────────────────────────────────────────────────

  getMeter(): Tone.Meter {
    return this.meter;
  }

  getLevels(): { peakDb: [number, number]; rmsDb: [number, number] } {
    const rms  = this.meter.getValue();
    const peak = this.peakMeter.getValue();
    if (typeof rms === "number") {
      this.levels.rmsDb[0] = rms;
      this.levels.rmsDb[1] = rms;
    } else {
      this.levels.rmsDb[0] = rms[0] ?? -Infinity;
      this.levels.rmsDb[1] = rms[1] ?? this.levels.rmsDb[0];
    }
    if (typeof peak === "number") {
      this.levels.peakDb[0] = peak;
      this.levels.peakDb[1] = peak;
    } else {
      this.levels.peakDb[0] = peak[0] ?? -Infinity;
      this.levels.peakDb[1] = peak[1] ?? this.levels.peakDb[0];
    }
    return this.levels;
  }

  // ── clipping latch ──────────────────────────────────────────────────────

  getClipped(): boolean {
    return this.clipped;
  }
  resetClip() {
    this.clipped = false;
  }

  private startClipWatcher() {
    if (typeof window === "undefined") return;
    const tick = () => {
      // Skip when tab is hidden — the user cannot observe a clip indicator
      // in a hidden tab, so there is no value in burning CPU for it.
      if (document.hidden) return;
      const peak = this.peakMeter.getValue();
      const p = typeof peak === "number" ? peak : Math.max(peak[0] ?? -Infinity, peak[1] ?? -Infinity);
      if (p > -0.1) this.clipped = true;
    };
    this.untrackClipCheckInterval = trackInterval("master-clip-watcher");
    this.clipCheckId = window.setInterval(tick, 80);
  }

  // ── master settings ─────────────────────────────────────────────────────

  setVolume(volume0to1: number) {
    const db = volume0to1 <= 0.005 ? -Infinity : 20 * Math.log10(volume0to1);
    if (this.panicHeldVolume !== null) {
      this.panicHeldVolume = db;
      return;
    }
    // Phase 6: short ramp for anti-click (3 ms).
    this.input.volume.rampTo(db, 0.003);
  }

  applySettings(s: Partial<MasterBusSettings>) {
    const next = { ...this.settings, ...s };
    this.settings = next;

    // Limiter threshold + makeup — use ramps for anti-click.
    this.limiter.threshold.rampTo(clamp(next.limiterThresholdDb, -24, 0), 0.01);
    const makeupLin = Math.pow(10, clamp(next.limiterGainDb, -12, 12) / 20);
    this.makeup.gain.rampTo(makeupLin, 0.05);

    // Glue comp — ramp parameters to avoid step-change clicks.
    if (next.glueEnabled) {
      this.glueComp.threshold.rampTo(clamp(next.glueThresholdDb, -36, 0), 0.01);
      this.glueComp.ratio.rampTo(clamp(next.glueRatio, 1, 10), 0.01);
      this.glueComp.attack.rampTo(clamp(next.glueAttack, 0.001, 0.1), 0.01);
      this.glueComp.release.rampTo(clamp(next.glueRelease, 0.05, 1), 0.01);
    } else {
      this.glueComp.threshold.rampTo(0, 0.01);
      this.glueComp.ratio.rampTo(1, 0.01);
    }

    // Soft clip — swap WaveShaper curve (only meaningful in Tone.js fallback mode;
    // when workletsActive the WaveShaper is an identity pass-through and the
    // worklet soft-clipper is toggled via its `enabled` AudioParam).
    if (!this.workletsActive) {
      this.softClipper.curve = next.softClip
        ? makeSoftClipCurve()
        : makeIdentityCurve();
    } else {
      // Toggle worklet soft clipper enabled param.
      this._applyWorkletParams();
    }

    // Stereo width.
    const w = clamp(next.width, 0, 2);
    this.widener.width.rampTo(Math.min(1, w * 0.5), 0.05);

    // Phase 6: oversample sync.
    if ("oversample" in next) {
      this.setOversampling(!!next.oversample);
    } else if (this.workletsActive) {
      this._applyWorkletParams();
    }
  }

  getSettings(): MasterBusSettings {
    return { ...this.settings };
  }

  // ── panic ────────────────────────────────────────────────────────────────

  private panicHeldVolume: number | null = null;

  duckForPanic() {
    const ctx = Tone.getContext();
    const now = ctx.currentTime;
    const v = this.input.volume;
    if (this.panicHeldVolume === null) {
      this.panicHeldVolume = v.value;
    }
    v.cancelScheduledValues(now);
    v.setValueAtTime(v.value, now);
    v.linearRampToValueAtTime(-60, now + 0.02);
  }

  releasePanicHold() {
    if (this.panicHeldVolume === null) return;
    const ctx = Tone.getContext();
    const now = ctx.currentTime;
    const v = this.input.volume;
    const target = this.panicHeldVolume;
    this.panicHeldVolume = null;
    v.cancelScheduledValues(now);
    v.setValueAtTime(v.value, now);
    v.linearRampToValueAtTime(target, now + 0.05);
  }

  dispose() {
    if (this.clipCheckId !== null && typeof window !== "undefined") {
      window.clearInterval(this.clipCheckId);
      this.untrackClipCheckInterval?.();
      this.untrackClipCheckInterval = null;
    }
    if (this.workletParamTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.workletParamTimer);
      this.workletParamTimer = null;
    }
    this.cleanupFailedWorklets();
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Get the underlying native AudioNode output from a Tone.js node. */
function getOutputNode(node: Tone.ToneAudioNode): AudioNode {
  const any = node as unknown as { output?: AudioNode; context?: { rawContext?: AudioContext } };
  if (any.output instanceof AudioNode) return any.output;
  // Fallback: return the node's native input/output directly.
  return node as unknown as AudioNode;
}

/** Get the underlying native AudioNode input from a Tone.js node. */
function getInputNode(node: Tone.ToneAudioNode): AudioNode {
  const any = node as unknown as { input?: AudioNode };
  if (any.input instanceof AudioNode) return any.input;
  return node as unknown as AudioNode;
}

function makeBusFx(id: SendBusId): Tone.Freeverb | Tone.JCReverb | Tone.FeedbackDelay {
  switch (id) {
    case "roomReverb":
      return new Tone.Freeverb({ roomSize: 0.6, dampening: 2500, wet: 1 });
    case "neonHall":
      return new Tone.JCReverb({ roomSize: 0.85, wet: 1 });
    case "tapeDelay":
      return new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.42, wet: 1 });
    case "darkSlapback":
      return new Tone.FeedbackDelay({ delayTime: 0.11, feedback: 0.18, wet: 1 });
  }
}

function makeIdentityCurve(): Float32Array {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = (i / (n - 1)) * 2 - 1;
  return c;
}

function makeSoftClipCurve(): Float32Array {
  const n = 2048;
  const c = new Float32Array(n);
  const k = 1.6;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return c;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
