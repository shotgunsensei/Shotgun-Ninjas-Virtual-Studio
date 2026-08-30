# Shotgun Ninjas Virtual Studio

A browser-based, multi-track music studio. Open it, press play, make a
beat, export a WAV. No sign-up, no paywall, nothing to install.

> **Free forever.** No accounts, no paywalls, no locked features, no
> credit systems. See [`FREE_PRODUCT_POLICY.md`](./FREE_PRODUCT_POLICY.md)
> for the binding product policy that every contributor must honor.

## What this is

Shotgun Ninjas Virtual Studio is a single-page web DAW that runs entirely
in your browser. Every visible knob, slider, pad, and meter is wired to
real audio — Tone.js drives a real master bus, real per-track effects,
real samplers, and real microphone capture. Projects (including recorded
vocal blobs) auto-save to IndexedDB, so your work survives a reload.

The repo is a pnpm monorepo. The studio app itself lives in
[`artifacts/studio`](./artifacts/studio).

## Features

- **34 melodic presets and 19 ready-to-play sound packs** spanning modeled
  keys, guitar, bass, orchestral/world colors, multi-kit drums, and real
  microphone vocals. Six high-quality factory instruments use 26 same-origin
  CC0 sample zones: TX81Z piano, folk harp, vibraphone, Tanzanian kalimba,
  ocarina, and tenor sax stabs.
- **Creative learning built into the studio** — sampled-instrument listening
  guides, practical "try this" prompts, pitched pack previews, and lessons on
  motif development, timbre/register, call-and-response, and harmony tools.
- **Transport** — Play / Pause / Stop / Record, BPM 40–240, metronome,
  configurable count-in, loop region, master volume, master meter with
  latching clip indicator, master oscilloscope, and a Panic button that
  is always visible and kills every voice and tail.
- **Multitrack timeline** with note and audio clips, drag-to-move,
  resize, rename, color-tag, duplicate, copy/paste, and per-track
  channel strips with EQ, sends, FX rack, mute/solo/arm.
- **Recording** — MIDI/QWERTY/on-screen for note tracks; real
  `getUserMedia` capture for vocals, stored as a Blob with waveform
  preview.
- **Web MIDI** — device picker, live monitor, MIDI Learn for transport,
  metronome, per-track volume, and individual drum pads.
- **Local persistence** — IndexedDB autosave (~1.5 s debounce) including
  vocal Blobs, with project import/export as JSON.
- **WAV export** at master quality with progress and clipping warning.
- **Cyber-ninja branding** — dark graphite + red primary + neon-blue
  accent, with multiple themes.
- **Global error boundary** with copy-trace, panic, and recovery-data
  download.
- **Diagnostics panel** showing app version, AudioContext state, sample
  rate, MIDI support, saved-projects count, storage estimate, and decoded
  sample-cache activity.

## How to run

The studio is a Vite app inside a pnpm monorepo. From the repo root:

```sh
pnpm install
pnpm --filter @workspace/studio dev
```

Open the URL printed by Vite. On Replit, the studio is served by the
`artifacts/studio: web` workflow and the preview pane points at it
automatically.

## How to build

```sh
pnpm run typecheck            # whole repo
pnpm --filter @workspace/studio build
```

The build output lands in `artifacts/studio/dist/public` and can be
served by any static host.

The checked-in CC0 factory subset is reproducible from its pinned upstream
commit. The fetcher verifies every Git blob before replacing a local file:

```sh
node scripts/fetch-vcsl-factory-samples.mjs
```

## How to deploy

The repo is set up for Replit Deployments. Each artifact ships as its
own preview path. For the studio, deploy the `artifacts/studio` artifact;
the `dist/public` build can also be uploaded to any static host (Cloudflare
Pages, Netlify, Vercel, GitHub Pages, etc.) since the app is 100% client
side and persists to the user's own browser storage.

## Browser compatibility

| Browser              | Audio | Vocals (mic) | Web MIDI |
| -------------------- | :---: | :----------: | :------: |
| Chrome / Edge / Brave |  ✅   |     ✅       |    ✅    |
| Firefox              |  ✅   |     ✅       |    ⚠️    |
| Safari (desktop)     |  ✅   |     ✅       |    ⚠️    |
| Safari (iOS)         |  ✅   |     ✅*      |    ❌    |

- Audio requires a user gesture to start. The transport bar shows
  **Tap to Enable Audio** until you click anywhere or press Space.
- Microphone capture requires HTTPS and an explicit permission grant.
- Web MIDI is best on Chromium browsers; Firefox and Safari show
  "MIDI unsupported" in the MIDI panel and skip the controller hookup.
- *iOS Safari: vocal capture works but can be flaky depending on the OS
  version; the rest of the app is fully usable.

## Known limitations

- The audio engine is monolithic and single-instance per page; opening
  the studio in multiple tabs will give each tab its own engine but they
  share IndexedDB, so the most recent autosave wins.
- WAV export uses a bounded native `OfflineAudioContext` path; factory-sampled
  presets use their decoded zones while modeled Tone-only voices and advanced
  FX use stable approximations. MP3 remains on the heavier Tone offline path,
  and very long exports can still hit a browser memory cap.
- Factory zones are downloaded only when first previewed, loaded, or exported.
  They are cached for later offline use, so the first use of an instrument can
  reflect network speed while startup avoids the 24.07 MiB sample payload.
- There is no cloud sync — projects live in your browser's IndexedDB. If
  you clear site data, projects are gone. Use **File · Export Project
  JSON** to back up.
- Web MIDI sysex is not requested; controllers that require sysex for
  bidirectional comms will only send/receive standard MIDI.

## Stack

React + Vite, TypeScript, TailwindCSS, shadcn/ui, [Tone.js](https://tonejs.github.io/)
for audio synthesis & scheduling, [idb](https://github.com/jakearchibald/idb)
for IndexedDB, [wavesurfer.js](https://wavesurfer.xyz/) for waveform
previews, [lamejs](https://github.com/zhuker/lamejs) for MP3 encoding.

## Docs

- [`FREE_PRODUCT_POLICY.md`](./FREE_PRODUCT_POLICY.md) — the binding
  product policy.
- [`USER_GUIDE.md`](./USER_GUIDE.md) — step-by-step user guide.
- [`PHASE_3_NOTES.md`](./PHASE_3_NOTES.md) — historical Phase 3 baseline,
  testing checklist, and roadmap.
- [`artifacts/studio/PERF_BASELINE.md`](./artifacts/studio/PERF_BASELINE.md)
  — measured bundle, runtime, audio, storage, and export baselines.
- [`artifacts/studio/PERFORMANCE_AUDIT.md`](./artifacts/studio/PERFORMANCE_AUDIT.md)
  and [`artifacts/studio/PERFORMANCE_FIXES.md`](./artifacts/studio/PERFORMANCE_FIXES.md)
  — confirmed root causes, implemented controls, and acceptance evidence.
- [`artifacts/studio/UPGRADE_NOTES.md`](./artifacts/studio/UPGRADE_NOTES.md)
  — v2 upgrade baseline audit.
