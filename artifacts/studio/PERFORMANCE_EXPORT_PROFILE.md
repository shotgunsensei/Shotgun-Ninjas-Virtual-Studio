# Performance Export Profile

## 2026-06-17 WAV Export Stabilization

### Root Cause Confirmed

The previous WAV export path rendered through full Tone offline voice creation.
For Trap Starter it timed out after 180 seconds and created thousands of Web
Audio nodes during export:

| Previous WAV profile | Result |
| --- | ---: |
| Status | Failed / 180 s timeout |
| Largest long task | 1,732 ms |
| Heap delta | +136.05 MB |
| `ConstantSourceNode` creates | +2,150 |
| `GainNode` creates | +16,287 |

The node stack pointed at Tone kit/preset construction during offline render,
not live playback.

### Export Path Inventory

| Export path | Current route | Notes |
| --- | --- | --- |
| WAV mix | Native `OfflineAudioContext` route | Avoids Tone graph construction and `Tone.Transport` for WAV. |
| Stems ZIP WAVs | Native route through `renderProject(..., "wav")` | Same bounded renderer per stem. |
| DAW Pack `mix.wav` and stems | Native route through WAV render helpers | MIDI/project packaging unchanged. |
| MP3 | Existing Tone offline route | Not changed in this pass. |
| JSON project export/import | Existing storage path | Not changed in this pass. |

### Native WAV Route

The stabilized WAV route creates one offline context per export and schedules
direct Web Audio nodes:

- Per-track gain, pan, and low-pass filter.
- One-shot drum hits using bounded oscillator or shared-noise buffer sources.
- Simple native oscillator fallback for melodic Tone-only tracks.
- Audio clips decoded in existing small batches, then scheduled as buffer
  sources.
- Scheduling yields every 256 note events.
- Render budget rejects very large ranges before allocating the offline render.

The native route intentionally approximates Tone-only melodic and advanced FX
tracks. This keeps WAV export functional and responsive, but it is not yet a
high-fidelity Tone bounce replacement.

### Latest Verification

Latest short production profile:

- `runtime-profile/runtime-profile-1781706542117.json`

This generated profile is intentionally ignored and should not be committed.

| WAV export scenario | Result |
| --- | ---: |
| Status | Pass |
| Duration | 13,126 ms |
| Largest long task | 96 ms |
| Total long task time | 499 ms |
| Heap delta | +33.2 MB |
| `AudioWorkletNode` delta | 0 |
| `ConstantSourceNode` creates | 0 |
| `GainNode` creates | 534 |
| `AudioBufferSourceNode` creates | 336 |
| `OscillatorNode` creates | 154 |
| Export route | `native-wav` |
| Native tracks | 5 |
| Native notes scheduled | 229 |
| Native drum hits scheduled | 185 |
| WAV bytes | 10,029,644 |

Comparison against the prior failing profile:

| Metric | Before | After |
| --- | ---: | ---: |
| Completion | Timed out at 180 s | Passed in 13.1 s |
| Largest long task | 1,732 ms | 96 ms |
| `ConstantSourceNode` creates | 2,150 | 0 |
| `GainNode` creates | 16,287 | 534 |

### Remaining Export Risks

- WAV output for Tone-only melodic presets and advanced FX is a stabilized
  approximation, not exact Tone fidelity.
- MP3 still uses the legacy Tone offline renderer.
- Export trace currently counts created native sources but does not prove
  rendered audio content beyond successful WAV generation.
- Large projects with many audio clips still need more memory profiling.
