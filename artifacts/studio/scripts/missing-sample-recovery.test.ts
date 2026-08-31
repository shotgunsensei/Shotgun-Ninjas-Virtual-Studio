import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMissingSampleRecoveryPatch,
  buildMissingSampleSkipPatch,
  isMissingSampleRecovered,
  missingSampleEntryKey,
  type MissingSampleEntry,
} from "../src/lib/audio/missingSampleRecovery";
import type { AudioClip, Project, Track } from "../src/types";

function audioClip(id: string, blobKey: string): AudioClip {
  return {
    id,
    blobKey,
    name: id,
    start: 0,
    durationSec: 4,
  };
}

function track(
  id: string,
  kind: Track["kind"],
  clips: AudioClip[] = [],
): Track {
  return {
    id,
    name: id,
    kind,
    preset: kind === "drums" ? "trap" : "keys",
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    noteClips: [],
    audioClips: clips,
    fx: { reverb: 0, delay: 0, filter: 1 },
  };
}

function project(): Project {
  const drums = track("drums", "drums");
  drums.padSamples = { kick: "blob:library-target" };
  return {
    id: "recovery-project",
    name: "Recovery fixture",
    bpm: 100,
    bars: 8,
    loopEnabled: true,
    loopStartBeat: 0,
    loopEndBeat: 32,
    metronome: false,
    countIn: false,
    masterVolume: 0.8,
    midiMappings: [],
    tracks: [
      drums,
      track("vocals-a", "vocals", [audioClip("duplicate-id", "blob:clip-a")]),
      track("vocals-b", "vocals", [audioClip("duplicate-id", "blob:clip-b")]),
    ],
    samples: [
      {
        id: "duplicate-id",
        name: "Target sample",
        blobKey: "blob:library-target",
        durationSec: 1,
        createdAt: 1,
      },
      {
        id: "duplicate-id",
        name: "Different sample",
        blobKey: "blob:library-other",
        durationSec: 1,
        createdAt: 2,
      },
    ],
    updatedAt: 1,
  };
}

test("library recovery hydrates only the exact id/blob-key owner", () => {
  const source = project();
  const blob = new Blob(["library audio"], { type: "audio/wav" });
  const entry: MissingSampleEntry = {
    kind: "library",
    sampleId: "duplicate-id",
    blobKey: "blob:library-target",
    name: "Target sample",
  };

  const patch = buildMissingSampleRecoveryPatch(source, entry, blob, 2.5);
  assert.equal(patch.kind, "library");
  if (patch.kind !== "library") return;
  const recovered = { ...source, samples: patch.samples };

  assert.equal(patch.samples[0]?.blob, blob);
  assert.equal(patch.samples[0]?.durationSec, 2.5);
  assert.equal(patch.samples[1]?.blob, undefined);
  assert.equal(source.samples?.[0]?.blob, undefined);
  assert.equal(isMissingSampleRecovered(recovered, entry, blob), true);
});

test("clip recovery hydrates only the exact track/id/blob-key tuple", () => {
  const source = project();
  const blob = new Blob(["clip audio"], { type: "audio/wav" });
  const entry: MissingSampleEntry = {
    kind: "clip",
    sampleId: "duplicate-id",
    blobKey: "blob:clip-b",
    name: "duplicate-id",
    trackId: "vocals-b",
    trackName: "vocals-b",
  };

  const patch = buildMissingSampleRecoveryPatch(source, entry, blob, 3.25);
  assert.equal(patch.kind, "clip");
  if (patch.kind !== "clip") return;
  const recovered = { ...source, tracks: patch.tracks };

  assert.equal(patch.tracks[1]?.audioClips[0]?.blob, undefined);
  assert.equal(patch.tracks[2]?.audioClips[0]?.blob, blob);
  assert.equal(patch.tracks[2]?.audioClips[0]?.sourceDurationSec, 3.25);
  assert.equal(source.tracks[2]?.audioClips[0]?.blob, undefined);
  assert.equal(isMissingSampleRecovered(recovered, entry, blob), true);
  assert.notEqual(
    missingSampleEntryKey(entry),
    missingSampleEntryKey({
      kind: "library",
      sampleId: entry.sampleId,
      blobKey: entry.blobKey,
      name: entry.name,
    }),
  );
});

test("skip mutes only the exact clip owner and assigned sample owners", () => {
  const source = project();
  const clipEntry: MissingSampleEntry = {
    kind: "clip",
    sampleId: "duplicate-id",
    blobKey: "blob:clip-b",
    name: "duplicate-id",
    trackId: "vocals-b",
    trackName: "vocals-b",
  };
  const clipPatch = buildMissingSampleSkipPatch(source, clipEntry);
  assert.equal(clipPatch.action, "muted");
  assert.equal(clipPatch.tracks?.[1]?.muted, false);
  assert.equal(clipPatch.tracks?.[2]?.muted, true);

  const libraryPatch = buildMissingSampleSkipPatch(source, {
    kind: "library",
    sampleId: "duplicate-id",
    blobKey: "blob:library-target",
    name: "Target sample",
  });
  assert.equal(libraryPatch.action, "muted");
  assert.equal(libraryPatch.tracks?.[0]?.muted, true);
  assert.equal(libraryPatch.tracks?.[1]?.muted, false);
});

test("recovery rejects stale targets and invalid decoded audio", () => {
  const source = project();
  const stale: MissingSampleEntry = {
    kind: "clip",
    sampleId: "duplicate-id",
    blobKey: "blob:no-longer-current",
    name: "Stale clip",
    trackId: "vocals-b",
    trackName: "vocals-b",
  };
  const blob = new Blob(["audio"], { type: "audio/wav" });

  assert.throws(
    () => buildMissingSampleRecoveryPatch(source, stale, blob, 1),
    /no longer the missing clip/,
  );
  assert.throws(
    () =>
      buildMissingSampleRecoveryPatch(
        source,
        {
          kind: "library",
          sampleId: "duplicate-id",
          blobKey: "blob:library-target",
          name: "Target sample",
        },
        blob,
        Number.NaN,
      ),
    /does not contain playable audio/,
  );
});
