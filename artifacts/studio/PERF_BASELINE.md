# Performance Baseline

Audit date: 2026-08-30

Scope: full repository oversight of Shotgun Ninjas Virtual Studio, with production-build, browser-runtime, audio-lifecycle, storage/export, dependency, and security verification. The app remains free; no account, billing, advertising, or usage gate was added.

## Environment

| Item | Verified value |
| --- | --- |
| Platform | Windows / PowerShell |
| Node.js | 24.16.0 |
| Package manager | pnpm 11.5.2 through Corepack |
| Browser profiler | Chromium 148.0.7778.96 |
| App stack | React 19, TypeScript, Vite, Tone.js, IndexedDB |
| Install authority | Root `pnpm-lock.yaml`, frozen install |
| Lint command | None exists in this repository |

## Build Baseline and Final Result

The pre-change build placed almost the entire application in one initial JavaScript payload and published source maps by default. The final build isolates the landing page, Tone.js, dialogs, instruments, editor panels, export encoders, and other opt-in features.

| Measurement | Before | Final |
| --- | ---: | ---: |
| Monolithic main JS | 2,123.67 kB raw / 605.11 kB gzip | Replaced by route-aware chunks |
| Landing initial JS | Included in monolith | 229.64 kB raw / 73.43 kB gzip |
| Studio initial JS | Included in monolith | 1,167.86 kB raw / 334.75 kB gzip |
| Main Studio `App` chunk | 2,123.67 kB raw / 605.11 kB gzip | 665.79 kB raw / 195.90 kB gzip |
| Shared CSS | 153.13 kB raw | 153.54 kB raw / 22.82 kB gzip |
| Public source map | 8,176.30 kB | Not emitted by default |
| Largest lazy chunk | N/A | MP3 encoder, 58.39 kB gzip |

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
- Native WAV export reuses decoded zones and selects/repitches the nearest
  chromatic root rather than exporting the modeled approximation.

## Runtime Baseline and Final Result

Both sets were captured against production preview with the same repository profiler. Browser start and garbage collection introduce run-to-run variance; bundle size and pass/fail assertions are the more deterministic load indicators.

| Scenario | Before | Final exact build |
| --- | ---: | ---: |
| First play: largest long task | 421 ms | 321 ms |
| First play: total long tasks | 730 ms | 676 ms |
| First play: heap delta | +19.43 MB | +16.34 MB |
| Cold-load measured duration | 234 ms | 920 ms |
| Audio startup / Panic / replay: largest long task | Not isolated | 111 ms |
| Mixer stress | Not isolated | 56.86 sec, zero long tasks |
| Visualizer + Performance Mode stress | Not isolated | 11.49 sec, zero long tasks |
| Repeated preset switching | Not isolated | 10.00 sec / 53 ms max long task |
| Repeated project replacement | 137 ms max / 3,351 ms total | 104 ms max / 2,925 ms total |
| Save/load/autosave: largest long task | 111 ms | 99 ms |
| WAV export: largest long task | 99 ms | 92 ms |

The final cold-load wall time remained slower than the initial sample despite a
44.7% smaller gzip Studio startup payload; earlier post-fix samples measured
678, 916, and 1,269 ms. First-play heap samples ranged from +16.34 to +23.95
MB across graph variants. This variability remains a field/device telemetry
requirement rather than being hidden as a deterministic runtime win.

## Ten-Minute Release Gate

Evidence: `runtime-profile/runtime-profile-1788061725807.json`

- Continuous production playback plus stop, Panic, cleanup, and idle checks: **pass**.
- Scenario duration: 616,899 ms.
- Full requested playback duration reached: yes.
- Page errors: 0.
- Console messages: 0.
- CDP/browser responsiveness after playback: pass.
- Active scheduled audio players after cleanup: 0.
- Active Tone transport events after cleanup: 0.
- Active lean one-shot sources after cleanup: 0.
- Active AudioWorklet nodes after cleanup: 0.
- Six recorded long tasks occurred during startup/demo preparation; the longest was 327 ms and none occurred during the sustained playback window.

## Final Production Matrix

Evidence: `runtime-profile/runtime-profile-1788072902071.json`

All 19 scenarios passed:

- Seven first-play isolation/graph variants.
- Cold load.
- Audio startup, Panic, and replay.
- Playback with mixer and scope.
- 57-second mixer stress.
- Visualizer and Performance Mode stress.
- Repeated preset switching.
- Repeated project load/unload.
- Small and large sample import.
- Save, load, and autosave.
- Portable JSON export/import plus malformed JSON rejection.
- Default/demo WAV export.
- Service-worker cache/update simulation.

The profile contains zero page errors and zero console warnings/errors. A
follow-up matrix-only run after repairing the Windows profiler exit path also
passed 7/7 first-play variants and exited normally with code 0; evidence:
`runtime-profile/runtime-profile-1788073285093.json`.

## Commands and Results

| Command | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | Pass; lockfile current |
| `corepack pnpm typecheck` (root) | Pass across libraries and four relevant workspaces |
| `corepack pnpm build` (Studio) | Pass, including SSR/prerender |
| `corepack pnpm test:unit` | Pass, 11/11, including all factory hashes/WAV headers/catalog references |
| `corepack pnpm test:select-values` | Pass |
| `corepack pnpm test:bundle` | Pass |
| `corepack pnpm test` | Pass, Playwright 7/7 |
| `corepack pnpm audit --prod` | Pass, no known vulnerabilities |
| `node scripts/runtime-profile.mjs` | Pass, 19/19 production scenarios |
| Focused factory browser gate | Pass: guide, 4/4 local zones, max 3 concurrent, sampled preview/load, native WAV |

## Manual Acceptance Boundary

Headless automation verifies app load, audio unlock, keyboard transport controls, Stop/Panic state, demo load, long playback responsiveness, mixer/scope use, sample import, project persistence, JSON/WAV export, repeated replacement, Performance Mode, and service-worker behavior.

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
