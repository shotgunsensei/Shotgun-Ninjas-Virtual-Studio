import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  FACTORY_INSTRUMENT_COUNT,
  FACTORY_SAMPLE_COUNT,
  isFactorySampleUrl,
} from "../src/lib/audio/sounds/factorySamples";
import { MELODIC_PRESETS } from "../src/lib/audio/sounds/presets";

interface ManifestSample {
  instrument: string;
  rootNote: string;
  file: string;
  bytes: number;
  sha256: string;
  sourcePath: string;
  sourceBlobSha1: string;
}

interface FactoryManifest {
  schemaVersion: number;
  sourceRepository: string;
  sourceCommit: string;
  license: string;
  licenseFile: string;
  licenseSha256: string;
  licenseSourceBlobSha1: string;
  totalBytes: number;
  samples: ManifestSample[];
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = resolve(SCRIPT_DIR, "..");
const FACTORY_ROOT = resolve(STUDIO_ROOT, "public", "samples", "factory", "vcsl");
const URL_PREFIX = "/samples/factory/vcsl/";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inspectWave(bytes: Buffer, label: string) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF", `${label} is not RIFF`);
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE", `${label} is not WAVE`);

  let cursor = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataBytes = 0;
  let dataOffset = 0;
  while (cursor + 8 <= bytes.length) {
    const id = bytes.toString("ascii", cursor, cursor + 4);
    const size = bytes.readUInt32LE(cursor + 4);
    const body = cursor + 8;
    assert.ok(body + size <= bytes.length, `${label} has a truncated ${id} chunk`);
    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: bytes.readUInt16LE(body),
        channels: bytes.readUInt16LE(body + 2),
        sampleRate: bytes.readUInt32LE(body + 4),
        bits: bytes.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      dataOffset = body;
      dataBytes += size;
      // Some source WAVs omit the optional pad byte before trailing INFO
      // metadata. The audio-bearing chunks are complete at this point; hashes
      // protect the remaining bytes, so do not reject valid PCM on metadata
      // alignment differences between authoring tools.
      if (format) break;
    }
    cursor = body + size + (size % 2);
  }

  assert.ok(format, `${label} has no fmt chunk`);
  assert.equal(format.audioFormat, 1, `${label} must contain uncompressed PCM`);
  assert.ok(format.channels >= 1 && format.channels <= 2, `${label} has unsafe channel count`);
  assert.ok(format.sampleRate >= 22_050 && format.sampleRate <= 192_000, `${label} has unsafe sample rate`);
  assert.ok([16, 24, 32].includes(format.bits), `${label} has unsupported bit depth`);
  assert.ok(dataBytes > 0, `${label} has no audio frames`);
  return { ...format, dataBytes, dataOffset };
}

async function readManifest(): Promise<FactoryManifest> {
  return JSON.parse(
    await readFile(resolve(FACTORY_ROOT, "SOURCES.json"), "utf8"),
  ) as FactoryManifest;
}

test("factory sample manifest is pinned, compact, and internally complete", async () => {
  const manifest = await readManifest();
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sourceRepository, "https://github.com/sgossner/VCSL");
  assert.equal(manifest.sourceCommit, "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e");
  assert.equal(manifest.license, "CC0-1.0");
  assert.match(manifest.licenseSourceBlobSha1, /^[a-f0-9]{40}$/);
  assert.equal(manifest.samples.length, 32);
  assert.equal(manifest.samples.length, FACTORY_SAMPLE_COUNT);
  assert.equal(new Set(manifest.samples.map((sample) => sample.instrument)).size, 7);
  assert.equal(FACTORY_INSTRUMENT_COUNT, 7);
  assert.ok(manifest.totalBytes <= 43 * 1024 * 1024, "factory subset exceeds its 43 MiB budget");
  assert.equal(
    manifest.samples.reduce((sum, sample) => sum + sample.bytes, 0),
    manifest.totalBytes,
  );

  const files = new Set<string>();
  for (const sample of manifest.samples) {
    assert.ok(!files.has(sample.file), `duplicate manifest file: ${sample.file}`);
    files.add(sample.file);
    assert.match(sample.sourceBlobSha1, /^[a-f0-9]{40}$/);
    assert.match(sample.sha256, /^[a-f0-9]{64}$/);

    const path = resolve(FACTORY_ROOT, sample.file);
    assert.ok(path.startsWith(`${FACTORY_ROOT}\\`), `${sample.file} escapes factory root`);
    const bytes = await readFile(path);
    assert.equal((await stat(path)).size, sample.bytes, `${sample.file} byte size changed`);
    assert.equal(sha256(bytes), sample.sha256, `${sample.file} SHA-256 changed`);
    inspectWave(bytes, sample.file);
  }

  const license = await readFile(resolve(FACTORY_ROOT, manifest.licenseFile));
  assert.equal(sha256(license), manifest.licenseSha256, "license file SHA-256 changed");
  assert.match(license.toString("utf8"), /CC0 1\.0 Universal/i);
});

test("every factory preset layer resolves to a manifested same-origin WAV", async () => {
  const manifest = await readManifest();
  const files = new Set(manifest.samples.map((sample) => sample.file.replaceAll("\\", "/")));
  const factoryPresets = MELODIC_PRESETS.filter((preset) =>
    preset.layers?.some((layer) => isFactorySampleUrl(layer.url)),
  );
  assert.equal(factoryPresets.length, FACTORY_INSTRUMENT_COUNT);

  for (const preset of factoryPresets) {
    assert.ok(preset.guide, `${preset.id} needs an educational instrument guide`);
    assert.ok(preset.layers?.length, `${preset.id} needs sample layers`);
    for (const layer of preset.layers ?? []) {
      assert.ok(isFactorySampleUrl(layer.url), `${preset.id} mixes external sample URLs`);
      assert.ok(layer.rootNote, `${layer.id} needs a root note`);
      const relative = layer.url.slice(URL_PREFIX.length);
      assert.ok(files.has(relative), `${layer.url} is missing from SOURCES.json`);
      assert.equal(layer.rootNote, manifest.samples.find((sample) => sample.file === relative)?.rootNote,
        `${layer.id} keyboard mapping disagrees with its provenance manifest`);
      await stat(resolve(FACTORY_ROOT, relative));
    }
  }
});

test("each factory instrument maps its recorded pitch to the correct keyboard octave", async () => {
  const manifest = await readManifest();
  // Midrange representatives avoid missing fundamentals in very low piano
  // strings and non-harmonic transients in extreme-register acoustic samples.
  const representatives = ["kawai-grand/c3.wav", "tx81z-piano/c3.wav", "folk-harp/c3.wav",
    "vibraphone/c3.wav", "tanzanian-kalimba/cs3.wav", "ocarina/cs4.wav", "tenor-sax-staccato/c3.wav"];
  for (const file of representatives) {
    const sample = manifest.samples.find((entry) => entry.file === file)!;
    const bytes = await readFile(resolve(FACTORY_ROOT, file));
    const wave = inspectWave(bytes, file);
    const stride = wave.channels * wave.bits / 8;
    const start = Math.min(Math.floor(wave.sampleRate * 0.13), Math.floor(wave.dataBytes / stride / 4));
    const frames = Math.min(8192, Math.floor(wave.dataBytes / stride) - start);
    const pcm = new Float64Array(frames);
    for (let i = 0; i < frames; i++) {
      pcm[i] = bytes.readIntLE(wave.dataOffset + (start + i) * stride, wave.bits / 8) / 2 ** (wave.bits - 1)
        * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frames - 1)));
    }
    const [, pitch, sharp, octave] = /^([A-G])(#?)(\d)$/.exec(sample.rootNote)!;
    const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[pitch]!;
    const midi = (Number(octave) + 1) * 12 + semitone + (sharp ? 1 : 0);
    const expectedHz = 440 * 2 ** ((midi - 69) / 12);
    const bandEnergy = (hz: number) => {
      let peak = 0;
      // Preserve natural acoustic tuning; this catches octave-label errors,
      // not cents of vibrato/inharmonicity. Goertzel needs no DSP dependency.
      for (let cents = -60; cents <= 60; cents += 2) {
        const coefficient = 2 * Math.cos(2 * Math.PI * hz * 2 ** (cents / 1200) / wave.sampleRate);
        let previous = 0;
        let previous2 = 0;
        for (const value of pcm) {
          const current = value + coefficient * previous - previous2;
          previous2 = previous;
          previous = current;
        }
        peak = Math.max(peak, previous ** 2 + previous2 ** 2 - coefficient * previous * previous2);
      }
      return peak;
    };
    assert.ok(bandEnergy(expectedHz) > bandEnergy(expectedHz / 2) * 100,
      `${file}: declared ${sample.rootNote} must carry the fundamental, not an octave harmonic`);
    // The old (one octave low) root has almost no signal in these recordings.
    assert.ok(bandEnergy(expectedHz) > 0.01, `${file}: declared pitch has no measurable energy`);
  }
});
