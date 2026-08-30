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
| Landing initial JS | Included in monolith | 230.32 kB raw / 73.74 kB gzip |
| Studio initial JS | Included in monolith | 1,175.99 kB raw / 337.10 kB gzip |
| Main Studio `App` chunk | 2,123.67 kB raw / 605.11 kB gzip | 673.23 kB raw / 197.96 kB gzip |
| Shared CSS | 153.13 kB raw | 156.17 kB raw / 23.22 kB gzip |
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

## Creative Compass Follow-up Baseline

The 4.2 follow-up adds a deterministic, data-only composition coach and keeps
it outside the initial Studio route. `CreativeCompassPanel` is a 3.75 kB gzip
lazy chunk; the pure recipe converter is a separate 3.79 kB gzip chunk. No new
audio package, worker, sample, scheduler, or project-schema field was added.

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
reachable from More and the phone menu. The Creative Compass stayed within
320- and 390-pixel mobile viewports without horizontal or vertical escape.

## Runtime Baseline and Final Result

Both sets were captured against production preview with the same repository profiler. Browser start and garbage collection introduce run-to-run variance; bundle size and pass/fail assertions are the more deterministic load indicators.

| Scenario | Before | Final exact build |
| --- | ---: | ---: |
| First play: largest long task | 421 ms | 341 ms |
| First play: total long tasks | 730 ms | 691 ms |
| First play: heap delta | +19.43 MB | +15.01 MB |
| Cold-load measured duration | 234 ms | 935 ms |
| Audio startup / Panic / replay: largest long task | Not isolated | 115 ms |
| Mixer stress | Not isolated | 27.95 sec / 100 ms max long task |
| Visualizer + Performance Mode stress | Not isolated | 10.97 sec, zero long tasks |
| Repeated preset switching | Not isolated | 9.46 sec, zero long tasks |
| Repeated project replacement | 137 ms max / 3,351 ms total | 97 ms max / 2,713 ms total |
| Save/load/autosave: largest long task | 111 ms | 96 ms |
| WAV export: largest long task | 99 ms | 77 ms |

The final cold-load wall time remained slower than the initial sample despite a
44.7% smaller gzip Studio startup payload; earlier post-fix samples measured
678, 916, 935, and 1,269 ms. First-play heap samples ranged from +15.01 to +23.95
MB across graph variants. This variability remains a field/device telemetry
requirement rather than being hidden as a deterministic runtime win.

## Ten-Minute Release Gate

Exact-source evidence: `runtime-profile/runtime-profile-1788109493599.json`

- Continuous production playback plus stop, Panic, cleanup, and idle checks: **pass**.
- Scenario duration: 604,282 ms.
- Full requested playback duration reached: yes.
- Page errors: 0.
- Console messages: 0.
- CDP/browser responsiveness after playback: pass.
- Ten-minute heap delta: +1.70 MB.
- Largest recorded long task in the scenario: 169 ms; total: 376 ms.
- Active scheduled players, AudioWorklet nodes, and lean one-shot sources: 0.
- The project intentionally remained loaded with its reusable transport schedule;
  the later 20-cycle project-replacement cleanup check ended with 0 active
  transport events, 0 track voices, 0 players, and 0 worklets.

## Final Production Matrix

Exact-source evidence: `runtime-profile/runtime-profile-1788109493599.json`

All 19 scenarios passed:

- Seven first-play isolation/graph variants.
- Cold load.
- Audio startup, Panic, and replay.
- Playback with mixer and scope.
- 28-second mixer stress.
- Visualizer and Performance Mode stress.
- Repeated preset switching.
- Repeated project load/unload.
- Small and large sample import.
- Save, load, and autosave.
- Portable JSON export/import plus malformed JSON rejection.
- Default/demo WAV export.
- Service-worker cache/update simulation.

The profile contains zero page errors and zero console warnings/errors. Its
project-replacement idle checkpoint records 0 active transport events, 0 track
voices, 0 scheduled players, 0 lean one-shot sources, and 0 AudioWorklet nodes.

## Commands and Results

| Command | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | Pass; lockfile current |
| `corepack pnpm typecheck` (root) | Pass across libraries and four relevant workspaces |
| `corepack pnpm build` (Studio) | Pass, including SSR/prerender |
| `corepack pnpm test:unit` | Pass, 35/35, including factory integrity, Creative Compass, pack conversion, lean-drum settings deduplication, autosave migration/policy, Scale Lock, MIDI, and storage |
| `corepack pnpm test:select-values` | Pass |
| `corepack pnpm test:bundle` | Pass |
| `corepack pnpm test` | Pass, Playwright 19/19, including audio-enabled pack switching, melodic/reversible sketch undo, generated-loop reachability, responsive PWA access, keyboard tabs, and durable/transient replacement safety |
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
