import { assertSampleImportAllowed } from "../storage/performanceGuards";

export interface WaveformPeaks {
  mins: Float32Array;
  maxes: Float32Array;
  durationSec: number;
}

const peakCache = new WeakMap<Blob, Promise<WaveformPeaks>>();
const PEAK_POINTS = 2048;

export function getWaveformPeaks(blob: Blob): Promise<WaveformPeaks> {
  let pending = peakCache.get(blob);
  if (!pending) {
    pending = buildPeaks(blob);
    peakCache.set(blob, pending);
  }
  return pending;
}

export function drawWaveformPeaks(
  canvas: HTMLCanvasElement,
  peaks: WaveformPeaks,
  options: {
    offsetSec?: number;
    durationSec?: number;
    color?: string;
  } = {},
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = options.color ?? "rgba(0, 200, 255, 0.6)";

  const duration = Math.max(0.001, peaks.durationSec);
  const startRatio = Math.max(0, Math.min(1, (options.offsetSec ?? 0) / duration));
  const endRatio = Math.max(
    startRatio,
    Math.min(1, ((options.offsetSec ?? 0) + (options.durationSec ?? duration)) / duration),
  );
  const startPeak = Math.floor(startRatio * peaks.mins.length);
  const endPeak = Math.max(startPeak + 1, Math.ceil(endRatio * peaks.mins.length));
  const span = Math.max(1, endPeak - startPeak);

  for (let x = 0; x < w; x++) {
    const a = startPeak + Math.floor((x / w) * span);
    const b = startPeak + Math.max(a + 1 - startPeak, Math.floor(((x + 1) / w) * span));
    let min = 1;
    let max = -1;
    for (let i = a; i < Math.min(endPeak, b); i++) {
      min = Math.min(min, peaks.mins[i] ?? 0);
      max = Math.max(max, peaks.maxes[i] ?? 0);
    }
    const y1 = ((1 - max) / 2) * h;
    const y2 = ((1 - min) / 2) * h;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}

async function buildPeaks(blob: Blob): Promise<WaveformPeaks> {
  assertSampleImportAllowed(blob);
  const ac = new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  try {
    const arr = await blob.arrayBuffer();
    const buf = await ac.decodeAudioData(arr.slice(0));
    const data = buf.getChannelData(0);
    const mins = new Float32Array(PEAK_POINTS);
    const maxes = new Float32Array(PEAK_POINTS);
    const step = Math.max(1, Math.floor(data.length / PEAK_POINTS));
    for (let i = 0; i < PEAK_POINTS; i++) {
      let min = 1;
      let max = -1;
      const start = i * step;
      const end = Math.min(data.length, start + step);
      for (let j = start; j < end; j++) {
        const v = data[j] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      mins[i] = min;
      maxes[i] = max;
      if (i > 0 && i % 256 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    return { mins, maxes, durationSec: buf.duration };
  } finally {
    await ac.close();
  }
}
