import type {
  ChopLabPersistedState,
  PerformanceSettings,
  Project,
  ProjectMetadata,
  Track,
} from "../../types";
import { DEFAULT_MASTER_BUS } from "../audio/master-defaults";

/**
 * Current project schema version. Bumped whenever we add or rename a
 * persisted field so older project files can be auto-upgraded by
 * `migrateProject` on load. Every load path (IndexedDB, JSON import,
 * draft recovery) MUST funnel through `migrateProject` so the rest of
 * the app can assume v{CURRENT_SCHEMA_VERSION}-shaped data.
 *
 *   v1 — legacy projects from Phase 1/2 (no schemaVersion field).
 *   v2 — Phase 3: schemaVersion stamped, v2 mixer defaults guaranteed,
 *        sample library normalised, sections/midiMappings defaulted.
 *   v3 — Phase 3 sharing polish: createdAt + optional `metadata`
 *        (creator/description/tags/mood/genre) populated.
 *   v4 — Phase 11: automationLanes per track; modulationSources and
 *        modulationRoutings at project level.
 *   v5 — Preserve Sound Library, Performance Mode, and Chop Lab project
 *        state across every IndexedDB, draft-recovery, and JSON load path.
 *   v6 — Preserve project sample-library assignments to individual drum pads.
 */
export const CURRENT_SCHEMA_VERSION = 6;

/** Known FX module ids — anything else is dropped (with a warning) by
 *  `checkProjectHealth`. Kept in sync with `FxModuleId`. */
const KNOWN_FX_MODULES = new Set([
  "eq",
  "compressor",
  "saturation",
  "delay",
  "reverb",
  "chorus",
  "bitcrusher",
  "stereoWidth",
]);

export { KNOWN_FX_MODULES };

const FLAT_EQ = { low: 0, mid: 0, high: 0, hpfOn: false, hpfHz: 80 } as const;
const ZERO_SENDS = {
  roomReverb: 0,
  neonHall: 0,
  tapeDelay: 0,
  darkSlapback: 0,
} as const;

function normalizeMetadata(raw: unknown): ProjectMetadata | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  const out: ProjectMetadata = {};
  if (typeof m.creator === "string" && m.creator.trim()) out.creator = m.creator.trim();
  if (typeof m.description === "string" && m.description.trim())
    out.description = m.description.trim();
  if (Array.isArray(m.tags)) {
    const tags = m.tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tags.length) out.tags = tags;
  }
  if (typeof m.mood === "string" && m.mood.trim()) out.mood = m.mood.trim();
  if (typeof m.genre === "string" && m.genre.trim()) out.genre = m.genre.trim();
  return Object.keys(out).length ? out : undefined;
}

function objectValue(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function normalizePerformance(raw: unknown): PerformanceSettings | undefined {
  const value = objectValue(raw);
  if (!value) return undefined;

  // Preserve the complete persisted shape for current projects. Individual
  // controls merge their own defaults at read time, so an older partial object
  // remains valid without migration inventing user choices.
  return value as unknown as PerformanceSettings;
}

function normalizeChopLab(raw: unknown): ChopLabPersistedState | undefined {
  const value = objectValue(raw);
  if (!value) return undefined;

  return {
    markers: Array.isArray(value.markers)
      ? value.markers.filter((marker): marker is number => Number.isFinite(marker))
      : [],
    sliceSettings: Array.isArray(value.sliceSettings)
      ? (value.sliceSettings as ChopLabPersistedState["sliceSettings"])
      : [],
    sensitivity:
      typeof value.sensitivity === "number" && Number.isFinite(value.sensitivity)
        ? value.sensitivity
        : 0.5,
    sampleName: typeof value.sampleName === "string" ? value.sampleName : undefined,
    sampleBlobKey:
      typeof value.sampleBlobKey === "string" ? value.sampleBlobKey : undefined,
    sampleBlob:
      typeof Blob !== "undefined" && value.sampleBlob instanceof Blob
        ? value.sampleBlob
        : undefined,
  };
}

function migrateTrack(t: unknown): Track {
  const raw = (t ?? {}) as Partial<Track> & Record<string, unknown>;
  const next: Track = {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? "Untitled"),
    kind: (raw.kind ?? "piano") as Track["kind"],
    preset: (raw.preset ?? "electric") as Track["preset"],
    volume: typeof raw.volume === "number" ? raw.volume : 0.78,
    pan: typeof raw.pan === "number" ? raw.pan : 0,
    muted: !!raw.muted,
    solo: !!raw.solo,
    armed: !!raw.armed,
    noteClips: Array.isArray(raw.noteClips) ? (raw.noteClips as Track["noteClips"]) : [],
    audioClips: Array.isArray(raw.audioClips) ? (raw.audioClips as Track["audioClips"]) : [],
    fx: {
      reverb: typeof raw.fx === "object" && raw.fx && typeof (raw.fx as { reverb?: number }).reverb === "number" ? (raw.fx as { reverb: number }).reverb : 0.1,
      delay: typeof raw.fx === "object" && raw.fx && typeof (raw.fx as { delay?: number }).delay === "number" ? (raw.fx as { delay: number }).delay : 0,
      filter: typeof raw.fx === "object" && raw.fx && typeof (raw.fx as { filter?: number }).filter === "number" ? (raw.fx as { filter: number }).filter : 1,
    },
    kitId: raw.kitId,
    presetId: raw.presetId,
    pieceSettings: raw.pieceSettings,
    padSamples:
      raw.padSamples && typeof raw.padSamples === "object"
        ? Object.fromEntries(
            Object.entries(raw.padSamples).filter(
              ([, blobKey]) => typeof blobKey === "string" && blobKey.length > 0,
            ),
          )
        : undefined,
    sound: raw.sound,
    groove: raw.groove,
    eq: raw.eq ?? { ...FLAT_EQ },
    sends: { ...ZERO_SENDS, ...(raw.sends ?? {}) },
    fxRack: raw.fxRack ?? {},
    meta: raw.meta ?? {},
    // v4: automation lanes default to empty array for older projects
    automationLanes: Array.isArray(raw.automationLanes) ? raw.automationLanes : [],
  };
  return next;
}

export interface MigrationResult {
  project: Project;
  fromVersion: number;
  toVersion: number;
  migrated: boolean;
}

/**
 * Walk a loaded project through every schema migration up to the
 * current version. Safe to call on already-current projects (it's a
 * no-op apart from filling in missing defaults).
 */
export function migrateProject(input: unknown): MigrationResult {
  const raw = (input ?? {}) as Partial<Project> & Record<string, unknown>;
  const fromVersion = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;

  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new Error(`Invalid project schema version: ${String(raw.schemaVersion)}`);
  }
  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This project uses schema v${fromVersion}, but this version of the studio only supports up to v${CURRENT_SCHEMA_VERSION}. Update the studio before opening it.`,
    );
  }

  // v1 → v2: stamp schemaVersion, guarantee v2 mixer / sample / sections
  // defaults exist so the rest of the app can stop guarding for missing
  // optional fields on every render.
  const tracks = (raw.tracks ?? []).map(migrateTrack);
  const project: Project = {
    id: String(raw.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
    name: String(raw.name ?? "Untitled"),
    bpm: typeof raw.bpm === "number" ? raw.bpm : 120,
    bars: typeof raw.bars === "number" ? raw.bars : 4,
    loopEnabled: !!raw.loopEnabled,
    loopStartBeat: typeof raw.loopStartBeat === "number" ? raw.loopStartBeat : 0,
    loopEndBeat: typeof raw.loopEndBeat === "number" ? raw.loopEndBeat : (raw.bars ?? 4) * 4,
    metronome: !!raw.metronome,
    countIn: raw.countIn !== undefined ? !!raw.countIn : true,
    countInBars: raw.countInBars === 2 ? 2 : 1,
    masterVolume: typeof raw.masterVolume === "number" ? raw.masterVolume : 0.8,
    tracks,
    midiMappings: Array.isArray(raw.midiMappings) ? raw.midiMappings : [],
    samples: Array.isArray(raw.samples) ? raw.samples : [],
    sections: Array.isArray(raw.sections) ? raw.sections : [],
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    globalGroove: raw.globalGroove,
    masterBus: raw.masterBus ?? { ...DEFAULT_MASTER_BUS },
    mixPresetId: raw.mixPresetId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt:
      typeof raw.createdAt === "number"
        ? raw.createdAt
        : typeof raw.updatedAt === "number"
          ? raw.updatedAt
          : Date.now(),
    metadata: normalizeMetadata(raw.metadata),
    // v5: these fields existed in the Project type before the migration
    // pipeline preserved them. Omitting them here silently reset the selected
    // sound pack, live-performance setup, and Chop Lab sample reference on
    // every load/import/recovery.
    soundPackId:
      typeof raw.soundPackId === "string" && raw.soundPackId.trim()
        ? raw.soundPackId.trim()
        : undefined,
    performance: normalizePerformance(raw.performance),
    chopLab: normalizeChopLab(raw.chopLab),
    // v4: Phase 11 — automation & modulation defaults
    modulationSources: Array.isArray(raw.modulationSources) ? raw.modulationSources : [],
    modulationRoutings: Array.isArray(raw.modulationRoutings) ? raw.modulationRoutings : [],
  };

  return {
    project,
    fromVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
    migrated: fromVersion < CURRENT_SCHEMA_VERSION,
  };
}
