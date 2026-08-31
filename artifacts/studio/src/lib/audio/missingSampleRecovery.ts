import type { Project, SampleLibraryItem, Track } from "../../types";

export type MissingSampleEntry =
  | {
      kind: "library";
      sampleId: string;
      blobKey: string;
      name: string;
    }
  | {
      kind: "clip";
      sampleId: string;
      blobKey: string;
      name: string;
      trackId: string;
      trackName: string;
    };

export type MissingSampleRecoveryPatch =
  | { kind: "library"; samples: SampleLibraryItem[] }
  | { kind: "clip"; tracks: Track[] };

export type MissingSampleSkipPatch = {
  action: "muted" | "skipped";
  tracks?: Track[];
};

export function missingSampleEntryKey(entry: MissingSampleEntry): string {
  return entry.kind === "clip"
    ? `clip:${entry.trackId}:${entry.sampleId}:${entry.blobKey}`
    : `library:${entry.sampleId}:${entry.blobKey}`;
}

function findLibrarySample(
  project: Project,
  entry: Extract<MissingSampleEntry, { kind: "library" }>,
): SampleLibraryItem | undefined {
  return (project.samples ?? []).find(
    (sample) =>
      sample.id === entry.sampleId && sample.blobKey === entry.blobKey,
  );
}

function findAudioClip(
  project: Project,
  entry: Extract<MissingSampleEntry, { kind: "clip" }>,
) {
  const track = project.tracks.find((candidate) => candidate.id === entry.trackId);
  const clip = track?.audioClips.find(
    (candidate) =>
      candidate.id === entry.sampleId && candidate.blobKey === entry.blobKey,
  );
  return { track, clip };
}

/**
 * Build the narrow project patch that puts a recovered Blob back on the exact
 * library item or arrangement clip which produced the missing-sample entry.
 * Matching both the owner and blob key prevents duplicate clip ids from
 * hydrating the wrong track.
 */
export function buildMissingSampleRecoveryPatch(
  project: Project,
  entry: MissingSampleEntry,
  blob: Blob,
  decodedDurationSec: number,
): MissingSampleRecoveryPatch {
  if (!Number.isFinite(decodedDurationSec) || decodedDurationSec <= 0) {
    throw new Error("The selected file does not contain playable audio.");
  }

  if (entry.kind === "library") {
    const target = findLibrarySample(project, entry);
    if (!target) {
      throw new Error(
        `“${entry.name}” is no longer the missing sample in this project.`,
      );
    }
    return {
      kind: "library",
      samples: (project.samples ?? []).map((sample) =>
        sample === target
          ? { ...sample, blob, durationSec: decodedDurationSec }
          : sample,
      ),
    };
  }

  const { track, clip } = findAudioClip(project, entry);
  if (!track || !clip) {
    throw new Error(
      `“${entry.name}” is no longer the missing clip on ${entry.trackName}.`,
    );
  }
  return {
    kind: "clip",
    tracks: project.tracks.map((candidate) =>
      candidate === track
        ? {
            ...candidate,
            audioClips: candidate.audioClips.map((audioClip) =>
              audioClip === clip
                ? {
                    ...audioClip,
                    blob,
                    sourceDurationSec: decodedDurationSec,
                  }
                : audioClip,
            ),
          }
        : candidate,
    ),
  };
}

export function isMissingSampleRecovered(
  project: Project,
  entry: MissingSampleEntry,
  blob: Blob,
): boolean {
  if (entry.kind === "library") {
    return findLibrarySample(project, entry)?.blob === blob;
  }
  return findAudioClip(project, entry).clip?.blob === blob;
}

/** Build the exact track mute needed by the wizard's explicit skip action. */
export function buildMissingSampleSkipPatch(
  project: Project,
  entry: MissingSampleEntry,
): MissingSampleSkipPatch {
  if (entry.kind === "clip") {
    const { track, clip } = findAudioClip(project, entry);
    if (!track || !clip) {
      throw new Error(
        `“${entry.name}” is no longer the missing clip on ${entry.trackName}.`,
      );
    }
    return {
      action: "muted",
      tracks: project.tracks.map((candidate) =>
        candidate === track ? { ...candidate, muted: true } : candidate,
      ),
    };
  }

  const target = findLibrarySample(project, entry);
  if (!target) {
    throw new Error(
      `“${entry.name}” is no longer the missing sample in this project.`,
    );
  }
  const owners = project.tracks.filter((track) =>
    Object.values(track.padSamples ?? {}).includes(entry.blobKey),
  );
  if (owners.length === 0) return { action: "skipped" };
  const ownerIds = new Set(owners.map((track) => track.id));
  return {
    action: "muted",
    tracks: project.tracks.map((track) =>
      ownerIds.has(track.id) ? { ...track, muted: true } : track,
    ),
  };
}
