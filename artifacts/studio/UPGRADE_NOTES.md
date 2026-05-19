# Shotgun Ninjas Virtual Studio — v2 Upgrade Notes

Baseline audit captured at the start of the v2 upgrade. This document is
the shared reference for every v2 task; each upgrade area is mapped to
the task that will own it so later tasks don't redo the audit.

## What the studio is today

A single-page React + Vite web artifact at `artifacts/studio` that runs
entirely in the browser. Tone.js drives the audio. There is no API
component — the API server artifact in the workspace is unrelated to
the studio.

### Routes / pages

Just one — `App.tsx` mounts a single `Studio` screen with:

- `Header` (project name, save/load, export, help)
- `TransportBar` (play/pause/stop/record, BPM, metronome, count-in,
  loop, master volume, master meter, "Tap to Enable Audio")
- `Timeline` + `ChannelStripsBar` (the main editing surface)
- Right-hand inspector showing the selected instrument panel
  (`Keyboard`, `GuitarPanel`, `DrumPads`, `VocalsPanel`) and a
  `MidiPanel` for MIDI Learn + monitor
- `HelpDialog`, `StatusToast`, `BackgroundFx`

There are no other routes; navigation is internal selection state.

### Audio approach (pre-v2)

- One singleton `AudioEngine` lived in `src/lib/audio/engine.ts`
  (~1070 lines). It owned `Tone.Transport`, the master bus, per-track
  voices, the metronome, MIDI fan-out hooks, sampler loading toasts,
  and preset factories for every instrument.
- The master bus was a `Tone.Channel({ volume: 0 }).toDestination()`
  with a single `Tone.Meter` tap. **No compressor or limiter** — a
  burst of loud channels could clip the output.
- Each track voice chain: `instrument -> filter -> delay -> reverb ->
  channel -> master`, with a post-fader `Tone.Meter`.
- Melodic presets used `Tone.PolySynth` variants except: `piano:grand`
  is a `Tone.Sampler` of the Salamander grand, and `guitar:acoustic`
  is a custom `PolyPluck` (Karplus–Strong) round-robin voice pool.
- Drum kit voices were layered (kick = body + click, snare = body +
  filtered noise, etc.) and triggered through a small `DrumVoice`
  contract so the offline renderer could fire them too.

### Transport / playback logic

- `useTransport` (in `src/hooks/useTransport.ts`) owns play / pause /
  stop / record, ensures the engine is unlocked first, and handles
  count-in (4-beat metronome lead-in) and stop-time clip commit for
  both note and vocal recordings.
- Clip scheduling reschedules every time `project.tracks` or
  `project.bpm` changes. Note clips schedule via
  `Transport.schedule(...)`; audio clips spin up a one-shot
  `Tone.Player` per clip.
- Loop region, BPM, metronome, and master gain are mirrored from the
  project into the engine via small effects in `TransportBar`.

### Sound sources

- Synthesized: `Tone.PolySynth(FMSynth|MonoSynth|AMSynth)` and
  `Tone.MetalSynth` / `MembraneSynth` / `NoiseSynth` for drums.
- Sampled: Salamander grand piano (`piano:grand`), fetched on demand
  from the Tone.js sample bucket.
- Physical model: `PolyPluck` for `guitar:acoustic`.
- Live mic: `Tone.UserMedia` routed into each vocal track's FX chain.
- Imported audio: `Tone.Player` per audio clip, fed by IndexedDB
  blob storage (see `src/lib/storage/db.ts`).

### State management

- A hand-rolled `Store` class in `src/store.ts` backed by React's
  `useSyncExternalStore`. It owns the `Project`, selection, transport
  flags, MIDI learn target, MIDI monitor ring buffer, and toast.
- Project mutations are immutable patches through `patchProject` /
  `patchTrack` / typed clip helpers (`addNoteClip`, `addAudioClip`,
  `resizeClip`, `moveClip`, `duplicateClip`).
- Audio engine effects are wired into the store via `useEffect`
  subscriptions in `TransportBar` and `useTransport`.

### Save / load

- Local-only via `idb` (IndexedDB). Projects are serialized as JSON;
  audio clip blobs are stored separately keyed by `blobKey`. Autosave
  fires on a 1.5 s debounce in `App.tsx` and the last opened project
  id is restored on boot.
- **No cloud save, no project import/export of full session.** WAV
  and MP3 bounce of the rendered mix is supported via the Header's
  Export action (see `src/lib/audio/export.ts`).

### Build / console warnings observed in the baseline

- None blocking. The studio typechecks clean (`pnpm --filter
  @workspace/studio typecheck`). Browser console is quiet under normal
  operation aside from Tone.js's own resume-context warning before
  the user taps "Enable Audio".

### Highest-risk files going into v2

- `src/lib/audio/engine.ts` — was ~1070 lines and mixed voice
  construction, transport, scheduling, MIDI fan-out, sampler loading,
  and event dispatch. **Refactored in this task** (Task #21).
- `src/lib/audio/export.ts` — duplicates voice/FX construction for the
  offline renderer; presets must stay in sync with the realtime engine.
- `src/store.ts` — single source of truth, but no schema versioning yet.
- `src/hooks/useTransport.ts` — count-in + stop-while-recording timing
  is subtle; future shortcut / mixer work needs to preserve it.
- `src/components/Timeline.tsx` — large, will be touched by both the
  sequencer (Task #23) and arrangement (Task #24) tasks.

## What this v2 plan changes, and in which task

| Area | Task |
| --- | --- |
| Audio engine modular refactor, master limiter/compressor, panic | **#21 (this task)** |
| Realistic kits, instrument presets, humanization, ADSR | #22 |
| Step sequencer upgrades + piano roll | #23 |
| Arrangement timeline + clip duplication polish | #24 |
| Real mixer channel strips, EQ, sends, effects rack | #25 |
| Project save/load, audio import, mic recording polish, WAV export | #26 |
| Full UI redesign, keyboard shortcut overlay, first-run modal | #27 |
| Custom-range bar export | existing task ("Pick a custom range…") |
| Project-wide clipping warning in transport bar | existing task ("Show a project-wide clipping warning…") |

## What this task (#21) actually changes

- `src/lib/audio/engine.ts` is now a slim **facade** (~500 lines). The
  preset factories, drum kits, `PolyPluck`, `DrumKit`/`DrumVoice`
  types, sampler loading announcer, and vocal preset helper moved
  to `src/lib/audio/voices.ts`. The master bus + safety chain moved
  to `src/lib/audio/master.ts`.
- The facade adds the documented v2 surface: `initAudio` (alias for
  `unlock`), `schedulePattern` (alias for `scheduleClip`),
  `triggerSample` (alias for `triggerDrum`), `triggerInstrumentNote`
  (alias for `triggerNote`), `panicStopAll`, and `getMasterLevels`.
  Existing methods (`play`, `stop`, `pause`, `setBpm`, `setMaster`,
  …) are unchanged so every existing call site still compiles.
- A **master safety chain** is in place:
  `Channel -> Compressor(-8 dB, 3:1) -> Limiter(-0.3 dB) -> Destination`.
  The post-limiter signal feeds the master meter so the displayed
  level reflects what is actually leaving the studio.
- `stop()` now releases every sustained voice via `releaseAll()` (or
  the per-voice equivalent) so notes can no longer hang after
  pressing Stop.
- `panicStopAll()` is wired to a small red **Panic** affordance in
  the transport bar. It stops the transport, hard-stops every in-flight
  scheduled audio-clip player, releases all sustained notes, closes any
  live mic, and dips the master to silence reverb/delay tails. It
  intentionally does **not** cancel transport-registered clip /
  metronome schedules so pressing Play again resumes the project
  without forcing a reschedule.
- Every existing behavior — instrument playback, QWERTY/MIDI input,
  source-aware first-note toasts, transport play/stop/loop,
  mute/solo, offline WAV/MP3 bounce — is preserved.
