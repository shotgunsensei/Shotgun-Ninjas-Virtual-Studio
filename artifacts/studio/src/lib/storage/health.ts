import type { Project } from "../../types";
import { CURRENT_SCHEMA_VERSION, KNOWN_FX_MODULES } from "./migrate";

export type HealthIssueSeverity = "info" | "warn" | "error";

export interface HealthIssue {
  severity: HealthIssueSeverity;
  /** Short stable code — useful in tests / analytics. */
  code:
    | "missing-sample"
    | "missing-audio-clip-blob"
    | "orphan-midi-mapping"
    | "unknown-fx-module"
    | "old-schema-version"
    | "empty-project";
  /** Human-readable message surfaced in the banner. */
  message: string;
  /** Optional reference to the offending entity. */
  trackId?: string;
  clipId?: string;
  sampleId?: string;
}

export interface HealthReport {
  issues: HealthIssue[];
  /** Convenience flag — true when no issues at all. */
  ok: boolean;
  /** True when there's at least one warn-or-error level issue (drives
   *  whether the banner shows by default). */
  hasWarnings: boolean;
}

/**
 * Inspect a freshly loaded project and surface any data the user
 * should know about: missing audio sample blobs, broken cross-refs,
 * deprecated effect ids, schema downgrades, etc. Pure / synchronous —
 * the IndexedDB load already hydrates blob refs onto clips, so a
 * `blobKey` without a `blob` field means the sample wasn't found.
 */
export function checkProjectHealth(project: Project): HealthReport {
  const issues: HealthIssue[] = [];

  // Old schema version (already migrated, but worth telling the user
  // their project was upgraded so they can re-save cleanly).
  if ((project.schemaVersion ?? 1) < CURRENT_SCHEMA_VERSION) {
    issues.push({
      severity: "info",
      code: "old-schema-version",
      message: `Project upgraded from schema v${project.schemaVersion ?? 1} to v${CURRENT_SCHEMA_VERSION}. Save to keep the new format.`,
    });
  }

  // Sample library: items with a blobKey but no resolved blob = missing.
  for (const s of project.samples ?? []) {
    if (s.blobKey && !s.blob) {
      issues.push({
        severity: "warn",
        code: "missing-sample",
        message: `Sample "${s.name}" is missing its audio data. Locate the file to restore it.`,
        sampleId: s.id,
      });
    }
  }

  // Audio clips: a vocal clip with a blobKey but no blob means the
  // underlying recording was lost (e.g. cleared site data).
  for (const t of project.tracks) {
    for (const c of t.audioClips ?? []) {
      if (c.blobKey && !c.blob) {
        issues.push({
          severity: "warn",
          code: "missing-audio-clip-blob",
          message: `Audio clip on "${t.name}" is missing its recording. Re-record or import to restore.`,
          trackId: t.id,
          clipId: c.id,
        });
      }
    }
    // Unknown FX modules — could happen if a project file from a newer
    // build references modules we don't know about.
    if (t.fxRack) {
      for (const id of Object.keys(t.fxRack)) {
        if (!KNOWN_FX_MODULES.has(id)) {
          issues.push({
            severity: "info",
            code: "unknown-fx-module",
            message: `Track "${t.name}" uses unsupported effect "${id}" — it will be ignored.`,
            trackId: t.id,
          });
        }
      }
    }
  }

  // Orphaned MIDI mappings (e.g. mapping points at a deleted track).
  const trackIds = new Set(project.tracks.map((t) => t.id));
  for (const m of project.midiMappings ?? []) {
    if (m.target.kind === "track-volume" && !trackIds.has(m.target.trackId)) {
      issues.push({
        severity: "warn",
        code: "orphan-midi-mapping",
        message: `MIDI mapping "${m.label}" points at a deleted track and won't fire.`,
      });
    }
  }

  // Empty project guard — gentler nudge so first-run users know something.
  if (project.tracks.length === 0) {
    issues.push({
      severity: "info",
      code: "empty-project",
      message: "This project has no tracks yet — add one from the Tracks browser.",
    });
  }

  const hasWarnings = issues.some((i) => i.severity !== "info");
  return { issues, ok: issues.length === 0, hasWarnings };
}
