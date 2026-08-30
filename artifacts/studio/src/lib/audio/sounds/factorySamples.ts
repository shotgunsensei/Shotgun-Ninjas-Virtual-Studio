import type { SampleLayer } from "./types";

export const FACTORY_SAMPLE_SOURCE = {
  name: "Versilian Community Sample Library (VCSL)",
  repository: "https://github.com/sgossner/VCSL",
  license: "CC0-1.0",
  manifestUrl: "/samples/factory/vcsl/SOURCES.json",
} as const;

const BASE = "/samples/factory/vcsl";

function chromaticLayers(
  instrument: string,
  samples: ReadonlyArray<readonly [rootNote: string, filename: string]>,
): SampleLayer[] {
  return samples.map(([rootNote, filename]) => ({
    id: `vcsl.${instrument}.${rootNote.toLowerCase().replace("#", "s")}`,
    url: `${BASE}/${instrument}/${filename}`,
    minVelocity: 0,
    maxVelocity: 1,
    rootNote,
  }));
}

/**
 * Compact, locally bundled CC0 factory instruments. Files are fetched and
 * hash-verified by `scripts/fetch-vcsl-factory-samples.mjs`; the full source
 * paths and SHA-256 values live beside the audio in `SOURCES.json`.
 */
export const VCSL_FACTORY_LAYERS = {
  tx81zPiano: chromaticLayers("tx81z-piano", [
    ["C1", "c1.wav"],
    ["C2", "c2.wav"],
    ["C3", "c3.wav"],
    ["C4", "c4.wav"],
    ["C5", "c5.wav"],
    ["C6", "c6.wav"],
  ]),
  folkHarp: chromaticLayers("folk-harp", [
    ["C2", "c2.wav"],
    ["C3", "c3.wav"],
    ["C4", "c4.wav"],
    ["C5", "c5.wav"],
  ]),
  vibraphone: chromaticLayers("vibraphone", [
    ["F2", "f2.wav"],
    ["C3", "c3.wav"],
    ["D4", "d4.wav"],
    ["C5", "c5.wav"],
  ]),
  tanzanianKalimba: chromaticLayers("tanzanian-kalimba", [
    ["C#2", "cs2.wav"],
    ["C#3", "cs3.wav"],
    ["C#4", "cs4.wav"],
    ["C#5", "cs5.wav"],
  ]),
  ocarina: chromaticLayers("ocarina", [
    ["A3", "a3.wav"],
    ["C#4", "cs4.wav"],
    ["E4", "e4.wav"],
    ["C5", "c5.wav"],
  ]),
  tenorSaxStaccato: chromaticLayers("tenor-sax-staccato", [
    ["C2", "c2.wav"],
    ["C3", "c3.wav"],
    ["C4", "c4.wav"],
    ["C5", "c5.wav"],
  ]),
} as const;

export const FACTORY_INSTRUMENT_COUNT = Object.keys(VCSL_FACTORY_LAYERS).length;
export const FACTORY_SAMPLE_COUNT = Object.values(VCSL_FACTORY_LAYERS).reduce(
  (count, layers) => count + layers.length,
  0,
);

export function isFactorySampleUrl(url: string): boolean {
  return url.startsWith(`${BASE}/`);
}
