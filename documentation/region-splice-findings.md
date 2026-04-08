# Region Splice Demo — Findings

## Goal

Prove that splitting an audio region at arbitrary points and playing back produces seamless, click-free audio.

## What Works

**Pure Web Audio API**: Scheduling consecutive `AudioBufferSourceNode` instances from the same decoded buffer at exact sample boundaries produces perfectly seamless playback. No fades needed. Verified with `webaudio-splice-test.html`.

**SDK `RegionEditing.cut()`**: Correctly splits a region into two adjacent regions with properly aligned `position`, `duration`, `loopOffset`, and `loopDuration` fields. The box graph state is consistent.

## SDK Voice Pop Issue

**Symptom**: An audible pop/click at every region boundary during playback, even when:
- All PPQN values are integers (no truncation mismatch)
- No fading is applied
- Regions are perfectly aligned (left ends exactly where right begins)
- The same audio file is referenced by both regions

**Root cause**: The SDK's `TapeDeviceProcessor` creates a separate `PitchVoice` for each region. Voices have a built-in 20ms crossfade (`VOICE_FADE_DURATION`) on creation and eviction. When one region ends and the next begins:

1. The left region's voice fades out over ~20ms (gain ramps from 1 → 0)
2. The right region's voice fades in over ~20ms (gain ramps from 0 → 1)
3. This creates a V-shaped volume dip at the boundary, heard as a pop

The voice fade is in `PitchVoice.process()` and applies independently of region-level fading (`FadingEnvelope`). There is no way to disable it from the API level.

**Evidence**:
- The same audio file played through consecutive `AudioBufferSourceNode`s (Web Audio API) has zero pop
- The pop occurs with `fadePPQN=0` (no region fading) and perfect integer PPQN alignment
- The pop scales with voice fade duration, not region fade duration

## Additional Findings

### PPQN Must Be Integer

`AudioRegionBox` fields `position`, `loopOffset` are `Int32`. Passing float PPQN to `RegionEditing.cut()` causes the right region's `position` and `loopOffset` to truncate while the left region's `duration` keeps the fractional part. Always round cut positions: `Math.round(PPQN.secondsToPulses(seconds, bpm))`.

Also round `clipDurationInPPQN` when creating tracks so `loopDuration` is integer.

### Fade-In on Newly Created Regions

Setting `fading.inField` on a region created by `RegionEditing.cut()` / `copyTo()` may not take effect in the audio engine, even when:
- Values read back correctly via adapter getters
- Set in the same `editing.modify()` transaction as the cut

Fade-out on the original (left) region works reliably. This may be related to how the engine initializes voice state for new regions.

### `consolidate` Parameter

`RegionEditing.cut(adapter, position, consolidate)` — the `consolidate` parameter controls whether the new region gets an independent copy of the event collection (`true`) or shares the original (`false`). It does not affect audio playback quality or the voice pop issue.

## Files

| File | Purpose |
|------|---------|
| `webaudio-splice-test.html` | Standalone Web Audio splice test (no SDK) — proves seamless playback is possible |
| `src/demos/playback/region-slice-demo.tsx` | SDK demo with the voice pop issue |
| `docs/superpowers/specs/2026-04-07-region-slice-demo-design.md` | Original design spec |

## Fade Experiments (Web Audio)

Tested three fade modes in pure Web Audio (`webaudio-splice-test.html`):

| Mode | Behavior | Result |
|------|----------|--------|
| No fade (fade=0) | Raw consecutive scheduling | Seamless — audio is continuous |
| Non-overlap fade | Fade-out then fade-in at boundary | Pop — V-shaped volume dip at splice |
| Overlap crossfade | Regions overlap, left fades out while right fades in | Still pops at bad edit points |

**Conclusion:** For same-file consecutive regions, no fade is needed — the audio samples are already continuous. Adding fades (with or without overlap) can introduce artifacts, especially if the edit point lands at a high-amplitude part of the waveform far from a zero crossing. Fades only help when splicing *different* audio content.

## Recommendation

The voice fade behavior in `TapeDeviceProcessor` / `PitchVoice` should be suppressed or bypassed when adjacent regions on the same track reference the same audio file and are sample-aligned. This would allow the engine to treat consecutive regions as a continuous audio stream, matching the behavior of raw Web Audio API scheduling.
