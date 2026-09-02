# PR description draft — recording start-alignment

**Status: DRAFT for user review. Nothing pushed, no PR opened.**
Target: `andremichelle/openDAW`, branch `fix/recording-start-alignment` in the local
upstream checkout, one commit on top of `origin/main` (`4a9f183f6`).

Every number below was recomputed from the persisted measurement artifacts in
`.verify-output/` by `scripts/audit/recording-alignment/task9-branch-verification.ts`
and each is followed by the file it came from. Both sides of every comparison were
measured live: the "before" side on the installed `@opendaw/studio-sdk@0.0.170`, the
"after" side on this branch built from `main` and served in place of the installed
package through the same harness.

---

## Title

`fix(recording): anchor takes on the engine's own recording start and keep the buffer head`

## Body

### The problem

Audio takes are placed early on the timeline. Measured against the project's
absolute beat grid, the placement bias runs **−34.97 to −52.51 ms** as a per-cell
mean across 18 of the 20 cells of a live matrix on `@opendaw/studio-sdk@0.0.170`
(`recaudit-summary-1788310164556.json` at 48000 Hz, `…1788310817094.json` at
44100 Hz), and no individual take exceeds **−59.33 ms**. It appears on **every**
scenario measured — starting from bar 1 both with and without a count-in, on an
idle and on a blocked main thread, on a mid-timeline punch-in, and on each take of
a loop-wrap sequence — at both sample rates tested (44100, 48000) and both tempi
(120, 97.3 bpm). The two cells without a figure are `loop-wrap` cells where every
repeat failed to finalize (the third defect below).

Content lands early, so the head of a performance sits ahead of the downbeat the
musician played to.

### Where the error comes from

Three things in the recording path produce it, two of them found only by
instrumenting the installed build.

**1. Main-thread anchors.** `RecordAudio.ts` derives the take's `waveformOffset`
from two quantities read on the main thread:

```ts
const wallclockSinceWorklet = recordingWorklet.numberOfFrames / sampleRate
const headStartSeconds = countedIn
    ? Math.max(0, wallclockSinceWorklet - countInSeconds)
    : wallclockSinceWorklet
const waveformOffset = headStartSeconds + countInSeconds + outputLatency + inputLatency
```

`numberOfFrames` counts chunks as the ring reader delivers them and starts at
`prepareRecording()`'s `recordGainNode.connect(recordingWorklet)`, before the
transport leaves its start position; `currentPosition` is the position observed on
the first `isRecording=true` callback, by which time the transport has already
advanced. Both trail the audio thread by the main thread's scheduling lag, and
nothing pairs them to one instant. Worked example, from
`recaudit-summary-1788310164556.json` (`nominal-start`/120 bpm, repeat 3):
`regionPositionPpqn = 5`, so `regionStartSec = 0.0026042`, while
`waveformOffsetSec = 0.057667` — the frame-count clock and the PPQN clock, read at
the same tick, disagree by roughly 13× once the 23 ms `outputLatency` term is netted
out.

**2. `RecordingWorklet.#finalize` kept the wrong end of the buffer.** The ring
delivers whole chunks and runs past the `limit` at stop — on six of six single-take
repeats instrumented on 0.0.170 (`recaudit-summary-1788328085978.json`, per-row
`finalizeOvershootFrames`) the ring held 1535–2431 frames (32.0–50.6 ms) more than
the limit when `limit()` was called — and
`#finalize` did `frame.slice(-totalSamples)`, the LAST `limit` frames. The imported
file therefore began that many frames into the capture, while the regions still
addressed it from frame 0 through `waveformOffset`: every take shifted early by the
overshoot, a per-recording random amount that no anchor arithmetic can see. (The
`onSaved` comment in `RecordAudio.ts` already assumed the truncation happens at the
tail.)

**3. A stop right behind a loop wrap never finalized.** When the current take's
live duration is still `<= 0` at stop — the case immediately after a wrap, while the
ring has not yet delivered past the chained offset — the stop path deleted the
region under the #840 zero-duration rule and never called `limit()`, so `#finalize`
never ran and the loader stayed in `{type: "record"}` indefinitely. Instrumented on
0.0.170 (`recaudit-summary-1788327757434.json`, 6 loop-wrap repeats, per-row
`finalizeLimitCalls` / `finalizeLoaderState`): 4 of 6 never finalized, all four with
no `limit()` call and the loader still in `record` after the wait, while the ring had
kept delivering; both finalized repeats had exactly one call. The placement bias
widens that window, since it inflates every chained waveform offset.

### What the commit changes

- **`EngineToClient.recordingStarted(contextTime, position)`.** The wasm processor
  reports, once per recording and straight from the engine state after `render()`,
  the context time at the END of the quantum in which the transport began recording,
  paired with the playhead position after that quantum — one instant, one message,
  on the channel `switchMarkerState` already uses. `EngineWorklet` keeps it as
  `recordingStart` (an `ObservableOption`, cleared when a recording is prepared),
  `EngineFacade` mirrors it, the `Engine` interface declares it. The sync packet is
  untouched.
- **`RecordingProcessor`** posts the context time of the buffer's first captured
  frame, gated like the ring writer so setup-phase quanta are skipped;
  `RecordingWorklet` exposes it as `firstQuantumTime`.
- **`RecordAudio`** places the first take on the first `isRecording` tick with both
  reports present: `waveformOffset = (start.contextTime − firstQuantumTime) +
  outputLatency + inputLatency`, positioned at `start.position` (floored to the
  integer field with the fraction moved into the offset; a first frame that
  postdates the start moves the take to the first position the audio covers). Only
  after a 0.25 s wait on the context clock does it fall back to the previous
  main-thread arithmetic, with a debug line naming the missing report. Loop-wrap
  takes keep the existing chained offset.
- **The stop path keeps every frame the ring delivered before the source was
  disconnected.** The current take's duration is set to the delivered length (the
  live update only ran on position ticks, and chunks keep arriving between the last
  tick and the stop), `#finalize` keeps the FIRST `limit` frames (`recordedFrames`)
  and the file is limited to exactly the delivered frame count, so the worklet
  finalizes immediately and nothing is dropped at either end — on the branch the
  file ends 24–78 ms after the stop request and the take extends to it. A take whose
  delivered length is still ≤ 0 is dropped and the file still finalizes for the takes
  before it; a recording that leaves no take at all is aborted and its file box
  deleted instead of leaking a loader in the recording state.
- **Tests:** `packages/studio/core/src/capture/RecordAudio.test.ts` (8) — anchored
  placement, fractional position, a first frame after the start, waiting for both
  reports, the fallback after the wait, the stop extending the take to the delivered
  frames, the stop behind a wrap, and the abort; `RecordingWorklet.test.ts` (3) —
  `recordedFrames` on ramp chunks, asserting frame values.

### Measured effect

Live matrix: 5 scenarios × 2 bpms (120, 97.3) × 2 rates (44100, 48000) × 3 repeats
(12 wrap takes per loop-wrap cell), recorded through a synthetic in-context digital
loopback so that the measurement carries no real device latency. Take placement is
judged against the project's **absolute** beat grid, and a harness-path
`outputLatency` term of 23 ms is netted out of the classification math on both sides
equally.

| | per-cell mean placement error | cells |
|---|---|---|
| `@opendaw/studio-sdk@0.0.170` | **−34.97 … −52.51 ms** | 18 (2 lost to the finalization hang) |
| this branch | **+9.33 … +23.77 ms** | 20 |

The magnitude falls on **all 18 comparable cells**, to 18–61 % of the 0.0.170 value,
and the sign flips to late; the per-scenario ranges overlap completely (nominal
9.33–22.36, blocked main thread 15.00–23.77, punch-in 17.00–21.56, count-in
15.44–21.40, loop-wrap 10.78–21.28 ms). Within every loop-wrap repeat, takes 1–4 agree
to ≤ 0.14 ms and take 0 sits within 0.08 ms of their mean. Head and tail integrity:
the harness's head and tail deficits are 0 on all 120 branch rows (0.0.170: head
deficit > 2 ms on 5 of 60 rows, tail 0). The harness's own classifier reads
`investigate` on 12 of the 20 branch cells — its "no band matched" verdict for a late
mean of 15–24 ms — and a known-signature band on the other 8 by coincidence of
magnitude; none of the 20 verdicts is produced by a head or tail deficit.

**What the remainder is.** The branch's `RecordingWorklet.firstQuantumTime` gives
the SDK's own context time of the buffer's first frame; the harness independently
estimates the same instant from reference clicks it schedules on the context and
recovers from the capture. Their difference is the loopback path's own input delay
(`MediaStreamAudioDestinationNode → getUserMedia → MediaStreamAudioSourceNode`):
**9.62–22.92 ms, different per stream instance**, over all 60 take-0 rows. Netting
it out of the adjusted median leaves **+1.13 … +1.19 ms on 59 of 60 rows** (the 60th
is a harness-artifact row, below), a rate-independent constant inside the harness's
2 ms tolerance and consistent with onset-detector latency. The SDK's first captured
frame follows the record request by 0–3 render quanta on every row. On a real input
that delay is what the `inputLatency` preference exists for; this change does not
set it.

Loop-wrap finalization: **0 of 12** repeats on this branch fail against **10 of 12**
on 0.0.170 (both finalize in 72–100 ms when they do). The per-repeat probe on 0.0.170
(`recaudit-summary-1788327757434.json`) shows every hung repeat with no `limit()`
call and the loader still recording; on the branch every repeat has exactly one call
with zero overshoot.

Artifacts: 0.0.170 baseline `recaudit-summary-1788310164556.json` (48000 Hz) and
`…1788310817094.json` (44100 Hz); this branch `…1788328219906.json` (48000 Hz) and
`…1788328656062.json` (44100 Hz), 60 rows each, no error rows. One row per branch
run (`nominal-start`/120/repeat 1, the first cell of each session) was measured with
the harness's `outputLatency` term read as 0 — a harness artifact (Chrome reports 0
until output has started), re-adjusted in the register; the ranges above use the
persisted values. An earlier build of this branch, whose stop path limited the file
to the last position tick's duration, truncated up to 5.8 ms of audio before the
stop request and failed the harness's tail-integrity gate on 94 of 120 rows; that is
the reason the stop path now keeps every delivered frame, and those runs are kept in
the register as history.

### What this does not fix

Each of the following is reported as its own issue, so none of them depends on this
change being taken.

> **Draft-internal, strip before posting.** The bullets below map to
> `issue-residual-start-placement-bias.md` and `issue-take-collision.md`, in that
> order. Replace each with the filed issue number once the issues exist.
> (`issue-loop-wrap-finalization-hang.md`, `issue-punch-in-head-loss.md` and
> `issue-inter-track-quantum-skew.md` were withdrawn in Task 9 — the hang is fixed
> here, the "head loss" was the `#finalize` head drop, and the skew is the two
> loopback streams' delay difference — and sit under `debug/drafts/withdrawn/`.)

- **The input path's own delay is not compensated automatically.** After this
  change the takes on the harness sit late by exactly the loopback's input delay
  (10–23 ms here). On a real device that is the `inputLatency` preference's job; the
  issue records the 0.0.170 signature and what remains afterwards.
- **A content-address collision on simultaneous identical takes**, which panics
  `BoxGraph.stageBox` and hangs the affected capture's finalization — unchanged: 6 of
  12 simultaneous-capture repeats on the two 0.0.170 runs
  (`recaudit-mt-summary-1788302627819.json`, `…1788302870379.json`) and 9 of 18 on the
  three runs on this branch (`…1788325292003.json`, `…1788325557229.json`,
  `…1788329084394.json`).

Inter-track skew between simultaneously armed captures, measured at ±1 render quantum
on 0.0.170, is not listed: on this branch each tape's residual after netting its own
input delay is identical (+1.15 ms on both tapes of every successful repeat) and the
measured skew equals the difference of the two loopback streams' delays exactly, so
with both captures anchored on the same `recordingStarted` instant there is no SDK-side
skew left to report.

### Reproducing the measurement

The harness is an unlisted debug demo in a separate repository and runs only on a
local HTTPS dev server — **there is no public URL for it.**

```
recording-alignment-audit-debug-demo.html?scenario=<name|all>&bpm=<n|all>&rate=<44100|48000>
```

Scenarios: `nominal-start`, `janked-start`, `midtimeline-start`, `countin-start`,
`loop-wrap`, plus `multitrack-start` / `multitrack-janked` for the simultaneous-capture
cells. Each run writes a summary JSON and one WAV per repeat; the offline
recomputation of every figure above is
`scripts/audit/recording-alignment/task9-branch-verification.ts`.

Full campaign register, including every prediction that was refuted or withdrawn and
the harness measurement defects that were found and fixed mid-campaign:
https://github.com/naomiaro/opendaw-test/blob/main/debug/recording-start-alignment-audit.md

### Verification

- `npx turbo run build --filter=@opendaw/studio-core --filter=@opendaw/studio-core-processors --filter=@opendaw/studio-core-workers` — 16 tasks successful, no TypeScript errors.
- `npm run build:bundles` in `packages/studio/core-wasm` — both bundles emitted.
- `npm run typecheck` in `packages/studio/core-wasm` — zero errors in `src/`; the
  pre-existing set under `test/` is identical before and after the change.
- `npm test` in `packages/studio/core` — 45 files, 411 tests passing (400 before this
  change plus the 11 new ones).
- The live matrix above, on this branch built from `main`.

A Rust rebuild is not required: the change is entirely JS/TS. `write_engine_state` and
its byte-offset constants are untouched; the processor reads the recording flag and
position from the same state buffer it already decodes for the sync packet.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
