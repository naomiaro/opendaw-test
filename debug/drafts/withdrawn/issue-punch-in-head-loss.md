# Issue draft — the first 12–49 ms after a record request is never captured

**Status: DRAFT for user review. Not filed.** Target: `andremichelle/openDAW`.

## Title

Recording captures nothing for the first 12–49 ms after the record request, so a
punch-in loses the head of the punched beat

## Symptom

Audio present at the input when recording is requested does not reach the capture
buffer. The buffer's first captured frame lands some tens of milliseconds after the
request, and that window of content is simply absent — it is not misplaced, it was never
recorded.

On a recording that starts from bar 1 with the transport stopped this is invisible:
nothing was being played yet. It becomes audible on a **punch-in**, where the transport
is already running and the performer is already playing. The head of the punched-in note
or beat is clipped off the front of the take.

## Mechanism

`RecordingWorklet`'s capture path is connected inside `startRecording`'s async chain —
`CaptureAudio.prepareRecording()` performs the
`recordGainNode.connect(recordingWorklet)`, and `Recording.start` awaits that
`prepareRecording()` before the transport actually starts. Connecting an
`AudioWorkletNode` and getting its first quantum through the ring buffer is not
instantaneous: the Promise resolution and the worklet-connect message-passing setup both
have to complete before any frame is written.

So the gap between the instant the record request is issued and the instant the first
frame lands in the ring is real elapsed time during which the capture path is not yet
live. Recording genuinely had not started yet, so no content is "dropped" by a bug — it
was never in scope of the capture. The consequence for the user is the same either way:
on a punch-in, the audio they were playing at the moment they hit record is gone.

## Measured signature

Measured as `headMissingRawMs`: the context time of the capture buffer's first frame
minus the context time at which the record was requested, persisted per take row.

Across **351 rows carrying the field, over 40 measurement runs**:

| scenario | rows | min | median | max |
|---|---|---|---|---|
| `nominal-start` | 51 | 9.68 ms | 19.02 ms | 177.04 ms |
| `countin-start` | 39 | 10.59 ms | 21.71 ms | 35.71 ms |
| `janked-start` | 69 | 9.93 ms | 19.69 ms | 179.69 ms |
| `midtimeline-start` (punch-in) | 48 | **12.21 ms** | **20.42 ms** | **49.04 ms** |
| `loop-wrap` | 144 | 7.69 ms | 17.37 ms | 41.02 ms |

**Every scenario carries it**, at a median within 4 ms of every other scenario's. The
punch-in row is the one where a user notices, because it is the only scenario where the
transport is already running and content already exists at the input.

The three rows above 100 ms are outliers of an occasional capture-start stall rather than
this steady-state lag; they occur on both builds and include one on a scenario that runs
no main-thread provocation at all.

**The measurement harness calibrates this out, and that calibration is where the numbers
come from.** `HEAD_MISSING_BASELINE_MS = 26` (persisted as `headMissingBaselineMs` in
every run) is subtracted from the raw value before any classification sees it, precisely
because this lag is present on every scenario and is not what the alignment audit was
measuring. Both the raw and the corrected value are persisted on every row, which is why
the raw distribution above is recoverable at all.

**The take-placement fix does not change it.** Split by build, `midtimeline-start`'s raw
head lag is **12.21–38.37 ms, median 19.04 ms** over 24 rows on the unfixed build and
**12.51–49.04 ms, median 23.04 ms** over 24 rows on a build carrying the accompanying
placement fix. That fix corrects where a take is *placed*; it does not move when the
capture path goes live, and the two distributions overlap completely.

Artifacts: all 40 `recaudit-summary-*.json` runs in the campaign's output directory
carry the per-row field. The `midtimeline-start` per-build split is over the eight matrix
runs that produced midtimeline rows, of which the four fresh ones are
`recaudit-summary-1788306957902.json`, `…1788307078098.json`, `…1788310164556.json` and
`…1788310817094.json` (unfixed build) and the candidate rows come from
`…1788296570300.json`, `…1788297229626.json`, `…1788299505584.json` and
`…1788299943226.json`.

## Not evidence for this, stated so it is not mistaken for it

Six rows elsewhere in the campaign reported a missing beat and could not be resolved —
their capture buffers are gone. They are recorded as unresolved, and they are **not**
cited here in either direction. This issue rests only on the `headMissingRawMs`
distribution above, which is a direct measurement of the request-to-first-frame interval
and does not depend on beat matching at all.

## Repro

The harness is an unlisted debug demo in a separate repository, served from a local
HTTPS dev server — **there is no public URL.**

```
recording-alignment-audit-debug-demo.html?scenario=midtimeline-start&bpm=120&rate=48000
```

That scenario starts the transport, waits for a target position, then requests recording
while playback continues. Every repeat persists `headMissingRawMs` alongside
`recordRequestContextTime` and the buffer's own duration, so the interval is readable
directly from the summary JSON without re-deriving it. The other four scenarios show the
same interval; only the punch-in one has content at the input to lose.

## Environment

`@opendaw/studio-sdk@0.0.170`, WASM engine, Chrome, macOS. Measured at 44100 and
48000 Hz, 120 and 97.3 bpm. The interval is not rate- or tempo-dependent within scatter.

## Notes

Full campaign register, with the calibration derivation and the per-run data:
https://github.com/naomiaro/opendaw-test/blob/main/debug/recording-start-alignment-audit.md
(sections "`HEAD_MISSING_BASELINE_MS` (worklet-connect-to-first-frame setup lag)" and
"Note: a real, small head loss on punch-in (not the missing beat)")
