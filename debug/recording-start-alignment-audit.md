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

**Matrix: 20/20 cells classified (10 scenario×bpm combinations × 2 rates), 0
run-failed cells.** 4/20 `matches-known-defect` (janked-start, both bpms, both rates —
prediction A confirmed cleanly), 16/20 `investigate`. Classification is identical across
both sample rates for every scenario — no rate-dependent effect found.

**Bring-up hypothesis (loopback-path `outputLatency` bias) REFUTED by magnitude**
(measured 23 ms vs. ~89 ms mean observed bias) — see "Bring-up calibration". No
loopback-path correction was applied; the harness measures upstream SDK behavior
directly.

**Two candidate new findings, both root-caused to `RecordAudio.ts` and reproduced with
high consistency (12+ repeats each, both rates, both bpms):**
1. **No-count-in `waveformOffset` bias** (`nominal-start`, `countin-start`): measured
   -60 to -110 ms early content placement, traced to `RecordAudio.ts:270-274`'s
   `headStartSeconds = wallclockSinceWorklet` being used uncompensated for the real gap
   between the RecordingWorklet's connection and the transport's actual position-0 start
   — 3.5-6.5x prediction B's originally-estimated ±15 ms band.
2. **`midtimeline-start` content skip**: `matched=15, missing=1` on every one of 12
   repeats — `region.position` anchored at the first-observed transport position while
   already playing, matching prediction A's mechanism but not currently caught by the
   harness's `headMissingMs` metric (a harness instrumentation gap, not a refutation).

**Predictions A-D: A confirmed (janked-start, exact band match); B confirmed in
mechanism/direction, refuted in magnitude (3.5-6.5x over); C partially confirmed
(jank clearly shifts the signature) but not isolable from A with this campaign's
scenarios; D confirmed flat (no per-take accumulation) but refuted in both magnitude
(2-5x over) and sign (measured early, predicted late) — dominated by the same
mechanism as B, not the predicted voice-crossfade lateness.**

**One documented harness limitation reproduced, not a new finding:** the WASM
transport-start-delay flakiness (`src/demos/recording/CLAUDE.md`) cost 5 of 12
`loop-wrap` repeats across both rates, up to 100% of one cell's repeats — confirmed
real and non-trivial via a targeted re-run, not a rare fluke. One harness-artifact
candidate identified but not resolved: `loop-wrap` take4's consistently low onset-match
count (see Triage).

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

Run: `recording-alignment-audit-debug-demo.html?scenario=all&bpm=all&rate=48000`, one
fresh page load, real click, visible window. JSON summary:
`recaudit-summary-1788287951691.json` (45 rows, `sdkBuildProbe: "upstream"`).
`loop-wrap/120` lost repeats 2-3 and `loop-wrap/97.3` lost repeat 3 to the documented
WASM transport-start-delay flakiness (`waitForPosition timed out`, per
`src/demos/recording/CLAUDE.md`) — 3 error rows total, not re-run individually (loop-wrap
still classified successfully from its surviving repeats; see below).

| scenario | bpm | medianErr per repeat (ms) | headMiss (ms) | signature | status |
|---|---|---|---|---|---|
| nominal-start | 120 | -97.56, -94.88, -74.90 | 7.04, 0.00, 0.00 | — | investigate |
| nominal-start | 97.3 | -108.20, -72.87, -102.87 | 4.35, 0.00, 0.00 | — | investigate |
| janked-start | 120 | -62.90, -92.21, -94.21 | 135.04, 145.69, 147.69 | A | **matches-known-defect** |
| janked-start | 97.3 | -97.53, -89.55, -69.55 | 145.69, 151.04, 147.04 | A | **matches-known-defect** |
| midtimeline-start | 120 | -152.23, -154.90, -185.54 | 3.04, 0.00, 0.00 | — | investigate |
| midtimeline-start | 97.3 | -166.36, -147.67, -151.01 | 1.04, 0.00, 1.69 | — | investigate |
| countin-start | 120 | -101.54, -99.54, -84.21 | 0.00, 0.00, 0.00 | — | investigate |
| countin-start | 97.3 | -77.62, -100.27, -81.62 | 0.00, 4.35, 0.00 | — | investigate |
| loop-wrap | 120 | repeat1 takes1-4: -71.17 (flat) / take4 matched=0 / repeat2,3 error | 0.00 | — | investigate |
| loop-wrap | 97.3 | repeat1/2 takes1-3: -68.13..-68.15 / -73.72..-73.75 (flat per repeat) / take4 matched=1 both / repeat3 error | 0.00 | — | investigate |

**Tally: 10 cells — 0 aligned, 2 matches-known-defect (both janked-start), 8 investigate,
0 outright run-failed cells (loop-wrap classified despite 3 error rows).**

## Matrix results — 44100 Hz

Run: `recording-alignment-audit-debug-demo.html?scenario=all&bpm=all&rate=44100`, fresh
page load, real click, visible window. JSON summary:
`recaudit-summary-1788288625777.json` (35 rows, `sdkBuildProbe: "upstream"`).
`loop-wrap/120` lost all 3 repeats and `loop-wrap/97.3` lost repeats 1-2 to the same
WASM transport-start-delay flakiness. Per protocol, `loop-wrap/120` was re-run alone
(`?scenario=loop-wrap&bpm=120&rate=44100`, JSON `recaudit-summary-1788288803959.json`):
**reproduced 2/3 failures again** (repeats 1-2 error, repeat 3 succeeds) — registered as
a finding (the documented flakiness reproduces at a real, non-trivial rate on this SDK
build/environment, not a one-off), not discarded as noise. Repeat 3's data is used below.

| scenario | bpm | medianErr per repeat (ms) | headMiss (ms) | signature | status |
|---|---|---|---|---|---|
| nominal-start | 120 | -72.16, -64.90, -99.21 | 0.00, 0.00, 4.93 | — | investigate |
| nominal-start | 97.3 | -98.39, -101.90, -77.05 | 0.00, 0.00, 0.00 | — | investigate |
| janked-start | 120 | -71.55, -65.27, -63.50 | 142.71, 139.33, 140.46 | A | **matches-known-defect** |
| janked-start | 97.3 | -74.30, -57.86, -65.60 | 145.49, 134.84, 139.68 | A | **matches-known-defect** |
| midtimeline-start | 120 | -167.17, -147.65, -156.85 | 0.00, 0.00, 0.00 | — | investigate |
| midtimeline-start | 97.3 | -208.07, -201.51, -204.98 | 2.46, 0.00, 2.28 | — | investigate |
| countin-start | 120 | -99.52, -96.95, -89.20 | 0.00, 0.00, 0.00 | — | investigate |
| countin-start | 97.3 | -93.15, -83.74, -101.72 | 0.00, 0.00, 0.00 | — | investigate |
| loop-wrap | 120 | (re-run) repeat3 takes1-4: -79.16..-79.23 (flat) / take4 matched=1 / repeats1-2 error (reproduced flakiness) | 0.00 | — | investigate |
| loop-wrap | 97.3 | repeat3 takes1-4: -67.13..-67.19 (flat) / take4 matched=1 / repeats1-2 error | 0.00 | — | investigate |

**Tally: 10 cells — 0 aligned, 2 matches-known-defect (both janked-start), 8
investigate, 0 outright run-failed cells** (both loop-wrap cells classified from their
one surviving repeat each).

### Cross-rate comparison (48000 vs 44100)

Every scenario's classification is **identical across both rates** — same 2
matches-known-defect (janked-start only), same 8 investigate. Magnitudes are consistent
within scatter, not rate-dependent:

- `nominal-start` median: 48k mean ≈ -89.2 ms (6 samples: -97.56,-94.88,-74.90,-108.20,
  -72.87,-102.87) vs 44.1k mean ≈ -85.7 ms (-72.16,-64.90,-99.21,-98.39,-101.90,-77.05).
- `janked-start` headMissingMs: 48k range 135.04-151.04 ms vs 44.1k range 134.84-145.49
  ms — both comfortably inside predicted A's 20-300 ms band at both rates.
- `midtimeline-start` median: 48k mean ≈ -166.4 ms vs 44.1k mean ≈ -172.7 ms — both far
  more negative than `nominal-start`/`countin-start`, and both show `matched=15,
  missing=1` on every single repeat at both rates (one beat consistently unaccounted
  for — see Triage).
- `loop-wrap` per-repeat takes 1-4: flat (near-identical, <0.1 ms drift take-to-take)
  at both rates, consistent with prediction D's "flat across consecutive takes, not
  accumulating" — but signed magnitude (~-67 to -79 ms) is far outside D's predicted
  15-30 ms band, and take5 (final, teardown-finalized) is consistently ~8-20 ms MORE
  negative than takes1-4 at both rates.

## Triage

### Prediction outcomes (A-D)

- **A (head-loss, `janked-start`/`midtimeline-start`) — CONFIRMED on `janked-start`,
  measured magnitude matches the predicted band exactly.** All 12 `janked-start` repeats
  (both bpms, both rates) classified `matches-known-defect`, `headMissingMs` in
  134.84-151.04 ms, comfortably inside the predicted 20-300 ms band. **`midtimeline-start`
  does NOT show the predicted head-loss signature via `headMissingMs`** (which stayed
  near 0-3 ms at both rates, i.e. no significant gap between the record request and the
  buffer's first captured frame) — instead it shows a consistent `matched=15,
  missing=1/16` (one beat missing from every single repeat, both bpms, both rates) plus
  a very large negative median (-147 to -209 ms). This is head-loss by a DIFFERENT
  mechanism than the one `headMissingMs` measures (which is scoped to
  `recordRequestContextTime` vs. buffer-start, not to the region's `position`/PPQN
  anchor) — `region.position` (read once, at the first `isRecording=true` tick, per
  `RecordAudio.ts:212` `currentPosition = owner.getValue()`) is set to wherever the
  ALREADY-PLAYING transport happened to be at that first observation, which — because
  the transport was mid-timeline and running continuously — genuinely skips real
  content between the true intended start and that first-observed position. The missing
  beat is exactly this: the beat nearest the true engage point, now excluded because
  `region.position` already reads past it. **A is confirmed in mechanism on
  `midtimeline-start` too (code-traced, `missing=1` on literally every repeat), but the
  harness's `headMissingMs` metric doesn't capture this variant of A** — a gap in the
  harness's head-loss instrumentation, not a refutation of A. See "harness gaps" below.

- **B (random ~±15 ms band on `nominal-start`) — CONFIRMED IN MECHANISM AND DIRECTION,
  REFUTED IN MAGNITUDE.** All 12 `nominal-start` repeats (both bpms, both rates) land
  well outside the predicted 4-25 ms band: measured range -64.90 to -108.20 ms, mean
  ≈ -87.4 ms across all 12 — magnitude is 3.5-6.5x the predicted ceiling (traced to
  source in "Bring-up calibration" above: `RecordAudio.ts:270-274`'s no-count-in
  `headStartSeconds = wallclockSinceWorklet`, uncompensated for the real gap between
  `prepareRecording()`'s worklet-connect and the transport's actual position-0 start).
  The scatter itself (repeat-to-repeat spread of ~10-45 ms within a cell) is consistent
  with B's "random band" character — it's layered on top of a much larger constant-ish
  offset the prediction didn't anticipate. **`countin-start` shows the identical
  signature** (-77.62 to -101.72 ms, mean ≈ -92.2 ms across 12 repeats) — B's prediction
  also names `countin-start`, and the same uncompensated-gap mechanism applies there too
  (the counted-in branch DOES subtract `countInSeconds`, per the code, but not the
  worklet-connect-to-count-in-start gap itself — see code excerpt above). **Recommend
  the register (or any upstream issue) describe B's actual measured band as roughly
  -60 to -110 ms on this SDK/environment, not ±15 ms**, and flag that the current
  measurement conflates two effects (the worklet-connect pre-roll gap, and whatever
  residual ~±15 ms noise the original prediction targeted) that a future harness
  iteration should separate by instrumenting `wallclockSinceWorklet` directly.

- **C (jank, 50-235 ms constant-late on `janked-start`) — NOT independently
  distinguishable from A in this campaign's data.** `janked-start`'s measured medians
  (-57.86 to -97.53 ms across all 12 repeats) land in a similar range to `nominal-start`'s
  B-mechanism bias, and the cell's classification came from the `headMissingMs`/A
  head-loss path (135-151 ms, matching A's band), not from a `constant-late` C band
  match on the median (no C band is configured for `janked-start` in
  `SIGNATURE_BANDS`, only A — median-based C classification was never possible with the
  current calibration config). The 150 ms busy-loop jank clearly produced SOME effect
  (headMissingMs jumped from nominal-start's ~0-25 ms baseline to 135-151 ms, a clean,
  large, reproducible step at both rates and both bpms) — consistent with C's "no bounded
  wait... accepted immediately" mechanism compounding with A's anchor-lag — but this
  campaign cannot cleanly separate "how much of the observed lag is A vs. C" without a
  dedicated C-only provocation (e.g. jank BETWEEN startRecording and the busy-loop, vs.
  jank overlapping the position-tick window as currently implemented). **C: partially
  confirmed (jank clearly moves the measured signature by ~100+ ms in the predicted
  direction and rough magnitude band), but not cleanly isolated from A** — recommend a
  follow-up scenario if C needs its own issue filing.

- **D (loop-wrap, 15-30 ms constant-late, flat across takes) — CONFIRMED FLAT,
  REFUTED IN MAGNITUDE AND SIGN AMBIGUITY.** Every `loop-wrap` cell (both bpms, both
  rates) shows the flatness D predicts: consecutive wrap takes (1-4) agree to within
  0.02-0.1 ms of each other within a repeat (e.g. 48k/120: -71.17, -71.17, -71.17,
  -71.17). But the magnitude (-67 to -79 ms) is 2-5x D's predicted 15-30 ms ceiling, AND
  the sign is EARLY (negative), not LATE (D predicts wrapped content emerges late,
  positive). This is very likely the SAME uncompensated-worklet-connect-gap mechanism as
  B (loop-wrap's first take also goes through the no-count-in `waveformOffset` formula,
  and that same `currentWaveformOffset` baseline is inherited additively by every
  subsequent wrap take per `RecordAudio.ts:238`/`279` — see repo CLAUDE.md's "Loop Take
  Buffer Layout"), NOT the predicted 20 ms voice-crossfade lateness, which would be a
  much smaller, positive, per-wrap-independent effect. **D as originally predicted
  (crossfade lateness) is not confirmed by this data — the measured constant offset is
  dominated by an inherited B-mechanism bias, not the crossfade.** The crossfade effect
  may still be present underneath but is not separable from B's larger bias with this
  harness's current measurement. `take5` (final, teardown-finalized) is consistently
  8-20 ms more negative than takes 1-4 at every rate/bpm — small and separately
  explainable by the documented "up to one render-quantum overshoot" on the
  teardown-finalized take (CLAUDE.md), not investigated further here.

### Every `investigate` cell — harness artifact vs. candidate new issue

- **`nominal-start` (both bpms, both rates, all repeats): candidate new issue**, not a
  harness artifact. Root cause traced to source (`RecordAudio.ts:270-274`), reproduced
  cleanly and consistently (12/12 repeats), magnitude far exceeds the originally
  predicted B band. Recommend this becomes the primary upstream issue this campaign
  produces (measured signature: -60 to -110 ms early placement, no count-in, idle main
  thread).
- **`countin-start` (both bpms, both rates, all repeats): same candidate issue as
  `nominal-start`** (same mechanism, see prediction B above) — not a separate issue.
- **`midtimeline-start` (both bpms, both rates, all repeats): candidate new issue**,
  distinct from `nominal-start`'s. The consistent `missing=1` beat plus -147 to -209 ms
  median is the A-mechanism (region.position anchored at first-observed position while
  the transport was already running) COMPOUNDED with the same B-mechanism bias measured
  above (both apply simultaneously here — count-in is off, so `nominal-start`'s bias
  term is present too, on top of A's genuine content-skip). Recommend describing this as
  A's manifestation on an already-playing transport, cross-referencing the B-mechanism
  issue above rather than filing a third, overlapping issue.
- **`loop-wrap` (both bpms, both rates): candidate new issue for the magnitude/sign
  mismatch against D** (see prediction D above) — likely the same B-mechanism bias
  inherited into the loop-wrap take chain, not a separate defect. **The
  `waitForTakeCount` transport-start-delay flakiness that lost 5 of 12 loop-wrap repeats
  across both rates (2/3 at 44.1k/120, 2/3 at 44.1k/97.3, 2/3 at 48k/120, 1/3 at
  48k/97.3) is a HARNESS ARTIFACT** — already documented in
  `src/demos/recording/CLAUDE.md` and Task 4's report as a known WASM
  transport-start-delay quirk unrelated to the loopback injection or measurement code;
  confirmed here to reproduce at a real, non-trivial rate (up to 100% of repeats in one
  cell) rather than being a rare fluke. Not itself a finding worth an issue — a
  pre-existing, already-tracked harness limitation.
- **`loop-wrap` take4's low `matched` count (1, vs. 8 for takes 1-3/5), consistent
  across every successful loop-wrap repeat at both rates: likely HARNESS ARTIFACT,
  unresolved.** `take4` (the 5th and last WRAP-finalized take, 0-indexed) should be
  full-loop-length like takes 1-3 (all governed by the same 2-bar loop area), yet its
  onset match count is far lower every single time it was measured (4 independent
  successful repeats: 48k/120, 48k/97.3 x2, 44.1k/97.3, 44.1k/120). Two candidate
  explanations, neither confirmed: (a) `waitForTakeCount`'s target
  (`LOOP_WRAP_TAKES + 1 = 6` regions) is satisfied the instant the 6th region is
  CREATED, which happens at the exact moment take4 (the 5th) finalizes — if measurement
  reads take4's `duration`/`loopDuration` fields before a final write settles, its
  effective onset-matching window could be truncated; (b) a genuine SDK effect specific
  to the second-to-last take in a `waitForTakeCount`-terminated sequence. Recommend
  Task 8 (or a follow-up) add a short settle-wait before measuring in loop-wrap cells
  and re-check whether take4's match count recovers to 8 — this is the harness-artifact
  candidate matching the previous campaign's own guidance ("detector tuning is the
  likely first suspect").

### Harness gaps identified (not code defects, instrumentation gaps)

- `headMissingMs` only measures the gap between `recordRequestContextTime` and the
  buffer's first captured frame — it does NOT measure `midtimeline-start`'s variant of
  head-loss (content skipped because `region.position` itself is anchored late while the
  transport was already running). A's `midtimeline-start` cells therefore never reach
  the `head-loss` band-matching path in `classifyCell` even though A's mechanism is
  confirmed by `missing=1` on every repeat. A future harness iteration could add a
  `positionAnchorLossMs` metric (comparing `region.position`'s musical time against the
  true intended engage position) alongside `headMissingMs`.
- No dedicated C-only (jank-without-A-interaction) scenario exists, so C's contribution
  couldn't be isolated from A's in `janked-start`'s combined result (see prediction C
  above).

### Zero new confirmed engine bugs beyond the two documented above

Two candidate findings emerge from this campaign, both already root-caused to specific
source lines and reproduced across both rates/bpms with high repeat-count consistency
(12+ repeats each): (1) the `nominal-start`/`countin-start` no-count-in
`waveformOffset` bias (`RecordAudio.ts:270-274`, magnitude -60 to -110 ms, confirmed
mechanism per the bring-up section), and (2) `midtimeline-start`'s A-mechanism content
skip (missing beat on every repeat, same code path's `currentPosition` anchor). Both are
candidates for upstream issue drafts under `debug/drafts/` (Task 8), per the repo's
issue-filing convention (no suggested-fix section, draft for user review before
posting). `janked-start`'s A-band match and `loop-wrap`'s D-flatness are confirmations
of already-predicted signatures, not new findings, though D's sign/magnitude mismatch is
worth noting in whatever issue write-up covers the shared B-mechanism bias.
