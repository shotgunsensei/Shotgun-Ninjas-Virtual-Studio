# Performance Audio Node Profile

Date: 2026-06-16

Scope: Web Audio / Tone.js lifecycle containment after first-play and listener
profiling work.

## Instrumentation Added

Added `src/lib/performance/audioNodeTrace.ts`, enabled only by:

- `?snAudioNodeTrace=1`
- `localStorage["sn:audioNodeTrace"] = "1"`

The profiler exposes:

- `window.__SN_AUDIO_NODE_TRACE__.snapshot()`
- `window.__SN_AUDIO_NODE_TRACE__.dumpTopStacks()`
- `window.__SN_AUDIO_NODE_TRACE__.clear()`
- `window.__SN_AUDIO_NODE_TRACE__.start()`
- `window.__SN_AUDIO_NODE_TRACE__.stop()`

Tracked areas:

- Web Audio node creation for gain, filters, IIR filters, oscillators, buffer
  sources, constant sources, stereo panners, compressors, convolvers, delays,
  and analysers.
- `AudioWorklet.addModule`.
- `new AudioWorkletNode`.
- `AudioNode.connect` and `disconnect`.
- `AudioScheduledSourceNode.start` and `stop`.
- Audio-node, AudioWorkletNode, AudioScheduledSourceNode, and MessagePort
  listener add/remove.
- Tone-owned lifecycle counters at the app ownership layer for track voices,
  scheduled players, effect modules, analysers, and Transport events.

The profiler is local-only and does not send project data or diagnostics
outside the browser.

## Verification Artifact

Latest traced short production profile:

- `runtime-profile/runtime-profile-1781620678141.json`

First-play matrix recheck:

- `runtime-profile/runtime-profile-1781620541263.json`

## AudioWorklet Default-Disabled Result

Default env, without `VITE_STUDIO_ENABLE_AUDIO_WORKLETS=1`:

- `audioWorkletNodesDelta`: `0` in every runtime-profile scenario.
- Audio startup: `activeAudioWorkletNodes = 0`.
- Trap Starter load/play: `activeAudioWorkletNodes = 0`.
- Mixer stress: `activeAudioWorkletNodes = 0`.
- Repeated project-load checkpoints: `activeAudioWorkletNodes = 0` where
  the scenario reached checkpoints.

The worklet manager now has its own guard in addition to the engine guard:

- no `audioWorklet.addModule`
- no worklet blob URL
- no `new AudioWorkletNode`
- no CPU probe

unless `VITE_STUDIO_ENABLE_AUDIO_WORKLETS` is exactly `"1"`.

## ConstantSourceNode Findings

The high Chrome listener counts are now attributed to Tone.js /
standardized-audio-context source lifecycle churn rather than app-owned mixer
DOM listeners.

Observed after audio startup / panic / replay:

- `activeAudioWorkletNodes`: `0`
- `activeTrackVoices`: `5`
- `activeScheduledPlayers`: `0`
- dominant stacks:
  - `node-connect:ConstantSourceNode`: `1006`
  - `node-create:GainNode`: `889`
  - `node-create:GainNode`: `868`

Observed after Trap Starter play:

- `activeAudioWorkletNodes`: `0`
- `activeTrackVoices`: `5`
- `activeScheduledPlayers`: `0`
- dominant stacks:
  - `node-connect:ConstantSourceNode`: `1996`
  - `node-create:GainNode`: `1879`
  - `node-create:GainNode`: `1858`

Top source-mapped bundle stacks point into Tone's internal source/signal path:

- `createConstantSource`
- `ConstantSourceNode:ended`
- `ConstantSourceNode.stop`
- Tone internal classes around `DH` / `See` in the production bundle

The important containment result: listener removals and disconnects are present
in the trace, so this looks like high churn and retained in-flight source
objects more than a confirmed unbounded app-owned listener leak.

## Long-Task Findings

Short profile results:

| Scenario | Status | Largest long task | Notes |
| --- | --- | ---: | --- |
| First-play baseline | Pass | 530 ms | First Play still passes but initial graph/schedule work remains heavy. |
| Audio startup / panic / replay | Pass | 2,542 ms | Worse than prior 980 ms in this traced run; dominant trace is Tone source/gain churn. |
| Trap Starter short playback | Pass | 7,417 ms | Still above target; trace points to Tone source/gain creation and schedule churn. |
| Mixer stress | Pass | 0 ms | App-owned listener/transport/audio counters stayed bounded. |
| Sample import | Pass | 1,338 ms | Import/waveform path still blocks. |

Trap Starter did not meet the under-1-second target in this pass. The remaining
root cause is documented as Tone graph/source churn during project playback and
schedule preparation, not AudioWorklet creation.

## Repeated Stress Findings

The short profile still fails later stress scenarios:

- Visualizer Performance Mode stress: click blocked by an open modal overlay.
- Repeated preset switching: locator failed after prior state.
- Repeated project load/unload: scenario timeout/locator failure before full
  acceptance.
- Save/load/autosave, JSON import/export, and WAV export: locator failures
  caused by modal overlay state after prior failed scenarios.

These are not release-safe results. They show the harness/app can still get
into a blocked UI state during long stress runs.

## Current Patch Decision

Applied in this pass:

- opt-in audio node profiler
- runtime harness audio-node snapshots and deltas
- defensive AudioWorklet opt-in guard inside `WorkletManager`
- Tone ownership counters for app-owned voices, analysers, effect modules,
  scheduled players, and Transport IDs

Not applied in this pass:

- broad Tone wrapper replacement
- major graph rewrite
- AudioWorklet re-enable
- phased Trap Starter graph construction

The next safe patch should reduce Tone graph churn by deferring or reusing
track voice source/signal creation, especially for inactive/muted/empty tracks
and optional effect defaults.

---

## 2026-06-16 Lean Drum Voice Update

Latest profile artifacts:

- First-play matrix: `runtime-profile/runtime-profile-1781624302737.json`
- Short full profile: `runtime-profile/runtime-profile-1781624432573.json`

### Patch Summary

- Added a native Web Audio lean drum voice path in
  `src/lib/audio/leanDrumVoice.ts`.
- Added `shell`, `lean`, `tone`, and `disposed` voice mode tracking in
  `AudioEngine`.
- Extended `ensureTrack(track, options)` with `mode`, `reason`, `allowHeavy`,
  and `deadlineMs`.
- Changed project scheduling so drum tracks request `mode: "lean"` with
  `allowHeavy: false`.
- Added runtime-profile capture for voice mode counts, voice promotions,
  ConstantSourceNode creates, GainNode creates, BufferSource creates, and
  Oscillator creates.

### Measured Result

| Scenario | Previous largest long task | Latest largest long task | Previous ConstantSource evidence | Latest ConstantSource delta | Latest GainNode delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Audio startup / panic / replay | 2,542 ms | 322 ms | ~1,006 dominant ConstantSource stack | 42 | 317 |
| Trap Starter short playback | 7,417 ms | 205 ms | ~1,996 dominant ConstantSource stack | 0 | 49 |

Default AudioWorkletNode creation remained zero.

### Caveat

The Trap Starter profile did not capture an active lean voice in the voice mode
snapshot. It captured two existing Tone promotions from the prior/default
scheduler state and then disposed them after the Trap run. The reduction is
still strong evidence that the current run avoided the prior Tone graph churn,
but a focused fresh-session Trap Starter profile is required to prove that the
new lean drum path is the active playback path for the demo.

### Remaining Audio Node Risks

- Full Tone melodic voice creation is still synchronous.
- Drum advanced controls need explicit lean-to-Tone promotion rather than
  silent no-op behavior.
- Sample clip, preview, and metronome lean paths remain future work.
- Later runtime stress scenarios still fail and do not yet prove bounded node
  growth over a long session.

---

## 2026-06-16 Fresh Lean Audio Node Proof

Latest focused profile:

- `runtime-profile/runtime-profile-1781640194382.json`

The focused fresh-session Trap Starter validation now proves active lean drums:

| Counter | During/after Trap validation |
| --- | ---: |
| `voiceModes.lean` | 1 |
| `voiceModes.tone` | 0 |
| `activeAudioWorkletNodes` | 0 |
| `ConstantSourceNode` creates | 0 |
| `GainNode` creates | 119 |
| `leanDrumHitsScheduled` | 39 |
| `leanDrumHitsTriggered` | 39 |
| `leanOneShotSourcesCreated` | 39 |
| `leanOneShotSourcesEnded` after idle | 39 |
| `leanOneShotSourcesDisconnected` after idle | 39 |
| `leanOneShotSourcesActive` after stop/idle | 0 |

The earlier scheduling bug was that `scheduleClip()` required a full Tone voice
before registering note events. Drum tracks owned by a lean voice now schedule
normally, and `triggerDrumAt()` routes those callbacks to the lean voice.

Latest short profile:

- `runtime-profile/runtime-profile-1781658843928.json`

All later scenarios except WAV export completed. WAV export is now the confirmed
audio-node blocker: it timed out after 180 s with `ConstantSourceNode` creates
up by 2,150, `GainNode` creates up by 16,287, heap up by 136.05 MB, and a
1,732 ms largest long task.
