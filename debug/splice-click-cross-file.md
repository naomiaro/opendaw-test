# Cross-file splice click at exact region boundaries

**Verified against:** OpenDAW SDK 0.0.138 (`@opendaw/studio-sdk@0.0.138`, `@opendaw/studio-core@0.0.136`). Audio-processing source unchanged across 0.0.135 → 0.0.138.

**Repro page:** [`comp-lanes-debug-demo.html`](../comp-lanes-debug-demo.html) (unlisted).

## Symptom

Two consecutive `AudioRegionBoxAdapter`s on the same track that share an exact boundary (region A ends at PPQN X, region B starts at PPQN X) produce an audible click at X *if* the two regions reference different audio files and each region's `loopOffset === position`.

The same setup with overlapping regions (region A extended past X by ~20 ms) plays cleanly.

## Mechanism

Numbers below cite `packages/studio/core-processors/src/devices/instruments/` in the SDK source.

1. **The boundary block contains both regions.** In `TapeDeviceProcessor.#processBlock` (lines 104–200), `adapter.regions.collection.iterateRange(p0, p1)` returns A (because `A.complete > p0`) and B (because `B.position < p1`). Both regions push their UUID to `#visitedUuids`, so neither voice is evicted at the end of the block.

2. **A and B write to disjoint sample sub-ranges.** `#processPassPitch` (lines 202–266) advances each voice through its share of the block: A writes samples `[s0..s_X)`, B writes samples `[s_X..s1)`. Output is accumulated with `+=`. There is no overlap and no crossfade.

3. **B is created with `offset === 0`.** Inside `#processPassPitch`, the read offset for the new voice is computed as

   ```
   offset = cycle.resultStartValue * data.numberOfFrames + waveformOffset * data.sampleRate
   ```

   Our `rebuildSpliceRegions` ([`src/lib/compLaneUtils.ts`](../src/lib/compLaneUtils.ts)) sets `loopOffset = position` for every region, so `cycle.resultStartValue = (position - loopOffset) / loopDuration = 0` at B's first cycle. With `waveformOffset = 0` (the default for non-recording regions), the computed `offset` is exactly `0`.

4. **`offset === 0` skips the fade-in.** `PitchVoice.ts:32-38` (constructor):

   ```ts
   if (this.#readPosition >= data.numberOfFrames) {
       this.#state = VoiceState.Done
       this.#fadeDirection = 0.0
   } else if (offset === 0) {
       this.#state = VoiceState.Active
       this.#fadeDirection = 0.0
   } else {
       this.#state = VoiceState.Fading
       this.#fadeDirection = 1.0
   }
   ```

   Introduced by SDK commit `684c5973 start without fade when offset is zero` (2025-12-08). Intent: a region created by `RegionEditing.cut()` reads continuous audio from the same file as its predecessor, so a fade-in would dip the volume and be wrong. The check skips the fade-in when reading from sample 0.

5. **A doesn't fade out at the boundary either.** `#processPassPitch` simply stops writing samples once A's cycles end. `#processBlock` doesn't trigger any eviction in the same block B is created (both UUIDs are in `#visitedUuids`).

6. **Result:** at sample `s_X-1` the output is full-amplitude content from file A; at sample `s_X` it is full-amplitude content from file B. Two unrelated audio streams switching instantaneously at one sample → audible click.

The `offset === 0` fast-path is correct for the *same-file consecutive region* case (cuts, splits, content-continuous chains). It misfires for the *different-file with offset === 0* case because the SDK can't distinguish the two from `offset` alone.

## Workaround (in caller code)

`rebuildSpliceRegions` exposes a `spliceOverlap` parameter that, when `true`, extends each region's duration by `Math.round(PPQN.secondsToPulses(0.020, BPM))` PPQN.

With overlap:

- The boundary block has both A and B in `iterateRange`. They share the 20 ms window after X — both contribute to the output mix.
- When A is finally evicted (in the block where `p0 ≥ X + overlap`), the eviction predicate at `TapeDeviceProcessor.ts:189-194` triggers `voice.startFadeOut(0)` on A.
- Thanks to the 0.0.135 fade-continuity fix (`PitchVoice` tracks `lastFinalAmplitude` and `startFadeOut` initialises `fadeProgress = fadeLength * (1.0 - lastFinalAmplitude)`), A's tail is a clean ramp from full amplitude to silence over `VOICE_FADE_DURATION` (~20 ms).
- The instantaneous content switch is masked because A is still audible during the overlap window, and B's start is no longer the only thing transitioning at the boundary.

This is a *caller-side* mitigation. Nothing in the SDK detects or compensates for the cross-file case.

## How to reproduce

```bash
npm run dev
# open http://localhost:5173/comp-lanes-debug-demo.html
```

1. Click **Static setup: Otherside / ScarTissue (no overlap)**.
   The page loads `Otherside.mp3` (top) and `ScarTissue.mp3` (bottom), places a comp boundary at the PPQN equivalent of 2.32 s, assigns Zone 1 → Otherside and Zone 2 → ScarTissue, switches to splice mode, and forces `spliceOverlap = false`.
2. Press **Play**. The click is audible at 2.32 s.
3. Toggle the **Region overlap** checkbox to apply the 20 ms-overlap workaround. Press Play again. The click is gone.

To reproduce manually without the static-setup button: open [`comp-lanes-demo.html`](../comp-lanes-demo.html), drop two distinct audio files, switch to splice mode, uncheck Region overlap, add a boundary, play.

## Open question for OpenDAW

**Is this expected behaviour, or should the SDK auto-detect cross-file boundaries and force a fade-in?**

Two directions:

- **Treat as expected (current behaviour).** Caller is responsible for providing overlap when consecutive regions on the same track reference different files. The `offset === 0` fast-path is purely an optimisation for content-continuous splits. Document the contract.
- **Auto-handle in the SDK.** When `#updateOrCreatePitchVoice` creates a new voice on a lane, force a fade-in if another voice is currently active or fading on that lane. The heuristic disambiguates the two cases without extra state from the caller.

`RegionEditing.cut()`-style splits (intentional `offset === 0` for content continuity) and explicit comp splices (different files, accidentally `offset === 0`) flow through the same SDK code path. The SDK currently has no signal to disambiguate them.

## Code references (verified in 0.0.138)

- `packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts:104-200` — `#processBlock`, including the eviction predicate at lines 189-194
- `packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts:202-266` — `#processPassPitch`, where the new-voice offset is computed
- `packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts:268-290` — `#updateOrCreatePitchVoice`, the natural place to add a cross-voice fade-in heuristic
- `packages/studio/core-processors/src/devices/instruments/Tape/PitchVoice.ts:20-39` — constructor with the offset-zero shortcut (commit `684c5973`)
- `packages/studio/core-processors/src/devices/instruments/Tape/PitchVoice.ts:46-53` — `startFadeOut` with the 0.0.135 `lastFinalAmplitude` continuity fix
