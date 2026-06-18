# Performance Sample Import Profile

Date: 2026-06-18

## Scope

The runtime profile imports:

- `runtime-small.wav`: 1 second generated mono WAV.
- `runtime-large.wav`: 30 seconds generated mono WAV, about 2.6 MB.

## Fixes Applied

- `SamplePreviewDialog` skips WaveSurfer for blobs at or above 2 MB and uses the
  lightweight canvas fallback.
- The fallback waveform renderer yields to the browser between draw chunks.
- Saving an unedited sample now fast-paths the original Blob instead of running
  the full decode/edit/render/encode path.

## Latest Result

Latest short profile: `runtime-profile/runtime-profile-1781749794054.json`
(generated/ignored).

| Metric | Result |
| --- | ---: |
| Scenario status | Pass |
| Duration | 16,341 ms |
| Largest long task | 826 ms |
| Total long-task time | 1,005 ms |
| DOM delta | 0 |
| Object URL active delta | 0 |
| Active AudioWorkletNodes | 0 |
| Active scheduled players | 0 |

## Current Interpretation

The remaining long task did not materially improve after bypassing WaveSurfer
and the no-edit render path. The import remains functionally safe and cleanup is
bounded, but the 30-second WAV path still has a browser decode/hash/file-import
stall above the preferred 500 ms target.

## Remaining Risk

This is not fully release-clean. The next patch should move peak generation and
content fingerprinting for larger samples to a worker or chunked pipeline, then
profile the same scenario again.

---

## 2026-06-18 Release-Gate Sample Import Update

Latest focused profile: `runtime-profile/runtime-profile-1781788532754.json`
(generated/ignored).

### Root Cause Confirmed

The prior 826 ms long task was a mix of two issues:

- The profiling harness sent a 2.6 MB byte array through CDP into
  `page.evaluate`, which created a synthetic browser long task not caused by
  app import code.
- `SamplePreviewDialog` used `ref.current` as an effect gate. When the dialog
  portal attached after the effect check, WaveSurfer/canvas preview generation
  could be skipped. The same ref timing issue affected the large-sample fallback
  canvas.

### Fixes Applied

- Added `src/lib/performance/sampleImportTrace.ts` with opt-in
  `?snSampleImportTrace=1` snapshots.
- Added `src/workers/sampleImportWorker.ts` and moved blob fingerprinting to a
  local Web Worker with main-thread fallback.
- Instrumented file drop, metadata validation, preview open, object URL
  create/revoke, decode, peak generation, blob fingerprint, IndexedDB blob
  write, project save, commit, and cleanup.
- Changed the runtime harness to generate synthetic WAV files inside the page
  with yields instead of transferring large byte arrays through CDP.
- Fixed `SamplePreviewDialog` to use callback-ref state for the WaveSurfer host
  and fallback canvas, so preview initialization is not skipped.

### Latest Result

| Metric | Result |
| --- | ---: |
| Focused sample-import status | Pass |
| Scenario duration | 10,100 ms |
| Largest isolated long task | 142 ms |
| Total isolated long-task time | 142 ms |
| Large WAV decode | 91 ms |
| Large waveform peak generation | 33 ms |
| Large blob fingerprint | 13 ms |
| Large project save | 19 ms |
| Object URL active delta | 0 |
| Default AudioWorkletNodes | 0 |

The large generated WAV import is now under both the 500 ms target and the
preferred 250 ms target in the focused profile.
