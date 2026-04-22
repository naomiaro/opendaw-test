# OpenDAW SDK Changelog: 0.0.133 → 0.0.135

## Breaking Changes for SDK Consumers

None. This is a pure bug fix release.

## Bug Fixes

### Voice Fade-Out Continuity Fix (0.0.135)

Fixed clicking/popping during voice fade-out at region boundaries and loop wrap points.

**Root cause:** `PitchVoice` started fade-out from amplitude 0 instead of the current amplitude level, creating a discontinuity (jump from current gain to zero, then fade).

**Fix:** Added `lastFinalAmplitude` tracking to `PitchVoice`. Fade-out now starts from the current amplitude level, ensuring smooth transitions. Fade progress begins at `fadeLength * (1.0 - lastFinalAmplitude)` instead of 0.

**Impact:** Eliminates the audible pop at:
- Loop boundary wraps (`BlockFlag.discontinuous`)
- Region-to-region transitions (voice eviction + creation)
- Transport stop during playback

### Transport Discontinuity Handling (0.0.135)

Improved cleanup when transport stops mid-playback. All pitch voices now process remaining frames with a unit gain buffer before cleanup, preventing artifacts on stop.

### Audio Playback Offset Fix for Moved Regions (0.0.134)

Fixed loop offset handling for audio regions that have been cut and moved.

- `LoopableRegion.locateLoops()` now correctly handles cut-and-move scenarios
- `VaryingTempoMap.intervalToSeconds()` properly handles negative `fromPPQN` values (intervals crossing PPQN=0)
- `AudioContentModifier` correctly computes sample offsets for moved regions
- `TapeDeviceProcessor` no-stretch play mode offset calculation corrected

## Dependency Updates

| Package | 0.0.133 | 0.0.135 |
|---------|---------|---------|
| `@opendaw/lib-box` | ^0.0.81 | ^0.0.82 |
| `@opendaw/lib-dsp` | ^0.0.80 | ^0.0.81 |
| `@opendaw/studio-adapters` | ^0.0.103 | ^0.0.104 |
| `@opendaw/studio-boxes` | ^0.0.86 | ^0.0.87 |
| `@opendaw/studio-core` | ^0.0.131 | ^0.0.133 |
| `@opendaw/studio-core-processors` | ^0.0.107 | ^0.0.109 |

## Files Changed in SDK Source

### 0.0.134
- `packages/lib/dsp/src/LoopableRegion.test.ts` (new tests for cut-and-move)
- `packages/studio/adapters/src/VaryingTempoMap.ts` (negative PPQN handling)
- `packages/studio/adapters/src/VaryingTempoMap.test.ts` (new tests)
- `packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts`
- `packages/studio/core/src/project/audio/AudioContentModifier.ts`

### 0.0.135
- `packages/studio/core-processors/src/devices/instruments/Tape/PitchVoice.ts` (fade continuity)
- `packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts` (transport stop cleanup)
