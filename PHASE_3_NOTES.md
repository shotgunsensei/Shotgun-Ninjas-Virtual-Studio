# Phase 3 Notes — Shotgun Ninjas Virtual Studio

This document captures the Phase 3 work-in-progress state of the studio:
what already exists from v1/v2, what's being added in Phase 3, the
testing checklist, known limitations, and the recommended scope for
Phase 4.

> **Product policy.** Phase 3 (and every later phase) is bound by
> [`FREE_PRODUCT_POLICY.md`](./FREE_PRODUCT_POLICY.md). No Stripe,
> paywalls, account walls, or upsell flows.

## What already exists (v1 + v2 baseline)

From the v2 audit in [`artifacts/studio/UPGRADE_NOTES.md`](./artifacts/studio/UPGRADE_NOTES.md):

- Single-screen React + Vite + Tone.js DAW at `artifacts/studio`.
- 5 instrument families, 3+ presets each, real sampler/synth voices.
- Transport (play/pause/stop/record, BPM, metronome, count-in, loop),
  master bus with limiter, master meter + latching clip, master scope.
- Multitrack timeline with note and audio clips, channel strips with
  EQ + sends + FX rack + mute/solo/arm, drag/move/resize/rename/color
  on clips.
- Web MIDI device picker, live monitor, MIDI Learn for transport /
  metronome / track volume / drum pads.
- Recording: note tracks via QWERTY/on-screen/MIDI, vocals via
  `getUserMedia` stored as Blobs with waveform preview.
- IndexedDB autosave including vocal Blobs, project import/export as
  JSON, project duplication.
- WAV + MP3 export with progress and clipping detection.
- Multiple themes, drop zone for samples, sample library, demo presets.
- v1 `StudioErrorBoundary` with friendly copy + reload + panic.

## What's added in Phase 3

This task (**Phase 3 foundation**) covers:

- **Product policy** — `FREE_PRODUCT_POLICY.md` at the repo root,
  binding for all future work.
- **Docs** — repo `README.md` rewritten, `USER_GUIDE.md` for end users,
  this `PHASE_3_NOTES.md` for contributors.
- **Error boundary** — `StudioErrorBoundary` keeps its existing reload /
  copy / panic actions and gains an **Export recovery data** button
  that downloads the last in-memory project (and the most recent
  IndexedDB autosave as a fallback) as a canonical project JSON file
  that loads straight back through **File · Import Project JSON**.
  Crash metadata ships as a separate `*.meta.json` sidecar so the
  project file stays directly importable.
- **Diagnostics panel** — accessible from a discreet **About** link in
  the header footer. Read-only view of app version, browser,
  AudioContext state + sample rate, Web MIDI support, PWA install
  state, IndexedDB project count, `navigator.storage.estimate()`.
- **App version constant** — `src/lib/version.ts` exports a single
  `APP_VERSION` used by the footer, diagnostics panel, and any future
  PWA update toast.
- **Stability pass** — meters and the master scope throttle to ~30 fps
  (down from per-frame `requestAnimationFrame`), `Esc` keeps panicking
  reliably, the Panic button stays visible in the transport bar, and
  the heavy `MidiPanel` is lazy-loaded.

Out of scope (separate Phase 3 tasks): PWA manifest + service worker,
settings modal UI, demo content + first-run flow, MIDI controller
enhancements, mobile layout polish, sharing/export polish.

## Files changed in this task

- `FREE_PRODUCT_POLICY.md` (new)
- `README.md` (rewritten)
- `USER_GUIDE.md` (new)
- `PHASE_3_NOTES.md` (this file, new)
- `artifacts/studio/src/lib/version.ts` (new)
- `artifacts/studio/src/components/ErrorBoundary.tsx` (recovery export)
- `artifacts/studio/src/components/DiagnosticsDialog.tsx` (new)
- `artifacts/studio/src/components/Footer.tsx` (new — version + About)
- `artifacts/studio/src/components/Meter.tsx` (throttled to ~30 fps)
- `artifacts/studio/src/components/MasterScope.tsx` (throttled to ~30 fps)
- `artifacts/studio/src/App.tsx` (lazy `MidiPanel`, footer mount,
  recovery hook exposed)

## Testing checklist

The 22-item Phase 3 smoke checklist (run these after every Phase 3 task
that touches the studio shell):

1. App boots without console errors on first load.
2. **Tap to Enable Audio** unlocks the engine; subsequent reloads
   remember the unlock until the tab is closed.
3. Pressing **Space** plays / pauses the seeded demo.
4. Pressing **Enter** stops the transport and clears the position.
5. Pressing **Esc** triggers Panic — all sound stops immediately,
   including reverb / delay tails.
6. The **Panic** button in the transport bar is visible at every
   viewport width and works identically to Esc.
7. Holding a key, then hitting Stop, does not leave a stuck note.
8. Recording an armed note track captures notes from QWERTY, on-screen,
   and MIDI input and writes a clip on stop.
9. Recording an armed vocal track captures audio via `getUserMedia` and
   writes a waveform clip on stop.
10. Saving and reloading a project preserves tracks, clips, FX, and
    vocal blobs.
11. Exporting WAV produces an audible file matching the live playback.
12. Importing an audio sample via drag-and-drop opens the preview
    dialog and saves to the library.
13. Loading a demo project replaces the current project cleanly.
14. PWA install prompt appears in supported browsers (manifest task
    once landed).
15. Web MIDI device picker lists connected devices; live monitor shows
    events; MIDI Learn binds transport / volume / pads.
16. Diagnostics panel opens from the About link and reports correct
    version / AudioContext state / sample rate / storage estimate /
    MIDI support.
17. Error boundary catches a thrown render error, the Reload button
    reloads, Copy error copies to clipboard, and Export recovery data
    downloads a project JSON that re-imports cleanly via File · Import
    (plus a `.meta.json` sidecar with the crash trace).
18. Master meter and master scope continue to animate but do not pin a
    CPU core (throttled to ~30 fps).
19. Removing a track (when the UI exposes it) disposes its audio nodes
    — `audio.removeTrack(id)` is called and the voice map shrinks.
20. Disabling an effect module in the FX rack silences the module
    without leaving the node leaking audio.
21. Project autosave fires within ~1.5 s of an edit and the last project
    id is restored on reload.
22. No console errors during a 5-minute play / record / stop / export
    session.

## Known limitations

- Demo content beyond the seeded project ships in a separate Phase 3
  task; until then, the **Demos** tab in Load is empty.
- The PWA shell is not yet active; the **Install** prompt won't appear
  until the manifest + service worker task lands.
- The Diagnostics panel is read-only — there is no "send report" flow.
  Users can copy the panel text or use the error-boundary "Copy error"
  action to file a bug.
- The error boundary's recovery export is best-effort: it serializes the
  store's last known project plus the most recent IndexedDB autosave;
  if both are corrupted, only the raw error trace is downloadable.

## Recommended Phase 4

Once Phase 3 stabilizes, a sensible Phase 4 would focus on:

- **Multi-window / collaborative editing** — a per-tab session id with
  a CRDT-friendly project model so two tabs can edit the same project
  without clobbering each other.
- **Plugin SDK** — first-class extension points for custom instruments
  and effects with a sandboxed API surface, so the community can ship
  new voices without forking the engine.
- **Server-side render / batch export** — optional headless rendering
  via WebAudio in a worker for offline batch exports.
- **Accessibility audit** — keyboard navigation across every panel,
  screen-reader labels on every interactive control, color-contrast
  pass on every theme.
- **Localization** — wrap user-facing copy in an i18n layer (English
  baseline, then a community translation flow).

None of these may violate the free-forever policy.
