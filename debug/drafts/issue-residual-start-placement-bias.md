# Issue draft — recorded takes are placed early on the timeline, on every recording scenario

**Status: DRAFT for user review. Not filed.** Target: `andremichelle/openDAW`.

## Title

Recorded audio takes are placed 35–53 ms early on the timeline, on every scenario
measured, at both sample rates and both tempi

## Symptom

A recorded take does not land where it was played. Content sits **ahead** of the
timeline position the musician performed against, so the head of the performance is
early relative to the downbeat they heard. The offset is consistent rather than random:
it is present on every repeat of every scenario measured, including with a count-in,
with an idle main thread, and on each take of a loop-wrap sequence.

## Measured signature

Live matrix on `@opendaw/studio-sdk@0.0.170`: 5 scenarios × 2 bpms (120, 97.3) × 2 rates
(44100, 48000) × 3 repeats, captured through a synthetic in-context digital loopback so
the measurement carries no real device latency. Placement is judged against the
project's absolute beat grid — integer multiples of the beat period from timeline zero.
A 23 ms harness-path term is netted out of every figure (see "The three terms" below);
the raw values are that much larger again.

Per-cell mean placement error, from the two fresh upstream matrix runs
**`recaudit-summary-1788310164556.json`** (48000 Hz) and **`…1788310817094.json`**
(44100 Hz):

| scenario | cells | mean placement error |
|---|---|---|
| `nominal-start` — arm, record from bar 1, idle main thread | 4 | −41.57 to −52.51 ms |
| `countin-start` — 1-bar count-in | 4 | −46.04 to −52.26 ms |
| `janked-start` — 150 ms main-thread block after the recording flip | 4 | −45.07 to −49.51 ms |
| `midtimeline-start` — punch-in on an already-running transport | 4 | −45.89 to −47.32 ms |
| `loop-wrap` — takes 1–4 of a 5-take loop sequence | 2 | −34.97 to −49.40 ms |

Negative is early. Two of the 20 cells are absent from the `loop-wrap` row because every
repeat of them failed to finalize — a separate defect, filed on its own.

The magnitudes do not separate by scenario: a count-in, a busy main thread and a
mid-timeline punch-in all land in the same band as the plainest case. Nothing here is
rate-dependent or tempo-dependent within measurement scatter.

**Loop-wrap takes are flat, not accumulating.** Within a repeat, consecutive wrap takes
1–4 agree closely: the largest within-repeat spread across takes is **0.136 ms** over the
two surviving upstream repeats (`…1788310164556` 97.3 bpm r1 at 0.079 ms,
`…1788310817094` 120 bpm r2 at 0.136 ms). Each wrap take inherits the same offset rather
than adding to it. The sign is worth noting against the obvious hypothesis: the error is
**early**, not late, so it is not the voice-crossfade restart lag one would expect wrapped
content to show.

## The three terms

Reading `RecordAudio.ts` (0.0.170), the take's `waveformOffset` is built as:

```ts
const wallclockSinceWorklet = recordingWorklet.numberOfFrames / sampleRate
const headStartSeconds = countedIn
    ? Math.max(0, wallclockSinceWorklet - countInSeconds)
    : wallclockSinceWorklet
const waveformOffset = headStartSeconds + countInSeconds + outputLatency + inputLatency
```

The measured error decomposes into four additive terms — three from the source, one
found only by instrumenting the installed build.

**1. `audioContext.outputLatency`, 23 ms — this one belongs to the measurement path,
not to the SDK.** It reads `0.023` identically in every run that persists it and at both
sample rates (`baseLatency` is 2.90–2.92 ms and too small to matter). Compensating for
it is correct for a real speaker → ear → mic path. A digital loopback never incurs it, so
in this harness it is unearned. **It is named here only so the arithmetic below adds up,
and is explicitly not part of the defect being reported** — absolute device latency was
out of the audit's scope, and every figure in the table above already has it netted out.

**2. The uncompensated worklet-connect gap — the dominant term, ~30–35 ms.** The
`RecordingWorklet`'s frame counter starts running at `prepareRecording()`'s
`recordGainNode.connect(recordingWorklet)`, a real wall-clock instant that occurs
**before** the transport's position begins advancing from 0. On the no-count-in path
nothing is subtracted from `wallclockSinceWorklet`, so that pre-roll goes into
`headStartSeconds` in full, on the implicit assumption that the worklet started counting
at the exact instant the transport left position 0. Worked example from a persisted row
of the fresh 48000 Hz matrix run (`recaudit-summary-1788310164556.json`,
`nominal-start`/120 repeat 3): `regionPositionPpqn = 5`, so `regionStartSec = 0.0026042`,
while `waveformOffsetSec = 0.057667`. Netting out term 1 gives
`headStartSeconds = 0.057667 − 0.023 = 0.034667 s`, i.e. **34.7 ms** against a transport
clock reading **2.6 ms** at the same callback — the frame-count clock and the PPQN clock,
read at the same tick, disagree by roughly 13×.

The counted-in branch does subtract `countInSeconds`, per the code's own reasoning, but
it does not subtract this gap — which is why `countin-start` shows the same signature as
`nominal-start` rather than a smaller one.

**3. The observed anchor position.** `currentPosition` is read once, at the first
`isRecording=true` tick (`RecordAudio.ts`, `currentPosition = owner.getValue()`), by which
time the transport has already advanced. Terms 2 and 3 are the same problem from two
directions: the elapsed-capture measure and the transport position are both read on the
main thread, so both carry its scheduling lag, and nothing pairs them to a common instant
on a single clock.

**4. `RecordingWorklet.#finalize` keeps the wrong end of the buffer — 29–43 ms per
recording, random.** The ring delivers whole chunks and runs past the `limit` at stop:
instrumented on 0.0.170 (`recaudit-summary-1788323424682.json`, six `nominal-start`
repeats), the ring held 1407–2048 frames (29.31–42.67 ms) more than the limit at every
`limit()` call, and `#finalize` does `frame.slice(-totalSamples)` — the LAST `limit`
frames. The imported file therefore begins that many frames into the capture, while the
regions address it from frame 0 through `waveformOffset`: every take's content shifts
early by the overshoot. This is the term that varies repeat to repeat (the six raw
medians regress on the six logged drops with a slope of −1.32), and it is invisible to
any anchor arithmetic.

A fifth quantity works against the others: the input path's own delay — on this
harness the loopback hop through `MediaStreamAudioDestinationNode → getUserMedia →
MediaStreamAudioSourceNode`, 10–23 ms and different per stream instance — makes content
LATE, so the early terms above are partially masked on 0.0.170. It is recoverable per
row only on a build that reports the buffer's first-frame time (below).

## Effect of the accompanying fix, and what is left

A change submitted alongside this issue anchors the take on the engine's own report of
where and when recording began (paired with the buffer's first-frame time from the
recording processor), keeps the buffer head in `#finalize`, and always finalizes at
stop. Measured live on that branch through the same harness:

| scenario | before (0.0.170) | after (branch) |
|---|---|---|
| `nominal-start` | −41.57 to −52.51 ms | +6.44 to +19.46 ms |
| `countin-start` | −46.04 to −52.26 ms | +17.44 to +20.25 ms |
| `janked-start` | −45.07 to −49.51 ms | +13.67 to +21.95 ms |
| `midtimeline-start` | −45.89 to −47.32 ms | +17.66 to +21.34 ms |
| `loop-wrap` (takes 1–4) | −34.97 to −49.40 ms (2 cells) | +17.66 to +21.61 ms (4 cells) |

The "after" column comes from `recaudit-summary-1788324358634.json` (48000 Hz) and
`…1788324856598.json` (44100 Hz), 3 repeats per cell, no lost repeats. The magnitude
falls on all 18 comparable cells (to 12–51 % of the 0.0.170 value) and the sign flips to
LATE. What is left is the input path's own delay, quantified per row: the branch reports
the buffer's first-frame time, the harness independently recovers the same instant from
its scheduled reference clicks, and the difference — the loopback hop — is 9.62–22.90 ms,
varying per stream instance. Netting it out leaves +1.13 to +1.19 ms on 59 of 60 rows (one
at +4.07 ms), a rate-independent constant inside the 2 ms tolerance. Loop-wrap flatness is
unchanged: the largest within-repeat spread across takes 1–4 on the branch is 0.141 ms.

**This issue stands on its own.** It reports the 0.0.170 behaviour, which is what the
first table measures. If that change is not taken, the signature above is what remains.
If it is taken, what remains is the input path's delay — on a real device the
`inputLatency` preference's job, which that change does not automate.

## Repro

The harness is an unlisted debug demo in a separate repository, served from a local
HTTPS dev server — **there is no public URL.**

```
recording-alignment-audit-debug-demo.html?scenario=all&bpm=all&rate=<44100|48000>
```

Individual scenarios: `?scenario=<nominal-start|countin-start|janked-start|midtimeline-start|loop-wrap>&bpm=<120|97.3>&rate=<44100|48000>`.
Each run writes a summary JSON and one WAV per repeat.

Outside a synthetic harness the same offset is audible on any recording taken against a
click or existing material.

## Environment

`@opendaw/studio-sdk@0.0.170`, WASM engine, Chrome, macOS. Measured at 44100 and
48000 Hz, 120 and 97.3 bpm.

## Notes

Full campaign register, including the predictions this measurement refuted and the
harness measurement defect found and fixed mid-campaign:
https://github.com/naomiaro/opendaw-test/blob/main/debug/recording-start-alignment-audit.md
(sections "Bring-up calibration" for the decomposition, "Task 7c fix round 1: verdict
re-derived on the absolute grid" for the corrected comparison)
