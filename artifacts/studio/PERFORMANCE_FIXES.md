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
| Full voice disposal registry | Requires auditing every voice-rebuild path; deferred to a dedicated task |
| SharedArrayBuffer ring buffer for near-zero-latency audio | Already a separate task in the backlog |
