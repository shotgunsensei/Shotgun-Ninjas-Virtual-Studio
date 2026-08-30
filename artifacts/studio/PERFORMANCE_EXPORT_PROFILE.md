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
- Nearest-root decoded factory sample sources with playback-rate transposition,
  plus a native oscillator fallback for modeled or unavailable sample voices.
- Audio clips decoded in existing small batches, then scheduled as buffer
  sources.
- Scheduling yields every 256 note events.
- Render budget rejects very large ranges before allocating the offline render.

The native route now preserves the shipped factory instruments by scheduling
their decoded sample zones directly. It intentionally approximates modeled
Tone-only voices and advanced FX. This keeps WAV export functional and
responsive, but it is not yet an exact Tone graph bounce.

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

### 2026-08-30 Factory-Instrument Parity Update

- Factory zones are pre-decoded through the shared concurrency-limited loader.
- The nearest recorded root is selected for each note, then transposed through
  `AudioBufferSourceNode.playbackRate` with a bounded native envelope.
- The browser acceptance test exports a tenor-sax project, verifies all four
  source zones were served, and validates a non-empty RIFF/WAVE result through
  the `native-wav` route.
- The latest production runtime matrix
  (`runtime-profile/runtime-profile-1788072902071.json`, ignored by Git) passed
  19/19 scenarios with WAV export's largest long task at 92 ms.

### Remaining Export Risks

- WAV output for modeled Tone-only presets and advanced FX remains a stabilized
  approximation, not exact Tone fidelity. Factory-sampled presets retain their
  shipped source timbre through native buffer sources.
- MP3 still uses the legacy Tone offline renderer.
- Automated export validation proves that a sampled source is requested and a
  non-empty WAV is produced; critical listening across browsers and audio
  devices remains a manual acceptance step.
- Large projects with many audio clips still need more memory profiling.

### MP3 Risk Status

MP3 export was not rewritten in the release-hardening pass. It remains on the
legacy Tone offline path and may be slower or heavier than WAV for complex
projects. WAV is the stable recommended export path for reliability.

Future work: add a native/off-main-thread MP3 pipeline or show a clear
Performance Mode warning before MP3 export: `MP3 export is experimental; WAV
export is recommended for reliability.`
