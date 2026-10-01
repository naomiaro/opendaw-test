# DRAFT — NOT POSTED. For the user to read first (target: andremichelle/openDAW issues).

Notes for the read, not part of the body:
- The repro page URL works once this repo's PR is merged and deployed.
- The body says "Chrome": Firefox and Safari are not measured yet. If the page reads
  `STALE CLOCK` there too, change "In Chrome" to "In Chrome, Firefox and Safari" (or as measured).
- No fix is suggested, by the repo's rule. The fix idea is in
  `debug/worklet-clock-stale-under-graph-work.md`, last section.

---

**Title:** A take's start-of-take time stamps can be a render quantum early in Chrome: the worklet clock they read stands still while the take's nodes are built

## Symptom

On a rare recording, an audio take lands one render quantum (128 frames, 2.67 ms at 48 kHz)
away from where every other take lands: late when the engine's recording-start time is the
stamp that is off, early when the recording worklet's first-quantum time is. When both are
off they cancel and the take is in place. With several tapes armed, one take can be off while
another is in place, since each has its own recording worklet and all share the engine's
stamp.

Measured on `@opendaw/studio-sdk@0.0.173` (Chrome 154, macOS, 48 kHz), two tapes recording a
synthetic loopback in the same `AudioContext`, where a take's position can be checked against
the audio to the frame:

- as it runs: 6 take starts in 1020 show a stamp one quantum early (1 in 416 on 0.0.172, 5 in
  604 on 0.0.173); in two of them one tape's take is one quantum late, in three the two stamps
  cancel on both tapes;
- with the main thread connecting and disconnecting two unrelated gain nodes for 150 ms from
  the record request on: 24 of 46 takes carry a stamp that is off, by one to three quanta, and
  20 are misplaced, between three quanta early and one late.

A stamp is only ever early, never late.

## Repro

- The browser behaviour, without the SDK:
  https://opendaw-test.pages.dev/worklet-clock-debug-demo.html — press "Run the probe". A
  worklet's `currentFrame` is checked, call by call, against audio in which every sample names
  its own frame, while the main thread does one kind of work at a time. Idle or merely busy:
  every stamp true. Connecting and disconnecting nodes: 1813 of 4444 quanta read a
  `currentFrame` one to four quanta old. Building a `MediaStreamAudioSourceNode` and connecting
  it to a fresh worklet node, as the start of a take does: 15 of 2210 fresh worklets read
  their FIRST `currentFrame` a quantum early.
- With the SDK: record with two tapes armed while the page does graph work at the record
  request (connect / disconnect of any nodes), and compare the takes against a known signal.

Write-up, with the runs and the per-row figures:
https://github.com/naomiaro/opendaw-test/blob/main/debug/worklet-clock-stale-under-graph-work.md

## Cause

Both start-of-take stamps are a single read of the worklet scope's clock inside one
`process()` call:

- the engine's recording start, `packages/studio/core-wasm/src/processor.ts`
  `#announceRecordingStart`: `currentTime + RenderQuantum / sampleRate` on the first render
  that leaves the recording flag set;
- the recording worklet's first quantum, `packages/studio/core-processors/src/RecordingProcessor.ts`
  `process`: `currentTime` on the first call whose input has the expected channel count.

`RecordAudio` places the take by their difference
(`startOffset = contextTime − firstQuantumTime + outputLatency + inputLatency`).

In Chrome that clock is not always the time of the block being processed. Chromium copies the
context's frame into the worklet scope at the end of each render quantum only if it can take
the audio graph lock without waiting
(`BaseAudioContext::UpdateWorkletGlobalScopeOnRenderingThread`, a try-lock). The main thread
holds that lock while it connects or disconnects a node and while it makes an
`AudioWorkletNode`. When the two coincide, every `process()` call of the next quantum, in every
processor, reads the previous quantum's `currentFrame` and `currentTime`.

The two stamps are read in the quanta right after `CaptureAudio.prepareRecording` makes the
take's recording worklet and connects the record gain to it (and, when the stream is opened
then, makes and connects its source node), which is exactly such work. Watched on a recorder
that stamps every quantum: in each of three natural events the clock read the same frame on
two calls running, and that frame is the one the stamp that is off carries; none of 804
ordinary takes has such a read at either of its stamps.
