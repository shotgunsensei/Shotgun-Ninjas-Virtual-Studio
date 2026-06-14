# Performance Audit - Shotgun Ninjas Virtual Studio

Audit date: 2026-06-08

Scope: static audit only. No app code was modified.

## Architecture Summary

Shotgun Ninjas Virtual Studio is a React + Vite + TypeScript browser DAW in `artifacts/studio`. It uses:

- React UI with a custom external store in `src/store.ts`.
- Tone.js as the main DAW audio engine.
- IndexedDB via `idb` for projects, drafts, blobs, sample library, and Chop Lab state.
- WaveSurfer for sample preview regions.
- A hand-rolled service worker in `public/sw.js`.
- A separate raw Web Audio ambient world layer in `src/contexts/WorldContext.tsx` and `src/lib/worldAudio.ts`.

The main singleton engine is `src/lib/audio/engine.ts`. It owns the master chain, track voices, Tone.Transport integration, metronome, lookahead scheduler integration, automation/modulation scheduler, audio clip players, and per-track graph construction.

## Audio Engine Summary

Primary files:

- `src/lib/audio/engine.ts`: singleton `AudioEngine`; track graph construction; metronome scheduling; automation; clip scheduling; panic/stop; track disposal.
- `src/lib/audio/master.ts`: `MasterChain`; master compressor/limiter/widener/soft clip chain; global send buses; 80 ms clip watcher.
- `src/lib/audio/voices.ts`: legacy melodic/drum voice factories.
- `src/lib/audio/sounds/kits.ts`: v2 drum kit piece graphs and sample-bank async replacement.
- `src/lib/audio/sounds/presets.ts`: melodic preset voice construction.
- `src/lib/audio/sounds/samples.ts`: async sample probing/loading for drums and melodic samplers.
- `src/lib/audio/worklet-manager.ts`: AudioWorklet registration and CPU probe.
- `src/lib/audio/lookahead-scheduler.ts`: 25 ms UI-thread lookahead queue.
- `src/lib/audio/export.ts`: offline render, WAV/MP3/stems/DAW-pack export.

Confirmed graph pattern:

- Each track voice builds a dense chain: instrument -> filter -> HPF -> EQ3 -> distortion -> chorus -> compressor -> delay -> reverb -> bitcrusher -> widener -> channel -> master.
- Each track also creates a `Tone.Meter` and one send gain per global bus.
- Drum v2 kits create one `PieceVoice` per drum piece, each with filter/gate/channel/sends plus a synth pool and optional async sample bank.
- Melodic presets may start with a synth fallback and asynchronously hot-swap to a loaded sampler.

Disposal exists for track voices, kits, piece voices, meters, sends, mic user media, and many one-shot preview voices. Remaining risk is not obvious missing `dispose()` in the static path; it is async lifecycle ordering and runtime proof.

## React State / Render Risk Summary

Lower-risk items already improved:

- `StereoMeter` in `src/components/Meter.tsx` draws to canvas via `visualTicker` and avoids per-frame React state except clip-latch changes.
- `PositionReadout` writes directly to a span through a ref.
- `MasterClipBadge` uses `visualTicker` and only latches state when clipping occurs.
- `AudioDiagnosticsPanel` only runs while open and now polls at 1 Hz.

Current risks:

- `ProjectClipBadge` in `src/components/TransportBar.tsx` now uses `visualTicker`, skips scans unless playback is running or clip history is open, and only calls React state setters when a newly clipped track appears.
- `MasterScope`, arrangement playhead, piano-roll playhead, DrumPads active-step highlight, vocal input level, and master clip polling now share `visualTicker` instead of owning independent playback rAF loops.
- `useStore` selectors in `Timeline`, `App`, `TransportBar`, `ChannelStrip`, instrument panels, and right-side panels are generally scoped, but store edits from drag/automation/chop operations still invalidate subscribers.
- `AutomationLane` pushes store changes during mouse moves; this is interaction-bound, not playback-bound, but can dirty autosave repeatedly.
- `ChopLab` marker dragging updates store and redraws canvas on mouse move.

## Scheduler / Transport Risk Summary

Transport scheduling paths:

- `src/hooks/useTransport.ts` schedules note clips and audio clips when `scheduleKey` changes.
- `audio.scheduleClip()` schedules Tone.Transport note callbacks for note events.
- `audio.scheduleAudioClip()` creates a `Tone.Player` per audio clip, schedules it on Tone.Transport, and tracks the player for panic/disposal.
- `audio.setMetronome()` schedules a `"4n"` repeat and now explicitly clears it when disabled.
- `audio.ensureAutomationScheduler()` schedules a Tone.Transport repeat at 0.02 seconds when automation/modulation exists.
- `lookaheadScheduler.start()` starts a 25 ms `setInterval` after audio unlock.
- `basslinePattern` has a separate scheduleRepeat path in `src/lib/performance/bassline.ts`.

Current risks:

- Automation/modulation scheduler runs every 20 ms when active and applies routing work on the UI/main JS side through Tone callbacks.
- `scheduleKey` fingerprints note clips by `notes.length`, not note content. Editing note pitch/velocity/duration without changing note count may fail to reschedule accurately; fixing that may increase reschedule churn unless carefully hashed.
- `panicStopAll()` intentionally avoids `Transport.cancel()` to preserve schedules. This is musically useful but means duplicate schedules must be controlled entirely by `useTransport` cleanup and explicit clear IDs.
- Audio clip players are created per scheduled audio clip. Dense audio clip projects create many Tone.Player instances and object URLs.

## Visualizer / Meter / Loop Risk Summary

High-frequency loops found:

| Path | Loop | Current guard | Risk |
| --- | --- | --- | --- |
| `visualTicker.ts` | Shared rAF, 25 FPS or 15 FPS performance mode | `document.hidden`, subscriber count | Good central primitive |
| `Meter.tsx` | VisualTicker subscriber per meter | Shared hidden guard | Low |
| `TransportBar` `PositionReadout` | VisualTicker while playing | Shared hidden guard | Low |
| `TransportBar` `MasterClipBadge` | VisualTicker always mounted | Shared hidden guard | Low-medium |
| `TransportBar` `ProjectClipBadge` | Shared visualTicker | Runs only while playing or clip history is open | Low-medium |
| `MasterScope.tsx` | Shared visualTicker | Hidden guard inherited from ticker | Low |
| `AudioDiagnosticsPanel.tsx` | Shared visualTicker while open, plus 1000 ms interval | Polling skips hidden tabs | Low |
| `master.ts` | 80 ms setInterval clip watcher | Skips hidden | Low-medium |
| `lookahead-scheduler.ts` | 25 ms setInterval | No hidden guard, audio-related | Expected but must stay lean |
| `pwa.ts` | Periodic service worker update interval | Not performance-critical | Low |
| `WorldContext` / `worldAudio.ts` | Ambient recursive setTimeout loops | Stop handles exist, but independent AudioContext | Medium |

## Storage / Export / Import Risk Summary

Autosave:

- `App.tsx` tracks dirty state through a store subscription outside React render.
- Draft save is debounced to 8 seconds.
- Draft save skips while Tone.Transport is started.
- Real autosave is user-configurable: off, 15s, 30s, 60s.
- Transient demo projects skip real autosave.

Remaining autosave risk:

- `saveDraft()` and `saveProject()` still call `serializeAndFlushBlobs()` over the full project.
- Blob fingerprinting avoids redundant blob writes, but object traversal and serialized project construction still scale with track/clip/sample count.
- `autosaveEnabled` and `autosaveIntervalMs` remain in settings but the active app path appears to use `autosaveIntervalSec`; this should be cleaned up or documented to avoid false settings.

JSON import/export:

- `projectToJson(project, "project-with-samples")` base64-embeds every audio clip and sample blob. Large projects can create huge strings and memory spikes.
- `summarizeProjectJson()` parses JSON, then calls `parseProjectJson()` again, meaning large imports are parsed and converted eagerly before user confirmation.
- `base64ToBlob()` and `blobToBase64()` are synchronous loops over full binary payloads after `arrayBuffer()`.

WAV/MP3 export:

- `renderProject()` has a single global `_exportInProgress` guard.
- Audio clip decode is batched at 4 clips and yields between batches.
- Offline rendering still creates a full `Tone.OfflineContext`, builds track graphs, waits for `Tone.loaded()`, renders a full `AudioBuffer`, then encodes WAV/MP3 on the main thread.
- After export, `Header.tsx` decodes the resulting export blob again to detect clipping.
- Stems and DAW Pack export call `renderProject()` repeatedly, multiplying offline render and encode costs.

Sample import/edit:

- `SamplePreviewDialog` uses WaveSurfer for waveform/regions and falls back to `decodeBlob()` plus canvas.
- `applyEditsToBlob()` decodes the full blob, copies buffers for trim/reverse/fades/normalize, then re-encodes WAV on the main thread.
- `ChopLab.loadFile()` decodes the full file through the current Tone raw AudioContext.
- `ChopLab.exportKit()` renders each slice to WAV and zips all slices in memory.

## CSS / PWA Risk Summary

CSS performance risks:

- Normal mode still uses animated particle layers: 60 shuriken twinkles, 60 rain drops, smoke blur blobs, circuit SVG pulses, scanline flicker, and sparks.
- Normal mode uses glow classes, box shadows, fixed radial gradients, backdrop blur, animated clip LEDs, and tempo-synced master pulse.
- Performance Mode reduces visual cost by unmounting `BackgroundFx`, setting visual ticker to 15 FPS, and stripping several glows/animations through `body[data-perf="true"]`.
- Performance Mode does not currently reduce audio graph density, export behavior, sampler probing, automation rate, or ambient world audio. The prior independent `ProjectClipBadge`/`MasterScope` loops now inherit the shared ticker cap.

PWA behavior:

- `public/sw.js` uses versioned shell/runtime caches and purges old versioned caches on activate.
- Navigations are network-first with cached `index.html` fallback.
- Same-origin GET runtime assets are cache-first with background refresh.
- Blob/data/range requests and non-GET requests are not cached.
- Stale asset risk remains because cached runtime assets can be returned before the background refresh completes. Update UX in `src/lib/pwa.ts` must be manually verified after a production deploy.

## Top 10 Suspected Root Causes

| Rank | Suspected root cause | Expected impact | Confidence | Patch risk |
| --- | --- | --- | --- | --- |
| 1 | Offline export keeps full decoded clips, full offline render buffer, and WAV/MP3 encode buffers on main thread; stems/DAW pack repeat this cost. | Page-unresponsive and memory spikes during export. | High | Medium-high |
| 2 | Sample import/edit/Chop Lab decode and buffer transforms run on the main thread with full-buffer copies. | Freezes during large sample imports and edits. | High | Medium |
| 3 | Track graph creation is eager and dense: each track gets many Tone nodes, sends, meters, FX, and kits create many piece voices. | Slow demo/project load and increased baseline CPU/memory. | High | High |
| 4 | Project-wide meter scans still scale with track count while playback is running, though they now run through the shared visual ticker and state writes are latch-gated. | Playback UI lag with many tracks. | Medium | Low |
| 5 | Automation/modulation scheduler runs every 20 ms when active and applies JS-side routing. | Latency/stutter on dense automated projects. | Medium-high | Medium |
| 6 | Secondary ambient raw AudioContext and recursive timers run outside the DAW engine. | Extra CPU/audio nodes and lifecycle complexity. | Medium | Medium |
| 7 | JSON export/import with embedded samples creates huge base64 strings and parses/converts eagerly. | Project-with-samples export/import freezes. | Medium | Medium |
| 8 | Normal-mode CSS/background effects still animate many DOM/SVG/blur/glow layers. | Paint/compositing cost on weaker devices. | Medium | Low |
| 9 | Instrument/editor panels can still perform interaction-bound store writes during drags and edits. | Local UI lag during editing. | Medium | Low-medium |
| 10 | Service worker cache-first runtime assets can temporarily serve stale chunks. | Fixes appear not to apply after deploy; user sees old bugs. | Medium | Low |

## Exact Files / Functions To Patch Next

| Patch target | File/function | Recommended change | Risk |
| --- | --- | --- | --- |
| Export memory cap | `src/lib/audio/export.ts`: `renderProject`, `renderStems`, `exportDawPack`, `encodeWav`, `encodeMp3` | Add duration/size guardrails, stronger cancellation, yield points during encode, avoid post-export decode for clipping, and serialize stem rendering with user-visible limits. | Medium-high |
| Large sample guard | `src/components/SamplePreviewDialog.tsx`, `src/lib/audio/sampleEdits.ts`, `src/components/instruments/ChopLab.tsx` | Add file size/duration warnings, yield points, and avoid duplicate full-buffer copies where possible. | Medium |
| Project clip LED loop | `src/components/TransportBar.tsx`: `ProjectClipBadge` | Fixed in render-storm pass; continue validating track-count scaling in production profile. | Low |
| Performance Mode scope | `src/lib/settings.ts`, `src/components/TransportBar.tsx`, `src/components/MasterScope.tsx`, `src/lib/audio/engine.ts` | Make Performance Mode reduce nonessential visual loops and optionally lower automation/diagnostics visual polling without changing audio timing. | Medium |
| Lazy graph build | `src/lib/audio/engine.ts`: `ensureTrack`, `buildVoice`, `attachInstrument`; `src/hooks/useTransport.ts` | Avoid building full graphs for muted/inactive tracks until needed; keep preload path explicit. | High |
| Automation scheduler | `src/lib/audio/engine.ts`: `ensureAutomationScheduler`, `automationTick`, `setProjectModulation`, `setTrackAutomation` | Start only when active, stop when no lanes/sources remain, consider lower rate or dirty-target batching. | Medium |
| Audio clip object URLs | `src/lib/audio/engine.ts`: `scheduleAudioClip`; `src/hooks/useTransport.ts` cleanup | Track/revoke object URLs when players are disposed. | Low-medium |
| Ambient audio isolation | `src/contexts/WorldContext.tsx`, `src/lib/worldAudio.ts` | Add Performance Mode disable, visibility handling, and optional context close after stop. | Medium |
| JSON import/export guardrails | `src/lib/storage/db.ts`: `projectToJson`, `summarizeProjectJson`, `parseProjectJson` | Warn or cap project-with-samples payloads; avoid double parse; stream or chunk base64 conversion if retained. | Medium |
| SW update hardening | `src/lib/pwa.ts`, `public/sw.js` | Verify update prompt, cache version messaging, and skip-waiting flow in production preview. | Low |

## Diagnostics Instrumentation Added

Development-only performance diagnostics now exist in `src/utils/performanceDiagnostics.ts`.

- Uses `performance.mark()` / `performance.measure()` with `studio:*` entry names.
- Installs `window.__SN_PERF_DIAGNOSTICS__` only in Vite development mode.
- Console output is disabled by default and can be enabled with `window.__SN_PERF_DIAGNOSTICS__.enableLogs()`.
- No analytics, network calls, project data upload, or production-user logging were added.

Measured timing points:

- App startup: `main.tsx`, `App.tsx`
- Audio engine initialization: `src/lib/audio/engine.ts`
- Project load/save/autosave/JSON export: `src/lib/storage/db.ts`
- Sample import/edit and waveform generation: `src/lib/audio/sampleEdits.ts`, `SamplePreviewDialog.tsx`, `ChopLab.tsx`
- WAV/MP3 export and offline render resource lifetime: `src/lib/audio/export.ts`
- Transport play/stop: `src/hooks/useTransport.ts`
- Kit switch and instrument replacement: `src/lib/audio/engine.ts`
- Visualizer mount/unmount and visual loop lifetimes: `MasterScope.tsx`, `AudioDiagnosticsPanel.tsx`, `visualTicker.ts`, `TransportBar.tsx`

Tracked counters:

- `activeRafLoops`
- `activeIntervals`
- `activeToneTransportEventIds`
- `activeAudioResources`
- `autosaveAttempts`
- `skippedAutosaves`
- `sampleBlobWrites`

Use from a dev console:

```js
window.__SN_PERF_DIAGNOSTICS__.snapshot()
window.__SN_PERF_DIAGNOSTICS__.enableLogs()
window.__SN_PERF_DIAGNOSTICS__.disableLogs()
window.__SN_PERF_DIAGNOSTICS__.reset()
```

Immediate red flags exposed while wiring diagnostics:

- `ProjectClipBadge` no longer owns a dedicated rAF loop; it still scans every track meter while playback is running.
- `AudioDiagnosticsPanel` now uses the shared ticker plus a 1-second interval while open.
- `LookaheadScheduler`, master clip watcher, and periodic autosave all use independent intervals.
- Transport event IDs are now tracked when scheduled/cleared, but note/audio clip event lifetimes depend on explicit cancellation paths; completed one-shot events are not automatically removed from the diagnostic set unless they flow through existing cancellation.
- Full-buffer waveform/sample/export paths are now measurable but still run on the main thread.

## Highest-Confidence Root Causes

1. Export and sample-edit paths still do unavoidable full-buffer work on the main thread.
2. Audio graph density is high for the default project shape and gets worse with v2 kits/presets/effects.
3. `ProjectClipBadge` now uses the shared ticker, but still scans all track meters while playback is running.
4. Performance Mode is real for visuals but incomplete as a global load-shedding mode.

## Highest-Risk Files

- `src/lib/audio/export.ts`
- `src/lib/audio/engine.ts`
- `src/hooks/useTransport.ts`
- `src/components/Header.tsx`
- `src/components/SamplePreviewDialog.tsx`
- `src/components/instruments/ChopLab.tsx`
- `src/lib/audio/sampleEdits.ts`
- `src/components/TransportBar.tsx`
- `src/contexts/WorldContext.tsx`
- `public/sw.js`

## Recommended First Patch Batch

1. Validate the shared-ticker render-storm fixes in a production browser profile with many tracks and open mixer/visualizer panels.
2. Add export guardrails: max estimated render size warning, no repeated clipping decode, encode yield points, and explicit cancellation checks.
3. Add large sample/Chop Lab guardrails before decode/edit/export-kit operations.
4. Continue wiring Performance Mode into ambient world audio and any remaining nonessential visual work.
5. Add object URL revocation for scheduled audio clip players.

## Blocks Safe Fixing

- Direct `pnpm` is not on PATH; `corepack pnpm` works.
- Windows validation requires `C:\Program Files\Git\usr\bin` on PATH because the root `preinstall` script uses `sh`.
- Studio typecheck passed on 2026-06-12.
- Studio build passed on 2026-06-12 after allowing the current Windows native packages for Rollup, esbuild, lightningcss, and Tailwind oxide, adding safe Vite env defaults, and fixing the Windows prerender import path.
- Studio Playwright tests passed on 2026-06-12 after installing Chromium and correcting the stale test route to `/studio?disableAudio=1`.
- Root workspace build remains blocked by local/global tooling and non-studio packages: the root script calls bare `pnpm`, and `artifacts/mockup-sandbox` requires `PORT` for build.
- No runtime performance profile or heap snapshot exists for this checkout.
- Export and lazy graph changes touched core DAW behavior; smoke validation passed for default WAV export, JSON export, demo load, service worker registration, and transport UI controls.
- Service worker old-cache update behavior still needs a true two-build cache/update simulation.

## Final Verification Notes

Final verification on 2026-06-12 confirmed the studio package now has a clean
TypeScript check, successful production build, passing Playwright welcome-flow
tests, and a working production preview. No obvious console/page errors were
captured on `/studio` load, audio-enable click, transport smoke, demo load,
project-only JSON export, or default WAV export.

Remaining verification gaps are runtime profiling gaps rather than compile
blockers: 10-minute playback, normal sample import, JSON import through File
System Access, old service-worker cache update behavior, and repeated
kit/project stress loops.
