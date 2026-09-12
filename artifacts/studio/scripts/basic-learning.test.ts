import assert from "node:assert/strict";
import test from "node:test";
import {
  appendBasicClip,
  basicSongEnd,
  repeatBasicSong,
  toggleBasicNote,
} from "../src/lib/learning/basicWorkflow";
import { normalizeStoredSettings } from "../src/lib/settings";
import type { NoteClip, Project, Track } from "../src/types";

function track(id: string, kind: Track["kind"], noteClips: NoteClip[] = []): Track {
  return {
    id, kind, name: id, preset: kind === "drums" ? "acoustic" : "electric",
    volume: 0.7, pan: 0, muted: false, solo: false, armed: false,
    noteClips, audioClips: [], fx: { reverb: 0, delay: 0, filter: 1 },
  };
}

function project(tracks: Track[], patch: Partial<Project> = {}): Project {
  return {
    id: "learning-project", name: "My song", bpm: 120, bars: 4,
    loopEnabled: true, loopStartBeat: 4, loopEndBeat: 8,
    metronome: false, countIn: false, masterVolume: 0.6,
    tracks, midiMappings: [], updatedAt: 1, ...patch,
  };
}

test("a Basic grid edit preserves off-grid notes, other bars, and clip metadata", () => {
  const source: NoteClip = {
    id: "selected-clip", start: 12, length: 8, name: "My timing", division: "1/16T",
    notes: [
      { note: "kick", time: 0, duration: 0.25, velocity: 0.8 },
      { note: "snare", time: 1 / 6, duration: 0.1, velocity: 0.4 },
      { note: "kick", time: 4, duration: 0.25, velocity: 0.9 },
    ],
  };
  const before = structuredClone(source);
  const removed = toggleBasicNote(source, "kick", 0);
  assert.deepEqual(removed.notes, source.notes.slice(1));
  assert.equal(removed.start, 12);
  assert.equal(removed.division, "1/16T");
  assert.equal(removed.name, "My timing");

  const restored = toggleBasicNote(removed, "kick", 0, 0.25, 0.8);
  assert.deepEqual(restored, before);
  assert.deepEqual(source, before);
});

test("Basic note entry cannot spill past a partial last bar", () => {
  const source: NoteClip = { id: "partial", start: 0, length: 3.6, notes: [] };
  const edited = toggleBasicNote(source, "C4", 3.5, 0.45);
  assert.equal(edited.notes.length, 1);
  assert.ok(Math.abs(edited.notes[0].duration - 0.1) < 1e-10);
  for (const invalid of [-1, 3.6, 4, Number.NaN, Infinity]) {
    assert.equal(toggleBasicNote(source, "C4", invalid), source);
  }
  assert.deepEqual(source.notes, []);
});

test("adding an idea uses the live track and leaves its samples and other clips intact", () => {
  const original: NoteClip = { id: "first", start: 0, length: 4, notes: [] };
  const currentTrack = track("keys", "piano", [original]);
  currentTrack.sampleInstrument = { blobKey: "my-recording", rootNote: 69 };
  currentTrack.fx = { reverb: 0.45, delay: 0.25, filter: 0.8 };
  const otherTrack = track("drums", "drums");
  const source = project([currentTrack, otherTrack]);
  // The caller may have rendered before a sound selection changed.
  const staleTrack = { ...currentTrack, sampleInstrument: undefined, volume: 0.1 };
  const added: NoteClip = { id: "new", start: 18, length: 8, notes: [] };
  const patch = appendBasicClip(source, staleTrack, added);
  const changed = patch.tracks![0];
  assert.deepEqual(changed.noteClips, [original, added]);
  assert.equal(changed.sampleInstrument, currentTrack.sampleInstrument);
  assert.equal(changed.fx, currentTrack.fx);
  assert.equal(changed.volume, 0.7);
  assert.equal(patch.tracks![1], otherTrack);
  assert.equal(patch.bars, 7);
  assert.equal(patch.loopEndBeat, 26);
  assert.equal(source.tracks[0].noteClips.length, 1);
  assert.equal(source.loopEndBeat, 8);
});

test("a new track is added without turning on or moving a disabled loop", () => {
  const source = project([], { loopEnabled: false, loopStartBeat: 2, loopEndBeat: 6 });
  const newTrack = track("new-bass", "bass");
  const clip: NoteClip = { id: "bass-idea", start: 8, length: 8, notes: [] };
  const patch = appendBasicClip(source, newTrack, clip);
  assert.equal(patch.tracks!.length, 1);
  assert.equal(patch.tracks![0].id, newTrack.id);
  assert.deepEqual(patch.tracks![0].noteClips, [clip]);
  assert.equal(patch.loopEndBeat, 6);
  assert.equal(patch.loopEnabled, undefined);
  assert.equal(patch.loopStartBeat, undefined);
  assert.deepEqual(newTrack.noteClips, []);
});

test("song length includes trimmed recordings at the project tempo and excludes empty timeline space", () => {
  const notes = track("notes", "piano", [{ id: "phrase", start: 1, length: 4, notes: [] }]);
  const vocals = track("voice", "vocals");
  vocals.audioClips = [{ id: "take", start: 3, durationSec: 2.25, offsetSec: 10, sourceDurationSec: 60 }];
  assert.equal(basicSongEnd(project([notes, vocals], { bpm: 120, bars: 64 })), 8);
  assert.equal(basicSongEnd(project([vocals], { bpm: 60, bars: 64 })), 8);
  assert.equal(basicSongEnd(project([vocals], { bpm: 240, bars: 64 })), 12);
  assert.equal(basicSongEnd(project([])), 0);
});

test("Repeat keeps recordings and sound ownership, gives copies new IDs, and leaves source notes independent", () => {
  const phrase: NoteClip = {
    id: "phrase", start: 0, length: 8, name: "Original tune",
    notes: [{ note: "A3", time: 1, duration: 0.5, velocity: 0.6 }],
  };
  const keys = track("keys", "piano", [phrase]);
  keys.sampleInstrument = { blobKey: "custom-key", rootNote: 60 };
  const vocals = track("voice", "vocals");
  const blob = new Blob([new Uint8Array([1, 2, 3])]);
  vocals.audioClips = [{ id: "take", start: 3, durationSec: 2, offsetSec: 1, reversed: true, blob, blobKey: "source-take" }];
  const source = project([keys, vocals], { sections: [{ id: "intro", bar: 0, label: "Intro" }] });
  let count = 0;
  const patch = repeatBasicSong(source, () => `copy-${++count}`)!;
  const repeatedPhrase = patch.tracks![0].noteClips[1];
  const repeatedTake = patch.tracks![1].audioClips[1];
  assert.equal(repeatedPhrase.start, 8);
  assert.equal(repeatedTake.start, 11);
  assert.notEqual(repeatedPhrase.id, phrase.id);
  assert.notEqual(repeatedTake.id, vocals.audioClips[0].id);
  assert.notEqual(repeatedPhrase.id, repeatedTake.id);
  assert.equal(patch.tracks![0].sampleInstrument, keys.sampleInstrument);
  assert.equal(repeatedTake.blob, blob);
  assert.equal(repeatedTake.blobKey, "source-take");
  assert.equal(repeatedTake.offsetSec, 1);
  assert.equal(repeatedTake.reversed, true);
  repeatedPhrase.notes[0].note = "C4";
  assert.equal(phrase.notes[0].note, "A3");
  assert.equal(source.tracks[0].noteClips.length, 1);
  assert.equal(patch.bars, 4);
  assert.equal(patch.loopStartBeat, 0);
  assert.equal(patch.loopEndBeat, 16);
  assert.deepEqual(patch.sections!.map((section) => [section.bar, section.label]), [[0, "Intro"], [2, "Repeat"]]);
  assert.equal(source.sections!.length, 1);
});

test("Repeat resets automation cleanly at the seam without duplicate positions or shared copied points", () => {
  const keys = track("keys", "piano", [{ id: "phrase", start: 0, length: 8, notes: [] }]);
  keys.automationLanes = [{
    id: "volume-lane", param: "volume", interpolation: "linear",
    breakpoints: [{ beat: 0, value: 0.2 }, { beat: 4, value: 0.7 }, { beat: 8, value: 0.9 }],
  }];
  const before = structuredClone(keys.automationLanes);
  let count = 0;
  const patch = repeatBasicSong(project([keys]), () => `id-${++count}`)!;
  const lane = patch.tracks![0].automationLanes![0];
  assert.equal(new Set(lane.breakpoints.map((point) => point.beat)).size, lane.breakpoints.length);
  assert.equal(lane.breakpoints.find((point) => point.beat === 8)!.value, 0.2);
  assert.equal(lane.breakpoints.find((point) => point.beat === 12)!.value, 0.7);
  assert.equal(lane.breakpoints.find((point) => point.beat === 16)!.value, 0.9);
  lane.breakpoints.find((point) => point.beat === 12)!.value = 0.1;
  assert.deepEqual(keys.automationLanes, before);
});

test("Repeat is a no-op when no music has been added", () => {
  let called = false;
  assert.equal(repeatBasicSong(project([track("empty", "piano")]), () => { called = true; return "unexpected"; }), null);
  assert.equal(called, false);
});

test("repeated clicks add the original song once each instead of doubling existing repeats", () => {
  const source = project([track("keys", "piano", [{
    id: "original", start: 0, length: 8,
    notes: [{ note: "A3", time: 0, duration: 0.5, velocity: 0.7 }],
  }])]);
  let current = source;
  let count = 0;
  const id = () => `repeated-${++count}`;
  for (let repeat = 1; repeat <= 4; repeat++) {
    current = { ...current, ...repeatBasicSong(current, id, source) };
    assert.equal(current.tracks[0].noteClips.length, repeat + 1);
    assert.equal(basicSongEnd(current), (repeat + 1) * 8);
    assert.equal(current.loopEndBeat, (repeat + 1) * 8);
  }
  assert.deepEqual(current.tracks[0].noteClips.map((clip) => clip.start), [0, 8, 16, 24, 32]);
  assert.equal(new Set(current.tracks[0].noteClips.map((clip) => clip.id)).size, 5);
  assert.equal(source.tracks[0].noteClips.length, 1);
});

test("first-time learners get Basic and a tutor while existing Advanced users stay quiet", () => {
  const fresh = normalizeStoredSettings(null);
  assert.equal(fresh.uiMode, "beginner");
  assert.equal(fresh.tutorEnabled, true);
  assert.equal(fresh.tutorStep, 0);
  const existing = normalizeStoredSettings({ uiMode: "expert", themeId: "high-contrast", autosaveEnabled: false });
  assert.equal(existing.uiMode, "expert");
  assert.equal(existing.tutorEnabled, false);
  assert.equal(existing.themeId, "high-contrast");
  assert.equal(existing.autosaveEnabled, false);
  assert.equal(normalizeStoredSettings({ uiMode: "expert", tutorEnabled: true }).tutorEnabled, true);
  assert.equal(normalizeStoredSettings({ uiMode: "beginner", tutorEnabled: false }).tutorEnabled, false);
});

test("stored tutor progress is bounded and independent of the chosen version", () => {
  assert.equal(normalizeStoredSettings({ uiMode: "expert", tutorStep: 4.8 }).tutorStep, 4);
  assert.equal(normalizeStoredSettings({ tutorStep: -20 }).tutorStep, 0);
  assert.equal(normalizeStoredSettings({ tutorStep: 500 }).tutorStep, 7);
  for (const invalid of [Number.NaN, Infinity, "3", null]) {
    assert.equal(normalizeStoredSettings({ tutorStep: invalid }).tutorStep, 0);
  }
  assert.equal(normalizeStoredSettings({ uiMode: "unknown" }).uiMode, "beginner");
});
