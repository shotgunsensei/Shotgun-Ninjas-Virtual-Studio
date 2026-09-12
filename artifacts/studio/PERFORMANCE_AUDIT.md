# Performance Audit — Shotgun Ninjas Virtual Studio

## 2026-09-12 — Basic/Advanced workflow and optional tutor

Requested scope: simplify the complete music-making workflow for children,
teens, and new DAW users while retaining the full Advanced studio. This is an
explicit workflow extension to the stabilization-only default, with the
existing framework, branding, free-product policy, and audio engine preserved.

Confirmed friction: Beginner previously changed mostly channel-strip details;
the transport, browser, instrument inspector, and creation path stayed dense.
Welcome's five choices were musical templates rather than complexity levels.
Its static tour ended before hands-on practice. Lessons blocked interaction in
a modal, with descriptions that did not match available controls. Welcome
could replace existing work without the preservation helper used by Load.
Global Enter/Space intercepted native focused buttons. Basic's clip selection
for grid editing also exposed an invisible whole-clip Delete/Backspace target;
those destructive shortcuts now belong to Advanced. Phone tutor instructions
now match its available controls and offer Basic for editable grid practice.

Basic now mounts a lightweight workspace on the same project/store, with
rhythm → notes → arrangement → levels → save/download steps. Advanced retains
the existing workspace. The optional tutor is independently persisted,
nonmodal, and event-driven. Mode changes have no project patch, transport
reset, audio initialization, or autosave payload. Existing expert preferences
migrate to Advanced with the tutor initially off.

Basic note operations use current track/clip ownership and preserve off-grid
notes, samples, recordings, and unrelated state. Generated parts align in a
new section; repeat appends a captured source once per click to avoid
exponential growth. Copied automation timestamps are unique at boundaries.
Undo requires the applied project and load revision to remain current.

No tutor timer, worker, network request, audio node, transport event, or
animation was added. Basic does not mount Advanced instrument/mixer/scope
components. Existing performance/audio lifecycles remain authoritative.

Test-environment findings: the repository requires pnpm; sandboxed tsx cannot
read Windows user information; cached Chromium did not launch, while installed
Google Chrome did. A factory-license hash failure was CRLF conversion on a
clean checkout, repaired with an exact-path LF attribute without changing the
license or manifest. Development watching also encountered Windows `EBUSY` on
a generated WAV; output/report directories are now ignored. Empty `REPL_ID`
no longer enables Replit-only dev plugins. Tests that require Advanced choose
it explicitly, and startup setup no longer deletes a live IndexedDB database
before a second navigation. After isolated checks and a fresh server without
concurrent source edits, the full browser suite passes (82 passed, three
expected opt-in skips). Production workflow and ten-minute playback checks
also pass. PERF_BASELINE.md records the acceptance boundary, including hardware
and learner testing still needed. This change makes no claim of reduced
measured audio latency.

## 2026-09-12 — Custom instruments and expanded factory sounds

Confirmed gaps: imported sounds could become audio clips or drum-pad assignments
but could not act as a pitched melodic source. Seven factory sampled instruments
were available. Existing preset replacement and native export assumed factory
selectors, and storage needed explicit source ownership across JSON imports and
Save As. The expanded Steinway set also uses a different source-filename octave
convention; measured-pitch tests established its correct C1–C6 roots.

The custom instrument now uses a single native AudioBuffer and disposable note
sources with `2 ** ((midi - rootNote) / 12)` playback rate. Source decoding has
bounded concurrency and stale-owner checks. Notes use the existing track
filter/mixer/effect graph. No audio node is constructed in a React render body;
the selected panel prepares its source after audio unlock and receives readiness
events, with no animation or note-rate React state loop added.

Replacing a sample, choosing a preset/legacy sound/pack, removing a track, or
replacing the project relinquishes the previous voice. Pack Undo tracks custom
source ownership and leaves later user changes intact. Missing/corrupt custom
sources remain silent with actionable status; WAV/MP3 and DAW-pack readmes report
omissions. Schema v7 validates roots, preserves sample blobs via the existing
storage path, remaps references, and creates recoverable missing-source entries.

Remaining limits: custom source pitch is set manually; resampling changes both
pitch and duration. Recordings end naturally, with no sustain loop or independent
time stretching. Factory instruments use sparse single-velocity zones, so remote
registers change timbre; the pipe organ sustain is finite. The complete asset set
is 101.38 MiB, though startup fetches none of these WAVs. Polyphony and decoding
are bounded, but many active tracks can retain substantial PCM outside caches.

Validation and current checklist: see PERFORMANCE_FIXES.md and PERF_BASELINE.md.

## 2026-09-12 — Sound-quality findings and corrections

These are the current findings; the August sections below retain their original
measurements and are not new September verification claims.

| Confirmed cause | Audible consequence | Correction and evidence |
| --- | --- | --- |
| VCSL source octave labels were passed directly to Tone | Existing factory instruments sounded one octave above the displayed notes | Convert C3-middle-C source labels to Tone C4-middle-C roots; spectral tests cover all seven families and a full Grand Piano WAV |
| Grand Piano had only an FM approximation | No recorded hammer/string decay | Six hash-pinned CC0 Kawai zones, same-origin lazy load, synthesis fallback preserved |
| Safe pluck wrapper used one triangle waveform and ignored dampening/resonance | Similar generic plucks, limited attack detail | Band-limited harmonic excitation, decaying low-pass envelope, velocity-sensitive brightness; real Tone offline render tested |
| Sampler controls received a synth-only envelope object | Attack/release edits did not control sampled voices correctly | Set Sampler attack/release directly and apply the same values in native export |
| Native melodic export chose one oscillator by track kind | Preset identity disappeared in WAV/MP3 | Render the selected recipe's harmonic family and ADSR; full export test distinguishes sub and bell on the same track kind |
| Live/export reverb and delay implementations/settings differed | Different spaces, levels, and repeat rhythm after bouncing | Shared stereo-impulse rooms/halls and filtered feedback delays; matching 375 ms dotted-eighth and 110 ms slap timing at 120 BPM |
| Sampled native export used 0.8 gain while live sampler used -8 dB | Unexpectedly louder sampled bounce | Native sample voice gain matches -8 dB, before existing track/master processing |
| Track drive did not oversample | Additional nonlinear aliasing risk | 2x drive oversampling; still allocated only when the existing rack needs it |

Architecture boundaries remain intact: no second live context, no additional
transport loop, no project-schema change, no new package or paid service.
The two impulse buffers are cached per context, feedback is bounded/filtered,
and master disposal disconnects every owned native effect node. Effect-tail
generation uses direct PCM, not a nested offline renderer or worklet graph.

Tradeoffs: stereo convolution and 2x drive use DSP time; there is no claim of
reduced CPU on every device. The sample library grows from 24.07 to 41.86 MiB
on demand. Sparse single-velocity zones are not a multi-gigabyte velocity/
round-robin piano. Synth fallback, sample repitching, and native export remain
approximations of advanced Tone modulation, glide, chorus, and rack processing.
Three seconds of export tail improves normal releases but cannot capture every
possible long combined release/feedback chain.

Compatibility: saved notes are unchanged. Correcting factory roots lowers
existing sampled playback by one octave to match the piano roll. To retain an
old intentionally high arrangement, duplicate the project and transpose those
notes up 12 semitones. Reverb character and bounced levels also intentionally
change; review old mixes before re-exporting.

Current checks and measurements are in `PERF_BASELINE.md`; the reproducible
commands and acceptance checklist are in `PERFORMANCE_FIXES.md`. A production
dependency scan also found two moderate transitive `qs` advisories in the
separate API server; patching that backend dependency remains separate work.

## Historical August audit

Audit date: 2026-08-30

## Executive Conclusion

The repository-wide review confirmed systemic problems rather than a single slow component: transport ownership was duplicated, first playback was incomplete, audio nodes and scheduled events survived replacement paths, heavy UI/export modules were loaded before use, persistence dropped newer state and sample metadata, and remote plugin loading crossed an unsafe trust boundary.

Those high-risk paths were repaired without a framework migration, paid feature,
account requirement, or destructive project-format reset. A second content phase
then added pinned CC0 sampled instruments and creative-learning value without
reintroducing startup or lifecycle pressure. The current audio-continuity pass
closes the remaining split ownership between store selection, async voice
construction, Panic, project replacement, recording, custom pad samples,
recovery, worklets, and offline export. The production app passes its build,
bundle budgets, dependency audit, expanded unit/browser suites, and the current
exact-source ten-minute production playback/Panic/cleanup gate. The profiler
now bounds protocol operations, retires a timed-out page safely, and measures
audio continuity separately from renderer responsiveness.

## Architecture Reviewed

- React 19 UI and external project store.
- Tone.js/Web Audio engine, track graphs, master chain, drums, melodic voices, Chop Lab, preview/world audio, metronome, automation, and transport.
- IndexedDB projects, drafts, sample blobs, portable JSON, MIDI, MusicXML, WAV/MP3/stems/DAW pack exports.
- Vite routes/chunks, prerendered landing page, service worker, PWA update path, performance diagnostics, and browser acceptance tests.
- Plugin registry, built-in extensions, remote WAM boundary, dependencies, workspace/package-manager policy, and Windows install behavior.
- Factory-content source/license integrity, same-origin delivery, bounded decoding, sampled preview/load/export, runtime caching, and creative-learning surfaces.

## Confirmed Root Causes and Disposition

| Root cause                                                                                                                                                   | Impact                                                                                                                                            | Disposition                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop, mobile, and app shells each invoked `useTransport()`                                                                                                | Duplicate Tone schedules and lifecycle races                                                                                                      | One shared `TransportProvider` owns scheduling and state synchronization                                                                                                                                                                                       |
| First click built schedules before every voice/audio clip was ready                                                                                          | Drums could play while melodic/audio clips were absent                                                                                            | Full project schedule preparation now precedes transport start with bounded readiness waits                                                                                                                                                                    |
| Schedule fingerprint ignored relevant note edits and was costly                                                                                              | Stale playback or needless schedule work                                                                                                          | Relevant edits increment a schedule revision; serialized preparation is generation-safe                                                                                                                                                                        |
| Live pads/keys depended on a transport-created voice                                                                                                         | Silent live input before playback                                                                                                                 | Live triggering realizes the requested voice first                                                                                                                                                                                                             |
| Failed audio unlock latched the engine as unlocked                                                                                                           | Later user gestures could not recover                                                                                                             | Unlock state is set only after `Tone.start()` succeeds and can retry safely                                                                                                                                                                                    |
| Sound-set selectors changed independently from async voice construction, and old voices could be disposed before replacements were ready                     | Loading a new kit, preset, or pack could leave the UI correct but the track silent or stale                                                       | Store selectors are authoritative; named kits update recipe/timbre data on one persistent native lean drum voice without rebuilding a Tone graph, while melodic replacements build before swap and reject stale completions                                      |
| Trigger callbacks captured replaced sampler instances and live input did not recover a suspended context                                                     | Playback or pads could address a dead voice after a sound-set change or browser suspension                                                        | Trigger-time resolution uses the current registered voice, and each live note/drum/preview path performs bounded context recovery                                                                                                                              |
| Panic and replacement boundaries did not cancel every pending async owner                                                                                    | Delayed sample loads, microphone permission, record stops, Chop buffers, or previews could revive audio after a boundary                          | Silence generations plus explicit cleanup and identity guards for recorder, preview, Chop, custom-pad, and sampled-voice owners make cancellation synchronous and ownership-scoped                                                                              |
| Tone wrapper nodes, native Web Audio nodes, and worklet modules were connected/registered through incompatible abstractions                                  | A valid worklet or lean drum path could construct but fail to reach the master output                                                             | Compatible connect/disconnect helpers unwrap native leaves; worklets register on the actual native context; the proven Tone/native master chain remains the default and worklet voices retain fallback                                                         |
| Tone's default standardized context recursively scanned the downstream graph for cycles on each live voice connection                                      | In-play melodic pack changes could monopolize the main thread for seconds while the audio thread continued, making the app appear frozen or silent | Tone is installed on one browser-owned interactive `AudioContext` before graph construction; a browser regression proves the global Tone graph and transient sources are native, and CPU profiling no longer shows recursive cycle traversal                  |
| Project replacement left voices, Chop, automation, master nodes, and events behind                                                                           | Memory/CPU growth and stacked playback                                                                                                            | Replacement, Stop/Panic, and dispose paths now clear all owned resources                                                                                                                                                                                       |
| Native drum one-shots and asynchronous sampled-instrument/custom-pad resources had stale-completion or leak paths                                            | Accumulating sources, stale routes, and wrong instrument swaps                                                                                    | One-shots are capped/disconnected; sampled replacements reject stale generations, and track-owned pad resources dispose or reroute when their owning graph changes                                                                                              |
| Every dense sequenced drum hit reapplied unchanged gain, pan, cutoff, and resonance                                                                          | Redundant native AudioParam work ran inside the real-time scheduling path                                                                         | A lifecycle-safe primitive settings cache performs one apply per actual output change; 256 unchanged hits remain at one apply                                                                                                                                  |
| Chop/world/preview audio bypassed master/Panic                                                                                                               | Uncontrolled routing and audio surviving Panic                                                                                                    | All three paths route through master ownership and honor Panic/disposal                                                                                                                                                                                        |
| Landing and Studio eagerly imported the DAW, Tone, exporters, instruments, panels, and closed dialogs                                                        | Slow initial load and unnecessary parse/mount work                                                                                                | Route, vendor, panel, dialog, encoder, and editor code is split and loaded on demand                                                                                                                                                                           |
| Service worker eagerly cached lazy chunks                                                                                                                    | First visit paid for optional functionality                                                                                                       | Only the shell is precached; lazy assets use versioned runtime caching                                                                                                                                                                                         |
| Export and MP3 encoding were eagerly loaded and retained avoidable buffers                                                                                   | Startup and export memory pressure                                                                                                                | The native exporter is dynamically loaded; MP3 encoder buffers are reused with cooperative yields                                                                                                                                                              |
| Storage migration omitted sound-pack, performance, Chop Lab, and later custom pad ownership while accepting future versions                                  | Data loss and unsafe downgrade                                                                                                                    | Schema v6 preserves current state plus `padSamples`, migrates schema-v5 data additively, and rejects invalid/future schemas fail-closed                                                                                                                        |
| Project-only/portable JSON and IndexedDB clip storage lost metadata or blobs                                                                                 | Nonportable projects and silent sample loss                                                                                                       | All audio blob classes/metadata are preserved or explicitly reported as missing                                                                                                                                                                                |
| Blob fingerprints were awaited inside IndexedDB transactions and each save started before prior writes fully settled                                         | Transactions could expire, saves could reorder, and project/sample ownership could split                                                          | Fingerprints complete before transactions; save, draft, duplicate, relocate, and import writes share one rejection-safe FIFO; copied projects re-key every sample, clip, Chop, and pad reference                                                               |
| Settings wrote a millisecond autosave field while runtime read a separate seconds field                                                                      | The visible toggle/cadence did not control either save path                                                                                       | One enabled flag and bounded 15/30/60-second cadence now govern durable saves and recovery drafts; legacy values migrate safely                                                                                                                                |
| Sample loading performed probe plus download and Chop marker drags rebuilt audio continuously                                                                | Extra network/decode and editor jank                                                                                                              | One fetch/decode path; drag previews locally and commits once on release                                                                                                                                                                                       |
| Sample preview used visual-only state, mutated projects before durable save without an exact rollback fence, and pad assignment had no persisted voice owner | Preview could appear valid but remain inaudible, replacement projects could be mutated by a late save, and assigned pads could fall back silently | Native audible preview, decode gating, project-revision fences, exact rollback, and schema-v6 track-scoped pad resources now cover the full path; ready pads feed the owning native piece input and decode failure falls back to that kit                           |
| Missing-sample recovery matched broad library entries rather than exact clip owners and could patch state before validation/persistence                      | Relinking one file could hydrate the wrong clip or corrupt a replacement project                                                                  | Recovery decode-checks first, persists durably, then patches exact library/clip keys only if the project/revision still matches; unresolved placeholders remain visible                                                                                        |
| Recorder stop/permission completion relied on current UI selection rather than the recorder that actually began the take                                     | Rapid stop, project replacement, or permission completion could commit twice or attach audio to the wrong track                                   | Note and vocal recorders retain explicit owners/generations; stop is coalesced/idempotent, pending permission is cancellable, and the preview update targets the exact recorded clip                                                                           |
| MP3 used a separate Tone offline-graph path from WAV                                                                                                         | Duplicate render ownership risked timbre drift and live-context contamination                                                                     | WAV and MP3 now share one bounded native `OfflineAudioContext` render; MP3 only encodes its PCM result and never swaps the live/process-wide Tone context                                                                                                        |
| Arbitrary page-origin dynamic import was labeled remote WAM support                                                                                          | Code-execution trust violation without a working WAM host                                                                                         | Remote WAM loading is fail-closed until a sandboxed/validated host exists                                                                                                                                                                                      |
| MIDI text/ranges/overlap ordering were under-validated                                                                                                       | Corrupt or ambiguous MIDI output                                                                                                                  | UTF-8/VLQ names, clamping, sanitization, overlap normalization, and deterministic ordering added                                                                                                                                                               |
| Production tree contained four known transitive Express advisories                                                                                           | Supply-chain exposure                                                                                                                             | Exact compatible overrides resolve them; production audit reports zero known vulnerabilities                                                                                                                                                                   |
| Unbounded parallel sample decoding and no decoded-buffer ownership limit                                                                                     | Selection/export bursts could spike CPU and memory                                                                                                | Global concurrency is capped at 3, in-flight work is de-duplicated, and the decoded LRU is capped at 64 MiB                                                                                                                                                    |
| The native export renderer approximated every melodic preset                                                                                                | Sampled instruments would sound different after bounce                                                                                            | The shared WAV/MP3 native render decodes sample zones first, then selects and repitches the nearest roots through native buffer sources                                                                                                                         |
| Preset catalog exposed names but little musical context                                                                                                      | More content would not necessarily improve user creativity                                                                                        | Six instrument guides, six pack prompts, and three creative-practice lessons teach timbre, register, motif, and harmony in context                                                                                                                             |
| Sound-pack previews discarded their authored rhythm, melody, and prompt after preview                                                                        | Users could hear an idea but could not edit or learn from it                                                                                      | A pure preview-to-clip converter appends a two-bar sketch in one project patch, preserves tempo/work, and provides session-safe scoped undo                                                                                                                    |
| Pack sketches changed project selectors without reconciling realized voices; undo forgot prior sound and disappeared on tab changes                          | A new sketch could still play the previous kit, and Undo was incomplete                                                                           | Existing voices reconcile immediately/on preparation; bounded session state removes exact track/clip pairs and conditionally restores prior timbre/project metadata across tab unmounts                                                                        |
| Generated Compass/pack clips could begin outside the enabled loop                                                                                            | The UI told users to press Play but the transport could loop before the new idea                                                                  | Generation starts no earlier than the loop start, extends the loop through the new clip, and conservatively restores its prior end on Undo                                                                                                                     |
| The desktop header required roughly 1,427 px and clipped commands from 600 through 1,440 px                                                                  | Load, Export, learning, and settings controls became pointer-inaccessible                                                                         | Commands are grouped into compact Project, Learn, and More menus; measured header overflow is zero at five release widths                                                                                                                                      |
| Mobile omitted lessons/glossary and had no direct creative-learning action                                                                                   | Phone users received a reduced and harder-to-learn product                                                                                        | The bottom Create action and mobile menu expose Creative Compass, Lessons, Glossary, and existing command events                                                                                                                                               |
| Studio PWA installation was hidden below the 2xl breakpoint                                                                                                  | Tablet/phone users had to return to the landing page to install                                                                                   | Eligible install/Add-to-Home-Screen actions now live in More and the phone menu without increasing header width                                                                                                                                                |
| Returning-user Help could navigate back to mode selection and replace active work with a demo                                                                | A help refresher could silently destroy in-memory edits                                                                                           | Mode selection is now available only during first-run onboarding; normal Help is a non-destructive quick-start reference                                                                                                                                       |
| Scale Lock compared circular pitch classes but rebuilt the result in the input octave                                                                        | Boundary notes could jump almost an octave instead of moving one semitone                                                                         | Quantization compares absolute candidates in adjacent octaves with deterministic ties; 19,968 combinations are covered                                                                                                                                         |
| Creative variations rounded tonic resolution without subtracting the selected root and collapsed both pentatonic modes                                       | Upper roots could jump an octave and pentatonic guidance used wrong degrees                                                                       | Root-relative octave math, distinct major/minor pentatonic modes, five-degree progressions, true perfect-fifth pulses, and empty-source guards are covered across every root/scale                                                                             |
| Dense browser tabs and status feedback lacked complete keyboard/live-region semantics                                                                        | Discovery and assistive-technology feedback were weaker than the visible UI                                                                       | Browser tabs now use roving-focus tab semantics; status/error messages announce politely/assertively; reduced motion disables lesson pulsing                                                                                                                   |
| New/load/demo/import replacement could outrun the latest unsaved edit or erase the transient recovery draft                                                  | Recent work could depend on a best-effort lifecycle draft or be overwritten by a stale same-project read                                          | Normal projects are durably saved, transient demos retain a separate recovery draft through destination saves, World Picker uses the same guard, reads occur after preservation, failures abort replacement, and temporary-demo recovery requires confirmation |

## Performance and Load Findings

- The initial 605.11 kB gzip monolith is replaced by a 74.42 kB gzip landing startup and a 344.71 kB gzip Studio startup.
- The verified current route totals are 231.74 kB raw for landing and 1,201.03 kB raw for Studio; the audio-continuity coverage adds only bounded route code and preserves the lazy factory-audio contract.
- The Dojo and bounded jam-recovery panel remain lazy at 6.88 kB gzip; its pure musical recipes remain a separate 3.79 kB gzip chunk.
- Default public source maps were removed; a diagnostic opt-in remains.
- Bundle budgets enforce route payloads, CSS, lazy-chunk size, no public maps, and no eager service-worker caching of Tone/Studio/export chunks.
- The current deterministic gate passes root typecheck across four packages,
  52/52 unit tests, 56/56 resolved browser outcomes (55 pass plus one intentional
  default-worklet skip), a separate 1/1 opt-in real AudioWorklet test, production
  build/SSR/prerender, select-value and bundle guards, and a zero-vulnerability
  production audit.
- The exact-source `runtime-profile-1788144189876.json` gate passed in 618,582
  ms. During ten minutes of looped playback it changed three packs in
  355.8/309.6/326.4 ms, recorded 5,997 continuity ticks with a 123.1 ms maximum
  gap and zero sustained silence, then reached zero active one-shots, players,
  worklets, and Transport events after Stop/Panic. Heap returned from 41.43 MiB
  at ten minutes to 16.05 MiB after idle garbage collection.

Cold-load wall time varied materially across runs (234 ms before; 678, 916,
1,269, 920, and 935 ms in post-fix Chromium samples) even as the deterministic
transfer/parse payload fell 44.7%. Startup timing therefore remains an
explicit field-validation risk rather than a claimed runtime win.

The 24.07 MiB factory audio library is deliberately outside these startup
figures. No WAV is in the shell precache or initial module graph. A selected
instrument fetches only its four or six same-origin zones, with runtime cache
reuse after first use. The production browser gate observed four successful
kalimba requests and no more than three simultaneous decode jobs.

## Security and Product Boundary

- The Studio remains free forever: no billing, account, paywall, ads, upgrade prompt, or artificial limit was added.
- No secret, private endpoint, or user project content is sent to an analytics service.
- Remote executable plugin code is disabled rather than pretending to be safely supported.
- User projects retain forward-version protection, explicit import errors, and portable-blob reporting.
- The Dojo and jam recovery are deterministic and browser-local. No project,
  performance, or guidance data is uploaded, and no account or remote model is
  required.
- Recorded factory content is pinned to VCSL commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`, ships with the CC0 license and exact source/hash manifest, and never fetches a third-party origin at runtime.

## Remaining Risks

1. Very long/dense offline renders and full-buffer sample edits can still pressure the main thread and memory. Browser `OfflineAudioContext` and decode APIs limit how far this can be removed without a worker/streaming architecture.
2. Cold-load wall time was noisy in historical headless samples despite the substantially smaller bundle. Test real devices and collect privacy-safe field timings before setting a public SLA.
3. Dense active melodic and vocal projects can still create sophisticated Tone graphs; named drum kits use one persistent native graph. Muted/inactive-track graph virtualization could save more CPU but is a higher-risk audio-behavior change.
4. Automation/modulation work remains frequent when lanes are active. It should be profiled on large real projects before lowering its control rate.
5. Remote WAM extensions are intentionally unavailable. Safe support requires an isolated host, capability validation, explicit user consent, and lifecycle/CPU limits.
6. Factory audio increases the deployed static artifact by 24.07 MiB even though startup remains lazy. The hosting/provider upload limit and live cache headers still require deployment verification.
7. The 64 MiB cache bounds reusable decoded buffers, not buffers still referenced by actively loaded track samplers. A project intentionally loading many distinct sampled instruments can exceed that amount while those tracks remain active.
8. Headless Chromium proves sample requests, decode routing, preview state, and WAV structure, but cannot judge musical fidelity, real microphone/MIDI hardware behavior, Safari/iOS compatibility, or low-end mobile thermals.
9. The repository has no lint script. TypeScript, focused static guards, unit tests, and browser tests cover this pass, but lint policy remains absent.
10. Retrospective note capture intentionally excludes vocals/audio and formal
   recording takes. It recovers played MIDI-style note events, not microphone
   audio, and is bounded rather than an unlimited session archive.

## Release Assessment

Source/local build, type, unit, browser, bundle, select, dependency, and
exact-source sustained-performance gates: **pass**.

Public deployment acceptance: **not proven by this work**. It still requires an actual deploy plus human listening, device/browser checks, and live service-worker/update verification on the deployed origin.
