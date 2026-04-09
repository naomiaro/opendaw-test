# Region Splice & Comp Lanes — Findings

## Goal

Investigate seamless audio splicing and take comping in the OpenDAW SDK.

## What Works

**Pure Web Audio API**: Scheduling consecutive `AudioBufferSourceNode` instances from the same decoded buffer at exact sample boundaries produces perfectly seamless playback. No fades needed. Verified with `webaudio-splice-test.html`.

**SDK `RegionEditing.cut()`**: Correctly splits a region into two adjacent regions with properly aligned `position`, `duration`, `loopOffset`, and `loopDuration` fields. The box graph state is consistent.

**Multi-track volume automation crossfades**: Loading the same audio on multiple tracks and using per-track volume automation (`createAutomationTrack` + `Interpolation.Curve`) to crossfade between them produces zero pops. This is the approach used by the comp lanes demo. Verified with `webaudio-comp-test.html` (Web Audio prototype) and `comp-lanes-demo.tsx` (SDK implementation).

## SDK Voice Pop Issue

**Symptom**: An audible pop/click at every region boundary during playback, even when:
- All PPQN values are integers (no truncation mismatch)
- No fading is applied
- Regions are perfectly aligned (left ends exactly where right begins)
- The same audio file is referenced by both regions

**Root cause**: The SDK's `TapeDeviceProcessor` creates a separate `PitchVoice` for each region. Voices have a built-in 20ms crossfade (`VOICE_FADE_DURATION` in `Tape/constants.ts`, hardcoded, not configurable) on creation and eviction. When one region ends and the next begins:

1. The left region's voice fades out over ~20ms (gain ramps from 1 to 0)
2. The right region's voice fades in over ~20ms (gain ramps from 0 to 1)
3. This creates a V-shaped volume dip at the boundary, heard as a pop

The voice fade is in `PitchVoice.process()` and applies independently of region-level fading (`FadingEnvelope`). There is no way to disable it from the API level.

**Evidence**:
- The same audio file played through consecutive `AudioBufferSourceNode`s (Web Audio API) has zero pop
- The pop occurs with `fadePPQN=0` (no region fading) and perfect integer PPQN alignment
- The pop scales with voice fade duration, not region fade duration

## Workaround: Volume Automation Crossfades

Instead of splitting regions (which triggers voice eviction + creation), use multiple tracks with volume automation:

1. Each "take" is a separate instrument track with its own audio region
2. Each track has a volume automation track targeting `audioUnitBox.volume`
3. At comp boundaries, the outgoing take's volume ramps to -inf while the incoming take's volume ramps to 0dB
4. `Interpolation.Curve(0.25)` for fade-out (logarithmic), `Interpolation.Curve(0.75)` for fade-in (exponential) — equal-power crossfade
5. All tracks play continuously — no region splitting, no voice eviction

This matches how professional DAWs (Logic Pro, Pro Tools, Reaper) handle comp lanes: automatic short overlap crossfades (~20ms) at comp boundaries.

## Additional Findings

### PPQN Must Be Integer

`AudioRegionBox` fields `position`, `loopOffset` are `Int32`. Passing float PPQN to `RegionEditing.cut()` causes the right region's `position` and `loopOffset` to truncate while the left region's `duration` keeps the fractional part. Always round cut positions: `Math.round(PPQN.secondsToPulses(seconds, bpm))`.

Also round `clipDurationInPPQN` when creating tracks so `loopDuration` is integer.

### Fade-In on Newly Created Regions

Setting `fading.inField` on a region created by `RegionEditing.cut()` / `copyTo()` may not take effect in the audio engine, even when:
- Values read back correctly via adapter getters
- Set in the same `editing.modify()` transaction as the cut

Fade-out on the original (left) region works reliably. Fade-in on the new (right) region does not.

### `consolidate` Parameter

`RegionEditing.cut(adapter, position, consolidate)` — the `consolidate` parameter controls whether the new region gets an independent copy of the event collection (`true`) or shares the original (`false`). It does not affect audio playback quality or the voice pop issue.

### Automation Events at Same Position

The SDK uses `(position, index)` as composite key for automation events. Two events at the same PPQN with the same `index` cause a panic. When building automation with events that may land on the same position (e.g., crossfade boundaries), assign incrementing `index` values per position.

### Non-Overlapping Fades Create Pops

Fade-out + fade-in without overlap creates a V-shaped volume dip at the splice point. For same-file consecutive regions, no fade is needed — the audio samples are already continuous. Adding fades (with or without overlap) can introduce artifacts, especially if the edit point lands at a high-amplitude part of the waveform far from a zero crossing. Fades only help when splicing *different* audio content.

## Fade Experiments (Web Audio)

Tested three fade modes in pure Web Audio (`webaudio-splice-test.html`):

| Mode | Behavior | Result |
|------|----------|--------|
| No fade (fade=0) | Raw consecutive scheduling | Seamless — audio is continuous |
| Non-overlap fade | Fade-out then fade-in at boundary | Pop — V-shaped volume dip at splice |
| Overlap crossfade | Regions overlap, left fades out while right fades in | Smooth for same content, still pops at bad edit points with different content |

## Files

| File | Purpose |
|------|---------|
| `webaudio-splice-test.html` | Standalone Web Audio splice test — proves seamless same-file playback |
| `webaudio-comp-test.html` | Standalone Web Audio comp lanes prototype — proves crossfade approach |
| `src/demos/playback/comp-lanes-demo.tsx` | SDK comp lanes demo using volume automation crossfades |

## Recommendation

The voice fade behavior in `TapeDeviceProcessor` / `PitchVoice` should be suppressed or bypassed when adjacent regions on the same track reference the same audio file and are sample-aligned. This would allow the engine to treat consecutive regions as a continuous audio stream, matching the behavior of raw Web Audio API scheduling.

Until that is addressed, use multi-track volume automation crossfades for any scenario requiring seamless transitions between takes or audio sections.
