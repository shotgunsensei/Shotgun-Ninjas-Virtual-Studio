import * as Tone from "tone";
import { firstPlayMark, firstPlayMeasure } from "../../performance/firstPlayTrace";
import type { DrumPiece } from "../voices";
import { tryLoadDrumSamples, type DrumSampleBank } from "./samples";
import type {
  DrumKitDef,
  DrumKitId,
  DrumPieceDef,
  DrumSynthRecipe,
} from "./types";

/**
 * Five named drum kits authored as data. Each kit covers the same
 * 9 piece slots so switching kits never breaks an existing pattern.
 *
 * Slot semantics:
 *   kick    — main kick
 *   snare   — main snare
 *   clap    — clap (parallel to snare on 2/4)
 *   hat     — closed hat
 *   ohat    — open hat
 *   tomLow  — perc 1 (low/rim/conga)
 *   tomHigh — perc 2 (high/snap)
 *   crash   — crash/impact
 *   fx      — FX hit / vinyl / siren-snap
 *
 * Choke groups: closed/open hat share "hihat" so an open hat triggered
 * while a closed hat is ringing chokes the closed hat (and vice-versa),
 * matching real-kit behavior.
 */

const piece = (
  id: DrumPiece,
  name: string,
  partial: Partial<DrumPieceDef> & {
    synth: DrumSynthRecipe;
    category: DrumPieceDef["category"];
  },
): DrumPieceDef => ({
  id,
  name,
  layers: [],
  chokeGroup: undefined,
  defaultVolume: 0.85,
  defaultPan: 0,
  defaultPitch: 0,
  defaultDecay: 0.5,
  defaultCutoff: 1,
  defaultReverbSend: 0,
  defaultDelaySend: 0,
  ...partial,
});

// ---------------- Trap kit ----------------
const TRAP: DrumKitDef = {
  id: "trap",
  name: "Ninja Trap Kit",
  description: "Long sub kick, snappy clap, tight 808 hats, vinyl FX.",
  pieces: {
    kick: piece("kick", "808 Kick", {
      category: "kick",
      synth: {
        engine: "kick",
        pitch: 36,
        octaves: 8,
        pitchDecay: 0.07,
        decay: 0.7,
        bodyLevelDb: -2,
        clickLevelDb: -30,
      },
      defaultDecay: 0.7,
    }),
    snare: piece("snare", "Trap Snare", {
      category: "snare",
      synth: {
        engine: "snare",
        decay: 0.18,
        noise: "white",
        highpass: 1700,
        bodyLevelDb: -14,
        clickLevelDb: -10,
      },
      defaultDecay: 0.45,
    }),
    clap: piece("clap", "Snap Clap", {
      category: "clap",
      synth: { engine: "clap", decay: 0.12, noise: "white", highpass: 2200 },
      defaultReverbSend: 0.18,
    }),
    hat: piece("hat", "Closed Hat", {
      category: "hat",
      synth: {
        engine: "hat",
        decay: 0.04,
        highpass: 7500,
        layers: 4,
        pitchSpread: 0.4,
      },
      chokeGroup: "hihat",
      defaultVolume: 0.7,
    }),
    ohat: piece("ohat", "Open Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.4, highpass: 7000 },
      chokeGroup: "hihat",
      defaultVolume: 0.65,
    }),
    tomLow: piece("tomLow", "Rim Perc", {
      category: "perc",
      synth: { engine: "tom", pitch: 55, decay: 0.15 },
      defaultPan: -0.3,
    }),
    tomHigh: piece("tomHigh", "Snap Perc", {
      category: "perc",
      synth: { engine: "tom", pitch: 67, decay: 0.18 },
      defaultPan: 0.3,
    }),
    crash: piece("crash", "Impact", {
      category: "crash",
      synth: { engine: "crash", decay: 1.6 },
      defaultVolume: 0.55,
      defaultReverbSend: 0.35,
    }),
    fx: piece("fx", "Vinyl FX", {
      category: "fx",
      synth: { engine: "fx", decay: 0.6, noise: "pink", highpass: 1800 },
      defaultVolume: 0.5,
      defaultReverbSend: 0.5,
      defaultDelaySend: 0.25,
    }),
  },
};

// ---------------- Boom Bap kit ----------------
const BOOMBAP: DrumKitDef = {
  id: "boombap",
  name: "Boom Bap Dojo Kit",
  description: "Dusty acoustic kick, fat snare, swung shoulders.",
  pieces: {
    kick: piece("kick", "Boom Kick", {
      category: "kick",
      synth: {
        engine: "kick",
        pitch: 42,
        octaves: 5,
        pitchDecay: 0.045,
        decay: 0.5,
        bodyLevelDb: -3,
        clickLevelDb: -22,
      },
    }),
    snare: piece("snare", "Bap Snare", {
      category: "snare",
      synth: {
        engine: "snare",
        decay: 0.22,
        noise: "white",
        highpass: 1200,
        bodyLevelDb: -10,
        clickLevelDb: -8,
      },
      defaultDecay: 0.6,
      defaultReverbSend: 0.2,
    }),
    clap: piece("clap", "Dusty Clap", {
      category: "clap",
      synth: { engine: "clap", decay: 0.1, noise: "pink", highpass: 1400 },
    }),
    hat: piece("hat", "Closed Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.06, highpass: 6500, layers: 4 },
      chokeGroup: "hihat",
    }),
    ohat: piece("ohat", "Open Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.5, highpass: 6000 },
      chokeGroup: "hihat",
    }),
    tomLow: piece("tomLow", "Low Tom", {
      category: "perc",
      synth: { engine: "tom", pitch: 45, decay: 0.4 },
    }),
    tomHigh: piece("tomHigh", "Mid Tom", {
      category: "perc",
      synth: { engine: "tom", pitch: 57, decay: 0.35 },
    }),
    crash: piece("crash", "Ride Cymbal", {
      category: "crash",
      synth: { engine: "crash", decay: 1.4 },
      defaultReverbSend: 0.3,
    }),
    fx: piece("fx", "Vinyl Crackle", {
      category: "fx",
      synth: { engine: "fx", decay: 0.35, noise: "brown", highpass: 800 },
      defaultVolume: 0.45,
    }),
  },
};

// ---------------- Cyberpunk Studio kit ----------------
const CYBERPUNK: DrumKitDef = {
  id: "cyberpunk",
  name: "Cyberpunk Studio Kit",
  description: "Metallic kick, gated snare, neon hats, glitch FX.",
  pieces: {
    kick: piece("kick", "Neon Kick", {
      category: "kick",
      synth: {
        engine: "kick",
        pitch: 38,
        octaves: 7,
        pitchDecay: 0.05,
        decay: 0.45,
        bodyLevelDb: -2,
        clickLevelDb: -16,
        drive: 0.4,
      },
    }),
    snare: piece("snare", "Gated Snare", {
      category: "snare",
      synth: {
        engine: "snare",
        decay: 0.14,
        noise: "white",
        highpass: 1800,
        bodyLevelDb: -8,
        clickLevelDb: -6,
        drive: 0.3,
      },
      defaultReverbSend: 0.35,
    }),
    clap: piece("clap", "Synth Clap", {
      category: "clap",
      synth: { engine: "clap", decay: 0.12, noise: "white", highpass: 1900 },
    }),
    hat: piece("hat", "Metallic Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.05, highpass: 8500, layers: 4 },
      chokeGroup: "hihat",
    }),
    ohat: piece("ohat", "Open Metal", {
      category: "hat",
      synth: { engine: "hat", decay: 0.35, highpass: 7500 },
      chokeGroup: "hihat",
    }),
    tomLow: piece("tomLow", "Electro Tom", {
      category: "perc",
      synth: { engine: "tom", pitch: 50, decay: 0.3 },
      defaultPan: -0.4,
    }),
    tomHigh: piece("tomHigh", "Zap Perc", {
      category: "perc",
      synth: { engine: "tom", pitch: 72, decay: 0.15 },
      defaultPan: 0.4,
    }),
    crash: piece("crash", "Reverse Crash", {
      category: "crash",
      synth: { engine: "crash", decay: 1.8 },
      defaultReverbSend: 0.4,
    }),
    fx: piece("fx", "Glitch FX", {
      category: "fx",
      synth: { engine: "fx", decay: 0.5, noise: "white", highpass: 4000 },
      defaultDelaySend: 0.4,
      defaultReverbSend: 0.3,
    }),
  },
};

// ---------------- Lo-Fi Smoke kit ----------------
const LOFI: DrumKitDef = {
  id: "lofi",
  name: "Lo-Fi Smoke Kit",
  description: "Warm muted kick, tape snare, brushed hats, dust FX.",
  pieces: {
    kick: piece("kick", "Tape Kick", {
      category: "kick",
      synth: {
        engine: "kick",
        pitch: 40,
        octaves: 4.5,
        pitchDecay: 0.05,
        decay: 0.55,
        bodyLevelDb: -4,
        clickLevelDb: -28,
        lowpass: 3500,
      },
    }),
    snare: piece("snare", "Tape Snare", {
      category: "snare",
      synth: {
        engine: "snare",
        decay: 0.2,
        noise: "pink",
        highpass: 900,
        bodyLevelDb: -12,
        clickLevelDb: -10,
        lowpass: 6000,
      },
      defaultCutoff: 0.7,
      defaultReverbSend: 0.25,
    }),
    clap: piece("clap", "Muted Clap", {
      category: "clap",
      synth: { engine: "clap", decay: 0.08, noise: "pink", highpass: 1100 },
    }),
    hat: piece("hat", "Brushed Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.045, highpass: 5500, layers: 4 },
      chokeGroup: "hihat",
      defaultCutoff: 0.7,
    }),
    ohat: piece("ohat", "Open Brushed", {
      category: "hat",
      synth: { engine: "hat", decay: 0.3, highpass: 5000 },
      chokeGroup: "hihat",
      defaultCutoff: 0.7,
    }),
    tomLow: piece("tomLow", "Dub Tom", {
      category: "perc",
      synth: { engine: "tom", pitch: 43, decay: 0.45 },
    }),
    tomHigh: piece("tomHigh", "Brush Perc", {
      category: "perc",
      synth: { engine: "tom", pitch: 60, decay: 0.25 },
    }),
    crash: piece("crash", "Cassette Crash", {
      category: "crash",
      synth: { engine: "crash", decay: 1.2 },
      defaultReverbSend: 0.3,
    }),
    fx: piece("fx", "Dust Loop", {
      category: "fx",
      synth: { engine: "fx", decay: 0.4, noise: "brown", highpass: 400 },
      defaultVolume: 0.5,
    }),
  },
};

// ---------------- Cinematic Impact kit ----------------
const CINEMATIC: DrumKitDef = {
  id: "cinematic",
  name: "Cinematic Impact Kit",
  description: "Deep boom, ensemble snare, reverse FX, sub drops.",
  pieces: {
    kick: piece("kick", "Sub Boom", {
      category: "kick",
      synth: {
        engine: "kick",
        pitch: 34,
        octaves: 9,
        pitchDecay: 0.08,
        decay: 1.0,
        bodyLevelDb: -1,
        clickLevelDb: -32,
      },
      defaultReverbSend: 0.35,
      defaultDecay: 0.85,
    }),
    snare: piece("snare", "Ensemble Snare", {
      category: "snare",
      synth: {
        engine: "snare",
        decay: 0.35,
        noise: "white",
        highpass: 1400,
        bodyLevelDb: -9,
        clickLevelDb: -8,
      },
      defaultReverbSend: 0.55,
    }),
    clap: piece("clap", "Hall Clap", {
      category: "clap",
      synth: { engine: "clap", decay: 0.2, noise: "white", highpass: 1500 },
      defaultReverbSend: 0.45,
    }),
    hat: piece("hat", "Tight Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.045, highpass: 7000, layers: 3 },
      chokeGroup: "hihat",
    }),
    ohat: piece("ohat", "Splash Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.6, highpass: 6500 },
      chokeGroup: "hihat",
      defaultReverbSend: 0.3,
    }),
    tomLow: piece("tomLow", "Taiko Low", {
      category: "perc",
      synth: { engine: "tom", pitch: 38, decay: 0.7 },
      defaultPan: -0.2,
      defaultReverbSend: 0.3,
    }),
    tomHigh: piece("tomHigh", "Taiko High", {
      category: "perc",
      synth: { engine: "tom", pitch: 52, decay: 0.55 },
      defaultPan: 0.2,
      defaultReverbSend: 0.3,
    }),
    crash: piece("crash", "Epic Crash", {
      category: "crash",
      synth: { engine: "crash", decay: 2.2 },
      defaultReverbSend: 0.55,
    }),
    fx: piece("fx", "Reverse Riser", {
      category: "fx",
      synth: { engine: "fx", decay: 1.0, noise: "white", highpass: 600 },
      defaultReverbSend: 0.6,
      defaultDelaySend: 0.2,
    }),
  },
};

// ---------------- Demon Truck 808 Kit ----------------
const DEMONTRUCK: DrumKitDef = {
  id: "demontruck",
  name: "Demon Truck 808 Kit",
  description: "Heavy sub-saturated 808 kick, slow open hats, rumble bass FX.",
  pieces: {
    kick: piece("kick", "808 Sub Kick", {
      category: "kick",
      synth: {
        engine: "kick",
        pitch: 32,
        octaves: 10,
        pitchDecay: 0.1,
        decay: 1.1,
        bodyLevelDb: 0,
        clickLevelDb: -36,
        drive: 0.5,
      },
      defaultDecay: 0.9,
      defaultReverbSend: 0.1,
    }),
    snare: piece("snare", "Truck Snap", {
      category: "snare",
      synth: {
        engine: "snare",
        decay: 0.2,
        noise: "white",
        highpass: 2000,
        bodyLevelDb: -10,
        clickLevelDb: -8,
        drive: 0.35,
      },
      defaultDecay: 0.4,
    }),
    clap: piece("clap", "Rumble Clap", {
      category: "clap",
      synth: { engine: "clap", decay: 0.14, noise: "white", highpass: 2000 },
      defaultReverbSend: 0.15,
    }),
    hat: piece("hat", "808 Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.03, highpass: 8000, layers: 4, pitchSpread: 0.3 },
      chokeGroup: "hihat",
      defaultVolume: 0.65,
    }),
    ohat: piece("ohat", "Slow Open Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.7, highpass: 7000 },
      chokeGroup: "hihat",
      defaultVolume: 0.6,
    }),
    tomLow: piece("tomLow", "Sub Perc", {
      category: "perc",
      synth: { engine: "tom", pitch: 36, decay: 0.5 },
      defaultPan: -0.3,
    }),
    tomHigh: piece("tomHigh", "Clank Perc", {
      category: "perc",
      synth: { engine: "tom", pitch: 60, decay: 0.2 },
      defaultPan: 0.3,
    }),
    crash: piece("crash", "Truck Crash", {
      category: "crash",
      synth: { engine: "crash", decay: 2.0 },
      defaultVolume: 0.5,
      defaultReverbSend: 0.4,
    }),
    fx: piece("fx", "Sub Rumble", {
      category: "fx",
      synth: { engine: "fx", decay: 0.8, noise: "brown", highpass: 200 },
      defaultVolume: 0.55,
      defaultReverbSend: 0.2,
    }),
  },
};

// ---------------- Neon Dojo Percussion ----------------
const NEONDOJO: DrumKitDef = {
  id: "neondojo",
  name: "Neon Dojo Percussion",
  description: "Layered toms, metallic cymbals, tight neon groove.",
  pieces: {
    kick: piece("kick", "Dojo Kick", {
      category: "kick",
      synth: {
        engine: "kick",
        pitch: 40,
        octaves: 6,
        pitchDecay: 0.055,
        decay: 0.42,
        bodyLevelDb: -3,
        clickLevelDb: -18,
      },
      defaultDecay: 0.55,
    }),
    snare: piece("snare", "Rim Shot", {
      category: "snare",
      synth: {
        engine: "snare",
        decay: 0.13,
        noise: "white",
        highpass: 2200,
        bodyLevelDb: -12,
        clickLevelDb: -6,
      },
      defaultDecay: 0.35,
    }),
    clap: piece("clap", "Dojo Clap", {
      category: "clap",
      synth: { engine: "clap", decay: 0.1, noise: "white", highpass: 2400 },
    }),
    hat: piece("hat", "Metal Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.035, highpass: 9000, layers: 4, pitchSpread: 0.2 },
      chokeGroup: "hihat",
      defaultVolume: 0.72,
    }),
    ohat: piece("ohat", "Splash", {
      category: "hat",
      synth: { engine: "hat", decay: 0.25, highpass: 8500 },
      chokeGroup: "hihat",
    }),
    tomLow: piece("tomLow", "Low Tom", {
      category: "perc",
      synth: { engine: "tom", pitch: 46, decay: 0.35 },
      defaultPan: -0.4,
      defaultReverbSend: 0.2,
    }),
    tomHigh: piece("tomHigh", "High Tom", {
      category: "perc",
      synth: { engine: "tom", pitch: 62, decay: 0.25 },
      defaultPan: 0.4,
      defaultReverbSend: 0.2,
    }),
    crash: piece("crash", "Gong Crash", {
      category: "crash",
      synth: { engine: "crash", decay: 1.9 },
      defaultReverbSend: 0.5,
    }),
    fx: piece("fx", "Bell Strike", {
      category: "fx",
      synth: { engine: "fx", decay: 0.7, noise: "white", highpass: 3500 },
      defaultVolume: 0.5,
      defaultReverbSend: 0.45,
    }),
  },
};

// ---------------- Garage Band Chaos Kit ----------------
const GARAGEBAND: DrumKitDef = {
  id: "garageband",
  name: "Garage Band Chaos Kit",
  description: "Overdriven snare, live room kick, crash-heavy, raw energy.",
  pieces: {
    kick: piece("kick", "Room Kick", {
      category: "kick",
      synth: {
        engine: "kick",
        pitch: 44,
        octaves: 5,
        pitchDecay: 0.04,
        decay: 0.48,
        bodyLevelDb: -2,
        clickLevelDb: -16,
        drive: 0.3,
      },
      defaultReverbSend: 0.25,
    }),
    snare: piece("snare", "Blown Snare", {
      category: "snare",
      synth: {
        engine: "snare",
        decay: 0.28,
        noise: "white",
        highpass: 1000,
        bodyLevelDb: -8,
        clickLevelDb: -6,
        drive: 0.55,
      },
      defaultDecay: 0.65,
      defaultReverbSend: 0.3,
    }),
    clap: piece("clap", "Live Clap", {
      category: "clap",
      synth: { engine: "clap", decay: 0.15, noise: "white", highpass: 1200 },
      defaultReverbSend: 0.2,
    }),
    hat: piece("hat", "Open Hi-Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.07, highpass: 6000, layers: 3 },
      chokeGroup: "hihat",
    }),
    ohat: piece("ohat", "Crash Ride", {
      category: "hat",
      synth: { engine: "hat", decay: 0.8, highpass: 5500 },
      chokeGroup: "hihat",
      defaultVolume: 0.7,
      defaultReverbSend: 0.25,
    }),
    tomLow: piece("tomLow", "Floor Tom", {
      category: "perc",
      synth: { engine: "tom", pitch: 41, decay: 0.55 },
      defaultPan: -0.35,
      defaultReverbSend: 0.2,
    }),
    tomHigh: piece("tomHigh", "Rack Tom", {
      category: "perc",
      synth: { engine: "tom", pitch: 56, decay: 0.4 },
      defaultPan: 0.35,
      defaultReverbSend: 0.2,
    }),
    crash: piece("crash", "Big Crash", {
      category: "crash",
      synth: { engine: "crash", decay: 2.4 },
      defaultVolume: 0.7,
      defaultReverbSend: 0.45,
    }),
    fx: piece("fx", "Garage FX", {
      category: "fx",
      synth: { engine: "fx", decay: 0.5, noise: "white", highpass: 800 },
      defaultVolume: 0.45,
      defaultReverbSend: 0.35,
    }),
  },
};

// ---------------- Southern Dirt Drum Kit ----------------
const SOUTHERNDIRT: DrumKitDef = {
  id: "southerndirt",
  name: "Southern Dirt Drum Kit",
  description: "Boomy kick, rimshot snare, brush hats, swamp-grown groove.",
  pieces: {
    kick: piece("kick", "Swamp Kick", {
      category: "kick",
      synth: {
        engine: "kick",
        pitch: 43,
        octaves: 6,
        pitchDecay: 0.05,
        decay: 0.65,
        bodyLevelDb: -2,
        clickLevelDb: -24,
        lowpass: 4000,
      },
      defaultDecay: 0.75,
      defaultReverbSend: 0.18,
    }),
    snare: piece("snare", "Rimshot", {
      category: "snare",
      synth: {
        engine: "snare",
        decay: 0.22,
        noise: "pink",
        highpass: 1600,
        bodyLevelDb: -11,
        clickLevelDb: -9,
      },
      defaultDecay: 0.5,
      defaultReverbSend: 0.2,
    }),
    clap: piece("clap", "Dirt Clap", {
      category: "clap",
      synth: { engine: "clap", decay: 0.09, noise: "pink", highpass: 1300 },
    }),
    hat: piece("hat", "Brush Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.055, highpass: 5800, layers: 4 },
      chokeGroup: "hihat",
      defaultCutoff: 0.75,
    }),
    ohat: piece("ohat", "Brush Open", {
      category: "hat",
      synth: { engine: "hat", decay: 0.45, highpass: 5200 },
      chokeGroup: "hihat",
      defaultCutoff: 0.75,
    }),
    tomLow: piece("tomLow", "Conga Low", {
      category: "perc",
      synth: { engine: "tom", pitch: 44, decay: 0.5 },
      defaultPan: -0.3,
    }),
    tomHigh: piece("tomHigh", "Conga High", {
      category: "perc",
      synth: { engine: "tom", pitch: 58, decay: 0.3 },
      defaultPan: 0.3,
    }),
    crash: piece("crash", "Sizzle Ride", {
      category: "crash",
      synth: { engine: "crash", decay: 1.5 },
      defaultReverbSend: 0.25,
    }),
    fx: piece("fx", "Dusty Snap", {
      category: "fx",
      synth: { engine: "fx", decay: 0.3, noise: "brown", highpass: 600 },
      defaultVolume: 0.45,
    }),
  },
};

// ---------------- Cyber Trap Essentials ----------------
const CYBERTRAP: DrumKitDef = {
  id: "cybertrap",
  name: "Cyber Trap Essentials",
  description: "Glitchy hats, distorted 808, digital snap snare, future streets.",
  pieces: {
    kick: piece("kick", "Dist 808", {
      category: "kick",
      synth: {
        engine: "kick",
        pitch: 34,
        octaves: 9,
        pitchDecay: 0.08,
        decay: 0.85,
        bodyLevelDb: -1,
        clickLevelDb: -30,
        drive: 0.65,
      },
      defaultDecay: 0.8,
    }),
    snare: piece("snare", "Digital Snap", {
      category: "snare",
      synth: {
        engine: "snare",
        decay: 0.11,
        noise: "white",
        highpass: 2500,
        bodyLevelDb: -8,
        clickLevelDb: -4,
        drive: 0.4,
      },
      defaultDecay: 0.3,
    }),
    clap: piece("clap", "Trap Clap", {
      category: "clap",
      synth: { engine: "clap", decay: 0.12, noise: "white", highpass: 2600 },
      defaultReverbSend: 0.12,
    }),
    hat: piece("hat", "Glitch Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.028, highpass: 9500, layers: 4, pitchSpread: 0.6 },
      chokeGroup: "hihat",
      defaultVolume: 0.7,
    }),
    ohat: piece("ohat", "Open Glitch", {
      category: "hat",
      synth: { engine: "hat", decay: 0.38, highpass: 8500 },
      chokeGroup: "hihat",
      defaultVolume: 0.6,
    }),
    tomLow: piece("tomLow", "Electro Perc", {
      category: "perc",
      synth: { engine: "tom", pitch: 48, decay: 0.25 },
      defaultPan: -0.4,
    }),
    tomHigh: piece("tomHigh", "Digital Snap 2", {
      category: "perc",
      synth: { engine: "tom", pitch: 72, decay: 0.12 },
      defaultPan: 0.4,
    }),
    crash: piece("crash", "Cyber Crash", {
      category: "crash",
      synth: { engine: "crash", decay: 1.6 },
      defaultReverbSend: 0.3,
      defaultDelaySend: 0.2,
    }),
    fx: piece("fx", "Glitch FX", {
      category: "fx",
      synth: { engine: "fx", decay: 0.4, noise: "white", highpass: 5000 },
      defaultVolume: 0.6,
      defaultDelaySend: 0.5,
    }),
  },
};

// ---------------- Arcade Ghosts FX ----------------
const ARCADEGHOSTS: DrumKitDef = {
  id: "arcadeghosts",
  name: "Arcade Ghosts FX",
  description: "Chiptune hits, bitcrushed snare, 8-bit blip FX.",
  pieces: {
    kick: piece("kick", "8-Bit Kick", {
      category: "kick",
      synth: {
        engine: "kick",
        pitch: 48,
        octaves: 6,
        pitchDecay: 0.03,
        decay: 0.3,
        bodyLevelDb: -2,
        clickLevelDb: -20,
        drive: 0.6,
      },
      defaultDecay: 0.4,
    }),
    snare: piece("snare", "Bit Snare", {
      category: "snare",
      synth: {
        engine: "snare",
        decay: 0.1,
        noise: "white",
        highpass: 3000,
        bodyLevelDb: -6,
        clickLevelDb: -4,
        drive: 0.7,
      },
      defaultDecay: 0.25,
    }),
    clap: piece("clap", "Pixel Clap", {
      category: "clap",
      synth: { engine: "clap", decay: 0.08, noise: "white", highpass: 3200 },
    }),
    hat: piece("hat", "Blip Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.022, highpass: 10000, layers: 4, pitchSpread: 0.8 },
      chokeGroup: "hihat",
      defaultVolume: 0.68,
    }),
    ohat: piece("ohat", "Square Hat", {
      category: "hat",
      synth: { engine: "hat", decay: 0.2, highpass: 9000 },
      chokeGroup: "hihat",
    }),
    tomLow: piece("tomLow", "Pixel Tom", {
      category: "perc",
      synth: { engine: "tom", pitch: 52, decay: 0.18 },
      defaultPan: -0.4,
    }),
    tomHigh: piece("tomHigh", "Blip Tom", {
      category: "perc",
      synth: { engine: "tom", pitch: 72, decay: 0.12 },
      defaultPan: 0.4,
    }),
    crash: piece("crash", "8-Bit Crash", {
      category: "crash",
      synth: { engine: "crash", decay: 0.9 },
      defaultReverbSend: 0.2,
    }),
    fx: piece("fx", "Retro Blip", {
      category: "fx",
      synth: { engine: "fx", decay: 0.35, noise: "white", highpass: 4500 },
      defaultVolume: 0.6,
      defaultDelaySend: 0.35,
    }),
  },
};

export const DRUM_KITS: Record<DrumKitId, DrumKitDef> = {
  trap: TRAP,
  boombap: BOOMBAP,
  cyberpunk: CYBERPUNK,
  lofi: LOFI,
  cinematic: CINEMATIC,
  demontruck: DEMONTRUCK,
  neondojo: NEONDOJO,
  garageband: GARAGEBAND,
  southerndirt: SOUTHERNDIRT,
  cybertrap: CYBERTRAP,
  arcadeghosts: ARCADEGHOSTS,
};

export const DRUM_KIT_LIST: DrumKitDef[] = [
  TRAP,
  BOOMBAP,
  CYBERPUNK,
  LOFI,
  CINEMATIC,
  DEMONTRUCK,
  NEONDOJO,
  GARAGEBAND,
  SOUTHERNDIRT,
  CYBERTRAP,
  ARCADEGHOSTS,
];

// ---------------- Voice construction ----------------

/**
 * Per-piece voice with its own channel/filter/sends so per-piece mixer
 * fields can mutate them at runtime without rebuilding. Round-robin
 * pool depth comes from the recipe; velocity layers are simulated by
 * varying pitch/decay slightly across "soft/mid/hard" bands.
 */
export interface PieceVoice {
  piece: DrumPiece;
  def: DrumPieceDef;
  channel: Tone.Channel;
  filter: Tone.Filter;
  gate: Tone.AmplitudeEnvelope;
  reverbSend: Tone.Gain;
  delaySend: Tone.Gain;
  /** User pitch override in semitones, applied to the pool voices that
   *  carry tonal content (kick/snare/tom/hat). */
  pitchSemis: number;
  /** User decay multiplier 0..1 — gates the piece tail via the
   *  AmplitudeEnvelope; 1 = full natural decay, 0 = choked. */
  decayMul: number;
  /** Per-piece solo flag — interpreted by the kit when computing
   *  effective mute state across all pieces. */
  solo: boolean;
  trigger: (time: number, velocity: number) => void;
  chokeGroup?: string;
  /** Called by the kit when a sibling in the same choke group fires. */
  choke: (time: number) => void;
  dispose: () => void;
}

export interface KitVoice {
  id: DrumKitId;
  pieces: Map<DrumPiece, PieceVoice>;
  dispose: () => void;
}

/**
 * Build a kit voice. Caller supplies `output` (the per-track filter
 * input) and the shared `reverbBus` / `delayBus` for sends.
 *
 * The piece voice fans out:
 *   piece-synth -> filter -> channel ──> output (dry)
 *                                ├─> reverbSend gain ─> reverbBus
 *                                └─> delaySend gain ──> delayBus
 *
 * Without real reverb/delay buses connected, the send gains still
 * shape an internally-connected Reverb/Delay on the parent track via
 * the channel send mechanism handled in the engine.
 */
export function buildKit(
  def: DrumKitDef,
  output: Tone.InputNode,
  reverbBus: Tone.InputNode | null,
  delayBus: Tone.InputNode | null,
): KitVoice {
  const started = performance.now();
  firstPlayMark("instrument-factory:buildKit:start", {
    kitId: def.id,
    pieces: Object.keys(def.pieces).length,
  });
  const pieces = new Map<DrumPiece, PieceVoice>();
  for (const pieceId of Object.keys(def.pieces) as DrumPiece[]) {
    const pdef = def.pieces[pieceId];
    pieces.set(pieceId, buildPieceVoice(pdef, output, reverbBus, delayBus));
  }
  // Hook up choke wiring once all pieces exist.
  for (const pv of pieces.values()) {
    if (!pv.chokeGroup) continue;
    const siblings: PieceVoice[] = [];
    for (const other of pieces.values()) {
      if (other !== pv && other.chokeGroup === pv.chokeGroup) {
        siblings.push(other);
      }
    }
    const origTrigger = pv.trigger;
    pv.trigger = (time, velocity) => {
      for (const s of siblings) s.choke(time);
      origTrigger(time, velocity);
    };
  }
  const kit = {
    id: def.id,
    pieces,
    dispose: () => {
      for (const pv of pieces.values()) pv.dispose();
    },
  };
  firstPlayMeasure("instrument-factory:buildKit", started, performance.now(), {
    kitId: def.id,
    pieces: pieces.size,
  });
  return kit;
}

function buildPieceVoice(
  def: DrumPieceDef,
  output: Tone.InputNode,
  reverbBus: Tone.InputNode | null,
  delayBus: Tone.InputNode | null,
): PieceVoice {
  const started = performance.now();
  firstPlayMark("instrument-factory:buildPieceVoice:start", { piece: def.id });
  // Per-piece chain: pool -> filter -> gate -> channel -> output, plus sends.
  // The `gate` (AmplitudeEnvelope) is what gives the per-piece "decay"
  // knob audible effect: each hit re-triggers the envelope and its
  // release time is scaled by the user `decayMul` setting.
  firstPlayMark("audio-node:create", { kind: "piece-channel", piece: def.id });
  const channel = new Tone.Channel({ volume: 0, pan: def.defaultPan });
  firstPlayMark("effect-node:create", { kind: "piece-filter", piece: def.id });
  const filter = new Tone.Filter({
    frequency: cutoffNormToHz(def.defaultCutoff),
    type: "lowpass",
    rolloff: -12,
  });
  firstPlayMark("effect-node:create", { kind: "piece-gate", piece: def.id });
  const gate = new Tone.AmplitudeEnvelope({
    attack: 0.001,
    decay: 0.01,
    sustain: 1,
    release: 0.5,
  });
  filter.connect(gate);
  gate.connect(channel);
  channel.connect(output);

  firstPlayMark("audio-node:create", { kind: "piece-reverb-send", piece: def.id });
  const reverbSend = new Tone.Gain(def.defaultReverbSend);
  firstPlayMark("audio-node:create", { kind: "piece-delay-send", piece: def.id });
  const delaySend = new Tone.Gain(def.defaultDelaySend);
  channel.connect(reverbSend);
  channel.connect(delaySend);
  if (reverbBus) reverbSend.connect(reverbBus);
  if (delayBus) delaySend.connect(delayBus);

  // Build the round-robin synth pool. Each pool voice slightly varies its
  // params so successive hits exhibit a tiny tonal variation even without
  // real sample layers.
  const poolSize = Math.max(1, def.synth.layers ?? 3);
  const pool = Array.from({ length: poolSize }, (_, i) =>
    buildDrumSynth(def.synth, i, poolSize),
  );
  for (const v of pool) v.connect(filter);
  let rr = 0;

  // Natural per-piece decay seconds — used as the base for the gate's
  // release time. The user `decayMul` scales this to choke or extend.
  const naturalDecaySec = def.synth.decay ?? def.defaultDecay ?? 0.5;

  const pv: PieceVoice = {
    piece: def.id,
    def,
    channel,
    filter,
    gate,
    reverbSend,
    delaySend,
    pitchSemis: def.defaultPitch ?? 0,
    decayMul: 1,
    solo: false,
    chokeGroup: def.chokeGroup,
    trigger: () => {},
    choke: () => {},
    dispose: () => {
      for (const v of pool) v.dispose();
      filter.dispose();
      gate.dispose();
      channel.dispose();
      reverbSend.dispose();
      delaySend.dispose();
    },
  };
  firstPlayMeasure("instrument-factory:buildPieceVoice", started, performance.now(), {
    piece: def.id,
    poolSize,
  });

  // Default trigger uses the synth pool. If real samples become
  // available via the async resolver below, we swap to a sample-bank
  // trigger that honors velocity layers + round-robin selection.
  const triggerSynth = (time: number, velocity: number) => {
    const v = pool[rr];
    rr = (rr + 1) % pool.length;
    try {
      const layerIdx = velocity < 0.4 ? 0 : velocity < 0.75 ? 1 : 2;
      v.trigger(time, velocity, layerIdx, pv.pitchSemis);
      const rel = Math.max(0.03, naturalDecaySec * Math.max(0.05, pv.decayMul));
      gate.triggerAttackRelease(rel, time);
    } catch {
      // ignore
    }
  };

  pv.trigger = triggerSynth;

  pv.choke = (time: number) => {
    for (const v of pool) v.release(time);
    try {
      gate.triggerRelease(time);
    } catch {
      // ignore
    }
    if (sampleBank) sampleBank.release(time);
  };

  // Attempt to resolve real sample layers. When successful we replace
  // the trigger function so subsequent hits use the loaded samples.
  // Falls back silently to synth when no layers / no files / decode errors.
  let sampleBank: DrumSampleBank | null = null;
  let disposed = false;
  void tryLoadDrumSamples(def.layers, filter).then((bank) => {
    if (!bank) return;
    if (disposed) {
      bank.dispose();
      return;
    }
    sampleBank = bank;
    pv.trigger = (time, velocity) => {
      try {
        bank.trigger(time, velocity, pv.pitchSemis);
        const rel = Math.max(0.03, naturalDecaySec * Math.max(0.05, pv.decayMul));
        gate.triggerAttackRelease(rel, time);
      } catch {
        // ignore
      }
    };
  }).catch(() => {
    // Synth fallback stays active when a sample host or decoder fails.
  });

  const baseDispose = pv.dispose;
  pv.dispose = () => {
    if (disposed) return;
    disposed = true;
    pv.trigger = () => {};
    if (sampleBank) sampleBank.dispose();
    baseDispose();
  };

  return pv;
}

interface PoolVoice {
  trigger: (
    time: number,
    velocity: number,
    layer: number,
    pitchSemis?: number,
  ) => void;
  release: (time: number) => void;
  connect: (dest: Tone.InputNode) => void;
  dispose: () => void;
}

function buildDrumSynth(
  recipe: DrumSynthRecipe,
  index: number,
  total: number,
): PoolVoice {
  switch (recipe.engine) {
    case "kick":
      return makeKickVoice(recipe, index, total);
    case "snare":
      return makeSnareVoice(recipe, index, total);
    case "clap":
      return makeClapVoice(recipe, index, total);
    case "hat":
      return makeHatVoice(recipe, index, total);
    case "tom":
      return makeTomVoice(recipe, index, total);
    case "crash":
      return makeCrashVoice(recipe);
    case "fx":
      return makeFxVoice(recipe, index, total);
  }
}

function pitchToFreq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function cutoffNormToHz(norm: number) {
  const n = Math.max(0, Math.min(1, norm));
  // log-ish 80hz -> 20kHz
  return 80 * Math.pow(20000 / 80, n);
}

export { cutoffNormToHz };

function rrJitter(index: number, total: number, range: number) {
  if (total <= 1) return 0;
  const norm = index / (total - 1); // 0..1
  return (norm - 0.5) * 2 * range;
}

function makeKickVoice(
  r: DrumSynthRecipe,
  index: number,
  total: number,
): PoolVoice {
  const body = new Tone.MembraneSynth({
    pitchDecay: r.pitchDecay ?? 0.045,
    octaves: r.octaves ?? 5.5,
    envelope: {
      attack: 0.001,
      decay: r.decay ?? 0.5,
      sustain: 0,
      release: 0.4,
    },
    volume: r.bodyLevelDb ?? -3,
  });
  const click = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.018, release: 0.01 },
    harmonicity: 5.1,
    modulationIndex: 14,
    resonance: 5000,
    octaves: 0.5,
    volume: r.clickLevelDb ?? -26,
  });
  const drive =
    r.drive && r.drive > 0
      ? new Tone.Distortion({ distortion: r.drive, wet: 1 })
      : null;
  const out: Tone.ToneAudioNode = drive ?? body;
  if (drive) body.connect(drive);
  const lowpass = r.lowpass
    ? new Tone.Filter({ frequency: r.lowpass, type: "lowpass" })
    : null;
  const jitter = rrJitter(index, total, 1.0); // ±1 semitone across pool
  const basePitch = r.pitch ?? 36;
  return {
    trigger: (time, velocity, layer, pitchSemis = 0) => {
      const layerShift = layer === 0 ? -1 : layer === 2 ? +1 : 0;
      const note = Tone.Frequency(
        pitchToFreq(basePitch + jitter + layerShift + pitchSemis),
        "hz",
      ).toNote();
      body.triggerAttackRelease(note, "8n", time, velocity);
      click.triggerAttackRelease("32n", time, velocity * 0.6);
    },
    release: (time) => {
      try {
        body.triggerRelease(time);
      } catch {
        // ignore
      }
    },
    connect: (dest) => {
      if (lowpass) {
        out.connect(lowpass);
        lowpass.connect(dest);
      } else {
        out.connect(dest);
      }
      click.connect(dest);
    },
    dispose: () => {
      body.dispose();
      click.dispose();
      drive?.dispose();
      lowpass?.dispose();
    },
  };
}

function makeSnareVoice(
  r: DrumSynthRecipe,
  index: number,
  total: number,
): PoolVoice {
  const body = new Tone.MembraneSynth({
    pitchDecay: 0.02,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
    volume: r.bodyLevelDb ?? -14,
  });
  const noise = new Tone.NoiseSynth({
    noise: { type: r.noise ?? "white" },
    envelope: { attack: 0.001, decay: r.decay ?? 0.18, sustain: 0, release: 0.08 },
    volume: r.clickLevelDb ?? -10,
  });
  const hp = new Tone.Filter({
    type: "highpass",
    frequency: r.highpass ?? 1500,
    Q: 0.7,
  });
  const lp = r.lowpass
    ? new Tone.Filter({ type: "lowpass", frequency: r.lowpass })
    : null;
  const drive = r.drive
    ? new Tone.Distortion({ distortion: r.drive, wet: 1 })
    : null;
  noise.connect(hp);
  const jitter = rrJitter(index, total, 0.6);
  return {
    trigger: (time, velocity, layer, pitchSemis = 0) => {
      const layerShift = layer === 0 ? -0.5 : layer === 2 ? +0.5 : 0;
      const bodyNote = Tone.Frequency(
        pitchToFreq(50 + jitter + layerShift + pitchSemis),
        "hz",
      ).toNote();
      body.triggerAttackRelease(bodyNote, "32n", time, velocity * 0.7);
      noise.triggerAttackRelease("16n", time, velocity);
    },
    release: (time) => {
      try {
        body.triggerRelease(time);
      } catch {
        // ignore
      }
    },
    connect: (dest) => {
      let tail: Tone.ToneAudioNode = hp;
      if (lp) {
        tail.connect(lp);
        tail = lp;
      }
      if (drive) {
        tail.connect(drive);
        tail = drive;
      }
      tail.connect(dest);
      body.connect(dest);
    },
    dispose: () => {
      body.dispose();
      noise.dispose();
      hp.dispose();
      lp?.dispose();
      drive?.dispose();
    },
  };
}

function makeClapVoice(
  r: DrumSynthRecipe,
  _index: number,
  _total: number,
): PoolVoice {
  const noise = new Tone.NoiseSynth({
    noise: { type: r.noise ?? "white" },
    envelope: { attack: 0.001, decay: r.decay ?? 0.1, sustain: 0, release: 0.05 },
    volume: -12,
  });
  const bp = new Tone.Filter({
    type: "bandpass",
    frequency: r.highpass ?? 1500,
    Q: 1.4,
  });
  noise.connect(bp);
  return {
    trigger: (time, velocity, layer) => {
      const stagger = layer === 0 ? 0.018 : layer === 2 ? 0.009 : 0.012;
      noise.triggerAttackRelease("32n", time, velocity);
      noise.triggerAttackRelease("32n", time + stagger, velocity * 0.85);
      noise.triggerAttackRelease("16n", time + stagger * 2, velocity * 0.9);
    },
    release: () => {
      // noise envelopes decay quickly; nothing to release
    },
    connect: (dest) => {
      bp.connect(dest);
    },
    dispose: () => {
      noise.dispose();
      bp.dispose();
    },
  };
}

function makeHatVoice(
  r: DrumSynthRecipe,
  index: number,
  total: number,
): PoolVoice {
  const synth = new Tone.MetalSynth({
    envelope: {
      attack: 0.001,
      decay: r.decay ?? 0.06,
      release: Math.max(0.01, (r.decay ?? 0.06) * 0.5),
    },
    harmonicity: 8.5,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
    volume: -22,
  });
  const hp = new Tone.Filter({
    type: "highpass",
    frequency: r.highpass ?? 7000,
    Q: 0.6,
  });
  synth.connect(hp);
  const pitchJitter = rrJitter(index, total, r.pitchSpread ?? 0.3);
  return {
    trigger: (time, velocity, layer, pitchSemis = 0) => {
      const dur =
        (r.decay ?? 0.06) > 0.2 ? "8n" : layer === 0 ? "64n" : "32n";
      const note = Tone.Frequency(
        pitchToFreq(80 + pitchJitter + (layer - 1) * 0.4 + pitchSemis),
        "hz",
      ).toNote();
      synth.triggerAttackRelease(note, dur, time, velocity);
    },
    release: (time) => {
      try {
        synth.triggerRelease(time);
      } catch {
        // ignore
      }
    },
    connect: (dest) => {
      hp.connect(dest);
    },
    dispose: () => {
      synth.dispose();
      hp.dispose();
    },
  };
}

function makeTomVoice(
  r: DrumSynthRecipe,
  index: number,
  total: number,
): PoolVoice {
  const synth = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 3,
    envelope: {
      attack: 0.001,
      decay: r.decay ?? 0.3,
      sustain: 0,
      release: 0.3,
    },
    volume: -8,
  });
  const jitter = rrJitter(index, total, 0.5);
  const basePitch = r.pitch ?? 55;
  return {
    trigger: (time, velocity, layer, pitchSemis = 0) => {
      const layerShift = (layer - 1) * 0.4;
      const note = Tone.Frequency(
        pitchToFreq(basePitch + jitter + layerShift + pitchSemis),
        "hz",
      ).toNote();
      synth.triggerAttackRelease(note, "8n", time, velocity);
    },
    release: (time) => {
      try {
        synth.triggerRelease(time);
      } catch {
        // ignore
      }
    },
    connect: (dest) => {
      synth.connect(dest);
    },
    dispose: () => {
      synth.dispose();
    },
  };
}

function makeCrashVoice(r: DrumSynthRecipe): PoolVoice {
  const synth = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: r.decay ?? 1.4, release: 1.0 },
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
    release: (time) => {
      try {
        synth.triggerRelease(time);
      } catch {
        // ignore
      }
    },
    connect: (dest) => {
      synth.connect(dest);
    },
    dispose: () => {
      synth.dispose();
    },
  };
}

function makeFxVoice(
  r: DrumSynthRecipe,
  index: number,
  total: number,
): PoolVoice {
  const noise = new Tone.NoiseSynth({
    noise: { type: r.noise ?? "white" },
    envelope: { attack: 0.02, decay: r.decay ?? 0.5, sustain: 0, release: 0.2 },
    volume: -16,
  });
  const hp = new Tone.Filter({
    type: "highpass",
    frequency: r.highpass ?? 800,
    Q: 0.7,
  });
  const lp = new Tone.Filter({
    type: "lowpass",
    frequency: 12000,
    Q: 0.5,
  });
  noise.chain(hp, lp);
  const jitter = rrJitter(index, total, 1.5);
  return {
    trigger: (time, velocity, layer) => {
      // Sweep the lowpass for an FX character; modulation depth varies per layer
      const lpEnd = 4000 + jitter * 600 + (layer + 1) * 1500;
      lp.frequency.cancelScheduledValues(time);
      lp.frequency.setValueAtTime(900, time);
      lp.frequency.linearRampToValueAtTime(lpEnd, time + 0.3);
      noise.triggerAttackRelease("2n", time, velocity);
    },
    release: () => {
      // noise envelope handles it
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

export function findKit(id: DrumKitId | undefined): DrumKitDef {
  return id ? (DRUM_KITS[id] ?? TRAP) : TRAP;
}
