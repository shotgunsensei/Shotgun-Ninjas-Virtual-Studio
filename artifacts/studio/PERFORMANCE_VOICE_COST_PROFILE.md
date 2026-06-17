# Performance Voice Cost Profile

Date: 2026-06-16

Scope: Tone graph churn reduction and lean voice architecture for Shotgun
Ninjas Virtual Studio.

## Summary

The confirmed runtime blocker is Tone / standardized-audio-context graph churn,
especially ConstantSourceNode and GainNode creation around audio startup and
Trap Starter playback preparation. Default AudioWorkletNode creation remains
verified at zero in production profiles.

This pass added a native Web Audio lean drum path for scheduled drum tracks. It
does not replace all Tone voices, does not re-enable AudioWorklets, and does not
make the studio release-safe. Full 10-minute production playback has still not
passed.

## Voice Modes

| Mode | Meaning | Current behavior |
| --- | --- | --- |
| `shell` | Track is known to the engine but has no active playback graph. | Supported by `ensureTrack(track, { mode: "shell" })`. |
| `lean` | Lightweight native Web Audio path for simple drum one-shots. | Supported for drum tracks via `createLeanDrumVoice()`. |
| `tone` | Full Tone voice graph with instrument, channel, sends, filters, and advanced controls. | Still required for melodic synths, samplers, vocals, and advanced drum controls. |
| `disposed` | Previously active voice has been removed. | Recorded after track cleanup. |

Runtime status is exposed in development/profiling runs through:

- `window.__SN_AUDIO_ENGINE_STATUS__.voiceModes()`

## Current Factories And Cost Classification

Node counts below are profile estimates from traced production runs and source
inspection. Exact per-voice counts vary because Tone creates internal Signal and
Param wrappers lazily.

| Track / voice type | Current factory | Classification | Estimated cost | ConstantSourceNode risk | GainNode risk | Trap Starter | First 8 bars | Lean initially |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Drum kit track | `buildKit(findKit(track.kitId), filter, reverb, delay)` in `buildVoice()` | Lean candidate when triggering simple one-shots. Full Tone required for piece FX, piece mixer, sends, choke/kit detail, and edited sound design. | High: 9 pieces with Tone.Channel, Tone.Filter, AmplitudeEnvelope, send gains, and synth/sample helpers. | High via Tone Signal/Param/envelope internals. | High via channels, sends, filters, envelopes, and per-piece routing. | Yes, Trap kit. | Yes, beat 0 onward. | Yes for schedule playback; added. |
| One-shot sample / simple clip | Project audio clip scheduling and temporary players. | Lean candidate. | Medium to high if routed through Tone.Player or decoded repeatedly. | Medium if Tone wrappers are used. | Medium. | Not in Trap Starter core pattern. | Not applicable. | Yes, not fully implemented in this pass. |
| Basic metronome/click | Engine metronome scheduling and click nodes. | Lean candidate. | Low to medium. | Medium if Tone wrappers are used. | Low. | No. | Not applicable. | Yes, not changed in this pass. |
| Simple preview sound | Preview helpers and sample/preset audition paths. | Lean candidate for one-shots only. | Variable. | Medium if Tone wrappers are used. | Medium. | No. | Not applicable. | Not changed in this pass. |
| 808 bass / mono synth | `buildPresetVoice(findPreset("bass.808"))` / Mono808 voice path. | Full Tone required. | High, but musically required. | High. | Medium/high. | Yes. | Enters after the opening section; audible within first 8 bars. | No. |
| Synth keys | `buildPresetVoice(findPreset("keys.synth"))` | Full Tone required. | High. | High. | Medium/high. | Yes. | Enters after the opening section; audible within first 8 bars. | No. |
| Pluck lead | `buildPresetVoice(findPreset("pluck.synth"))` | Full Tone required. | High. | High. | Medium/high. | Yes. | Enters after the opening section; audible within first 8 bars. | No. |
| Vocal / mic track | `Tone.UserMedia` when full voice is built. | Full Tone only when monitoring/recording is active. | Medium. | Low/medium. | Medium. | Track exists in Trap Starter but has no core clip. | Not audible. | Shell should be preferred until needed; not fully enforced in this pass. |
| Effects rack module | `createEffectModule()` / Tone effect nodes. | Full Tone required only for active FX. | Medium/high. | Medium/high depending on effect. | Medium/high. | Defaults may be present through voice graph. | Not directly audible without source. | Disabled FX should not promote; further guardrails remain. |
| Automation / modulation lanes | Engine automation scheduler and Tone param updates. | Full Tone required when active lanes target Tone params. | Medium/high when lanes exist. | High for Tone param wrappers. | Medium. | Some project lanes may exist depending on demo state. | Variable. | No. |

## Trap Starter Audit

Trap Starter currently defines five tracks:

| Track | Kind | Current desired mode | Audible in first 8 bars | Notes |
| --- | --- | --- | --- | --- |
| Drums | `drums`, `kitId: trap` | `lean` for scheduled one-shot playback. | Yes. | Biggest avoidable graph cost. Full Tone kit is still needed for advanced piece editing and kit-specific polish. |
| 808 Bass | melodic preset | `tone` | Yes, after the opening section. | Requires Tone synth behavior. |
| Keys | melodic preset | `tone` | Yes, after the opening section. | Requires Tone synth behavior. |
| Lead | melodic preset | `tone` | Yes, after the opening section. | Requires Tone synth behavior. |
| Vocals | vocals / armed track | `shell` until recording/monitoring. | No. | Should not build `Tone.UserMedia` during demo load/play unless explicitly needed. |

Largest known avoidable creation cost: the Trap drum kit when it is built as a
full Tone kit instead of using a one-shot lean path.

## Lean Drum Architecture Added

New file:

- `src/lib/audio/leanDrumVoice.ts`

Implementation:

- Reuses one per-track native `GainNode`.
- Reuses one per-track native `StereoPannerNode`.
- Reuses one per-track native `BiquadFilterNode`.
- Reuses one generated noise `AudioBuffer`.
- Creates only one-shot `AudioBufferSourceNode` or `OscillatorNode` per hit.
- Uses short-lived per-hit gain/filter nodes for envelope and tonal shaping.
- Disconnects one-shot source chains in `onended`.
- Disposes the per-track output/pan/filter graph on track cleanup.

This avoids Tone.Channel, Tone.Signal, Tone.Param, Tone.Envelope, Tone.Filter,
and Tone effect wrappers for simple drum triggering.

## Engine Integration

`AudioEngine.ensureTrack(track, options)` now accepts:

- `mode: "shell" | "lean" | "tone"`
- `reason`
- `allowHeavy`
- `deadlineMs`

Important behavior:

- `allowHeavy: false` prevents full Tone voice creation.
- `mode: "lean"` only creates a lean voice for drum tracks.
- Promotion records are kept in `voicePromotions`.
- `removeTrack()`, `disposeAllTracks()`, and `removeAllTracksExcept()` include
  lean voices.
- `triggerDrumAt()` routes to lean drums when present and no full Tone voice is
  active.

Scheduler behavior:

- Project scheduling now requests `mode: "lean"` with `allowHeavy: false` for
  drum tracks.
- Non-drum tracks still request full Tone because the existing melodic/vocal
  paths require Tone behavior.

## Profile Results

Before values are from `runtime-profile/runtime-profile-1781620678141.json`.
After values are from `runtime-profile/runtime-profile-1781624432573.json`.

| Scenario | Before largest long task | After largest long task | Before ConstantSource evidence | After ConstantSource creates | Before Gain evidence | After Gain creates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Audio startup / panic / replay | 2,542 ms | 322 ms | ~1,006 dominant ConstantSource stack | 42 | ~889 / 868 dominant Gain stacks | 317 |
| Trap Starter short playback | 7,417 ms | 205 ms | ~1,996 dominant ConstantSource stack | 0 | ~1,879 / 1,858 dominant Gain stacks | 49 |

Reduction target status:

- Audio startup ConstantSource churn: reduced by more than 70 percent in the
  traced short profile.
- Trap Starter ConstantSource churn: reduced by more than 70 percent in the
  traced short profile.
- Audio startup largest long task: under 500 ms in the traced short profile.
- Trap Starter largest long task: under 1 s in the traced short profile.

## Important Verification Caveat

The latest short profile did not capture active lean drum voices during the
Trap Starter scenario. The voice mode snapshots for that scenario show two Tone
promotions from the previous/default scheduling state, then `disposed: 2` after
the Trap run:

- `voiceModes.counts` before/after load: `tone: 2`, `lean: 0`
- `voiceModes.counts` after play: `disposed: 2`, `lean: 0`

That means the measured long-task improvement is real for the profiled run, but
the run did not conclusively prove Trap Starter drums were played through the
new lean path. This must be verified with a focused fresh-session Trap Starter
profile before calling the lean architecture complete.

## Not Added In This Pass

- `src/lib/audio/voiceBuildQueue.ts`
- Chunked full Tone promotion phases.
- Full promotion path from lean drums to Tone when the user edits advanced kit
  or piece controls.
- Lean path for sample clips, previews, or metronome.
- Focused track-by-track node-count table generated directly by the harness.

## Remaining Risks

- Full Tone melodic voice creation is still synchronous.
- Advanced drum controls currently require a future explicit lean-to-Tone
  promotion path.
- The vocal track should stay shell until monitoring/recording, but this pass
  did not fully enforce that across all UI paths.
- Later runtime stress scenarios still fail due modal/locator state and have
  not proven bounded growth.
- The 10-minute production playback acceptance test has not passed.

---

## 2026-06-16 Fresh Lean Drum Validation

Latest focused profile:

- `runtime-profile/runtime-profile-1781640194382.json`

Fresh-session Trap Starter validation now proves the lean drum path is active:

| Metric | Result |
| --- | ---: |
| `voiceModes.lean` during Trap Starter playback | 1 |
| `voiceModes.tone` during focused Trap validation | 0 |
| `leanDrumHitsScheduled` | 39 |
| `leanDrumHitsTriggered` | 39 |
| `leanOneShotSourcesCreated` | 39 |
| `leanOneShotSourcesEnded` after idle | 39 |
| `leanOneShotSourcesDisconnected` after idle | 39 |
| `leanOneShotSourcesActive` after stop/idle | 0 |
| Default `AudioWorkletNode` creation | 0 |
| `ConstantSourceNode` creates | 0 |
| Largest Trap validation long task | 328 ms |

### Lean-To-Tone Promotion Rules

Lean drum tracks remain lean for play, stop, panic, load demo, mixer open,
visualizer open, mute/solo, basic volume, basic pan, basic supported filter,
basic one-shot hits, step sequencing, and Performance Mode toggles.

Promotion to full Tone is explicit in `AudioEngine` for these currently wired
advanced paths:

| Trigger | Promotion reason |
| --- | --- |
| Enabling a track effect module | `effect:<moduleId>` |
| Drum kit switch | `kit-switch` |
| Piece-level drum setting edit | `piece-setting:<piece>` |
| Advanced sound params needing sends/drive | `sound-params:advanced` |

Promotion is not performed inside the lean drum hit trigger path. The current
promotion implementation is synchronous and should be chunked before broad use
with very large projects.

### Lean Cleanup And Reuse

The lean drum path now reuses per-track output, pan, and filter nodes. Per-hit
one-shot sources are tracked, disconnected, removed from the active set, and
their `onended` handlers are nulled during cleanup. `panicStopAll()` stops
active lean one-shots, and track/project cleanup disposes lean resources.

### Next Lean Candidates

| Candidate | Current path | Tone/node cost | Recommended lean design | Risk | Next |
| --- | --- | --- | --- | --- | --- |
| Sample preview playback | Preview/sample helpers can route through heavier playback objects. | Medium: temporary players/gains and decode work. | Native one-shot `AudioBufferSourceNode` preview with reusable gain/pan and cancellation token. | Medium. | Yes, after WAV blocker. |
| Metronome/click | Existing engine metronome path remains Tone-adjacent. | Low/medium but frequent. | Native click oscillator/buffer with stored schedule ID and no Tone voice graph. | Low. | Yes, small scoped patch. |
| One-shot sample clips | Project audio clip scheduling can still use player objects. | Medium/high for many clips. | Reused decoded buffers, native one-shot source per clip, batched decode/load. | Medium/high. | Later. |
| Simple audio clip preview | Preview path can overlap with import/waveform UI. | Medium. | Lazy native preview node with explicit teardown on panel close/replacement. | Medium. | Later. |
