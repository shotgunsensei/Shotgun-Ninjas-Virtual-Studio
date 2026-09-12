import * as Tone from "tone";
import { connectToneCompatible, resolveNativeAudioContext } from "./toneConnection";
import { decodeInstrumentSample } from "./sampleInstrumentDecode";

export const MAX_SAMPLE_INSTRUMENT_VOICES = 32;
export type SampleInstrumentStatus = "loading" | "ready" | "missing" | "error";

interface PlayingSample {
  source: AudioBufferSourceNode;
  gain: GainNode;
  midi: number;
  started: number;
  attack: number;
  velocity: number;
  releasing: boolean;
}

/** One decoded recording supplies every key. Short-lived native sources keep
 * chord/retrigger work off Tone's permanent-node graph and bound polyphony. */
export class SampleInstrumentVoice {
  private readonly context = resolveNativeAudioContext();
  private readonly output = this.context.createGain();
  private buffer: AudioBuffer | null = null;
  private readonly active = new Set<PlayingSample>();
  private disposed = false;
  private rootNote: number;
  private status: SampleInstrumentStatus;
  private error?: string;
  attack = 0.002;
  release = 0.6;
  readonly ready: Promise<void>;

  constructor(rootNote: number, blob?: Blob) {
    this.rootNote = rootNote;
    this.output.gain.value = Math.pow(10, -8 / 20);
    this.status = blob ? "loading" : "missing";
    this.notify();
    this.ready = blob ? this.decode(blob) : Promise.resolve();
  }

  private async decode(blob: Blob): Promise<void> {
    try {
      const buffer = await decodeInstrumentSample(blob, this.context, () => !this.disposed);
      // Disposal/project replacement wins even when browser decoding cannot
      // be canceled; stale completions never publish audio or create sources.
      if (this.disposed || !buffer) return;
      this.buffer = buffer;
      this.status = "ready";
    } catch (error) {
      if (this.disposed) return;
      this.status = "error";
      this.error = error instanceof Error ? error.message : "The audio sample could not be decoded.";
    }
    this.notify();
  }

  setRootNote(rootNote: number): void {
    if (rootNote === this.rootNote) return;
    this.releaseAll();
    this.rootNote = rootNote;
    this.notify();
  }

  connect(destination: Tone.InputNode) {
    connectToneCompatible(this.output, destination);
    return this;
  }

  disconnect() {
    this.output.disconnect();
    return this;
  }

  triggerAttack(note: Tone.Unit.Frequency, time?: Tone.Unit.Time, velocity = 0.9) {
    this.play(note, time, velocity);
    return this;
  }

  triggerAttackRelease(
    note: Tone.Unit.Frequency,
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity = 0.9,
  ) {
    const playing = this.play(note, time, velocity);
    if (playing) this.releaseSource(playing, playing.started + Math.max(0, Tone.Time(duration).toSeconds()));
    return this;
  }

  triggerRelease(note: Tone.Unit.Frequency, time?: Tone.Unit.Time) {
    const midi = Tone.Frequency(note).toMidi();
    const at = this.toTime(time);
    for (const playing of this.active) {
      if (playing.midi === midi && !playing.releasing) this.releaseSource(playing, at);
    }
    return this;
  }

  /** Stop also cancels sources already scheduled in the look-ahead window. */
  releaseAll() {
    for (const playing of Array.from(this.active)) this.disposeSource(playing);
    return this;
  }

  snapshot() {
    return {
      status: this.status,
      error: this.error,
      rootNote: this.rootNote,
      activeSources: this.active.size,
      playbackRates: Array.from(this.active, ({ source }) => source.playbackRate.value),
    };
  }

  dispose() {
    if (this.disposed) return this;
    this.disposed = true;
    this.releaseAll();
    this.buffer = null;
    this.output.disconnect();
    return this;
  }

  private toTime(time?: Tone.Unit.Time): number {
    return time === undefined ? this.context.currentTime : Math.max(this.context.currentTime, Tone.Time(time).toSeconds());
  }

  private play(note: Tone.Unit.Frequency, time: Tone.Unit.Time | undefined, velocity: number): PlayingSample | null {
    if (this.disposed || !this.buffer || !Number.isFinite(velocity) || velocity <= 0) return null;
    const midi = Tone.Frequency(note).toMidi();
    if (!Number.isFinite(midi) || midi < 0 || midi > 127) return null;
    while (this.active.size >= MAX_SAMPLE_INSTRUMENT_VOICES) {
      const oldest = this.active.values().next().value;
      if (oldest) this.disposeSource(oldest);
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const playing: PlayingSample = {
      source, gain, midi, started: this.toTime(time),
      attack: this.attack, velocity: Math.min(1, velocity), releasing: false,
    };
    try {
      source.buffer = this.buffer;
      source.playbackRate.value = Math.pow(2, (midi - this.rootNote) / 12);
      source.connect(gain);
      gain.connect(this.output);
      gain.gain.setValueAtTime(0, playing.started);
      gain.gain.linearRampToValueAtTime(playing.velocity, playing.started + playing.attack);
      source.onended = () => this.disposeSource(playing);
      this.active.add(playing);
      source.start(playing.started);
      return playing;
    } catch (error) {
      this.disposeSource(playing);
      throw error;
    }
  }

  private releaseSource(playing: PlayingSample, requestedTime: number): void {
    const at = Math.max(playing.started, requestedTime);
    const held = playing.velocity * Math.min(1, Math.max(0, (at - playing.started) / playing.attack));
    playing.gain.gain.cancelScheduledValues(at);
    if (at < playing.started + playing.attack) {
      // A short gate cancels the future attack endpoint. Restore the partial
      // ramp so release starts at its held level without an amplitude jump.
      playing.gain.gain.linearRampToValueAtTime(held, at);
    } else {
      playing.gain.gain.setValueAtTime(held, at);
    }
    playing.gain.gain.linearRampToValueAtTime(0, at + this.release);
    playing.source.stop(at + this.release);
    playing.releasing = true;
  }

  private disposeSource(playing: PlayingSample): void {
    playing.source.onended = null;
    try { playing.source.stop(); } catch { /* already ended */ }
    playing.source.disconnect();
    playing.gain.disconnect();
    this.active.delete(playing);
  }

  private notify(): void {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("studio:sample-instruments-changed"));
    }
  }
}
