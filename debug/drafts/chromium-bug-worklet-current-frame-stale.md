# DRAFT — NOT POSTED. For the user to read first.

**Target: a COMMENT on the existing Chromium issue
https://issues.chromium.org/issues/442866743 ("currentTime and currentFrame sometimes freeze
for a render quantum"), not a new bug.**

Notes for the read, not part of the comment:
- The tracker was searched through the user's signed-in Chrome on 2026-10-01
  (`currentFrame AudioWorklet`; `AudioWorklet currentTime (freeze OR stale OR behind OR "try lock")`;
  `UpdateWorkletGlobalScopeOnRenderingThread`). Issue 442866743 is this defect: filed
  2025-09-03 by the author of `standardized-audio-context`, open, P2, hotlist
  WebAudio-spec-compliance. Chromium triage reproduced it on 142.0.7444.162 (Win 11,
  macOS 15.7.2, Linux), 143 beta, 144 dev and canary, and saw it back to M-132. The reporter's
  repro suspends and resumes the context on repeat until the values repeat, and says "there is
  a good chance that it also happens when not suspending/resuming" and "this is just a Chrome
  problem". The issue names no cause. Nothing else on the tracker matches (40099180, 2019, is
  about dropped quanta and is closed; 372866278 is the scope created at frame 0, fixed).
- What this comment adds: a trigger that needs no suspend / resume and shows in seconds, the
  place in the source that explains it, and what it does to a recording application.
- The repro page URL works once this repo's PR is merged and deployed. The page loads nothing
  but React and the probe: no openDAW code.
- The table is from the Playwright MCP's Chrome (`Chrome/154.0.0.0`). One run in the Google
  Chrome that was open on this machine (it reports `Chrome/152.0.0.0`; 154.0.8037.58 is
  installed and waits for a relaunch), in a tab that was NOT in the foreground, so its timers
  were throttled to about one stretch of work a second: idle 0 of 3693, busy 0 of 3693,
  connect/disconnect 21 of 3695 behind (1 to 3 quanta), 14 fresh worklets built, none early
  (`graph-lock-clock-1790885770502.json`). So the stale clock shows there too; the rates in
  the comment need a foreground tab. Run the page once in a visible Chrome window and put that
  browser's exact version in the comment.
- The source lines are at commit `4b38af96d95350e04e831d18f6ba91a2a0cca5d2` (main, 2026-10-01).
  That the try-lock is the reason is read from the source; no run here logged the lock. The
  comment says so.

---

A trigger for this that needs no suspend / resume, and what looks like the reason in the
source.

**Repro.** https://opendaw-test.pages.dev/worklet-clock-debug-demo.html — press "Run the
probe" with the page in a visible window; it takes about 40 seconds.

The page plays, from an `AudioBufferSourceNode` started at a known context frame, a ramp in
which sample *i* holds *(i + 1) / length*, so every sample names its own frame. An
`AudioWorkletProcessor` notes, for every `process()` call, the `currentFrame` it read and the
first sample of its input. The stamp less the frame the sample names is 0 when `currentFrame`
is the frame of the block being processed. Meanwhile the main thread does one kind of work at
a time, in stretches of up to 8 ms with 2 ms between (a stretch of connecting and
disconnecting stops at 1000 pairs). Nothing is played through the speakers and no microphone
is opened.

Chrome 154, macOS 15.6.1 (Apple M4 Pro), 48 kHz, 10 s per condition:

| the main thread | quanta checked | `currentFrame` true | behind | by |
|---|---|---|---|---|
| does nothing | 3693 | 3693 | 0 | |
| runs a loop that touches no audio object | 3693 | 3693 | 0 | |
| connects and disconnects two gain nodes that are in nobody's path | 3693 | 3066 | 627 | 1 to 2 quanta |
| builds a `MediaStreamAudioSourceNode` and connects it to a fresh `AudioWorkletNode`, once per stretch | 3693 | 3677 | 16 | 1 to 2 quanta |

In the last condition each fresh worklet also reports the `currentFrame` of its first call
with the sample it was handed: 15 of 1825 read it one or two quanta early. With
`?conditions=create` the main thread creates gain nodes for the whole stretch: 610 of 3693
quanta behind, by 1 to 26 quanta. No stamp was ahead of its block in any run.

Firefox 157 on the same machine, same page: every stamp true (14774 quanta, 1739 fresh
worklets). In a stale quantum the processor
reads the same `currentFrame` as in its previous call, and two quanta more in the call after,
as described above in this issue. A busy main thread alone does not do it; graph work does,
and it can last several quanta.

**In the source** (`third_party/blink/renderer/modules/webaudio/`, at
`4b38af96d95350e04e831d18f6ba91a2a0cca5d2`; read, not instrumented):

- `realtime_audio_destination_handler.cc:291–293`, `RealtimeAudioDestinationHandler::Render`:
  after a quantum is rendered, `AdvanceCurrentSampleFrame(number_of_frames);` then
  `context->UpdateWorkletGlobalScopeOnRenderingThread();`.
- `base_audio_context.cc:983–998`, `BaseAudioContext::UpdateWorkletGlobalScopeOnRenderingThread`:

  ```cpp
  DeferredTaskHandler::GraphAutoTryLocker try_locker(GetDeferredTaskHandler());
  if (try_locker.IsAcquired()) {
    ...
      global_scope->SetCurrentFrame(CurrentSampleFrame());
  ```

  When the try-lock fails, the scope's `current_frame_` is left as it was, and
  `AudioWorkletGlobalScope::currentTime()` is `current_frame_ / sample_rate_`
  (`audio_worklet_global_scope.cc:296`).
- The main thread holds the graph lock (`DeferredTaskHandler::GraphAutoLocker`) in
  `AudioNode::connect` (`audio_node.cc:157`, `:236`), every `AudioNode::disconnect` overload
  (`:310`–`:538`), `AudioNode::Dispose` (`:74`), `AudioWorkletNode::Create`
  (`audio_worklet_node.cc:200`) and `MediaStreamAudioSourceHandler`
  (`media_stream_audio_source_handler.cc:88`).

That fits everything measured: the clock is only ever behind, by whole quanta, only while the
main thread is in graph calls, and for every processor of the context at once.

**Why it matters in practice.** Code in a worklet that reads `currentTime` or `currentFrame`
once and takes it for the time of its block is off by a quantum (2.67 ms at 48 kHz), or by
several under sustained graph work, whenever the page builds or connects nodes at that moment.
That is the usual situation at the start of a recording: the page creates a recorder worklet,
connects it, and the recorder stamps its first block. In a DAW built on Web Audio this was
measured, on a test harness, as a start-of-recording time stamp one quantum early in 6 of 1020
recording starts, and in two of those as one of two simultaneously recorded tracks placed one
quantum late against the other.
