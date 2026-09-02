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

The measured error decomposes into three additive terms.

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

**3. An anchor-position residual, roughly 18–35 ms.** `currentPosition` is read once, at
the first `isRecording=true` tick (`RecordAudio.ts`, `currentPosition = owner.getValue()`),
by which time the transport has already advanced. Terms 1 and 2 together account for
about 55 ms in the worked example, and the total measured bias exceeds that by this much
again, varying repeat to repeat.

This residual is **not** a fixed per-session pre-roll constant, and the persisted data
rules that reading out: the raw worklet-connect-to-first-frame lag stays flat at roughly
15–25 ms regardless of whether a given repeat's total bias is at the low or high end of
its cell's range. If the whole error were one pre-roll constant, the two would track
together. What the data supports instead is a fresh frame count paired with a
`currentPosition` read that is already stale by the time the position-tick callback runs.

Terms 2 and 3 are the same problem from two directions: the elapsed-capture measure and
the transport position are both read on the main thread, so both carry its scheduling
lag, and nothing pairs them to a common instant on a single clock.

## Effect of the accompanying fix, and what is left

A change submitted alongside this issue replaces both main-thread reads with anchors
taken on the audio thread. It reduces the bias substantially but **does not eliminate
it**: zero of the twenty cells reach the harness's 2 ms alignment tolerance afterwards.

| scenario | before (fresh upstream) | after | reduction |
|---|---|---|---|
| `nominal-start` | −41.57 to −52.51 ms | −7.67 to −14.55 ms | 71–82 % |
| `countin-start` | −46.04 to −52.26 ms | −9.58 to −22.77 ms | 51–82 % |
| `janked-start` | −45.07 to −49.51 ms | −8.47 to −13.66 ms | 71–81 % |
| `midtimeline-start` | −45.89 to −47.32 ms | −14.08 to −27.38 ms | 42–69 % |
| `loop-wrap` (takes 1–4) | −34.97 to −49.40 ms (2 cells) | −22.66 to −29.52 ms (4 cells) | 35–40 % (over the 2 with a baseline) |

The "after" column comes from `recaudit-summary-1788299505584.json` (48000 Hz) and
`…1788299943226.json` (44100 Hz) and is **analytically corrected from persisted per-row
geometry, not re-measured** — the build layout those runs used no longer exists on disk.
The correction adds each row's own off-grid phase, an identity verified directly on every
row of the campaign where both grids were computed on the same audio. The reduction
percentages are computed against the fresh upstream means in the first column, so the
two columns are on the same grid. Loop-wrap flatness is unchanged by the fix: the largest
within-repeat spread across takes 1–4 over its 12 repeats is 0.142 ms.

**This issue stands on its own.** It reports the 0.0.170 behaviour, which is what the
first table measures. If that change is not taken, the signature above is what remains.
If it is taken, a residual of roughly 8–30 ms remains on every cell and this issue
describes what still needs closing.

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
