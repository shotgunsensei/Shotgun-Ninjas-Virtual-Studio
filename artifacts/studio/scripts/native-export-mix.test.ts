import assert from "node:assert/strict";
import test from "node:test";
import type { Track } from "../src/types";
import {
  resolveNativeAssignedPadVolume,
  resolveNativeTrackRenderControls,
} from "../src/lib/audio/export";

const baseTrack = {
  eq: { low: 5, mid: -3, high: 2, hpfOn: true, hpfHz: 140 },
  sound: { drive: 0.8, width: 0.9 },
} as Pick<Track, "eq" | "sound" | "fxRack">;

test("native export keeps persisted static sound controls when no rack override exists", () => {
  const controls = resolveNativeTrackRenderControls(baseTrack);
  assert.deepEqual(controls.eq, baseTrack.eq);
  assert.equal(controls.width, 0.9);
  assert.ok(Math.abs(controls.driveAmount - 0.72) < 1e-9);
  assert.equal(controls.bits, 16);
});

test("explicitly bypassed rack modules flatten the same controls as live rehydration", () => {
  const controls = resolveNativeTrackRenderControls({
    ...baseTrack,
    fxRack: {
      eq: { enabled: false },
      saturation: { enabled: false },
      stereoWidth: { enabled: false },
      bitcrusher: { enabled: false },
    },
  });
  assert.deepEqual(controls.eq, {
    low: 0,
    mid: 0,
    high: 0,
    hpfOn: false,
    hpfHz: 20,
  });
  assert.equal(controls.width, 0.5);
  assert.equal(controls.driveAmount, 0);
  assert.equal(controls.bits, 16);
});

test("enabled rack modules override static width and add bounded drive/bit depth", () => {
  const controls = resolveNativeTrackRenderControls({
    ...baseTrack,
    fxRack: {
      saturation: { enabled: true, amount: 0.4 },
      stereoWidth: { enabled: true, amount: 0.2 },
      bitcrusher: { enabled: true, params: { bits: 0.5 } },
    },
  });
  assert.equal(controls.width, 0.2);
  assert.ok(Math.abs(controls.driveAmount - 0.72) < 1e-9);
  assert.equal(controls.bits, 9);
});

test("assigned-pad export inherits a non-unity kit volume without a user override", () => {
  assert.equal(resolveNativeAssignedPadVolume(undefined, 0.67), 0.67);
  assert.equal(resolveNativeAssignedPadVolume({ volume: 0.9 }, 0.67), 0.9);
});
