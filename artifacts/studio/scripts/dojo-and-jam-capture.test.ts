import assert from "node:assert/strict";
import test from "node:test";
import { buildDojoSession } from "../src/lib/creative/dojo";
import {
  buildJamRecoveryClip,
  JAM_CAPTURE_LIMIT,
  JamCapture,
} from "../src/lib/performance/jamCapture";
import type { NoteClip, Project, Track } from "../src/types";

function makeTrack(id: string, kind: Track["kind"], noteClips: NoteClip[] = []): Track {
  return {
    id,
    name: `${kind} track`,
    kind,
    preset: kind === "drums" ? "trap" : kind === "guitar" ? "clean" : "electric",
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    noteClips,
    audioClips: [],
    fx: { reverb: 0, delay: 0, filter: 1 },
    meta: { color: "#22d3ee" },
  };
}

function makeProject(tracks: Track[]): Project {
  return {
    id: "dojo-project",
    name: "Dojo test",
    bpm: 120,
    bars: 4,
    loopEnabled: false,
    loopStartBeat: 0,
    loopEndBeat: 16,
    metronome: false,
    countIn: false,
    masterVolume: 0.8,
    tracks,
    midiMappings: [],
    updatedAt: 1,
  };
}

test("Dojo guidance changes its teaching posture without mutating the project", () => {
  const project = makeProject([
    makeTrack("drums", "drums"),
    makeTrack("keys", "piano"),
    makeTrack("bass", "bass"),
  ]);
  const before = structuredClone(project);

  const teach = buildDojoSession(project, "keys", "teach");
  const surprise = buildDojoSession(project, "keys", "surprise");
  const secondSurprise = buildDojoSession(project, "keys", "surprise");
  const quiet = buildDojoSession(project, "keys", "quiet");

  assert.match(teach.title, /pulse/i);
  assert.equal(surprise.constraint, secondSurprise.constraint);
  assert.equal(surprise.recommendedRecipe, secondSurprise.recommendedRecipe);
  assert.equal(surprise.targetTrackId, "keys");
  assert.match(quiet.why, /optional move/i);
  assert.deepEqual(project, before);
});

test("Jam Capture records direct expression, skips formal recording, and restores claimed ideas", () => {
  let now = 1_000;
  const capture = new JamCapture(null, () => now);
  capture.setActiveProject("project-a", 120);

  capture.captureDrum("drums", "kick", 0.9);
  now += 250;
  capture.noteOn("keys", "C4", 0.8);
  now += 500;
  capture.noteOff("keys", "C4");
  capture.setFormalRecordingActive(true);
  capture.captureDrum("drums", "snare", 0.9);
  capture.captureOneShot("keys", "E4", 0.4, 0.8);
  capture.setFormalRecordingActive(false);

  const events = capture.getProjectEvents("project-a");
  assert.equal(events.length, 2);
  assert.equal(capture.summarize("project-a").length, 2);
  assert.equal(events.find((event) => event.note === "C4")?.durationMs, 500);

  const claimed = capture.claim([events[0].id]);
  assert.equal(claimed.length, 1);
  assert.equal(capture.getProjectEvents("project-a").length, 1);
  capture.restore(claimed);
  assert.equal(capture.getProjectEvents("project-a").length, 2);
});

test("Jam recovery preserves natural feel or tightens to sixteenths as editable notes", () => {
  let now = 10_000;
  const capture = new JamCapture(null, () => now);
  capture.setActiveProject("project-a", 120);
  capture.captureOneShot("keys", "C4", 0.35, 0.81);
  now += 380;
  capture.captureOneShot("keys", "E4", 0.42, 0.74);
  now += 620;
  capture.captureOneShot("keys", "G4", 0.5, 0.88);

  const track = makeTrack("keys", "piano");
  const events = capture.getProjectEvents("project-a");
  const natural = buildJamRecoveryClip({
    id: "natural",
    events,
    targetTrack: track,
    bpm: 120,
    start: 16,
    windowSeconds: 30,
    feel: "natural",
  });
  const tight = buildJamRecoveryClip({
    id: "tight",
    events,
    targetTrack: track,
    bpm: 120,
    start: 16,
    windowSeconds: 30,
    feel: "sixteenth",
  });

  assert.ok(natural);
  assert.ok(tight);
  assert.equal(natural.clip.start, 16);
  assert.equal(natural.clip.notes.length, 3);
  assert.equal(natural.clip.notes[1].time, 0.76);
  assert.equal(tight.clip.notes[1].time, 0.75);
  assert.ok(tight.clip.notes.every((note) => note.time % 0.25 === 0));
  assert.match(tight.clip.name ?? "", /Recovered Jam/);
});

test("Jam Capture is strictly bounded even through long live sessions", () => {
  let now = 0;
  const capture = new JamCapture(null, () => now++);
  capture.setActiveProject("long-session", 100);
  for (let index = 0; index < JAM_CAPTURE_LIMIT + 32; index += 1) {
    capture.captureDrum("drums", index % 2 === 0 ? "hat" : "kick", 0.7);
  }
  assert.equal(capture.getProjectEvents("long-session").length, JAM_CAPTURE_LIMIT);
});
