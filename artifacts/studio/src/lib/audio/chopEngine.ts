/**
 * ChopEngine — manages 16 Tone.Player instances for the Chop Lab slice grid.
 *
 * Lifecycle:
 *   1. Call `loadBuffer(audioBuffer, markers, settings)` when a sample is
 *      loaded or when markers/settings change substantially.
 *   2. Call `triggerSlice(index)` from UI pad clicks / keyboard events.
 *   3. Call `dispose()` when the panel unmounts.
 *
 * Audio chain per slice:
 *   Player → Gain (normalize) → Tone.Destination
 *
 * Pitch shift is done via `player.playbackRate` (2^(semis/12)).
 * Fade in/out use the player's built-in `fadeIn`/`fadeOut` fields.
 * Reverse uses `player.reverse`.
 * Choke groups: stopping all sibling players before triggering.
 */

import * as Tone from "tone";

export interface ChopSliceSetting {
  reverse: boolean;
  pitch: number;
  normalize: boolean;
  fadeIn: number;
  fadeOut: number;
  chokeGroup: "none" | "A" | "B" | "C" | "D";
}

export const DEFAULT_SLICE_SETTING: ChopSliceSetting = {
  reverse: false,
  pitch: 0,
  normalize: false,
  fadeIn: 0,
  fadeOut: 0,
  chokeGroup: "none",
};

interface SlotEntry {
  player: Tone.Player;
  gain: Tone.Gain;
  sliceIndex: number;
  baseGain: number;
}

/** Compute peak amplitude of a Float32Array (channel data). */
function peakAmplitude(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/** Extract a mono-mixed slice from an AudioBuffer into a new AudioBuffer. */
function extractSlice(
  ctx: AudioContext | OfflineAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number,
): AudioBuffer {
  const sr = source.sampleRate;
  const startFrame = Math.max(0, Math.floor(startSec * sr));
  const endFrame = Math.min(source.length, Math.ceil(endSec * sr));
  const frames = Math.max(1, endFrame - startFrame);
  const numCh = source.numberOfChannels;
  const buf = ctx.createBuffer(numCh, frames, sr);
  for (let ch = 0; ch < numCh; ch++) {
    const src = source.getChannelData(ch);
    const dst = buf.getChannelData(ch);
    dst.set(src.subarray(startFrame, startFrame + frames));
  }
  return buf;
}

export class ChopEngine {
  private slots: SlotEntry[] = [];
  private sourceBuffer: AudioBuffer | null = null;
  private markers: number[] = [];
  private settings: ChopSliceSetting[] = [];
  private syncToBpm = false;
  private sampleBpm = 120;
  private projectBpm = 120;

  /** 
   * (Re)load the engine with a new source buffer + current markers + settings.
   * Disposes any existing players first.
   */
  loadBuffer(
    buffer: AudioBuffer,
    markers: number[],
    settings: ChopSliceSetting[],
  ) {
    this.disposeSlots();
    this.sourceBuffer = buffer;
    this.markers = markers.slice();
    this.settings = settings.slice();
    this.buildSlots();
  }

  /** Call this when markers or settings change without a full buffer reload. */
  reload(markers: number[], settings: ChopSliceSetting[]) {
    if (!this.sourceBuffer) return;
    this.disposeSlots();
    this.markers = markers.slice();
    this.settings = settings.slice();
    this.buildSlots();
  }

  /**
   * Update tempo-sync parameters.  Call whenever the toggle, sampleBpm, or
   * projectBpm changes.  Immediately re-applies playback rates to live slots.
   */
  setTempoSync(enabled: boolean, sampleBpm: number, projectBpm: number) {
    this.syncToBpm = enabled;
    this.sampleBpm = sampleBpm > 0 ? sampleBpm : 120;
    this.projectBpm = projectBpm > 0 ? projectBpm : 120;
    // Re-apply settings to all live slots so playback rates update immediately.
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot) this.applySettingsToSlot(slot, this.settings[i] ?? DEFAULT_SLICE_SETTING);
    }
  }

  /** Update a single slice's settings without rebuilding all slots. */
  updateSliceSetting(index: number, s: ChopSliceSetting) {
    if (index < 0 || index >= this.slots.length) return;
    this.settings[index] = s;
    const slot = this.slots[index];
    if (!slot) return;
    this.applySettingsToSlot(slot, s);
  }

  /**
   * Trigger a slice by pad index (0-based).
   * @param index - Slice index (0–15)
   * @param time  - Optional scheduled Tone.js time
   * @param velocity - Optional MIDI velocity 0..1 (default 1); scales playback gain
   */
  triggerSlice(index: number, time?: number, velocity: number = 1) {
    if (index < 0 || index >= this.slots.length) return;
    const slot = this.slots[index];
    if (!slot) return;
    const s = this.settings[index] ?? DEFAULT_SLICE_SETTING;

    // Apply velocity scaling on top of the normalized base gain.
    slot.gain.gain.value = slot.baseGain * Math.max(0, Math.min(1, velocity));

    // Choke group: stop all other players in the same group.
    if (s.chokeGroup !== "none") {
      for (let i = 0; i < this.slots.length; i++) {
        if (i === index) continue;
        const other = this.slots[i];
        const os = this.settings[i] ?? DEFAULT_SLICE_SETTING;
        if (other && os.chokeGroup === s.chokeGroup) {
          try { other.player.stop(time); } catch { /* ignore */ }
        }
      }
    }

    try {
      // Restart if already playing.
      if (slot.player.state === "started") {
        slot.player.stop(time);
      }
      if (time !== undefined) {
        slot.player.start(time);
      } else {
        slot.player.start();
      }
    } catch {
      // ignore
    }
  }

  /** Stop a specific slice. */
  stopSlice(index: number) {
    const slot = this.slots[index];
    if (!slot) return;
    try { slot.player.stop(); } catch { /* ignore */ }
  }

  /** Stop all active players. */
  stopAll() {
    for (const slot of this.slots) {
      try { slot.player.stop(); } catch { /* ignore */ }
    }
  }

  /** How many slices are loaded. */
  get sliceCount(): number {
    return this.slots.length;
  }

  /** Is a slot currently playing? */
  isPlaying(index: number): boolean {
    const slot = this.slots[index];
    return slot?.player.state === "started";
  }

  dispose() {
    this.disposeSlots();
    this.sourceBuffer = null;
  }

  // ---- internal ----

  private buildSlots() {
    const buf = this.sourceBuffer;
    if (!buf) return;
    const duration = buf.duration;

    // Build sorted boundary list: 0, marker1, marker2, …, duration
    const sorted = [0, ...this.markers.filter((m) => m > 0 && m < duration)].sort(
      (a, b) => a - b,
    );
    // Up to 16 slices
    const count = Math.min(16, sorted.length);

    // Use a plain AudioContext to extract sub-buffers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawCtx: AudioContext = (Tone.getContext().rawContext as any);

    for (let i = 0; i < count; i++) {
      const start = sorted[i];
      const end = i + 1 < sorted.length ? sorted[i + 1] : duration;
      const sliceBuf = extractSlice(rawCtx, buf, start, end);

      // Build ToneAudioBuffer supporting mono and stereo.
      const channels: Float32Array[] = [];
      for (let ch = 0; ch < sliceBuf.numberOfChannels; ch++) {
        channels.push(sliceBuf.getChannelData(ch));
      }
      const toneBuf = new Tone.ToneAudioBuffer();
      toneBuf.fromArray(channels.length === 1 ? channels[0] : channels);

      const gain = new Tone.Gain(1).toDestination();
      const player = new Tone.Player(toneBuf).connect(gain);

      const s = this.settings[i] ?? DEFAULT_SLICE_SETTING;
      const entry: SlotEntry = { player, gain, sliceIndex: i, baseGain: 1 };
      this.applySettingsToSlot(entry, s);

      this.slots.push(entry);
    }
  }

  private applySettingsToSlot(slot: SlotEntry, s: ChopSliceSetting) {
    const { player, gain } = slot;
    player.reverse = s.reverse;
    // Combine pitch-shift rate with tempo-sync ratio.
    const pitchRate = Math.pow(2, s.pitch / 12);
    const tempoRatio = this.syncToBpm && this.sampleBpm > 0
      ? this.projectBpm / this.sampleBpm
      : 1;
    player.playbackRate = pitchRate * tempoRatio;
    player.fadeIn = Math.max(0, s.fadeIn / 1000);
    player.fadeOut = Math.max(0, s.fadeOut / 1000);

    if (s.normalize && this.sourceBuffer) {
      // Compute normalization gain from the slice in the source buffer.
      // For simplicity, find peak across all channels.
      const slotIdx = slot.sliceIndex;
      const sorted = [0, ...this.markers].sort((a, b) => a - b);
      const start = sorted[slotIdx] ?? 0;
      const end = sorted[slotIdx + 1] ?? (this.sourceBuffer?.duration ?? 1);
      const sr = this.sourceBuffer.sampleRate;
      const startFrame = Math.floor(start * sr);
      const endFrame = Math.min(this.sourceBuffer.length, Math.ceil(end * sr));
      let peak = 0;
      for (let ch = 0; ch < this.sourceBuffer.numberOfChannels; ch++) {
        const data = this.sourceBuffer.getChannelData(ch);
        for (let f = startFrame; f < endFrame; f++) {
          const abs = Math.abs(data[f]);
          if (abs > peak) peak = abs;
        }
      }
      slot.baseGain = peak > 0.001 ? Math.min(4, 1 / peak) : 1;
    } else {
      slot.baseGain = 1;
    }
    gain.gain.value = slot.baseGain;
  }

  private disposeSlots() {
    for (const slot of this.slots) {
      try { slot.player.dispose(); } catch { /* ignore */ }
      try { slot.gain.dispose(); } catch { /* ignore */ }
    }
    this.slots = [];
  }
}

/**
 * Transient detection — windowed onset strength using energy difference.
 * Returns an array of times (seconds) where transients were detected,
 * sorted, capped at 16, including an initial marker at 0.
 */
export function detectTransients(
  buffer: AudioBuffer,
  sensitivity: number, // 0..1 — higher = more markers
): number[] {
  const sr = buffer.sampleRate;
  const hopSize = Math.round(sr * 0.01);   // 10ms hop
  const winSize = Math.round(sr * 0.04);   // 40ms window

  // Mix down to mono.
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < mono.length; i++) {
      mono[i] += data[i];
    }
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  }

  // Compute RMS energy per hop.
  const numHops = Math.floor((mono.length - winSize) / hopSize);
  const energy = new Float32Array(numHops);
  for (let h = 0; h < numHops; h++) {
    const offset = h * hopSize;
    let sum = 0;
    for (let i = 0; i < winSize; i++) {
      const s = mono[offset + i] ?? 0;
      sum += s * s;
    }
    energy[h] = Math.sqrt(sum / winSize);
  }

  // Onset function = positive energy difference (flux).
  const flux = new Float32Array(numHops);
  for (let h = 1; h < numHops; h++) {
    flux[h] = Math.max(0, energy[h] - energy[h - 1]);
  }

  // Dynamic threshold: mean + k*std of flux.
  let mean = 0;
  for (let h = 0; h < numHops; h++) mean += flux[h];
  mean /= numHops;
  let std = 0;
  for (let h = 0; h < numHops; h++) std += (flux[h] - mean) ** 2;
  std = Math.sqrt(std / numHops);

  // sensitivity 0..1 maps k from 4 (few) to 0.5 (many)
  const k = 4 - sensitivity * 3.5;
  const threshold = mean + k * std;

  // Collect peaks with minimum 80ms spacing.
  const minGapHops = Math.ceil(0.08 * sr / hopSize);
  const markers: number[] = [];
  let lastPeak = -minGapHops;

  for (let h = 1; h < numHops - 1; h++) {
    if (
      flux[h] > threshold &&
      flux[h] >= flux[h - 1] &&
      flux[h] >= flux[h + 1] &&
      h - lastPeak > minGapHops
    ) {
      const timeSec = (h * hopSize) / sr;
      // Skip very start (< 0.02s) — always add a 0 marker separately.
      if (timeSec > 0.02) {
        markers.push(timeSec);
        lastPeak = h;
      }
    }
  }

  // Cap at 15 additional markers (0 is implicit).
  return markers.slice(0, 15).sort((a, b) => a - b);
}

/**
 * Render a slice to a WAV Blob using an OfflineAudioContext.
 * Applies reverse, pitch (playbackRate), fadeIn/Out, and normalize.
 */
export async function renderSliceToWav(
  source: AudioBuffer,
  startSec: number,
  endSec: number,
  settings: ChopSliceSetting,
): Promise<ArrayBuffer> {
  const sr = source.sampleRate;
  const numCh = source.numberOfChannels;

  // Extract slice frames.
  const startFrame = Math.max(0, Math.floor(startSec * sr));
  const endFrame = Math.min(source.length, Math.ceil(endSec * sr));
  const frames = Math.max(1, endFrame - startFrame);

  // Duration after pitch shift (playback rate).
  const rate = Math.pow(2, settings.pitch / 12);
  const outFrames = Math.ceil(frames / rate);

  const ctx = new OfflineAudioContext(numCh, outFrames, sr);

  // Build offline buffer from slice.
  const sliceBuf = ctx.createBuffer(numCh, frames, sr);
  for (let ch = 0; ch < numCh; ch++) {
    const src = source.getChannelData(ch).subarray(startFrame, startFrame + frames);
    sliceBuf.getChannelData(ch).set(src);
  }

  // Normalize gain.
  let normGain = 1;
  if (settings.normalize) {
    let peak = 0;
    for (let ch = 0; ch < numCh; ch++) {
      const data = source.getChannelData(ch);
      for (let f = startFrame; f < startFrame + frames; f++) {
        const abs = Math.abs(data[f]);
        if (abs > peak) peak = abs;
      }
    }
    normGain = peak > 0.001 ? Math.min(4, 1 / peak) : 1;
  }

  const gainNode = ctx.createGain();
  gainNode.gain.value = normGain;

  // Fade in/out.
  const fadeInSec = Math.max(0, settings.fadeIn / 1000);
  const fadeOutSec = Math.max(0, settings.fadeOut / 1000);
  const durSec = outFrames / sr;
  if (fadeInSec > 0) {
    gainNode.gain.setValueAtTime(0, 0);
    gainNode.gain.linearRampToValueAtTime(normGain, Math.min(fadeInSec, durSec * 0.5));
  }
  if (fadeOutSec > 0) {
    const fadeStart = Math.max(0, durSec - fadeOutSec);
    gainNode.gain.setValueAtTime(normGain, fadeStart);
    gainNode.gain.linearRampToValueAtTime(0, durSec);
  }

  const src = ctx.createBufferSource();
  src.buffer = sliceBuf;
  src.playbackRate.value = rate;
  if (settings.reverse) src.buffer = reverseBuffer(ctx, sliceBuf);
  src.connect(gainNode);
  gainNode.connect(ctx.destination);
  src.start(0);

  const rendered = await ctx.startRendering();
  return audioBufferToWav(rendered);
}

function reverseBuffer(ctx: OfflineAudioContext, buf: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch).slice().reverse();
    out.getChannelData(ch).set(data);
  }
  return out;
}

/** Encode an AudioBuffer as a 16-bit PCM WAV ArrayBuffer. */
function audioBufferToWav(buf: AudioBuffer): ArrayBuffer {
  const numCh = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const numFrames = buf.length;
  const byteRate = sr * numCh * 2;
  const blockAlign = numCh * 2;
  const dataSize = numFrames * numCh * 2;
  const totalSize = 44 + dataSize;

  const ab = new ArrayBuffer(totalSize);
  const view = new DataView(ab);

  function writeStr(offset: number, s: string) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  }

  writeStr(0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let f = 0; f < numFrames; f++) {
    for (let ch = 0; ch < numCh; ch++) {
      const sample = Math.max(-1, Math.min(1, buf.getChannelData(ch)[f]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return ab;
}

/** Shared singleton for the Chop Lab panel. */
let _chopEngine: ChopEngine | null = null;
export function getChopEngine(): ChopEngine {
  if (!_chopEngine) _chopEngine = new ChopEngine();
  return _chopEngine;
}

/**
 * Estimate the BPM of an AudioBuffer using an onset-strength autocorrelation
 * approach.  Returns a value in the range [60, 200], rounded to the nearest
 * integer.  Falls back to 120 on failure.
 */
export function estimateBpm(buffer: AudioBuffer): number {
  try {
    const sr = buffer.sampleRate;
    // Downsample to ~22 050 Hz for speed.
    const dsRatio = Math.max(1, Math.floor(sr / 22050));
    const hopSize = 512;

    // Mix down to mono.
    const mono = new Float32Array(buffer.length);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i];
    }
    if (buffer.numberOfChannels > 1) {
      for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
    }

    // Compute RMS energy per hop (downsampled).
    const numHops = Math.floor(buffer.length / (hopSize * dsRatio));
    if (numHops < 32) return 120;

    const energy = new Float32Array(numHops);
    for (let h = 0; h < numHops; h++) {
      let sum = 0;
      const base = h * hopSize * dsRatio;
      for (let i = 0; i < hopSize * dsRatio && base + i < mono.length; i++) {
        const s = mono[base + i];
        sum += s * s;
      }
      energy[h] = Math.sqrt(sum / (hopSize * dsRatio));
    }

    // Onset strength: positive half-wave rectified energy flux.
    const onset = new Float32Array(numHops);
    for (let h = 1; h < numHops; h++) {
      onset[h] = Math.max(0, energy[h] - energy[h - 1]);
    }

    // Autocorrelation of the onset envelope over a BPM range [60..200].
    const secPerHop = (hopSize * dsRatio) / sr;
    const bpmMin = 60, bpmMax = 200;
    const lagMin = Math.floor(60 / (bpmMax * secPerHop));
    const lagMax = Math.ceil(60 / (bpmMin * secPerHop));

    let bestLag = lagMin;
    let bestScore = -Infinity;

    for (let lag = lagMin; lag <= lagMax; lag++) {
      let score = 0;
      for (let h = 0; h + lag < numHops; h++) {
        score += onset[h] * onset[h + lag];
      }
      // Also add half-lag harmonic boost.
      const halfLag = Math.round(lag / 2);
      if (halfLag >= 1) {
        for (let h = 0; h + halfLag < numHops; h++) {
          score += 0.5 * onset[h] * onset[h + halfLag];
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }

    const bpm = 60 / (bestLag * secPerHop);
    // Octave-fold into [60..200].
    let result = bpm;
    while (result < 60) result *= 2;
    while (result > 200) result /= 2;
    return Math.round(result);
  } catch {
    return 120;
  }
}
