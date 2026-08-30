# VCSL factory instruments

This directory contains a compact, unmodified PCM WAV subset of the
[Versilian Community Sample Library](https://github.com/sgossner/VCSL).
The files are dedicated to the public domain under CC0 1.0.

- Source commit: `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`
- Included instruments: TX81Z Piano 1, folk harp, vibraphone, Tanzanian
  kalimba, ocarina, and tenor saxophone staccato
- Included audio: 26 chromatic zones, 24.07 MiB total
- Exact upstream paths, Git blob IDs, byte sizes, and SHA-256 hashes:
  [`SOURCES.json`](./SOURCES.json)
- License text: [`LICENSE-CC0-1.0.txt`](./LICENSE-CC0-1.0.txt)

The studio does not put these files in its startup bundle or service-worker
precache. An instrument's zones are fetched from the same origin only when a
user loads, previews, or exports that instrument, then runtime-cached for
offline reuse. Decoding is concurrency-limited and the shared decoded-buffer
cache is bounded.

To reproduce this directory from the pinned upstream commit, run from the
repository root:

```powershell
node scripts/fetch-vcsl-factory-samples.mjs
```

The fetcher rejects any upstream file whose Git blob ID differs from the
pinned manifest before writing it locally.
