# Performance Audit — Shotgun Ninjas Virtual Studio

## 1. Architecture Summary

### Audio Engine Files
- `artifacts/studio/src/lib/audio/engine.ts` — singleton `AudioEngine` facade (1690 lines). Owns `Tone.Transport`, per-track voices, master chain, metronome, automation scheduler.
- `artifacts/studio/src/lib/audio/master.ts` — `MasterChain` class. Glue compressor, soft clipper, widener, limiter, 4 global send buses, AudioWorklet DSP nodes. Contains an 80 ms `setInterval` clip-check loop.
- `artifacts/studio/src/lib/audio/voices.ts` — Voice factory functions: drums, piano, guitar, bass, acoustic samplers.
- `artifacts/studio/src/lib/audio/export.ts` — WAV/MP3 offline export. Decodes all clips, runs OfflineAudioContext.
- `artifacts/studio/src/lib/audio/lookahead-scheduler.ts` — 25 ms setInterval queue for sub-frame audio event scheduling.
- `artifacts/studio/src/lib/audio/worklet-manager.ts` — AudioWorkletNode registration + CPU probe.
- `artifacts/studio/src/lib/audio/worklet-sample-player.ts` — AudioWorklet-based kick/snare with Tone.Player fallback.
- `artifacts/studio/src/lib/audio/chopEngine.ts` — Chop Lab sample slicer engine.

### Tone.js Usage
- `Tone.Transport` for all sequenced scheduling.
- `Tone.Meter` (smoothed + peak) per track and master.
- `Tone.Sampler` for piano, acoustic drums (CDN).
- `Tone.Player` for vocal clips and audio clips.
- `Tone.Freeverb`, `Tone.FeedbackDelay`, `Tone.Filter`, `Tone.EQ3`, `Tone.Compressor`, `Tone.Distortion`, `Tone.Chorus`, `Tone.StereoWidener`, `Tone.BitCrusher`, `Tone.Limiter`, `Tone.WaveShaper`.
- `Tone.MembraneSynth` for metronome fallback.

### React State Management
- Zustand store (`store.ts`) — project state, transport flags, UI state.
- `StudioSettings` — external store via `useSyncExternalStore` (localStorage).
- Context: `WorldContext` (studio world / ambient audio).
- No Redux, no MobX. Zustand selectors on hot paths where possible.

### Mixer Components
- `ChannelStrip.tsx` — per-track fader, pan, sends, effects rack.
- `MasterStrip.tsx` — master bus controls + master meter (own rAF loop).
- `Meter.tsx` — `StereoMeter` + `MeterBar`. Critical bottleneck (see below).

### Sequencer Components
- `DrumPads.tsx` — 16-pad grid + per-pad meter (own rAF loop).
- `StepSequencer.tsx` — step grid, active-step highlight.

### Arrangement Components
- `Timeline.tsx` — arrangement clips, playhead (ref-based, correct).
- `PianoRoll.tsx` — note editor, playhead (ref-based, correct).

### Visualizer / Meter Components
- `MasterScope.tsx` — oscilloscope, own rAF loop, document.hidden guarded.
- `AudioDiagnosticsPanel.tsx` — dropped-frame rAF (no document.hidden guard) + 4 Hz setInterval.
- `BackgroundFx.tsx` — CSS keyframe animations (6 world variants), no JS rAF.

### Sample Import / Waveform
- `ChopLab.tsx` — WaveSurfer instance, sample decode, per-slice pad rendering.
- `SampleLibrary.tsx` / `SoundLibrary.tsx` — sample browser.

### Project Storage
- `lib/storage/db.ts` — IndexedDB via `idb`. Stores projects + blobs.
- `App.tsx` — autosave logic: `dirtyRef` + `saveDraft` (800 ms debounce) + `saveProject` (interval).

### PWA / Service Worker
- Vite PWA plugin. Caches app shell and static assets.
- No intentional user-blob caching.

---

## 2. Reproduction Steps

To reproduce the worst-case lag scenarios:

1. **Mixer open, 6+ tracks** — Start playback, open Mixer panel, watch CPU. StereoMeter setState cascade visible in React DevTools.
2. **Rapid note editing** — Step-sequence a pattern and toggle cells quickly. Draft snapshot fires 800 ms after each change.
3. **Sample import** — Drop a 10 MB WAV onto Chop Lab. Main-thread decode may stutter UI.
4. **WAV export, long project** — Set 8-bar project with 6 tracks + vocal clips. Export WAV.
5. **Kit switching** — Rapidly switch drum kit 5–10 times. Check for memory growth.
6. **Long session** — Leave playback running 10 minutes with mixer open. Monitor heap.
7. **Tab backgrounding** — Switch to another tab while playback is running. On return, check for visual lag burst (deferred rAF callbacks firing all at once).

---

## 3. Suspected Bottlenecks

| # | File | Symptom | Likely Cause | Fix Plan | Risk |
|---|---|---|---|---|---|
| 1 | `Meter.tsx` | UI lag with mixer open during playback | `StereoMeter` calls `setLevels` + `setPeaksDb` at 30 Hz per instance → React reconcile × N tracks | Convert bars to canvas; eliminate state; use visualTicker | Medium (visual change) |
| 2 | `App.tsx` | IDB write every ~800 ms | `saveDraft` debounce = 800 ms fires on every step toggle | Increase to 4 s | Low |
| 3 | `db.ts` | Slow saves with audio clips | `serializeAndFlushBlobs` re-writes ALL blobs every save | Fingerprint + skip unchanged blobs | Low |
| 4 | `TransportBar.tsx` `MasterClipBadge` | rAF wasted when tab hidden | No `document.hidden` guard | Add guard | Low |
| 5 | `AudioDiagnosticsPanel.tsx` | rAF wasted when tab hidden | Dropped-frame monitor rAF has no `document.hidden` guard | Add guard | Low |
| 6 | `master.ts` | Unnecessary CPU at 80 Hz when tab hidden | `startClipWatcher` setInterval has no `document.hidden` guard | Add guard | Low |
| 7 | `engine.ts` | Stacking metronome callbacks | `setMetronome(false)` sets boolean flag but never calls `Transport.clear()` | Call `Transport.clear(metronomeId)` + null guard | Low |
| 8 | `export.ts` | Page freeze on WAV export | All blobs decoded simultaneously; no UI yield points | Batch decode ≤4 at a time + yield + exportInProgress guard | Medium |
| 9 | `settings.ts` | No way to reduce visuals | No global Performance Mode | Add `performanceMode` + `visualTicker.setFpsCap(15)` + CSS | Low |
| 10 | `BackgroundFx.tsx` | Extra CSS load at 60+ DOM nodes | Rain (60 elements) + Shuriken (60 stars) animate at all times | Reduce counts ~40%; disable in Performance Mode | Low |
| 11 | `engine.ts` | Orphaned audio nodes after kit/preset switch | Replaced voices may not dispose their effect chains fully | Audit dispose paths; add logging | Medium |
| 12 | `db.ts` | Repeated large serialization | No dirty flag per-field; serializes everything | Keep existing `dirtyRef`; increase draft debounce | Low |

---

## 4. Confirmed Fixes

*(Updated as fixes are completed)*

| # | Fix | File(s) Changed | Status |
|---|---|---|---|
| 1 | `visualTicker.ts` singleton — one shared rAF loop with document.hidden guard | `src/lib/visualTicker.ts` (new) | ✅ Done |
| 2 | `StereoMeter` → canvas bars + visualTicker | `src/components/Meter.tsx` | ✅ Done |
| 3 | `MasterClipBadge` + `PositionReadout` document.hidden guard | `src/components/TransportBar.tsx` | ✅ Done |
| 4 | `AudioDiagnosticsPanel` dropped-frame rAF document.hidden guard | `src/components/AudioDiagnosticsPanel.tsx` | ✅ Done |
| 5 | `master.ts` clip watcher document.hidden guard | `src/lib/audio/master.ts` | ✅ Done |
| 6 | Metronome `Transport.clear()` on disable | `src/lib/audio/engine.ts` | ✅ Done |
| 7 | Draft debounce 800 ms → 4 s | `src/App.tsx` | ✅ Done |
| 8 | Blob fingerprinting in `serializeAndFlushBlobs` | `src/lib/storage/db.ts` | ✅ Done |
| 9 | `performanceMode` in settings + body `data-perf` attribute | `src/lib/settings.ts`, `src/components/SettingsModal.tsx` | ✅ Done |
| 10 | WAV export `exportInProgress` guard + batched decode + yield points | `src/lib/audio/export.ts` | ✅ Done |
| 11 | CSS `body[data-perf]` glow/shadow overrides | `src/index.css` | ✅ Done |

---

## 5. Remaining Limitations

- **WAV export for very long projects** (>4 min multi-track): OfflineAudioContext render is inherently blocking; only a Service Worker / AudioWorklet render path would fully solve this. Documented in PERFORMANCE_FIXES.md.
- **Tone.js voice disposal audit**: While the most obvious paths are fixed, a full per-voice node registry would require significant refactoring. Documented as future work.
- **Main-thread sample decode**: Files >20 MB decoded on the main thread will still cause a brief stutter. A Web Worker decode path is future work.
- **SharedArrayBuffer ring buffer**: Already an existing task; not covered in this pass.
