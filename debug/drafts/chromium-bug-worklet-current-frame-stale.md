# DRAFT — NOT POSTED. For the user to read first (target: issues.chromium.org, component Blink>WebAudio).

Notes for the read, not part of the body:
- **An existing report was looked for and not found, but the tracker itself could not be
  searched** (it needs a sign-in). Web searches for `UpdateWorkletGlobalScopeOnRenderingThread`,
  "AudioWorkletGlobalScope currentFrame stale / try lock / does not advance" found no report of
  this. The nearest is issue 372866278 (the scope was created with `currentFrame` 0; fixed by
  passing the frame at construction), which is a different defect in the same value. Search
  the tracker for `currentFrame AudioWorklet` before filing.
- The repro page URL works once this repo's PR is merged and deployed. The page loads nothing
  but React and the probe: no openDAW code.
- The table is from the Playwright MCP's Chrome (`Chrome/154.0.0.0`). One run in the Google
  Chrome that was open on this machine (it reports `Chrome/152.0.0.0`; 154.0.8037.58 is
  installed and waits for a relaunch), in a tab that was NOT in the foreground, so its timers
  were throttled to about one stretch of work a second: idle 0 of 3693, busy 0 of 3693,
  connect/disconnect 21 of 3695 behind (1 to 3 quanta), 14 fresh worklets built, none early
  (`graph-lock-clock-1790885770502.json`). So the stale clock shows there too; the rates in
  the body need a foreground tab. Run the page once in a visible Chrome window and put that
  browser's exact version in the body. Not measured: Firefox 155.0, Safari 18.6 (both
  installed here).
- The source lines are at commit `4b38af96d95350e04e831d18f6ba91a2a0cca5d2` (main, 2026-10-01).

---

**Title:** AudioWorkletGlobalScope `currentFrame` / `currentTime` are a render quantum behind in any quantum that follows one at whose end the main thread held the graph lock

**Component:** Blink>WebAudio

## Steps to reproduce

1. Open https://opendaw-test.pages.dev/worklet-clock-debug-demo.html
2. Press "Run the probe" and wait about 50 seconds.

The page creates an `AudioContext` and plays, from an `AudioBufferSourceNode` started at a
known context frame, a ramp in which sample *i* holds *(i + 1) / length*: every sample names
its own frame. An `AudioWorkletProcessor` notes, for every `process()` call, the
`currentFrame` it read and the first sample of its input. The frame the quantum really is
follows from the sample; the stamp less that frame is 0 when `currentFrame` is the frame of the
block being processed. Meanwhile the main thread does one kind of work at a time, 8 ms at a
stretch with 2 ms between. Nothing is played through the speakers and no microphone is opened.

## Expected

Every `process()` call reads the `currentFrame` of the block it is handed, whatever the main
thread does. Web Audio API, `AudioWorkletGlobalScope`:

> `currentFrame`: The current frame of the block of audio being processed. This must be equal
> to the value of the `[[current frame]]` internal slot of the `BaseAudioContext`.
>
> `currentTime`: The context time of the block of audio being processed.

## Actual

Chrome 154, macOS 15.6.1 (Apple M4 Pro), 48 kHz, 12 s per condition:

| the main thread | quanta checked | `currentFrame` true | behind | by |
|---|---|---|---|---|
| does nothing | 4443 | 4443 | 0 | |
| runs a loop that touches no audio object | 4443 | 4443 | 0 | |
| connects and disconnects two gain nodes that are in nobody's path | 4444 | 2631 | 1813 | 1 to 4 quanta |
| creates gain nodes | 4443 | 3641 | 802 | 1 to 10 quanta |
| builds a `MediaStreamAudioSourceNode` and connects it to a fresh `AudioWorkletNode`, once per stretch | 4443 | 4422 | 21 | 1 to 4 quanta |

In the last condition each fresh worklet also reports the `currentFrame` of its first call
with the sample it was handed: 15 of 2210 read it one or two quanta early (44 of 12003 in a
60-second run). No stamp was ahead of its block in any run. In a stale quantum the processor
reads the same `currentFrame` as in its previous call, and two quanta more in the call after.

A busy main thread alone does not do it; graph work does.

## Analysis

`third_party/blink/renderer/modules/webaudio/`, at `4b38af96d95350e04e831d18f6ba91a2a0cca5d2`:

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

  When the try-lock fails, the scope's `current_frame_` is left as it was.
- `audio_worklet_global_scope.cc:296`: `currentTime()` is `current_frame_ / sample_rate_`.
- The main thread holds the graph lock (`DeferredTaskHandler::GraphAutoLocker`) in
  `AudioNode::connect` (`audio_node.cc:157`, `:236`), every `AudioNode::disconnect` overload
  (`:310`–`:538`), `AudioNode::Dispose` (`:74`), `AudioWorkletNode::Create`
  (`audio_worklet_node.cc:200`) and `MediaStreamAudioSourceHandler`
  (`media_stream_audio_source_handler.cc:88`).

So when the main thread is inside one of those at the moment a quantum ends, the next quantum's
`process()` calls, in every processor of the context, read the previous quantum's
`currentFrame` and `currentTime`.

## Impact

Code in a worklet that reads `currentTime` or `currentFrame` once and takes it for the time of
its block is off by a quantum (2.67 ms at 48 kHz), or by several under sustained graph work,
whenever the page builds or connects nodes at that moment. That is the usual situation at the
start of a recording: the page creates a recorder worklet, connects it, and the recorder
stamps its first block. In a DAW built on Web Audio this was measured as a start-of-recording
time stamp one quantum early in 6 of 1020 recording starts, and in two of those as one of two
simultaneously recorded tracks placed one quantum late against the other.
