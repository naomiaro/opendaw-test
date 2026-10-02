# TO REVIEW — for https://github.com/andremichelle/openDAW/issues (new)

**Title:** The loudness meter has no reset: integrated loudness and loudness range accumulate for the life of the engine worklet

## Symptom

Once something has subscribed to `EngineAddresses.LOUDNESS`, the integrated loudness and loudness range it publishes include everything the engine has output since, across stop and play and across anything loaded into the project. Nothing in the engine, the stream or the studio's Analysis panel starts a new measurement: closing the Level card only stops the meter being stepped, and opening it again resumes the same histograms. The only way to an empty meter is a new engine worklet.

EBU Tech 3341 and Tech 3342 both state, for their compliance signals, "The loudness meter shall be reset before each measurement." Integrated loudness is defined over a programme; without a start the number is for whatever has played since the worklet was created.

Seen on `@opendaw/studio-sdk@0.0.173`: a harness that measures the meter against the EBU signals had to restart the worklet before each case (`project.engine.releaseWorklet()`, then `project.startAudioWorklet()`); a case run on a meter that had already measured a −23 dBFS tone reads that tone's history into the next integrated value.

## Repro

- Studio: open the Analysis panel's Level card, play a loud passage, stop, move to a quiet passage and play: I and LRA carry the loud passage. There is no control that clears them.
- Unit level, at the `@opendaw/studio-sdk@0.0.173` tag: `LoudnessMeter` (`packages/studio/core-wasm/src/analysis-dsp.ts`) has `process` and `fill` only. `#integHist` and `#shortHist` (lines 81–82) are only ever added to; `#truePeak` only ever rises. In `processor.ts:157-160` the subscription callback sets `#loudnessActive` and fills the array; nothing recreates or clears the meter when the last subscriber leaves or a new one arrives.

Write-up: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-02-loudness-meter/note.md

## Cause

The meter keeps its gating histograms, its momentary and short-term rings and its peak hold as private state with no entry point to clear them, and the processor holds one instance per worklet (`processor.ts:63`). The stream protocol carries values out of the engine and subscription flags in; there is no message from a subscriber to the meter.

## Related

#203 (Analyser Device) sketches a loudness card with a reset.
