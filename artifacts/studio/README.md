# Shotgun Ninjas Virtual Studio

A free browser-based, multi-track DAW and guided creative lab. No fake controls —
every visible knob, slider, button, and pad is wired to real audio.

## Features

- **34 melodic presets and 19 sound packs**, including modeled piano, guitar,
  bass, synth, orchestral/world colors, multi-kit drums, and real microphone
  vocals.
- **Six sampled factory instruments** built from 26 same-origin CC0 zones:
  TX81Z piano, folk harp, vibraphone, Tanzanian kalimba, ocarina, and tenor sax
  stabs. Zones load on demand and are cached for offline reuse instead of being
  added to the startup bundle.
- **Creative practice tools** with instrument listening guides, pack prompts,
  melodic preview phrases, and lessons on motifs, timbre/register,
  call-and-response, and harmony.
- **Transport** — Play / Pause / Stop / Record, BPM (40–240), metronome,
  4-beat count-in, loop region, master volume.
- **Multitrack timeline** with per-track clip rendering for both note clips and
  vocal waveforms.
- **Per-track channel strip** — preset, volume, pan, mute, solo, arm, reverb,
  delay, low-pass filter, duplicate, clear.
- **Recording**:
  - Note tracks (Piano/Guitar/Drums/Bass): captured via QWERTY, on-screen UI,
    or MIDI controller.
  - Vocals: real `getUserMedia` capture stored as a Blob with waveform preview.
- **Web MIDI** with device picker, live event monitor, and **MIDI Learn** for
  Transport, Metronome, per-track volume, and individual drum pads.
- **Local persistence** in IndexedDB — projects (including vocal blobs)
  autosaved every 1.5s and reloaded on next visit.
- **Cyber-ninja branding** — dark graphite + red primary + neon-blue accent.
- **Performance controls** — bounded sample decoding/cache, lazy-loaded panels,
  Performance Mode, Panic, diagnostics, and a native WAV render path.

## Keyboard shortcuts

- **Space** — Play / Pause
- **⌘/Ctrl + Enter** — Record
- **Esc** — Stop
- Keyboard tracks: **a s d f g h j k l** = white keys, **w e t y u o** = sharps
- Drum pads: **q w e r / a s d f**
- Octave shift on the keyboard panel

## Stack

React + Vite, TypeScript, TailwindCSS, shadcn/ui, [Tone.js](https://tonejs.github.io/)
for audio synthesis & scheduling, [idb](https://github.com/jakearchibald/idb)
for IndexedDB.

## Notes

- Browsers require a user gesture before audio can start. Click
  **Tap to Enable Audio** (or press Space) once per session.
- Web MIDI requires Chrome / Edge. Firefox / Safari will show "unsupported".
- Microphone access requires HTTPS and an explicit permission grant.
- Factory sample provenance, hashes, pinned source commit, and CC0 license are
  recorded in `public/samples/factory/vcsl/SOURCES.json` and the adjacent
  license/readme files. Rebuild the exact subset from the repo root with
  `node scripts/fetch-vcsl-factory-samples.mjs`.
