# TO-REVIEW — openDAW issue draft (not posted)

Target: https://github.com/andremichelle/openDAW/issues (new issue)
Status: drafted 2026-10-19 from the 0.0.175 standing sweep; nothing posted. Register section
"Standing sweep on 0.0.175" in `../note.md` has the rows; issue candidate 2 under "Fix round 2"
has the earlier analysis.

---

**Title:** Stopping a recording drops the input still in flight: the take ends at the frames the main thread had received when it observed the stop

**Body:**

A recording stopped with `engine.stopRecording()` keeps only the frames the main thread had already received from `RecordingWorklet` at the moment it observes the stop. Input captured before the stop request but not yet across to the main thread at that moment is dropped. Measured on `@opendaw/studio-sdk` 0.0.175 (Chrome 155, macOS, 48 kHz and 44.1 kHz): 31 of 120 single-tape takes end 0.3–6.6 ms BEFORE the context time of the stop request, and 2 of 16 two-tape repeats end 4.3 and 1.6 ms before it on both tapes.

**Where the cut comes from.** `packages/studio/core/src/capture/RecordAudio.ts`, the terminator that runs when the recording stops: it disconnects the source node from the recording worklet (`sourceNode.disconnect(recordingWorklet)`), reads `recordingWorklet.numberOfFrames`, and sets that as the limit:

```ts
// keep every delivered frame: a limit above them would never be reached and the recording never finalize
recordingWorklet.limit(numberOfFrames)
```

`RecordingWorklet.numberOfFrames` is `#output.length * RenderQuantum`, the chunks the main thread has received so far. The comment says why the limit cannot be set higher — once the source is disconnected no more chunks arrive, and a limit above the delivered count would never be reached. So the take's length is "what had crossed to the main thread when the main thread learned of the stop", not "what was captured until the engine stopped"; the disconnect ends the input at the observation too, and the input between the last delivered chunk and the stop request is what goes missing.

**What changed in 0.0.175 and why it shows now.** The `SyncStream` fix (`b9abd9212`) delivers the engine state on every frame; before it, every second read was lost and the main thread observed `isRecording` going false up to a frame later, during which the ring delivered one more chunk. The margin between the frames counted at the stop request and the limit (`numberOfFrames` at `limit()` minus `numberOfFrames` at the request) read 1408–3712 frames (29–78 ms) on 0.0.174 and reads 640–1920 frames (14.5–43.5 ms) on 0.0.175. The input path in the measurement has a delay of 20–23 ms (a synthetic loopback through a `DelayNode`, measured per take), so on 0.0.174 the margin always covered it and on 0.0.175 it does on about three repeats in four. On every take that lost input, missing tail = input delay − margin, to the tenth of a millisecond. A real input device with a larger latency (a USB interface, Bluetooth) would lose correspondingly more on every release.

**Repro.** https://opendaw-test.pages.dev/recording-alignment-audit-debug-demo.html?scenario=all&bpm=all&rate=48000 (unlisted; a real click on "Run audit", about eight minutes, the tab visible). Each row records a click train through a loopback of known delay on a Tape capture, stops an eighth note before the next click, and reports `tailMissingMs` = the stop request's context time minus the end of the saved buffer; the `finalizeNumberOfFramesAtStop` / `finalizeNumberOfFramesAtLimit` pair per row is the margin above. Rows and the per-release comparison: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-09-02-recording-start-alignment/note.md (section "Standing sweep on 0.0.175").

**Not affected.** Where the take starts (netted placement +1.0…+1.2 ms on every row, identical to 0.0.174), the inter-tape skew of a two-tape recording (0 on every repeat), finalization (every take finalized).
