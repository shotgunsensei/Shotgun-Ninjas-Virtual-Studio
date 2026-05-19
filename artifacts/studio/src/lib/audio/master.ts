import * as Tone from "tone";

/**
 * Master safety chain.
 *
 * Every track channel feeds into `input`. The chain then runs:
 *   input (Channel) -> compressor -> limiter -> Tone.Destination
 *
 * The compressor gently tames spikes a few dB below 0 dBFS so summing
 * many loud tracks doesn't crush the limiter. The brick-wall limiter at
 * -0.3 dBFS prevents inter-sample clipping reaching the user's speakers
 * no matter how many channels are pushed hot. A `Tone.Meter` taps the
 * post-limiter signal for the master meter UI and `getLevels()` so the
 * displayed level reflects what is actually leaving the studio.
 */
export class MasterChain {
  readonly input: Tone.Channel;
  private compressor: Tone.Compressor;
  private limiter: Tone.Limiter;
  private meter: Tone.Meter; // RMS-ish (smoothed) — drives the displayed bar
  private peakMeter: Tone.Meter; // Instantaneous peak — drives clip detection
  // Reused result object so getLevels() can be polled per animation
  // frame without allocating.
  private levels: { peakDb: [number, number]; rmsDb: [number, number] } = {
    peakDb: [-Infinity, -Infinity],
    rmsDb: [-Infinity, -Infinity],
  };

  constructor() {
    this.input = new Tone.Channel({ volume: 0 });
    this.compressor = new Tone.Compressor({
      threshold: -8,
      ratio: 3,
      attack: 0.01,
      release: 0.18,
      knee: 6,
    });
    this.limiter = new Tone.Limiter(-0.3);
    this.meter = new Tone.Meter({ smoothing: 0.7 });
    this.peakMeter = new Tone.Meter({ smoothing: 0 });

    this.input.chain(this.compressor, this.limiter, Tone.getDestination());
    // Tap the post-limiter signal so both meters show true output level.
    this.limiter.connect(this.meter);
    this.limiter.connect(this.peakMeter);
  }

  /** Tone.Meter for the post-limiter master bus (used by StereoMeter). */
  getMeter(): Tone.Meter {
    return this.meter;
  }

  /**
   * Cheap-to-call peak/RMS snapshot for the master bus. Returns the same
   * mutable object every call so this is safe to poll on every animation
   * frame without GC pressure.
   */
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

  /** Set master gain in linear 0..1, with a short ramp to avoid zipper noise. */
  setVolume(volume0to1: number) {
    const db =
      volume0to1 <= 0.005 ? -Infinity : 20 * Math.log10(volume0to1);
    // If the user adjusts master volume during a panic mute hold, store
    // the new target so releasePanicHold() restores the latest setting
    // rather than the value captured at panic time.
    if (this.panicHeldVolume !== null) {
      this.panicHeldVolume = db;
      return;
    }
    this.input.volume.rampTo(db, 0.05);
  }

  private panicHeldVolume: number | null = null;

  /**
   * Hard-silence the master bus and hold it muted until `releasePanicHold()`
   * is called (the next Play does this automatically). This guarantees
   * a true panic semantic — long reverb/delay tails cannot rebound back
   * up after the dip restores, because the master stays muted until the
   * user resumes playback.
   */
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

  /**
   * Restore master gain to its pre-panic level. Called by the engine
   * when transport resumes; safe to call when no panic is active.
   */
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
}
