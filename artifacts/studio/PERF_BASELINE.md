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
| Landing initial JS | Included in monolith | 228.29 kB raw / 72.79 kB gzip |
| Studio initial JS | Included in monolith | 1,156.63 kB raw / 331.00 kB gzip |
| Main Studio `App` chunk | 2,123.67 kB raw / 605.11 kB gzip | 655.58 kB raw / 192.61 kB gzip |
| Shared CSS | 153.13 kB raw | 153.13 kB raw / 22.79 kB gzip |
| Public source map | 8,176.30 kB | Not emitted by default |
| Largest lazy chunk | N/A | MP3 encoder, 58.39 kB gzip |

Source maps remain available for an intentional diagnostic build with `STUDIO_BUILD_SOURCEMAP=1`.

Automated bundle budgets now fail the check if the landing route, Studio route, CSS, lazy chunks, source-map policy, or service-worker precache regresses.

## Runtime Baseline and Final Result

Both sets were captured against production preview with the same repository profiler. Browser start and garbage collection introduce run-to-run variance; bundle size and pass/fail assertions are the more deterministic load indicators.

| Scenario | Before | Final exact build |
| --- | ---: | ---: |
| First play: largest long task | 421 ms | 326 ms |
| First play: total long tasks | 730 ms | 691 ms |
| First play: heap delta | +19.43 MB | +22.64 MB |
| Cold-load measured duration | 234 ms | 1,269 ms |
| Audio startup / Panic / replay: largest long task | Not isolated | 117 ms |
| Mixer stress | Not isolated | 56.98 sec, zero long tasks |
| Visualizer + Performance Mode stress | Not isolated | 11.17 sec, zero long tasks |
| Repeated preset switching | Not isolated | 10.42 sec, zero long tasks |
| Repeated project replacement | 137 ms max / 3,351 ms total | 114 ms max / 3,051 ms total |
| Save/load/autosave: largest long task | 111 ms | 97 ms |
| WAV export: largest long task | 99 ms | 99 ms |

The final cold-load sample and heap delta were slower despite a 45.3% smaller gzip startup payload. Earlier post-fix samples measured 678 and 916 ms, while first-play heap samples ranged from +16.44 to +22.64 MB. This is recorded as variability requiring field/device telemetry rather than hidden as a win.

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

Evidence: `runtime-profile/runtime-profile-1788062994759.json`

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

## Commands and Results

| Command | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | Pass; lockfile current |
| `corepack pnpm typecheck` (root) | Pass across libraries and four relevant workspaces |
| `corepack pnpm build` (Studio) | Pass, including SSR/prerender |
| `corepack pnpm test:unit` | Pass, 9/9 |
| `corepack pnpm test:select-values` | Pass |
| `corepack pnpm test:bundle` | Pass |
| `corepack pnpm test` | Pass, Playwright 5/5 |
| `corepack pnpm audit --prod` | Pass, no known vulnerabilities |
| `node scripts/runtime-profile.mjs` | Pass, 19/19 production scenarios |

## Manual Acceptance Boundary

Headless automation verifies app load, audio unlock, keyboard transport controls, Stop/Panic state, demo load, long playback responsiveness, mixer/scope use, sample import, project persistence, JSON/WAV export, repeated replacement, Performance Mode, and service-worker behavior.

Human/device checks still required before calling a public deployment fully accepted:

- Listen for sound quality, clicks, distortion, balance, and preset character on headphones and speakers.
- Test real MIDI hardware and microphone permissions/monitoring.
- Test Safari/iOS and a lower-memory Android phone.
- Confirm very large real-world sample edits and long/dense exports on target hardware.

## Production Preview

```powershell
corepack pnpm --filter @workspace/studio build
corepack pnpm --filter @workspace/studio serve
```

Use production preview for performance acceptance. Development HMR and React development checks are not representative audio-performance measurements.
