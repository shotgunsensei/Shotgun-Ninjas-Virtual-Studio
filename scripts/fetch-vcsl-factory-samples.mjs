import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_REPOSITORY = "https://github.com/sgossner/VCSL";
const SOURCE_COMMIT = "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e";
const LICENSE_ID = "CC0-1.0";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_ROOT = resolve(
  SCRIPT_DIR,
  "..",
  "artifacts",
  "studio",
  "public",
  "samples",
  "factory",
  "vcsl",
);

const samples = [
  sample("tx81z-piano", "C1", "c1.wav", "Electrophones/TX81Z/Piano 1/Piano 1_C1_vl2.wav", "ca1fec535245278a946b32e6593cea97b676fa45"),
  sample("tx81z-piano", "C2", "c2.wav", "Electrophones/TX81Z/Piano 1/Piano 1_C2_vl2.wav", "f6aa254b39d225b221acba74163162b61fa5c173"),
  sample("tx81z-piano", "C3", "c3.wav", "Electrophones/TX81Z/Piano 1/Piano 1_C3_vl2.wav", "0b0fb00300ac4475e352265b39e2d99aad46e399"),
  sample("tx81z-piano", "C4", "c4.wav", "Electrophones/TX81Z/Piano 1/Piano 1_C4_vl2.wav", "934b9bc821dd2a98932f4e06ecbcbcbae40d787f"),
  sample("tx81z-piano", "C5", "c5.wav", "Electrophones/TX81Z/Piano 1/Piano 1_C5_vl2.wav", "026c1d3732d1149569579c19076d97d4e9022c45"),
  sample("tx81z-piano", "C6", "c6.wav", "Electrophones/TX81Z/Piano 1/Piano 1_C6_vl2.wav", "60b435e452dbb74442b27417fe07c11ed055ef15"),

  sample("folk-harp", "C2", "c2.wav", "Chordophones/Composite Chordophones/Folk Harp/EWHarp_Normal_C2_v2_RR1.wav", "086a2c7ffc1097a4809cdc3ec100075d2530a231"),
  sample("folk-harp", "C3", "c3.wav", "Chordophones/Composite Chordophones/Folk Harp/EWHarp_Normal_C3_v2_RR1.wav", "3ac7ac020fc58cf16430fc249e5776d9c4a71702"),
  sample("folk-harp", "C4", "c4.wav", "Chordophones/Composite Chordophones/Folk Harp/EWHarp_Normal_C4_v2_RR1.wav", "7118eaa188436970e23b28019b5b6e7fe6a1b5ef"),
  sample("folk-harp", "C5", "c5.wav", "Chordophones/Composite Chordophones/Folk Harp/EWHarp_Normal_C5_v2_RR1.wav", "b70f08e86b506b0f9df03a47a6ba34669e41328b"),

  sample("vibraphone", "F2", "f2.wav", "Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_F2_v2_rr1_Main.wav", "64850722b8a33ec142bc565ed211747ec5da8d5c"),
  sample("vibraphone", "C3", "c3.wav", "Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_C3_v2_rr1_Main.wav", "a64d53d2379e9f74b772fea58154e2b28c75915a"),
  sample("vibraphone", "D4", "d4.wav", "Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_D4_v2_rr1_Main.wav", "608c881830b1e7887054cff275de3ce9e98f8581"),
  sample("vibraphone", "C5", "c5.wav", "Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_C5_v2_rr1_Main.wav", "4477796d52b9bac86c9c9e47c33d085bd7d4581c"),

  sample("tanzanian-kalimba", "C#2", "cs2.wav", "Idiophones/Plucked Idiophones/Kalimba, Tanzania/MBira3_pluck_Main_C#2_k10_50_100_rr2.wav", "3d3582a2ac15ad9e7386e3d6a079e92c93ae43a4"),
  sample("tanzanian-kalimba", "C#3", "cs3.wav", "Idiophones/Plucked Idiophones/Kalimba, Tanzania/MBira3_pluck_Main_C#3_k16_50_100_rr2.wav", "2f54d3673ff420cf68a3e033852794cc4198d938"),
  sample("tanzanian-kalimba", "C#4", "cs4.wav", "Idiophones/Plucked Idiophones/Kalimba, Tanzania/MBira3_pluck_Main_C#4_k5_50_100_rr2.wav", "d5609bd3ca8d16fff82e4c380c189122a0d00484"),
  sample("tanzanian-kalimba", "C#5", "cs5.wav", "Idiophones/Plucked Idiophones/Kalimba, Tanzania/MBira3_pluck_Main_C#5_k24_50_100_rr2.wav", "af397239194031376122e9115b184336e6820709"),

  sample("ocarina", "A3", "a3.wav", "Aerophones/Edge-blown Aerophones/Ocarina, Typical/Sustains/Sus/StdOcarina_Sus_A3.wav", "125b995839f7b562e6ade1f1398682ba5ef5c85b"),
  sample("ocarina", "C#4", "cs4.wav", "Aerophones/Edge-blown Aerophones/Ocarina, Typical/Sustains/Sus/StdOcarina_Sus_C#4.wav", "746b7ac46d2943ac829e194aca2ced4914a89a0c"),
  sample("ocarina", "E4", "e4.wav", "Aerophones/Edge-blown Aerophones/Ocarina, Typical/Sustains/Sus/StdOcarina_Sus_E4.wav", "dc938241a8c5f00ec53ce79c1ed0b9e77dc16db0"),
  sample("ocarina", "C5", "c5.wav", "Aerophones/Edge-blown Aerophones/Ocarina, Typical/Sustains/Sus/StdOcarina_Sus_C5.wav", "7568769951199353ab174baaab3491c41f43bf06"),

  sample("tenor-sax-staccato", "C2", "c2.wav", "Aerophones/Reed Aerophones/Tenor Saxophone/Staccato/BrettTenor_Staccato_Main_C2_vl2_rr1.wav", "6932419ba341344205e720c7ca2495cf597b2a71"),
  sample("tenor-sax-staccato", "C3", "c3.wav", "Aerophones/Reed Aerophones/Tenor Saxophone/Staccato/BrettTenor_Staccato_Main_C3_vl2_rr4.wav", "0a8dbc8c545a2ad82e821dfca9b8b99572aefbef"),
  sample("tenor-sax-staccato", "C4", "c4.wav", "Aerophones/Reed Aerophones/Tenor Saxophone/Staccato/BrettTenor_Staccato_Main_C4_vl2_rr3.wav", "02b89a0716e256d165744acadbee26b29e17ce44"),
  sample("tenor-sax-staccato", "C5", "c5.wav", "Aerophones/Reed Aerophones/Tenor Saxophone/Staccato/BrettTenor_Staccato_Main_C5_vl2_rr1.wav", "7ab94d38a686b809fabb575f1e0d11c549500976"),
];

function sample(instrument, rootNote, targetFile, sourcePath, sourceBlobSha1) {
  return { instrument, rootNote, targetFile, sourcePath, sourceBlobSha1 };
}

function rawUrl(path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/sgossner/VCSL/${SOURCE_COMMIT}/${encodedPath}`;
}

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest("hex");
}

function gitBlobDigest(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

async function fetchPinned(path, expectedBlobSha1) {
  const response = await fetch(rawUrl(path), {
    headers: { "User-Agent": "Shotgun-Ninjas-Studio-Factory-Sample-Fetcher" },
  });
  if (!response.ok) {
    throw new Error(`Failed ${response.status} ${response.statusText}: ${path}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualBlobSha1 = gitBlobDigest(bytes);
  if (actualBlobSha1 !== expectedBlobSha1) {
    throw new Error(
      `Git blob mismatch for ${path}: expected ${expectedBlobSha1}, received ${actualBlobSha1}`,
    );
  }
  return bytes;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

await mkdir(OUTPUT_ROOT, { recursive: true });

const manifestSamples = await mapLimit(samples, 4, async (entry) => {
  const bytes = await fetchPinned(entry.sourcePath, entry.sourceBlobSha1);
  const targetPath = resolve(OUTPUT_ROOT, entry.instrument, entry.targetFile);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, bytes);
  process.stdout.write(`Fetched ${entry.instrument}/${entry.targetFile} (${bytes.length} bytes)\n`);
  return {
    instrument: entry.instrument,
    rootNote: entry.rootNote,
    file: `${entry.instrument}/${entry.targetFile}`,
    bytes: bytes.length,
    sha256: digest("sha256", bytes),
    sourcePath: entry.sourcePath,
    sourceBlobSha1: entry.sourceBlobSha1,
  };
});

const licenseSourceBlobSha1 = "0e259d42c996742e9e3cba14c677129b2c1b6311";
const licenseBytes = await fetchPinned("LICENSE", licenseSourceBlobSha1);
await writeFile(resolve(OUTPUT_ROOT, "LICENSE-CC0-1.0.txt"), licenseBytes);

const manifest = {
  schemaVersion: 1,
  sourceName: "Versilian Community Sample Library (VCSL)",
  sourceRepository: SOURCE_REPOSITORY,
  sourceCommit: SOURCE_COMMIT,
  license: LICENSE_ID,
  licenseFile: "LICENSE-CC0-1.0.txt",
  licenseSha256: digest("sha256", licenseBytes),
  licenseSourceBlobSha1,
  selectionPolicy: "Compact chromatic factory subset; original PCM WAV files are unmodified.",
  totalBytes: manifestSamples.reduce((sum, entry) => sum + entry.bytes, 0),
  samples: manifestSamples,
};

await writeFile(
  resolve(OUTPUT_ROOT, "SOURCES.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

process.stdout.write(
  `VCSL factory library ready: ${manifest.samples.length} files, ${(
    manifest.totalBytes /
    1024 /
    1024
  ).toFixed(2)} MiB\n`,
);
