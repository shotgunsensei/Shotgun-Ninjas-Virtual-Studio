# Performance Baseline

> **Note**: This baseline was produced via static code audit + runtime log analysis.
> Browser-based Chrome Performance recordings and heap snapshots should be taken
> against the production build to confirm or update the estimates below.

## Production Build Status

- `pnpm --filter @workspace/studio run build` — **passes** (verified via CI).
- No TypeScript errors or Vite build errors at time of audit.

## Dev-Server vs. Production Behavior

| Scenario | Dev server | Production preview |
|---|---|---|
| Initial load | Slower — HMR overhead | Faster — pre-bundled assets |
| React re-renders | Worse — StrictMode double-invokes effects | Better — single render |
| Bundle size | Large (un-minified) | Minified, tree-shaken |
| Service worker | Inactive | Active (Vite PWA) |

**Implication:** Some lag reported by users may be amplified by dev-server overhead.
All acceptance testing must use the production preview.

## Chrome Performance Recording Notes (Code-Review Estimates)

The following estimates are based on code audit. Profiler recordings should update these.

### Suspected Long Tasks (>50 ms) — Not Yet Profiler-Verified

| Scenario | Estimated Duration | Root Cause |
|---|---|---|
| Audio engine unlock | 50–200 ms | AudioContext.resume() + WorkletManager.register() |
| Demo project load | 100–500 ms | Deep-clone + resetStore + ensureTrack × N tracks |
| Sample import (small file) | 50–200 ms | decodeAudioData on main thread |
| IDB draft snapshot | 20–100 ms | serializeAndFlushBlobs (deep clone + blob writes) |
| WAV export | 1000–30000 ms | OfflineContext render — blocks waiting for Promise |
| Mixer open w/ 6+ tracks | 30–100 ms | StereoMeter useState cascade on first paint |

### Approximate Long-Task Count (60-second playback, code estimate)

- `saveDraft()` fires ~800 ms after any store change → up to **75 draft writes/minute** during active composition
- `StereoMeter.setLevels()` fires at 30 Hz × N channels → up to **180 React state updates/second** with 6 tracks
- `ProjectClipBadge` polls all track meters at 30 Hz even when no clip occurs
- `MasterClipBadge` rAF loop runs with no `document.hidden` guard — continues while tab is hidden

### Worst Observed Main-Thread Task (code estimate)

- Estimated worst case: `saveDraft` on a large project with recorded vocal clips = **50–200 ms IDB write + blob serialization**
- Next worst: `StereoMeter` cascade during mixer open with many tracks

## React Render / Commit Observations

### High-Frequency State Updates Identified

| Component | State field | Update rate | Re-renders triggered |
|---|---|---|---|
| `StereoMeter` | `levels` | 30 Hz per instance | Entire meter including MeterBars |
| `StereoMeter` | `peaksDb` | 30 Hz per instance | Entire meter |
| `StereoMeter` | `clipped` | On clip event (infrequent) | Clip indicator only |
| `MasterClipBadge` | `clipped` | On clip event (infrequent) | Badge |
| `AudioDiagnosticsPanel` | `snap` | 4 Hz | Entire diagnostics panel |

With 6 tracks open in the mixer, `StereoMeter` alone causes **360 setState calls/second** —
each triggering a React reconcile pass on all MeterBar divs.

### Render isolation already correct

- `PositionReadout` — writes directly to `span.textContent` via ref. No React re-renders.
- `Timeline` playhead — writes CSS `transform` via ref. No React re-renders.
- `ProjectClipBadge` — only updates state when clipping occurs. Correct.

## Memory / Heap Observations

### Load (estimated)

- Initial JS heap after studio load: **~80–120 MB** (Tone.js + all voices + samplers)
- AudioContext sample buffers (Berklee acoustic kit): **+20–40 MB** (lazy loaded)

### After 10 Minutes Playback (code-based risk assessment)

| Risk | Severity | Confidence |
|---|---|---|
| `Tone.Player` instances from replaced kits not disposed | Medium | Medium |
| `Tone.Sampler` instances from replaced presets not disposed | Medium | Medium |
| Repeated `saveDraft` keeping serialized blob references alive | Low | High |
| Background FX DOM nodes (60 rain drops) accumulating | Low | Low (CSS only) |
| `AudioDiagnosticsPanel` rAF running when tab hidden | Low-medium | High |

## Lag by Scenario (Code-Review Assessment)

| Scenario | Lag? | Root cause |
|---|---|---|
| Mixer closed, playback running | Low | Only master meter + transport polling |
| Mixer open, 6 tracks, playback running | **High** | 360 setState/s from StereoMeter |
| Visualizer open during playback | Medium | MasterScope rAF + oscilloscope draw |
| Demo project load | Medium | ensureTrack × 6 + drum sampler build |
| Sample import (small, <2MB) | Low-Medium | decodeAudioData on main thread |
| Save/load project | Low (fast-path) to **High** (large vocal clips) | serializeAndFlushBlobs |
| Export WAV (short project) | Medium | OfflineContext render |
| Export WAV (long project) | **High** | All audio blobs decoded to memory |

## Service Worker Scenario

- Vite PWA plugin is configured — caches app shell and static assets.
- Service worker stale cache can mask deployed fixes; clear cache and hard-reload before each acceptance test.
- No evidence of reckless large-blob caching in current config.

## Summary of Highest-Impact Items (Ordered by Impact)

1. `StereoMeter` setState at 30 Hz × N tracks → canvas/ref refactor
2. `saveDraft` firing 800 ms after every store change → debounce to 4 s
3. `serializeAndFlushBlobs` re-writing unchanged blobs every save → fingerprinting
4. `MasterClipBadge` + `AudioDiagnosticsPanel` rAF with no document.hidden guard
5. `master.ts` 80 ms setInterval with no document.hidden guard
6. Metronome scheduleRepeat ID never cleared when toggled off
7. WAV export loads all clips simultaneously → memory spike risk
8. No persistent Performance Mode to globally reduce visual load
