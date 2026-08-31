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
- Removed redundant per-hit lean-drum AudioParam writes. A primitive settings
  cache reapplies volume, pan, mute, cutoff, and resonance only when those
  values change and is cleared on removal, promotion, and project teardown.
- Made asynchronous melodic sampled-voice replacement generation-safe and made
  custom-pad resources track-owned and disposable, so late loads cannot replace
  or revive a disposed route.
- Changed melodic and sampled-instrument replacement to build-before-swap. The
  previous playable voice remains connected until its replacement is ready,
  and sampler identity/generation checks reject every stale completion.
- Made the native lean drum voice authoritative for named kits. Kit selection
  updates recipe/timbre and per-piece bus targets on the existing graph; it does
  not construct per-piece Tone voices or rebuild/swap the track mixer.
- Resolved drum and melodic trigger callbacks against the current registered
  voice at trigger time, preventing scheduled callbacks from retaining a sampler
  that a later sound-set change disposed.
- Centralized kit, melodic preset, legacy preset, fader, and pan application in
  authoritative store actions that immediately hydrate the live engine.
- Added bounded audio-context suspension recovery to live notes, drum pads,
  previews, and vocal realization, with a silence generation that prevents
  post-Panic async work from reviving audio.
- Added a Tone/native connection compatibility layer for lean voices and native
  AudioWorklet leaves. Custom processors register on the actual Web Audio
  context; the default master remains on the proven Tone/native path while
  sampled and metronome worklets retain transparent fallback.
- Installed Tone on one browser-owned interactive `AudioContext` before any
  Studio graph is constructed. This removes standardized-audio-context's
  recursive cycle scan from live voice connections, keeps the user-gesture
  resume contract, and reuses the same context across Vite HMR.
- Made vocal monitoring transactional and recorder ownership explicit. Pending
  microphone permission, duplicate stop, project replacement, reset, Panic, and
  unmount now cancel or coalesce without attaching a take to the wrong track.
- Made Chop and Performance Mode ownership track project replacement and panel
  lifecycle without destroying an intentional in-project Chop buffer on a normal
  tab remount.
- Routed Chop Lab, sound-pack preview, and world/welcome audio through the master chain and Panic ownership.
- Removed a second full Chop PCM copy and stopped rebuilding Chop audio on every marker pointer move.
- Removed the remote Salamander piano download dependency; Grand Piano is now an immediate offline modeled piano with optional local licensed-layer hot swap.

Primary files: `src/hooks/useTransport.ts`, `src/lib/audio/engine.ts`,
`src/lib/audio/master.ts`, `src/lib/audio/toneConnection.ts`,
`src/lib/audio/toneContext.ts`,
`src/lib/audio/leanDrumVoice.ts`, `src/lib/audio/leanDrumTrackSettings.ts`,
`src/lib/audio/lookahead-scheduler.ts`, `src/lib/audio/chopEngine.ts`,
`src/lib/audio/worklet-manager.ts`, `src/lib/audio/worklet-sample-player.ts`,
`src/lib/audio/sounds/kits.ts`, `src/lib/audio/sounds/samples.ts`,
`src/lib/audio/recorder.ts`, `src/lib/worldAudio.ts`,
`src/contexts/WorldContext.tsx`, and instrument components.

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

| Budget             |                            Final |
| ------------------ | -------------------------------: |
| Landing initial JS |    231.74 kB raw / 74.42 kB gzip |
| Studio initial JS  | 1,201.03 kB raw / 344.71 kB gzip |
| Shared CSS         |    157.23 kB raw / 23.36 kB gzip |
| Largest lazy chunk |                    58.39 kB gzip |

Primary files: `src/router.tsx`, `src/App.tsx`, `src/components/Header.tsx`, `src/components/Footer.tsx`, `src/components/LeftBrowser.tsx`, `src/components/TransportBar.tsx`, `src/components/ChannelStrip.tsx`, `public/sw.js`, and `vite.config.ts`.

## Storage, Autosave, and Export

- Advanced project storage to schema v6 while preserving `soundPackId`,
  performance state, Chop Lab Blob/state, and custom per-track `padSamples`.
  Schema-v5 projects migrate additively.
- Reject invalid and future schema versions instead of silently downgrading them.
- Preserved full audio-clip metadata in IndexedDB.
- Made portable JSON embed track clips, sample-library blobs, and Chop Lab audio.
- Made project-only import explicitly report all nonportable references and remove stale blob keys.
- Moved Blob fingerprinting outside IndexedDB transactions and serialized all
  project/draft save, duplicate, relocate, and import writes through one
  rejection-safe FIFO so transactions cannot expire or overtake one another.
- Re-keyed and re-owned library samples, timeline clips, Chop audio, and custom
  pad samples during duplicate/import, including formerly missing keys.
- Skipped unchanged blob writes and added guarded page-hide/visibility/unload draft flush.
- Replaced the disconnected millisecond/seconds autosave controls with one
  enabled flag and a bounded 15/30/60-second durable cadence. Both recovery
  drafts and lifecycle flushes re-check the live policy; legacy values migrate
  to the safe minimum instead of restoring high-frequency writes.
- Made project replacement preserve the current source first: durable projects
  are saved, transient demos receive a recovery draft, storage failure aborts,
  and recovering over a temporary demo requires explicit confirmation.
- Kept a transient recovery draft when the replacement destination is saved,
  covered the World Picker path, and made same-project Load/Restore save before
  reading so a stale IndexedDB object cannot overwrite the newest edit.
- Moved lightweight filename/download helpers out of the heavy audio exporter.
- Loaded native export logic and the MP3 encoder only when a user exports.
- Reused MP3 frame buffers and yielded during encoding to keep UI progress responsive.
- Predecoded sampled source banks before native offline graph construction. WAV
  and MP3 share the same bounded `OfflineAudioContext` render, and MP3 only
  encodes that PCM buffer; export never calls `Tone.setContext` or swaps the live
  context.
- Added exact missing-sample recovery: decode validation and durable persistence
  happen before an exact library/clip patch, guarded by project identity and
  revision so replacement projects cannot be mutated by late completions.
- Made sample preview genuinely audible, decode-gated, and project-atomic. Pad
  assignment creates a track-scoped resource routed into the native piece input,
  preserving its EQ, effects, sends, and meter; bounded master routing is used
  only when the owning route is unavailable or cannot connect, and decode
  failure returns to the named native kit. Recorded preview updates target the
  exact timeline clip while
  retaining the reusable library copy.

Primary files: `src/lib/storage/migrate.ts`, `src/lib/storage/db.ts`,
`src/lib/storage/missingSampleRecovery.ts`, `src/lib/audio/drumPadSamples.ts`,
`src/lib/audio/export.ts`, `src/components/SamplePreviewDialog.tsx`,
`src/components/MissingSamplesDialog.tsx`, `src/components/LeftBrowser.tsx`,
`src/App.tsx`, `src/components/Header.tsx`, `src/lib/export/download.ts`, and
`src/lib/audio/master-defaults.ts`.

## Sound, Preset, Pack, Extension, and Creative-Learning Expansion

The first expansion used existing offline synthesis engines. The factory phase
adds a pinned same-origin CC0 asset library while keeping all WAV files out of
the startup module graph and service-worker shell precache.

- Melodic preset count: **14 → 34**.
- Sound-pack count: **9 → 19**.
- New built-in melodic instrument extensions: **20** total across both phases, automatically registered from the new presets.
- Added presets: Neon Glass Keys, Tape Upright, Ronin Reese, Acid Circuit, Tactical 808, Koto Night, Nylon Ghost, Neon Air, Choir Shadow, Arcade Pulse, Silk Katana, Steel Kalimba, Crystal Shrine, and Shogun Brass Stab.
- Added packs: Tape Alley Sessions, Subzero Drill, Ronin Synthwave, and Temple Air.
- Added sampled presets: VCSL TX81Z Piano, Folk Harp, Vibraphone, Tanzanian Kalimba, Ocarina, and Tenor Sax Stabs.
- Added sampled packs: VCSL Neon Keys, Harp Temple, Midnight Vibes, Kalimba Circuit, Ocarina Horizon, and Tenor Alley. Their previews schedule both drums and pitched phrases against the audio clock.
- Added one expandable guide per sampled instrument: family, useful register, character, listening cue, and a concrete creative move.
- Added three Creative Practice lessons: motif variation/call-and-response, arrangement by timbre/register, and Scale Lock/Chord Mode as harmony training.
- Centralized full-recipe melodic preset and drum-kit application in the store so every browser/pad/world entry point applies and persists the same sound.
- Added catalog tests for uniqueness, safe ranges, local-only URLs, valid kit/preset references, 16-step grids, pitched preview phrases, and creative prompts.

Factory-content controls:

- 26 original PCM WAV zones, 25,236,041 bytes (24.07 MiB), from pinned VCSL commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`.
- Reproducible fetch script verifies every upstream Git blob before writing; the shipped manifest records source paths, blob IDs, byte sizes, and SHA-256 hashes.
- Factory integrity tests re-hash every asset, parse every RIFF/WAVE PCM header, validate the license, and prove every preset URL resolves to the manifest.
- Same-origin zones load only on preview/load/export; the global queue allows three concurrent decodes, de-duplicates in-flight URLs, and bounds reusable decoded PCM to 64 MiB.
- The service worker runtime-caches selected factory zones for offline reuse without eagerly downloading 24.07 MiB on installation.
- Sampled preview cancellation is generation-safe; Panic and engine disposal stop active preview tails.
- The shared native WAV/MP3 render chooses the nearest sampled root, applies playback-rate transposition and a bounded envelope, and falls back to the model only if no zone decodes.

Primary files: `src/lib/audio/sounds/factorySamples.ts`, `src/lib/audio/sounds/presets.ts`, `src/lib/audio/sounds/samples.ts`, `src/lib/audio/sounds/soundLibrary.ts`, `src/lib/audio/export.ts`, `src/lib/plugins/builtins.ts`, `src/components/PresetBrowser.tsx`, `src/components/SoundLibraryPanel.tsx`, `src/components/LessonsPanel.tsx`, `public/samples/factory/vcsl/*`, `public/sw.js`, and `scripts/fetch-vcsl-factory-samples.mjs`.

## Guided Creation, Responsive Hierarchy, and Accessibility Follow-up

- Added a lazy Creative Compass that analyzes four understandable arrangement
  foundations: Pulse, Home, Weight, and Contrast. It recommends one next move
  without scoring or judging the user's music.
- Added deterministic motif, chord, pulse, and groove recipes plus answer,
  octave-lift/half-time, and pocket variations. Every result is an ordinary,
  editable two-bar clip appended after existing material.
- Added one-click scoped undo for the latest Compass result. It removes only
  the generated clip and never rewinds unrelated user edits.
- Extended an enabled loop just enough to include each generated Compass or
  pack clip, then conditionally restored the prior loop end on Undo so the new
  idea is audible without replacing the user's arrangement.
- Added a pure Sound Pack preview-to-sketch converter. It mirrors preview
  timing, preserves tempo, applies kit/preset data, appends clips in one project
  patch, and offers **Undo Sketch** without auto-playing audio. Undo survives
  lazy browser-tab unmounts, removes only exact generated track/clip pairs,
  and restores prior sound/project metadata only when later edits have not
  superseded those generated values.
- Reconciled already-realized melodic voices and updated the persistent native
  kit selector after a pack sketch so Pack B cannot continue playing Pack A; an
  audio-enabled Play/Panic regression covers the live engine path.
- Reapplied merged preset sound parameters to realized voices and to preset
  rebuilds, so Undo restores both the persisted track and its audible ADSR,
  filter, glide, and send state.
- Corrected Scale Lock's octave-boundary quantization by comparing absolute
  neighboring MIDI candidates instead of reconstructing a circular pitch-class
  winner in the wrong octave.
- Preserved major/minor pentatonic identity, added scale-length-aware chord
  progressions and true root/fifth pulses, corrected root-relative answer
  resolution for upper roots, and rejected empty variation sources.
- Replaced the overflowing command row with compact Project, Load, Export,
  Learn, and More controls. Production measurements show no header overflow at
  600, 768, 1,024, 1,366, or 1,440 pixels.
- Added the same Creative Compass, Lessons, and Glossary access to mobile, with
  a persistent bottom **Create** action. The Compass has a bounded, scrollable
  320/390-pixel layout.
- Kept eligible PWA Install/Add-to-Home-Screen actions reachable inside the
  desktop More menu and phone menu without expanding the compact header.
- Made Beginner view the default only when no stored preference exists. Existing
  users keep their chosen UI mode and every expert control remains available.
- Prevented returning-user Help from reopening mode selection and replacing the
  active project with a demo.
- Added keyboard-correct browser tabs, live status/error announcements, a
  high-contrast brand-red text token, and reduced-motion suppression for lesson
  highlighting.

Primary files: `src/components/CreativeCompassPanel.tsx`,
`src/lib/creative/creativeCompass.ts`, `src/lib/creative/packSketch.ts`,
`src/components/Header.tsx`, `src/components/MobileStudio.tsx`,
`src/components/SoundLibraryPanel.tsx`, `src/components/HelpDialog.tsx`,
`src/components/LeftBrowser.tsx`, `src/components/StatusToast.tsx`,
`src/lib/performance/scaleUtils.ts`, `src/lib/settings.ts`, and `src/index.css`.

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

| Check                                                       | Result                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Frozen pnpm install                                         | Pass                                                                                |
| Root workspace typecheck                                    | Pass across four packages                                                           |
| Studio production + SSR/prerender build                     | Pass                                                                                |
| Focused unit tests                                          | 52/52 pass                                                                          |
| Select-value static guard                                   | Pass                                                                                |
| Bundle budgets                                              | Pass                                                                                |
| Playwright browser acceptance                               | 56 discovered; 55 pass plus 1 intentional default-worklet skip; exit reporter 56/56 |
| Opt-in real AudioWorklet audibility                         | 1/1 pass                                                                            |
| Production dependency audit                                 | No known vulnerabilities                                                            |
| Current exact-source production runtime matrix              | Pass; 618,582 ms with zero console/page errors                                       |
| Current exact-source ten-minute playback/Panic/cleanup gate | Pass; 5,997 ticks, 123.1 ms max gap, 0 ms silence, zero active sources/events        |
| Diff whitespace validation                                  | Pass before documentation update; rerun at handoff                                  |
| Factory sample integrity                                    | 26/26 hashes and PCM headers pass; license/manifest/preset links pass               |
| Factory browser path                                        | 4/4 zones, max 3 concurrent, guide/preview/load and sampled WAV pass                |

## Required Manual Checklist Status

| Acceptance item                                          | Status                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| App load, no console/page errors                         | Automated pass                                                          |
| Enable Audio, spacebar play/pause, Stop, Panic           | Automated pass                                                          |
| Demo load and short-path playback/replay                 | Automated browser pass                                                  |
| Ten-minute playback on current exact source              | Automated production-preview pass                                      |
| Mixer/visualizer during playback                         | Automated pass                                                          |
| Normal and large sample import responsiveness            | Automated pass                                                          |
| Project save/load and unchanged autosave behavior        | Automated pass                                                          |
| JSON export/import                                       | Automated pass                                                          |
| WAV export                                               | Automated pass for default/demo projects and a sampled tenor-sax preset |
| Repeated preset and project replacement cleanup          | Automated pass                                                          |
| Performance Mode reduction                               | Automated pass                                                          |
| Service-worker update/cache path                         | Automated production-preview pass                                       |
| Audible sound-quality review                             | Human check required                                                    |
| Real microphone and MIDI device                          | Hardware check required                                                 |
| Safari/iOS, Android, low-memory hardware                 | Device check required                                                   |
| Factory instrument request/decode/export path            | Automated pass                                                          |
| Very long/dense sampled export                           | Remaining product/performance work                                      |
| Audible continuity through rapid kit/preset/pack changes | Automated signal/continuity pass; human listening check still required  |

## Rollback Notes

- Project schema changes are additive for current data, but future-version imports intentionally fail closed.
- Schema v6 adds `padSamples`; rollback to a schema-v5 reader would ignore that
  custom-pad state even though the original library/clip data remains intact.
- Remote WAM loading can only be restored after an isolated host exists; reverting to page-origin dynamic import would reintroduce the security issue.
- The audio scheduling ownership change should be reverted as a unit with its `TransportProvider` wiring, not piecemeal.
- Melodic build-before-swap, the persistent native kit selector, Panic
  generations, and project-revision fences form one continuity contract;
  reverting only one can restore the silent-after-sound-set race.
- New presets/packs are data additions using existing engines and can be removed without migrating saved projects; unknown preset IDs already fall back safely.
- Factory assets are additive static files. Remove their preset definitions and packs before deleting files; retained saved preset IDs will still fail safely to the normal model.
- Keep the service-worker factory-path exception and cache-budget changes together. Removing only one can either break offline reuse or accidentally broaden sample caching.

## The Dojo and Never Lose the Jam

- Evolved Creative Compass into **The Dojo** without replacing its lazy chunk,
  pure recipe engine, editable clips, or scoped Undo contract.
- Added Teach, Surprise, and Quiet guidance levels. The local deterministic
  session reads the current project's foundations and changes its explanation,
  creative constraint, target, and recipe without mutating the arrangement.
- Added a bounded retrospective performance buffer at the successful live-audio
  trigger boundary. One-shot notes, held notes, chords, drums, MIDI, QWERTY,
  gamepad, and on-screen instruments converge there; scheduled transport events
  remain outside it.
- Formal note recording explicitly suspends retrospective capture, preventing a
  normal recorded take from appearing twice.
- Added 15/30/60/120-second recovery windows, natural or light 1/16 timing,
  compatible destination-track selection, exact-event consumption, explicit
  discard, and restoration of claimed events when the recovered clip is undone.
- Stored only bounded event metadata in local browser storage, with debounced
  writes and page-hide flushing. No audio Blob, project export, network request,
  account, or telemetry path was added.
- Removed Tone Transport look-ahead from direct drum and custom-pad gestures;
  live hits now use the audio context's immediate time, while scheduled events
  retain their explicit timestamp. Lean automation ramps use the same immediate
  clock so a mute lane and a human hit cannot cross by 100 ms.

Primary files: `src/lib/creative/dojo.ts`,
`src/lib/performance/jamCapture.ts`, `src/lib/audio/engine.ts`,
`src/lib/audio/recorder.ts`, `src/components/CreativeCompassPanel.tsx`,
`src/components/Header.tsx`, `src/components/MobileStudio.tsx`, and
`scripts/dojo-and-jam-capture.test.ts`.
