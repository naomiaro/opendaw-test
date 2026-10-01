# DRAFT — NOT POSTED. For the user to read first (target: andremichelle/openDAW issues).

Notes for the read, not part of the body:
- The repro page URL works once this repo's PR is merged and deployed.
- The browser defect is already on the Chromium tracker (issue 442866743, open); the body
  links it. Its reporter says other browsers do not do it; Firefox 157 was measured here with
  the repro page and reads a true clock, Safari is not measured.
- No fix is suggested, by the repo's rule. The fix idea is in
  `debug/worklet-clock-stale-under-graph-work.md`, last section.
- The rate is the measurement harness's, and the body says so: the harness rebuilds the audio
  chain on every take and builds 120 nodes of its own just before each.

---

**Title:** A take's start-of-take time stamps can be a render quantum early in Chrome: the worklet clock they read stands still while the take's nodes are built

## Symptom

On a rare recording, an audio take lands one render quantum (128 frames, 2.67 ms at 48 kHz)
away from where every other take lands: late when the engine's recording-start time is the
stamp that is off, early when the recording worklet's first-quantum time is. When both are
off they cancel and the take is in place. With several tapes armed, one take can be off while
another is in place, since each has its own recording worklet and all share the engine's
stamp.

Measured in Chrome 154 on macOS, on a harness that records a synthetic loopback in the same
`AudioContext`, where a take's position can be checked against the audio to the frame:

- **As it runs:** 6 take starts in 1020 show a stamp one quantum early: 5 in 789 with two
  tapes armed, 1 in 231 with one tape (which shows only the engine's stamp). 1 in 416 on
  `@opendaw/studio-sdk@0.0.172`, 5 in 604 on 0.0.173, which is no difference at this size; 124
  of the 1020 are at 44.1 kHz, the rest at 48 kHz. Of the five two-tape events, two leave one
  tape's take one quantum late against the other, and in three both stamps are early on both
  tapes and cancel. The one-tape event cannot tell.

  This is the harness's rate, not an application's. Its synthetic device reports no device
  id, so `CaptureAudio` rebuilds the audio chain on every take, and the harness builds and
  connects 120 nodes of its own shortly before each record request. A capture on one named
  device, which keeps its chain, does less graph work at a take's start; a page that builds
  or connects nodes when recording starts does more.
- **Forced:** with the main thread connecting and disconnecting two unrelated gain nodes for
  150 ms from the record request on (0.0.173, 48 kHz, two tapes), 24 of 46 takes carry a stamp
  that is off, by one to three quanta, and 20 are misplaced, between three quanta early and
  one late.

A stamp is only ever early, never late.

## Repro

- The browser behaviour, without the SDK:
  https://opendaw-test.pages.dev/worklet-clock-debug-demo.html — press "Run the probe" with
  the page in a visible window. A worklet's `currentFrame` is checked, call by call, against
  audio in which every sample names its own frame, while the main thread does one kind of work
  at a time. Idle or merely busy: every stamp true. Connecting and disconnecting nodes: 627
  of 3693 quanta read a `currentFrame` one or two quanta old. Building a
  `MediaStreamAudioSourceNode` and connecting it to a fresh worklet node, as the start of a
  take does: 15 of 1825 fresh worklets read their FIRST `currentFrame` early (14 by one
  quantum, 1 by two). Firefox 157 on the same page: every stamp true.
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

In Chrome that clock is not always the time of the block being processed: in some quanta
`currentTime` and `currentFrame` keep the previous quantum's value, then step two quanta in
the next. That is Chromium issue https://issues.chromium.org/issues/442866743 (open). It
happens while the main thread changes the audio graph, and not while it is idle or busy with
other work (measured on the page above). Chromium's source gives the reason: the worklet
scope's frame is copied from the context's at the end of each render quantum only if the audio
graph lock can be taken without waiting
(`BaseAudioContext::UpdateWorkletGlobalScopeOnRenderingThread`, a try-lock), and the main
thread holds that lock while it connects or disconnects a node and while it makes an
`AudioWorkletNode`.

The two stamps are read in the quanta right after `CaptureAudio.prepareRecording` makes the
take's recording worklet and connects the record gain to it (and, when the stream is opened
then, makes and connects its source node), which is exactly such work. Watched on a recorder
that stamps every quantum: in each of three natural events the clock read the same frame on
two calls running, and that frame is the one the stamp that is off carries; none of 804
ordinary takes has a stamp that reads a frame the clock stood on.
