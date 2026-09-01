# Recording Start-Alignment Audit — campaign register & results

**Title:** Recording Start-Alignment Audit — campaign register & results

**SDK Pin:** `@opendaw/studio-sdk@0.0.170` (installed npm package; WASM engine only)

**Harness:** unlisted debug demo `recording-alignment-audit-debug-demo.html?scenario=<name|all>&bpm=<n|all>&rate=<44100|48000>`
on the dev server (`?scenario=probe` runs the same-context loopback feasibility probe
instead of the matrix). Measurement library: `src/lib/audit/recordingAlignment.ts`;
calibration constants: `src/lib/audit/recordingAuditCalibration.ts`. WAV
(`recaudit-<scenario>-<bpm>-<rate>-r<repeat>.wav`) and JSON
(`recaudit-summary-<timestamp>.json`) uploads land in `.verify-output/` via the dev
server's `/__verify` sink.

**Design Spec:** `docs/superpowers/specs/2026-09-01-recording-start-alignment-audit-design.md`
(deleted in the PR that completes this work, per repo convention — recovery:
`git log --all --oneline -- 'docs/superpowers/specs/*recording-start-alignment*'`)

## Predicted upstream signatures (spec §1)

Predictions derived from code analysis of `packages/studio/core/src/capture/RecordAudio.ts`
(0.0.170) plus prior local loopback calibration measurements — predictions to test, not
truths.

| ID | Failure mode | Predicted upstream signature |
|----|--------------|------------------------------|
| A | Take anchored at first-*observed* position, not the start position. `Recording.wasStartingAt()` exists upstream (added for issue #183) but is never consulted here. | Head of the performance cut off the downbeat / shifted; loss grows with main-thread observation lag. Content before the first callback exists in the capture buffer but the placed region skips it. |
| B | `numberOfFrames` ring-reader delivery lag used as the elapsed-capture clock. | Random ~±15 ms placement band across repeated nominal recordings. |
| C | No bounded wait for an audio-thread anchor before creating the take — the laggy fallback is accepted immediately. | Under main-thread load, take placement errors of ~50–235 ms. |
| D | Loop-wrap takes: rendered audio of each wrapped cycle emerges one voice-crossfade + one render quantum late (`BlockFlag.discontinuous` restarts voices behind a ~10 ms fade), uncompensated. | Each wrap take's content lands ~20–24 ms late within its window, flat across consecutive takes (not accumulating). |

## Scenario → prediction map

| Scenario | Provokes | Procedure |
|----------|----------|-----------|
| `nominal-start` | B | Arm, start recording from bar 1 with an idle main thread. |
| `janked-start` | A + C | Same, but a synchronous busy-loop blocks the main thread from just before the record trigger until well past the expected first callback (150 ms). |
| `midtimeline-start` | A | Transport already playing; recording engaged mid-timeline. |
| `countin-start` | A/B interaction | Recording with a 1-bar count-in. |
| `loop-wrap` | D | Loop region active; record 5 consecutive wrap takes; per-take content lateness measured independently. |

Matrix: 2 sample rates (44100, 48000) × 2 BPMs (120, 97.3) × 5 scenarios × 3 repeats
(5 for loop-wrap's take count), live-only.

## Outcome summary

_(filled in Step 5 — triage)_

## Bring-up calibration

Control cell: `nominal-start`, 120 bpm, 48000 Hz. Three fresh-page-load runs (9 repeats
total) plus the Task 4 smoke run (3 repeats) — 12 repeats of evidence.

### CRITICAL bring-up question: is the harness's loopback path introducing a bias?

**Hypothesis tested:** the SDK's `waveformOffset` math compensates for
`audioContext.outputLatency`, designed for a physical speaker→ear→mic path that this
harness's digital loopback never incurs, so takes should land EARLY by exactly
`outputLatency`.

**Measured `audioContext.outputLatency` / `baseLatency`** (logged as strings on every
run, identical across 4 separate page loads): `outputLatency=0.023` (23 ms),
`baseLatency=0.0029166...` (2.92 ms).

**Result: hypothesis REFUTED by magnitude.** Measured `medianBeatErrorMs` across all 12
nominal-start repeats: -105.54, -91.54, -86.88 (Task 4 smoke), -92.23, -84.21, -91.54,
-73.54, -99.54, -80.21 (this task's 9). Mean ≈ -89.2 ms, range -73.5..-105.5 ms (spread
≈ 32 ms). 23 ms of `outputLatency` cannot produce an ~89 ms bias — off by ~4x. The
loopback-path-bias correction the brief's hypothesis proposed was **not implemented**;
subtracting ~23 ms would have left ~66 ms of unexplained bias uncorrected while
disguising the cell as "calibrated."

### Actual mechanism (found by reading `RecordAudio.ts`, confirmed against live diagnostic values)

Added a temporary-turned-permanent diagnostic log (`[recording-alignment-audit] diag
...`) printing the raw box-graph values behind every alignment number. Example
(`nominal-start/120/r1`, second bring-up run): `position=5` (region PPQN),
`regionStartSec=0.0026042`, `waveformOffsetSec=0.055000`, `anchorT0Sec=0.099688`,
`recordRequestContextTime=0.077333`, `medianBeatErrorMs=-73.5417`.

`RecordAudio.ts:270-274` (installed 0.0.170, `openDAWOriginal` checkout at the pinned
tag):
```
const wallclockSinceWorklet = recordingWorklet.numberOfFrames / sampleRate
const headStartSeconds = countedIn
    ? Math.max(0, wallclockSinceWorklet - countInSeconds)
    : wallclockSinceWorklet
const waveformOffset = headStartSeconds + countInSeconds + outputLatency + inputLatency
```
For the **counted-in** path, `wallclockSinceWorklet` (the RecordingWorklet's own frame
counter — how much audio it has captured since being connected, read at the first
`isRecording=true` position-tick) has the deterministic `countInSeconds` subtracted out,
per the code's own comment: "L is recovered once, here, by reading `numberOfFrames` at
the moment we first see `isRecording=true` and subtracting the BPM-derived
`countInSeconds`." For the **no-count-in** path (this cell), there is nothing to
subtract — `headStartSeconds` is `wallclockSinceWorklet` **in full**, on the implicit
assumption that the RecordingWorklet started counting frames at the exact instant the
transport began advancing from position 0.

That assumption is measurably false. `region.position` (read from the SAME position-tick
callback, via the engine's transport/PPQN clock) converts to `regionStartSec=2.6 ms` in
the example above — i.e. the transport clock says only ~2.6 ms had elapsed at that tick.
But `waveformOffsetSec=55.0 ms`, and with `outputLatency=23 ms` subtracted,
`headStartSeconds≈32 ms` — the RecordingWorklet's own frame-count clock says ~32 ms had
elapsed at the SAME tick. The two clocks, which should agree (both driven off the same
audio-thread render loop), disagree by roughly 12x in this example. The worklet's frame
counter is running from `prepareRecording()`'s `recordGainNode.connect(recordingWorklet)`
call (`CaptureAudio.ts:200`) — which happens some real wall-clock time BEFORE the
transport's position actually begins advancing from 0 — and that pre-roll gap is baked
directly into `headStartSeconds`, uncompensated, for the no-count-in path. This is
exactly predicted signature **B**'s mechanism ("`numberOfFrames` ring-reader delivery lag
used as the elapsed-capture clock") — confirmed live, via source code and direct
measurement — but the measured magnitude (mean ≈ 89 ms, up to 105.5 ms) is **3.5-6.5x**
the predicted band's ceiling (25 ms). See "Predictions" below and the Triage section.

**Decision: no loopback-path bias correction was applied.** This bias is upstream SDK
behavior under audit, not a harness artifact — subtracting it would hide the exact class
of defect this campaign exists to measure. `LOOPBACK_PATH_BIAS`/`loopbackPathBiasMs()`
as originally proposed was **not implemented** (would have been evidence-free — the
9-repeat control cell disproves the specific `outputLatency` mechanism it assumed).

### `ALIGNED_TOLERANCE_MS` (detector/graph-path noise floor)

Added a `clockNoise` diagnostic: `identifyReferenceClicks` residuals (each identified
click's `schedule.times[i] − fileTimeSec`, relative to the median anchor) — pure
onset-detection + zero-phase band-split jitter, independent of any SDK placement math
(the reference clicks are synthetic oscillator bursts at exact scheduled `AudioContext`
times). Measured across all 3 runs: `identifiedClicks=26`, `maxAbsResidualMs=0.0000` (sub-
float-precision on every run — residual arrays print as `0.000`/`-0.000` throughout, e.g.
run at 11:25:22: `[-0.000,-0.000,-0.000,-0.000,0.000,0.000,...]`). 2x that is far under
the 2 ms floor. **`ALIGNED_TOLERANCE_MS` stays at 2 ms (unchanged)** — the provisional
value was already correctly calibrated; no revision needed.

### `HEAD_MISSING_BASELINE_MS` (worklet-connect-to-first-frame setup lag)

Raw `headMissingMs` (buffer-start context time vs. `recordRequestContextTime`) across all
12 nominal-start repeats: 25.02, 16.35, 17.02 (Task 4), 17.04, 17.02, 16.35, 22.35, 16.35,
15.69 (this task's 9). Range 15.69-25.02 ms, mean ≈ 18.1 ms — this is NOT random detector
noise (the clockNoise measurement above rules that out); it is the genuine async gap
between the JS `startRecording()` call and the RecordingWorklet's first captured frame
reaching the ring buffer (Promise/worklet-connect message-passing setup — recording
genuinely had not started yet at `recordRequestContextTime`, so no content was lost).
Added `HEAD_MISSING_BASELINE_MS = 26` (just above the measured max) to
`recordingAuditCalibration.ts`, subtracted from every take's raw `headMissingMs` via a
new `headMissingBaselineMs` field on `measureTakeAlignment`'s input
(`src/lib/audit/recordingAlignment.ts`) before `classifyCell` ever sees it. Re-verified
live: post-calibration `headMissingMs` on a fresh control-cell run read `0.00, 0.00,
7.02` ms (the third repeat's small residual above baseline is ordinary additional
jitter, not a sign the correction under-fires). Scenarios that DO predict genuine
head-loss (A: `janked-start` 20-300 ms, `midtimeline-start` 5-300 ms) remain trivially
distinguishable from this 26 ms baseline — even A's predicted minimum is comparable to
or above it, and this task's own measured B magnitude (mean 89 ms) shows real defects on
this SDK run far larger than a 26 ms baseline could mask.

### Band separation

`matchedBeats=17, missingBeats=0` on every one of the 12 nominal-start repeats measured
(17 = `floor(8s / 0.5s beat) + 1`, the full expected count for a 4-bar/120bpm window) —
no missing beats from low-band/high-band cross-talk, no metronome bleed into the high
(reference-click) band's detection path corrupting the low-band count. No
`REF_CLICK_HZ`/`highCutoffHz` adjustment was needed.

### Net effect on the harness

- `ALIGNED_TOLERANCE_MS = 2` — unchanged.
- `HEAD_MISSING_BASELINE_MS = 26` — new constant, subtracted from `headMissingMs` before
  classification (`src/lib/audit/recordingAuditCalibration.ts`,
  `src/lib/audit/recordingAlignment.ts`).
- Diagnostic logging added (`diag`, `clockNoise`, `outputLatency`/`baseLatency`) to
  `recording-alignment-audit-debug-demo.tsx` — kept permanently for triage traceability
  on future runs (cheap, string-only per CLAUDE.md's logging convention).
- **No correction was applied to `medianBeatErrorMs`/beat placement.** The ~89 ms mean
  bias on `nominal-start` is left as measured and carried into the matrix + triage below
  as the primary finding.

## Matrix results — 48000 Hz

_(filled in Step 3)_

## Matrix results — 44100 Hz

_(filled in Step 4)_

## Triage

_(filled in Step 5)_
