import type { ThemeDef } from "./themes";

export type VisualizerVariant =
  | "shuriken"
  | "sparks"
  | "rain"
  | "smoke"
  | "circuit"
  | "scanline";

export interface WelcomeSynthDesc {
  type:
    | "percussive-strike"
    | "low-rumble"
    | "arpeggio"
    | "chord-stab"
    | "deep-gong"
    | "8bit-jingle";
  freq: number;
  duration: number;
}

export interface StudioWorld extends ThemeDef {
  kitId: string;
  demoId: string;
  visualizerVariant: VisualizerVariant;
  welcomeSynth: WelcomeSynthDesc;
  tagline: string;
  lore: string;
  swatchColors: string[];
}

export type WorldId =
  | "dojo-dark"
  | "demon-truck-garage"
  | "neon-rooftop"
  | "lofi-smoke-room"
  | "cyber-temple"
  | "arcade-alley";

export const WORLDS: StudioWorld[] = [
  {
    id: "dojo-dark",
    name: "Dojo Dark",
    tagline: "Where ninjas make beats.",
    description: "Default cyber-ninja control-room. Black, red, electric blue.",
    lore: "The original. A shadow dojo buried beneath the neon city — forged in silence, tempered in fire. Every beat here is a weapon.",
    kitId: "cyberpunk",
    demoId: "cyber-ninja",
    visualizerVariant: "shuriken",
    welcomeSynth: { type: "percussive-strike", freq: 180, duration: 1.2 },
    swatchColors: ["#0d0d0d", "#c0392b", "#00b4d8"],
    vars: {
      "--background": "0 0% 5%",
      "--foreground": "0 0% 96%",
      "--graphite": "0 0% 9%",
      "--graphite-2": "0 0% 13%",
      "--blood": "0 78% 48%",
      "--neon": "195 100% 55%",
      "--card": "0 0% 8%",
      "--card-foreground": "0 0% 96%",
      "--popover": "0 0% 7%",
      "--popover-foreground": "0 0% 96%",
      "--primary": "0 78% 48%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "0 0% 14%",
      "--secondary-foreground": "0 0% 96%",
      "--muted": "0 0% 12%",
      "--muted-foreground": "0 0% 62%",
      "--accent": "0 0% 16%",
      "--accent-foreground": "0 0% 96%",
      "--destructive": "0 78% 48%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "0 0% 16%",
      "--input": "0 0% 16%",
      "--ring": "0 78% 48%",
    },
  },
  {
    id: "demon-truck-garage",
    name: "Demon Truck Garage",
    tagline: "Heavy iron. Heavier bass.",
    description: "Industrial rust/orange palette, gritty concrete texture.",
    lore: "Somewhere past the edge of town there's a garage that never closes. The floor shakes. The lights flicker. The 808 never stops.",
    kitId: "demontruck",
    demoId: "trap-starter",
    visualizerVariant: "sparks",
    welcomeSynth: { type: "low-rumble", freq: 55, duration: 1.8 },
    swatchColors: ["#1a0f00", "#d4510a", "#8b8680"],
    vars: {
      "--background": "20 15% 5%",
      "--foreground": "25 20% 92%",
      "--graphite": "22 15% 9%",
      "--graphite-2": "22 15% 13%",
      "--blood": "20 90% 48%",
      "--neon": "35 85% 55%",
      "--card": "22 14% 8%",
      "--card-foreground": "25 20% 92%",
      "--popover": "22 14% 7%",
      "--popover-foreground": "25 20% 92%",
      "--primary": "20 90% 48%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "22 14% 15%",
      "--secondary-foreground": "25 20% 92%",
      "--muted": "22 14% 13%",
      "--muted-foreground": "25 12% 60%",
      "--accent": "22 14% 18%",
      "--accent-foreground": "25 20% 92%",
      "--destructive": "0 70% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "22 14% 20%",
      "--input": "22 14% 20%",
      "--ring": "20 90% 48%",
    },
  },
  {
    id: "neon-rooftop",
    name: "Neon Rooftop",
    tagline: "Rain-soaked skylines. Electric vibes.",
    description: "Electric cyan/magenta city-at-night palette, rain particles.",
    lore: "Thirty floors up, the city hums below you. Rain streaks the glass. Synths cut through the static. This is your stage.",
    kitId: "neondojo",
    demoId: "cyber-ninja",
    visualizerVariant: "rain",
    welcomeSynth: { type: "arpeggio", freq: 660, duration: 1.0 },
    swatchColors: ["#040c18", "#00f5ff", "#ff00cc"],
    vars: {
      "--background": "210 35% 4%",
      "--foreground": "190 20% 96%",
      "--graphite": "215 30% 8%",
      "--graphite-2": "215 28% 12%",
      "--blood": "300 90% 55%",
      "--neon": "185 100% 60%",
      "--card": "215 28% 7%",
      "--card-foreground": "190 20% 96%",
      "--popover": "215 28% 6%",
      "--popover-foreground": "190 20% 96%",
      "--primary": "300 90% 55%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "215 25% 14%",
      "--secondary-foreground": "190 20% 96%",
      "--muted": "215 25% 12%",
      "--muted-foreground": "200 15% 65%",
      "--accent": "215 25% 17%",
      "--accent-foreground": "190 20% 96%",
      "--destructive": "0 80% 55%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "215 25% 18%",
      "--input": "215 25% 18%",
      "--ring": "300 90% 55%",
    },
  },
  {
    id: "lofi-smoke-room",
    name: "Lo-Fi Smoke Room",
    tagline: "Slow it down. Feel the warmth.",
    description: "Warm amber/sepia palette, drifting smoke particles.",
    lore: "Amber light through the blinds. A record crackles. The smoke hangs low and heavy. Nothing is rushed here — let the groove breathe.",
    kitId: "lofi",
    demoId: "lofi-smoke-loop",
    visualizerVariant: "smoke",
    welcomeSynth: { type: "chord-stab", freq: 220, duration: 1.5 },
    swatchColors: ["#140c04", "#c97c2a", "#6e5a3d"],
    vars: {
      "--background": "30 12% 5%",
      "--foreground": "30 20% 92%",
      "--graphite": "28 12% 9%",
      "--graphite-2": "28 12% 13%",
      "--blood": "25 85% 50%",
      "--neon": "42 88% 62%",
      "--card": "28 12% 8%",
      "--card-foreground": "30 20% 92%",
      "--popover": "28 12% 7%",
      "--popover-foreground": "30 20% 92%",
      "--primary": "25 85% 50%",
      "--primary-foreground": "30 10% 10%",
      "--secondary": "28 12% 16%",
      "--secondary-foreground": "30 20% 92%",
      "--muted": "28 12% 14%",
      "--muted-foreground": "30 15% 62%",
      "--accent": "28 12% 19%",
      "--accent-foreground": "30 20% 92%",
      "--destructive": "0 70% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "28 12% 21%",
      "--input": "28 12% 21%",
      "--ring": "25 85% 50%",
    },
  },
  {
    id: "cyber-temple",
    name: "Cyber Temple",
    tagline: "Ancient circuits. Infinite resonance.",
    description: "Deep violet/gold palette, pulsing circuit-grid background.",
    lore: "This place predates the city by centuries — or maybe it post-dates it. Time collapses here. The circuit hums like a prayer.",
    kitId: "cinematic",
    demoId: "cinematic-trailer-hit",
    visualizerVariant: "circuit",
    welcomeSynth: { type: "deep-gong", freq: 80, duration: 2.0 },
    swatchColors: ["#08050f", "#7b2fff", "#d4a017"],
    vars: {
      "--background": "270 25% 4%",
      "--foreground": "270 10% 96%",
      "--graphite": "270 22% 8%",
      "--graphite-2": "270 20% 12%",
      "--blood": "270 80% 58%",
      "--neon": "48 90% 58%",
      "--card": "270 20% 7%",
      "--card-foreground": "270 10% 96%",
      "--popover": "270 20% 6%",
      "--popover-foreground": "270 10% 96%",
      "--primary": "270 80% 58%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "270 18% 14%",
      "--secondary-foreground": "270 10% 96%",
      "--muted": "270 18% 12%",
      "--muted-foreground": "270 10% 65%",
      "--accent": "270 18% 17%",
      "--accent-foreground": "270 10% 96%",
      "--destructive": "0 80% 55%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "270 18% 20%",
      "--input": "270 18% 20%",
      "--ring": "270 80% 58%",
    },
  },
  {
    id: "arcade-alley",
    name: "Arcade Alley",
    tagline: "Insert coin. Press play.",
    description: "Pixel-green/yellow palette, CRT scanline background.",
    lore: "The machines never close here. Pixels bloom across the screen. Every beat is a high score waiting to happen — game on.",
    kitId: "trap",
    demoId: "808-bass-test",
    visualizerVariant: "scanline",
    welcomeSynth: { type: "8bit-jingle", freq: 880, duration: 0.8 },
    swatchColors: ["#020a02", "#00ff41", "#ffff00"],
    vars: {
      "--background": "120 30% 3%",
      "--foreground": "120 40% 92%",
      "--graphite": "120 25% 7%",
      "--graphite-2": "120 22% 11%",
      "--blood": "120 100% 48%",
      "--neon": "60 100% 55%",
      "--card": "120 22% 6%",
      "--card-foreground": "120 40% 92%",
      "--popover": "120 22% 5%",
      "--popover-foreground": "120 40% 92%",
      "--primary": "120 100% 48%",
      "--primary-foreground": "120 30% 5%",
      "--secondary": "120 20% 13%",
      "--secondary-foreground": "120 40% 92%",
      "--muted": "120 20% 11%",
      "--muted-foreground": "120 20% 62%",
      "--accent": "120 20% 16%",
      "--accent-foreground": "120 40% 92%",
      "--destructive": "0 80% 55%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "120 20% 18%",
      "--input": "120 20% 18%",
      "--ring": "120 100% 48%",
    },
  },
];

const WORLD_STORAGE_KEY = "studio.world";
const WORLD_PREFS_STORAGE_KEY = "studio.worldPrefs";

export interface WorldPrefs {
  kitId?: string;
  bpm?: number;
}

export function getStoredWorldId(): WorldId {
  if (typeof localStorage === "undefined") return "dojo-dark";
  const v = localStorage.getItem(WORLD_STORAGE_KEY);
  if (v && WORLDS.some((w) => w.id === v)) return v as WorldId;
  return "dojo-dark";
}

export function findWorld(id: string): StudioWorld | undefined {
  return WORLDS.find((w) => w.id === id);
}

export function applyWorldTheme(world: StudioWorld) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(world.vars)) {
    root.style.setProperty(k, v);
  }
  root.setAttribute("data-theme", world.id);
  try {
    localStorage.setItem(WORLD_STORAGE_KEY, world.id);
  } catch {
    /* quota */
  }
}

function loadAllWorldPrefs(): Record<string, WorldPrefs> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(WORLD_PREFS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, WorldPrefs>) : {};
  } catch {
    return {};
  }
}

function saveAllWorldPrefs(all: Record<string, WorldPrefs>) {
  try {
    localStorage.setItem(WORLD_PREFS_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota */
  }
}

export function getWorldPrefs(worldId: string): WorldPrefs | undefined {
  return loadAllWorldPrefs()[worldId];
}

export function saveWorldPrefs(worldId: string, prefs: WorldPrefs) {
  const all = loadAllWorldPrefs();
  all[worldId] = prefs;
  saveAllWorldPrefs(all);
}

export function resetWorldPrefs(worldId: string) {
  const all = loadAllWorldPrefs();
  delete all[worldId];
  saveAllWorldPrefs(all);
}
