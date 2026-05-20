# Shotgun Ninjas Virtual Studio — User Guide

Welcome. This guide walks you through the studio end to end. The whole
app is free — no sign-up, no paywall, nothing to install. See
[`FREE_PRODUCT_POLICY.md`](./FREE_PRODUCT_POLICY.md) for the product
policy.

---

## 1. Enable audio

Browsers will not make a sound until you interact with the page. When you
first open the studio, the transport bar shows a glowing red
**Tap to Enable Audio** button. Click it once — or just press **Space** —
and the audio engine starts. You only have to do this once per session.

If you ever stop hearing anything, click the **Panic** button (the
red octagon icon in the transport bar) to release all notes and tails,
then press **Space** again to resume.

## 2. Create a beat

1. Pick a track from the **Tracks** panel on the left (or just click one
   of the channel strips at the bottom).
2. The right-hand inspector switches to that track's instrument:
   keyboard, drum pads, guitar, bass, or vocal panel.
3. Play notes using the on-screen UI, your computer keyboard
   (**A S D F G H J K L** = white keys, **W E T Y U O** = sharps), or
   a MIDI controller.
4. To record what you play, **Arm** the track (`R` on the channel
   strip), then press the red record button in the transport bar. The
   count-in (configurable in the transport bar) counts you in.
5. Press **Space** to play back. Recorded notes appear as clips on the
   arrangement timeline; you can drag, resize, rename, and color-tag
   them.

Drum tracks have a step sequencer — click pads in the grid, or play the
pads live with **Q W E R / A S D F**.

## 3. Save a project

Projects autosave to your browser's IndexedDB every ~1.5 seconds, so
just keep working. To force a save: press **S** (or **Ctrl/Cmd + S**),
or click **Save** in the header. To name a project, edit the title in
the header.

To load, duplicate, or delete a saved project, click **Load** in the
header. Loading replaces the current project — save first if you have
unsaved changes you care about.

## 4. Export a WAV

1. Click **Export** in the header (or press **B**).
2. Pick a format: **WAV** for highest quality, **MP3** for smaller files,
   or **Project JSON** to back up the whole project (including recorded
   vocals).
3. Watch the progress bar render the mix. If anything clipped the master
   you'll get a clipping warning so you can pull masters down and re-export.
4. The file downloads as `shotgun-ninjas-<project-name>-<timestamp>.<ext>`.

The full master bus, effects, and sends are rendered exactly as you hear
them, at the project sample rate.

## 5. Import a sample

Drag any audio file (WAV, MP3, OGG, FLAC, M4A) onto the studio. A
preview dialog opens with a waveform; trim and name it, then drop it
onto a vocal track to add it as a clip, or save it to the sample
library for later. You can also click **Import sample** from the header.

## 6. Use demo projects

Open **Load** in the header and switch to the **Demos** tab. Each demo
loads instantly and is a fully editable project — change presets, mute
tracks, swap kits, rearrange clips, record over them. Demos won't
overwrite the project you currently have open until you click Load.

## 7. Install as a PWA

When the PWA shell is enabled (Phase 3), supported browsers will show an
**Install** prompt in the address bar. Installing gives you:

- a standalone window with no browser chrome,
- an app icon you can launch from your dock / home screen,
- offline access to the app shell so the studio loads even without
  a network connection (your projects already live offline in IndexedDB).

If the prompt doesn't appear, the browser may need you to interact with
the app first; reload after a few minutes of use.

## 8. Use a MIDI controller

Plug in your MIDI keyboard or pad controller before loading the page
(or after — the device picker refreshes). Open the **MIDI** panel on
the right inspector:

1. Pick your device from the dropdown.
2. The **Live monitor** shows every event your controller sends so you
   can confirm it's connected.
3. Click any **MIDI Learn** button (transport play/stop/record,
   metronome, per-track volume sliders, drum pads) and then move the
   physical control or hit the pad you want to bind. The next note or
   CC becomes the mapping; click again to clear.

Web MIDI works best in Chromium browsers. Firefox and Safari will show
"MIDI unsupported" — the rest of the studio still works.

---

## Keyboard shortcuts

- **Space** — Play / Pause
- **Enter** — Stop
- **Esc** — Panic (kills all audio + stops transport)
- **R** — Toggle record
- **S / Ctrl+S** — Save project
- **M** — Toggle metronome
- **B** — Open export dialog
- **F** — Toggle fullscreen
- **?** — Show keyboard shortcut overlay
- **Delete / Backspace** — Delete selected clip
- **Ctrl/Cmd + C / V** — Copy / paste selected clip
- **1–8** — Focus tracks 1–8

## When something goes wrong

- **Stuck note?** Press **Esc** or click the Panic button in the
  transport bar.
- **No sound after a long session?** Click **Tap to Enable Audio** if
  it reappears, or reload the page — your project autosaved.
- **Crash screen?** The studio's error boundary catches render crashes
  and offers Reload, Copy error, and **Export recovery data** —
  downloads the current project as a JSON file you can re-open via
  **File · Import Project JSON**, plus a small `.meta.json` sidecar
  with the crash trace for bug reports.
- **Diagnostics** — open the **About** dialog from the header footer to
  see the app version, browser, AudioContext state, sample rate, saved
  projects count, Web MIDI support, and storage estimate. Helpful when
  reporting a bug.
