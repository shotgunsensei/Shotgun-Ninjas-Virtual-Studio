# Shotgun Ninjas Virtual Studio

A browser-based, multi-track DAW MVP. No fake controls — every visible knob, slider,
button, and pad is wired to real audio.

## Features

- **5 instrument types**, each with 3 audibly-distinct presets:
  - **Piano**: Grand · Electric · Synth
  - **Guitar**: Clean · Crunch · Acoustic
  - **Drums**: Acoustic · Electronic · Trap (8-piece kit)
  - **Bass**: Finger · Synth · Sub
  - **Vocals**: Clean · Warm · Lo-Fi (real microphone capture)
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
