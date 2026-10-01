# DRAFT — NOT POSTED. For the user to read first (target: andremichelle/openDAW issues).

Notes for the read, not part of the body:
- The repro page URL works once this repo's PR is merged and deployed.
- The browser defect is already on the Chromium tracker (issue 442866743, open); the body
  links it. Its reporter says other browsers do not do it; Firefox 157 and Safari 18.6 were measured
  here with the repro page and read a true clock.
- No fix is suggested, by the repo's rule. The fix idea is in
  `debug/2026-10-01-worklet-clock-stale/note.md`, last section.
- The rate is the measurement harness's, and the body says so: the harness rebuilds the audio
  chain on every take and builds 120 nodes of its own just before each.
- The "Related" section at the end links the maintainer's comment on PR #380 (added
  2026-10-01 at the user's request). It claims two things only: #418 removes one piece of
  graph work at a take's start without touching either stamp, and two one-quantum readings
  in #380's calibration measurements MAY be this clock. Neither effect is measured, and the
  section says so. The ~24 ms page-load variation that comment speaks of is not this: a
  quantum is 2.67 ms.

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
  quantum, 1 by two). Firefox 157 and Safari 18.6 on the same page: every stamp true.
- With the SDK: record with two tapes armed while the page does graph work at the record
  request (connect / disconnect of any nodes), and compare the takes against a known signal.

Write-up, with the runs and the per-row figures:
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-01-worklet-clock-stale/note.md

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

## Related

https://github.com/andremichelle/openDAW/pull/380#issuecomment-5700363981, the comment on
#380 that asked for the capture-chain fixes as their own PR (now #418) and questioned how far
a stored calibration can be trusted in Chrome. It touches this in two places:

- **#418's stream reuse.** With it, a capture that names no device keeps its stream, so
  `prepareRecording` no longer builds a `MediaStreamAudioSourceNode` before every take. That
  is one piece of the graph work described above gone from a take's start. The take's
  recording worklet is still made and connected on every take, and neither stamp is in code
  #418 changes, so the stamps stay open to the stale clock. Whether #418 makes the event
  rarer is not measured: the harness's tapes name a device, and their chain is rebuilt either
  way.
- **The calibration in #380.** This is a second way timing on the capture path moves in
  Chrome, apart from the variation between page loads that comment refers to (which is far
  larger than a quantum and is not this). The calibration measurements include two readings
  one quantum off (one call a quantum short, a second anchor a quantum off in 1 of 152
  calls). They may be the same clock; that has not been checked.
