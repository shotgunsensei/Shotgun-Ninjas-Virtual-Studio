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

export type MelodicVoice =
  | Tone.PolySynth
  | Tone.Sampler
  | PolyPluck
  | Mono808Voice;

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
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 8,
        modulationIndex: 5.2,
        oscillator: { type: "sine" },
        envelope: { attack: 0.002, decay: 1.2, sustain: 0.0, release: 1.4 },
        modulation: { type: "sine" },
        modulationEnvelope: {
          attack: 0.002,
          decay: 0.35,
          sustain: 0.05,
          release: 0.4,
        },
        volume: -12,
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
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 1.0,
        modulationIndex: 1.4,
        oscillator: { type: "triangle" },
        envelope: { attack: 0.004, decay: 0.7, sustain: 0.18, release: 0.9 },
        modulation: { type: "triangle" },
        modulationEnvelope: {
          attack: 0.004,
          decay: 0.6,
          sustain: 0.0,
          release: 0.5,
        },
        volume: -14,
      });
    case "crunch":
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 2.5, frequency: 1600, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.003, decay: 0.45, sustain: 0.55, release: 0.5 },
        filterEnvelope: {
          attack: 0.003,
          decay: 0.25,
          sustain: 0.35,
          release: 0.4,
          baseFrequency: 350,
          octaves: 3,
        },
        volume: -16,
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
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "triangle" },
        filter: { Q: 1.8, frequency: 1400, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.008, decay: 0.45, sustain: 0.55, release: 0.5 },
        filterEnvelope: {
          attack: 0.005,
          decay: 0.3,
          sustain: 0.5,
          release: 0.4,
          baseFrequency: 180,
          octaves: 2.5,
        },
        volume: -8,
      });
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
      return new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 2.0,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.01, decay: 0.5, sustain: 0.7, release: 1.2 },
        modulationEnvelope: {
          attack: 0.01,
          decay: 0.3,
          sustain: 0.2,
          release: 0.4,
        },
        volume: -6,
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
    pitchDecay: isTrap ? 0.07 : isElectronic ? 0.04 : 0.045,
    octaves: isTrap ? 8 : isElectronic ? 6 : 5.5,
    envelope: {
      attack: 0.001,
      decay: isTrap ? 0.7 : isElectronic ? 0.4 : 0.5,
      sustain: 0,
      release: isTrap ? 0.6 : 0.4,
    },
    volume: isTrap ? -2 : -3,
  });

  const click = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.018, release: 0.01 },
    harmonicity: 5.1,
    modulationIndex: 14,
    resonance: isAcoustic ? 4500 : 5500,
    octaves: 0.5,
    volume: isAcoustic ? -22 : -28,
  });

  return {
    trigger: (time, velocity) => {
      body.triggerAttackRelease("C2", "8n", time, velocity);
      click.triggerAttackRelease("32n", time, velocity * 0.7);
    },
    connect: (dest) => {
      body.connect(dest);
      click.connect(dest);
    },
    dispose: () => {
      body.dispose();
      click.dispose();
    },
  };
}

function makeSnare(preset: DrumsPreset): DrumVoice {
  const isAcoustic = preset === "acoustic";
  const isTrap = preset === "trap";

  const body = new Tone.MembraneSynth({
    pitchDecay: 0.02,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.1 },
    volume: -14,
  });
  const noise = new Tone.NoiseSynth({
    noise: { type: isAcoustic ? "white" : "pink" },
    envelope: {
      attack: 0.001,
      decay: isAcoustic ? 0.18 : isTrap ? 0.1 : 0.13,
      sustain: 0,
      release: 0.1,
    },
    volume: -12,
  });
  const filter = new Tone.Filter({
    type: "highpass",
    frequency: isAcoustic ? 1200 : 1600,
    Q: 0.7,
  });
  noise.connect(filter);

  return {
    trigger: (time, velocity) => {
      body.triggerAttackRelease("D3", "32n", time, velocity * 0.7);
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

export function buildDrumKit(preset: DrumsPreset): DrumKit {
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
  fx: { reverb: Tone.Reverb; delay: Tone.FeedbackDelay; filter: Tone.Filter },
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
