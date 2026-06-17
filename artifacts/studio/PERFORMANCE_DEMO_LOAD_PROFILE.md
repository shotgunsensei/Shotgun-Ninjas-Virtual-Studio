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

---

## 2026-06-16 Lean Voice Trap Starter Update

Latest short profile:

- `runtime-profile/runtime-profile-1781624432573.json`

Result for `load-trap-and-10-minute-playback-mixer-scope`:

- Status: pass for the short run.
- Largest long task: `205 ms`.
- Total long-task time: `589 ms`.
- `constantSourceCreatesDelta`: `0`.
- `gainNodeCreatesDelta`: `49`.
- `audioWorkletNodesDelta`: `0`.

This is a major improvement from the prior traced profile:

- Prior largest long task: `7,417 ms`.
- Prior total long-task time: `12,061 ms`.
- Prior dominant stack: `node-connect:ConstantSourceNode=1996`.

Trap Starter track inventory is now documented in
`PERFORMANCE_VOICE_COST_PROFILE.md`.

### Caveat

The latest Trap Starter voice-mode snapshots do not show an active lean drum
voice during the scenario. They show two Tone voices from the prior/default
schedule state, followed by those voices being disposed. Therefore the measured
Trap Starter improvement is valid for this short profile, but it does not yet
prove that a fresh Trap Starter session schedules the drum track through the
lean path. A focused fresh-session Trap Starter profile is still required.

### Release Safety

Still not release-safe. The short profile still fails later visualizer,
repeated preset/project-load, save/load, JSON, and WAV scenarios, and the
10-minute production playback acceptance test was not run.

---

## 2026-06-16 Fresh Trap Starter Lean Validation

Latest focused profile:

- `runtime-profile/runtime-profile-1781640194382.json`

Fresh-session flow:

1. Browser/service worker/cache/session state cleared.
2. Production preview loaded `/studio`.
3. Audio enabled.
4. Trap Starter loaded.
5. Playback armed and started.
6. Voice modes, audio-node trace, long tasks, and cleanup snapshot captured.

Result:

| Metric | Result |
| --- | ---: |
| `voiceModes.lean` | 1 |
| `voiceModes.tone` | 0 |
| `leanDrumHitsTriggered` | 39 |
| `leanOneShotSourcesCreated` | 39 |
| `leanOneShotSourcesActive` after stop/idle | 0 |
| `ConstantSourceNode` creates | 0 |
| `AudioWorkletNode` creation | 0 |
| Largest long task | 328 ms |

Latest short profile:

- `runtime-profile/runtime-profile-1781658843928.json`

The short runtime profile now passes visualizer, repeated preset switching,
repeated project load/unload, save/load/autosave, JSON export/import, sample
import, mixer stress, and service-worker simulation. WAV export remains the
confirmed blocker and timed out after 180 s with heavy Tone node churn.
