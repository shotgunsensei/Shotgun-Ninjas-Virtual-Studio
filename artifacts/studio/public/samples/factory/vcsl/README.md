# VCSL factory instruments

This directory contains a compact, unmodified PCM WAV subset of the
[Versilian Community Sample Library](https://github.com/sgossner/VCSL).
The files are dedicated to the public domain under CC0 1.0.

- Source commit: `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`
- Included instruments: Kawai Grand Piano, Steinway B Grand, French Harpsichord,
  Chapel Pipe Organ, Concert Marimba, Orchestral Glockenspiel, TX81Z Piano 1,
  folk harp, vibraphone, Tanzanian kalimba, ocarina, and tenor saxophone staccato
- Included audio: 62 chromatic zones, 101.38 MiB total (30 new zones, 59.52 MiB)
- Exact upstream paths, Git blob IDs, byte sizes, and SHA-256 hashes:
  [`SOURCES.json`](./SOURCES.json)
- License text: [`LICENSE-CC0-1.0.txt`](./LICENSE-CC0-1.0.txt)

The studio does not put these files in its startup bundle or service-worker
precache. An instrument's zones are fetched from the same origin only when a
user loads, previews, or exports that instrument, then runtime-cached for
offline reuse. Decoding is concurrency-limited and the shared decoded-buffer
cache is bounded.

Most source filenames use C3 for middle C. The Steinway B filenames already
use scientific notation. Engine/manifest `rootNote` values use scientific/Tone
notation (C4 = MIDI 60): the Steinway names stay unchanged; other included
families are labeled one octave higher. This is a label conversion, not
pitch-shifting or editing the WAVs. Spectrum checks detected and guard the
Steinway exception so its low notes play in the correct register.
Recorded-pitch regression checks guard each instrument family against an
accidental return to octave-high playback. These are sparse single-velocity
zones with natural acoustic tuning, not multi-velocity or round-robin banks.
The organ uses finite recorded sustains, so an indefinitely held key eventually
reaches the recording's end. Pitch shifting beyond a family's sampled range
changes its timbre and duration, as with the existing factory instruments.

| Added instrument | Sampled roots (scientific pitch) | Zones |
| --- | --- | ---: |
| Steinway B Grand | C1–C6 | 6 |
| French Harpsichord | C2–C6 | 5 |
| Chapel Pipe Organ | C2–C6 | 5 |
| Concert Marimba | F2–C7 | 8 |
| Orchestral Glockenspiel | G5–C8 | 6 |

Asset validation enforces a 103 MiB total file budget and a 40 MiB decoded PCM
budget per instrument. These are build-time payload guards. Factory audio
still loads sequentially per selected instrument through the existing shared
three-job decode queue and 64 MiB decoded-buffer cache.

To reproduce this directory from the pinned upstream commit, run from the
repository root:

```powershell
node scripts/fetch-vcsl-factory-samples.mjs
```

The fetcher rejects any upstream file whose Git blob ID differs from the
pinned manifest before writing it locally. Existing files with the correct
blob hash are verified and reused so rerunning it downloads only missing or
changed audio.
