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
