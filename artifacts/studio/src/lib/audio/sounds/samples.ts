/**
 * Sample resolver for the v2 sound model.
 *
 * Drum pieces and melodic presets both declare an optional
 * `SampleLayer[]`. Real audio files are expected to live under
 * `/public/samples/...` (mirrored as `/samples/...` at runtime by Vite).
 * This resolver:
 *
 *   1. Fetches and decodes each declared URL once, dropping unavailable
 *      layers without a separate `HEAD` round trip. A global three-job
 *      decode queue protects the audio/UI thread from large parallel bursts.
 *   2. Loads the survivors as Tone.Player buffers (drums) or hands a
 *      `urls` map to Tone.Sampler (melodic).
 *   3. Picks the right voice per hit by velocity window AND round-robin
 *      group, so successive hits in the same velocity band rotate
 *      through layered variations.
 *
 * If no layers exist OR no files are reachable, the resolver yields
 * `null` and the caller keeps its synthesized fallback path. Factory
 * instruments are bundled locally and loaded only when selected; the
 * default project and synthesis-only presets do not fetch sample assets.
 */

import * as Tone from "tone";
import type { SampleLayer } from "./types";

export interface DrumSampleBank {
  /** Fire one hit, honoring velocity-layer selection, round-robin
   *  rotation per group, and user pitch offset (in semitones). */
  trigger(time: number, velocity: number, pitchSemis: number): void;
  /** Hard-stop any currently sounding player (used by choke groups). */
  release(time: number): void;
  dispose(): void;
}

interface LoadedPlayer {
  layer: SampleLayer;
  player: Tone.Player;
}

export interface DecodedSampleLayer {
  layer: SampleLayer;
  buffer: AudioBuffer;
}

interface DecodedCacheEntry {
  promise: Promise<AudioBuffer>;
  buffer?: AudioBuffer;
  bytes: number;
  lastUsed: number;
}

const MAX_CONCURRENT_DECODES = 3;
const MAX_DECODED_CACHE_BYTES = 64 * 1024 * 1024;
const decodedBufferCache = new Map<string, DecodedCacheEntry>();
const decodeWaiters: Array<() => void> = [];
let activeDecodes = 0;
let decodedCacheBytes = 0;
let cacheClock = 0;

async function acquireDecodeSlot(): Promise<void> {
  if (activeDecodes < MAX_CONCURRENT_DECODES) {
    activeDecodes += 1;
    return;
  }
  await new Promise<void>((resolve) => decodeWaiters.push(resolve));
}

function releaseDecodeSlot(): void {
  const next = decodeWaiters.shift();
  if (next) {
    // Transfer the existing permit directly to the oldest waiter.
    next();
    return;
  }
  activeDecodes = Math.max(0, activeDecodes - 1);
}

async function withDecodeSlot<T>(job: () => Promise<T>): Promise<T> {
  await acquireDecodeSlot();
  try {
    return await job();
  } finally {
    releaseDecodeSlot();
  }
}

function estimateDecodedBytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
}

function evictDecodedBuffers(): void {
  if (decodedCacheBytes <= MAX_DECODED_CACHE_BYTES) return;
  const resolved = Array.from(decodedBufferCache.entries())
    .filter(([, entry]) => entry.buffer !== undefined)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [url, entry] of resolved) {
    if (decodedCacheBytes <= MAX_DECODED_CACHE_BYTES) break;
    if (!decodedBufferCache.delete(url)) continue;
    decodedCacheBytes = Math.max(0, decodedCacheBytes - entry.bytes);
  }
}

/**
 * De-duplicate in-flight fetch/decode work and retain a bounded LRU of
 * decoded PCM. Active Tone players/samplers keep their own references, while
 * discarded instruments can be collected instead of growing an unbounded
 * process-wide cache.
 */
function loadDecodedBuffer(url: string): Promise<AudioBuffer> {
  const existing = decodedBufferCache.get(url);
  if (existing) {
    existing.lastUsed = ++cacheClock;
    return existing.promise;
  }

  let entry: DecodedCacheEntry;
  const promise = withDecodeSlot(() => Tone.ToneAudioBuffer.load(url)).then(
    (buffer) => {
      if (decodedBufferCache.get(url) === entry) {
        entry.buffer = buffer;
        entry.bytes = estimateDecodedBytes(buffer);
        entry.lastUsed = ++cacheClock;
        decodedCacheBytes += entry.bytes;
        evictDecodedBuffers();
      }
      return buffer;
    },
    (error: unknown) => {
      if (decodedBufferCache.get(url) === entry) {
        decodedBufferCache.delete(url);
      }
      throw error;
    },
  );
  entry = { promise, bytes: 0, lastUsed: ++cacheClock };
  decodedBufferCache.set(url, entry);
  return promise;
}

export function getSampleCacheStats() {
  let inFlight = 0;
  let decodedBuffers = 0;
  for (const entry of decodedBufferCache.values()) {
    if (entry.buffer) decodedBuffers += 1;
    else inFlight += 1;
  }
  return {
    activeDecodes,
    inFlight,
    decodedBuffers,
    decodedBytes: decodedCacheBytes,
    maxDecodedBytes: MAX_DECODED_CACHE_BYTES,
    maxConcurrentDecodes: MAX_CONCURRENT_DECODES,
  } as const;
}

/** Fetch and decode one layer. A failed layer never blocks synth fallback. */
async function loadLayer(layer: SampleLayer): Promise<DecodedSampleLayer | null> {
  try {
    const buffer = await loadDecodedBuffer(layer.url);
    return { layer, buffer };
  } catch {
    return null;
  }
}

/** Decode the reachable subset of a layer declaration through the shared queue/cache. */
export async function loadSampleLayers(
  layers: SampleLayer[] | undefined,
): Promise<DecodedSampleLayer[]> {
  if (!layers?.length) return [];
  return (await Promise.all(layers.map(loadLayer))).filter(
    (item): item is DecodedSampleLayer => item !== null,
  );
}

/**
 * Attempt to load drum sample layers and connect them to `dest`. On
 * success returns a bank that handles velocity/round-robin selection;
 * on any failure (no layers, no files, decode errors) returns `null`
 * so the caller can keep its synth fallback.
 */
export async function tryLoadDrumSamples(
  layers: SampleLayer[] | undefined,
  dest: Tone.InputNode,
): Promise<DrumSampleBank | null> {
  if (!layers || layers.length === 0) return null;

  // Queue fetch/decode work. This replaces the old HEAD + GET path, which
  // doubled requests and failed on static hosts that do not implement HEAD.
  const decoded = await loadSampleLayers(layers);
  if (decoded.length === 0) return null;

  // Load the surviving samples into Tone.Players. If any decoding
  // fails, drop that layer and keep going — partial loads are useful.
  const loaded: LoadedPlayer[] = [];
  await Promise.all(
    decoded.map(async ({ layer, buffer }) => {
      try {
        const player = new Tone.Player({
          url: buffer,
          autostart: false,
        });
        player.connect(dest);
        loaded.push({ layer, player });
      } catch {
        // A single corrupt/incompatible layer must not discard the bank.
      }
    }),
  );
  if (loaded.length === 0) return null;

  // Round-robin cursor per group — layers without a group share a
  // single bucket so they still rotate together.
  const rrCursors = new Map<string, number>();

  return {
    trigger(time, velocity, pitchSemis) {
      // Velocity window selection. If none match (sparse layers),
      // fall back to all loaded so we always play *something*.
      let eligible = loaded.filter(
        (l) =>
          velocity >= l.layer.minVelocity && velocity <= l.layer.maxVelocity,
      );
      if (eligible.length === 0) eligible = loaded;
      const group = eligible[0].layer.roundRobinGroup ?? "_default";
      const cur = rrCursors.get(group) ?? 0;
      const pick = eligible[cur % eligible.length];
      rrCursors.set(group, cur + 1);
      try {
        pick.player.playbackRate = Math.pow(2, pitchSemis / 12);
        pick.player.volume.value = velocityToDb(velocity);
        pick.player.start(time);
      } catch {
        // ignore single-fire glitches
      }
    },
    release(time) {
      for (const { player } of loaded) {
        try {
          player.stop(time);
        } catch {
          // ignore
        }
      }
    },
    dispose() {
      for (const { player } of loaded) {
        try {
          player.dispose();
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * Load melodic preset layers and, when at least one file is reachable,
 * build a Tone.Sampler from the survivors keyed by `rootNote`. Returns
 * `null` to signal "no layers available — use synth fallback".
 */
export async function tryLoadMelodicSampler(
  layers: SampleLayer[] | undefined,
  options: {
    release?: number;
    attack?: number;
    volume?: number;
    shouldContinue?: () => boolean;
  } = {},
): Promise<Tone.Sampler | null> {
  if (!layers || layers.length === 0) return null;
  const decoded: DecodedSampleLayer[] = [];
  // Melodic factory instruments can contain several multi-megabyte zones.
  // Decode them one at a time and re-check ownership between files so a rapid
  // pack change cannot leave an obsolete preset saturating the decode queue.
  for (const layer of layers) {
    if (options.shouldContinue && !options.shouldContinue()) return null;
    const loaded = await loadLayer(layer);
    if (options.shouldContinue && !options.shouldContinue()) return null;
    if (loaded) decoded.push(loaded);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }
  if (decoded.length === 0) return null;

  // Build a { note -> decoded buffer } map. Layers without rootNote are ignored
  // because Tone.Sampler needs a base pitch to repitch from.
  const urls: Record<string, AudioBuffer> = {};
  for (const { layer, buffer } of decoded) {
    if (layer.rootNote) urls[layer.rootNote] = buffer;
  }
  if (Object.keys(urls).length === 0) return null;
  if (options.shouldContinue && !options.shouldContinue()) return null;

  try {
    return new Tone.Sampler({
      urls,
      release: options.release ?? 1,
      attack: options.attack ?? 0,
      volume: options.volume ?? -6,
    });
  } catch {
    return null;
  }
}

function velocityToDb(v: number): number {
  const clamped = Math.max(0.01, Math.min(1, v));
  return 20 * Math.log10(clamped);
}
