import type {
  FxRack,
  MasterBusSettings,
  MixPresetId,
  Project,
  SendBusId,
  Track,
  TrackEq,
  TrackSends,
} from "../../types";
import { DEFAULT_MASTER_BUS } from "./master";

/**
 * Mix presets — pure functions that take a `Project` and return a
 * shallow-cloned `Project` with mixer fields (per-track eq/sends/fxRack
 * and the master bus) populated. Tracks' note/audio clips, kit/preset
 * selections, and arrangement metadata are preserved unchanged.
 *
 * Six built-in presets ship: Clean, Punchy, Loud Demo, Lo-Fi Dust,
 * Dark Cinematic, Wide Neon.
 */

export interface MixPresetDef {
  id: MixPresetId;
  name: string;
  description: string;
  apply: (project: Project) => Project;
}

const flatEq = (): TrackEq => ({
  low: 0,
  mid: 0,
  high: 0,
  hpfOn: false,
  hpfHz: 80,
});

const zeroSends = (): TrackSends => ({
  roomReverb: 0,
  neonHall: 0,
  tapeDelay: 0,
  darkSlapback: 0,
});

function sendsFor(
  kind: Track["kind"],
  map: Partial<Record<Track["kind"], Partial<TrackSends>>>,
): TrackSends {
  return { ...zeroSends(), ...(map[kind] ?? {}) };
}

function mapTracks(
  project: Project,
  fn: (t: Track) => Track,
): Track[] {
  return project.tracks.map(fn);
}

function makePreset(
  id: MixPresetId,
  name: string,
  description: string,
  build: (track: Track) => Partial<Track>,
  master: MasterBusSettings,
): MixPresetDef {
  return {
    id,
    name,
    description,
    apply: (project: Project): Project => ({
      ...project,
      tracks: mapTracks(project, (t) => ({ ...t, ...build(t) })),
      masterBus: master,
      mixPresetId: id,
      updatedAt: Date.now(),
    }),
  };
}

// ---------- CLEAN ----------
const CLEAN: MixPresetDef = makePreset(
  "clean",
  "Clean",
  "Transparent reference mix — flat EQ, tiny room, gentle glue.",
  (t) => ({
    eq: flatEq(),
    sends: sendsFor(t.kind, {
      vocals: { roomReverb: 0.18 },
      drums: { roomReverb: 0.08 },
      piano: { roomReverb: 0.12 },
      guitar: { roomReverb: 0.12 },
      bass: {},
    }),
    fxRack: {
      eq: { enabled: false },
      compressor: { enabled: false },
      saturation: { enabled: false },
      delay: { enabled: false },
      reverb: { enabled: false },
      chorus: { enabled: false },
      bitcrusher: { enabled: false },
      stereoWidth: { enabled: t.kind !== "bass", amount: 0.5 },
    },
  }),
  {
    ...DEFAULT_MASTER_BUS,
    glueEnabled: true,
    glueThresholdDb: -16,
    glueRatio: 1.6,
    softClip: false,
    width: 1,
    limiterThresholdDb: -1,
    limiterGainDb: 0,
  },
);

// ---------- PUNCHY ----------
const PUNCHY: MixPresetDef = makePreset(
  "punchy",
  "Punchy",
  "Snappy drums, tight bass, vocal slap — modern radio energy.",
  (t) => {
    const eq = flatEq();
    if (t.kind === "drums") {
      eq.low = 2;
      eq.high = 2.5;
      eq.hpfOn = true;
      eq.hpfHz = 35;
    } else if (t.kind === "bass") {
      eq.low = 1.5;
      eq.mid = -1;
      eq.hpfOn = true;
      eq.hpfHz = 45;
    } else if (t.kind === "vocals") {
      eq.high = 2;
      eq.hpfOn = true;
      eq.hpfHz = 110;
    } else {
      eq.high = 1;
      eq.hpfOn = true;
      eq.hpfHz = 90;
    }
    return {
      eq,
      sends: sendsFor(t.kind, {
        drums: { roomReverb: 0.18, darkSlapback: 0.1 },
        vocals: { roomReverb: 0.22, darkSlapback: 0.18 },
        guitar: { roomReverb: 0.15, tapeDelay: 0.1 },
        piano: { roomReverb: 0.18 },
        bass: {},
      }),
      fxRack: {
        eq: { enabled: true },
        compressor: {
          enabled: t.kind === "drums" || t.kind === "vocals",
          amount: 0.6,
          params: { threshold: 0.55, ratio: 0.5 },
        },
        saturation: {
          enabled: t.kind === "drums" || t.kind === "bass",
          amount: 0.25,
        },
        stereoWidth: { enabled: t.kind !== "bass", amount: 0.55 },
        delay: { enabled: false },
        reverb: { enabled: false },
        chorus: { enabled: false },
        bitcrusher: { enabled: false },
      },
    };
  },
  {
    ...DEFAULT_MASTER_BUS,
    glueEnabled: true,
    glueThresholdDb: -12,
    glueRatio: 2.4,
    glueAttack: 0.012,
    glueRelease: 0.16,
    softClip: true,
    width: 1.1,
    limiterThresholdDb: -0.6,
    limiterGainDb: 1,
  },
);

// ---------- LOUD DEMO ----------
const LOUD_DEMO: MixPresetDef = makePreset(
  "loudDemo",
  "Loud Demo",
  "Maximum loudness — heavy glue, soft-clip, hot limiter.",
  (t) => ({
    eq: { ...flatEq(), high: t.kind === "vocals" ? 2.5 : 1.5, hpfOn: true, hpfHz: t.kind === "bass" ? 40 : 80 },
    sends: sendsFor(t.kind, {
      vocals: { darkSlapback: 0.22, roomReverb: 0.15 },
      drums: { roomReverb: 0.1 },
      guitar: { tapeDelay: 0.12 },
      piano: { roomReverb: 0.12 },
      bass: {},
    }),
    fxRack: {
      eq: { enabled: true },
      compressor: { enabled: true, amount: 0.75, params: { threshold: 0.45, ratio: 0.7 } },
      saturation: { enabled: true, amount: 0.35 },
      stereoWidth: { enabled: t.kind !== "bass", amount: 0.55 },
      delay: { enabled: false },
      reverb: { enabled: false },
      chorus: { enabled: false },
      bitcrusher: { enabled: false },
    },
  }),
  {
    ...DEFAULT_MASTER_BUS,
    glueEnabled: true,
    glueThresholdDb: -10,
    glueRatio: 3,
    glueAttack: 0.008,
    glueRelease: 0.14,
    softClip: true,
    width: 1,
    limiterThresholdDb: -0.3,
    limiterGainDb: 2,
  },
);

// ---------- LO-FI DUST ----------
const LOFI_DUST: MixPresetDef = makePreset(
  "lofiDust",
  "Lo-Fi Dust",
  "Warm, dusty, narrow — bitcrush and tape, cozy room.",
  (t) => {
    const eq = flatEq();
    eq.high = -3;
    eq.low = t.kind === "bass" ? 1 : 0;
    eq.hpfOn = t.kind !== "bass";
    eq.hpfHz = 60;
    return {
      eq,
      sends: sendsFor(t.kind, {
        vocals: { roomReverb: 0.3, tapeDelay: 0.18 },
        drums: { roomReverb: 0.18 },
        guitar: { tapeDelay: 0.25, roomReverb: 0.15 },
        piano: { roomReverb: 0.22, tapeDelay: 0.12 },
        bass: {},
      }),
      fxRack: {
        eq: { enabled: true },
        bitcrusher: { enabled: t.kind !== "bass", amount: 0.35, params: { bits: 0.5 } },
        saturation: { enabled: true, amount: 0.4 },
        chorus: { enabled: t.kind === "piano" || t.kind === "guitar", amount: 0.3 },
        stereoWidth: { enabled: t.kind !== "bass", amount: 0.4 },
        compressor: { enabled: false },
        delay: { enabled: false },
        reverb: { enabled: false },
      },
    };
  },
  {
    ...DEFAULT_MASTER_BUS,
    glueEnabled: true,
    glueThresholdDb: -18,
    glueRatio: 2,
    softClip: true,
    width: 0.7,
    limiterThresholdDb: -1.2,
    limiterGainDb: -1,
  },
);

// ---------- DARK CINEMATIC ----------
const DARK_CINEMATIC: MixPresetDef = makePreset(
  "darkCinematic",
  "Dark Cinematic",
  "Big hall, low end, dramatic dynamics — score-ready.",
  (t) => {
    const eq = flatEq();
    eq.high = -1;
    eq.low = t.kind === "drums" || t.kind === "bass" ? 3 : 0;
    eq.hpfOn = t.kind === "vocals" || t.kind === "guitar";
    eq.hpfHz = 70;
    return {
      eq,
      sends: sendsFor(t.kind, {
        vocals: { neonHall: 0.4, darkSlapback: 0.2 },
        drums: { neonHall: 0.35, roomReverb: 0.15 },
        guitar: { neonHall: 0.4, tapeDelay: 0.2 },
        piano: { neonHall: 0.45 },
        bass: { neonHall: 0.15 },
      }),
      fxRack: {
        eq: { enabled: true },
        compressor: { enabled: t.kind === "drums" || t.kind === "vocals", amount: 0.5 },
        saturation: { enabled: t.kind === "drums" || t.kind === "bass", amount: 0.2 },
        reverb: { enabled: false },
        delay: { enabled: false },
        chorus: { enabled: false },
        bitcrusher: { enabled: false },
        stereoWidth: { enabled: true, amount: 0.7 },
      },
    };
  },
  {
    ...DEFAULT_MASTER_BUS,
    glueEnabled: true,
    glueThresholdDb: -16,
    glueRatio: 2.2,
    glueAttack: 0.04,
    glueRelease: 0.3,
    softClip: false,
    width: 1.4,
    limiterThresholdDb: -1.5,
    limiterGainDb: 0,
  },
);

// ---------- WIDE NEON ----------
const WIDE_NEON: MixPresetDef = makePreset(
  "wideNeon",
  "Wide Neon",
  "Spacious synthwave — chorused pads, tape delay, lush hall.",
  (t) => {
    const eq = flatEq();
    eq.high = 2;
    eq.mid = -1;
    eq.hpfOn = t.kind !== "bass";
    eq.hpfHz = t.kind === "bass" ? 30 : 80;
    return {
      eq,
      sends: sendsFor(t.kind, {
        vocals: { neonHall: 0.3, tapeDelay: 0.28 },
        drums: { roomReverb: 0.1, darkSlapback: 0.12 },
        guitar: { neonHall: 0.3, tapeDelay: 0.35 },
        piano: { neonHall: 0.4, tapeDelay: 0.25 },
        bass: { darkSlapback: 0.05 },
      }),
      fxRack: {
        eq: { enabled: true },
        chorus: { enabled: t.kind !== "drums" && t.kind !== "bass", amount: 0.55 },
        stereoWidth: { enabled: t.kind !== "bass", amount: 0.85 },
        saturation: { enabled: t.kind === "drums", amount: 0.2 },
        compressor: { enabled: false },
        delay: { enabled: false },
        reverb: { enabled: false },
        bitcrusher: { enabled: false },
      },
    };
  },
  {
    ...DEFAULT_MASTER_BUS,
    glueEnabled: true,
    glueThresholdDb: -14,
    glueRatio: 2,
    softClip: false,
    width: 1.6,
    limiterThresholdDb: -0.8,
    limiterGainDb: 0,
  },
);

export const MIX_PRESETS: MixPresetDef[] = [
  CLEAN,
  PUNCHY,
  LOUD_DEMO,
  LOFI_DUST,
  DARK_CINEMATIC,
  WIDE_NEON,
];

const BY_ID = new Map(MIX_PRESETS.map((p) => [p.id, p]));

export function applyMixPreset(project: Project, id: MixPresetId): Project {
  const p = BY_ID.get(id);
  if (!p) return project;
  return p.apply(project);
}

export function findMixPreset(id: MixPresetId | undefined): MixPresetDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Useful for tests / debugging — list of bus ids touched by any preset. */
export const ALL_BUS_IDS: SendBusId[] = [
  "roomReverb",
  "neonHall",
  "tapeDelay",
  "darkSlapback",
];

/** Expose default flat EQ + zero sends for components that need a fallback
 *  shape when a track has no `eq`/`sends` yet. */
export const DEFAULTS = { flatEq, zeroSends };
