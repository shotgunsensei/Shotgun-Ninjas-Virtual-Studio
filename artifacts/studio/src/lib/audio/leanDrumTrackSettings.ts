import type { Track } from "../../types";

export interface LeanDrumTrackSettingsSnapshot {
  volume: number;
  pan: number;
  muted: boolean;
  cutoff: number | undefined;
  resonance: number | undefined;
}

function snapshotTrack(track: Track): LeanDrumTrackSettingsSnapshot {
  return {
    volume: track.volume,
    pan: track.pan,
    muted: track.muted,
    cutoff: track.sound?.cutoff,
    resonance: track.sound?.resonance,
  };
}

function settingsMatch(
  previous: LeanDrumTrackSettingsSnapshot,
  track: Track,
): boolean {
  return (
    Object.is(previous.volume, track.volume) &&
    Object.is(previous.pan, track.pan) &&
    previous.muted === track.muted &&
    Object.is(previous.cutoff, track.sound?.cutoff) &&
    Object.is(previous.resonance, track.sound?.resonance)
  );
}

/**
 * Tracks only the project values that `LeanDrumVoice.applyTrack` writes to
 * native AudioParams. Comparing primitives avoids tying the real-time path to
 * React/store object identity while keeping note clips and other arrangement
 * edits out of the cache key.
 */
export class LeanDrumTrackSettingsCache {
  private readonly applied = new Map<string, LeanDrumTrackSettingsSnapshot>();

  needsApply(track: Track): boolean {
    const previous = this.applied.get(track.id);
    return !previous || !settingsMatch(previous, track);
  }

  markApplied(track: Track): void {
    this.applied.set(track.id, snapshotTrack(track));
  }

  delete(trackId: string): void {
    this.applied.delete(trackId);
  }

  clear(): void {
    this.applied.clear();
  }
}
