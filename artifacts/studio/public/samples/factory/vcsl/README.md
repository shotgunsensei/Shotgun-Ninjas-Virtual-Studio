# VCSL factory instruments

This directory contains a compact, unmodified PCM WAV subset of the
[Versilian Community Sample Library](https://github.com/sgossner/VCSL).
The files are dedicated to the public domain under CC0 1.0.

- Source commit: `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`
- Included instruments: Kawai Grand Piano, TX81Z Piano 1, folk harp, vibraphone, Tanzanian
  kalimba, ocarina, and tenor saxophone staccato
- Included audio: 32 chromatic zones, 41.86 MiB total
- Exact upstream paths, Git blob IDs, byte sizes, and SHA-256 hashes:
  [`SOURCES.json`](./SOURCES.json)
- License text: [`LICENSE-CC0-1.0.txt`](./LICENSE-CC0-1.0.txt)

The studio does not put these files in its startup bundle or service-worker
precache. An instrument's zones are fetched from the same origin only when a
user loads, previews, or exports that instrument, then runtime-cached for
offline reuse. Decoding is concurrency-limited and the shared decoded-buffer
cache is bounded.

The source filenames use C3 for middle C. Engine/manifest `rootNote` values
use scientific/Tone notation (C4 = MIDI 60), one octave higher than those
filenames. This is a label conversion, not pitch-shifting or editing the WAVs.
Recorded-pitch regression checks guard each instrument family against an
accidental return to octave-high playback. These are sparse single-velocity
zones with natural acoustic tuning, not multi-velocity or round-robin banks.

To reproduce this directory from the pinned upstream commit, run from the
repository root:

```powershell
node scripts/fetch-vcsl-factory-samples.mjs
```

The fetcher rejects any upstream file whose Git blob ID differs from the
pinned manifest before writing it locally.
