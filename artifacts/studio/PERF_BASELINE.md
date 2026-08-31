# Performance Baseline

Audit date: 2026-08-30

Scope: full repository oversight of Shotgun Ninjas Virtual Studio, with production-build, browser-runtime, audio-lifecycle, storage/export, dependency, and security verification. The app remains free; no account, billing, advertising, or usage gate was added.

## Environment

| Item              | Verified value                                 |
| ----------------- | ---------------------------------------------- |
| Platform          | Windows / PowerShell                           |
| Node.js           | 24.16.0                                        |
| Package manager   | pnpm 11.5.2 through Corepack                   |
| Browser profiler  | Chromium 148.0.7778.96                         |
| App stack         | React 19, TypeScript, Vite, Tone.js, IndexedDB |
| Install authority | Root `pnpm-lock.yaml`, frozen install          |
| Lint command      | None exists in this repository                 |

## Build Baseline and Current Verified Result

The pre-change build placed almost the entire application in one initial JavaScript payload and published source maps by default. The final build isolates the landing page, Tone.js, dialogs, instruments, editor panels, export encoders, and other opt-in features.

| Measurement        |                           Before |                            Final |
| ------------------ | -------------------------------: | -------------------------------: |
| Monolithic main JS | 2,123.67 kB raw / 605.11 kB gzip |   Replaced by route-aware chunks |
| Landing initial JS |             Included in monolith |    231.74 kB raw / 74.42 kB gzip |
| Studio initial JS  |             Included in monolith | 1,201.03 kB raw / 344.71 kB gzip |
| Shared CSS         |                    153.13 kB raw |    157.23 kB raw / 23.36 kB gzip |
| Public source map  |                      8,176.30 kB |           Not emitted by default |
| Largest lazy chunk |                              N/A |       MP3 encoder, 58.39 kB gzip |

Source maps remain available for an intentional diagnostic build with `STUDIO_BUILD_SOURCEMAP=1`.

Automated bundle budgets now fail the check if the landing route, Studio route, CSS, lazy chunks, source-map policy, or service-worker precache regresses.

## Factory Instrument Payload

The creative-content phase adds 26 unmodified PCM WAV zones from six VCSL
instruments. Audio totals 25,236,041 bytes (24.07 MiB), but none of it is part
of the landing/Studio JavaScript totals, startup graph, or shell precache.
Zones are fetched from the app's own origin only when a user previews, loads,
or exports that instrument, then stored in the versioned runtime cache for
offline reuse.

Runtime decode behavior is bounded independently of transfer size:

- Maximum simultaneous fetch/decode jobs: 3.
- Shared decoded-buffer LRU ceiling: 64 MiB.
- In-flight requests are de-duplicated by URL.
- Failed zones fall back to the preset's playable model.
- The shared native WAV/MP3 render reuses decoded zones and selects/repitches
  the nearest chromatic root rather than exporting the modeled approximation.

## The Dojo and Jam Recovery Baseline

The 4.3 follow-up evolves the deterministic, data-only composition coach into
The Dojo and adds bounded retrospective note capture. The combined Dojo and
jam-recovery panel remains outside the initial Studio route at 6.88 kB gzip;
the pure recipe converter remains a separate 3.79 kB gzip chunk. No new audio
package, worker, sample, scheduler, or project-schema field was added.

The Sound Library's new **Start editable sketch** path converts the same
two-bar preview data into ordinary note clips. It performs one project patch,
does not start playback, preserves tempo and existing clips, and exposes a
session-safe undo that survives lazy tab unmounts. Undo removes only generated
track/clip pairs and conditionally restores the previous kit, preset, sound,
pack, and arrangement length without overwriting later user edits. Realized
audio voices reconcile to new selectors before live input or playback. The
pure converter has explicit tests that prohibit timer, audio, and global-ID
side effects.

Responsive production checks at 600, 768, 1,024, 1,366, and 1,440 CSS pixels
measured `header.scrollWidth === header.clientWidth`; Project, Load, Export,
and Learn remained pointer-accessible. Eligible PWA install actions remain
reachable from More and the phone menu. The Dojo stayed within
320- and 390-pixel mobile viewports without horizontal or vertical escape.

## Audio-Continuity Baseline

The current pass focuses on the failure mode where applying a new kit, melodic
preset, sound pack, project, or recovered sample could leave the UI updated but
the audible graph silent or stale. The repaired contract is now consistent:

- Melodic preset and sampled-voice changes build and validate replacements
  before swapping them into the live graph; stale async completions are
  disposed by generation.
- Named drum kits select recipe and timbre data on one persistent native lean
  voice. A kit switch reuses the existing piece buses, EQ, compressor, sends,
  and meter instead of constructing or swapping a Tone drum graph.
- Store selectors are the authority for preset/kit changes, mix controls write
  through to realized voices, and project replacement has an explicit audio
  hydration revision.
- Panic, project replacement, panel ownership changes, pending microphone
  permission, and delayed sample persistence cancel only the resources they own.
- Tone/native Web Audio connections are normalized, while custom AudioWorklet
  modules are registered against the actual native `AudioContext`. The proven
  Tone/native master path remains the default; sampled/metronome worklets retain
  a tested fallback.
- Tone is bootstrapped onto one browser-owned interactive `AudioContext` before
  any Studio graph exists. This removes standardized-audio-context's recursive
  cycle traversal from transient and polyphonic `connect()` calls; HMR reuses
  the open context, and the existing Enable Audio gesture remains its only
  resume boundary.
- Custom drum-pad samples, Chop state, recorded clips, and missing-sample
  recovery retain exact project/track/clip ownership. Ready pad samples route
  into the owning native piece input so its EQ, effects, sends, and meter remain
  authoritative; the bounded master route is used only when that owning route
  is unavailable or cannot connect, and a missing/failed pad sample falls back
  to the native kit.
  Project schema v6 adds `padSamples` without dropping existing schema-v5 data.
- WAV and MP3 share the bounded native `OfflineAudioContext` renderer. MP3 only
  encodes the rendered PCM buffer and never swaps the live or process-wide Tone
  context.

These behaviors are covered by focused ownership, routing, persistence,
recorder, recovery, preview-assignment, export-context, and browser regressions.

## Historical Runtime Baseline and Current Status

The values below were captured against a previous production-preview source
revision with the repository profiler. They remain useful historical baselines,
but they are not evidence for the current audio-continuity source. Browser start
and garbage collection introduce run-to-run variance; bundle size and pass/fail
assertions are the more deterministic load indicators.

| Scenario                                          |                      Before |          Previous profiled build |
| ------------------------------------------------- | --------------------------: | -------------------------------: |
| First play: largest long task                     |                      421 ms |                           341 ms |
| First play: total long tasks                      |                      730 ms |                           691 ms |
| First play: heap delta                            |                   +19.43 MB |                        +15.01 MB |
| Cold-load measured duration                       |                      234 ms |                           935 ms |
| Audio startup / Panic / replay: largest long task |                Not isolated |                           115 ms |
| Mixer stress                                      |                Not isolated | 27.95 sec / 100 ms max long task |
| Visualizer + Performance Mode stress              |                Not isolated |       10.97 sec, zero long tasks |
| Repeated preset switching                         |                Not isolated |        9.46 sec, zero long tasks |
| Repeated project replacement                      | 137 ms max / 3,351 ms total |       97 ms max / 2,713 ms total |
| Save/load/autosave: largest long task             |                      111 ms |                            96 ms |
| WAV export: largest long task                     |                       99 ms |                            77 ms |

The previous cold-load wall time remained slower than the initial sample despite a
44.7% smaller gzip Studio startup payload; earlier post-fix samples measured
678, 916, 935, and 1,269 ms. First-play heap samples ranged from +15.01 to +23.95
MB across graph variants. This variability remains a field/device telemetry
requirement rather than being hidden as a deterministic runtime win.

## Long-Runtime Release Gate

Current exact-source status: **pass**.

`runtime-profile/runtime-profile-1788144189876.json` completed the production
release gate in 618,582 ms. It configured a real 16-beat loop through Timeline
controls, kept Mixer and Audio Diagnostics open, changed through three sound
packs during playback, and then exercised Stop, Panic, settled sample promotion,
replay, second cleanup, ten seconds idle, and forced garbage collection.

- Three live pack changes completed in 355.8, 309.6, and 326.4 ms.
- The 100 ms continuity probe advanced 5,997 times; its largest gap was 123.1
  ms, peak was -1.01 dBFS, and longest measured silence was 0 ms.
- Heap samples at 1/5/10 minutes were 21.58/17.27/41.43 MiB and returned to
  16.05 MiB after cleanup, idle, and forced garbage collection.
- Four long tasks totaled 629 ms; the largest was 342 ms during startup/setup.
- Final cleanup reported zero active lean one-shots, scheduled players,
  AudioWorklet nodes, or Transport events.
- The final context diagnostic was browser-native `AudioContext` with no
  standardized proxy owner. No console error or page error was recorded.

## Current Automated Matrix

- Root typecheck: pass across four packages.
- Focused unit suite: 52/52 pass.
- Browser suite: 56 tests discovered; 55 pass and the default AudioWorklet test
  intentionally skips when the opt-in is absent. The exit reporter records
  56/56 resolved outcomes.
- Opt-in real AudioWorklet audibility test: 1/1 pass.
- Production build, SSR, and prerender: pass.
- Bundle budget, select-value guard, and production dependency audit: pass.

The browser suite covers sound-set switching, live voice ownership, preview and
pad assignment, project replacement, recorder cancellation, persistence races,
missing-sample recovery, Panic/replay, and offline-export context isolation.
The sustained production gate independently covers delayed responsiveness,
continuous output, live sound-set convergence, replay, and final cleanup.

## Commands and Results

| Command                                   | Result                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `corepack pnpm install --frozen-lockfile` | Pass; lockfile current                                                                                                                                                               |
| `corepack pnpm typecheck` (root)          | Pass across four packages                                                                                                                                                            |
| `corepack pnpm build` (Studio)            | Pass, including SSR/prerender                                                                                                                                                        |
| `corepack pnpm test:unit`                 | Pass, 52/52, including audio ownership/routing, recorder lifecycle, bounded jam recovery, storage FIFO, custom pad samples, missing-sample recovery, export context, factory integrity, and creative tools |
| `corepack pnpm test:select-values`        | Pass                                                                                                                                                                                 |
| `corepack pnpm test:bundle`               | Pass                                                                                                                                                                                 |
| `corepack pnpm test`                      | Pass: 56 discovered, 55 passed, 1 intentional default-worklet skip; exit reporter 56/56                                                                                              |
| Opt-in AudioWorklet browser gate          | Pass, 1/1 real-worklet audibility test                                                                                                                                               |
| `corepack pnpm audit --prod`              | Pass, no known vulnerabilities                                                                                                                                                       |
| `node scripts/runtime-profile.mjs`        | Pass: exact-source 618,582 ms production gate; 5,997 continuity ticks, 123.1 ms max gap, 0 ms sustained silence, and zero active sources/events after cleanup                          |
| Focused factory browser gate              | Pass: guide, 4/4 local zones, max 3 concurrent, sampled preview/load, native WAV                                                                                                     |

## Manual Acceptance Boundary

Headless automation verifies app load, audio unlock, keyboard transport controls,
Stop/Panic/replay state, sound-set and project switching, sample assignment and
recovery, project persistence, recorder cancellation, export context ownership,
and the AudioWorklet opt-in path. The exact-source sustained playback gate also
proves ten-minute responsiveness, continuous master output, final-set replay,
and Stop/Panic/idle cleanup in headless Chromium.

Human/device checks still required before calling a public deployment fully accepted:

- Listen for sound quality, clicks, distortion, balance, and preset character on headphones and speakers.
- Test real MIDI hardware and microphone permissions/monitoring.
- Test Safari/iOS and a lower-memory Android phone.
- Confirm very large real-world sample edits and long/dense exports on target hardware.
- Audibly compare each factory instrument and its bounced WAV on monitors and
  headphones; headless automation proves routing/data, not aesthetic quality.

## Production Preview

```powershell
corepack pnpm --filter @workspace/studio build
corepack pnpm --filter @workspace/studio serve
```

Use production preview for performance acceptance. Development HMR and React development checks are not representative audio-performance measurements.

## Dojo and Jam-Recovery Performance Contract

The v4.3 Dojo expansion does not create an audio node, scheduler, worker,
network request, or high-frequency React store update. The panel remains lazy
and subscribes to the recovery service only while it is mounted.

- Live capture is attached only after a direct audio trigger succeeds. Drum
  callbacks carrying an explicit scheduler time are excluded, so transport
  playback cannot record itself.
- Formal note recording suspends the retrospective buffer and clears pending
  held-note ownership before the recorded take begins.
- Recovery retains at most 2,048 completed events across the four most recently
  used project ids. Persistence is debounced and flushed on page hide instead
  of synchronously writing storage in the live-trigger hot path.
- Dojo analysis is deterministic, synchronous project-data inspection. Seed or
  recovery clips enter the existing store and transport lifecycle as ordinary
  note clips; no parallel playback owner was added.
- Direct drum/custom-pad gestures use `Tone.immediate()` instead of Transport
  look-ahead. Five consecutive assigned-open-hat runs passed after this repair;
  scheduled callbacks continue to use their explicit audio-clock time.
