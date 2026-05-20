import * as Tone from "tone";
import type { MasterBusSettings, SendBusId } from "../../types";
import { SEND_BUS_IDS } from "../../types";

/**
 * Master safety chain (v2).
 *
 * Every track channel feeds into `input`. The chain then runs:
 *   input -> glueComp -> softClip -> width -> safetyComp -> limiter -> Destination
 *
 * In addition, the master owns 4 named global send buses
 * (Room Reverb, Neon Hall, Tape Delay, Dark Slapback). Each track can
 * tap its post-fader signal into any combination of these buses via
 * dedicated send gains; the bus output is summed into the master input
 * before the glue/safety chain.
 *
 * `getClipped()` returns a latched flag set whenever the post-limiter
 * peak ever crosses -0.1 dBFS. The UI calls `resetClip()` to clear it.
 */

export interface SendBusNode {
  id: SendBusId;
  /** Public input node for tracks to connect their send gains to. */
  input: Tone.Gain;
  /** The effect node that processes the bus (Freeverb, JCReverb, or FeedbackDelay). */
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

  private levels: { peakDb: [number, number]; rmsDb: [number, number] } = {
    peakDb: [-Infinity, -Infinity],
    rmsDb: [-Infinity, -Infinity],
  };

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
      // Sum bus output back into master input (pre-glue, post-track).
      fx.connect(this.input);
      this.buses.set(id, { id, input, fx });
    }

    // Apply soft-clip / width / limiter once the curve is staged.
    this.applySettings(this.settings);
    this.startClipWatcher();
  }

  // ---- send buses ----

  getBus(id: SendBusId): SendBusNode | undefined {
    return this.buses.get(id);
  }

  getBuses(): SendBusNode[] {
    return SEND_BUS_IDS.map((id) => this.buses.get(id)!).filter(Boolean);
  }

  // ---- meter ----

  getMeter(): Tone.Meter {
    return this.meter;
  }

  getLevels(): { peakDb: [number, number]; rmsDb: [number, number] } {
    const rms = this.meter.getValue();
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

  // ---- clipping latch ----

  getClipped(): boolean {
    return this.clipped;
  }
  resetClip() {
    this.clipped = false;
  }

  private startClipWatcher() {
    if (typeof window === "undefined") return;
    const tick = () => {
      const peak = this.peakMeter.getValue();
      const p = typeof peak === "number" ? peak : Math.max(peak[0] ?? -Infinity, peak[1] ?? -Infinity);
      if (p > -0.1) this.clipped = true;
    };
    this.clipCheckId = window.setInterval(tick, 80);
  }

  // ---- master settings ----

  setVolume(volume0to1: number) {
    const db =
      volume0to1 <= 0.005 ? -Infinity : 20 * Math.log10(volume0to1);
    if (this.panicHeldVolume !== null) {
      this.panicHeldVolume = db;
      return;
    }
    this.input.volume.rampTo(db, 0.05);
  }

  applySettings(s: Partial<MasterBusSettings>) {
    const next = { ...this.settings, ...s };
    this.settings = next;
    // Limiter threshold + makeup.
    this.limiter.threshold.value = clamp(next.limiterThresholdDb, -24, 0);
    const makeupLin = Math.pow(10, clamp(next.limiterGainDb, -12, 12) / 20);
    this.makeup.gain.rampTo(makeupLin, 0.05);
    // Glue comp.
    if (next.glueEnabled) {
      this.glueComp.threshold.value = clamp(next.glueThresholdDb, -36, 0);
      this.glueComp.ratio.value = clamp(next.glueRatio, 1, 10);
      this.glueComp.attack.value = clamp(next.glueAttack, 0.001, 0.1);
      this.glueComp.release.value = clamp(next.glueRelease, 0.05, 1);
    } else {
      // Effective bypass: very high threshold so comp never engages.
      this.glueComp.threshold.value = 0;
      this.glueComp.ratio.value = 1;
    }
    // Soft clip — swap curve.
    this.softClipper.curve = next.softClip
      ? makeSoftClipCurve()
      : makeIdentityCurve();
    // Stereo width — Tone.StereoWidener takes 0..1 (0=mono, 0.5=stereo, 1=wide).
    // Map our 0..2 user range to that.
    const w = clamp(next.width, 0, 2);
    this.widener.width.rampTo(Math.min(1, w * 0.5), 0.05);
  }

  getSettings(): MasterBusSettings {
    return { ...this.settings };
  }

  // ---- panic ----

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
    }
  }
}

function makeBusFx(id: SendBusId): Tone.Freeverb | Tone.JCReverb | Tone.FeedbackDelay {
  switch (id) {
    case "roomReverb":
      // Freeverb: algorithmic, instantaneous — avoids the OfflineAudioContext
      // IR-generation cost of Tone.Reverb (~6-8 s per instance).
      return new Tone.Freeverb({ roomSize: 0.6, dampening: 2500, wet: 1 });
    case "neonHall":
      // JCReverb gives a lusher, larger-room character for the "hall" bus.
      return new Tone.JCReverb({ roomSize: 0.85, wet: 1 });
    case "tapeDelay":
      return new Tone.FeedbackDelay({
        delayTime: "8n.",
        feedback: 0.42,
        wet: 1,
      });
    case "darkSlapback":
      return new Tone.FeedbackDelay({
        delayTime: 0.11,
        feedback: 0.18,
        wet: 1,
      });
  }
}

function makeIdentityCurve(): Float32Array {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = (i / (n - 1)) * 2 - 1;
  return c;
}

function makeSoftClipCurve(): Float32Array {
  // tanh-based soft clip; mild drive so transparent at low levels.
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
