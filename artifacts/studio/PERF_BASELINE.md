# Performance Baseline

## 2026-10-27 - Reporter readiness follow-on

Hosted PR5 head `0fa253012bc404d5abedf1a64747776aedbf4de3` passed locked installation, builds and earlier unit gates, then failed the reporter suite (7 passed, 1 failed) at `fixture must begin before SIGINT`. The test used a separate 10-second readiness poll while its Playwright fixture allowed a 15-second global runner budget. Child output was discarded and early exit was not observed during the poll, so the original failure does not establish whether startup was slow or failed.

This follow-on is isolated from reviewed local commit `c04476f39edb64aff3b371d85a9498183b323704`. It changes only reporter regression supervision and these required notes. It does not establish audio, browser-workflow or production acceptance. Exact local receipts and hosted outcome belong in workspace `evidence/quality-oct27/public-companions-release/`.

## 2026-10-27 — Public entry quality pass

Source base: `0c773b1d3fac72023d759508272b9d97fe6b6541` in isolated local worktree `quality-studio-oct27`. Fresh before desktop (1440×1000) and mobile (390×844) screenshots showed a simulated workstation preview, emoji feature icons, a long first-screen gap, and Google-hosted font requests. The real Basic workspace was captured with the default local Cyber Dojo demo and audio disabled; that 1440×1000 image is the new preview.

This pass does not establish an audio-performance baseline. No playback, recording, physical MIDI, microphone, 10-minute playback run, or audible-export acceptance was performed. Existing core audio and storage implementations were preserved. Full report and exact logs: workspace `evidence/quality-oct27/public-companions/`; screenshots: `output/playwright/quality-oct27/public-companions/`.

## 2026-10-19 - Post-merge database safety

At base `e7efef3485bec35f941fda2d7b0fe20899d0b892`, the configured post-merge script ran a frozen install followed by an ambient database schema push. The native fake-pnpm fixture executed that actual baseline: it logged both commands and rejected the push with exit 97. The install-failure control stopped at exit 23. This establishes source hook behavior, not historical hosting invocation or database impact. No audio, browser-project, schema, dependency or lockfile change is included; no audio performance measurement was taken.

## 2026-10-19 - Imported project structure

Base: `e7efef3485bec35f941fda2d7b0fe20899d0b892`. A valid project envelope
containing a note clip with `notes: null` passed summary and parsing. The import
flow could then save/select it before Timeline called `clip.notes.map`, leaving
a repeatedly failing project selected on reload. Numeric JSON overflow and
malformed track/clip containers had no shared validation boundary.

The same final 48 native regression/compatibility tests produce 35 failures and
13 passes against baseline storage code, then 48 passes with this patch. The
compatibility passes include actual default/all eight demo data factories,
cross-track clip ID reuse, blank sample names and unchanged JSON/migration cases.

The current evidence uses Node 24.16.0 with actual storage/migration/validation
source in a VM. It is correctness evidence, not a browser, latency or memory
profile. Existing dependency installations do not match the tracked lockfile;
no dependency acquisition is authorized. Build, full unit/browser suites,
preview and every manual audio/performance checklist item remain unexecuted.
Historical measurements below remain historical.

## 2026-10-19 - Project deletion persistence

Base: `e7efef3485bec35f941fda2d7b0fe20899d0b892`. Source-level regression:
saving audio, deleting the active project, and saving it again left project
metadata but no recording, library sample, or Chop Lab blob. Deletion left
unchanged-blob cache entries behind. A retained recovery draft also lost its
referenced media. These failures were reproduced against actual storage and
migration modules in Node 24 with an in-memory database adapter.

This is correctness evidence, not a latency, memory, or browser measurement.
The existing dependency installation differs from the current lockfile, and
new dependency acquisition is prohibited for this pass. Build, full unit and
browser suites, preview, audio, ten-minute playback, mixer/visualizer, import,
save/load responsiveness, JSON/WAV export, autosave and lifecycle manual
checklist items have not been rerun. Historical measurements below remain
historical.

## 2026-10-02 - Trustworthy release verification

Base: `f11d6bec042e8c72e19277261a8f5739dfd20704`, fresh clean main checkout.
The deterministic browserless fixture has two tests and two retries. Against
the original reporter, the first test failed once and passed its retry, then
the runner exited 1 at 2/2 attempts. The later test and delayed global teardown
did not finish; the JSON report was absent. This is a verification defect,
not a measured product/audio performance regression.

The corrected reporter regression suite passed locally on Windows (7 passed;
the real POSIX SIGINT case is exercised on Linux). Workspace typecheck and
73 unit tests passed on Windows. Full isolated Linux release-gate evidence is
recorded in `PERFORMANCE_FIXES.md`. No product runtime code changed; prior
hardware/manual performance observations below remain historical evidence.

## 2026-09-12 — Basic/Advanced and tutor acceptance

Scope: progressive disclosure and optional integrated teaching on the existing
engine. No before/after audio-latency measurement was taken. Basic mounts fewer
panels and animations; this is a structural observation, not a measured speedup.

### Commands and outcomes

The repo enforces pnpm, so its equivalents were used instead of npm install.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --config.confirmModulesPurge=false` | Pass; locked versions unchanged; required network/cache permission |
| `pnpm run typecheck` | Pass across the workspace |
| `PORT=5173 BASE_PATH=/ pnpm run build` | Pass: workspace typechecks and mockup/video/API/studio builds, including studio SSR/prerender |
| `pnpm --filter @workspace/studio build` | Pass, client + SSR + prerender |
| `pnpm --filter @workspace/studio run --if-present lint` | No lint script is defined; TypeScript and select-value guards run |
| `pnpm --filter @workspace/studio test:unit` | 73/73 pass, including 11 new preservation/preference cases |
| Full browser suite | Pass: 82 passed, 3 expected opt-in skips (85 resolved), fresh server and no concurrent source edits; final keyboard/phone and backup refinements checked separately |
| Basic plus suspended-context regression run | 9/9 pass |
| Final keyboard/phone regressions | 3/3 pass: native Space, Basic Delete/Backspace protection with Advanced deletion retained, and phone tutor practice preserving song/lesson |
| Production workflow | Pass: real Save/Load, JSON backup download → restore → reload → re-export equality, audible WAV, retained settings, 390px phone |
| Ten-minute production playback | Pass: 600 seconds, 20 responsiveness checks with advancing transport, version changes and mixer open/close; no page errors |
| `test:bundle`, `test:select-values`, `git diff --check` | Pass |
| `pnpm --filter @workspace/studio serve --port 5175` | Pass; production preview verified in the in-app browser |

The browser tests use installed Google Chrome via
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe`.
The final full dev run let Playwright start a fresh Vite server at 5174. To use
an already running server, set `STUDIO_TEST_REUSE_SERVER=1`. Production tests
set `STUDIO_PRODUCTION_TEST=1`, `STUDIO_TEST_PORT=5175`,
`STUDIO_TEST_REUSE_SERVER=1`, and `STUDIO_LEARNING_SOAK=1`, then run
`test -- basic-production.spec.ts --output=test-results-production` against the
built preview. Both production cases passed; they are skipped in the ordinary
dev suite along with the existing opt-in worklet case. Production tests load
no `/src/` modules. Screenshots and actual
downloaded WAV/JSON outputs are in ignored `test-results-production/`.

Final bundle guard: landing initial JS 75.21 kB gzip; studio initial JS
353.48 kB gzip; CSS 23.53 kB gzip. Existing large-chunk warning remains. Tutor
and Basic workspace are lazy chunks, with no new dependencies or audio owner.

### Required manual checklist (current evidence and boundaries)

Automated browser coverage and direct in-app checks are identified explicitly.

| Requirement | Current result |
| --- | --- |
| App loads without console errors | Pass: production workflow and direct in-app production inspection |
| Enable Audio works | Pass: Basic/Advanced real-audio tests and in-app production |
| Spacebar play/pause works | Pass: direct production keyboard check; focused grid buttons retain native Space behavior |
| Stop releases audio | Pass: real-audio regression and production transport |
| Panic stops all audio | Pass: real-audio output falls below -80 dB and late scheduled callbacks remain revoked |
| Demo loads without freezing | Pass: welcome/Remix and production blank/demo loads |
| Playback runs 10 minutes | Pass: ten-minute production check, 20 responsive UI checkpoints, no page errors or unresponsive page |
| Mixer opens during playback | Pass: opens/closes at every production checkpoint and in Advanced regressions |
| Visualizer opens during playback | Advanced MasterScope mounts during production mode switches; independent visualizer stress not separately profiled |
| Normal sample import does not freeze | Pass: existing real custom-sample import/rejection/assignment tests rerun |
| Project save does not freeze | Pass: actual production Save and portable persistence tests |
| Project load does not freeze | Pass: production reload/Load and replacement-safety tests |
| JSON export works | Pass: actual production download parsed and editable track notes verified |
| WAV export works or limits documented | Pass: 6,174,044-byte PCM WAV, peak 22,175; existing synthesis/FX approximation warning remains visible |
| Autosave skips unchanged projects | Existing policy/unit guards pass; timed unchanged-project write-count profiling not repeated in this pass |
| Hidden panels stop animation loops | Basic unmounts Advanced mixer/scope and tutor removes its listener; background-tab ticker profiling not repeated |
| Kit/instrument switching does not steadily leak | Bounded voice/cancellation regressions pass; no new long-duration heap-slope profile |
| Project load/unload does not stack events | Ownership/replacement regressions pass; extended schedule-count soak not repeated |
| Performance Mode reduces visual load | Existing visual throttles unchanged; toggling persisted performance state covered, FPS reduction not remeasured |
| Production behaves better or equal to dev | Same Basic workflow passes in both; no comparative latency benchmark claimed |

Still requires human/device acceptance: children/teen usability sessions,
headphone/speaker listening, real MIDI/microphone hardware, Safari/iOS, and a
low-memory Android phone. Basic intentionally exposes only some note/timing and
sound controls; Advanced preserves the remainder. Whole-song export follows
the project's full timeline length; use the visible loop/custom range controls
to omit unused bars. Tutor completion is self-paced, not assessment or proof of
a successful save/export.

Test setup corrections: development file watching now ignores generated
downloads/reports to avoid Windows `EBUSY` errors on locked WAV files. Empty
`REPL_ID` no longer enables Replit-only development plugins. Advanced tests
explicitly select Advanced; startup setup no longer deletes a live IndexedDB
database and then navigates again. Earlier HMR/store-identity and startup
failures passed on isolated checks and on the final fresh-server full run.
The soak checks responsiveness and transport progression; it does not measure
continuous acoustic output, heap growth, or latency. Downloads exercise the
browser fallback; the native operating-system save picker was not tested.
The final three-test keyboard/phone run collapses the Advanced mixer through
its normal control so timeline clips remain reachable at a 720px-high viewport.
The final production workflow was rerun after these source refinements and
passes, including the backup restore comparison. The in-app preview also
accepted its service-worker update and reloaded with Basic/tutor visible,
no pending update, and no console errors.

## 2026-09-12 — Sample instrument expansion (4.5.0)

The user explicitly requested additional instruments and creating an instrument
from an uploaded sound. This is a scoped feature expansion of the existing
audio/import pipeline; the free product policy and stability constraints remain.

| Measurement | Recorded 4.4 baseline | 4.5 build |
| --- | ---: | ---: |
| Melodic presets | 34 | 39 |
| Sampled factory instruments / WAV zones | 7 / 32 | 12 / 62 |
| Factory WAV assets on disk | 41.86 MiB | 101.38 MiB |
| Landing initial JS, gzip | 74.84 kB | 75.11 kB |
| Studio initial JS, gzip | 346.50 kB | 351.52 kB |
| Shared CSS, gzip | 23.36 kB | 23.36 kB |

The 59.52 MiB of additional recordings is loaded on demand, outside startup
JavaScript and service-worker shell precache. Factory loading retains its three
decode slots and 64 MiB decoded LRU. New custom instruments share one decoded
recording across notes; each instrument caps active sources at 32. The custom
decode queue permits three jobs, coalesces concurrent copies of the same Blob,
skips discarded queued voices, and retains no permanent decoded sample library.
Factory and custom queues are separately bounded; these are not whole-app memory
limits. Active instruments retain their own PCM.

All 62 unit tests pass. The complete browser suite resolves 75 tests: 74 pass,
one existing opt-in AudioWorklet test is skipped. The soak result and required
checklist are recorded in PERFORMANCE_FIXES.md. Actual native WAV/MP3 analysis
measured the same source at A3/A4/A5 = 220/440/880 Hz (test tolerance ±12 Hz).
The build comparison uses the recorded 4.4 numbers, not a controlled CPU or
memory benchmark against a checked-out prior commit.

The 600.256-second dev soak with five new factory voices and one custom voice
passed: 11,989 heartbeat ticks, 322.2 ms maximum gap, audible output at all 20
checkpoints, no errors/crashes, and zero custom sources after Stop/Panic. Heap
cycled from 39.34–64.77 MiB and ended at 48.04 MiB. The final UI/mixer checks
pass 6/6 in addition to the full suite.

## 2026-09-12 — Resonance sound-quality update

This section supersedes current-status claims in the historical August audit
below. Measured on Windows, Node 24.16.0, pnpm 11.25.0, headless Chromium.

| Measurement | August recorded baseline | September sound update |
| --- | ---: | ---: |
| Landing initial JS, gzip | 74.42 kB | 74.84 kB |
| Studio initial JS, gzip | 344.71 kB | 346.50 kB |
| Shared CSS, gzip | 23.36 kB | 23.36 kB |
| Lazy factory PCM | 26 zones / 24.07 MiB | 32 zones / 41.86 MiB |
| Sampled instrument families | 6 | 7 |

The additional 17.79 MiB contains six original stereo Kawai grand recordings.
No sample joins shell precache or startup JavaScript; decoding still uses at
most three concurrent jobs and a 64 MiB shared decoded-buffer LRU. Active
voices can retain buffers outside that LRU; 64 MiB is not a whole-app ceiling.
No dependency was added. The numeric comparison above is to the recorded
August build, not a controlled CPU benchmark against the immediately prior commit.

Current automated results:

- Frozen install, root typecheck, production client/SSR/prerender, bundle
  budgets, and empty-Select guard pass. No lint script exists.
- 53/53 unit tests pass, including 32 original-PCM hashes, pinned CC0 license,
  manifest/layer-root agreement, and recorded-pitch checks across seven families.
- Full browser run: 60 resolved, 59 pass, one intentional opt-in-worklet skip.
  After correcting sample octaves, factory preview/load/export passed 3/3;
  the expanded sound-quality group passed 4/4, including the additional
  complete WAV-render timbre/concert-pitch regression.
- Opt-in worklet metronome and suspended-context resume passed 2/2. An earlier
  opt-in run exposed a test-precondition race (suspending before unlock had
  finished); the test now waits for the actual unlocked UI state. Default
  resume and independently varied pluck velocity/dampening also passed 2/2.
- All 34 modeled recipes produce finite audible PCM and end silently. Live
  harmonic plucks change energy/brightness with playing strength and dampening.
  Both reverbs produce distinct stereo tails; delay timing is 375/110 ms at
  120 BPM. Exported Grand Piano C4 carries its expected 261.63 Hz pitch band.
- Production ten-minute playback/Panic gate: pass in 618,339 ms, with Mixer
  and Diagnostics open, three live pack changes, sampled promotion, replay,
  Stop/Panic, idle and GC. 5,997 continuity ticks; maximum heartbeat gap
  114.7 ms; zero measured sustained silence; zero browser/page errors.
  Cleanup reported zero active lean sources, scheduled players, worklets,
  or Transport events. Heap at 1/5/10 minutes: 19.25/36.57/20.27 MiB,
  returning to 16.15 MiB after idle/GC. Four long tasks totaled 473 ms;
  the largest was 203 ms during startup. Evidence: local ignored
  `runtime-profile/runtime-profile-1789191537865.json` (Chromium 148.0.7778.96).
  The final rebuild after this run changed release-note text only, not audio code.
- Production dependency audit found two moderate `qs` advisories in the
  separate API server, GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g. The earlier
  clean audit below is historical; this update does not change dependencies.

Listening quality, measured hardware latency, Safari/iOS/Android behavior,
and live-site deployment acceptance have not been verified by this update.

## Historical August audit

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

## 2026-10-14 custom-sample envelope baseline

The bounded audio slice starts from `aea28a76f6849acc10a0508239ea8531d7287ff0` (main). The original checkout was clean and remained untouched; implementation uses `codex/studio-audio-stability-20261014` in an isolated worktree. No project schema, stored content, sample asset, dependency, or lockfile changed.

Offline Chromium regression fixtures confirmed a normalized one-sample discontinuity of **0.1166365** when a nonzero recording ended, and **0.1166365** residual output after an early key-up was ignored. After the fix, the largest boundary step is **0.0005290** at 44.1 kHz and **0.0004861** at 48 kHz across A2/A3/A4; the early-release interval is silent while the later same-pitch note remains audible. These are PCM measurements, not listening or hardware latency results.

See [the dated evidence report](PERFORMANCE_SAMPLE_ENVELOPES_2026-10-14.md) for method, CPU/heap boundaries, release checks, and unresolved production gates.

## 2026-10-14 static-route follow-up baseline

The public landing at `https://shotgunninjas.studio/` responds with HTTP 200 and client-side Launch Studio works, but a fresh direct `/studio?disableAudio=1` request returns HTTP 404. The build emits only the landing `index.html`; root `.replit` declared a static deployment with no client-route rewrites, while the studio's `.replit-artifact/artifact.toml` already declared a wildcard fallback. A strict local regression using the root deployment configuration reproduced `/studio` returning 404 before its correction. Vite Preview's automatic SPA fallback hid this configuration gap in release checks. The live failure despite the artifact's declared fallback means actual applied provider routing remains unverified; it cannot be diagnosed completely from repository files alone.

No audio implementation, stored projects, browser data, schema, or sound assets change in this follow-up. The earlier audio baseline and ten-minute muted playback evidence remain applicable to the preserved audio commits; this routing work makes no additional audio-performance claim.

## 2026-10-14 API dependency follow-up baseline

The original production audit found three advisories in API transitive dependencies: `proxy-addr` 2.0.7 and `qs` 6.15.2. Bounded pre-patch regressions reproduced all three reported behaviors: spoofed forwarded IP selection under affected IPv6 trust ranges, bracket comma input bypassing a configured throwing array limit, and parsed attacker-controlled `constructor.isBuffer` data throwing during stringify. The actual API loopback health and ordinary parser controls passed before the dependency update. These tests establish vulnerable dependency behavior, not a complete exploit path in this application's current configuration.

## 2026-10-27 hosted browser baseline

Release run `40549515157` tested source `545edc3fae3d90c9e6c1d47451f946af49fa5247` on Ubuntu 24.04 image `20261012.334.1`. The reporter tests passed 14/14, but the development browser suite could not launch `/usr/bin/chromium` with the sandbox enabled. Its 94 unexpected results are browser-start failures, not demonstrated application defects; the five skipped cases and later built-release gate remain unverified. The exact runner image documents a preinstalled stable Google Chrome package. No host setting or browser installation was changed during this follow-up.
