import * as Tone from "tone";
import { firstPlayMark, firstPlayMeasure } from "../../performance/firstPlayTrace";
import type {
  MelodicEngine,
  MelodicPresetDef,
  MelodicSynthRecipe,
} from "./types";
import { Mono808Voice, PolyPluck, type MelodicVoice } from "../voices";
import type { SoundParams } from "../../../types";

/**
 * Melodic preset library, authored as data.
 *
 * Each preset has a synth recipe plus an optional sample-layers array.
 * `buildPresetVoice` returns an immediate offline model. AudioEngine may
 * replace it with a decoded local sample bank when a preset declares layers;
 * unavailable layers always leave the playable model intact.
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
    description: "Offline modeled grand with a warm hall send and responsive dynamics.",
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
  {
    id: "keys.neon-glass",
    name: "Neon Glass Keys",
    category: "Keys",
    description: "Bright FM tine keys with wide chorus and a clean delayed tail.",
    compatibleWith: ["piano"],
    synth: synth({
      engine: "fmkeys",
      attack: 0.008,
      decay: 0.42,
      sustain: 0.28,
      release: 0.68,
      cutoff: 0.82,
      resonance: 0.12,
      chorusSend: 0.38,
      width: 0.72,
      delaySend: 0.14,
      reverbSend: 0.2,
    }),
  },
  {
    id: "keys.tape-upright",
    name: "Tape Upright",
    category: "Keys",
    description: "Muted upright-style model with slow tape softness and short room tone.",
    compatibleWith: ["piano"],
    synth: synth({
      engine: "softkeys",
      attack: 0.035,
      decay: 0.52,
      sustain: 0.3,
      release: 0.5,
      cutoff: 0.42,
      resonance: 0.08,
      drive: 0.09,
      width: 0.4,
      reverbSend: 0.22,
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
  {
    id: "bass.reese",
    name: "Ronin Reese",
    category: "Bass",
    description: "Wide detuned saw bass with a dark filter and controlled drive.",
    compatibleWith: ["bass", "piano"],
    synth: synth({
      engine: "polysaw",
      attack: 0.012,
      decay: 0.34,
      sustain: 0.72,
      release: 0.38,
      cutoff: 0.38,
      resonance: 0.32,
      width: 0.78,
      drive: 0.28,
      octave: -1,
    }),
  },
  {
    id: "bass.acid",
    name: "Acid Circuit",
    category: "Bass",
    description: "Resonant mono bass for sliding sequences and tight sixteenth-note lines.",
    compatibleWith: ["bass", "piano"],
    synth: synth({
      engine: "monosaw",
      attack: 0.002,
      decay: 0.24,
      sustain: 0.38,
      release: 0.18,
      cutoff: 0.5,
      resonance: 0.78,
      drive: 0.32,
      glide: 0.055,
      mono: true,
      octave: -1,
      delaySend: 0.06,
    }),
  },
  {
    id: "bass.short-808",
    name: "Tactical 808",
    category: "Bass",
    description: "Short controlled 808 with fast glide and a restrained pitch drop.",
    compatibleWith: ["bass", "piano"],
    synth: synth({
      engine: "808",
      attack: 0.002,
      decay: 0.38,
      sustain: 0.48,
      release: 0.3,
      cutoff: 0.52,
      resonance: 0.12,
      drive: 0.18,
      glide: 0.045,
      mono: true,
      octave: -2,
      pitchEnv: 3,
      sidechain: 0.22,
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
  {
    id: "pluck.koto-night",
    name: "Koto Night",
    category: "Pluck",
    description: "Tight resonant string pluck with a dark room and a precise attack.",
    compatibleWith: ["guitar", "piano"],
    synth: synth({
      engine: "pluck",
      attack: 0.001,
      decay: 0.34,
      sustain: 0,
      release: 0.42,
      cutoff: 0.68,
      resonance: 0.28,
      width: 0.46,
      reverbSend: 0.28,
      delaySend: 0.08,
    }),
  },
  {
    id: "guitar.nylon",
    name: "Nylon Ghost",
    category: "Pluck",
    description: "Soft nylon-like pluck for intimate chords and melodic finger patterns.",
    compatibleWith: ["guitar", "piano"],
    synth: synth({
      engine: "pluck",
      attack: 0.002,
      decay: 0.56,
      sustain: 0,
      release: 0.74,
      cutoff: 0.5,
      resonance: 0.16,
      width: 0.58,
      reverbSend: 0.24,
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
  {
    id: "pad.neon-air",
    name: "Neon Air",
    category: "Pad",
    description: "Open stereo atmosphere with a slow bloom and long luminous tail.",
    compatibleWith: ["piano", "guitar"],
    synth: synth({
      engine: "pad",
      attack: 0.72,
      decay: 0.82,
      sustain: 0.88,
      release: 0.94,
      cutoff: 0.7,
      resonance: 0.12,
      width: 0.94,
      chorusSend: 0.28,
      reverbSend: 0.62,
      delaySend: 0.1,
    }),
  },
  {
    id: "pad.choir-shadow",
    name: "Choir Shadow",
    category: "Pad",
    description: "Dark harmonic bed for cinematic tension without external sample downloads.",
    compatibleWith: ["piano", "guitar"],
    synth: synth({
      engine: "pad",
      attack: 0.58,
      decay: 0.68,
      sustain: 0.82,
      release: 0.9,
      cutoff: 0.34,
      resonance: 0.22,
      width: 0.86,
      drive: 0.06,
      reverbSend: 0.7,
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
  {
    id: "lead.arcade-pulse",
    name: "Arcade Pulse",
    category: "Lead",
    description: "Fast bright mono lead for retro hooks, arpeggios, and game-score lines.",
    compatibleWith: ["piano", "guitar"],
    synth: synth({
      engine: "monosaw",
      attack: 0.001,
      decay: 0.2,
      sustain: 0.62,
      release: 0.22,
      cutoff: 0.9,
      resonance: 0.36,
      drive: 0.2,
      glide: 0.018,
      mono: true,
      delaySend: 0.18,
      width: 0.42,
    }),
  },
  {
    id: "lead.silk",
    name: "Silk Katana",
    category: "Lead",
    description: "Smooth expressive lead with longer glide and a spacious stereo echo.",
    compatibleWith: ["piano", "guitar"],
    synth: synth({
      engine: "monosaw",
      attack: 0.018,
      decay: 0.32,
      sustain: 0.76,
      release: 0.52,
      cutoff: 0.62,
      resonance: 0.26,
      drive: 0.12,
      glide: 0.11,
      mono: true,
      width: 0.68,
      delaySend: 0.34,
      reverbSend: 0.16,
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
  {
    id: "bell.kalimba",
    name: "Steel Kalimba",
    category: "Bell",
    description: "Dry thumb-piano-style pluck with clear mids and a compact decay.",
    compatibleWith: ["piano", "guitar"],
    synth: synth({
      engine: "pluck",
      attack: 0.001,
      decay: 0.3,
      sustain: 0,
      release: 0.38,
      cutoff: 0.78,
      resonance: 0.2,
      width: 0.36,
      reverbSend: 0.16,
    }),
  },
  {
    id: "bell.crystal",
    name: "Crystal Shrine",
    category: "Bell",
    description: "Long glass bell with a high, controlled shimmer and wide hall tail.",
    compatibleWith: ["piano", "guitar"],
    synth: synth({
      engine: "bell",
      attack: 0.001,
      decay: 0.94,
      sustain: 0,
      release: 0.96,
      cutoff: 0.94,
      width: 0.8,
      reverbSend: 0.68,
      delaySend: 0.12,
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
  {
    id: "brass.short-stab",
    name: "Shogun Brass Stab",
    category: "Brass",
    description: "Fast dark brass hit for accents, trailer rhythms, and section punches.",
    compatibleWith: ["piano", "guitar"],
    synth: synth({
      engine: "brass",
      attack: 0.035,
      decay: 0.28,
      sustain: 0.45,
      release: 0.26,
      cutoff: 0.56,
      resonance: 0.18,
      width: 0.66,
      drive: 0.14,
      reverbSend: 0.28,
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

/**
 * Build a melodic voice from a preset recipe. Synthesis is returned
 * synchronously so the track is immediately playable; if the preset
 * declares `layers` with reachable files, we asynchronously hot-swap
 * the voice's internal engine to a Tone.Sampler once samples are
 * decoded. Result implements the `MelodicVoice` shape
 * (Tone.PolySynth | Tone.Sampler | PolyPluck).
 */
export function buildPresetVoice(def: MelodicPresetDef): MelodicVoice {
  const started = performance.now();
  const r = def.synth;
  firstPlayMark("instrument-factory:buildPresetVoice:start", {
    presetId: def.id,
    engine: r.engine,
  });
  // The synth fallback is returned synchronously below so the track is
  // immediately playable. The engine (see `engine.attachInstrument`)
  // separately drives `tryLoadMelodicSampler(def.layers, ...)` and
  // hot-swaps the active voice to the sampler when at least one layer
  // is reachable — keeping this function focused on synth construction.
  switch (r.engine) {
    case "sampler":
      // A playable offline model is the synchronous fallback. Presets with
      // licensed local layers are hot-swapped to a sampler by AudioEngine;
      // this avoids the old 18-request third-party piano download on first
      // play and makes the default project deterministic offline.
      firstPlayMark("audio-node:create", { kind: "modeled-piano", presetId: def.id });
      return markPresetVoice(def.id, started, new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2.01,
        modulationIndex: 1.8,
        oscillator: { type: "triangle" },
        envelope: adsr(r, 0.08, 1.1, 0.28, 2.0),
        modulation: { type: "sine" },
        modulationEnvelope: {
          attack: 0.001,
          decay: 0.32,
          sustain: 0.03,
          release: 0.7,
        },
        volume: -10,
      }));
    case "fmkeys":
      firstPlayMark("audio-node:create", { kind: "fmkeys", presetId: def.id });
      return markPresetVoice(def.id, started, new Tone.PolySynth(Tone.FMSynth, {
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
      }));
    case "polysaw":
      firstPlayMark("audio-node:create", { kind: "polysaw", presetId: def.id });
      return markPresetVoice(def.id, started, new Tone.PolySynth(Tone.MonoSynth, {
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
      }));
    case "monosaw":
      firstPlayMark("audio-node:create", { kind: "monosaw", presetId: def.id });
      return markPresetVoice(def.id, started, new Tone.PolySynth(Tone.MonoSynth, {
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
      }));
    case "pluck":
      firstPlayMark("audio-node:create", { kind: "pluck", presetId: def.id });
      return markPresetVoice(def.id, started, new PolyPluck(
        {
          attackNoise: 0.6,
          dampening: 4500,
          resonance: 0.94,
          release: secsFromNorm(r.release, 0, 1.2),
          volume: -8,
        },
        8,
      ));
    case "pad":
      firstPlayMark("audio-node:create", { kind: "pad", presetId: def.id });
      return markPresetVoice(def.id, started, new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 1.5,
        oscillator: { type: "sawtooth" },
        modulation: { type: "sine" },
        envelope: adsr(r, 0.4, 1.2, 0.8, 1.6),
        modulationEnvelope: { attack: 0.6, decay: 0.5, sustain: 0.5, release: 1.2 },
        volume: -16,
      }));
    case "sub":
      firstPlayMark("audio-node:create", { kind: "sub", presetId: def.id });
      return markPresetVoice(def.id, started, new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: adsr(r, 0.01, 0.5, 0.7, 1.0),
        volume: -6,
      }));
    case "808":
      // Real 808: single mono voice with portamento for legato slides,
      // a per-note pitch-envelope dive, and a sidechain duck on the
      // post-voice gain that emulates the kick-pump 808 basses usually
      // sit under. All three behaviors come from the recipe's
      // mono/pitchEnv/sidechain/glide fields.
      firstPlayMark("audio-node:create", { kind: "808", presetId: def.id });
      return markPresetVoice(def.id, started, new Mono808Voice({
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
      }));
    case "bell":
      firstPlayMark("audio-node:create", { kind: "bell", presetId: def.id });
      return markPresetVoice(def.id, started, new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 14,
        oscillator: { type: "sine" },
        envelope: adsr(r, 0.001, 0.9, 0, 1.1),
        modulation: { type: "sine" },
        modulationEnvelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.8 },
        volume: -14,
      }));
    case "brass":
      firstPlayMark("audio-node:create", { kind: "brass", presetId: def.id });
      return markPresetVoice(def.id, started, new Tone.PolySynth(Tone.MonoSynth, {
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
      }));
    case "softkeys":
      firstPlayMark("audio-node:create", { kind: "softkeys", presetId: def.id });
      return markPresetVoice(def.id, started, new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 1.0,
        oscillator: { type: "triangle" },
        modulation: { type: "sine" },
        envelope: adsr(r, 0.05, 0.6, 0.4, 0.7),
        modulationEnvelope: { attack: 0.05, decay: 0.3, sustain: 0.3, release: 0.5 },
        volume: -12,
      }));
  }
}

/** The persisted/live sound controls represented by a preset recipe. */
export function presetSoundParams(def: MelodicPresetDef): SoundParams {
  const r = def.synth;
  return {
    attack: r.attack,
    decay: r.decay,
    sustain: r.sustain,
    release: r.release,
    cutoff: r.cutoff,
    resonance: r.resonance,
    reverbSend: r.reverbSend,
    delaySend: r.delaySend,
    chorusSend: r.chorusSend,
    width: r.width,
    drive: r.drive,
    glide: r.glide,
  };
}

function markPresetVoice<T extends MelodicVoice>(presetId: string, started: number, voice: T): T {
  firstPlayMeasure("instrument-factory:buildPresetVoice", started, performance.now(), {
    presetId,
  });
  return voice;
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
