import assert from "node:assert/strict";
import test from "node:test";
import { LeanDrumTrackSettingsCache } from "../src/lib/audio/leanDrumTrackSettings";
import type { Track } from "../src/types";

function makeTrack(): Track {
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
    sound: { cutoff: 0.75, resonance: 0.2 },
  };
}

test("unchanged lean-drum settings do not reapply for repeated hits", () => {
  const cache = new LeanDrumTrackSettingsCache();
  const track = makeTrack();
  let applications = 0;

  const simulateHit = (nextTrack: Track) => {
    if (!cache.needsApply(nextTrack)) return;
    applications += 1;
    cache.markApplied(nextTrack);
  };

  for (let hit = 0; hit < 256; hit += 1) simulateHit(track);
  assert.equal(applications, 1);

  // Arrangement-only object changes must not touch native AudioParams.
  simulateHit({ ...track, name: "Renamed", noteClips: [{ id: "clip", start: 0, length: 4, notes: [] }] });
  assert.equal(applications, 1);
});

test("each relevant settings change applies once and lifecycle cleanup invalidates", () => {
  const cache = new LeanDrumTrackSettingsCache();
  let track = makeTrack();
  let applications = 0;
  const apply = () => {
    if (!cache.needsApply(track)) return;
    applications += 1;
    cache.markApplied(track);
  };

  apply();
  for (const patch of [
    { volume: 0.55 },
    { pan: -0.4 },
    { muted: true },
  ] satisfies Array<Partial<Track>>) {
    track = { ...track, ...patch };
    apply();
    apply();
  }
  track = { ...track, sound: { ...track.sound, cutoff: 0.35 } };
  apply();
  apply();
  track = { ...track, sound: { ...track.sound, resonance: 0.65 } };
  apply();
  apply();

  assert.equal(applications, 6);
  cache.delete(track.id);
  apply();
  assert.equal(applications, 7);
  cache.clear();
  apply();
  assert.equal(applications, 8);
});
