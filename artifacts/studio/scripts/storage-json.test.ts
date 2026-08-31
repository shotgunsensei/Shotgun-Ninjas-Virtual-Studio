import assert from "node:assert/strict";
import test from "node:test";
import type { Project } from "../src/types";
import {
  parseProjectJson,
  projectToJson,
  summarizeProjectJson,
} from "../src/lib/storage/db";

function projectFixture(): Project {
  const clipBlob = new Blob(["clip-audio"], { type: "audio/wav" });
  const sampleBlob = new Blob(["library-audio"], { type: "audio/wav" });
  const chopBlob = new Blob(["chop-audio"], { type: "audio/wav" });
  return {
    id: "json-fixture",
    name: "JSON fixture",
    bpm: 104,
    bars: 8,
    loopEnabled: false,
    loopStartBeat: 0,
    loopEndBeat: 32,
    metronome: false,
    countIn: false,
    masterVolume: 0.8,
    midiMappings: [],
    updatedAt: 1234,
    tracks: [
      {
        id: "vocal-track",
        name: "Voice",
        kind: "vocals",
        preset: "clean",
        volume: 0.8,
        pan: 0,
        muted: false,
        solo: false,
        armed: false,
        noteClips: [],
        audioClips: [
          {
            id: "clip-one",
            start: 2,
            durationSec: 1.25,
            offsetSec: 0.1,
            sourceDurationSec: 1.5,
            reversed: true,
            name: "Hook take",
            color: "#ff0044",
            blobKey: "json-fixture:vocal-track:clip-one",
            blob: clipBlob,
          },
        ],
        fx: { reverb: 0, delay: 0, filter: 1 },
      },
      {
        id: "drum-track",
        name: "Drums",
        kind: "drums",
        preset: "acoustic",
        volume: 0.8,
        pan: 0,
        muted: false,
        solo: false,
        armed: false,
        noteClips: [],
        audioClips: [],
        padSamples: {
          kick: "json-fixture:sample:sample-one",
        },
        fx: { reverb: 0, delay: 0, filter: 1 },
      },
    ],
    samples: [
      {
        id: "sample-one",
        name: "Library hit",
        blobKey: "json-fixture:sample:sample-one",
        durationSec: 0.5,
        createdAt: 1234,
        blob: sampleBlob,
      },
    ],
    chopLab: {
      markers: [0.25],
      sliceSettings: [],
      sensitivity: 0.6,
      sampleName: "break.wav",
      sampleBlobKey: "json-fixture:chop",
      sampleBlob: chopBlob,
    },
  };
}

test("portable JSON preserves clip metadata and all three audio blob classes", async () => {
  const json = await projectToJson(projectFixture(), "project-with-samples");
  const imported = parseProjectJson(json);
  const clip = imported.tracks[0].audioClips[0];

  assert.equal(clip.reversed, true);
  assert.equal(clip.name, "Hook take");
  assert.equal(clip.color, "#ff0044");
  assert.equal(await clip.blob?.text(), "clip-audio");
  assert.match(clip.blobKey ?? "", /:vocal-track:clip-one$/);
  assert.equal(await imported.samples?.[0].blob?.text(), "library-audio");
  assert.equal(
    imported.tracks[1].padSamples?.kick,
    imported.samples?.[0].blobKey,
  );
  assert.equal(await imported.chopLab?.sampleBlob?.text(), "chop-audio");
  assert.match(imported.chopLab?.sampleBlobKey ?? "", /:choplab$/);
});

test("project-only import reports missing audio and retains destination-owned relink keys", async () => {
  const json = await projectToJson(projectFixture(), "project-only");
  const summary = summarizeProjectJson(json);
  const imported = parseProjectJson(json);

  assert.deepEqual(summary.missingSampleNames.sort(), [
    "Chop Lab: break.wav",
    "Library hit",
    "Voice clip",
  ]);
  assert.equal(imported.tracks[0].audioClips[0].blob, undefined);
  assert.match(
    imported.tracks[0].audioClips[0].blobKey ?? "",
    /:vocal-track:clip-one$/,
  );
  assert.match(imported.samples?.[0].blobKey ?? "", /:sample:sample-one$/);
  assert.equal(
    imported.tracks[1].padSamples?.kick,
    imported.samples?.[0].blobKey,
  );
  assert.match(imported.chopLab?.sampleBlobKey ?? "", /:choplab$/);
  assert.notEqual(
    imported.samples?.[0].blobKey,
    "json-fixture:sample:sample-one",
  );
});
