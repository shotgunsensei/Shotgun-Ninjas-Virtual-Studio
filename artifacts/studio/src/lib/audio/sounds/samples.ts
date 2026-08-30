/**
 * Sample resolver for the v2 sound model.
 *
 * Drum pieces and melodic presets both declare an optional
 * `SampleLayer[]`. Real audio files are expected to live under
 * `/public/samples/...` (mirrored as `/samples/...` at runtime by Vite).
 * This resolver:
 *
 *   1. Fetches and decodes each declared URL once, dropping unavailable
 *      layers without a separate `HEAD` round trip.
 *   2. Loads the survivors as Tone.Player buffers (drums) or hands a
 *      `urls` map to Tone.Sampler (melodic).
 *   3. Picks the right voice per hit by velocity window AND round-robin
 *      group, so successive hits in the same velocity band rotate
 *      through layered variations.
 *
 * If no layers exist OR no files are reachable, the resolver yields
 * `null` and the caller keeps its synthesized fallback path. This is
 * the path the project ships on today — the resolver is wired and
 * active, but no sample assets are bundled yet, so synthesis is what
 * users hear until samples are dropped into `public/samples/`.
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

interface LoadedLayer {
  layer: SampleLayer;
  buffer: AudioBuffer;
}

/** Fetch and decode one layer. A failed layer never blocks synth fallback. */
async function loadLayer(layer: SampleLayer): Promise<LoadedLayer | null> {
  try {
    const buffer = await Tone.ToneAudioBuffer.load(layer.url);
    return { layer, buffer };
  } catch {
    return null;
  }
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

  // Fetch/decode in parallel. This replaces the old HEAD + GET path, which
  // doubled requests and failed on static hosts that do not implement HEAD.
  const decoded = (await Promise.all(layers.map(loadLayer))).filter(
    (item): item is LoadedLayer => item !== null,
  );
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
  options: { release?: number; attack?: number; volume?: number } = {},
): Promise<Tone.Sampler | null> {
  if (!layers || layers.length === 0) return null;
  const decoded = (await Promise.all(layers.map(loadLayer))).filter(
    (item): item is LoadedLayer => item !== null,
  );
  if (decoded.length === 0) return null;

  // Build a { note -> decoded buffer } map. Layers without rootNote are ignored
  // because Tone.Sampler needs a base pitch to repitch from.
  const urls: Record<string, AudioBuffer> = {};
  for (const { layer, buffer } of decoded) {
    if (layer.rootNote) urls[layer.rootNote] = buffer;
  }
  if (Object.keys(urls).length === 0) return null;

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
