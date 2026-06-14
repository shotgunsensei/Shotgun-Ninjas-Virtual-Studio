# Performance Baseline

Audit date: 2026-06-08

Scope: static audit only. No application behavior was changed and no runtime profiling was performed in this pass.

## Package Manager Detected

- Required package manager: `pnpm`
- Evidence:
  - Root `package.json` has a `preinstall` guard that rejects non-pnpm installs.
  - `pnpm-lock.yaml` and `pnpm-workspace.yaml` are present at the repo root.
  - Studio package is `@workspace/studio` under `artifacts/studio`.
- Current shell status: `pnpm --version` failed because `pnpm` is not recognized in this PowerShell session.

## Available Scripts

Root `package.json`:

| Script | Command |
| --- | --- |
| `preinstall` | Rejects npm/yarn lockfiles and requires pnpm user agent |
| `build` | `pnpm run typecheck && pnpm -r --if-present run build` |
| `typecheck:libs` | `tsc --build` |
| `typecheck` | `pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck` |

Studio `artifacts/studio/package.json`:

| Script | Command |
| --- | --- |
| `dev` | `vite --config vite.config.ts --host 0.0.0.0` |
| `build` | `vite build --config vite.config.ts && vite build --config vite.ssr.config.ts && node scripts/prerender.mjs` |
| `serve` | `vite preview --config vite.config.ts --host 0.0.0.0` |
| `typecheck` | `tsc -p tsconfig.json --noEmit` |
| `test` | `playwright test` |
| `test:headed` | `playwright test --headed` |
| `test:report` | `playwright show-report` |

## Script Availability

| Check | Exists? | Notes |
| --- | --- | --- |
| Install | Yes, via `pnpm install` | Blocked in current shell until pnpm is installed or on PATH. |
| Build | Yes | Root and studio build scripts exist. |
| Type-check | Yes | Root and studio typecheck scripts exist. |
| Test | Yes | Studio Playwright test script exists. |
| Lint | No | No root or studio `lint` script was found. |
| Preview | Yes | Studio uses `serve`, not `preview`. |

## Dev Run Instructions

From repo root after pnpm is available:

```bash
pnpm install
pnpm --filter @workspace/studio dev
```

Expected Vite app root: `artifacts/studio`.

## Production Preview Instructions

From repo root after pnpm is available:

```bash
pnpm --filter @workspace/studio build
pnpm --filter @workspace/studio serve
```

Use production preview for performance acceptance. Dev mode adds Vite, React dev, and HMR overhead that can exaggerate render and scheduling problems.

## Files Most Likely Involved In Crashes/Freezes

| Area | Files |
| --- | --- |
| Audio graph lifecycle | `src/lib/audio/engine.ts`, `src/lib/audio/master.ts`, `src/lib/audio/voices.ts`, `src/lib/audio/sounds/kits.ts`, `src/lib/audio/sounds/samples.ts`, `src/lib/audio/sounds/presets.ts` |
| Transport and scheduling | `src/hooks/useTransport.ts`, `src/lib/audio/engine.ts`, `src/lib/audio/lookahead-scheduler.ts`, `src/lib/performance/bassline.ts` |
| Visual loops and meters | `src/lib/visualTicker.ts`, `src/components/Meter.tsx`, `src/components/TransportBar.tsx`, `src/components/MasterScope.tsx`, `src/components/AudioDiagnosticsPanel.tsx` |
| Autosave and project persistence | `src/App.tsx`, `src/lib/storage/db.ts`, `src/components/Header.tsx` |
| WAV/MP3/stem/DAW pack export | `src/lib/audio/export.ts`, `src/components/Header.tsx` |
| Sample import/edit/chop | `src/components/SamplePreviewDialog.tsx`, `src/lib/audio/sampleEdits.ts`, `src/components/instruments/ChopLab.tsx`, `src/lib/audio/chopEngine.ts` |
| Background visual cost | `src/components/BackgroundFx.tsx`, `src/index.css`, `src/lib/settings.ts` |
| PWA caching | `src/lib/pwa.ts`, `public/sw.js` |
| Secondary ambient audio lane | `src/contexts/WorldContext.tsx`, `src/lib/worldAudio.ts` |

## Manual Reproduction Checklist

Run these against production preview after pnpm/tooling is available:

- App loads without console errors.
- Enable Audio works.
- Spacebar play/pause works.
- Stop releases audio.
- Panic stops all audio and count-in timers.
- Demo project loads without freezing.
- Playback runs 10 minutes without a page-unresponsive dialog.
- Mixer opens during playback without freeze.
- Visualizer opens during playback without freeze.
- Normal sample import does not freeze page.
- Chop Lab sample load, transient detection, slice export, and use-as-kit do not freeze page.
- Project save does not freeze page.
- Project load does not freeze page.
- JSON export works in both project-only and project-with-samples modes.
- WAV export works for short projects.
- WAV export limitation is documented for long or dense projects.
- Stem export and DAW Pack export do not stack exports or lock the UI indefinitely.
- Autosave skips unchanged projects.
- Hidden visual panels stop animation loops.
- Repeated kit/instrument switching does not steadily leak memory.
- Repeated project load/unload does not stack Tone.Transport events.
- Performance Mode reduces visual load.
- Service worker update flow does not serve stale bundles after a new build.

## Baseline Hypothesis Table

| Hypothesis | Current Evidence | Baseline Confidence |
| --- | --- | --- |
| `StereoMeter` causes frequent React state updates | Mostly addressed. `StereoMeter` draws to canvas via `visualTicker` and only uses React state for clip latch changes. | Low as current root cause |
| `MasterClipBadge`, `PositionReadout`, `AudioDiagnosticsPanel` hot-loop too much | Mostly addressed. `ProjectClipBadge`, `MasterScope`, arrangement/piano-roll playheads, DrumPads active-step highlight, vocal input level, and master clip polling now use the shared visual ticker. Diagnostics polling is 1 Hz while open. | Low-medium |
| Autosave serializes too often | Improved to 8 second draft debounce plus 15/30/60 sec real autosave, but each save/draft still serializes the whole project and may traverse all clips/samples. | Medium |
| WAV export decodes too much at once | Decode is batched at 4 clips with yields, but full offline render and full WAV/MP3 encode are still memory-heavy. Stem and DAW Pack exports repeatedly render full passes. | High |
| Background FX renders too many DOM elements | Performance Mode unmounts `BackgroundFx`, but normal mode still has 60 rain drops or 60 twinkle dots plus glows/blur/smoke. | Medium |
| Tone/Web Audio disposal is incomplete | Track/kit/preset disposal exists, but async sampler hot-swap, secondary raw `AudioContext` ambient loops, and one-shot preview/dispose timers need runtime leak validation. | Medium |
| Metronome `scheduleRepeat` is not cleared | Addressed. `setMetronome(false)` clears `metronomeId`. | Low |
| CSS glow/shadow effects cause paint cost | Performance Mode strips several glows/animations, but normal mode still uses backdrop blur, box-shadow, animated particles, pulse LEDs, fixed gradients, and smoke blur. | Medium |
| Missing real Performance Mode | Partially addressed in settings, `visualTicker`, `BackgroundFx`, CSS, and playback UI loops. It is still visual-only and does not reduce audio graph/scheduler/export work. | Medium |
| Service worker stale cache | SW uses versioned caches and cache-first runtime assets with background refresh. Stale bundle risk remains until update UX is manually verified. | Medium |

## Baseline Blockers

- `pnpm` is available through Corepack (`corepack pnpm`), but direct `pnpm` is still not on PATH; the root `build` script calls bare `pnpm`.
- Windows validation needs `C:\Program Files\Git\usr\bin` on PATH because the root `preinstall` script calls `sh`.
- Studio package `npm run typecheck` passed on 2026-06-12.
- Studio package `npm run build` passed on 2026-06-12 after allowing current-platform Windows native packages and fixing Windows env/default config issues.
- Studio package `npm run test` passed on 2026-06-12 after installing Playwright Chromium and updating the stale `/` test route to `/studio?disableAudio=1`.
- Production preview served `/` and `/studio` with HTTP 200 on 2026-06-12.
- Root workspace recursive build remains blocked outside studio by `artifacts/mockup-sandbox` requiring `PORT`.
- No Chrome Performance recording, heap snapshot, or 10-minute playback run has been captured yet.
- Current performance findings are code-audit plus instrumentation findings, not measured runtime proof.

## Final Verification Snapshot

Verified on 2026-06-12 against `artifacts/studio`:

- TypeScript: pass.
- Production build: pass, with warnings for large main chunk, sourcemaps, and static/dynamic import overlap.
- Playwright tests: 4 passed.
- Production preview: pass.
- Console smoke on `/studio`: no captured console errors/page errors.
- Audio enable click: pass in headless Chromium.
- Transport play/pause/stop/panic UI smoke: pass.
- Demo load: pass.
- Project-only JSON export: pass.
- WAV export for default project: pass.
- Performance Mode persisted setting applies `body[data-perf="true"]`: pass.
- Service worker registers and controls page on preview: pass.

Not fully verified:

- 10-minute playback.
- Normal sample import.
- JSON import through File System Access.
- Old-cache service worker update prompt.
- Repeated kit switching and repeated project load/unload stress.

## Diagnostics Baseline

Development-only app-local diagnostics are now available through
`src/utils/performanceDiagnostics.ts` and `window.__SN_PERF_DIAGNOSTICS__` in
Vite dev mode.

Use these commands in the browser dev console during manual reproduction:

```js
window.__SN_PERF_DIAGNOSTICS__.snapshot()
window.__SN_PERF_DIAGNOSTICS__.enableLogs()
window.__SN_PERF_DIAGNOSTICS__.disableLogs()
window.__SN_PERF_DIAGNOSTICS__.reset()
```

The baseline manual checklist should capture the snapshot before and after:

- App startup / Enable Audio
- Demo project load
- 10-minute playback
- Mixer open during playback
- Visualizer open during playback
- Sample import and Chop Lab load
- Project save/autosave
- JSON export
- WAV export
- Repeated kit/instrument switching
- Repeated project load/unload

## Render-Storm Baseline Notes

Current render-storm mitigation status:

- Meters, transport position, master clip badge, project clip badge, master scope, arrangement playhead, piano-roll playhead, DrumPads active-step highlight, vocal input level, diagnostics dropped-frame monitor, and master strip clip polling now share `visualTicker` or write directly to DOM refs.
- Normal visual cadence is capped by `visualTicker` at 25 FPS.
- Performance Mode caps the same shared ticker at 15 FPS.
- `AudioDiagnosticsPanel` polls at 1 Hz and skips hidden-tab polling.

Remaining UI performance risks to profile:

- Project-wide clip scanning still loops over every track meter while playback is running.
- Automation and Chop Lab drag handlers still push store updates during pointer movement.
- Gamepad polling remains a separate rAF loop because it is input polling, not a visual loop.
