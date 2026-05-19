/**
 * Sample editing utilities. Operate on AudioBuffer / Blob in pure
 * browser-only code: trim, normalize, reverse, fade, trim-silence.
 *
 * All functions return a new AudioBuffer (or Blob) — callers re-encode
 * to a WAV blob via `audioBufferToWavBlob` for persistence.
 */

export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const ac = new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext)();
  try {
    const arr = await blob.arrayBuffer();
    return await ac.decodeAudioData(arr.slice(0));
  } finally {
    await ac.close();
  }
}

function createBuffer(
  channels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  // OfflineAudioContext is more widely available than AudioBuffer ctor.
  const ctx = new OfflineAudioContext(channels, Math.max(1, length), sampleRate);
  return ctx.createBuffer(channels, Math.max(1, length), sampleRate);
}

export function trimBuffer(
  src: AudioBuffer,
  startSec: number,
  endSec: number,
): AudioBuffer {
  const sr = src.sampleRate;
  const startIdx = Math.max(0, Math.floor(startSec * sr));
  const endIdx = Math.min(src.length, Math.floor(endSec * sr));
  const len = Math.max(1, endIdx - startIdx);
  const out = createBuffer(src.numberOfChannels, len, sr);
  for (let c = 0; c < src.numberOfChannels; c++) {
    out.getChannelData(c).set(src.getChannelData(c).subarray(startIdx, endIdx));
  }
  return out;
}

export function normalizeBuffer(src: AudioBuffer, targetPeak = 0.98): AudioBuffer {
  let peak = 0;
  for (let c = 0; c < src.numberOfChannels; c++) {
    const data = src.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak <= 0) return src;
  const gain = targetPeak / peak;
  if (Math.abs(gain - 1) < 0.001) return src;
  const out = createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const inD = src.getChannelData(c);
    const outD = out.getChannelData(c);
    for (let i = 0; i < inD.length; i++) outD[i] = inD[i] * gain;
  }
  return out;
}

export function reverseBuffer(src: AudioBuffer): AudioBuffer {
  const out = createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const inD = src.getChannelData(c);
    const outD = out.getChannelData(c);
    const n = inD.length;
    for (let i = 0; i < n; i++) outD[i] = inD[n - 1 - i];
  }
  return out;
}

export function applyFades(
  src: AudioBuffer,
  fadeInSec: number,
  fadeOutSec: number,
): AudioBuffer {
  const sr = src.sampleRate;
  const inN = Math.min(src.length, Math.max(0, Math.floor(fadeInSec * sr)));
  const outN = Math.min(src.length, Math.max(0, Math.floor(fadeOutSec * sr)));
  if (inN === 0 && outN === 0) return src;
  const out = createBuffer(src.numberOfChannels, src.length, sr);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const inD = src.getChannelData(c);
    const outD = out.getChannelData(c);
    for (let i = 0; i < inD.length; i++) {
      let g = 1;
      if (inN > 0 && i < inN) g *= i / inN;
      if (outN > 0 && i >= inD.length - outN) g *= (inD.length - 1 - i) / outN;
      outD[i] = inD[i] * g;
    }
  }
  return out;
}

/**
 * Detect leading and trailing silence (below `threshold` peak) and return
 * a trimmed buffer with up to `pad` seconds of margin on each side.
 */
export function trimSilence(
  src: AudioBuffer,
  threshold = 0.005,
  pad = 0.02,
): AudioBuffer {
  const channels = src.numberOfChannels;
  const len = src.length;
  let first = len;
  let last = 0;
  for (let i = 0; i < len; i++) {
    let amp = 0;
    for (let c = 0; c < channels; c++) {
      const a = Math.abs(src.getChannelData(c)[i]);
      if (a > amp) amp = a;
    }
    if (amp > threshold) {
      if (i < first) first = i;
      if (i > last) last = i;
    }
  }
  if (first >= last) return src;
  const padN = Math.floor(pad * src.sampleRate);
  const startIdx = Math.max(0, first - padN);
  const endIdx = Math.min(len, last + padN);
  return trimBuffer(src, startIdx / src.sampleRate, endIdx / src.sampleRate);
}

/**
 * Encode an AudioBuffer to a 16-bit PCM WAV Blob — used to persist
 * edited samples back into IndexedDB.
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = channels[c][i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

/** Convenience: full edit pipeline -> WAV blob ready for save. */
export async function applyEditsToBlob(
  blob: Blob,
  edits: {
    trimStartSec?: number;
    trimEndSec?: number;
    normalize?: boolean;
    reverse?: boolean;
    fadeInSec?: number;
    fadeOutSec?: number;
  },
): Promise<{ blob: Blob; buffer: AudioBuffer }> {
  let buf = await decodeBlob(blob);
  const start = Math.max(0, edits.trimStartSec ?? 0);
  const end = Math.min(buf.duration, edits.trimEndSec ?? buf.duration);
  if (start > 0 || end < buf.duration) buf = trimBuffer(buf, start, end);
  if (edits.reverse) buf = reverseBuffer(buf);
  if (edits.fadeInSec || edits.fadeOutSec) {
    buf = applyFades(buf, edits.fadeInSec ?? 0, edits.fadeOutSec ?? 0);
  }
  if (edits.normalize) buf = normalizeBuffer(buf);
  return { blob: audioBufferToWavBlob(buf), buffer: buf };
}
