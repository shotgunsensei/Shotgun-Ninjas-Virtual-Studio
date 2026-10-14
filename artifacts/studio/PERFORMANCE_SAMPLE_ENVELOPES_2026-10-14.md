# Custom-sample envelope and lifecycle evidence — 2026-10-14

## Scope and source

**Implementation verified; deployment unverified.** Final local release
verification passed, including the opt-in ten-minute production playback gate.
The separate dependency audit still reports existing API-server advisories.
No push, merge or production publication was performed.

This is a targeted repair to the existing DAW at `artifacts/studio`, entered
through `src/router.tsx` at `/studio`. It does not replace the app. The baseline
is main commit `aea28a76f6849acc10a0508239ea8531d7287ff0`; the original checkout
was clean and remains unchanged. Work uses the isolated branch
`codex/studio-audio-stability-20261014`.
The implementation checkpoint is `6f4f034ebc6676fd10a58aa04719caec72793d4f`;
recorded source and lockfile hashes remained unchanged through final testing.

Repository `AGENTS.md`, `.agents/memory`, and the relevant local Codex Studio
memory summary were inspected. No OperatorOS integration files, lockfiles,
dependencies, provider settings, stored projects, schemas, or production data
were changed. Test recordings are generated in memory; no new licensed assets
or services are involved.

## Confirmed defects and repair

- A custom recording could end while its live gain remained nonzero. Pitching
  it up made that endpoint arrive sooner than the note gate.
- A future `triggerAttackRelease` gate set a Boolean `releasing` flag immediately,
  causing an earlier note-off to be ignored. This retained unwanted audio and
  its source until the original scheduled end.
- Native custom-instrument WAV export also let the recording finish before the
  release ramp. Canceling an attack exactly at its endpoint could remove the
  incoming ramp when a value event replaced it.

The shared `sampleEnvelope.ts` schedules a short fade at the actual transposed
sample endpoint while retaining the requested attack slope: a short recording
does not get boosted to full velocity when its attack would outlast it.
Earlier key-ups restore the partial attack/fade and shorten
the gate. Later key-ups cannot raise a tail, extend its source, or cancel a
same-pitch note that has not started. Native stop calls are issued again only
when the source endpoint becomes earlier. The existing 32-voice cap and
immediate Stop/Panic/disposal semantics remain intact.

This adds no audio node, interval, worker, animation loop, or high-frequency
React update. The optional `BaseAudioContext` constructor argument lets the
actual voice run in an `OfflineAudioContext`; production callers retain the
same native real-time context.

## Offline measurements

Chromium renders use a synthetic recording with a deliberately nonzero boundary.
The original voice was copied into temporary probe files with only the same
offline-context injection seam, then those files were removed. Its original
DSP reproduced both failures. The real patched voice is tested directly, with
the final matrix covering 44.1/48 kHz, A2/A3/A4, and 40/400 ms attacks. The
20 ms signal level is checked against the requested attack, as well as the
recording endpoint, so a smoothing change cannot silently increase gain.

| Measurement | Baseline | Patched |
| --- | ---: | ---: |
| Largest adjacent-sample step, 44.1 kHz, A2/A3/A4 | 0.1166365 | 0.0005290 |
| Largest adjacent-sample step, 48 kHz, A2/A3/A4 | 0.1166365 | 0.0004861 |
| Peak during the unwanted early-release interval, 60–300 ms | 0.1166365 | 0 |
| Later same-pitch note peak | 0.1166365 | 0.1166365 |
| Scheduled source endpoint in the early-release fixture | 720 ms | 45 ms |
| Sources retained after render and disposal, 4,096 retriggers | 0 | 0 |
| Maximum concurrent tracked voices | 32 | 32 |

The 44.1 kHz boundary discontinuity is reduced by about 99.5% in this fixture.
The early-off fixture schedules its source to end 675 ms sooner. This is not a claim
that every musical sample, instrument, or device improves by those amounts.

The WAV test uses a 233 Hz synthetic carrier so the existing export high-pass
filter does not erase the signal being tested. It checks the entire bounce,
including the delayed endpoint, for adjacent-sample discontinuities, useful
output level, and a silent final tail. Live and bounced audio share the custom
envelope; the export mixer and compressor chain are not sample-identical to
the direct voice test.

Renderer task time and JavaScript heap are collected through Chromium CDP
after module warm-up and explicit GC. They exclude native PCM/graph memory
and audio-thread DSP utilization. Single local runs are not a controlled CPU
benchmark. Headless AudioContext reports observed during development were
10 ms base latency and 40–48 ms output latency; these are browser reports,
not a microphone/loopback or physical-device latency measurement.

## Verification

Local environment: Windows, Node 24.16.0, Corepack pnpm 11.25.0 and Chromium
through Playwright 1.60.0. A task-local `pnpm.cmd` wrapper was needed because
only Corepack was exposed on PATH. No global toolchain change was made.

| Gate | Result |
| --- | --- |
| Frozen-lockfile install | Pass; lockfile unchanged |
| Workspace type checks and all package production builds | Pass, including studio client, SSR and prerender |
| Unit tests | 73 passed |
| Reporter lifecycle regressions | 7 passed, 1 Windows SIGINT skip in the complete gate; an earlier standalone run failed its teardown assertion |
| Select-value and built bundle budgets | Pass |
| Final full development browser run | 89 passed, 5 intentional skips, no failures or retries out of 94 |
| Earlier dense-demo timing miss, isolated rerun | Pass, unchanged 750 ms assertion |
| Five new offline sample/WAV regressions | All passed within the full run |
| Built static workflows and ten-minute production playback | All 5 passed without retries, including direct local `/` and `/studio` loads/reloads |
| Final `pnpm verify:release` with `CI=true`, `STUDIO_LEARNING_SOAK=1` | Pass, exit 0: all release-script gates passed |
| Production dependency audit | Fail: 3 existing API-server transitive advisories |

An earlier complete run exited 1 after the dense-demo heartbeat recorded a
752.5 ms gap against its 750 ms limit. Its isolated rerun passed unchanged.
The final full development run, after the long-attack preservation check, also
passed that case on its first attempt. No timing threshold was relaxed. The
earlier host/run variation remains relevant when interpreting performance data.

The built production playback attachment records **600,792 ms**, **20**
responsiveness checks, and **zero page errors**. Every checkpoint advanced the
transport, switched Basic/Advanced, and opened/closed the mixer. Stop, replay
and Panic completed afterward. The production save/export/import/reload gate
created a 6,174,044-byte WAV (peak PCM16 22,356) and preserved its five-track
project through backup import and reload.

The current full-run custom-voice probe recorded:

| 4,096-note probe | Baseline | Patched full run |
| --- | ---: | ---: |
| Scheduling wall time | 365.4 ms | 244.4 ms |
| Renderer task time | 0.468539 s | 0.368643 s |
| Retained JS heap delta after explicit GC | 67,408 bytes | 67,516 bytes |
| Concurrent voices / after-render / after-dispose | 32 / 0 / 0 | 32 / 0 / 0 |

These single samples do not establish an overall CPU or memory improvement.
The measured efficiency repair is the earlier source
termination, with bounded cleanup preserved. The full-run WAV had peak 0.0482192,
maximum adjacent-sample step 0.0016175 and zero final tail. The context reported
48 kHz, 10 ms base latency and 48 ms output latency in headless Chromium.

The repository has no lint script; applicable formatting, select-value,
bundle-budget and whitespace checks are used instead. Production bundle budgets
passed at 75.20 kB gzip for landing initial JS and 353.77 kB gzip for studio
initial JS. Build-regenerated mockup registry output was restored in this
isolated worktree and is excluded from the patch.

## Current deployment and release boundary

- GitHub main's existing release workflow passed at the baseline commit. No
  GitHub deployment records identify a live build SHA.
- The source's `https://shotgunninjas.com/studio` URL returns the marketing
  application's 404 screen despite HTTP 200.
- The live site's Ninja DAW link resolves to `https://shotgunninjas.studio/`.
  Its landing page returns HTTP 200 and displays `4.5.0-instruments`.
- A direct request to `https://shotgunninjas.studio/studio?disableAudio=1`
  returned HTTP 404 with an empty body. Client-side Launch Studio navigation
  did load the editor header, tracks, Basic controls and Enable Audio prompt
  without page errors. The prompt was not pressed. This establishes editor UI
  availability through client navigation, not audio acceptance or healthy
  deep-link/reload hosting.
- `pnpm audit --prod` reports three existing API-server transitive advisories:
  critical `proxy-addr` GHSA-jqcg-44mw-7w3h; moderate `qs`
  GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g. No dependency changes were made
  in this audio slice.

The patch is prepared for a draft PR. Production publication is not performed.
Shared integration/release ownership remains coordinated separately. This work
used private headless browser processes and did not touch shared browser state
or OperatorOS files.

## Acceptance limits and remaining risks

PCM quality measurements used offline renders. The sustained production test
used the real-time browser engine in muted headless Chromium and checked UI/
transport responsiveness at roughly 30-second intervals; it did not capture
a continuous output waveform. No speaker playback, headphone/monitor listening,
microphone, or MIDI hardware acceptance occurred.
No new physical-device latency, total-process memory, or cross-browser claim
is made. Immediate Panic and voice stealing can still cut a voice abruptly;
they retain their bounded emergency/resource behavior.

The required manual checklist is represented by automated gates where noted:

| Acceptance area | Evidence boundary |
| --- | --- |
| App load, Enable Audio, keyboard transport, Stop, Panic | Passed in the final full browser suite |
| Demo load, mixer and mode switching | Passed browser regressions and production soak |
| Visualizer operation, hidden visual loops and reduced visual load | Not reprofiled in this slice; historical profiles are not new acceptance |
| Sample import, save/load, portable JSON and WAV export | Passed browser suite, production workflow and offline sample/WAV tests |
| Project replacement and transport ownership | Existing unit/browser regressions passed |
| Skipping unchanged autosave writes | Not reprofiled in this audio slice |
| Instrument cleanup | New 4,096-retrigger offline gate and existing real-time instrument tests |
| Ten-minute production playback responsiveness | Passed: 600,792 ms, 20 checkpoints, zero page errors, mixer/mode switching and final Stop/Panic |
| Production versus development | Built-static workflow and development suite; no controlled comparative speed claim |
| Safari/iOS, low-memory Android, very large imports/long exports | Not exercised |

Code rollback is a normal revert of this isolated commit. No migration, data rewrite,
or provider rollback is required.
