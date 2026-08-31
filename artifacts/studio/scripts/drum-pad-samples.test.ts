import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSIGNABLE_DRUM_PAD_PIECES,
  assignDrumPadSampleKey,
  isDrumPadSamplePiece,
  resolveDrumPadSample,
} from "../src/lib/audio/drumPadSamples";
import type { SampleLibraryItem, Track } from "../src/types";

function makeDrumTrack(): Track {
  return {
    id: "drums",
    name: "Drums",
    kind: "drums",
    preset: "trap",
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    noteClips: [],
    audioClips: [],
    fx: { reverb: 0, delay: 0, filter: 1 },
    padSamples: { kick: "sample:kick" },
  };
}

test("drum-pad assignment preserves existing mappings without mutating the track", () => {
  const track = makeDrumTrack();
  const before = structuredClone(track.padSamples);
  const assigned = assignDrumPadSampleKey(track, "snare", "sample:snare");

  assert.deepEqual(assigned, {
    kick: "sample:kick",
    snare: "sample:snare",
  });
  assert.deepEqual(track.padSamples, before);
});

test("persisted mappings resolve only hydrated project-library blobs", () => {
  const track = makeDrumTrack();
  const hydrated: SampleLibraryItem = {
    id: "kick",
    name: "Kick",
    blobKey: "sample:kick",
    durationSec: 0.25,
    createdAt: 1,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
  };

  assert.equal(resolveDrumPadSample(track, "kick", [hydrated]), hydrated);
  assert.equal(resolveDrumPadSample(track, "snare", [hydrated]), null);
  assert.ok(ASSIGNABLE_DRUM_PAD_PIECES.every(isDrumPadSamplePiece));
  assert.equal(isDrumPadSamplePiece("not-a-pad"), false);
});
