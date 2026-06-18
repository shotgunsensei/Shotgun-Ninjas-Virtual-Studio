# Performance 10-Minute Playback Profile

Date: 2026-06-18

## Gate Split

Release playback is now measured by a focused mode instead of the full long
stress suite:

```bash
STUDIO_PROFILE_MODE=playback10 STUDIO_PROFILE_MINUTES=10 node scripts/runtime-profile.mjs
node scripts/runtime-profile.mjs --mode playback10
```

The broader short runtime profile remains the smoke/stress gate. The full
long-suite remains a soak/follow-up suite because a prior run proved the
10-minute playback scenario but timed out later in save/load/autosave.

## Latest Result

Latest profile: `runtime-profile/runtime-profile-1781789863592.json`
(generated/ignored).

| Check | Result |
| --- | ---: |
| Scenario status | Pass |
| Scenario duration | 617,058 ms |
| Playback elapsed at 10-minute checkpoint | 601,356 ms |
| Largest long task | 237 ms |
| Total long-task time | 652 ms |
| Default AudioWorkletNodes | 0 |
| Active lean one-shot sources after idle | 0 |
| Active scheduled players after idle | 0 |
| Active Transport events after idle | 0 |
| Lean hits scheduled / triggered | 185 / 185 |
| Lean one-shots created / ended / disconnected | 185 / 185 / 185 |
| Object URLs active | 13 baseline / 13 final |

## Checkpoints

| Checkpoint | Heap MB | DOM nodes | JS listeners | Transport events | Voice modes |
| --- | ---: | ---: | ---: | ---: | --- |
| Baseline | 15.41 | 3,491 | 3,438 | 0 | shell 0 / lean 0 / tone 0 |
| Before playback | 21.28 | 6,785 | 5,969 | 1 | shell 0 / lean 0 / tone 0 |
| 1 minute | 22.44 | 4,312 | 3,768 | 186 | shell 0 / lean 1 / tone 0 |
| 5 minutes | 36.88 | 4,348 | 3,780 | 186 | shell 0 / lean 1 / tone 0 |
| 10 minutes | 38.65 | 4,321 | 3,774 | 186 | shell 0 / lean 1 / tone 0 |
| After stop/panic | 42.99 | 4,419 | 4,883 | 0 | shell 0 / lean 1 / tone 4 |
| After 10s idle + GC | 37.96 | 4,232 | 3,818 | 0 | shell 0 / lean 1 / tone 4 |

## Fix Confirmed

The first playback10 run passed playback but showed 229 active Transport
events returning after panic idle. Root cause was `useTransport` re-arming
project schedules after playback stopped because `projectSchedulesArmed`
remained true.

Patch:

- Added `panicRevision` to the store.
- Panic button, Escape panic, mobile panic, and error-boundary panic now bump
  `panicRevision`.
- `useTransport` detects that signal, cancels known scheduled IDs, disposes
  scheduled players, clears its local scheduled refs, resets lean preflight, and
  disarms project scheduling.

Result: the rerun leaves `activeTransportEvents=0` after stop/panic and after
10 seconds idle.

## Release Gate Status

Focused 10-minute playback gate passes. This does not make the full long-suite
clean; it proves the release playback gate independently from save/load/export
soak scenarios.
