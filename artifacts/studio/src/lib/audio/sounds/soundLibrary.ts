/**
 * Shotgun Ninjas Sound Library
 *
 * Defines the 9 signature packs with metadata, cover art config,
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
