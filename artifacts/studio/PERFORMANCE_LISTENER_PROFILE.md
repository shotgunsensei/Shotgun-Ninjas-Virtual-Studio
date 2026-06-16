# Listener / Subscription Runtime Profile

Date: 2026-06-15

Scope: post-first-play runtime listener/subscription profiling in production
preview. No external analytics or project data upload was added.

## Profiler Added

`src/lib/performance/listenerTrace.ts` exposes:

```js
window.__SN_LISTENER_TRACE__.snapshot()
window.__SN_LISTENER_TRACE__.dumpTopStacks()
window.__SN_LISTENER_TRACE__.clear()
window.__SN_LISTENER_TRACE__.start()
window.__SN_LISTENER_TRACE__.stop()
```

Enable the profiler shell with either:

- `?snListenerTrace=1`
- `localStorage.setItem("sn:listenerTrace", "1")`

Important implementation note: DOM listener monkey-patching is started only
after the app shell is loaded by calling `start()`. Early bootstrap
monkey-patching was too invasive and could prevent the studio from reaching the
header. The runtime profile harness now calls `start()` after it sees `header`.

## What It Tracks

- `addEventListener` / `removeEventListener` records after `start()`
- event target label
- event type
- stack trace for listener registrations
- active count by type, target, and label
- duplicate listener stacks
- custom subscriptions through explicit hooks:
  - `store.subscribe`
  - `visualTicker`
  - Tone.Transport event IDs via diagnostics wrappers

Timer and rAF monkey-patching was intentionally removed. Wrapping
`setTimeout`, `setInterval`, and `requestAnimationFrame` during runtime
profiling was too invasive for this app and risked changing the behavior being
measured.

## Evidence

Latest short profile artifact:

- `runtime-profile/runtime-profile-1781574687932.json`

Quick traced load after app shell:

- App loaded with `?snListenerTrace=1`.
- Baseline after `header` and `start()`:
  - `activeTotal`: 224
  - `store.subscribe`: 213
  - `visualTicker`: 10
  - `automation`: 1

## Mixer Stress Findings

Scenario: open/close mixer 20x, toggle mute/solo, close mixer, wait idle.

Profile result:

- Scenario status: pass
- Chrome `JSEventListeners` delta: `+15,293`
- ListenerTrace `activeTotal` delta: `+2`
- `visualTicker` subscriber delta: `0`
- `store.subscribe` delta: `0`
- Tone.Transport event delta: `0`

ListenerTrace snapshots showed the only mixer-scenario active-record change was
transient Web Audio source `ended` listeners:

- `AudioBufferSourceNode:ended`: net `+2`
- no unbounded mixer DOM listener growth
- no visualTicker subscriber growth
- no store subscription growth
- no Transport event growth

Conclusion: the previously observed mixer listener growth is not confirmed as a
mixer React/ticker/store leak. Chrome's listener metric is still increasing, but
the app-owned profiler does not attribute it to mixer open/close ownership.

## Highest Listener Counts Observed

After audio startup and demo load, top duplicate stacks were Web Audio / Tone
internals:

- `ConstantSourceNode:ended`: about 2,000 active records after audio startup.
- `AudioWorkletNode:error`: 40 after audio startup, 88 after Trap Starter load.
- `AudioWorkletNode:processorerror`: 40 after audio startup, 88 after Trap
  Starter load.
- `store.subscribe`: roughly 213-239, bounded during mixer stress.
- `visualTicker`: roughly 10-14, bounded during mixer stress.

The AudioWorkletNode error/processorerror records appear even though the app's
AudioWorklet path is default-disabled, which likely comes from
Tone/standardized-audio-context internals. This needs a focused audio-node trace
before any patch is attempted.

## Patch Decision

No mixer leak patch was applied because the profiler did not confirm a mixer
listener/subscription leak.

Confirmed safe changes in this pass:

- Added the listener profiler.
- Added custom subscription tracing for `visualTicker`, store subscribers, and
  Transport event IDs.
- Updated runtime profiling to capture listener snapshots at mixer, visualizer,
  and repeated project-load checkpoints.

## Remaining Listener Risks

- Chrome's `JSEventListeners` counter still grows substantially during the
  mixer-stress scenario even when app-owned listener deltas are bounded.
- Web Audio/Tone `ConstantSourceNode:ended` listener counts are high after audio
  startup.
- AudioWorkletNode error/processorerror listener counts continue to appear and
  should be traced to the exact library path before patching.
