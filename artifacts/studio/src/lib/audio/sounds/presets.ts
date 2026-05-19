import * as Tone from "tone";
import type {
  MelodicEngine,
  MelodicPresetDef,
  MelodicSynthRecipe,
} from "./types";
import { Mono808Voice, PolyPluck, type MelodicVoice } from "../voices";
import { tryLoadMelodicSampler } from "./samples";

/**
 * Melodic preset library, authored as data.
 *
 * Each preset has a synth recipe plus an optional sample-layers array.
 * `buildPresetVoice` probes the declared layers against the static
 * server; when at least one file is reachable it returns a sample-
 * based voice (Tone.Sampler), otherwise it falls back to the recipe's
 * synth engine. No sample assets ship in this build yet, so users
 * currently hear the synth fallback unless they drop WAV/MP3 files
 * into `public/samples/` matching the preset's layer urls.
 */

const synth = (partial: Partial<MelodicSynthRecipe> & { engine: MelodicEngine }): MelodicSynthRecipe => ({
  attack: 0.05,
  decay: 0.3,
  sustain: 0.6,
  release: 0.4,
  cutoff: 0.7,
  resonance: 0.15,
  width: 0.3,
  drive: 0,
  glide: 0,
  reverbSend: 0.1,
  delaySend: 0,
  chorusSend: 0,
  mono: false,
  octave: 0,
  pitchEnv: 0,
  sidechain: 0,
  ...partial,
});

export const MELODIC_PRESETS: MelodicPresetDef[] = [
  // ---- Keys ----
  {
    id: "keys.grand-piano",
    name: "Grand Piano",
    category: "Keys",
    description: "Sampled Salamander grand. Warm hall reverb.",
    compatibleWith: ["piano"],
    synth: synth({
      engine: "sampler",
      attack: 0.02,
      release: 0.6,
      reverbSend: 0.18,
    }),
  },
  {
    id: "keys.electric",
    name: "Electric Piano",
    category: "Keys",
    description: "FM Rhodes-style. Smooth bell.",
    compatibleWith: ["piano"],
    synth: synth({
      engine: "fmkeys",
      attack: 0.02,
      decay: 0.5,
      release: 0.55,
      cutoff: 0.7,
      chorusSend: 0.25,
    }),
  },
  {
    id: "keys.soft",
    name: "Soft Keys",
    category: "Keys",
    description: "Mellow felt-piano voice, gentle attack.",
    compatibleWith: ["piano"],
    synth: synth({
      engine: "softkeys",
      attack: 0.08,
      decay: 0.6,
      sustain: 0.4,
      release: 0.7,
      cutoff: 0.55,
      reverbSend: 0.3,
    }),
  },
  {
    id: "keys.synth",
    name: "Synth Keys",
    category: "Keys",
    description: "Saw poly with filter envelope.",
    compatibleWith: ["piano"],
    synth: synth({
      engine: "polysaw",
      attack: 0.015,
      decay: 0.45,
      sustain: 0.55,
      release: 0.55,
      cutoff: 0.6,
      resonance: 0.3,
      width: 0.5,
    }),
  },

  // ---- Bass ----
  {
    id: "bass.finger",
    name: "Finger Bass",
    category: "Bass",
    description: "Round triangle bass with a soft pluck.",
    compatibleWith: ["bass", "piano"],
    synth: synth({
      engine: "monosaw",
      attack: 0.005,
      decay: 0.35,
      sustain: 0.55,
      release: 0.35,
      cutoff: 0.45,
      resonance: 0.25,
      mono: true,
      glide: 0.02,
      octave: -1,
    }),
  },
  {
    id: "bass.808",
    name: "808 Bass",
    category: "Bass",
    description: "Mono 808 with glide, drive, pitch envelope and duck.",
    compatibleWith: ["bass", "piano"],
    synth: synth({
      engine: "808",
      attack: 0.005,
      decay: 0.6,
      sustain: 0.7,
      release: 0.6,
      cutoff: 0.6,
      resonance: 0.15,
      drive: 0.25,
      glide: 0.08,
      mono: true,
      octave: -2,
      pitchEnv: 6,
      sidechain: 0.35,
    }),
  },
  {
    id: "bass.sub",
    name: "Sub Bass",
    category: "Bass",
    description: "Pure sine sub for deep low end.",
    compatibleWith: ["bass", "piano"],
    synth: synth({
      engine: "sub",
      attack: 0.01,
      decay: 0.5,
      sustain: 0.7,
      release: 0.9,
      cutoff: 0.35,
      mono: true,
      octave: -1,
    }),
  },

  // ---- Pluck ----
  {
    id: "pluck.synth",
    name: "Pluck Synth",
    category: "Pluck",
    description: "Karplus pluck for arpeggios and rhythmic chords.",
    compatibleWith: ["guitar", "piano"],
    synth: synth({
      engine: "pluck",
      attack: 0.001,
      decay: 0.5,
      sustain: 0,
      release: 0.6,
      cutoff: 0.75,
      delaySend: 0.2,
    }),
  },
  {
    id: "guitar.clean",
    name: "Clean Guitar",
    category: "Pluck",
    description: "FM clean guitar with subtle chorus.",
    compatibleWith: ["guitar"],
    synth: synth({
      engine: "fmkeys",
      attack: 0.005,
      decay: 0.6,
      sustain: 0.2,
      release: 0.7,
      cutoff: 0.75,
      chorusSend: 0.2,
    }),
  },
  {
    id: "guitar.crunch",
    name: "Crunch Guitar",
    category: "Pluck",
    description: "Saw lead with overdrive grit.",
    compatibleWith: ["guitar"],
    synth: synth({
      engine: "monosaw",
      attack: 0.005,
      decay: 0.4,
      sustain: 0.5,
      release: 0.45,
      cutoff: 0.55,
      resonance: 0.4,
      drive: 0.45,
    }),
  },

  // ---- Pad ----
  {
    id: "pad.dark",
    name: "Dark Pad",
    category: "Pad",
    description: "Slow-attack saw pad with wide stereo.",
    compatibleWith: ["piano", "guitar"],
    synth: synth({
      engine: "pad",
      attack: 0.5,
      decay: 1.2,
      sustain: 0.8,
      release: 1.6,
      cutoff: 0.45,
      resonance: 0.2,
      width: 0.8,
      reverbSend: 0.5,
    }),
  },

  // ---- Lead ----
  {
    id: "lead.gritty",
    name: "Gritty Lead",
    category: "Lead",
    description: "Driven saw lead for solos.",
    compatibleWith: ["piano", "guitar"],
    synth: synth({
      engine: "monosaw",
      attack: 0.005,
      decay: 0.3,
      sustain: 0.7,
      release: 0.3,
      cutoff: 0.7,
      resonance: 0.45,
      drive: 0.5,
      glide: 0.04,
      mono: true,
      delaySend: 0.25,
    }),
  },

  // ---- Bell ----
  {
    id: "bell.mallet",
    name: "Bell Mallet",
    category: "Bell",
    description: "Glassy FM mallet bell.",
    compatibleWith: ["piano", "guitar"],
    synth: synth({
      engine: "bell",
      attack: 0.002,
      decay: 0.8,
      sustain: 0,
      release: 1.0,
      cutoff: 0.85,
      reverbSend: 0.4,
    }),
  },

  // ---- Brass / Siren ----
  {
    id: "brass.cinematic",
    name: "Cinematic Brass",
    category: "Brass",
    description: "Wide brass swell with slow swoop.",
    compatibleWith: ["piano", "guitar"],
    synth: synth({
      engine: "brass",
      attack: 0.15,
      decay: 0.4,
      sustain: 0.8,
      release: 0.8,
      cutoff: 0.65,
      width: 0.7,
      reverbSend: 0.5,
      glide: 0.06,
    }),
  },
];

export const MELODIC_CATEGORIES = [
  "Keys",
  "Bass",
  "Pluck",
  "Pad",
  "Lead",
  "Bell",
  "Brass",
] as const;

export function findPreset(id: string | undefined): MelodicPresetDef | null {
  if (!id) return null;
  return MELODIC_PRESETS.find((p) => p.id === id) ?? null;
}

// ---------------- Sample / synth resolution ----------------

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

/**
 * Build a melodic voice from a preset recipe. Synthesis is returned
 * synchronously so the track is immediately playable; if the preset
 * declares `layers` with reachable files, we asynchronously hot-swap
 * the voice's internal engine to a Tone.Sampler once samples are
 * decoded. Result implements the `MelodicVoice` shape
 * (Tone.PolySynth | Tone.Sampler | PolyPluck).
 */
export function buildPresetVoice(def: MelodicPresetDef): MelodicVoice {
  const r = def.synth;
  // The synth fallback is returned synchronously below so the track is
  // immediately playable. The engine (see `engine.attachInstrument`)
  // separately drives `tryLoadMelodicSampler(def.layers, ...)` and
  // hot-swaps the active voice to the sampler when at least one layer
  // is reachable — keeping this function focused on synth construction.
  switch (r.engine) {
    case "sampler":
      return new Tone.Sampler({
        urls: SALAMANDER_URLS,
        baseUrl: SALAMANDER_BASE,
        release: secsFromNorm(r.release, 0, 2.0),
        attack: secsFromNorm(r.attack, 0, 0.4),
        volume: -8,
      });
    case "fmkeys":
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 8,
        modulationIndex: 5.2,
        oscillator: { type: "sine" },
        envelope: adsr(r, 0.002, 1.2, 0.0, 1.4),
        modulation: { type: "sine" },
        modulationEnvelope: {
          attack: 0.002,
          decay: 0.35,
          sustain: 0.05,
          release: 0.4,
        },
        volume: -12,
      });
    case "polysaw":
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 1 + r.resonance * 8, frequency: 200, type: "lowpass", rolloff: -24 },
        envelope: adsr(r, 0.01, 0.4, 0.65, 1.1),
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
    case "monosaw":
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        portamento: r.glide,
        filter: { Q: 1 + r.resonance * 8, frequency: 600, type: "lowpass", rolloff: -24 },
        envelope: adsr(r, 0.005, 0.3, 0.6, 0.5),
        filterEnvelope: {
          attack: 0.005,
          decay: 0.4,
          sustain: 0.5,
          release: 0.4,
          baseFrequency: 200,
          octaves: 3,
        },
        volume: -14,
      });
    case "pluck":
      return new PolyPluck(
        {
          attackNoise: 0.6,
          dampening: 4500,
          resonance: 0.94,
          release: secsFromNorm(r.release, 0, 1.2),
          volume: -8,
        },
        8,
      );
    case "pad":
      return new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 1.5,
        oscillator: { type: "sawtooth" },
        modulation: { type: "sine" },
        envelope: adsr(r, 0.4, 1.2, 0.8, 1.6),
        modulationEnvelope: { attack: 0.6, decay: 0.5, sustain: 0.5, release: 1.2 },
        volume: -16,
      });
    case "sub":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: adsr(r, 0.01, 0.5, 0.7, 1.0),
        volume: -6,
      });
    case "808":
      // Real 808: single mono voice with portamento for legato slides,
      // a per-note pitch-envelope dive, and a sidechain duck on the
      // post-voice gain that emulates the kick-pump 808 basses usually
      // sit under. All three behaviors come from the recipe's
      // mono/pitchEnv/sidechain/glide fields.
      return new Mono808Voice({
        portamento: Math.max(r.glide, r.mono ? 0.04 : 0),
        envelope: adsr(r, 0.005, 0.6, 0.7, 0.8),
        filter: { Q: 1.5, frequency: 200, type: "lowpass", rolloff: -24 },
        filterEnvelope: {
          attack: 0.005,
          decay: 0.3,
          sustain: 0.5,
          release: 0.6,
          baseFrequency: 100,
          octaves: 2.5,
        },
        pitchEnvSemis: r.pitchEnv ?? 0,
        sidechain: r.sidechain ?? 0,
        volume: -6,
      });
    case "bell":
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 14,
        oscillator: { type: "sine" },
        envelope: adsr(r, 0.001, 0.9, 0, 1.1),
        modulation: { type: "sine" },
        modulationEnvelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.8 },
        volume: -14,
      });
    case "brass":
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        portamento: r.glide,
        filter: { Q: 1.0, frequency: 1200, type: "lowpass", rolloff: -24 },
        envelope: adsr(r, 0.12, 0.4, 0.8, 0.8),
        filterEnvelope: {
          attack: 0.12,
          decay: 0.3,
          sustain: 0.7,
          release: 0.5,
          baseFrequency: 250,
          octaves: 3,
        },
        volume: -14,
      });
    case "softkeys":
      return new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 1.0,
        oscillator: { type: "triangle" },
        modulation: { type: "sine" },
        envelope: adsr(r, 0.05, 0.6, 0.4, 0.7),
        modulationEnvelope: { attack: 0.05, decay: 0.3, sustain: 0.3, release: 0.5 },
        volume: -12,
      });
  }
}

function secsFromNorm(norm: number, min: number, max: number) {
  return min + Math.max(0, Math.min(1, norm)) * (max - min);
}

function adsr(
  r: MelodicSynthRecipe,
  attackMax = 1,
  decayMax = 1,
  sustainBase = 0.5,
  releaseMax = 1,
) {
  return {
    attack: Math.max(0.001, r.attack * attackMax),
    decay: Math.max(0.001, r.decay * decayMax),
    sustain: r.sustain * (sustainBase > 0 ? 1 : 1),
    release: Math.max(0.01, r.release * releaseMax),
  };
}
