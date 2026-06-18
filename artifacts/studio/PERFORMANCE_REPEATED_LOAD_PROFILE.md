# Performance Repeated Load Profile

Date: 2026-06-18

## Scope

Dedicated production-preview scenario:

1. Fresh load baseline.
2. Load Trap Starter once.
3. Load Trap Starter five times.
4. Load Trap Starter twenty times.
5. Load alternating demos twenty times.
6. Panic, load, play, stop ten times.
7. Idle ten seconds and force CDP GC.

## Confirmed Findings

- Visible DOM did not stack: final DOM elements stayed near `2,992`.
- Object URL growth was real before patching:
  - Before: `285` active object URLs after idle/GC.
  - After: `13` active object URLs after idle/GC, matching baseline.
- Default `AudioWorkletNode` creation stayed `0`.
- Active scheduled transport events after idle were `144`, matching the current
  loaded project schedule, not all prior load cycles.
- Visual ticker subscribers stayed flat.
- Store subscriptions stayed flat.

## Fixes Applied

- Replaced eager per-track `Tone.Freeverb` creation with shared master room-bus
  sends for track reverb amounts.
- Replaced the local `PolyPluck` implementation so pluck presets no longer use
  `Tone.PluckSynth`, which allocates Tone worklet blob URLs that Tone does not
  revoke on dispose.
- Fixed `listenerTrace` so it no longer stores strong references to listener
  functions. The trace can still over-count unmatched React synthetic listeners,
  but it no longer retains detached DOM through diagnostic records.
- Added object URL source-stack capture to `runtime-profile.mjs`.

## Latest Result

Latest dedicated profile: `runtime-profile/runtime-profile-1781747584316.json`
(generated/ignored).

| Checkpoint | Heap MB | CDP nodes | CDP listeners | DOM elements | Object URLs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 15.38 | 3,491 | 3,438 | 2,344 | 13 |
| Trap 20x | 53.21 | 7,687 | 6,957 | 3,083 | 13 |
| Panic/load/play/stop 10x | 116.88 | 6,288 | 8,837 | 2,994 | 13 |
| After idle/GC | 82.52 | 4,050 | 3,819 | 2,992 | 13 |

## Remaining Risk

The diagnostic listener trace's `activeTotal` remains high because React's
delegated synthetic listeners are hard to match perfectly through monkey
patching. CDP node/listener counts now return near baseline after GC, so this is
currently documented as a harness accounting artifact rather than a release
blocker.

