# Performance Fixes — 2026-08-30 Full Oversight

This pass stabilizes the existing browser DAW first, then adds performance-safe free sound/preset/extension value using the current architecture. It does not rewrite the app, redesign the interface, weaken project safety, or add monetization.

## Audio, Transport, and Lifecycle

- Consolidated all desktop/mobile/app scheduling under one `TransportProvider`.
- Prepared complete note and audio schedules before the first transport start.
- Added generation-safe serialized schedule preparation and a relevant-edit revision instead of broad project stringification.
- Moved tempo, loop, swing, metronome, and master synchronization out of desktop-only UI effects.
- Made audio unlock retry-safe and live-pad/key voice creation independent of prior playback.
- Stopped the lookahead interval when it has no events and prevented duplicate scheduler loops.
- Added full project-replacement cleanup for track voices, automation/modulation, scheduled players/events, Chop Lab, and master resources.
- Completed master-chain disposal for meters, buses, sends, processors, and watchers.
- Hardened lean drum hits with source caps, ended-source disconnection, correct gain/solo routing, and no raw-destination fallback.
- Made async drum-bank and melodic-sample swaps generation-safe so late loads cannot replace or revive disposed voices.
- Routed Chop Lab, sound-pack preview, and world/welcome audio through the master chain and Panic ownership.
- Removed a second full Chop PCM copy and stopped rebuilding Chop audio on every marker pointer move.
- Removed the remote Salamander piano download dependency; Grand Piano is now an immediate offline modeled piano with optional local licensed-layer hot swap.

Primary files: `src/hooks/useTransport.ts`, `src/lib/audio/engine.ts`, `src/lib/audio/master.ts`, `src/lib/audio/leanDrumVoice.ts`, `src/lib/audio/lookahead-scheduler.ts`, `src/lib/audio/chopEngine.ts`, `src/lib/audio/sounds/samples.ts`, `src/lib/worldAudio.ts`, `src/contexts/WorldContext.tsx`, and instrument components.

## Startup, Rendering, and PWA

- Lazily loaded the Studio route so the public landing page no longer downloads the DAW.
- Split Tone.js into an audio-vendor chunk and MP3/ZIP exporters into on-demand chunks.
- Lazily loaded instrument/editor panels, mobile studio, sample preview, world picker, sound/plugin browsers, performance panels, Help, recovery, missing-sample, settings, lessons, glossary, diagnostics, share, project-info, and other dialogs.
- Stopped mounting closed dialogs and duplicate Help surfaces.
- Removed a duplicated large editor-control block from `WorldPicker`.
- Replaced a Lucide namespace import with an explicit icon map for tree shaking.
- Disabled public source maps by default with an explicit diagnostic opt-in.
- Changed the service worker to precache only the shell and runtime-cache lazy assets.
- Removed unused Next.js-only client directives from Vite UI primitives, eliminating build-report warnings.
- Added a manifest-driven bundle budget check covering landing/Studio payloads, CSS, lazy chunks, source maps, and service-worker policy.

Final bundle-budget measurements:

| Budget | Final |
| --- | ---: |
| Landing initial JS | 228.29 kB raw / 72.79 kB gzip |
| Studio initial JS | 1,156.63 kB raw / 331.00 kB gzip |
| Core Studio App chunk | 655.58 kB raw / 192.61 kB gzip |
| Shared CSS | 153.13 kB raw / 22.79 kB gzip |
| Largest lazy chunk | 58.39 kB gzip |

Primary files: `src/router.tsx`, `src/App.tsx`, `src/components/Header.tsx`, `src/components/Footer.tsx`, `src/components/LeftBrowser.tsx`, `src/components/TransportBar.tsx`, `src/components/ChannelStrip.tsx`, `public/sw.js`, and `vite.config.ts`.

## Storage, Autosave, and Export

- Advanced project storage to schema v5 while preserving `soundPackId`, performance state, and Chop Lab Blob/state.
- Reject invalid and future schema versions instead of silently downgrading them.
- Preserved full audio-clip metadata in IndexedDB.
- Made portable JSON embed track clips, sample-library blobs, and Chop Lab audio.
- Made project-only import explicitly report all nonportable references and remove stale blob keys.
- Serialized autosave work so overlapping writes cannot race.
- Skipped unchanged blob writes and added guarded page-hide/visibility/unload draft flush.
- Moved lightweight filename/download helpers out of the heavy audio exporter.
- Loaded Tone/export logic and the MP3 encoder only when a user exports.
- Reused MP3 frame buffers and yielded during encoding to keep UI progress responsive.

Primary files: `src/lib/storage/migrate.ts`, `src/lib/storage/db.ts`, `src/App.tsx`, `src/components/Header.tsx`, `src/lib/audio/export.ts`, `src/lib/export/download.ts`, and `src/lib/audio/master-defaults.ts`.

## Sound, Preset, Pack, and Extension Expansion

The expansion uses existing offline synthesis engines and does not add a network, licensing, or startup-size dependency.

- Melodic preset count: **14 → 28**.
- Sound-pack count: **9 → 13**.
- New built-in instrument extensions: **14**, automatically registered from the new presets.
- Added presets: Neon Glass Keys, Tape Upright, Ronin Reese, Acid Circuit, Tactical 808, Koto Night, Nylon Ghost, Neon Air, Choir Shadow, Arcade Pulse, Silk Katana, Steel Kalimba, Crystal Shrine, and Shogun Brass Stab.
- Added packs: Tape Alley Sessions, Subzero Drill, Ronin Synthwave, and Temple Air.
- Centralized full-recipe melodic preset and drum-kit application in the store so every browser/pad/world entry point applies and persists the same sound.
- Added catalog tests for uniqueness, safe ranges, local-only URLs, valid kit/preset references, and 16-step grids.

Primary files: `src/lib/audio/sounds/presets.ts`, `src/lib/audio/sounds/soundLibrary.ts`, `src/lib/audio/sounds/kits.ts`, `src/lib/plugins/builtins.ts`, `src/store.ts`, `src/components/PresetBrowser.tsx`, `src/components/PluginBrowser.tsx`, `src/components/SoundLibraryPanel.tsx`, and `src/components/instruments/DrumPads.tsx`.

## MIDI, Plugins, Dependencies, and Tooling

- Corrected MIDI UTF-8/VLQ track names, lowercase/flat note parsing, MIDI range clamping, input sanitization, same-note overlap handling, retrigger ordering, BPM/range validation, and deterministic output.
- Disabled arbitrary page-origin remote WAM imports. The UI now states that remote WAMs require a future isolated host instead of advertising a nonfunctional unsafe loader.
- Preserved built-in plugin functionality and added all new local presets as extensions.
- Removed deprecated `@types/jszip`.
- Added compatible transitive dependency overrides; `pnpm audit --prod` now reports no known vulnerabilities.
- Replaced the Unix-shell preinstall guard with a cross-platform Node guard that enforces pnpm and removes conflicting root npm/yarn lockfiles.
- Added focused Node tests for MIDI, sound catalog, storage migration, and portable JSON.

Primary files: `src/lib/export/midi.ts`, `src/lib/plugins/wam-loader.ts`, `src/lib/plugins/host.ts`, `src/lib/plugins/registry.ts`, package/workspace files, `scripts/enforce-pnpm.mjs`, and `artifacts/studio/scripts/*.test.ts`.

## Verification Completed

| Check | Result |
| --- | --- |
| Frozen pnpm install | Pass |
| Root workspace typecheck | Pass |
| Studio production + SSR/prerender build | Pass |
| Focused unit tests | 9/9 pass |
| Select-value static guard | Pass |
| Bundle budgets | Pass |
| Playwright browser acceptance | 5/5 pass |
| Production dependency audit | No known vulnerabilities |
| Production runtime matrix | 19/19 pass |
| Ten-minute playback/Panic/cleanup gate | Pass in 616.9 sec |
| Diff whitespace validation | Pass before documentation update; rerun at handoff |

## Required Manual Checklist Status

| Acceptance item | Status |
| --- | --- |
| App load, no console/page errors | Automated pass |
| Enable Audio, spacebar play/pause, Stop, Panic | Automated pass |
| Demo load and playback responsiveness | Automated pass |
| Ten-minute playback | Automated pass |
| Mixer/visualizer during playback | Automated pass |
| Normal and large sample import responsiveness | Automated pass |
| Project save/load and unchanged autosave behavior | Automated pass |
| JSON export/import | Automated pass |
| WAV export | Automated pass for default/demo projects |
| Repeated preset and project replacement cleanup | Automated pass |
| Performance Mode reduction | Automated pass |
| Service-worker update/cache path | Automated production-preview pass |
| Audible sound-quality review | Human check required |
| Real microphone and MIDI device | Hardware check required |
| Safari/iOS, Android, low-memory hardware | Device check required |
| Very long/dense export and licensed multisample assets | Remaining product/performance work |

## Rollback Notes

- Project schema changes are additive for current data, but future-version imports intentionally fail closed.
- Remote WAM loading can only be restored after an isolated host exists; reverting to page-origin dynamic import would reintroduce the security issue.
- The audio scheduling ownership change should be reverted as a unit with its `TransportProvider` wiring, not piecemeal.
- New presets/packs are data additions using existing engines and can be removed without migrating saved projects; unknown preset IDs already fall back safely.
