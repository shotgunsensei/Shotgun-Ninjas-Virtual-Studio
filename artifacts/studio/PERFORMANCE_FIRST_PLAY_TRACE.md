# First Play Trace

Date: 2026-06-15

Scope: production first-Play isolation after the app repeatedly failed to
transition from Play to Pause and CDP metrics timed out after audio unlock.

## Trace Controls

Enable local-only tracing with either:

- Query param: `?snFirstPlayTrace=1`
- Local storage: `sn:firstPlayTrace = "1"`

Debug-only isolation flags:

- `snDisableProjectSchedules=1`
- `snDisableTransportCallbacks=1`
- `snDisableGraphBuildOnPlay=1`
- `snUseMinimalAudioGraph=1`
- `snDisableWorldAudio=1`
- `snDisableAnalyzers=1`

The trace is available in the browser console as:

```js
window.__SN_FIRST_PLAY_TRACE__.dump()
window.__SN_FIRST_PLAY_TRACE__.clear()
window.__SN_FIRST_PLAY_TRACE__.mark("phase")
window.__SN_FIRST_PLAY_TRACE__.measure("phase", start, end)
```

No trace data is sent externally.

## Root Cause

First-Play profiling confirmed two related blockers:

1. `App.tsx` eagerly realized all track voices during bootstrap through
   `audio.ensureTrack()` and `flushMixToEngine()`. That created multi-second
   long tasks before the user pressed Play.
2. `useTransport()` allowed project schedule prep to run immediately after the
   first successful Play. When graph construction/scheduling ran while playback
   was active, the page could hang before the profiler could collect post-Play
   metrics.

The isolation matrix proved the project scheduling/callback path was the first
Play blocker: `snDisableProjectSchedules=1`,
`snDisableTransportCallbacks=1`, `snDisableGraphBuildOnPlay=1`, and
`snUseMinimalAudioGraph=1` all allowed Pause to appear.

## Patch

- Removed eager bootstrap/recovery `audio.ensureTrack()` loops from `App.tsx`.
- Added `firstPlayTrace.ts` ring-buffer tracing and long-task correlation.
- Kept AudioWorklets opt-in.
- Started Tone from the unlock call without awaiting it in the click handler.
- Added first-Play markers around UI click, `useTransport.play()`,
  `AudioEngine.play()`, `Tone.Transport.start()`, schedule prep,
  `ensureTrack()`, `buildVoice()`, factories, analyser creation, and store
  writes.
- Deferred project schedule prep until after first Play, and prevented it from
  running while playback is active. Prep can run after Pause/Stop instead of in
  the first Play task.
- Made `snDisableAnalyzers=1` draw the scope without creating the analyser
  instead of throwing through React render.

## Isolation Matrix

Profile artifact:

- `runtime-profile/runtime-profile-1781555968920.json`

| Scenario | Status | Pause after Play | CDP responsive | Build/ensure during first Play |
| --- | --- | --- | --- | --- |
| Baseline | Pass | Yes | Yes | No |
| No project schedules | Pass | Yes | Yes | No |
| No transport callbacks | Pass | Yes | Yes | No |
| No graph build during Play | Pass | Yes | Yes | No |
| Minimal audio graph | Pass | Yes | Yes | No |
| No world audio | Pass | Yes | Yes | No |
| No analyzers | Pass | Yes | Yes | No |

Latest full short profile artifact:

- `runtime-profile/runtime-profile-1781556158517.json`

First-Play baseline details from the full short profile:

- `useTransport.play`: 1.5 ms
- `AudioEngine.play`: 0.6 ms
- `Tone.Transport.start`: 0.6 ms
- `ensureTrack()` during first Play: 0
- `buildVoice()` during first Play: 0

## Remaining Bottlenecks

First Play is no longer the release blocker. The broader short runtime profile
still failed later scenarios and still captured long tasks:

- Trap Starter short playback passed, but demo load/playback captured a 9.65 s
  long task.
- Mixer stress passed but added 15,275 JS event listeners during the scenario.
- Visualizer, repeated preset switching, repeated project load/unload,
  save/load/autosave, JSON import/export, and WAV export still failed by
  locator timeouts.
- The 10-minute playback acceptance test was not run because the short profile
  did not fully pass.
