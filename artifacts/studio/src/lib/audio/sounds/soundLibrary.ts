/**
 * Shotgun Ninjas Sound Library
 *
 * Defines the signature packs with metadata, cover art config,
 * associated kit/preset ids, and demo patterns.
 *
 * A "demo pattern" is a 16-step boolean grid per drum piece (index 0=beat 1,
 * 4=beat 2, 8=beat 3, 12=beat 4). Steps map to 1/16th notes.
 */

import type { DrumKitId } from "./types";
import type { DrumPiece } from "../voices";

export type PackCategory =
  | "Signature"
  | "808 & Bass"
  | "Lo-Fi"
  | "World"
  | "Cinematic"
  | "Live"
  | "Electronic"
  | "Retro";

export interface CoverArtConfig {
  /** Primary background color (CSS color). */
  bg: string;
  /** Accent / highlight color. */
  accent: string;
  /** Secondary accent or shadow color. */
  accent2: string;
  /** Visual theme token — drives shape rendering. */
  theme:
    | "ninja-shuriken"
    | "demon-truck"
    | "smoke-room"
    | "neon-dojo"
    | "trailer"
    | "garage"
    | "dirt"
    | "cyber"
    | "arcade";
}

/** A 16-step hit pattern for a single drum piece. */
export type StepGrid = boolean[];

export interface SoundPack {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: PackCategory;
  kitId: DrumKitId;
  /** Melodic preset id to apply to the first non-drum track (optional). */
  presetId?: string;
  coverArt: CoverArtConfig;
  /** 16-step demo grid keyed by drum piece id. */
  demoPattern: Partial<Record<DrumPiece, StepGrid>>;
  /** Beats per minute hint for the preview. */
  demoBpm?: number;
  /** Optional pitched phrase layered over the two-bar drum preview. */
  demoMelody?: Array<{
    step: number;
    note: string;
    lengthSteps: number;
    velocity?: number;
  }>;
  /** A compact composition challenge shown on the pack card. */
  creativePrompt?: string;
}

export const SOUND_PACKS: SoundPack[] = [
  // 1 ─────────────────────────────────────────────────────
  {
    id: "core-kit",
    name: "Shotgun Ninjas Core Kit",
    tagline: "The original sound. Built for ninjas.",
    description:
      "The flagship Shotgun Ninjas kit. Tight trap kick, crisp snare, fast closed hats, and a punchy vinyl FX hit. This is the sound the studio was built on.",
    category: "Signature",
    kitId: "trap",
    presetId: "bass.808",
    coverArt: {
      bg: "#0d0d0f",
      accent: "#f97316",
      accent2: "#fb923c",
      theme: "ninja-shuriken",
    },
    demoBpm: 140,
    demoPattern: {
      kick:    [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      hat:     [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1].map(Boolean),
      clap:    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      ohat:    [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0].map(Boolean),
    },
  },

  // 2 ─────────────────────────────────────────────────────
  {
    id: "demon-truck",
    name: "Demon Truck 808 Kit",
    tagline: "Rumble the road.",
    description:
      "Heavy sub-saturated 808 kick with a long, earth-shaking decay. Slow open hats and rumble bass FX designed to fill arenas and rattle car trunks.",
    category: "808 & Bass",
    kitId: "demontruck",
    presetId: "bass.808",
    coverArt: {
      bg: "#1a0a00",
      accent: "#dc2626",
      accent2: "#991b1b",
      theme: "demon-truck",
    },
    demoBpm: 130,
    demoPattern: {
      kick:    [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0].map(Boolean),
      snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      hat:     [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0].map(Boolean),
      ohat:    [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,1,0,0].map(Boolean),
      fx:      [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0].map(Boolean),
    },
  },

  // 3 ─────────────────────────────────────────────────────
  {
    id: "lofi-smoke-room",
    name: "Lo-Fi Smoke Room",
    tagline: "Hazy and golden.",
    description:
      "Dusty vinyl kick, rim snare filtered through warm tape, gently shuffled brushed hats, and a dust loop FX. Perfect for late-night chill sessions.",
    category: "Lo-Fi",
    kitId: "lofi",
    presetId: "keys.soft",
    coverArt: {
      bg: "#1c1408",
      accent: "#d97706",
      accent2: "#92400e",
      theme: "smoke-room",
    },
    demoBpm: 85,
    demoPattern: {
      kick:    [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0].map(Boolean),
      snare:   [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0].map(Boolean),
      hat:     [1,0,1,0, 1,0,1,0, 0,1,0,0, 1,0,1,0].map(Boolean),
      ohat:    [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0].map(Boolean),
      fx:      [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
    },
  },

  // 4 ─────────────────────────────────────────────────────
  {
    id: "neon-dojo",
    name: "Neon Dojo Percussion",
    tagline: "Precision in neon.",
    description:
      "Layered toms, metallic cymbals, and a tight groove that fuses East Asian percussion energy with neon-lit club precision. Every hit earns its place.",
    category: "World",
    kitId: "neondojo",
    presetId: "bell.mallet",
    coverArt: {
      bg: "#050a1a",
      accent: "#6366f1",
      accent2: "#4f46e5",
      theme: "neon-dojo",
    },
    demoBpm: 128,
    demoPattern: {
      kick:    [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0].map(Boolean),
      snare:   [0,0,0,0, 1,0,0,0, 0,0,0,1, 1,0,0,0].map(Boolean),
      hat:     [1,1,0,1, 1,1,0,1, 1,1,0,1, 1,1,0,1].map(Boolean),
      tomLow:  [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0].map(Boolean),
      tomHigh: [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0].map(Boolean),
      crash:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0].map(Boolean),
    },
  },

  // 5 ─────────────────────────────────────────────────────
  {
    id: "trailer-impact",
    name: "Trailer Impact Pack",
    tagline: "Built for the big moment.",
    description:
      "Cinematic sub-drops, epic taiko-style kicks, huge crash cymbals, and reverse FX risers. When the trailer needs to hit harder.",
    category: "Cinematic",
    kitId: "cinematic",
    presetId: "brass.cinematic",
    coverArt: {
      bg: "#0a0a0a",
      accent: "#64748b",
      accent2: "#94a3b8",
      theme: "trailer",
    },
    demoBpm: 90,
    demoPattern: {
      kick:    [1,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0].map(Boolean),
      snare:   [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0].map(Boolean),
      tomLow:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,1,0].map(Boolean),
      tomHigh: [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0].map(Boolean),
      crash:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1].map(Boolean),
      fx:      [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
    },
  },

  // 6 ─────────────────────────────────────────────────────
  {
    id: "garage-chaos",
    name: "Garage Band Chaos Kit",
    tagline: "Loud and unpolished.",
    description:
      "Overdriven snare that bleeds, a live room kick with real body, crash-heavy patterns, and that glorious looseness of a band that doesn't care about perfection.",
    category: "Live",
    kitId: "garageband",
    presetId: "guitar.crunch",
    coverArt: {
      bg: "#0f0f0f",
      accent: "#eab308",
      accent2: "#a16207",
      theme: "garage",
    },
    demoBpm: 118,
    demoPattern: {
      kick:    [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0].map(Boolean),
      snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,1,0].map(Boolean),
      hat:     [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0].map(Boolean),
      ohat:    [0,0,0,1, 0,0,0,0, 0,0,0,0, 0,0,0,0].map(Boolean),
      crash:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0].map(Boolean),
    },
  },

  // 7 ─────────────────────────────────────────────────────
  {
    id: "southern-dirt",
    name: "Southern Dirt Drum Kit",
    tagline: "Swamp-grown groove.",
    description:
      "A boomy kick with low-end thump, rimshot snare with southern character, brush-style hats with a mellow curtoff, and a dusty snap. Earthy and deep.",
    category: "Live",
    kitId: "southerndirt",
    presetId: "bass.finger",
    coverArt: {
      bg: "#0d0900",
      accent: "#78350f",
      accent2: "#92400e",
      theme: "dirt",
    },
    demoBpm: 95,
    demoPattern: {
      kick:    [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0].map(Boolean),
      snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      hat:     [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1].map(Boolean),
      ohat:    [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0].map(Boolean),
      tomLow:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0].map(Boolean),
    },
  },

  // 8 ─────────────────────────────────────────────────────
  {
    id: "cyber-trap",
    name: "Cyber Trap Essentials",
    tagline: "Future streets.",
    description:
      "Glitchy hi-hats with pitch variance, a distorted 808 kick with massive sub decay, pitch-shifted FX, and a digital snap snare. Where trap meets the machine.",
    category: "Electronic",
    kitId: "cybertrap",
    presetId: "bass.808",
    coverArt: {
      bg: "#000d1a",
      accent: "#06b6d4",
      accent2: "#0891b2",
      theme: "cyber",
    },
    demoBpm: 142,
    demoPattern: {
      kick:    [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      hat:     [1,1,0,1, 0,1,1,0, 1,1,0,1, 1,0,1,1].map(Boolean),
      ohat:    [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0].map(Boolean),
      fx:      [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0].map(Boolean),
    },
  },

  // 9 ─────────────────────────────────────────────────────
  {
    id: "arcade-ghosts",
    name: "Arcade Ghosts FX",
    tagline: "8-bit haunted.",
    description:
      "Chiptune-flavored hits, bitcrushed noise snare, retro blip FX, and square-wave character throughout. The ghost in the machine remembers when games were 8-bit.",
    category: "Retro",
    kitId: "arcadeghosts",
    presetId: "lead.gritty",
    coverArt: {
      bg: "#050010",
      accent: "#a855f7",
      accent2: "#7c3aed",
      theme: "arcade",
    },
    demoBpm: 150,
    demoPattern: {
      kick:    [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0].map(Boolean),
      snare:   [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,1,0].map(Boolean),
      hat:     [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0].map(Boolean),
      tomLow:  [0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0].map(Boolean),
      tomHigh: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1].map(Boolean),
      fx:      [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,0,0,0].map(Boolean),
    },
  },

  // 10 ────────────────────────────────────────────────────
  {
    id: "tape-alley",
    name: "Tape Alley Sessions",
    tagline: "Dust, pocket, and late-night keys.",
    description:
      "A compact lo-fi production pack pairing dusty drums with the offline Tape Upright preset for warm study beats and sample-free sketches.",
    category: "Lo-Fi",
    kitId: "lofi",
    presetId: "keys.tape-upright",
    coverArt: {
      bg: "#171008",
      accent: "#f59e0b",
      accent2: "#713f12",
      theme: "smoke-room",
    },
    demoBpm: 82,
    demoPattern: {
      kick:  [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0].map(Boolean),
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      hat:   [1,0,1,0, 1,0,0,1, 1,0,1,0, 0,1,0,1].map(Boolean),
      fx:    [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0].map(Boolean),
    },
  },

  // 11 ────────────────────────────────────────────────────
  {
    id: "subzero-drill",
    name: "Subzero Drill",
    tagline: "Cold hats. Controlled low end.",
    description:
      "A fast cyber-trap kit paired with the shorter Tactical 808 so dense slides stay powerful without smearing the entire mix.",
    category: "808 & Bass",
    kitId: "cybertrap",
    presetId: "bass.short-808",
    coverArt: {
      bg: "#020617",
      accent: "#38bdf8",
      accent2: "#1d4ed8",
      theme: "cyber",
    },
    demoBpm: 146,
    demoPattern: {
      kick:  [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,1].map(Boolean),
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      hat:   [1,1,0,1, 1,0,1,1, 1,1,0,1, 0,1,1,1].map(Boolean),
      ohat:  [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,1,0].map(Boolean),
    },
  },

  // 12 ────────────────────────────────────────────────────
  {
    id: "ronin-synthwave",
    name: "Ronin Synthwave",
    tagline: "Retro circuits under neon rain.",
    description:
      "Arcade percussion and the bright Arcade Pulse lead form a zero-download pack for retro hooks, trailers, and game-score sketches.",
    category: "Retro",
    kitId: "arcadeghosts",
    presetId: "lead.arcade-pulse",
    coverArt: {
      bg: "#120021",
      accent: "#f472b6",
      accent2: "#7e22ce",
      theme: "arcade",
    },
    demoBpm: 124,
    demoPattern: {
      kick:    [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0].map(Boolean),
      snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      hat:     [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0].map(Boolean),
      tomHigh: [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0].map(Boolean),
      fx:      [0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0].map(Boolean),
    },
  },

  // 13 ────────────────────────────────────────────────────
  {
    id: "temple-air",
    name: "Temple Air",
    tagline: "Space between every strike.",
    description:
      "Neon Dojo percussion meets the wide Neon Air pad for meditative intros, ambient transitions, and cinematic beds.",
    category: "World",
    kitId: "neondojo",
    presetId: "pad.neon-air",
    coverArt: {
      bg: "#07111f",
      accent: "#2dd4bf",
      accent2: "#4338ca",
      theme: "neon-dojo",
    },
    demoBpm: 96,
    demoPattern: {
      kick:    [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0].map(Boolean),
      snare:   [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0].map(Boolean),
      hat:     [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0].map(Boolean),
      tomLow:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      tomHigh: [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0].map(Boolean),
      crash:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0].map(Boolean),
    },
  },

  // 14 ────────────────────────────────────────────────────
  {
    id: "vcsl-neon-keys",
    name: "VCSL Neon Keys",
    tagline: "Digital glass over arcade steel.",
    description:
      "CC0 TX81Z piano zones paired with Arcade Ghosts drums for clear synthwave chords and sharp melodic answers.",
    category: "Retro",
    kitId: "arcadeghosts",
    presetId: "keys.vcsl-tx81z-piano",
    coverArt: {
      bg: "#10051f",
      accent: "#22d3ee",
      accent2: "#f472b6",
      theme: "arcade",
    },
    demoBpm: 118,
    creativePrompt: "Keep the left hand to two notes; let the top voice move and tell the story.",
    demoMelody: [
      { step: 0, note: "A3", lengthSteps: 4, velocity: 0.78 },
      { step: 0, note: "C4", lengthSteps: 4, velocity: 0.66 },
      { step: 4, note: "G3", lengthSteps: 4, velocity: 0.72 },
      { step: 4, note: "B3", lengthSteps: 4, velocity: 0.64 },
      { step: 8, note: "F3", lengthSteps: 4, velocity: 0.72 },
      { step: 8, note: "A3", lengthSteps: 4, velocity: 0.64 },
      { step: 12, note: "E3", lengthSteps: 4, velocity: 0.74 },
      { step: 12, note: "G3", lengthSteps: 4, velocity: 0.64 },
    ],
    demoPattern: {
      kick:  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0].map(Boolean),
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1].map(Boolean),
      fx:    [0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0].map(Boolean),
    },
  },

  // 15 ────────────────────────────────────────────────────
  {
    id: "vcsl-harp-temple",
    name: "VCSL Harp Temple",
    tagline: "Strings, air, and deliberate silence.",
    description:
      "Natural folk-harp samples and Neon Dojo percussion for reflective arpeggios, fantasy cues, and spacious hooks.",
    category: "World",
    kitId: "neondojo",
    presetId: "pluck.vcsl-folk-harp",
    coverArt: {
      bg: "#071410",
      accent: "#fbbf24",
      accent2: "#2dd4bf",
      theme: "neon-dojo",
    },
    demoBpm: 92,
    creativePrompt: "Repeat one arpeggio three times; change only its final note on the fourth.",
    demoMelody: [
      { step: 0, note: "D3", lengthSteps: 3 },
      { step: 2, note: "A3", lengthSteps: 3 },
      { step: 4, note: "D4", lengthSteps: 3 },
      { step: 6, note: "F4", lengthSteps: 4 },
      { step: 8, note: "C3", lengthSteps: 3 },
      { step: 10, note: "G3", lengthSteps: 3 },
      { step: 12, note: "C4", lengthSteps: 3 },
      { step: 14, note: "E4", lengthSteps: 4 },
    ],
    demoPattern: {
      kick:    [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0].map(Boolean),
      snare:   [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0].map(Boolean),
      hat:     [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0].map(Boolean),
      tomLow:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
    },
  },

  // 16 ────────────────────────────────────────────────────
  {
    id: "vcsl-midnight-vibes",
    name: "VCSL Midnight Vibes",
    tagline: "Mallet light through a smoke-room pocket.",
    description:
      "Hard-mallet vibraphone and lo-fi drums for late-night harmony, jazz fragments, and warm sample-style loops.",
    category: "Lo-Fi",
    kitId: "lofi",
    presetId: "bell.vcsl-vibraphone",
    coverArt: {
      bg: "#100f16",
      accent: "#a78bfa",
      accent2: "#f59e0b",
      theme: "smoke-room",
    },
    demoBpm: 84,
    creativePrompt: "Put chords behind the snare, not on every downbeat, and let the metal tails become glue.",
    demoMelody: [
      { step: 2, note: "C4", lengthSteps: 5, velocity: 0.7 },
      { step: 2, note: "E4", lengthSteps: 5, velocity: 0.62 },
      { step: 6, note: "B3", lengthSteps: 5, velocity: 0.7 },
      { step: 6, note: "D4", lengthSteps: 5, velocity: 0.62 },
      { step: 10, note: "A3", lengthSteps: 5, velocity: 0.7 },
      { step: 10, note: "C4", lengthSteps: 5, velocity: 0.62 },
      { step: 14, note: "G3", lengthSteps: 5, velocity: 0.72 },
      { step: 14, note: "B3", lengthSteps: 5, velocity: 0.64 },
    ],
    demoPattern: {
      kick:  [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,1, 1,0,0,0].map(Boolean),
      hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0].map(Boolean),
      tomHigh: [0,0,0,1, 0,0,0,0, 0,1,0,0, 0,0,0,1].map(Boolean),
    },
  },

  // 17 ────────────────────────────────────────────────────
  {
    id: "vcsl-kalimba-circuit",
    name: "VCSL Kalimba Circuit",
    tagline: "Thumb steel inside a neon pulse.",
    description:
      "Tanzanian kalimba samples against Cyber Trap drums for interlocking ostinatos and bright rhythmic counterpoint.",
    category: "Electronic",
    kitId: "cybertrap",
    presetId: "bell.vcsl-tanzanian-kalimba",
    coverArt: {
      bg: "#07130f",
      accent: "#4ade80",
      accent2: "#22d3ee",
      theme: "cyber",
    },
    demoBpm: 112,
    creativePrompt: "Loop three notes over four beats; accents will keep shifting even when the pitches stay fixed.",
    demoMelody: [
      { step: 0, note: "C#4", lengthSteps: 2 },
      { step: 3, note: "E4", lengthSteps: 2 },
      { step: 6, note: "G#4", lengthSteps: 2 },
      { step: 9, note: "C#4", lengthSteps: 2 },
      { step: 12, note: "E4", lengthSteps: 2 },
      { step: 15, note: "G#4", lengthSteps: 2 },
    ],
    demoPattern: {
      kick:  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0].map(Boolean),
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      hat:   [1,1,0,1, 1,0,1,1, 1,1,0,1, 1,0,1,1].map(Boolean),
      fx:    [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1].map(Boolean),
    },
  },

  // 18 ────────────────────────────────────────────────────
  {
    id: "vcsl-ocarina-horizon",
    name: "VCSL Ocarina Horizon",
    tagline: "One breath across a wide frame.",
    description:
      "Organic ocarina sustains over cinematic percussion for game cues, meditative leads, and memorable call-and-response.",
    category: "Cinematic",
    kitId: "cinematic",
    presetId: "lead.vcsl-ocarina",
    coverArt: {
      bg: "#07121e",
      accent: "#7dd3fc",
      accent2: "#c084fc",
      theme: "trailer",
    },
    demoBpm: 76,
    creativePrompt: "Treat silence as a note: leave room after every phrase for the listener to answer internally.",
    demoMelody: [
      { step: 0, note: "A3", lengthSteps: 5, velocity: 0.72 },
      { step: 5, note: "C4", lengthSteps: 3, velocity: 0.68 },
      { step: 9, note: "E4", lengthSteps: 5, velocity: 0.76 },
      { step: 16, note: "C4", lengthSteps: 4, velocity: 0.7 },
      { step: 21, note: "A3", lengthSteps: 3, velocity: 0.66 },
      { step: 25, note: "G3", lengthSteps: 6, velocity: 0.72 },
    ],
    demoPattern: {
      kick:    [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0].map(Boolean),
      snare:   [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0].map(Boolean),
      tomLow:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,1,0].map(Boolean),
      crash:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0].map(Boolean),
    },
  },

  // 19 ────────────────────────────────────────────────────
  {
    id: "vcsl-tenor-alley",
    name: "VCSL Tenor Alley",
    tagline: "Reed bite against live-room grit.",
    description:
      "Tenor sax staccatos and Garage Band drums for punchy horn answers, breakbeat sketches, and raw funk punctuation.",
    category: "Live",
    kitId: "garageband",
    presetId: "brass.vcsl-tenor-sax-stabs",
    coverArt: {
      bg: "#170d08",
      accent: "#fb923c",
      accent2: "#facc15",
      theme: "garage",
    },
    demoBpm: 106,
    creativePrompt: "Answer the snare with two short notes; vary the second pitch while keeping the rhythm recognizable.",
    demoMelody: [
      { step: 5, note: "C3", lengthSteps: 2, velocity: 0.82 },
      { step: 7, note: "F3", lengthSteps: 2, velocity: 0.72 },
      { step: 13, note: "C3", lengthSteps: 2, velocity: 0.84 },
      { step: 15, note: "G3", lengthSteps: 2, velocity: 0.76 },
      { step: 21, note: "C3", lengthSteps: 2, velocity: 0.82 },
      { step: 23, note: "F3", lengthSteps: 2, velocity: 0.72 },
      { step: 29, note: "A#2", lengthSteps: 2, velocity: 0.84 },
      { step: 31, note: "C3", lengthSteps: 2, velocity: 0.78 },
    ],
    demoPattern: {
      kick:  [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,1].map(Boolean),
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,1,0,1].map(Boolean),
      clap:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
    },
  },
];

export const SOUND_PACK_CATEGORIES: PackCategory[] = [
  "Signature",
  "808 & Bass",
  "Lo-Fi",
  "World",
  "Cinematic",
  "Live",
  "Electronic",
  "Retro",
];

export function findSoundPack(id: string | undefined): SoundPack | null {
  if (!id) return null;
  return SOUND_PACKS.find((p) => p.id === id) ?? null;
}
