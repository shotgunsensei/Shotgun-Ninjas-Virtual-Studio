# Performance Runtime Profile

Date: 2026-06-12

Scope: production runtime profiling and stress verification against
`artifacts/studio`. This pass did not attempt feature work or UI redesign.

## Runtime Setup

| Item | Result |
| --- | --- |
| Browser | Playwright Chromium / Chrome 148.0.7778.96 |
| Production preview URL | `http://127.0.0.1:5173/` |
| Studio route | `http://127.0.0.1:5173/studio` |
| Build hash evidence | Current measured bundle: `assets/index-C5HOAuT3.js`; later builds during patching emitted newer hashed bundles |
| Service worker | Registered and controlling in preview; fresh-cache unregister/delete was used for focused probes |
| Performance Mode | Toggle path available; full on/off stress was not completed because playback acceptance was blocked first |
| Profiling harness | `scripts/runtime-profile.mjs` writes local JSON under `runtime-profile/`; no external analytics or project data upload |

## Commands Run

| Command | Result | Summary |
| --- | --- | --- |
| `npm run typecheck` | Pass | `tsc -p tsconfig.json --noEmit` completed without errors after runtime patches. |
| `npm run build` | Pass with warnings | Client/SSR/prerender completed. Warnings remain for sourcemap lookups, static/dynamic import overlap, and the large `index` chunk. |
| `npm run test` | Pass | 4 Playwright welcome-flow tests passed. |
| `npm run serve -- --strictPort true --port 5173` | Pass | Production preview served `/` and `/studio` on `127.0.0.1:5173`. |

## Evidence Captured

### Cold Load

Partial profile artifact:

- `runtime-profile/runtime-profile-1781297512520.json`

Cold `/studio` production load completed, but Long Task API captured four long
tasks before audio startup:

| Long task | Duration |
| --- | ---: |
| Startup task 1 | 342 ms |
| Startup task 2 | 3,280 ms |
| Startup task 3 | 262 ms |
| Startup task 4 | 2,266 ms |

After cold load:

- JS heap used: 27.66 MB
- JS heap total: 99.21 MB
- DOM nodes: 4,205 according to CDP, 2,344 elements in DOM query
- JS event listeners: 6,240
- Service worker controller: true
- Console errors: none in the partial profile

### Audio Startup

Focused production probe:

- `/studio` load: 7.1-10.4 seconds depending on cache/build state
- Enable Audio button hides after roughly 0.35-1.1 seconds
- Console warnings confirmed the AudioWorklet path still falls back:
  - `[MasterChain] Worklet rewire failed - keeping Tone.js chain: InvalidAccessError`
  - `[AudioEngine] Worklet init failed - Tone.js fallback active. TypeError: Failed to execute 'connect' on 'AudioNode': Overload resolution failed.`

The worklet path was improved from wrong-context failures to successful
registration/node creation, but native worklet nodes still cannot be rewired
into the existing Tone/standardized-audio-context graph safely.

### Demo Load After Audio Enabled

Focused production probe after `Enable Audio`, then Load -> Trap Starter:

| Measurement | Before patches | After scoped patches |
| --- | ---: | ---: |
| Trap Starter click/dialog close | >30,000 ms timeout / 38,630 ms measured | 29,940 ms measured |
| Largest long task | 38,011 ms | 26,716 ms |
| Console/page errors | none | none |

The patches reduced duplicate eager work, but did not remove the blocking root
cause. A single `audio.ensureTrack()` / `buildVoice()` path can still monopolize
the main thread for roughly 27 seconds after audio is enabled.

## Runtime Scenarios

| Scenario | Status | Evidence / reason |
| --- | --- | --- |
| Cold load `/` and `/studio` | Partial pass | Route loads with no page errors, but startup has 3.28 s and 2.27 s long tasks. |
| Audio startup play/pause/stop/panic/replay | Partial pass | Enable Audio completes; post-panic replay UI path was previously fixed, but full audible verification is not possible in headless. |
| 10-minute playback with mixer/visualizer | Blocked | Could not begin valid run because loading Trap Starter after audio enabled produced 26-38 s long tasks. |
| Mixer stress | Blocked | Not meaningful until demo load/playback no longer freezes. |
| Visualizer stress | Blocked | Not meaningful until demo load/playback no longer freezes. |
| Repeated kit/instrument switching | Blocked | Track graph build remains the blocking issue. |
| Repeated project load/unload | Failed | First post-audio demo load produces page-freezing long task. |
| Sample import | Not completed | Deferred because the primary production playback path is blocked. |
| Save/load/autosave | Not completed | Deferred because project load after audio enabled is blocked. |
| JSON export/import | Not completed | Deferred after primary runtime blocker was confirmed. |
| WAV export | Not completed in this pass | Previous smoke passed default WAV; current runtime pass blocked before playback acceptance. |
| Service worker cache simulation | Partial | Fresh-cache unregister/delete path used in probes; full old-cache update simulation not completed. |

## Confirmed Bottlenecks

1. **Main-thread audio graph construction remains the release blocker.**
   `buildVoice()` still creates a dense Tone graph synchronously for a track.
   Runtime evidence shows one graph/scheduling cycle can create a 26-32 second
   long task after audio is enabled.

2. **Initial app load still has multi-second long tasks.**
   Cold production `/studio` load captured 3.28 s and 2.27 s long tasks before
   any deliberate playback stress.

3. **AudioWorklet integration still falls back.**
   Worklet registration/context resolution was improved, but native worklet
   nodes still fail to connect into the existing graph. The studio runs on the
   Tone.js fallback chain.

4. **The full 10-minute playback acceptance test has not passed.**
   Per the stabilization rule, the studio cannot be called fixed or release-safe
   until this passes without page-unresponsive behavior.

## Fixes Applied During Runtime Profiling

- Added `scripts/runtime-profile.mjs`, a local Playwright/CDP runtime profiling
  harness that captures long tasks, heap, DOM node count, listener count,
  console warnings/errors, and scenario results.
- Hardened `WorkletManager` context handling so it unwraps native
  `BaseAudioContext` through Tone/standardized-audio-context wrapper shapes.
- Changed worklet call sites to pass the Tone context wrapper to the manager.
- Removed duplicate eager `audio.ensureTrack()` / `flushMixToEngine()` calls
  from `loadDemo()` and `remixDemo()`.
- Removed synchronous `audio.disposeAllTracks()` from demo/remix click handlers.
- Removed synchronous `audio.removeAllTracksExcept()` from `resetStore()`.
- Deferred and chunked `useTransport()` project scheduling work so it yields
  between old-track removals and new-track scheduling.

## Release Safety

Not release-safe.

The exact next blocking issue is to make `audio.ensureTrack()` / `buildVoice()`
incremental or lazy enough that loading a demo/project after audio is enabled
does not create a >50 ms long task, and certainly not a 26-32 second task.

Recommended next patch:

- Split `buildVoice()` into a cheap track shell plus lazy instrument/FX module
  realization.
- Avoid creating disabled/wet-0 FX nodes until a track actually uses them.
- Build at most one small graph segment per task and yield between segments.
- Add per-track `performance.mark()` / `measure()` around `ensureTrack()` and
  every major node group so the next profile identifies the exact node family
  causing the largest stall.

## 2026-06-14 Trace-Driven Patch Note

The first two `buildVoice()` items above were patched:

- Default track graph now builds only `filter -> delay -> reverb -> channel`.
- EQ, compressor, saturation, chorus, bitcrusher, and stereo width are created
  lazily when settings or automation require them.
- `SaturationProcessor.process()` no longer allocates a `Float32Array` in the
  real-time oversampling branch.
- Master worklet parameter sync is batched to one flush per 33 ms window.
- `AudioEngine.dispose()` now provides defensive singleton/HMR cleanup.

Verified in this pass:

- `npm run typecheck`: pass.
- `npm run build`: pass with existing warnings.
- `corepack pnpm --dir artifacts/studio run typecheck`: pass.
- `corepack pnpm --dir artifacts/studio run build`: pass with existing
  warnings.
- `corepack pnpm --dir artifacts/studio run test`: all 4 Playwright tests
  printed `ok`, but the command wrapper timed out after 180 s because the test
  command did not exit cleanly.

Not verified in this pass:

- A fresh post-patch Chrome trace.
- 10-minute playback acceptance.
- Repeated kit/project switching under an interactive browser.

Reason: production preview starts in the foreground, but background preview
processes did not remain reachable across sandbox tool calls in this session.

---

## 2026-06-15 Production Profile Recheck

Scope: production preview runtime stress verification after the worklet fallback
cleanup commit and the follow-up audio-startup guards in this pass.

### Commands Run

| Command | Result | Summary |
| --- | --- | --- |
| `npm run typecheck` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly after the transport/audio guard changes. |
| `npm run build` | Pass with warnings | Client, SSR, and prerender completed. Existing sourcemap lookup, static/dynamic import overlap, and large chunk warnings remain. |
| `npm run test` | Partial / timeout | The 4 Playwright tests printed `ok`, but the command wrapper timed out after 240 s and did not exit cleanly. |
| Production preview + `STUDIO_PROFILE_MINUTES=0.1 node scripts/runtime-profile.mjs` | Fail | Cold load passed; audio startup/play/pause/panic scenario failed and left CDP metrics unresponsive for downstream scenarios. |

### Evidence Captured

Profile artifacts from this pass:

- `runtime-profile/runtime-profile-1781533322849.json`
- `runtime-profile/runtime-profile-1781535357713.json`
- `runtime-profile/runtime-profile-1781535626004.json`
- `runtime-profile/runtime-profile-1781535822280.json`

Latest measured short production profile:

| Scenario | Status | Evidence |
| --- | --- | --- |
| Cold load | Pass | `runtime-profile-1781535822280.json`: 4,004 ms scenario duration, 23.86 MB JS heap, 3,496 browser metric nodes, 5,735 JS event listeners, 2,344 DOM elements. |
| Audio startup / play / pause / stop / panic / replay | Fail | Play click completed, but Pause never appeared. Playwright timed out waiting for `getByRole('button', { name: /^pause$/i })`, then post-scenario CDP metrics timed out. |
| 10-minute playback with mixer/scope | Fail / blocked | Could not start; before-scenario metrics timed out after the failed audio startup scenario. |
| Mixer stress | Fail / blocked | Metrics timed out because the page remained unhealthy after audio startup. |
| Visualizer Performance Mode stress | Fail / blocked | Metrics timed out because the page remained unhealthy after audio startup. |
| Repeated preset switching | Fail / blocked | Metrics timed out because the page remained unhealthy after audio startup. |
| Repeated project load/unload | Fail / blocked | Metrics timed out because the page remained unhealthy after audio startup. |
| Sample import small/large | Fail / blocked | Metrics timed out because the page remained unhealthy after audio startup. |
| Save/load/autosave | Fail / blocked | Metrics timed out because the page remained unhealthy after audio startup. |
| JSON export/import/malformed JSON | Fail / blocked | Metrics timed out because the page remained unhealthy after audio startup. |
| WAV export default/demo | Fail / blocked | Metrics timed out because the page remained unhealthy after audio startup. |
| Service worker cache update simulation | Fail / blocked | Metrics timed out because the page remained unhealthy after audio startup. |

Cold-load Long Task API evidence from the latest short profile:

| Long task | Duration |
| --- | ---: |
| Largest startup task | 1,862 ms |
| Second startup task | 452 ms |
| Third startup task | 313 ms |
| Fourth startup task | 252 ms |
| Total captured startup long-task time | 2,879 ms |

### Fixes Applied During This Recheck

- Disabled the AudioWorklet path by default unless
  `VITE_STUDIO_ENABLE_AUDIO_WORKLETS=1` is set, so the unstable worklet rewire
  path does not retry during normal runtime profiling.
- Changed `AudioEngine.unlock()` to mark the app unlocked quickly and schedule
  Tone startup/worklet probing outside the direct click handler.
- Added a 5 s guard around `Tone.start()` so a stuck AudioContext startup is
  logged instead of awaited indefinitely.
- Added a defensive transport-start guard: `AudioEngine.play()` now refuses to
  enter `Tone.Transport.start()` unless the underlying AudioContext is already
  `running`.
- Updated `useTransport()` so the UI only flips to playing/recording when the
  engine accepts the transport start.
- Hardened `scripts/runtime-profile.mjs` with CDP metrics timeouts, empty
  metrics failure records, muted headless Chromium audio output, and
  `noWaitAfter` on SPA transport clicks.

### Confirmed Remaining Bottleneck

The studio is still not release-safe. In production preview, audio startup/play
can leave the page unresponsive enough that Playwright cannot observe the Pause
state and CDP metrics calls time out. The full 10-minute playback acceptance
test has not started successfully.

Exact next blocking issue: isolate why the first transport Play click after
audio unlock prevents the app from reaching Pause state and makes CDP metrics
unresponsive. The likely remaining surface is synchronous work triggered by
`Tone.Transport.start()` or scheduled transport callbacks after the
AudioContext/Tone startup path, not AudioWorklet retry churn.

---

## 2026-06-15 First-Play Repair Recheck

Profile artifacts:

- First-play matrix: `runtime-profile/runtime-profile-1781555968920.json`
- Short full profile: `runtime-profile/runtime-profile-1781556158517.json`

### First-Play Matrix

| Scenario | Status | Evidence |
| --- | --- | --- |
| Baseline | Pass | Play click returned, Pause appeared, CDP metrics remained responsive. |
| No project schedules | Pass | Confirms schedules were part of the previous failure surface. |
| No transport callbacks | Pass | Confirms callbacks/scheduling were part of the previous failure surface. |
| No graph build during Play | Pass | No `ensureTrack()` / `buildVoice()` ran during first Play. |
| Minimal audio graph | Pass | Tone Transport itself starts in isolation. |
| No world audio | Pass | World audio was not the first-Play blocker. |
| No analyzers | Pass | Master analyser creation was not required for first Play. |

Measured baseline first Play:

- `useTransport.play`: 1.5 ms
- `AudioEngine.play`: 0.6 ms
- `Tone.Transport.start`: 0.6 ms
- `ensureTrack()` during first Play: 0
- `buildVoice()` during first Play: 0

### Short Runtime Profile

| Scenario | Status | Evidence |
| --- | --- | --- |
| First-play matrix | Pass | All seven matrix cases passed. |
| Cold load | Pass | 2,608 ms scenario duration. |
| Audio startup / panic / replay | Pass | Play/Pause/Stop/Panic/replay path completed. |
| Trap Starter 0.1-minute playback with mixer/scope | Pass with severe long-task risk | Scenario passed, but captured a 9,651 ms long task and 14,169 ms total long-task time. |
| Mixer stress | Pass with leak risk | Scenario passed, but JS listeners increased by 15,275. |
| Visualizer Performance Mode stress | Fail | Locator click timed out after 30 s. |
| Repeated preset switching | Fail | Locator click timed out after 5 s. |
| Repeated project load/unload | Fail | Locator click timed out after 30 s. |
| Sample import small/large | Pass with long-task risk | Passed, but captured a 2,233 ms long task. |
| Save/load/autosave | Fail | Locator click timed out after 30 s. |
| JSON export/import/malformed JSON | Fail | Locator click timed out after 30 s. |
| WAV export default/demo | Fail | Locator click timed out after 30 s. |
| Service worker update simulation | Fail | `spawnSync npm.cmd EINVAL` in the harness. |

### Release Safety

Not release-safe.

First Play is fixed enough for the production matrix: Pause appears and CDP
metrics remain responsive. The 10-minute acceptance run was not attempted
because the short profile still fails later stress scenarios and still captures
multi-second long tasks.

---

## 2026-06-15 Post-First-Play Listener / Runtime Profile

Latest profile artifacts:

- First-play matrix recheck: `runtime-profile/runtime-profile-1781558234222.json`
- Short full profile: `runtime-profile/runtime-profile-1781574687932.json`

### Commands Run

| Command | Result | Summary |
| --- | --- | --- |
| `npm run typecheck` | Pass | TypeScript completed cleanly after listener tracing and demo-load instrumentation. |
| `npm run build` | Pass with warnings | Production build completed. Existing sourcemap, dynamic/static import overlap, and large chunk warnings remain. |
| Production preview + `STUDIO_PROFILE_MATRIX_ONLY=1 node scripts/runtime-profile.mjs` | Pass | All seven first-play matrix scenarios passed. |
| Production preview + `STUDIO_PROFILE_MINUTES=0.1 node scripts/runtime-profile.mjs` | Fail | First-play, cold load, audio startup, Trap Starter short playback, mixer stress, and sample import passed. Visualizer, preset/project load, save/load, JSON, WAV, and SW scenarios still failed. |

### Short Profile Results

| Scenario | Status | Largest long task | Key finding |
| --- | --- | ---: | --- |
| First-play matrix | Pass | 647 ms max baseline | First Play did not regress. |
| Cold load | Pass | 300 ms | Listener trace starts after header to avoid bootstrap perturbation. |
| Audio startup / panic / replay | Pass | 980 ms | Web Audio/Tone startup still creates many `ConstantSourceNode:ended` listeners. |
| Trap Starter short playback | Pass with blocker | 6,183 ms | Improved from prior 9.65 s but still a multi-second long task. |
| Mixer stress | Pass with warning | 0 ms captured | App-owned listener trace stayed bounded; Chrome listener metric still grew by 15,293. |
| Visualizer Performance Mode stress | Fail | 0 ms captured | Harness timed out waiting for Performance Mode toggle after prior stress state. |
| Repeated preset switching | Fail | 0 ms captured | Locator timeout. |
| Repeated project load/unload | Fail | 0 ms captured | Locator timeout. |
| Sample import small/large | Pass with blocker | 1,023 ms | Main-thread sample import/waveform work still blocks. |
| Save/load/autosave | Fail | 147 ms | Locator timeout. |
| JSON export/import | Fail | 0 ms captured | Locator timeout. |
| WAV export default/demo | Fail | 0 ms captured | Locator timeout. |
| Service worker cache update | Fail | 0 ms captured | Harness used `npm.cmd` directly; patched afterward to use `cmd.exe /c npm run build` on Windows. |

### Listener Trace Findings

See `PERFORMANCE_LISTENER_PROFILE.md`.

Mixer open/close 20x did not show unbounded app-owned listener growth:

- `visualTicker` subscriber delta: `0`
- `store.subscribe` delta: `0`
- Tone.Transport event delta: `0`
- ListenerTrace active delta: `+2`

The high listener counts are concentrated in Web Audio/Tone internals:

- `ConstantSourceNode:ended`: about 2,000 after audio startup.
- `AudioWorkletNode:error`: 40 after startup, 88 after Trap Starter load.
- `AudioWorkletNode:processorerror`: 40 after startup, 88 after Trap Starter load.

### Release Safety

Not release-safe.

The 10-minute production playback acceptance test was not run because the short
profile still fails later stress scenarios and Trap Starter still has a `6.18 s`
long task.

---

## 2026-06-16 Audio Node Trace Runtime Profile

Latest profile artifacts:

- First-play matrix: `runtime-profile/runtime-profile-1781620541263.json`
- Short full profile with `audioNodeTrace`: `runtime-profile/runtime-profile-1781620678141.json`

### Commands Run

| Command | Result | Summary |
| --- | --- | --- |
| `corepack pnpm --dir artifacts/studio run typecheck` | Pass | TypeScript completed cleanly. |
| `corepack pnpm --dir artifacts/studio run build` | Pass with warnings | Production build completed with existing sourcemap/import-overlap/large chunk warnings. |
| Production preview + `STUDIO_PROFILE_MATRIX_ONLY=1 node scripts/runtime-profile.mjs` | Pass | All seven first-play matrix scenarios passed. |
| Production preview + `STUDIO_PROFILE_MINUTES=0.1 node scripts/runtime-profile.mjs` | Fail overall | First-play, cold load, audio startup, Trap Starter short playback, mixer stress, sample import, and service-worker update passed. Visualizer, repeated preset/project load, save/load, JSON, and WAV scenarios failed. |
| `corepack pnpm run test --reporter=line --workers=1` | Timeout | Four Playwright tests started but the process did not exit before 600 s. |
| `.\\node_modules\\.bin\\playwright.cmd test --reporter=line --workers=1` | Timeout | Same timeout after enumerating four tests. |

### Short Profile Results

| Scenario | Status | Largest long task | AudioWorklet delta | Key finding |
| --- | --- | ---: | ---: | --- |
| First-play matrix | Pass | 702 ms max | 0 | First Play still passes. |
| Cold load | Pass | 337 ms | 0 | Trace starts after shell, with app-owned listeners bounded. |
| Audio startup / panic / replay | Pass | 2,542 ms | 0 | Tone ConstantSourceNode/GainNode churn dominates. |
| Trap Starter short playback | Pass with blocker | 7,417 ms | 0 | Still a multi-second long task; not caused by default worklet creation. |
| Mixer stress | Pass | 0 ms | 0 | App-owned trace counters stayed bounded, but Chrome listener count rose by 16,485. |
| Visualizer Performance Mode stress | Fail | 0 ms | 0 | Performance Mode button click was blocked by an open modal overlay. |
| Repeated preset switching | Fail | 0 ms | 0 | Locator failed after prior stress state. |
| Repeated project load/unload | Fail | 0 ms | 0 | Scenario did not complete full acceptance. |
| Sample import small/large | Pass with blocker | 1,338 ms | 0 | Main-thread import/waveform work still blocks. |
| Save/load/autosave | Fail | 191 ms | 0 | Locator failure after modal state. |
| JSON export/import | Fail | 0 ms | 0 | Locator failure after modal state. |
| WAV export default/demo | Fail | 0 ms | 0 | Locator failure after modal state. |
| Service worker cache update | Pass | 0 ms | 0 | Windows rebuild harness path now works. |

### Release Safety

Not release-safe.

Default AudioWorklet node creation is now verified as zero, but the short
profile still fails multiple stress scenarios and captures multi-second
long tasks. The 10-minute playback acceptance test was not run.
