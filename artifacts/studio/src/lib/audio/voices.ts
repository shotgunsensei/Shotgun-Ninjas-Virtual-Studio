import * as Tone from "tone";
import type {
  AnyPreset,
  BassPreset,
  DrumsPreset,
  GuitarPreset,
  InstrumentKind,
  PianoPreset,
  VocalsPreset,
} from "../../types";

/**
 * Voice construction module.
 *
 * Holds every preset factory (piano, guitar, bass, drum kit, vocal FX
 * defaults) plus the shared types used by the AudioEngine facade and the
 * offline renderer in `export.ts`. The engine facade is the only thing
 * the UI imports; this file is an implementation detail of the audio
 * layer that can be expanded with new presets in later v2 tasks without
 * changing the facade surface.
 */

// ---------- shared types ----------

export const DRUM_PIECES = [
  "kick",
  "snare",
  "hat",
  "ohat",
  "clap",
  "tomLow",
  "tomHigh",
  "crash",
  "fx",
] as const;
export type DrumPiece = (typeof DRUM_PIECES)[number];

export interface DrumVoice {
  trigger: (time: number, velocity: number) => void;
  connect: (dest: Tone.InputNode) => unknown;
  dispose: () => void;
}

export type DrumKit = Record<DrumPiece, DrumVoice>;

/**
 * Polyphonic wrapper around `Tone.PluckSynth` (Karplus–Strong).
 * `PluckSynth` is monophonic and not compatible with `Tone.PolySynth`'s
 * `Monophonic` constraint, so we maintain a small voice pool ourselves
 * and round-robin notes across it.
 */
export class PolyPluck {
  private voices: Tone.PluckSynth[];
  private next = 0;

  constructor(opts: Partial<Tone.PluckSynthOptions> = {}, voiceCount = 8) {
    this.voices = Array.from(
      { length: voiceCount },
      () => new Tone.PluckSynth(opts),
    );
  }

  triggerAttack(
    note: Tone.Unit.Frequency,
    time?: Tone.Unit.Time,
    _velocity = 0.9,
  ) {
    const v = this.voices[this.next];
    this.next = (this.next + 1) % this.voices.length;
    v.triggerAttack(note, time);
    return this;
  }

  triggerRelease(_note?: Tone.Unit.Frequency, _time?: Tone.Unit.Time) {
    // Karplus–Strong decays naturally — no explicit release stage.
    return this;
  }

  triggerAttackRelease(
    note: Tone.Unit.Frequency,
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity = 0.9,
  ) {
    const v = this.voices[this.next];
    this.next = (this.next + 1) % this.voices.length;
    v.triggerAttackRelease(note, duration, time, velocity);
    return this;
  }

  connect(dest: Tone.InputNode) {
    for (const v of this.voices) v.connect(dest);
    return this;
  }

  releaseAll() {
    // PluckSynth has no explicit release; this is a no-op for parity
    // with PolySynth's releaseAll() surface used by panicStopAll().
    return this;
  }

  dispose() {
    for (const v of this.voices) v.dispose();
    return this;
  }
}

/**
 * Mono 808 voice — a single MonoSynth with portamento for legato slides,
 * a pitch envelope (drops `pitchEnvSemis` over `pitchEnvDecay` seconds
 * starting from each note's frequency), and a sidechain duck that
 * temporarily reduces the post-voice gain on every hit to emulate the
 * 4-on-the-floor pump that 808 basses are usually heard with.
 *
 * Implements the `MelodicVoice` surface used by the engine
 * (connect / triggerAttackRelease / triggerAttack / triggerRelease /
 * releaseAll / dispose / set) so it slots into the same union without
 * special casing at call sites.
 */
export class Mono808Voice {
  private synth: Tone.MonoSynth;
  private duck: Tone.Gain;
  /** Pitch-env depth in semitones (positive = pitch dive from note). */
  private pitchEnvSemis: number;
  /** Sidechain depth 0..1 — how far the post-voice gain dips per hit. */
  private sidechain: number;
  /** Pitch envelope decay window. */
  private pitchEnvDecay = 0.18;
  /** Sidechain duck recovery window. */
  private duckRecoverySec = 0.25;

  constructor(opts: {
    portamento?: number;
    envelope?: Partial<Tone.EnvelopeOptions>;
    filter?: Partial<Tone.FilterOptions>;
    filterEnvelope?: Partial<Tone.FrequencyEnvelopeOptions>;
    pitchEnvSemis?: number;
    sidechain?: number;
    volume?: number;
  } = {}) {
    this.synth = new Tone.MonoSynth({
      oscillator: { type: "sine" },
      portamento: opts.portamento ?? 0.05, // tiny default for legato slides
      envelope: { attack: 0.005, decay: 0.6, sustain: 0.7, release: 0.8, ...(opts.envelope ?? {}) },
      filter: { Q: 1.5, frequency: 200, type: "lowpass", rolloff: -24, ...(opts.filter ?? {}) },
      filterEnvelope: {
        attack: 0.005,
        decay: 0.3,
        sustain: 0.5,
        release: 0.6,
        baseFrequency: 100,
        octaves: 2.5,
        ...(opts.filterEnvelope ?? {}),
      },
      volume: opts.volume ?? -6,
    });
    this.duck = new Tone.Gain(1);
    this.synth.connect(this.duck);
    this.pitchEnvSemis = opts.pitchEnvSemis ?? 0;
    this.sidechain = Math.max(0, Math.min(1, opts.sidechain ?? 0));
  }

  connect(dest: Tone.InputNode) {
    this.duck.connect(dest);
    return this;
  }

  /** Apply per-track sound-param updates. Only the fields relevant to
   *  the 808's character are honored; everything else is ignored. */
  set(opts: {
    portamento?: number;
    pitchEnvSemis?: number;
    sidechain?: number;
    envelope?: Partial<Tone.EnvelopeOptions>;
  }) {
    if (opts.portamento !== undefined) {
      this.synth.portamento = opts.portamento;
    }
    if (opts.pitchEnvSemis !== undefined) {
      this.pitchEnvSemis = opts.pitchEnvSemis;
    }
    if (opts.sidechain !== undefined) {
      this.sidechain = Math.max(0, Math.min(1, opts.sidechain));
    }
    if (opts.envelope) {
      try {
        (this.synth as unknown as { set: (o: object) => void }).set({
          envelope: opts.envelope,
        });
      } catch {
        // ignore
      }
    }
  }

  triggerAttack(
    note: Tone.Unit.Frequency,
    time?: Tone.Unit.Time,
    velocity = 0.9,
  ) {
    this.fireDuck(time);
    this.firePitchEnv(note, time);
    this.synth.triggerAttack(note, time, velocity);
    return this;
  }

  triggerRelease(_note?: Tone.Unit.Frequency, time?: Tone.Unit.Time) {
    this.synth.triggerRelease(time);
    return this;
  }

  triggerAttackRelease(
    note: Tone.Unit.Frequency,
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity = 0.9,
  ) {
    this.fireDuck(time);
    this.firePitchEnv(note, time);
    this.synth.triggerAttackRelease(note, duration, time, velocity);
    return this;
  }

  releaseAll() {
    try {
      this.synth.triggerRelease();
    } catch {
      // ignore
    }
    return this;
  }

  dispose() {
    this.synth.dispose();
    this.duck.dispose();
    return this;
  }

  private fireDuck(time?: Tone.Unit.Time) {
    if (this.sidechain <= 0) return;
    const t = time !== undefined ? (time as number) : Tone.now();
    const floor = Math.max(0.05, 1 - this.sidechain);
    try {
      this.duck.gain.cancelScheduledValues(t);
      this.duck.gain.setValueAtTime(floor, t);
      this.duck.gain.linearRampToValueAtTime(1, t + this.duckRecoverySec);
    } catch {
      // ignore
    }
  }

  private firePitchEnv(note: Tone.Unit.Frequency, time?: Tone.Unit.Time) {
    if (this.pitchEnvSemis <= 0) return;
    const t = time !== undefined ? (time as number) : Tone.now();
    try {
      const baseHz = Tone.Frequency(note).toFrequency();
      const startHz = baseHz * Math.pow(2, this.pitchEnvSemis / 12);
      const freq = this.synth.frequency;
      freq.cancelScheduledValues(t);
      freq.setValueAtTime(startHz, t);
      freq.exponentialRampToValueAtTime(
        Math.max(0.1, baseHz),
        t + this.pitchEnvDecay,
      );
    } catch {
      // ignore
    }
  }
}

/**
 * Clean guitar voice — triangle FMSynth fed through a gentle 3rd-order
 * Chebyshev waveshaper (adds 3rd harmonic for warm amp breakup) and a
 * presence-boosting bandpass EQ. Gives the "clean" guitar preset a
 * richer, more amp-like character compared to a bare FMSynth.
 */
export class PolyAmpGuitar {
  private poly: Tone.PolySynth;
  private shaper: Tone.Chebyshev;
  private body: Tone.Filter;

  constructor() {
    this.poly = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 1.2,
      modulationIndex: 2.8,
      oscillator: { type: "triangle" },
      envelope: { attack: 0.003, decay: 0.95, sustain: 0.1, release: 1.1 },
      modulation: { type: "triangle" },
      modulationEnvelope: { attack: 0.003, decay: 0.55, sustain: 0.0, release: 0.6 },
      volume: -13,
    });
    this.shaper = new Tone.Chebyshev(3);
    this.shaper.wet.value = 0.18;
    this.body = new Tone.Filter({ type: "lowpass", frequency: 5500, Q: 0.6 });
    this.poly.chain(this.shaper, this.body);
  }

  connect(dest: Tone.InputNode) { this.body.connect(dest); return this; }
  triggerAttack(note: Tone.Unit.Frequency, time?: Tone.Unit.Time, velocity = 0.9) {
    this.poly.triggerAttack(note, time, velocity); return this;
  }
  triggerRelease(note: Tone.Unit.Frequency, time?: Tone.Unit.Time) {
    this.poly.triggerRelease(note, time); return this;
  }
  triggerAttackRelease(
    note: Tone.Unit.Frequency,
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity = 0.9,
  ) {
    this.poly.triggerAttackRelease(note, duration, time, velocity); return this;
  }
  releaseAll() { this.poly.releaseAll(); return this; }
  dispose() { this.poly.dispose(); this.shaper.dispose(); this.body.dispose(); return this; }
}

/**
 * Finger bass voice with a sub-oscillator layer. Pairs a warm triangle
 * MonoSynth (mid body, pluck attack) with a sine sub an octave below
 * (deep low end). Both feed a shared Gain mix node so the blend is clean
 * and only one cable leaves the voice.
 */
export class SubFingerBass {
  private high: Tone.PolySynth;
  private sub: Tone.PolySynth;
  private mix: Tone.Gain;

  constructor() {
    this.high = new Tone.PolySynth(Tone.MonoSynth, {
      oscillator: { type: "triangle" },
      filter: { Q: 2.0, frequency: 1400, type: "lowpass", rolloff: -24 },
      envelope: { attack: 0.008, decay: 0.45, sustain: 0.55, release: 0.5 },
      filterEnvelope: {
        attack: 0.005,
        decay: 0.3,
        sustain: 0.5,
        release: 0.4,
        baseFrequency: 180,
        octaves: 2.5,
      },
      volume: -10,
    });
    this.sub = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.55, sustain: 0.6, release: 0.8 },
      volume: -16,
    });
    this.mix = new Tone.Gain(1);
    this.high.connect(this.mix);
    this.sub.connect(this.mix);
  }

  private subHz(note: Tone.Unit.Frequency): number {
    return Tone.Frequency(note).toFrequency() / 2;
  }

  connect(dest: Tone.InputNode) { this.mix.connect(dest); return this; }

  triggerAttack(note: Tone.Unit.Frequency, time?: Tone.Unit.Time, velocity = 0.9) {
    this.high.triggerAttack(note, time, velocity);
    this.sub.triggerAttack(this.subHz(note), time, velocity * 0.6);
    return this;
  }

  triggerRelease(note: Tone.Unit.Frequency, time?: Tone.Unit.Time) {
    this.high.triggerRelease(note, time);
    this.sub.releaseAll(time as Tone.Unit.Time | undefined);
    return this;
  }

  triggerAttackRelease(
    note: Tone.Unit.Frequency,
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity = 0.9,
  ) {
    this.high.triggerAttackRelease(note, duration, time, velocity);
    this.sub.triggerAttackRelease(this.subHz(note), duration, time, velocity * 0.6);
    return this;
  }

  releaseAll() {
    this.high.releaseAll();
    this.sub.releaseAll();
    return this;
  }

  dispose() {
    this.high.dispose();
    this.sub.dispose();
    this.mix.dispose();
    return this;
  }
}

export type MelodicVoice =
  | Tone.PolySynth
  | Tone.Sampler
  | PolyPluck
  | Mono808Voice
  | PolyAmpGuitar
  | SubFingerBass;

// ---------- helpers ----------

export function triggerDrumPiece(
  drums: DrumKit,
  piece: DrumPiece,
  velocity: number,
  time: number,
) {
  const inst = drums[piece];
  if (!inst) return;
  try {
    inst.trigger(time, velocity);
  } catch {
    // ignore
  }
}

/**
 * Best-effort release-all for any melodic voice type. Used by the
 * engine's panic / stop paths to silence sustained notes immediately.
 */
export function releaseAllNotes(voice: MelodicVoice | undefined) {
  if (!voice) return;
  try {
    const anyVoice = voice as unknown as { releaseAll?: () => void };
    if (typeof anyVoice.releaseAll === "function") anyVoice.releaseAll();
  } catch {
    // ignore — best effort
  }
}

/**
 * Tone.Sampler loads buffers asynchronously. When a freshly-built sampler is
 * still loading, fire window events so the UI can flash a "loading samples"
 * status without coupling the engine to the store.
 */
export function announceSamplerLoadIfNeeded(node: MelodicVoice) {
  if (!(node instanceof Tone.Sampler)) return;
  if (node.loaded) return;
  if (typeof window === "undefined") return;

  const sampler = node;
  window.dispatchEvent(new CustomEvent("studio:samples-loading"));

  const start = performance.now();
  const MIN_VISIBLE_MS = 900;

  const finish = () => {
    const elapsed = performance.now() - start;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("studio:samples-loaded"));
    }, wait);
  };

  let done = false;
  const tick = () => {
    if (done) return;
    if (sampler.loaded || sampler.disposed) {
      done = true;
      finish();
      return;
    }
    window.setTimeout(tick, 100);
  };
  window.setTimeout(tick, 50);

  Tone.loaded()
    .then(() => {
      if (done) return;
      done = true;
      finish();
    })
    .catch(() => {
      if (done) return;
      done = true;
      finish();
    });

  window.setTimeout(() => {
    if (done) return;
    done = true;
    finish();
  }, 30_000);
}

// ---------- melodic preset factories ----------

/**
 * Salamander grand piano samples hosted by the Tone.js project (MIT).
 * A sparse map (every minor third) is sufficient for natural pitch
 * interpolation while keeping initial download under ~2 MB.
 */
const SALAMANDER_BASE = "https://tonejs.github.io/audio/salamander/";
const SALAMANDER_URLS: Record<string, string> = {
  A1: "A1.mp3",
  C2: "C2.mp3",
  "D#2": "Ds2.mp3",
  "F#2": "Fs2.mp3",
  A2: "A2.mp3",
  C3: "C3.mp3",
  "D#3": "Ds3.mp3",
  "F#3": "Fs3.mp3",
  A3: "A3.mp3",
  C4: "C4.mp3",
  "D#4": "Ds4.mp3",
  "F#4": "Fs4.mp3",
  A4: "A4.mp3",
  C5: "C5.mp3",
  "D#5": "Ds5.mp3",
  "F#5": "Fs5.mp3",
  A5: "A5.mp3",
  C6: "C6.mp3",
};

export function buildPiano(preset: PianoPreset): MelodicVoice {
  switch (preset) {
    case "grand":
      return new Tone.Sampler({
        urls: SALAMANDER_URLS,
        baseUrl: SALAMANDER_BASE,
        release: 1.4,
        attack: 0,
        volume: -8,
      });
    case "electric": {
      // Rhodes-character electric piano: lower harmonicity ratio puts the
      // modulator near the 3rd partial (bell tine), fast modulation decay
      // for the characteristic "tine click", and a triangle modulator for
      // smoother bell warmth vs a raw sine.
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.5,
        modulationIndex: 6.5,
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 1.6, sustain: 0.0, release: 2.0 },
        modulation: { type: "triangle" },
        modulationEnvelope: {
          attack: 0.001,
          decay: 0.38,
          sustain: 0.0,
          release: 0.5,
        },
        volume: -10,
      });
    }
    case "synth":
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 1.2, frequency: 1800, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.015, decay: 0.4, sustain: 0.65, release: 1.1 },
        filterEnvelope: {
          attack: 0.02,
          decay: 0.6,
          sustain: 0.4,
          release: 1.2,
          baseFrequency: 250,
          octaves: 3.5,
        },
        volume: -16,
      });
  }
}

export function buildGuitar(preset: GuitarPreset): MelodicVoice {
  switch (preset) {
    case "clean":
      // Triangle FMSynth + Chebyshev waveshaper for warm amp character.
      return new PolyAmpGuitar();
    case "crunch":
      // Sawtooth through a resonant low-pass with punchy attack; the
      // slightly higher Q (3.5) and faster filter decay adds the amp grit.
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 3.5, frequency: 1800, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.002, decay: 0.4, sustain: 0.5, release: 0.45 },
        filterEnvelope: {
          attack: 0.002,
          decay: 0.18,
          sustain: 0.3,
          release: 0.35,
          baseFrequency: 400,
          octaves: 3.5,
        },
        volume: -14,
      });
    case "acoustic":
      return new PolyPluck(
        {
          attackNoise: 0.6,
          dampening: 4500,
          resonance: 0.94,
          release: 0.7,
          volume: -8,
        },
        8,
      );
  }
}

export function buildBass(preset: BassPreset): MelodicVoice {
  switch (preset) {
    case "finger":
      // Triangle body + sine sub an octave below — adds low-end depth
      // that's audible on both large speakers and laptop speakers.
      return new SubFingerBass();
    case "synth":
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 4, frequency: 600, type: "lowpass" },
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.5 },
        filterEnvelope: {
          attack: 0.005,
          decay: 0.4,
          sustain: 0.2,
          release: 0.4,
          baseFrequency: 200,
          octaves: 3,
        },
        volume: -10,
      });
    case "sub":
      // AMSynth with a low harmonicity (0.5) adds a very mild 2nd harmonic
      // that gives the sub presence on laptop/phone speakers while keeping
      // the fundamental dominant. The modulation depth is low (fast decay)
      // so it adds body without introducing obvious ring.
      return new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 0.5,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.012, decay: 0.5, sustain: 0.75, release: 1.4 },
        modulationEnvelope: {
          attack: 0.01,
          decay: 0.18,
          sustain: 0.08,
          release: 0.5,
        },
        volume: -5,
      });
  }
}

export function buildMelodicVoice(
  kind: InstrumentKind,
  preset: AnyPreset,
): MelodicVoice | null {
  switch (kind) {
    case "piano":
      return buildPiano(preset as PianoPreset);
    case "guitar":
      return buildGuitar(preset as GuitarPreset);
    case "bass":
      return buildBass(preset as BassPreset);
    default:
      return null;
  }
}

// ---------- drum kit ----------

function makeKick(preset: DrumsPreset): DrumVoice {
  const isAcoustic = preset === "acoustic";
  const isElectronic = preset === "electronic";
  const isTrap = preset === "trap";

  const body = new Tone.MembraneSynth({
    pitchDecay: isTrap ? 0.09 : isElectronic ? 0.05 : 0.045,
    octaves: isTrap ? 9 : isElectronic ? 7 : 5.5,
    envelope: {
      attack: 0.001,
      decay: isTrap ? 0.85 : isElectronic ? 0.48 : 0.5,
      sustain: 0,
      release: isTrap ? 0.7 : 0.4,
    },
    volume: isTrap ? -1 : -2,
  });

  // Louder click layer = sharper transient "knock" at note onset.
  const click = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.014, release: 0.008 },
    harmonicity: 5.1,
    modulationIndex: 16,
    resonance: isAcoustic ? 4200 : 5000,
    octaves: 0.5,
    volume: isAcoustic ? -20 : -23,
  });

  // Mild waveshaper saturation on electronic/trap body adds harmonic density
  // so the kick "punches" rather than "pings".
  const sat = !isAcoustic ? new Tone.Distortion({ distortion: 0.1, wet: 0.3 }) : null;
  if (sat) body.chain(sat);

  return {
    trigger: (time, velocity) => {
      body.triggerAttackRelease("C2", "8n", time, velocity);
      click.triggerAttackRelease("32n", time, velocity * 0.85);
    },
    connect: (dest) => {
      if (sat) sat.connect(dest);
      else body.connect(dest);
      click.connect(dest);
    },
    dispose: () => {
      body.dispose();
      click.dispose();
      sat?.dispose();
    },
  };
}

function makeSnare(preset: DrumsPreset): DrumVoice {
  const isAcoustic = preset === "acoustic";
  const isTrap = preset === "trap";

  // Louder/snappier body hit gives more "crack" on the transient.
  const body = new Tone.MembraneSynth({
    pitchDecay: 0.018,
    octaves: 2.5,
    envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.08 },
    volume: isAcoustic ? -11 : -12,
  });
  const noise = new Tone.NoiseSynth({
    noise: { type: isAcoustic ? "white" : "pink" },
    envelope: {
      attack: 0.001,
      decay: isAcoustic ? 0.2 : isTrap ? 0.09 : 0.14,
      sustain: 0,
      release: 0.08,
    },
    volume: isAcoustic ? -10 : -12,
  });
  const filter = new Tone.Filter({
    type: "highpass",
    frequency: isAcoustic ? 1000 : 1500,
    Q: 0.8,
  });
  noise.connect(filter);

  return {
    trigger: (time, velocity) => {
      body.triggerAttackRelease("D3", "32n", time, velocity * 0.8);
      noise.triggerAttackRelease("16n", time, velocity);
    },
    connect: (dest) => {
      body.connect(dest);
      filter.connect(dest);
    },
    dispose: () => {
      body.dispose();
      noise.dispose();
      filter.dispose();
    },
  };
}

function makeClap(): DrumVoice {
  const noise = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    volume: -12,
  });
  const filter = new Tone.Filter({
    type: "bandpass",
    frequency: 1500,
    Q: 1.5,
  });
  noise.connect(filter);
  return {
    trigger: (time, velocity) => {
      noise.triggerAttackRelease("32n", time, velocity);
      noise.triggerAttackRelease("32n", time + 0.012, velocity * 0.85);
      noise.triggerAttackRelease("16n", time + 0.024, velocity * 0.95);
    },
    connect: (dest) => {
      filter.connect(dest);
    },
    dispose: () => {
      noise.dispose();
      filter.dispose();
    },
  };
}

function makeHat(preset: DrumsPreset, open: boolean): DrumVoice {
  const isAcoustic = preset === "acoustic";
  const synth = new Tone.MetalSynth({
    envelope: {
      attack: 0.001,
      decay: open ? 0.35 : 0.06,
      release: open ? 0.25 : 0.02,
    },
    harmonicity: isAcoustic ? 5.1 : 8.5,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
    volume: open ? -24 : -22,
  });
  const filter = new Tone.Filter({
    type: "highpass",
    frequency: isAcoustic ? 6000 : 7000,
    Q: 0.6,
  });
  synth.connect(filter);
  return {
    trigger: (time, velocity) => {
      synth.triggerAttackRelease(open ? "8n" : "32n", time, velocity);
    },
    connect: (dest) => {
      filter.connect(dest);
    },
    dispose: () => {
      synth.dispose();
      filter.dispose();
    },
  };
}

function makeTom(pitch: string): DrumVoice {
  const synth = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 },
    volume: -8,
  });
  return {
    trigger: (time, velocity) => {
      synth.triggerAttackRelease(pitch, "8n", time, velocity);
    },
    connect: (dest) => {
      synth.connect(dest);
    },
    dispose: () => {
      synth.dispose();
    },
  };
}

function makeCrash(): DrumVoice {
  const synth = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 1.4, release: 1.2 },
    harmonicity: 3.1,
    modulationIndex: 16,
    resonance: 6000,
    octaves: 1.5,
    volume: -28,
  });
  return {
    trigger: (time, velocity) => {
      synth.triggerAttackRelease("4n", time, velocity);
    },
    connect: (dest) => {
      synth.connect(dest);
    },
    dispose: () => {
      synth.dispose();
    },
  };
}

// ---------- acoustic sampled kit ----------

/**
 * Berklee percussion samples bundled with the Tone.js demo CDN (MIT).
 * All ~10 files together are < 1 MB so they load quickly on any connection.
 */
const BERKLEE = "https://tonejs.github.io/audio/berklee/";
const AK = {
  kick:  BERKLEE + "kick_drum_0.mp3",
  snare: BERKLEE + "snare_0.mp3",
  clap:  BERKLEE + "clap_1.mp3",
  hat:   BERKLEE + "hihat_0.mp3",
  ohat:  BERKLEE + "hihat_2.mp3",
  tomLo: BERKLEE + "tom_0.mp3",
  tomHi: BERKLEE + "high_tom_0.mp3",
  crash: BERKLEE + "crash_0.mp3",
  fx:    BERKLEE + "shaker_0.mp3",
} as const;

/**
 * Wraps a CDN-loaded Tone.Player as a DrumVoice.  The synth `fallback` is
 * triggered while the buffer is still loading so the kit never goes silent.
 * Once loaded the sampled audio is used for every subsequent trigger.
 */
function makeSampledDrum(url: string, fallback: DrumVoice, volumeDb = 0): DrumVoice {
  const player = new Tone.Player({ url, loop: false, volume: volumeDb });

  return {
    trigger: (time, velocity) => {
      if (player.loaded) {
        // Scale ±20 dB around nominal so velocity feels linear in amplitude.
        player.volume.setValueAtTime(
          volumeDb + 20 * Math.log10(Math.max(velocity, 0.01)),
          time,
        );
        player.start(time);
      } else {
        fallback.trigger(time, velocity);
      }
    },
    connect: (dest) => {
      player.connect(dest);
      fallback.connect(dest);
    },
    dispose: () => {
      player.dispose();
      fallback.dispose();
    },
  };
}

/** Build the acoustic kit from Berklee CDN samples with synth fallbacks. */
function buildAcousticSampledKit(): DrumKit {
  return {
    kick:    makeSampledDrum(AK.kick,  makeKick("acoustic"),      -2),
    snare:   makeSampledDrum(AK.snare, makeSnare("acoustic"),     -4),
    clap:    makeSampledDrum(AK.clap,  makeClap(),                -6),
    hat:     makeSampledDrum(AK.hat,   makeHat("acoustic", false),-8),
    ohat:    makeSampledDrum(AK.ohat,  makeHat("acoustic", true), -6),
    tomLow:  makeSampledDrum(AK.tomLo, makeTom("A2"),             -4),
    tomHigh: makeSampledDrum(AK.tomHi, makeTom("D3"),             -4),
    crash:   makeSampledDrum(AK.crash, makeCrash(),               -6),
    fx:      makeSampledDrum(AK.fx,    makeLegacyFx(),            -8),
  };
}

export function buildDrumKit(preset: DrumsPreset): DrumKit {
  if (preset === "acoustic") return buildAcousticSampledKit();
  return {
    kick: makeKick(preset),
    snare: makeSnare(preset),
    clap: makeClap(),
    hat: makeHat(preset, false),
    ohat: makeHat(preset, true),
    tomLow: makeTom("A2"),
    tomHigh: makeTom("D3"),
    crash: makeCrash(),
    fx: makeLegacyFx(),
  };
}

/**
 * Lightweight FX voice used by the legacy drum kit so the `fx` slot is
 * populated even on projects that haven't migrated to the new kit
 * system. New v2 kits in `sounds/kits.ts` provide richer per-kit FX.
 */
function makeLegacyFx(): DrumVoice {
  const noise = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.02, decay: 0.4, sustain: 0, release: 0.2 },
    volume: -18,
  });
  const lp = new Tone.Filter({ type: "lowpass", frequency: 4000, Q: 0.5 });
  const hp = new Tone.Filter({ type: "highpass", frequency: 800, Q: 0.7 });
  noise.chain(hp, lp);
  return {
    trigger: (time, velocity) => {
      lp.frequency.cancelScheduledValues(time);
      lp.frequency.setValueAtTime(800, time);
      lp.frequency.linearRampToValueAtTime(6000, time + 0.25);
      noise.triggerAttackRelease("4n", time, velocity);
    },
    connect: (dest) => {
      lp.connect(dest);
    },
    dispose: () => {
      noise.dispose();
      hp.dispose();
      lp.dispose();
    },
  };
}

// ---------- vocals ----------

/**
 * Apply a vocals preset to a voice's existing FX chain. The vocal
 * "instrument" is the user's mic, so the preset just tweaks the wet/dry
 * defaults of the channel's reverb/delay/filter.
 */
export function applyVocalPresetTo(
  fx: { reverb: Tone.Freeverb | Tone.Reverb; delay: Tone.FeedbackDelay; filter: Tone.Filter },
  preset: VocalsPreset,
) {
  switch (preset) {
    case "clean":
      fx.reverb.wet.value = 0.05;
      fx.delay.wet.value = 0;
      fx.filter.frequency.value = 18000;
      break;
    case "warm":
      fx.reverb.wet.value = 0.45;
      fx.delay.wet.value = 0.15;
      fx.filter.frequency.value = 12000;
      break;
    case "lofi":
      fx.reverb.wet.value = 0.2;
      fx.delay.wet.value = 0.1;
      fx.filter.frequency.value = 3500;
      break;
  }
}
