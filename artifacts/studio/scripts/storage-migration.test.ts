import assert from "node:assert/strict";
import test from "node:test";
import {
  CURRENT_SCHEMA_VERSION,
  migrateProject,
} from "../src/lib/storage/migrate";

function legacyProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "migration-fixture",
    name: "Migration fixture",
    bpm: 96,
    bars: 8,
    loopEnabled: true,
    loopStartBeat: 4,
    loopEndBeat: 28,
    metronome: false,
    countIn: true,
    masterVolume: 0.75,
    tracks: [],
    midiMappings: [],
    updatedAt: 1234,
    schemaVersion: 4,
    ...overrides,
  };
}

test("v5 migration preserves sound-pack, performance, and Chop Lab state", () => {
  const sampleBlob = new Blob(["chop-audio"], { type: "audio/wav" });
  const performance = {
    open: true,
    inputSource: "gamepad",
    scaleLock: true,
    scaleRoot: 9,
    scaleId: "harmonic_minor",
    chordMode: true,
    chordType: "minor7",
    basslineMode: true,
    basslinePatternId: "walking",
    gamepadMappings: [{ buttonIndex: 0, note: 48, label: "Root" }],
  };
  const chopLab = {
    markers: [0.25, 0.5],
    sliceSettings: [],
    sensitivity: 0.72,
    sampleName: "break.wav",
    sampleBlobKey: "migration-fixture:chop",
    sampleBlob,
  };

  const result = migrateProject(
    legacyProject({
      soundPackId: "pack.neon",
      performance,
      chopLab,
    }),
  );

  assert.equal(result.fromVersion, 4);
  assert.equal(result.toVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(result.migrated, true);
  assert.equal(result.project.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(result.project.soundPackId, "pack.neon");
  assert.deepEqual(result.project.performance, performance);
  assert.deepEqual(result.project.chopLab?.markers, chopLab.markers);
  assert.equal(result.project.chopLab?.sampleBlobKey, chopLab.sampleBlobKey);
  assert.equal(result.project.chopLab?.sampleBlob, sampleBlob);
});

test("migration rejects invalid and future schema versions without downgrading", () => {
  assert.throws(
    () => migrateProject(legacyProject({ schemaVersion: 0 })),
    /Invalid project schema version/,
  );
  assert.throws(
    () =>
      migrateProject(
        legacyProject({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }),
      ),
    /Update the studio before opening it/,
  );
});
