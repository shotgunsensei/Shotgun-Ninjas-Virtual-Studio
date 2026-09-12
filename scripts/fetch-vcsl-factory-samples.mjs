import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  sample("steinway-grand", "C1", "c1.wav", "Chordophones/Zithers/Grand Piano, Steinway B/NoSus/JHPiano_NoSus_Close_C1_vl2_rr1.wav", "e6a9c3b244c84d465c9e0a6fbf134d76848963b2"),
  sample("steinway-grand", "C2", "c2.wav", "Chordophones/Zithers/Grand Piano, Steinway B/NoSus/JHPiano_NoSus_Close_C2_vl2_rr1.wav", "f341a21eec0e406b32de9ba94e2845991aa2536f"),
  sample("steinway-grand", "C3", "c3.wav", "Chordophones/Zithers/Grand Piano, Steinway B/NoSus/JHPiano_NoSus_Close_C3_vl2_rr1.wav", "8ef76a88e25aebe3d1f3dc26099289900b3650d8"),
  sample("steinway-grand", "C4", "c4.wav", "Chordophones/Zithers/Grand Piano, Steinway B/NoSus/JHPiano_NoSus_Close_C4_vl2_rr1.wav", "5f80e0d82e670ab294d58ac9373b4156f2b6d611"),
  sample("steinway-grand", "C5", "c5.wav", "Chordophones/Zithers/Grand Piano, Steinway B/NoSus/JHPiano_NoSus_Close_C5_vl2_rr1.wav", "d4e3e6c40762d902e249fe93aa4bd492962fb40c"),
  sample("steinway-grand", "C6", "c6.wav", "Chordophones/Zithers/Grand Piano, Steinway B/NoSus/JHPiano_NoSus_Close_C6_vl2_rr1.wav", "f26dc99b20c0baf1620a748c68ea00909e8cef3f"),

  sample("french-harpsichord", "C1", "c1.wav", "Chordophones/Zithers/Harpsichord, French/Sustains/Harpsi2_Normal_C1_rr1_Main.wav", "7dd39f2c8728bdbe02a263f534431e0f074177ed"),
  sample("french-harpsichord", "C2", "c2.wav", "Chordophones/Zithers/Harpsichord, French/Sustains/Harpsi2_Normal_C2_rr1_Main.wav", "b1dbf4825efe25540907057c5b16883595dbd269"),
  sample("french-harpsichord", "C3", "c3.wav", "Chordophones/Zithers/Harpsichord, French/Sustains/Harpsi2_Normal_C3_rr1_Main.wav", "bfba5da963ee600cdbdaa3c3e142f15b1fa097fa"),
  sample("french-harpsichord", "C4", "c4.wav", "Chordophones/Zithers/Harpsichord, French/Sustains/Harpsi2_Normal_C4_rr1_Main.wav", "25401f1f36f7c9691deb7d321a604caf4e51b238"),
  sample("french-harpsichord", "C5", "c5.wav", "Chordophones/Zithers/Harpsichord, French/Sustains/Harpsi2_Normal_C5_rr1_Main.wav", "0a4b5176930655ead6024168f8eea403f3a1d657"),

  sample("pipe-organ", "C1", "c1.wav", "Aerophones/Edge-blown Aerophones/Pipe Organ/Quiet/NT5_Man3Quiet_C1_rr1.wav", "674ed832a1540ba7c881fa6e8a584c4a324bdcc4"),
  sample("pipe-organ", "C2", "c2.wav", "Aerophones/Edge-blown Aerophones/Pipe Organ/Quiet/NT5_Man3Quiet_C2_rr1.wav", "2dc720c4f80f912ede3f3ac138b1f40e0215c450"),
  sample("pipe-organ", "C3", "c3.wav", "Aerophones/Edge-blown Aerophones/Pipe Organ/Quiet/NT5_Man3Quiet_C3_rr1.wav", "862175f3f2ad7da84ba00509bbc63b1e72227d1a"),
  sample("pipe-organ", "C4", "c4.wav", "Aerophones/Edge-blown Aerophones/Pipe Organ/Quiet/NT5_Man3Quiet_C4_rr1.wav", "aaf898acca4946752d6ef5ddde411638fa28784d"),
  sample("pipe-organ", "C5", "c5.wav", "Aerophones/Edge-blown Aerophones/Pipe Organ/Quiet/NT5_Man3Quiet_C5_rr1.wav", "9c70ecaec5c14162da761be5c089fad1075db374"),

  sample("marimba", "F1", "f1.wav", "Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_F1_med_01.wav", "21df93be7915e72dabe9189001262c62b436355f"),
  sample("marimba", "C2", "c2.wav", "Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_C2_med_01.wav", "8d18c94d5945941574e44563a60908d9f8c11430"),
  sample("marimba", "G2", "g2.wav", "Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_G2_med_01.wav", "f27193e84ff36d8c16ddc4a59bc89acc79d426ae"),
  sample("marimba", "F3", "f3.wav", "Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_F3_med_01.wav", "2c74c56eba169268ec3e74bc2de31fb282716a58"),
  sample("marimba", "C4", "c4.wav", "Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_C4_med_01.wav", "85c657dd0a8f58808efad5e9184d5b9124285512"),
  sample("marimba", "G4", "g4.wav", "Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_G4_med_01.wav", "be84c27de4fea671b78c82591aa6d6f98c06619e"),
  sample("marimba", "F5", "f5.wav", "Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_F5_med_01.wav", "215d4dfb83636c70a5997ac65cb3acf201c53dc5"),
  sample("marimba", "C6", "c6.wav", "Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_C6_med_01.wav", "f5c95434f42f07fecdbd4f3e3a6a737d81cdd45a"),

  sample("glockenspiel", "G4", "g4.wav", "Idiophones/Struck Idiophones/Glockenspiel/glock_medium_G4_01.wav", "a7d9ca6c68e4c56327d83f0653ee3e16e4810265"),
  sample("glockenspiel", "C5", "c5.wav", "Idiophones/Struck Idiophones/Glockenspiel/glock_medium_C5_01.wav", "db079c70946137f543820b6a6ac023d0afaac47c"),
  sample("glockenspiel", "G5", "g5.wav", "Idiophones/Struck Idiophones/Glockenspiel/glock_medium_G5_01.wav", "dbaf80bc3975016095de3a611a202b581931311c"),
  sample("glockenspiel", "C6", "c6.wav", "Idiophones/Struck Idiophones/Glockenspiel/glock_medium_C6_01.wav", "c02ff721d10eb3551372806653368f45ea5dc367"),
  sample("glockenspiel", "G6", "g6.wav", "Idiophones/Struck Idiophones/Glockenspiel/glock_medium_G6_01.wav", "e95738492bdc207b11ad32891a9a1ea090b6719e"),
  sample("glockenspiel", "C7", "c7.wav", "Idiophones/Struck Idiophones/Glockenspiel/glock_medium_C7_01.wav", "a0f4aff9ef7d73e49a16f4054ead1369a78572b0"),

  sample("kawai-grand", "C1", "c1.wav", "Chordophones/Zithers/Grand Piano, Kawai/Sustains/GPiano_sus_C1_v2_rr1_Player.wav", "0378679e31a709f2192862fe6f0c05d9e5e93586"),
  sample("kawai-grand", "C2", "c2.wav", "Chordophones/Zithers/Grand Piano, Kawai/Sustains/GPiano_sus_C2_v2_rr1_Player.wav", "3e64901412fe7935e3a1152b0b7a2d93645e53ef"),
  sample("kawai-grand", "C3", "c3.wav", "Chordophones/Zithers/Grand Piano, Kawai/Sustains/GPiano_sus_C3_v2_rr1_Player.wav", "2449d26c97873705e234ad85b94e0c651018d4a5"),
  sample("kawai-grand", "C4", "c4.wav", "Chordophones/Zithers/Grand Piano, Kawai/Sustains/GPiano_sus_C4_v2_rr1_Player.wav", "09dfd90293a537066bd825dac73f823bf46d0aa9"),
  sample("kawai-grand", "C5", "c5.wav", "Chordophones/Zithers/Grand Piano, Kawai/Sustains/GPiano_sus_C5_v2_rr1_Player.wav", "197b04e4b6bbaf93ecb4bf436b5c4831a5afdec3"),
  sample("kawai-grand", "C6", "c6.wav", "Chordophones/Zithers/Grand Piano, Kawai/Sustains/GPiano_sus_C6_v2_rr1_Player.wav", "38e2ea4d854e7ccb211981e664337d9ed551e95e"),
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

function sample(instrument, sourceNote, targetFile, sourcePath, sourceBlobSha1) {
  // Most VCSL families name MIDI 60 "C3". Recorded-pitch validation confirms
  // the Steinway filenames already use scientific/Tone notation (C4 = MIDI 60).
  const sourceOctaveOffset = instrument === "steinway-grand" ? 0 : 1;
  const rootNote = sourceNote.replace(/\d+$/, (octave) => String(Number(octave) + sourceOctaveOffset));
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
  const targetPath = resolve(OUTPUT_ROOT, entry.instrument, entry.targetFile);
  const existing = await readFile(targetPath).catch(() => null);
  const verified = existing && gitBlobDigest(existing) === entry.sourceBlobSha1;
  const bytes = verified ? existing : await fetchPinned(entry.sourcePath, entry.sourceBlobSha1);
  if (!verified) {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, bytes);
  }
  process.stdout.write(`${verified ? "Verified" : "Fetched"} ${entry.instrument}/${entry.targetFile} (${bytes.length} bytes)\n`);
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
  rootNoteConvention: "Scientific/Tone pitch: C4 = MIDI 60. Steinway filenames already use C4 = MIDI 60; other included VCSL families use C3 = MIDI 60.",
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
