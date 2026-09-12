import assert from "node:assert/strict";
import test from "node:test";
import { decodeInstrumentSample } from "../src/lib/audio/sampleInstrumentDecode";

test("sample decoding caps simultaneous work, coalesces copies and skips disposed queued instruments", async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const finishes: Array<() => void> = [];
  const pcm = {} as AudioBuffer;
  const context = {
    decodeAudioData() {
      calls++; active++; peak = Math.max(peak, active);
      return new Promise<AudioBuffer>((resolve) => finishes.push(() => { active--; resolve(pcm); }));
    },
  } as unknown as BaseAudioContext;
  const blobs = Array.from({ length: 5 }, (_, i) => new Blob([String(i)]));
  let queuedCurrent = true;
  const jobs = blobs.map((blob, i) => decodeInstrumentSample(blob, context, () => i !== 3 || queuedCurrent));
  const shared = decodeInstrumentSample(blobs[0], context, () => true);
  assert.equal(shared, jobs[0]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 3);
  queuedCurrent = false;
  finishes.splice(0).forEach((finish) => finish());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 1);
  finishes.splice(0).forEach((finish) => finish());
  const outputs = await Promise.all(jobs);
  assert.equal(peak, 3);
  assert.equal(calls, 4);
  assert.equal(outputs[3], null);
  assert.equal(outputs[0], await shared);
});

test("completed or failed decode entries release the cache so a later relink can retry", async () => {
  let calls = 0;
  const context = {
    async decodeAudioData() {
      calls++;
      if (calls === 1) throw new Error("Unreadable sample");
      return {} as AudioBuffer;
    },
  } as unknown as BaseAudioContext;
  const blob = new Blob(["source"]);
  await assert.rejects(decodeInstrumentSample(blob, context, () => true), /Unreadable sample/);
  await new Promise((resolve) => setImmediate(resolve));
  await decodeInstrumentSample(blob, context, () => true);
  await new Promise((resolve) => setImmediate(resolve));
  await decodeInstrumentSample(blob, context, () => true);
  assert.equal(calls, 3);
});
