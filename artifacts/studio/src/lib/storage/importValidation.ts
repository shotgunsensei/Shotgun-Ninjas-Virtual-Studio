/** Import-only checks run before migration, media decoding, or persistence.
 * Missing legacy optional fields keep the migrator's defaults. Explicitly
 * malformed containers are rejected rather than silently losing user data. */
type JsonObject = Record<string, unknown>;

// Stability budgets for a parsed JSON tree, not project/feature entitlements.
// The persisted schema is far shallower; iterative traversal bounds validation
// work and rejects non-finite JSON number overflow even in optional fields.
export const MAX_PROJECT_IMPORT_DEPTH = 32;
export const MAX_PROJECT_IMPORT_VALUES = 1_000_000;

function invalid(path: string, requirement: string): never {
  throw new Error(`Invalid project file: ${path} ${requirement}.`);
}

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, "must be an object");
  }
  return value as JsonObject;
}

function array(value: unknown, path: string, optional = true): unknown[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) invalid(path, "must be an array");
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(path, "must be a non-empty string");
  return value;
}

function number(value: unknown, path: string, minimum = -Infinity, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path, "must be a finite number");
  if (value < minimum || (positive && value === minimum)) {
    invalid(path, `must be ${positive ? "greater than" : "at least"} ${minimum}`);
  }
  return value;
}

function optionalFields(value: JsonObject, path: string, strings: string[], numbers: string[], booleans: string[] = []): void {
  for (const key of strings) {
    if (value[key] !== undefined && typeof value[key] !== "string") invalid(`${path}.${key}`, "must be a string");
  }
  for (const key of numbers) {
    if (value[key] !== undefined) number(value[key], `${path}.${key}`);
  }
  for (const key of booleans) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") invalid(`${path}.${key}`, "must be a boolean");
  }
}

function unique(value: unknown, path: string, seen: Set<string>): void {
  const id = string(value, path);
  if (seen.has(id)) invalid(path, "must be unique");
  seen.add(id);
}

function checkTree(root: unknown): void {
  const pending = [{ value: root, path: "project", depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++visited > MAX_PROJECT_IMPORT_VALUES) invalid("project", "exceeds the safe import structure budget");
    if (typeof entry.value === "number") number(entry.value, entry.path);
    if (!entry.value || typeof entry.value !== "object") continue;
    if (entry.depth >= MAX_PROJECT_IMPORT_DEPTH) invalid(entry.path, "is nested too deeply to import safely");
    if (Array.isArray(entry.value) && visited + pending.length + entry.value.length > MAX_PROJECT_IMPORT_VALUES) {
      invalid("project", "exceeds the safe import structure budget");
    }
    const entries = Object.entries(entry.value);
    if (visited + pending.length + entries.length > MAX_PROJECT_IMPORT_VALUES) {
      invalid("project", "exceeds the safe import structure budget");
    }
    for (const [key, value] of entries) {
      pending.push({ value, path: `${entry.path}.${key}`, depth: entry.depth + 1 });
    }
  }
}

function media(value: JsonObject, path: string): void {
  optionalFields(value, path, ["blobKey", "base64", "mimeType"], []);
  if (value.base64 !== undefined && value.base64 !== "") {
    string(value.mimeType, `${path}.mimeType`);
    // Reject malformed media during summary, before atob allocates its output.
    const encoded = value.base64 as string;
    const padding = encoded.indexOf("=");
    if (
      encoded.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(encoded) ||
      (padding !== -1 && (encoded.length % 4 !== 0 || padding < encoded.length - 2 || !/^={1,2}$/.test(encoded.slice(padding))))
    ) {
      invalid(`${path}.base64`, "must contain valid base64 audio data");
    }
  }
}

/** Validate only external JSON. IndexedDB/draft migration and its defaults are
 * unchanged; this does not claim a full audio/cross-reference schema audit. */
export function validateProjectImport(raw: unknown, brand?: unknown): void {
  checkTree(raw);
  const project = object(raw, "project");
  optionalFields(project, "project", ["id", "name"], ["masterVolume", "createdAt", "updatedAt"], ["loopEnabled", "metronome", "countIn"]);
  if (project.bpm !== undefined) number(project.bpm, "project.bpm", 0, true);
  if (project.bars !== undefined) number(project.bars, "project.bars", 0, true);
  for (const key of ["loopStartBeat", "loopEndBeat"]) {
    if (project[key] !== undefined) number(project[key], `project.${key}`, 0);
  }
  if (brand !== undefined) {
    const value = object(brand, "brand");
    string(value.appVersion, "brand.appVersion");
    optionalFields(value, "brand", ["appName", "appUrl", "createdWith", "exportMode"], ["schemaVersion", "exportedAt"]);
  }

  const trackIds = new Set<string>();
  for (const [index, item] of array(project.tracks, "project.tracks", false).entries()) {
    const path = `project.tracks[${index}]`;
    const track = object(item, path);
    // Clip mutations address a track first. Legacy files may reuse clip IDs
    // on different tracks; only ambiguity within the same owner is rejected.
    const clipIds = new Set<string>();
    unique(track.id, `${path}.id`, trackIds);
    optionalFields(track, path, ["name", "preset", "presetId", "kitId"], ["volume", "pan"], ["muted", "solo", "armed"]);
    if (track.kind !== undefined && !["piano", "guitar", "drums", "bass", "vocals"].includes(track.kind as string)) invalid(`${path}.kind`, "is unsupported");
    for (const [clipIndex, item] of array(track.noteClips, `${path}.noteClips`).entries()) {
      const clipPath = `${path}.noteClips[${clipIndex}]`;
      const clip = object(item, clipPath);
      unique(clip.id, `${clipPath}.id`, clipIds);
      number(clip.start, `${clipPath}.start`, 0);
      number(clip.length, `${clipPath}.length`, 0, true);
      optionalFields(clip, clipPath, ["name", "color", "division", "scaleRoot", "scaleMode"], ["bars"]);
      for (const [noteIndex, item] of array(clip.notes, `${clipPath}.notes`, false).entries()) {
        const notePath = `${clipPath}.notes[${noteIndex}]`;
        const note = object(item, notePath);
        string(note.note, `${notePath}.note`);
        number(note.time, `${notePath}.time`, 0);
        number(note.duration, `${notePath}.duration`, 0);
        number(note.velocity, `${notePath}.velocity`);
        optionalFields(note, notePath, [], ["probability", "microTiming", "retrigger"], ["flam", "accent", "reversed"]);
      }
    }
    for (const [clipIndex, item] of array(track.audioClips, `${path}.audioClips`).entries()) {
      const clipPath = `${path}.audioClips[${clipIndex}]`;
      const clip = object(item, clipPath);
      unique(clip.id, `${clipPath}.id`, clipIds);
      number(clip.start, `${clipPath}.start`, 0);
      number(clip.durationSec, `${clipPath}.durationSec`, 0);
      optionalFields(clip, clipPath, ["name", "color"], ["offsetSec", "sourceDurationSec"], ["reversed"]);
      media(clip, clipPath);
    }
    for (const key of ["fx", "eq", "sends", "sound", "groove", "meta", "fxRack", "pieceSettings", "padSamples"]) {
      if (track[key] !== undefined) object(track[key], `${path}.${key}`);
    }
    for (const [laneIndex, item] of array(track.automationLanes, `${path}.automationLanes`).entries()) {
      const lanePath = `${path}.automationLanes[${laneIndex}]`;
      const lane = object(item, lanePath);
      string(lane.id, `${lanePath}.id`);
      string(lane.param, `${lanePath}.param`);
      for (const [pointIndex, item] of array(lane.breakpoints, `${lanePath}.breakpoints`, false).entries()) {
        const pointPath = `${lanePath}.breakpoints[${pointIndex}]`;
        const point = object(item, pointPath);
        number(point.beat, `${pointPath}.beat`, 0);
        number(point.value, `${pointPath}.value`);
      }
    }
  }
  const sampleIds = new Set<string>();
  for (const [index, item] of array(project.samples, "project.samples").entries()) {
    const path = `project.samples[${index}]`;
    const sample = object(item, path);
    unique(sample.id, `${path}.id`, sampleIds);
    string(sample.blobKey, `${path}.blobKey`);
    if (typeof sample.name !== "string") invalid(`${path}.name`, "must be a string");
    number(sample.durationSec, `${path}.durationSec`, 0);
    optionalFields(sample, path, ["name"], ["durationSec", "createdAt"]);
    media(sample, path);
  }
  for (const key of ["sections", "midiMappings", "modulationSources", "modulationRoutings"]) {
    for (const [index, item] of array(project[key], `project.${key}`).entries()) {
      const path = `project.${key}[${index}]`;
      const value = object(item, path);
      if (key === "midiMappings") object(value.target, `${path}.target`);
      if (key === "sections") {
        number(value.bar, `${path}.bar`, 0);
        optionalFields(value, path, ["id", "label", "color"], []);
      }
    }
  }
  for (const key of ["masterBus", "globalGroove", "performance"]) {
    if (project[key] !== undefined) object(project[key], `project.${key}`);
  }
  if (project.chopLab !== undefined) {
    const chop = object(project.chopLab, "project.chopLab");
    for (const [index, marker] of array(chop.markers, "project.chopLab.markers").entries()) number(marker, `project.chopLab.markers[${index}]`, 0);
    for (const [index, setting] of array(chop.sliceSettings, "project.chopLab.sliceSettings").entries()) object(setting, `project.chopLab.sliceSettings[${index}]`);
    optionalFields(chop, "project.chopLab", ["sampleName", "sampleBlobKey"], ["sensitivity"]);
    media(chop, "project.chopLab");
  }
}
