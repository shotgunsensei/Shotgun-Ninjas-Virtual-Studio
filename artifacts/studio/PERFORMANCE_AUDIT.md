# Performance Audit — Shotgun Ninjas Virtual Studio

Audit date: 2026-08-30

## Executive Conclusion

The repository-wide review confirmed systemic problems rather than a single slow component: transport ownership was duplicated, first playback was incomplete, audio nodes and scheduled events survived replacement paths, heavy UI/export modules were loaded before use, persistence dropped newer state and sample metadata, and remote plugin loading crossed an unsafe trust boundary.

Those high-risk paths were repaired without a framework migration, UI redesign, paid feature, account requirement, or destructive project-format reset. The production app now passes its build, bundle budgets, dependency audit, unit/browser suites, all 19 profiler scenarios, and a dedicated ten-minute playback/cleanup gate.

## Architecture Reviewed

- React 19 UI and external project store.
- Tone.js/Web Audio engine, track graphs, master chain, drums, melodic voices, Chop Lab, preview/world audio, metronome, automation, and transport.
- IndexedDB projects, drafts, sample blobs, portable JSON, MIDI, MusicXML, WAV/MP3/stems/DAW pack exports.
- Vite routes/chunks, prerendered landing page, service worker, PWA update path, performance diagnostics, and browser acceptance tests.
- Plugin registry, built-in extensions, remote WAM boundary, dependencies, workspace/package-manager policy, and Windows install behavior.

## Confirmed Root Causes and Disposition

| Root cause | Impact | Disposition |
| --- | --- | --- |
| Desktop, mobile, and app shells each invoked `useTransport()` | Duplicate Tone schedules and lifecycle races | One shared `TransportProvider` owns scheduling and state synchronization |
| First click built schedules before every voice/audio clip was ready | Drums could play while melodic/audio clips were absent | Full project schedule preparation now precedes transport start with bounded readiness waits |
| Schedule fingerprint ignored relevant note edits and was costly | Stale playback or needless schedule work | Relevant edits increment a schedule revision; serialized preparation is generation-safe |
| Live pads/keys depended on a transport-created voice | Silent live input before playback | Live triggering realizes the requested voice first |
| Failed audio unlock latched the engine as unlocked | Later user gestures could not recover | Unlock state is set only after `Tone.start()` succeeds and can retry safely |
| Project replacement left voices, Chop, automation, master nodes, and events behind | Memory/CPU growth and stacked playback | Replacement, Stop/Panic, and dispose paths now clear all owned resources |
| Drum one-shots and async sample swaps had stale-completion/leak paths | Accumulating sources and wrong instrument swaps | Sources are capped/disconnected; async generations reject and dispose stale loads |
| Chop/world/preview audio bypassed master/Panic | Uncontrolled routing and audio surviving Panic | All three paths route through master ownership and honor Panic/disposal |
| Landing and Studio eagerly imported the DAW, Tone, exporters, instruments, panels, and closed dialogs | Slow initial load and unnecessary parse/mount work | Route, vendor, panel, dialog, encoder, and editor code is split and loaded on demand |
| Service worker eagerly cached lazy chunks | First visit paid for optional functionality | Only the shell is precached; lazy assets use versioned runtime caching |
| Export eagerly loaded Tone and MP3 support and retained avoidable buffers | Startup and export memory pressure | Export is dynamically loaded; encoder buffers are reused with cooperative yields |
| Storage migration omitted sound-pack, performance, and Chop Lab state and accepted future versions | Data loss and unsafe downgrade | Schema v5 preserves current state and rejects invalid/future schemas fail-closed |
| Project-only/portable JSON and IndexedDB clip storage lost metadata or blobs | Nonportable projects and silent sample loss | All audio blob classes/metadata are preserved or explicitly reported as missing |
| Autosave could overlap and rewrite unchanged content | IndexedDB load and freeze risk | Saves serialize; unchanged blob writes are skipped; lifecycle draft flush is guarded |
| Sample loading performed probe plus download and Chop marker drags rebuilt audio continuously | Extra network/decode and editor jank | One fetch/decode path; drag previews locally and commits once on release |
| Arbitrary page-origin dynamic import was labeled remote WAM support | Code-execution trust violation without a working WAM host | Remote WAM loading is fail-closed until a sandboxed/validated host exists |
| MIDI text/ranges/overlap ordering were under-validated | Corrupt or ambiguous MIDI output | UTF-8/VLQ names, clamping, sanitization, overlap normalization, and deterministic ordering added |
| Production tree contained four known transitive Express advisories | Supply-chain exposure | Exact compatible overrides resolve them; production audit reports zero known vulnerabilities |

## Performance and Load Findings

- The initial 605.11 kB gzip monolith is replaced by a 72.79 kB gzip landing startup and a 331.00 kB gzip Studio startup.
- The core Studio app chunk is 192.61 kB gzip; Vite still reports its raw 655.58 kB size as an advisory.
- Default public source maps were removed; a diagnostic opt-in remains.
- Bundle budgets enforce route payloads, CSS, lazy-chunk size, no public maps, and no eager service-worker caching of Tone/Studio/export chunks.
- First-play maximum long task improved from 421 ms to 326 ms in the exact final matrix. Heap delta remained variable: +22.64 MB in the exact final sample and +16.44 MB in an earlier post-fix sample versus +19.43 MB initially.
- The dedicated 616.9-second gate had no page/console errors and no owned scheduled sources or transport events remaining after Stop/Panic.

Cold-load wall time varied materially across runs (234 ms before; 678, 916, and 1,269 ms in post-fix Chromium samples) even as the deterministic transfer/parse payload fell 45.3%. Startup timing therefore remains an explicit field-validation risk rather than a claimed runtime win.

## Security and Product Boundary

- The Studio remains free forever: no billing, account, paywall, ads, upgrade prompt, or artificial limit was added.
- No secret, private endpoint, or user project content is sent to an analytics service.
- Remote executable plugin code is disabled rather than pretending to be safely supported.
- User projects retain forward-version protection, explicit import errors, and portable-blob reporting.
- The expanded sounds are locally synthesized/procedural and do not add unlicensed third-party assets or runtime downloads.

## Remaining Risks

1. Very long/dense offline renders and full-buffer sample edits can still pressure the main thread and memory. Browser `OfflineAudioContext` and decode APIs limit how far this can be removed without a worker/streaming architecture.
2. Cold-load wall time is noisy and was slower in final headless samples despite the substantially smaller bundle. Test real devices and collect privacy-safe field timings before setting a public SLA.
3. Dense active projects still create sophisticated Tone graphs. Muted/inactive-track graph virtualization could save more CPU but is a higher-risk audio-behavior change.
4. Automation/modulation work remains frequent when lanes are active. It should be profiled on large real projects before lowering its control rate.
5. Remote WAM extensions are intentionally unavailable. Safe support requires an isolated host, capability validation, explicit user consent, and lifecycle/CPU limits.
6. No licensed multisample library is bundled. The 28 presets and 13 packs use existing synthesis/local assets; adding recorded instruments requires asset licensing, size budgets, and offline caching design.
7. Headless Chromium cannot prove audible fidelity, microphone/MIDI hardware behavior, Safari/iOS compatibility, or low-end mobile thermals.
8. The repository has no lint script. TypeScript, focused static guards, unit tests, browser tests, and runtime profiling cover this pass, but lint policy remains absent.

## Release Assessment

Source/local stabilization gate: **pass**.

Public deployment acceptance: **not proven by this work**. It still requires an actual deploy plus human listening, device/browser checks, and live service-worker/update verification on the deployed origin.
