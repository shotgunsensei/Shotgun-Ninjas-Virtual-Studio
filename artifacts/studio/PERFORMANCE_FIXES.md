# Performance Fixes — Task #208

All changes in this pass target the root causes identified in PERFORMANCE_AUDIT.md
and PERF_BASELINE.md. No new features were added.

---

## Fix 1 — Centralized VisualTicker (T002)

**File:** `src/lib/visualTicker.ts` (new)

**Problem:** Every meter, clip badge, and panel ran its own independent
`requestAnimationFrame` loop. N+1 loops meant N+1 browser scheduling callbacks per
frame, plus no single point to apply a document.hidden gate.

**Fix:** Created a `VisualTicker` singleton. Components subscribe with a callback
and receive a single shared tick. The ticker:
- Pauses automatically when `document.visibilitychange` fires with `document.hidden = true`
- Resumes on tab re-focus with no missed events
- Enforces a configurable FPS cap (default 25 fps, 15 fps in Performance Mode)
- Auto-stops when subscriber count reaches zero (no idle CPU cost)

---

## Fix 2 — StereoMeter Canvas Refactor (T004)

**File:** `src/components/Meter.tsx`

**Problem:** `StereoMeter` called `setLevels([normL, normR])` and
`setPeaksDb([...])` — React state — at 30 Hz per instance. With 6 mixer tracks
open this was **360 React state updates/second**, each triggering a full reconcile
pass and re-render of every `MeterBar` div.

**Fix:** Replaced the two `<MeterBar>` divs with a single `<canvas>` element.
- Level bars drawn directly via `CanvasRenderingContext2D` — no DOM diffing
- dB text updated via `span.textContent` ref — no React re-render
- `aria-valuenow` updated via `element.setAttribute` ref
- `clipped` state retained as React state (fires at most once per session)
- Subscribed to `visualTicker` (shared loop) instead of own `requestAnimationFrame`

**Result:** ~0 React re-renders per frame from meters during playback (down from 360/s with 6 tracks).

---

## Fix 3 — MasterClipBadge document.hidden guard (T005)

**File:** `src/components/TransportBar.tsx`

**Problem:** `MasterClipBadge` ran its own `requestAnimationFrame` loop with no
`document.hidden` guard. It continued polling `audio.getMasterLevels()` when the
tab was backgrounded.

**Fix:** Migrated to `visualTicker.subscribe()`. The shared ticker already pauses
when the tab is hidden, so the badge stops polling for free.

---

## Fix 4 — PositionReadout document.hidden guard (T005)

**File:** `src/components/TransportBar.tsx`

**Problem:** `PositionReadout` polled `audio.positionBeats()` every 60 ms in its
rAF loop with no document.hidden guard.

**Fix:** Added `&& !document.hidden` to the inner condition. The rAF loop keeps
running (so it resumes immediately on tab focus) but skips the position read when
the tab is invisible.

---

## Fix 5 — AudioDiagnosticsPanel dropped-frame rAF guard (T006)

**File:** `src/components/AudioDiagnosticsPanel.tsx`

**Problem:** The dropped-frame monitor rAF ran unconditionally, including when
the tab was hidden. Worse: the first frame after tab-focus would always have a
large Δt (100+ ms since last tick), registering as a dropped frame even though
the user never saw it.

**Fix:**
- Added `document.hidden` check inside the tick callback
- Reset `lastRafTsRef` to `null` when hidden so the first visible frame is not
  counted as dropped

---

## Fix 6 — master.ts clip watcher document.hidden guard (T007)

**File:** `src/lib/audio/master.ts`

**Problem:** `startClipWatcher` ran an 80 ms `setInterval` with no
`document.hidden` guard. This performed `peakMeter.getValue()` 12× per second
while the tab was invisible.

**Fix:** Added `if (document.hidden) return;` at the start of the tick function.
The interval keeps its schedule but skips the CPU work when the tab is hidden.

---

## Fix 7 — Metronome scheduleRepeat clear on disable (T008)

**File:** `src/lib/audio/engine.ts`

**Problem:** `setMetronome(false)` set `this.metronomeEnabled = false` (which
silenced the clicks) but never called `Tone.getTransport().clear(metronomeId)`.
The repeating Transport event continued firing its callback every quarter note,
wasting scheduling CPU and growing the lookahead event queue.

**Fix:**
- When `on === false`: calls `Transport.clear(metronomeId)` and nulls the ID
- When `on === true` and ID is already set: returns early (prevents stacking)
- The `metronomeEnabled` boolean guard inside the callback is kept as a safety
  valve but is no longer load-bearing

---

## Fix 8 — Draft debounce 800 ms → 4 s (T009)

**File:** `src/App.tsx`

**Problem:** Every store change (step toggle, fader move, note edit) triggered a
debounced `saveDraft()` after only 800 ms. During active composition this could
fire 75+ times per minute, each time calling `serializeAndFlushBlobs` which
deep-clones the entire project and writes all blobs to IndexedDB.

**Fix:** Increased the draft debounce from 800 ms to 4000 ms. The `saveDraft`
path is for crash recovery only — 4 s is still well within the window where a
user would lose meaningful work, and the savings from firing 5× less often are
significant. The `saveProject` path (durable save) is unaffected.

---

## Fix 9 — Blob fingerprinting in serializeAndFlushBlobs (T010)

**File:** `src/lib/storage/db.ts`

**Problem:** Every call to `serializeAndFlushBlobs` — which runs on every
`saveDraft` and `saveProject` — unconditionally wrote every audio blob to IDB
with `objectStore.put()`. For a project with multiple recorded vocal clips (each
several MB), this meant MB-scale IDB writes on every autosave even when nothing
had changed.

**Fix:** Added a module-level `blobFpCache: Map<string, string>` that stores
`blobKey → "size:type:lastModified"` fingerprints. Before each `blobs.put`, the
fingerprint is checked; identical blobs are skipped. The cache is warm for the
life of the browser session and cleared on page reload.

---

## Fix 10 — performanceMode setting + body[data-perf] (T003 + T011 + T013)

**Files:** `src/lib/settings.ts`, `src/components/SettingsModal.tsx`, `src/index.css`

**Problem:** No user-accessible way to trade visual fidelity for performance on
slower devices.

**Fix:**
- Added `performanceMode: boolean` to `StudioSettings` (default `false`)
- `applySideEffects` sets `document.body.dataset.perf = "true"` and calls
  `visualTicker.setFpsCap(15)` when enabled
- `SettingsModal` → UI tab → new "Performance mode" toggle after "Reduce animations"
- `src/index.css` — `body[data-perf="true"]` rules:
  - Suppresses `.glow-red`, `.glow-neon`, `.panel-glow::before` box-shadows
  - Disables `.studio-clip-led` animation
  - Sets `opacity: 0; animation: none` on all BackgroundFx particle classes
    (spark, rain, smoke, circuit, pixel, CRT, shuriken, twinkle)
  - Disables the master-pulse LED animation

---

## Fix 11 — WAV export concurrency guard + batched audio decode (T012)

**File:** `src/lib/audio/export.ts`

**Problem (guard):** Nothing prevented the user from triggering a second
`renderProject` while one was already running. Two concurrent
`OfflineAudioContext.startRendering()` calls would both compete for main-thread
CPU and likely cause a page-unresponsive error.

**Problem (batching):** `decodeAudioClips` decoded all audio clips
simultaneously with `decodeAudioData()`. On a project with 10+ vocal clips each
≥5 MB, this spiked heap by ~100+ MB and triggered a long main-thread task.

**Fixes:**
- Added `_exportInProgress` flag: `renderProject` throws immediately if another
  export is in progress; the flag is always cleared in a `finally` block
- Exported `isExportInProgress()` helper for the UI to disable the export button
- `decodeAudioClips` now collects all blobs first, then processes them in
  batches of 4 with `Promise.all`, with a `setTimeout(0)` yield between batches
  so the UI thread stays responsive and progress bars can update

---

## Known Remaining Limitations

| Issue | Why not fixed here |
|---|---|
| WAV export for very long projects (>4 min) still blocks the main thread | OfflineAudioContext.startRendering() is synchronous from the browser's perspective; only a Worker-based render path would solve this completely |
| Main-thread sample decode for files >20 MB | Web Worker decode path is a larger refactor; documented in backlog |
| Full raw Web Audio primitive registry | Tone track voices and scheduled clip players now have stronger cleanup, but world ambience one-shot primitives still use best-effort Web Audio node cleanup |
| SharedArrayBuffer ring buffer for near-zero-latency audio | Already a separate task in the backlog |

---

## Fix 12 — Development-only performance diagnostics instrumentation

**Files:**

- `src/utils/performanceDiagnostics.ts`
- `src/main.tsx`
- `src/App.tsx`
- `src/lib/storage/db.ts`
- `src/lib/audio/export.ts`
- `src/lib/audio/engine.ts`
- `src/hooks/useTransport.ts`
- `src/lib/visualTicker.ts`
- `src/components/MasterScope.tsx`
- `src/components/AudioDiagnosticsPanel.tsx`
- `src/components/TransportBar.tsx`
- `src/components/SamplePreviewDialog.tsx`
- `src/components/instruments/ChopLab.tsx`
- `src/lib/audio/lookahead-scheduler.ts`
- `src/lib/audio/master.ts`
- `src/lib/audio/sampleEdits.ts`
- `src/lib/performance/bassline.ts`

**Problem:** The app had known hot paths but no lightweight, app-local way to
measure durations or count active loops/resources during normal dev usage.

**Fix:** Added a Vite-development-only diagnostics helper around
`performance.mark()` and `performance.measure()`, plus counters for active rAF
loops, intervals, Tone.Transport event IDs, audio resources, autosave attempts,
skipped autosaves, and sample blob writes.

**Measured paths:**

- App startup
- Audio engine initialization
- Project load/save/autosave
- Sample import/edit and waveform generation
- WAV/MP3 export
- JSON export
- Transport play/stop
- Kit switch and instrument replacement
- Visualizer mount/unmount

**How to use in dev console:**

```js
window.__SN_PERF_DIAGNOSTICS__.snapshot()
window.__SN_PERF_DIAGNOSTICS__.enableLogs()
window.__SN_PERF_DIAGNOSTICS__.disableLogs()
window.__SN_PERF_DIAGNOSTICS__.reset()
```

**Production safety:** The helper is gated behind `import.meta.env.DEV`, does
not install a global in production, does not add external analytics, and does
not transmit project data.

**Known diagnostic limitation:** One-shot Tone.Transport note/audio clip events
are tracked when scheduled and when existing cancellation paths clear them.
The current engine does not automatically untrack those IDs when a one-shot
event naturally completes, so use this counter mainly to detect stacking after
stop/load/cancel flows.

**Validation status:**

- `corepack pnpm --filter @workspace/studio typecheck` runs with Git `sh` on
  PATH and pnpm pre-run dependency verification disabled, but fails on existing
  unrelated TypeScript errors outside the diagnostics patch.
- `corepack pnpm --filter @workspace/studio build` fails before app compilation
  because Rollup cannot resolve its Windows native optional package.
- `corepack pnpm --filter @workspace/studio test` fails before tests because
  the Playwright webServer command is not Windows-compatible and Chromium is
  not found.

---

## Fix 13 — Render-storm cleanup for playback UI loops

**Files:**

- `src/components/TransportBar.tsx`
- `src/components/MasterScope.tsx`
- `src/components/Timeline.tsx`
- `src/components/instruments/PianoRoll.tsx`
- `src/components/instruments/DrumPads.tsx`
- `src/components/instruments/VocalsPanel.tsx`
- `src/components/AudioDiagnosticsPanel.tsx`
- `src/components/MasterStrip.tsx`

**Problem:** Several playback-adjacent UI elements still owned independent rAF
loops or pushed React state during high-frequency visual updates. The main
confirmed risks were `ProjectClipBadge`, `MasterScope`, arrangement/piano-roll
playheads, DrumPads active-step highlighting, the vocal monitor meter, the
diagnostics panel, and the master clip latch.

**Fixes:**

- Moved `ProjectClipBadge` from its own 30 Hz rAF loop to `visualTicker`.
- Skipped project-wide track-meter scans unless playback is running or clip
  history is open.
- Gated clip-badge React state writes behind actual newly clipped track IDs.
- Moved `MasterScope`, `Timeline` playhead, `PianoRoll` playhead, and master
  clip polling to `visualTicker`.
- Cached `MasterScope` colors instead of calling `getComputedStyle()` on every
  draw.
- Changed DrumPads active-step highlighting from React state/prop fanout to
  direct DOM class updates on matching step cells.
- Changed the vocal monitor level meter from per-frame `setState` to direct
  ref style updates through `visualTicker`.
- Reduced `AudioDiagnosticsPanel` polling from 4 Hz to 1 Hz and paused
  diagnostics polling while `document.hidden`.
- Avoided redundant transport position text writes when the bar.beat.step value
  has not changed.

**Result:** Playback visual updates now share the same capped ticker used by
meters. Performance Mode continues to cap the shared ticker at 15 FPS, so the
patched playheads, scope, vocal meter, diagnostics frame monitor, and clip badge
all inherit the lower visual cadence.

**Validation status:**

- `npm run build` fails immediately because the root build script shells out to
  `pnpm`, and direct `pnpm` is not on PATH in this PowerShell session.
- `corepack pnpm --filter @workspace/studio typecheck` still fails on existing
  unrelated TypeScript errors in `Header.tsx`, `PluginBrowser.tsx`,
  `WorldContext.tsx`, `worldAudio.ts`, `worlds.ts`, and `LandingPage.tsx`.
- `corepack pnpm --filter @workspace/studio build` still fails before app
  compilation because Rollup cannot resolve `@rollup/rollup-win32-x64-msvc`.
- `corepack pnpm --filter @workspace/studio test` still fails before tests
  because the Playwright webServer command is not Windows-compatible and
  Chromium is not found.

---

## Fix 14 — Audio lifecycle, Transport ownership, and cleanup hardening

**Files:**

- `src/lib/audio/engine.ts`
- `src/hooks/useTransport.ts`
- `src/store.ts`
- `src/contexts/WorldContext.tsx`

**Confirmed root causes:**

- `panicStopAll()` intentionally preserved clip and metronome Transport events,
  which made panic a partial audio kill instead of a full scheduler reset.
- Note and audio clip Transport IDs were returned to `useTransport`, but the
  engine did not own a track-scoped registry for cancelling schedules during
  track deletion, project reset, or panic.
- Scheduled `Tone.Player` audio clips created object URLs and could be disposed
  directly by the hook, bypassing central URL/resource cleanup.
- Automation used a 20 ms `Transport.scheduleRepeat` that started when
  automation/modulation appeared but was not stopped when the last lane/source
  was removed.
- World ambience created a separate raw `AudioContext`; the studio now uses the
  Tone raw context for live ambience so there is one intended live context.

**Fixes:**

- Added an internal playback state machine:
  `stopped`, `starting`, `playing`, `paused`, `stopping`, `error`.
- `audio.play()` now no-ops during duplicate start attempts, restarts missing
  metronome/automation schedules when needed, and only starts Tone.Transport
  when it is not already started.
- `audio.stop()` now releases sustained notes and stops scheduled audio players
  without disposing reusable clip players.
- Reworked `panicStopAll()` to stop Transport, reset position, clear all
  engine-owned note/audio clip Transport IDs, clear the explicit metronome
  `scheduleRepeat` ID, stop automation scheduling, clear worklet/lookahead
  queues, stop/dispose scheduled audio clip players, release active notes, and
  close live mic monitoring.
- Added an engine-owned Transport resource registry with labels and optional
  track IDs for note/audio clip schedules.
- Added track-scoped cleanup on `removeTrack()` and `removeAllTracksExcept()`
  so deleted/project-replaced tracks cancel old schedules and dispose voices.
- Added `cancelAllProjectSchedules()` and call it from `resetStore()` so project
  load/recovery/demo swaps clear old project events before the store changes.
- Routed scheduled audio clip player disposal through
  `audio.disposeScheduledAudioPlayers()` so object URLs are revoked and active
  player tracking is cleared consistently.
- Hardened instrument replacement disposal by releasing sustained notes before
  disposing melodic voices and by clearing replaced kit/preset IDs.
- Stopped the automation Transport repeat when no automation/modulation remains.
- Switched `WorldProvider` ambience from `new AudioContext()` to
  `Tone.getContext().rawContext`.

**Risk level:** Medium. The patch changes ownership and cleanup around core
playback, but avoids changing note generation, instrument definitions, or UI
flows.

**Validation status:**

- `npm run build` fails before app compilation because Rollup cannot resolve
  `@rollup/rollup-win32-x64-msvc` from the existing Windows install.
- `corepack pnpm --dir artifacts/studio run typecheck` is blocked by pnpm
  dependency verification unless Git `sh` is added to PATH; with Git `sh` on
  PATH it is blocked by pnpm `approve-builds` for `esbuild`.
- Direct local TypeScript check
  `& '..\..\node_modules\.bin\tsc.cmd' -p tsconfig.json --noEmit` runs and
  fails only on existing unrelated errors in `Header.tsx`, `PluginBrowser.tsx`,
  `worldAudio.ts`, `worlds.ts`, and `LandingPage.tsx`.
- `npm run test` fails before tests because the Playwright webServer command
  uses POSIX-only `which` and `PORT` syntax on Windows.

**Remaining risks:**

- Full browser manual audio testing is still needed after the Rollup optional
  dependency/install state is repaired.
- World welcome/ambient primitives still synthesize raw Web Audio nodes on the
  shared Tone context; they are no longer a second live context, but their
  individual one-shot nodes are still best-effort cleanup.
- Offline export intentionally creates temporary `AudioContext`/
  `Tone.OfflineContext` instances and closes/restores them after decoding or
  rendering.

---

## Fix 15 — Storage, autosave, sample import, waveform, and export guardrails

**Files:**

- `src/App.tsx`
- `src/store.ts`
- `src/lib/storage/db.ts`
- `src/lib/storage/performanceGuards.ts`
- `src/lib/audio/export.ts`
- `src/lib/audio/sampleEdits.ts`
- `src/lib/audio/waveformPeaks.ts`
- `src/components/Header.tsx`
- `src/components/LeftBrowser.tsx`
- `src/components/SamplePreviewDialog.tsx`
- `src/components/Timeline.tsx`
- `src/components/instruments/ChopLab.tsx`

**Confirmed root causes:**

- Autosave used a boolean dirty flag and project object identity, but had no
  project revision / saved revision tracking.
- The first project change after subscription could be skipped by the old
  autosave guard.
- Draft autosave skipped during playback and did not requeue unless another
  store change happened.
- Blob write skipping used `size:type:lastModified`; same-size edited content
  could be missed.
- JSON import summary hydrated embedded base64 blobs before confirmation.
- Export decoded the finished WAV/MP3 blob again just to check clipping.
- Timeline audio clips decoded full blobs per clip mount to draw waveforms.
- Sample preview, Chop Lab, and sample relink paths had no consistent oversized
  file guard before decode.

**Fixes:**

- Added `projectRevision` to the store and revision-aware autosave tracking in
  `App.tsx`.
- Draft autosave remains debounced at 8 seconds, now skips clean revisions, and
  requeues while playback or critical storage/export/import work is active.
- Periodic project autosave clears dirty state only after a successful save of
  the current revision.
- Added `performanceGuards.ts` for critical-operation gating, sample/JSON size
  limits, byte formatting, and one-time blob content fingerprints.
- Switched IDB blob skip checks to cached SHA-256 content fingerprints instead
  of size-only metadata.
- Assigned stable audio clip blob keys at clip creation.
- JSON export now yields between blob conversions/tracks/samples.
- JSON import summary parses and migrates lightweight project metadata without
  hydrating embedded blobs; full blob hydration now happens only after the
  existing confirmation modal.
- Wrapped audio export, stems export, DAW Pack export, JSON export, and JSON
  import in critical-operation guards so autosave backs off during heavy work.
- Removed the post-export full decode in `Header.tsx`; clipping is detected from
  the render buffer before encoding.
- WAV encoding now yields periodically and reports encoding progress during
  large buffers.
- Audio clip decode for export now runs in smaller batches of 2 with progress
  updates and UI yields between batches.
- Added a cached waveform peak generator for timeline audio clips so repeated
  visible waveform renders do not repeatedly decode the same blob.
- Added oversized sample rejection at 50 MB and large-sample warnings at 20 MB
  for drop import, Sample Preview, Chop Lab, and sample relink.
- Added stale-result tokens for Sample Preview and Chop Lab imports so a slower
  previous decode cannot overwrite a newer import.
- Corrected the autosave settings copy from "~1s" to "~8s".

**Risk level:** Medium. The patch changes save/export/import timing and adds
guardrails, but keeps the persisted project schema and confirmation behavior.

**Validation status:**

- `npm run typecheck` runs and now fails only on existing unrelated errors in
  `PluginBrowser.tsx`, `worldAudio.ts`, `worlds.ts`, and `LandingPage.tsx`.
- `npm run build` fails before app compilation because Rollup cannot resolve
  `@rollup/rollup-win32-x64-msvc` from the existing Windows install.
- No `lint` script exists in `artifacts/studio/package.json`.
- `npm run test` fails before tests because the Playwright webServer command
  uses POSIX-only `which` and `PORT` syntax on Windows.

**Remaining risks:**

- WAV/MP3 export still uses full `OfflineAudioContext.startRendering()` and
  holds the final render buffer in memory; long dense projects can still exceed
  browser limits.
- Project-with-samples JSON export still creates large base64 strings by design,
  but now yields and avoids blob hydration before import confirmation.
- Sample editing still performs full-buffer transforms on the main thread after
  decode; very large files are rejected before that path.
- Manual browser validation is still required after the Rollup optional
  dependency/install state is repaired.

---

## Fix 16 — CSS paint, decorative FX, lazy panels, Performance Mode, and PWA cache

**Files:**

- `src/index.css`
- `src/components/BackgroundFx.tsx`
- `src/components/MasterScope.tsx`
- `src/components/TransportBar.tsx`
- `src/components/LeftBrowser.tsx`
- `src/App.tsx`
- `src/lib/audio/engine.ts`
- `src/lib/pwa.ts`
- `public/sw.js`

**Confirmed root causes:**

- Normal mode background FX rendered dozens of animated DOM nodes for rain,
  sparks, smoke, scanline pixels, and twinkles.
- Background FX unmounted in Performance Mode, but not while the tab was hidden.
- Performance Mode removed some glow classes, but dense step/pad surfaces,
  meter shadows, backdrop blur, and utility shadow classes could still force
  expensive paint/compositing.
- `AudioDiagnosticsPanel`, `PluginBrowser`, `HelpDialog`, and `ChopLab` were
  statically imported even though they are hidden until a panel/dialog/tab opens.
- The master scope always used a 256-point analyser even in Performance Mode.
- The service worker used cache-first runtime handling for all same-origin GETs,
  which could stale-cache future runtime endpoints or sample-serving routes.

**Fixes:**

- Reduced normal-mode decorative DOM counts:
  shuriken twinkles 60 -> 36, sparks 28 -> 18, rain drops 60 -> 32, smoke blobs
  8 -> 5, scanline pixels 20 -> 12.
- `BackgroundFx` now unmounts while `document.hidden`, removing decorative
  animation work without touching intentional audio playback.
- Extended `body[data-perf="true"]` CSS to strip dense UI shadows, glow classes,
  panel inset shadows, animated pulse classes, backdrop blur, and grid
  background effects while preserving layout geometry.
- Removed the small blur filter from the static shuriken backdrop.
- Lazy-loaded `HelpDialog`, `ChopLab`, `PluginBrowser`, and
  `AudioDiagnosticsPanel` behind their actual visible states with safe Suspense
  fallbacks.
- `MasterScope` now requests a 128-point analyser and samples fewer points in
  Performance Mode; normal mode remains 256-point.
- `audio.getMasterAnalyser(size)` now recreates and disposes the analyser when
  the requested safe size changes.
- Service worker runtime caching is now limited to the app shell and static Vite
  assets; arbitrary same-origin GETs, API paths, sample paths, audio/video, blob,
  data, and range requests pass through without SW caching.
- `applyUpdate()` now ignores duplicate update-apply clicks and clears the toast
  state before posting `SKIP_WAITING`, avoiding reload-loop style repeated
  actions.

**Risk level:** Low to medium. The changes mainly gate visuals and lazy-load
hidden panels. The highest-risk area is service worker caching behavior, but it
now aligns with the intended app-shell-only cache policy.

**Validation status:**

- `npm run typecheck` passes.
- `npm run build` passes after current-platform Windows native package and
  Windows build-script fixes in the final verification pass.
- No `lint` script exists in `artifacts/studio/package.json`.
- `npm run test` passes after Playwright browser install and stale test-route
  correction.
- Production preview served `/` and `/studio` successfully.

**Remaining risks:**

- Export modal logic still lives inside `Header.tsx`, so it was not split into
  a lazy component during this scoped pass.
- `SoundLibraryPanel` remains statically imported because the Library tab can be
  the persisted default tab; lazy-loading it is possible but needs a separate
  startup UX decision.
- Full fresh-cache/old-cache browser validation still depends on a successful
  production build/preview.

---

## Self-Review Patch

Date: 2026-06-12

### Blocking Issue Found

`AudioEngine.panicStopAll()` now correctly clears engine-owned Transport events
and disposes scheduled audio clip players, but `useTransport()` only rebuilt
project schedules when the project-derived `scheduleKey` changed. Pressing Panic
could therefore clear note/audio clip schedules and leave the next Play with no
project clips scheduled until the user edited the project or loaded another one.

### Patch Applied

- Added `transportScheduleRevision` to the store as a lightweight invalidation
  counter.
- Included that revision in `useTransport()`'s schedule key.
- Bumped the revision from desktop Panic, mobile Panic, keyboard Escape panic,
  and error-boundary panic paths immediately after `audio.panicStopAll()`.

### Risk

Low. The patch does not change project data, audio rendering, UI layout, or file
formats. It only forces the existing schedule cleanup/rebuild effect to run after
hard panic clears engine schedules.

---

## Final Verification

Date: 2026-06-12

### Commands Run

| Command | Result | Output summary |
| --- | --- | --- |
| `corepack pnpm install` | Pass with prior blocker cleared | Initially added missing Windows native packages but exited on pnpm build approval. After `corepack pnpm approve-builds --all`, `esbuild@0.27.3` postinstall completed. |
| `npm run typecheck` in `artifacts/studio` | Pass | `tsc -p tsconfig.json --noEmit` completed with no TypeScript errors. |
| `npm run build` in `artifacts/studio` | Pass with warnings | Client and SSR builds completed; prerender completed. Warnings remain for sourcemap locations, static/dynamic import overlap, and a 2.08 MB minified main chunk. |
| `npm run test` in `artifacts/studio` | Pass | 4 Playwright welcome-flow tests passed after installing Chromium and correcting the stale `/` test URL to `/studio?disableAudio=1`. |
| `npm run serve -- --strictPort true` in `artifacts/studio` | Pass | Production preview served at `http://localhost:5173/`; both `/` and `/studio` returned HTTP 200 after stale listeners were stopped. |
| `corepack pnpm run typecheck:libs` | Pass | Root library TypeScript build completed. |
| `corepack pnpm run build` at repo root | Blocked by local PATH | Root script calls bare `pnpm`; Corepack could not install global shims under `C:\Program Files\nodejs` without elevation. |
| `corepack pnpm -r --if-present run build` | Blocked outside studio | `artifacts/mockup-sandbox` build requires `PORT`; studio package build itself passes. |
| Lint | Not available | No root or studio `lint` script exists. |

### Command Output Summary

- Fixed Windows verification blockers in `pnpm-workspace.yaml` by allowing the
  current-platform native packages for Rollup, esbuild, lightningcss, and
  Tailwind oxide.
- Fixed `artifacts/studio/vite.config.ts` so production build/preview default
  to `PORT=5173` and `BASE_PATH=/` when env vars are not provided.
- Fixed `artifacts/studio/scripts/prerender.mjs` to import the SSR entry through
  `pathToFileURL()` on Windows.
- Fixed narrow TypeScript errors in `PluginBrowser.tsx`, `worlds.ts`,
  `worldAudio.ts`, and `LandingPage.tsx`.
- Fixed Playwright config for Windows and updated the stale studio test route.

### Manual Tests Performed

These checks were performed against production preview with Playwright-driven
manual smoke scripts:

- App loads at `/studio` and renders the studio header.
- No obvious console errors or uncaught page errors on load.
- Audio enable button appears and disappears after click without captured
  console/page errors.
- Play, pause, stop, and panic buttons respond in the UI.
- Demo load via Load dialog loaded `Trap Starter`.
- Project-only JSON export downloaded a `.snproj.json` file.
- WAV export downloaded `shotgun-ninjas-studio_Cyber_Dojo_Demo_96_2026-06-12.wav`.
- Performance Mode persisted setting applied `body[data-perf="true"]`.
- Service worker registered under `http://127.0.0.1:5173/` and controlled the
  page after reload.
- Direct `/studio` production preview route returned HTTP 200.

### Pass / Fail Table

| Checklist item | Status | Evidence |
| --- | --- | --- |
| App loads | Pass | Production preview `/studio` rendered `header`. |
| Audio enable works | Pass | Enable button disappeared after click; no captured console/page errors. |
| Play/pause works | Pass | Play button changed to Pause and Pause click returned control. |
| Stop works | Pass | Stop button clicked after playback smoke. |
| Panic works | Pass | Panic button clicked without captured console/page errors. |
| Load demo project | Pass | Load dialog loaded `Trap Starter`. |
| Playback extended session | Not completed | No 10-minute runtime profile was captured. |
| Mixer during playback | Partial | Transport playback smoke ran; no dedicated mixer-open profile was captured. |
| Visualizer during playback | Partial | Master scope mounted in transport; no separate visualizer studio panel profile was captured. |
| Sample import | Not completed | No file-drop/import smoke was completed in this final pass. |
| Save/load project | Partial | Demo load and export verified; explicit IndexedDB save/reload was not fully exercised. |
| JSON export/import | Partial | Project-only JSON export passed; import chooser path used File System Access in headless and was not completed. |
| WAV export | Pass for default project | WAV download completed for default `Cyber Dojo Demo`. |
| Performance Mode on/off | Partial | Persisted Performance Mode applied `body[data-perf="true"]`; UI toggle itself was not completed in headless. |
| Tab hidden/restored | Not completed | No reliable headless visibility-state test was captured. |
| Repeated kit switch | Not completed | Not exercised in final verification. |
| Repeated project load | Partial | Playwright welcome-flow tests repeatedly loaded/remixed demos; no long repeated load/unload scheduler profile was captured. |
| Service worker update/cache sanity | Partial | SW registration/control and HTTP 200 routing verified; old-cache update prompt scenario not simulated. |

### Known Limitations

- Root `pnpm run build` remains dependent on a bare `pnpm` shim being on PATH.
  Corepack could not install global shims without elevation, but the equivalent
  studio package commands were run directly and passed.
- Workspace recursive build is blocked by `artifacts/mockup-sandbox` requiring
  `PORT`; this is outside the studio package.
- Production build still emits a large main chunk warning (`index` chunk about
  2.08 MB minified / 592 KB gzip).
- Vite reports that dynamic imports of `engine.ts` and `master.ts` do not create
  separate chunks because those modules are also statically imported elsewhere.
- Build emits sourcemap warning messages for several UI component modules.
- Long-session playback, heap snapshots, old service-worker cache update flow,
  sample import, and repeated kit/project stress loops still need hands-on
  browser profiling.

### Remaining Risks

- Export remains memory-heavy for long/dense projects because offline render and
  final encoding still hold full buffers.
- Main bundle size is still large despite lazy-loading several panels.
- File System Access API import paths need a dedicated browser/manual test; the
  headless JSON import attempt did not complete.
- The root workspace still has non-studio verification friction on Windows.

### Recommended Next Action

Run a focused browser profiling session on production preview with a real
interactive browser: 10-minute playback, mixer open, visualizer open, repeated
kit switching, repeated demo load, normal sample import, and old-service-worker
update simulation. Capture Performance panel traces and heap snapshots before
starting the next optimization pass.

---

## Runtime Profiling Patch

Date: 2026-06-12

### Runtime Evidence

Production preview profiling created `PERFORMANCE_RUNTIME_PROFILE.md` and local
JSON evidence under `runtime-profile/`. The 10-minute playback acceptance test
did not pass because the test could not begin safely: after audio was enabled,
loading Trap Starter produced page-freezing long tasks.

Measured evidence:

- Cold `/studio` production load had long tasks up to 3,280 ms and 2,266 ms.
- Enable Audio completed, but AudioWorklet rewire still fell back to the Tone.js
  chain.
- Loading Trap Starter after audio was enabled initially produced a 38,011 ms
  long task.
- After scoped cleanup/defer patches, the largest measured post-audio demo-load
  task was still 26,716 ms.

### Fixes Applied

- Added local runtime profiling harness: `scripts/runtime-profile.mjs`.
- Hardened `WorkletManager` context resolution for Tone and
  standardized-audio-context wrappers.
- Passed the Tone context wrapper into worklet registration/node creation paths.
- Removed duplicate eager demo/remix `ensureTrack()` and `flushMixToEngine()`
  calls.
- Removed synchronous demo/remix `disposeAllTracks()` calls from click handlers.
- Removed synchronous `removeAllTracksExcept()` from `resetStore()`.
- Deferred and chunked transport scheduling so cleanup/scheduling yields between
  tracks.

### Current Blocker

The studio is not release-safe. A single track graph build through
`audio.ensureTrack()` / `buildVoice()` can still monopolize the main thread for
roughly 27 seconds in production preview after audio has been enabled.

### Required Next Patch

Make `buildVoice()` incremental/lazy:

- Create a cheap track shell first.
- Lazy-create disabled FX nodes only when the user enables or changes them.
- Yield between instrument, channel, send, meter, and FX construction phases.
- Add per-node-family timing marks before attempting another 10-minute playback
  acceptance run.

---

## Runtime Trace Stabilization Patch

Date: 2026-06-14

### Trace Root Causes Confirmed

- The blob AudioWorklet source is the inline `PROCESSOR_CODE` bundle in
  `src/lib/audio/worklet-manager.ts`.
- `SaturationProcessor.process()` allocated a new `Float32Array` every render
  quantum when oversampling was enabled. That matched the trace's blocked blob
  `process` function pattern.
- `AudioEngine.buildVoice()` eagerly created a dense per-track Tone graph,
  including disabled/wet-0 FX such as `Tone.Chorus`, `Tone.Distortion`,
  `Tone.Compressor`, `Tone.BitCrusher`, EQ/high-pass filters, and stereo
  width. This explains the trace hot spots around `createIIRFilter`,
  `createPeriodicWave`, and `createGain` during project/demo activation.
- Master worklet parameter writes were applied synchronously whenever master
  settings changed.

### Fixes Applied

- Removed real-time typed-array allocation from the saturation worklet process
  path. Oversampling now computes the interpolated sample inline per block.
- Coalesced master worklet parameter writes behind a 33 ms timer so rapid
  setting changes are batched instead of flushed immediately.
- Changed default track construction to a lean chain:
  `filter -> delay -> reverb -> channel -> master`.
- Added lazy creation and rewiring for optional track FX/EQ modules. EQ,
  compressor, saturation, chorus, bitcrusher, and stereo width nodes are only
  instantiated when user settings, sound params, or automation require them.
- Added defensive `AudioEngine.dispose()` cleanup for panic, scheduled events,
  tracks, metronome worklet, lookahead scheduler, master analyser, master chain,
  and worklet blob URL.
- Added dev/HMR duplicate-engine detection and HMR cleanup through a dynamic
  import in `main.tsx` so cleanup does not force eager engine construction.

### Commands Run

| Command | Result | Summary |
| --- | --- | --- |
| `npm run typecheck` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `npm run build` | Pass with warnings | Client/SSR/prerender completed. Existing sourcemap, dynamic/static import overlap, and large chunk warnings remain. |
| `corepack pnpm --dir artifacts/studio run typecheck` | Pass | Clean pnpm typecheck completed. |
| `corepack pnpm --dir artifacts/studio run build` | Pass with warnings | Same build warnings as npm build. |
| `corepack pnpm --dir artifacts/studio run test` | Partial | All 4 Playwright tests printed `ok`, but the wrapper timed out after 180 s because the command did not exit cleanly. |

### Runtime Verification

Production preview could be started in the foreground, but background preview
processes did not stay reachable across sandbox tool calls, so a fresh
post-patch Chrome trace was not captured in this pass. Do not treat this patch
as the final 10-minute playback acceptance pass until it is profiled in an
interactive browser.

### Remaining Risks

- The default track shell is now much lighter, but instrument factories and kit
  creation can still be expensive and need a fresh trace.
- AudioWorklet graph rewire has prior fallback risk because native worklet nodes
  and Tone/standardized-audio-context nodes do not always connect cleanly.
- Playwright's test command needs cleanup because it reported all tests passing
  but left the command alive until the wrapper timeout.

---

## Worklet Fallback Cleanup Patch

Date: 2026-06-14

### Root Causes Confirmed

- The remaining console warnings came from the master worklet rewire path
  failing after nodes were created, then falling back without detailed error
  metadata or explicit partial-node cleanup.
- `AudioEngine.unlock()` could attempt worklet setup again if the first attempt
  failed before the engine reached the unlocked state.
- Message usage in app code is limited to service-worker lifecycle messages and
  AudioWorklet ports. There is no visualizer/diagnostics `message` stream in
  the app code. The risky paths are therefore AudioWorklet node ports and
  sample-player PCM transfers.
- The unlock button flipped React store state immediately after `audio.unlock()`,
  putting UI rerender/layout in the same click task as Tone startup.

### Fixes Applied

- Added structured worklet error logging with `err.name`, `err.message`, and
  `err.stack`, while still passing the original exception to `console.warn`.
- Added one-shot worklet initialization state in `AudioEngine`; failed worklet
  setup marks worklets unavailable for the runtime session.
- Added `WorkletManager.markUnavailable()` and `disposeNode()` to close ports,
  null `port.onmessage`, disconnect nodes, and stop probe state.
- On master worklet rewire failure, cleanup now clears pending param timers,
  disposes partial AudioWorkletNodes, restores the Tone fallback chain, and
  marks worklets unavailable.
- Capped sample-player worklet PCM transfers to short/small samples and skipped
  the worklet path once worklets are unavailable.
- Added abortable PWA runtime listeners and interval cleanup for service-worker
  message/controller listeners.
- Deferred noncritical `audioUnlocked` store updates to `requestAnimationFrame`
  after audio unlock.
- Enabled production sourcemaps in `vite.config.ts` so Chrome violation stack
  locations can map back to TypeScript during profiling.

### Commands Run

| Command | Result | Summary |
| --- | --- | --- |
| `corepack pnpm --dir artifacts/studio run typecheck` | Pass | TypeScript completed cleanly. |
| `corepack pnpm --dir artifacts/studio run build` | Pass with warnings | Build completed and emitted sourcemaps. Existing dynamic/static import overlap, source location, and large chunk warnings remain. |
| `corepack pnpm --dir artifacts/studio exec playwright test --reporter=line --workers=1` | Blocked by local command resolution | `pnpm exec` did not resolve `playwright` on PATH in this Windows shell. |
| `.\node_modules\.bin\playwright.CMD test --reporter=line --workers=1` | Partial / timeout | The 4 test names started, but the command did not exit before the 240 s wrapper timeout. No failure lines were printed before timeout. |

### Remaining Risks

- A fresh Chrome trace is still required to prove the 5.9 s and 45.4 s
  `message` handler violations are gone.
- Production sourcemaps add a large `.map` artifact for the main bundle; keep
  them only if profiling builds are acceptable, or gate them behind an env var
  after the next trace is captured.
- Playwright command exit behavior still needs a separate cleanup pass.

---

## 2026-06-15 Runtime Profile Recheck Patch

### Root Causes Confirmed

- Cold production `/studio` load still contains multi-second startup long tasks.
  Latest short profile captured a 1,862 ms startup long task and 2,879 ms total
  startup long-task time.
- The current release blocker is now earlier than demo load: after audio
  unlock, the first Play path does not transition the UI to Pause in production
  profiling and leaves CDP metrics calls timing out.
- The AudioWorklet path should not be treated as stable for default runtime
  sessions yet. It remains opt-in for profiling with
  `VITE_STUDIO_ENABLE_AUDIO_WORKLETS=1`.

### Fixes Applied

- Added an opt-in gate for AudioWorklet initialization so failed worklet setup
  is not retried during normal unlock/play/project-load paths.
- Added a 5 s `Tone.start()` timeout and scheduled audio startup outside the
  direct unlock click handler to reduce click-task blocking.
- Added a defensive `AudioEngine.play()` guard that refuses to call
  `Tone.Transport.start()` until the underlying AudioContext reports
  `running`.
- Updated transport callers so Play/Record UI state changes only after the
  audio engine accepts the transport start.
- Hardened `scripts/runtime-profile.mjs` so stuck scenarios produce JSON
  evidence instead of aborting the run:
  - CDP metrics timeout with failure records.
  - Empty metrics placeholders for unresponsive pages.
  - Muted headless Chromium audio output.
  - `noWaitAfter` for SPA transport clicks.

### Commands Run

| Command | Result | Summary |
| --- | --- | --- |
| `npm run typecheck` | Pass | TypeScript completed cleanly after the runtime guard changes. |
| `npm run build` | Pass with warnings | Build completed. Existing sourcemap lookup, dynamic/static import overlap, and large bundle warnings remain. |
| `npm run test` | Partial / timeout | Earlier in this pass all 4 Playwright tests printed `ok`, but the command wrapper timed out after 240 s and did not exit cleanly. |
| Production preview + `STUDIO_PROFILE_MINUTES=0.1 node scripts/runtime-profile.mjs` | Fail | Cold load passed; audio startup/play/pause scenario failed; all downstream scenarios failed because metrics timed out afterward. |

### Runtime Evidence

- Latest profile artifact:
  `runtime-profile/runtime-profile-1781535822280.json`.
- Cold load passed in 4,004 ms with 23.86 MB JS heap, 3,496 browser metric
  nodes, 5,735 JS event listeners, and 2,344 DOM elements.
- Audio startup/play/pause failed after 42,252 ms. The Play click completed, but
  the profiler timed out waiting for the Pause button, then post-scenario CDP
  metrics timed out.

### Release Safety

Not release-safe.

The exact next blocking issue is to isolate the synchronous work or audio
subsystem wait triggered by the first Play click after audio unlock. The next
patch should add marks around `AudioEngine.play()`, `Tone.Transport.start()`,
transport scheduled callbacks, and any graph realization that happens during
that first Play, then make that path bounded and non-blocking before attempting
the 10-minute playback acceptance run again.

---

## 2026-06-15 First-Play Freeze Repair

### Root Cause Confirmed

The first-Play blocker was not `Tone.Transport.start()` by itself. The
isolation matrix showed that Transport starts quickly when project schedules,
transport callbacks, or graph builds are suppressed.

Confirmed root cause:

- `App.tsx` eagerly built all track voices during bootstrap/recovery via
  `audio.ensureTrack()` and `flushMixToEngine()`.
- `useTransport()` could arm schedule prep immediately after first Play,
  allowing `ensureTrack()` / `buildVoice()` / Transport scheduling to run while
  playback was active.

That violated the first-Play invariant: pressing Play must not construct audio
graphs or bulk-register project schedules.

### Fixes Applied

- Added `src/lib/performance/firstPlayTrace.ts`, a local-only ring buffer
  enabled by `?snFirstPlayTrace=1` or `localStorage["sn:firstPlayTrace"]="1"`.
- Added debug isolation flags:
  `snDisableProjectSchedules`, `snDisableTransportCallbacks`,
  `snDisableGraphBuildOnPlay`, `snUseMinimalAudioGraph`,
  `snDisableWorldAudio`, and `snDisableAnalyzers`.
- Added first-Play marks/measures around UI Play, `useTransport.play()`,
  `AudioEngine.play()`, `Tone.Transport.start()`, schedule prep,
  `ensureTrack()`, `buildVoice()`, instrument factories, node creation,
  analyser creation, `flushMixToEngine()`, and store writes.
- Removed eager bootstrap/recovery track graph realization from `App.tsx`.
- Deferred project schedule prep until after first Play is confirmed, and
  prevented prep from running while playback is active.
- Made `snDisableAnalyzers=1` skip analyser creation in `MasterScope` without
  throwing through React render.
- Extended `scripts/runtime-profile.mjs` with a first-Play isolation matrix and
  JSON trace capture.

### Verification

| Command / profile | Result | Summary |
| --- | --- | --- |
| `npm run typecheck` | Pass | TypeScript completed cleanly. |
| `npm run build` | Pass with warnings | Build completed with existing sourcemap, import-overlap, and large chunk warnings. |
| `npm run test` | Partial / timeout | 4 Playwright tests printed `ok`, but the command wrapper timed out after 240 s and did not exit cleanly. |
| First-play matrix | Pass | All seven matrix scenarios passed in production preview. |
| Short 0.1-minute runtime profile | Partial / fail | First Play, audio startup/panic/replay, Trap Starter short playback, mixer stress, and sample import passed; later stress/export/import scenarios failed. |

Latest profile artifacts:

- `runtime-profile/runtime-profile-1781555968920.json`
- `runtime-profile/runtime-profile-1781556158517.json`

### Release Safety

Not release-safe.

First Play is no longer the immediate blocker: Pause appears after Play and CDP
metrics remain responsive. The next blocker is the broader runtime stress path:
Trap Starter still emits a 9.65 s long task, mixer stress grows JS listeners by
15,275, and visualizer/preset/project-load/save/import/export scenarios still
fail in the short profile. The 10-minute playback acceptance test was not run.
