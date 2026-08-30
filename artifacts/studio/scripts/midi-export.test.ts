import assert from "node:assert/strict";
import test from "node:test";
import { encodeSingleTrackMidi, noteNameToMidi } from "../src/lib/export/midi";
import type { Project, Track } from "../src/types";

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readVlq(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let cursor = offset;
  for (let count = 0; count < 4; count++) {
    const byte = bytes[cursor++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: cursor };
  }
  throw new Error("Invalid VLQ");
}

function fixture(track: Track): Project {
  return {
    id: "midi-fixture",
    name: "MIDI fixture",
    bpm: 120,
    bars: 4,
    tracks: [track],
  } as Project;
}

function trackData(bytes: Uint8Array): Uint8Array {
  const tempoLength = readU32(bytes, 18);
  const trackStart = 22 + tempoLength;
  assert.equal(new TextDecoder().decode(bytes.slice(trackStart, trackStart + 4)), "MTrk");
  const length = readU32(bytes, trackStart + 4);
  return bytes.slice(trackStart + 8, trackStart + 8 + length);
}

test("note parser handles lowercase, flats, and MIDI range clamping", () => {
  assert.equal(noteNameToMidi("c4"), 60);
  assert.equal(noteNameToMidi("Db4"), 61);
  assert.equal(noteNameToMidi("C20"), 127);
});

test("MIDI track names use UTF-8 with a VLQ byte length", () => {
  const track = {
    id: "keys",
    name: "Ninja 鍵盤 🎹",
    kind: "piano",
    noteClips: [],
  } as Track;
  const data = trackData(encodeSingleTrackMidi(fixture(track), track));
  let cursor = 0;
  const delta = readVlq(data, cursor);
  cursor = delta.next;
  assert.equal(delta.value, 0);
  assert.deepEqual(Array.from(data.slice(cursor, cursor + 2)), [0xff, 0x03]);
  cursor += 2;
  const length = readVlq(data, cursor);
  const decoded = new TextDecoder().decode(data.slice(length.next, length.next + length.value));
  assert.equal(decoded, track.name);
});

test("same-note overlaps are shortened and note-off sorts before retrigger", () => {
  const track = {
    id: "keys",
    name: "Overlap",
    kind: "piano",
    noteClips: [
      {
        id: "clip",
        start: 0,
        notes: [
          { note: "C4", time: 0, duration: 2, velocity: 0.8 },
          { note: "C4", time: 1, duration: 1, velocity: 0.7 },
        ],
      },
    ],
  } as Track;
  const data = trackData(encodeSingleTrackMidi(fixture(track), track));

  let cursor = 0;
  let tick = 0;
  const noteEvents: Array<{ tick: number; status: number; note: number }> = [];
  while (cursor < data.length) {
    const delta = readVlq(data, cursor);
    tick += delta.value;
    cursor = delta.next;
    const status = data[cursor++];
    if (status === 0xff) {
      const type = data[cursor++];
      const length = readVlq(data, cursor);
      cursor = length.next + length.value;
      if (type === 0x2f) break;
      continue;
    }
    const note = data[cursor++];
    cursor++; // velocity
    noteEvents.push({ tick, status: status & 0xf0, note });
  }

  assert.deepEqual(noteEvents, [
    { tick: 0, status: 0x90, note: 60 },
    { tick: 480, status: 0x80, note: 60 },
    { tick: 480, status: 0x90, note: 60 },
    { tick: 960, status: 0x80, note: 60 },
  ]);
});
