# Cross-file splice click at exact region boundaries

**Verified against:** OpenDAW SDK 0.0.138 (`@opendaw/studio-sdk@0.0.138`, `@opendaw/studio-core@0.0.136`).

**Repro page:** [`comp-lanes-debug-demo.html`](../comp-lanes-debug-demo.html) (unlisted).

## Symptom

Two consecutive `AudioRegionBoxAdapter`s on the same track that share an exact boundary (region A ends at PPQN X, region B starts at PPQN X) produce an audible click at X when the two regions reference different audio files and each region's `loopOffset === position`.

## Mechanism

Numbers cite `packages/studio/core-processors/src/devices/instruments/` in the SDK source.

1. **The boundary block contains both regions.** In `TapeDeviceProcessor.#processBlock` (lines 104–200), `adapter.regions.collection.iterateRange(p0, p1)` returns A (because `A.complete > p0`) and B (because `B.position < p1`). Both UUIDs are pushed to `#visitedUuids`, so neither voice is evicted at the end of the block.

2. **A and B write to disjoint sample sub-ranges.** `#processPassPitch` (lines 202–266) advances each voice through its share of the block: A writes samples `[s0..s_X)`, B writes samples `[s_X..s1)`. Output is accumulated with `+=`. There is no overlap and no crossfade.

3. **B is created with `offset === 0`.** Inside `#processPassPitch`, the read offset for the new voice is computed as

   ```
   offset = cycle.resultStartValue * data.numberOfFrames + waveformOffset * data.sampleRate
   ```

   With `loopOffset = position` for B (and `waveformOffset = 0`), `cycle.resultStartValue = (position - loopOffset) / loopDuration = 0` at B's first cycle, so the computed `offset` is exactly `0`.

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

   Introduced by SDK commit `684c5973 start without fade when offset is zero` (2025-12-08). Reading the change in isolation, the intent appears to be that a region created by an in-place split (`RegionEditing.cut()`) reads continuous audio from the same file as its predecessor, so a fade-in would dip the volume of otherwise-continuous audio.

5. **A doesn't fade out at the boundary either.** `#processPassPitch` simply stops writing samples once A's cycles end. `#processBlock` doesn't trigger any eviction in the same block B is created (both UUIDs are in `#visitedUuids`).

6. **Result.** At sample `s_X-1` the output is full-amplitude content from file A; at sample `s_X` it is full-amplitude content from file B. Two unrelated audio streams switching instantaneously at one sample → audible click.

## How to reproduce

```bash
npm run dev
# open http://localhost:5173/comp-lanes-debug-demo.html
```

1. Click **Static setup: Otherside / ScarTissue (no overlap)**.
   The page loads `Otherside.mp3` (top) and `ScarTissue.mp3` (bottom), places a comp boundary at the PPQN equivalent of 2.32 s, assigns Zone 1 → Otherside and Zone 2 → ScarTissue, and switches to splice mode with two consecutive same-track regions: A `[0.00s, 2.32s)` reading Otherside, B `[2.32s, 15.48s)` reading ScarTissue.
2. Press **Play**. The click is audible at the 2.32 s boundary.

To reproduce manually without the static-setup button: open [`comp-lanes-demo.html`](../comp-lanes-demo.html), drop two distinct audio files, switch to splice mode, uncheck Region overlap, add a boundary, play.

## Open question for OpenDAW

We hear a click at this boundary. Is this intended behaviour — i.e. the caller is responsible for adding fades on each region to crossfade across cross-file splice points — or is there an automatic voice-management path in the SDK that should be handling this and isn't firing for this case?

If it's the caller's responsibility, the contract worth documenting is: *consecutive same-track regions referencing different audio files require explicit fades on the regions; the SDK will not interpolate at the boundary.*

If it should be automatic, the natural place looks like `#updateOrCreatePitchVoice` (`TapeDeviceProcessor.ts:268-290`) — it already distinguishes "no existing voice" from "existing fading-out voice" from "existing active voice with drift," but it doesn't currently consider whether a *different* voice on the same lane is about to be replaced by this one.

## Code references (verified in 0.0.138)

- `packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts:104-200` — `#processBlock`
- `packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts:202-266` — `#processPassPitch`
- `packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts:268-290` — `#updateOrCreatePitchVoice`
- `packages/studio/core-processors/src/devices/instruments/Tape/PitchVoice.ts:20-39` — constructor with the offset-zero shortcut (commit `684c5973`)
