# Demo Load / Trap Starter Runtime Profile

Date: 2026-06-15

Scope: Trap Starter load/playback profiling after first-play repair.

## Evidence

Latest short profile artifact:

- `runtime-profile/runtime-profile-1781574687932.json`

Scenario:

- `load-trap-and-10-minute-playback-mixer-scope`
- `STUDIO_PROFILE_MINUTES=0.1`
- Production preview

Result:

- Status: pass for the short run.
- Largest long task: `6,183 ms`
- Total long-task time: `9,120 ms`
- JS heap delta: `+0.63 MB`
- DOM node delta: `+859`
- Chrome JS listener delta: `-418`
- ListenerTrace active delta: `+1,552`
- Store subscription delta: `+26`
- visualTicker subscriber delta: `+1`
- Tone.Transport event delta: `-1`

## Confirmed Long-Task Status

Trap Starter no longer shows the earlier 9.65 s long task in the latest short
profile, but it still has a blocking `6.18 s` task. This remains a release
blocker.

The app now has extra local timing marks around:

- `demo.load`
- `demo.build`
- `demo.audio-stop`
- `demo.reset-store`
- `demo.post-reset-store`
- `project.resetStore`
- `project.resetStore:replace`
- `project.flushMixToEngine`
- `project.flushMixToEngine:track`
- `project.flushAutomationToEngine`

These timers are app-local diagnostics only. They do not change demo data or
project behavior.

## Current Suspected Source

The listener trace points to audio/Tone graph activity rather than mixer DOM
activity:

- `ConstantSourceNode:ended` remains near 1,980 active records after Trap
  Starter load/playback.
- `AudioWorkletNode:error` and `AudioWorkletNode:processorerror` rose from 40
  to 88 during Trap Starter load/playback.
- Store subscriptions rose by 26 because more project UI mounted after loading
  the demo and opening panels.

The next profiling pass should map the `6.18 s` task to specific timing measures
or source-mapped stack frames.

## Patch Decision

No Trap Starter graph/lifecycle patch was applied in this pass because the new
instrumentation identified the remaining blocker but did not isolate one safe,
specific code change. The next patch should focus on Web Audio/Tone node
creation during demo load and post-load panel mounting.

## Remaining Demo-Load Risks

- Trap Starter short playback still violates the target long-task threshold.
- Audio startup itself still has long tasks up to `980 ms` in the latest short
  profile.
- Web Audio node listener counts are high and may indicate retained Tone signal
  nodes or analyzer/worklet fallback objects.
- 10-minute playback was not attempted because the short profile still fails
  later stress scenarios.

---

## 2026-06-16 Audio Node Trace Update

Latest traced short profile:

- `runtime-profile/runtime-profile-1781620678141.json`

Trap Starter short playback still passed functionally but regressed on
long-task duration in this instrumented run:

- Largest long task: `7,417 ms`
- Total long-task time: `12,061 ms`
- `audioWorkletNodesDelta`: `0`
- `activeTrackVoicesDelta`: `0` for the scenario because five voices already
  existed from the previous audio startup scenario
- `audioTransportDelta`: `-1`

Audio-node trace checkpoints:

- `trap-starter:before-load`: `activeTrackVoices=5`,
  `activeAudioWorkletNodes=0`
- `trap-starter:after-load`: `activeTrackVoices=5`,
  `activeAudioWorkletNodes=0`
- `trap-starter:after-play`: `activeTrackVoices=5`,
  `activeAudioWorkletNodes=0`, top stack
  `node-connect:ConstantSourceNode=1996`

Conclusion: the Trap Starter blocker is not default AudioWorklet creation. The
remaining blocker is Tone/Web Audio source and gain churn during playback and
schedule preparation, with ConstantSourceNode/GainNode creation dominating the
captured stacks.
