# Recording Start-Alignment Audit — campaign register & results

**Title:** Recording Start-Alignment Audit — campaign register & results

**SDK Pin:** `@opendaw/studio-sdk@0.0.170` (installed npm package; WASM engine only)

**Harness:** unlisted debug demo `recording-alignment-audit-debug-demo.html?scenario=<name|all>&bpm=<n|all>&rate=<44100|48000>`
on the dev server (`?scenario=probe` runs the same-context loopback feasibility probe
instead of the matrix). Measurement library: `src/lib/audit/recordingAlignment.ts`;
calibration constants: `src/lib/audit/recordingAuditCalibration.ts`. WAV
(`recaudit-<scenario>-<bpm>-<rate>-r<repeat>.wav`) and JSON
(`recaudit-summary-<timestamp>.json`) uploads land in `.verify-output/` via the dev
server's `/__verify` sink. Every summary JSON also carries `outputLatency`,
`baseLatency`, and `headMissingBaselineMs` (top level) plus, per row, the raw box-graph
values behind the placement math (`regionPositionPpqn`, `regionStartSec`,
`waveformOffsetSec`, `anchorT0Sec`, `recordRequestContextTime`, `headMissingRawMs`) and
detector/graph-path noise (`clockNoiseIdentifiedClicks`, `clockNoiseMaxAbsResidualMs`) —
this evidence is a committed artifact, not console-only.

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
run-failed cells.** 0/20 `matches-known-defect`, 20/20 `investigate` — the original
draft's "4/20 matches-known-defect (janked-start)" is WITHDRAWN (see "Fix round 1":
that data measured the harness's own provocation bug, not the SDK; the fix-round
re-run data reclassifies every `janked-start` cell to `investigate`). Classification
is identical across both sample rates for every scenario — no rate-dependent effect
found. All per-cell statistics below use **matrix-run data only** (the two full
`scenario=all` runs plus the `janked-start`/`loop-wrap` fix-round re-runs that
replaced their invalid/incomplete rows) — the separate bring-up control-cell runs (18
extra `nominal-start` repeats) are calibration evidence, kept out of the "official"
per-cell population to avoid double-counting.

**Bring-up hypothesis (loopback-path `outputLatency` bias) REFUTED by magnitude, but
it IS one real additive term.** `outputLatency` (23 ms, identical at both sample
rates) is a genuine, unearned-in-a-digital-loopback contributor to every no-count-in
take's `waveformOffset` — worth exactly 23 ms of early placement, out of scope per the
design spec §2's "real hardware round-trip latency… not what this campaign measures" —
but it explains only a small fraction of the measured ~91 ms mean bias. The dominant
term is a genuinely upstream, in-scope quantity: see "Bring-up calibration" for the
full three-term decomposition.

**Two candidate new findings**, both root-caused to `RecordAudio.ts` and reproduced
with high consistency across both rates and both bpms:
1. **No-count-in `waveformOffset` bias** (`nominal-start`, `countin-start`): matrix-run
   medians range -64.9 to -108.2 ms (24 repeats, mean of per-cell means ≈ -90.6 ms).
   Traced to `RecordAudio.ts:270-274`'s `headStartSeconds = wallclockSinceWorklet`
   used uncompensated for the real gap between the RecordingWorklet's connection and
   the transport's actual position-0 start — see the three-term decomposition below.
2. **`midtimeline-start` content skip**: `matched=15, missing=1` on every one of 12
   matrix-run repeats — `region.position` anchored at the first-observed transport
   position while already playing, matching prediction A's mechanism but not currently
   caught by the harness's `headMissingMs` metric (a harness instrumentation gap, not a
   refutation).

**A third finding surfaced during this fix round: a reproducible `loop-wrap`
finalization hang**, unrelated to the transport-start-delay quirk this scenario's
failures were originally (incorrectly) attributed to. See the "C2" entry in Triage —
characterized in detail there, not resolved by widening the harness's own deadline.

**Predictions A-D:** A confirmed as a genuine, intermittent content-skip mechanism on
`janked-start` in the FIXED data (one of 12 re-run repeats; the original `janked-start`
data was invalid, measuring the harness's own provocation bug, not the SDK — see "Fix
round 1" below) and unconditionally on `midtimeline-start` (12 of 12 repeats). B
confirmed in mechanism/direction,
refuted in magnitude (measured range 2.6-4.3x over the calibration file's 4-25 ms
band, 4.3-7.2x over the design spec's informal "~15 ms" wording — see Triage for both
bases). C could not be isolated from A even after the fix (see Triage). D confirmed
flat (no per-take accumulation) but refuted in both magnitude (2-5x over) and sign
(measured early, predicted late) — dominated by the same mechanism as B, not the
predicted voice-crossfade lateness.

## Fix round 1 (2026-09-01) — corrections after review

The team lead's review of the first draft found 3 Critical and 4 Important issues.
This register has been rewritten to reflect the corrected data; the corrections
themselves (what was wrong, what changed, what was re-run) are summarized here for
traceability, with full detail folded into the relevant sections below and in
`.superpowers/sdd/2026-09-01-recording-start-alignment-audit/task-6-fix-report-1.md`.

1. **`janked-start`'s original data was invalid** — the busy-loop spin ran
   immediately after calling `project.startRecording()`, which blocked that call's own
   async continuation (`Recording.start` awaits `capture.prepareRecording()` — the
   worklet-connect — before the transport actually starts), so the spin delayed
   capture-start and transport-start together instead of jamming the main thread AFTER
   an audio-thread anchor already existed. Fixed by keying the spin off the harness's
   own subscription to `engine.isRecording` actually flipping true; re-ran all 4
   `janked-start` cells (both bpms, both rates) — see the corrected A/C verdicts below.
2. **`loop-wrap`'s failures were mis-attributed** to the `waitForPosition` transport
   quirk; every failure row's `errorMessage` actually reads `finalizing: finalization
   timed out after 30s`. Diagnosed with a 90s-deadline test (4 of 6 repeats STILL timed
   out — refuting "just needs more time"), then reverted to 30s and re-run — see the C2
   triage entry for the full characterization and evidence.
3. **The `outputLatency` hypothesis was one real additive term, not entirely
   refuted** — corrected to a three-term decomposition (harness-path / upstream
   headStart / anchor-position residual) in "Bring-up calibration".
4. Recomputed every mean/range from the raw JSON with a consistent, stated population
   and methodology (per-cell mean, then averaged across bpm for a rate/scenario
   summary) — the previous draft mixed populations and got several means and one
   multiplier claim wrong.
5. Corrected the stated reason `janked-start` never matched signature C (head-loss
   resolves before the band loop; `constant-late` requires a positive mean, but the
   measured means are negative) — the previous draft's stated reason (no C band
   configured) was itself wrong; both A and C ARE configured for `janked-start`.
6. `janked-start`'s classifier `detail` strings (the ones the C-verdict correction in
   item 5 depends on) are now quoted directly from the persisted JSON rather than
   paraphrased — this is NOT a claim that every cell's detail string is quoted
   throughout the register, only that the specific reasoning this fix round depended
   on is sourced that way. The false "matched=17/missing=0 on every nominal repeat"
   claim is removed (a bring-up run — `…1788283946271.json` — shows 0/42, and one
   matrix repeat shows 16/1 — see "Band separation").
7. Head-missing figures are now labeled baseline-corrected vs. raw everywhere they
   appear, with both values given.

## Bring-up calibration

Control cell: `nominal-start`, 120 bpm, 48000 Hz. Six fresh-page-load runs (18 valid
repeats: `recaudit-summary-1788284188534.json`, `…1788285202428.json`,
`…1788286810273.json`, `…1788286887454.json`, `…1788287122505.json`,
`…1788287338875.json`) plus two attempts excluded as invalid (see below), used only to
derive the calibration constants below. **Not used as the "official"
`nominal-start`/120/48000 matrix population** — that population is the actual matrix
run's own 3 repeats (see "Matrix results — 48000 Hz").

### CRITICAL bring-up question: is the harness's loopback path introducing a bias?

**Hypothesis tested:** the SDK's `waveformOffset` math compensates for
`audioContext.outputLatency`, designed for a physical speaker→ear→mic path that this
harness's digital loopback never incurs, so takes should land EARLY by exactly
`outputLatency`.

**Measured `audioContext.outputLatency` / `baseLatency`**, persisted in every run's
summary JSON (not just console): `outputLatency=0.023` (23 ms) at **both** sample
rates — confirmed identical in `recaudit-summary-1788290691302.json` (rate 48000) and
`recaudit-summary-1788290774387.json`/`…1788291706370.json` (rate 44100).
`baseLatency` varies slightly by rate (≈2.90-2.92 ms @48000, ≈2.90 ms @44100) but is
too small to matter to this analysis.

**Result: the hypothesis, taken literally (bias = outputLatency, full stop), is
refuted by magnitude — but `outputLatency` IS one real, correctly-signed additive
term.** Measured `medianBeatErrorMs` across the 18 valid bring-up repeats (excluding
one broken run and one all-failed run — see below): range -73.5 to -108.2 ms, mean ≈
-90.5 ms. 23 ms of `outputLatency` alone cannot produce this — the dominant term is
elsewhere, decomposed below.

**Excluded bring-up runs** (not used in any statistic): `recaudit-summary-1788283946271.json`
— first attempt, 2/3 repeats errored (`finalizing: no take regions created`, the
documented WASM transport-start-delay flakiness) and the third repeat measured
`matched=0, missing=42` (a degenerate capture, not representative — the one place in
this campaign a raw `matched=0/missing=42` figure appears, cited here explicitly so it
isn't mistaken for a "17/0 always" pattern anywhere else).
`recaudit-summary-1788286745058.json` — a later attempt, all 3 repeats errored on the
same transport-start-delay quirk.

### Three-term decomposition (found by reading `RecordAudio.ts`, confirmed against persisted diagnostic values)

`RecordAudio.ts:270-274` (installed 0.0.170, read in the sibling upstream SDK source
checkout — see `.claude/local.md` for its location, not named here per repo
convention):
```
const wallclockSinceWorklet = recordingWorklet.numberOfFrames / sampleRate
const headStartSeconds = countedIn
    ? Math.max(0, wallclockSinceWorklet - countInSeconds)
    : wallclockSinceWorklet
const waveformOffset = headStartSeconds + countInSeconds + outputLatency + inputLatency
```
For the **counted-in** path, `wallclockSinceWorklet` (the RecordingWorklet's own frame
counter — how much audio it has captured since being connected, read at the first
`isRecording=true` position-tick) has the deterministic `countInSeconds` subtracted
out, per the code's own comment: "L is recovered once, here, by reading `numberOfFrames`
at the moment we first see `isRecording=true` and subtracting the BPM-derived
`countInSeconds`." For the **no-count-in** path (`nominal-start`, `countin-start`
without its count-in offset, `loop-wrap`'s first take), there is nothing to subtract —
`headStartSeconds` is `wallclockSinceWorklet` **in full**, on the implicit assumption
that the RecordingWorklet started counting frames at the exact instant the transport
began advancing from position 0.

That assumption is measurably false, and the total measured error decomposes into
**three** terms, not one:

1. **Harness-path term ≈ `outputLatency` (23 ms), out of scope.** Real hardware would
   incur this as speaker→ear→mic latency; this harness's digital loopback never does,
   so it is unearned compensation baked into every no-count-in `waveformOffset`. Per
   the design spec §2, absolute device latency is explicitly not what this campaign
   measures — this term is acknowledged but not "fixed" or subtracted from the
   published signature; it's simply named as the harness-attributable slice.
2. **Upstream `headStartSeconds` term (the dominant one).** The RecordingWorklet's
   frame counter starts running from `prepareRecording()`'s
   `recordGainNode.connect(recordingWorklet)` call (`CaptureAudio.ts:200`) — a real
   wall-clock instant that occurs BEFORE the transport's position actually begins
   advancing from 0. That pre-roll gap is baked directly into `headStartSeconds`,
   uncompensated, for the no-count-in path. Worked example (`nominal-start/120/r1`,
   bring-up run, `regionPositionPpqn=5` → `regionStartSec=0.0026042`,
   `waveformOffsetSec=0.055000`): `headStartSeconds = waveformOffsetSec − outputLatency
   = 0.055 − 0.023 = 0.032s` (32 ms) vs. `regionStartSec = 0.0026s` (2.6 ms) — the
   RecordingWorklet's frame-count clock and the transport's PPQN clock, both read at
   the SAME position-tick callback, disagree by roughly 12x in this example.
3. **Anchor/position residual.** Even after accounting for terms 1 and 2, a further
   residual remains that scales with how much real time elapses between the transport
   truly reaching position 0 and the main thread's first `isRecording=true`
   observation actually running (the SAME "stale position read, fresh frame count"
   race this campaign later confirmed drives `janked-start` and `midtimeline-start` —
   see the C1 fix and prediction A below). This residual is why the total measured
   bias (mean ≈ -90 ms) exceeds terms 1+2 (≈ 23 + 32 = 55 ms in the worked example) by
   a further ~18-35 ms across different repeats — consistent with an A+B interaction
   (fresh `numberOfFrames`, paired with a `currentPosition` read that's already
   slightly stale by the time the position-tick callback runs), not a single
   fixed pre-roll constant. This is the mechanism the data actually supports; a
   simpler "pre-roll baked in, constant per session" story does NOT fit, because the
   raw `headMissingMs` (worklet-connect-to-first-frame lag, see below) stays flat at
   ~15-25 ms regardless of whether the total bias that repeat measures is -65 ms or
   -110 ms — if it were purely a pre-roll constant, the two would track together.

**Decision: no correction was applied to the published signature.** Terms 2 and 3 are
upstream SDK behavior under audit; only term 1 (`outputLatency`) is harness-path, and
it is small enough (23 of ~90 ms, ~25%) that subtracting it would not materially change
the classification or the character of the finding — the register states its
existence and magnitude here rather than silently netting it out of every number below.
`LOOPBACK_PATH_BIAS`/`loopbackPathBiasMs()` as originally proposed (subtract
`outputLatency` and call the cell calibrated) was **not implemented** — it would have
left terms 2 and 3 (the majority of the bias) uncorrected while disguising the cell as
fully explained.

### `ALIGNED_TOLERANCE_MS` (detector/graph-path noise floor)

`clockNoiseMaxAbsResidualMs` (persisted per row): sub-float-precision on every bring-up
run (e.g. `1.44e-12` in `recaudit-summary-1788290691302.json`'s first row) — pure
onset-detection + zero-phase band-split jitter, independent of any SDK placement math
(the reference clicks are synthetic oscillator bursts at exact scheduled `AudioContext`
times). 2x that is far under the 2 ms floor. **`ALIGNED_TOLERANCE_MS` stays at 2 ms
(unchanged)** — the provisional value was already correctly calibrated.

### `HEAD_MISSING_BASELINE_MS` (worklet-connect-to-first-frame setup lag)

Raw `headMissingMs` (`headMissingRawMs` in the persisted JSON — buffer-start context
time vs. `recordRequestContextTime`, BEFORE the baseline correction) across the 15
bring-up repeats measured before this constant existed (the JSON field for those rows
holds the then-uncorrected value directly; the 6th run's 3 repeats already have the
correction applied and are excluded from this specific statistic to avoid mixing
corrected and raw values): range 14.37-25.02 ms, mean ≈ 18.58 ms — NOT random detector
noise (the clockNoise measurement above rules that out); it is the genuine async gap
between the
JS `startRecording()` call and the RecordingWorklet's first captured frame reaching the
ring buffer (Promise/worklet-connect message-passing setup — recording genuinely had
not started yet at `recordRequestContextTime`, so no content was lost). Added
`HEAD_MISSING_BASELINE_MS = 26` (just above the measured max) to
`recordingAuditCalibration.ts`, subtracted from every take's raw `headMissingMs` via a
`headMissingBaselineMs` field on `measureTakeAlignment`'s input
(`src/lib/audit/recordingAlignment.ts`) before `classifyCell` ever sees it —
**both the raw and corrected values are persisted per row** (`headMissingRawMs` /
`headMissingMs`) so this correction is always auditable, never silently applied.
Re-verified live post-calibration on a fresh control-cell run: corrected `headMissingMs`
read `0.00, 0.00, 7.02` ms (the small residual on the third repeat is ordinary
additional jitter above the fixed 26 ms baseline, not evidence the correction
under-fires). Scenarios that DO predict genuine head-loss (A: `janked-start` 20-300 ms,
`midtimeline-start` 5-300 ms) remain trivially distinguishable from this 26 ms
baseline.

### Band separation

No SYSTEMATIC missing-beat evidence of low-band/high-band cross-talk was found across
the valid (non-excluded) bring-up or matrix `nominal-start` repeats — one exception:
the 48000 Hz matrix run's `nominal-start`/120/repeat1 measured `matched=16,
missing=1` (see "Matrix results — 48000 Hz" above), the single missing-beat instance
anywhere in this campaign's `nominal-start` data. This reads as isolated
onset-detection noise (a single borderline-amplitude click near the detector
threshold) rather than a cross-talk signature — cross-talk from the high-band
reference clicks bleeding into the low band would be expected to produce EXTRA
low-band onsets, not fewer, and every other `nominal-start` repeat (11 of 12 in the
matrix population, plus all 18 valid bring-up repeats) matched every beat. No
`REF_CLICK_HZ`/`highCutoffHz` adjustment was made.

### Net effect on the harness

- `ALIGNED_TOLERANCE_MS = 2` — unchanged.
- `HEAD_MISSING_BASELINE_MS = 26` — new constant (`recordingAuditCalibration.ts`,
  `recordingAlignment.ts`).
- `janked-start`'s jank provocation rewritten to key off `engine.isRecording`
  actually flipping true, not off calling `startRecording()` (fix round 1, C1).
- `loop-wrap`'s finalization deadline diagnostic (90s), then reverted to 30s (fix
  round 1, C2) — see Triage; no deadline change was retained since it didn't help.
- `outputLatency`/`baseLatency`/`headMissingBaselineMs` (top level) and per-take
  diagnostic fields (`regionPositionPpqn`, `regionStartSec`, `waveformOffsetSec`,
  `anchorT0Sec`, `recordRequestContextTime`, `headMissingRawMs`,
  `clockNoiseIdentifiedClicks`, `clockNoiseMaxAbsResidualMs`) now persisted in every
  row of the summary JSON (fix round 1, I3) — previously console-only.
- **No correction was applied to `medianBeatErrorMs`/beat placement.** The measured
  bias on `nominal-start`/`countin-start` is left as measured and carried into the
  matrix + triage below as the primary finding.

## Matrix results — 48000 Hz

Run: `recording-alignment-audit-debug-demo.html?scenario=all&bpm=all&rate=48000`, one
fresh page load, real click, visible window. JSON summary:
`recaudit-summary-1788287951691.json` (45 rows, `sdkBuildProbe: "upstream"`).
`janked-start` rows below are from the **fix-round re-run**
(`recaudit-summary-1788290691302.json`, `?scenario=janked-start&bpm=all&rate=48000`) —
the original run's `janked-start` data measured the harness's own provocation bug (see
"Fix round 1") and is discarded, not reported.

`loop-wrap/120` lost repeats 2-3 and `loop-wrap/97.3` lost repeat 3, every one with
`errorMessage: "finalizing: finalization timed out after 30s"` — confirmed from the
persisted JSON, **not** the `waitForPosition` transport-start quirk (which does not
appear in either matrix run's loop-wrap error rows; the two excluded bring-up
control-cell attempts instead carry `recording: waitForPosition(15360) timed out
after 60s` — `…1788286745058.json`, all 3 repeats — and `finalizing: no take regions
created` — `…1788283946271.json`, 2 of 3 repeats — two DIFFERENT failure modes,
neither of them loop-wrap's). See the C2 triage entry for the full characterization.

| scenario | bpm | medianErr per repeat (ms) | headMiss corrected/raw (ms) | signature | status |
|---|---|---|---|---|---|
| nominal-start | 120 | -97.56, -94.88, -74.90 | 7.04/33.04, 0.00/≤26, 0.00/≤26 | — | investigate |
| nominal-start | 97.3 | -108.20, -72.87, -102.87 | 4.35/30.35, 0.00/≤26, 0.00/≤26 | — | investigate |
| janked-start (fix-round) | 120 | -70.87, -99.56, -121.56 | 0.00/22.35, 0.00/21.71, 7.04/33.04 | — (r3 unusable: missing=1) | investigate |
| janked-start (fix-round) | 97.3 | -73.55, -89.55, -77.53 | 0.00/17.04, 0.00/25.04, 0.00/15.69 | — (no band: mean −80.21 < 0) | investigate |
| midtimeline-start | 120 | -152.23, -154.90, -185.54 | 3.04/29.04, 0.00/≤26, 0.00/≤26 | — | investigate |
| midtimeline-start | 97.3 | -166.36, -147.67, -151.01 | 1.04/27.04, 0.00/≤26, 1.69/27.69 | — | investigate |
| countin-start | 120 | -101.54, -99.54, -84.21 | 0.00/≤26, 0.00/≤26, 0.00/≤26 | — | investigate |
| countin-start | 97.3 | -77.62, -100.27, -81.62 | 0.00/≤26, 4.35/30.35, 0.00/≤26 | — | investigate |
| loop-wrap | 120 | repeat1 takes1-4: -71.17 (flat) / take4 matched=0 (median null — no onsets matched in that take's short window) / repeats2,3 error (`finalization timed out after 30s`) | 0.00/≤26 (r1) | — | investigate |
| loop-wrap | 97.3 | repeat1/2 takes1-3: -68.13..-68.15 / -73.72..-73.75 (flat per repeat) / take4 matched=1 both / repeat3 error (`finalization timed out after 30s`) | 0.00/≤26 | — | investigate |

Raw head-missing derivation: `headMissingMs (corrected) = max(0, headMissingRawMs − 26)`
per `HEAD_MISSING_BASELINE_MS`, so a nonzero corrected value gives an exact raw value
(`raw = corrected + 26`); a corrected value of `0.00` only bounds `raw ≤ 26` (the exact
raw figure is unrecoverable through the clamp) — these original-matrix-run rows
predate this fix round's per-row `headMissingRawMs` persistence (I3), so only the
bound is available for them, not the console-logged exact figure the fix-round re-runs
now carry in their own JSON.

**Tally: 10 cells — 0 aligned, 0 matches-known-defect (corrected — see "Fix round 1":
the original 2 `janked-start` matches-known-defect verdicts are WITHDRAWN, replaced
with `investigate` from the fix-round re-run data), 10 investigate, 0 outright
run-failed cells (loop-wrap classified despite 3 error rows).**

## Matrix results — 44100 Hz

Run: `recording-alignment-audit-debug-demo.html?scenario=all&bpm=all&rate=44100`, fresh
page load, real click, visible window. JSON summary:
`recaudit-summary-1788288625777.json` (35 rows, `sdkBuildProbe: "upstream"`).
`janked-start` rows below are from the **fix-round re-run**
(`recaudit-summary-1788290774387.json`). `loop-wrap` rows below are sourced
PER-BPM, from whichever run actually produced a successful repeat: the **120 bpm**
row is from the fix-round re-run at the reverted 30s deadline
(`recaudit-summary-1788291706370.json`, `?scenario=loop-wrap&bpm=all&rate=44100`),
which had 2 successful repeats (the fix round's own 44.1k/120 data is used here
because it's the more recent, deadline-matched run and it succeeded). The **97.3
bpm** row is from the ORIGINAL matrix run (`recaudit-summary-1788288625777.json`)
instead — the fix round's own 44.1k/97.3 attempt (same JSON,
`…1788291706370.json`) had zero successful repeats (all 3 failed), so the original
run's single successful repeat (r3) is the only usable 44.1k/97.3 data point across
every attempt made this campaign. This split-source is safe because `loop-wrap`
logic besides the (now-reverted) deadline was unchanged by the fix round.

| scenario | bpm | medianErr per repeat (ms) | headMiss corrected/raw (ms) | signature | status |
|---|---|---|---|---|---|
| nominal-start | 120 | -72.16, -64.90, -99.21 | 0.00/≤26, 0.00/≤26, 4.93/30.93 | — | investigate |
| nominal-start | 97.3 | -98.39, -101.90, -77.05 | 0.00/≤26, 0.00/≤26, 0.00/≤26 | — | investigate |
| janked-start (fix-round) | 120 | -79.26, -89.42, -86.65 | 0.00/19.68, 0.00/21.13, 0.00/15.46 | — (no band: mean −85.11 < 0) | investigate |
| janked-start (fix-round) | 97.3 | -69.38, -89.00, -88.64 | 0.00/12.72, 0.00/14.92, 0.00/14.56 | — (no band: mean −82.34 < 0) | investigate |
| midtimeline-start | 120 | -167.17, -147.65, -156.85 | 0.00/≤26, 0.00/≤26, 0.00/≤26 | — | investigate |
| midtimeline-start | 97.3 | -208.07, -201.51, -204.98 | 2.46/28.46, 0.00/≤26, 2.28/28.28 | — | investigate |
| countin-start | 120 | -99.52, -96.95, -89.20 | 0.00/≤26, 0.00/≤26, 0.00/≤26 | — | investigate |
| countin-start | 97.3 | -93.15, -83.74, -101.72 | 0.00/≤26, 0.00/≤26, 0.00/≤26 | — | investigate |
| loop-wrap | 120 | repeat1/2 takes1-3: -70.99..-71.06 / -62.27..-62.34 (flat per repeat) / take4 matched=0 (r1, median null) / matched=1 (r2) / repeat3 error (`finalization timed out after 30s`) | 0.00/≤26 | — | investigate |
| loop-wrap | 97.3 | (original run, retained — see provenance note above) repeat3 takes1-4: -67.13..-67.19 (flat) / take4 matched=1 / repeats1-2 error (`finalization timed out after 30s`, verified directly from this run's own JSON) | 0.00/≤26 | — | investigate |

Raw head-missing derivation for this table: same rule as the 48000 Hz table above.

**Tally: 10 cells — 0 aligned, 0 matches-known-defect (corrected, same as 48000 Hz),
10 investigate, 0 outright run-failed cells.**

### Cross-rate comparison (48000 vs 44100)

Every scenario's classification is **identical across both rates** — 0
matches-known-defect, 10 investigate at both rates. Magnitudes are consistent within
scatter, not rate-dependent:

- `nominal-start` per-cell means: 48k/120 = -89.11 ms, 48k/97.3 = -94.64 ms, 44.1k/120
  = -78.76 ms, 44.1k/97.3 = -92.44 ms (average of the 4 cell means ≈ -88.74 ms).
- `countin-start` per-cell means: 48k/120 = -95.10 ms, 48k/97.3 = -86.51 ms, 44.1k/120
  = -95.22 ms, 44.1k/97.3 = -92.87 ms (average ≈ -92.42 ms).
- `janked-start` (fix-round) per-cell means: 48k/120 = -97.33 ms (dominated by r3's
  severe -121.56 ms/missing=1 outlier), 48k/97.3 = -80.21 ms, 44.1k/120 = -85.11 ms,
  44.1k/97.3 = -82.34 ms — same magnitude range as `nominal-start`/`countin-start`
  once the harness's own provocation bug is fixed (see Triage prediction A).
- `midtimeline-start` per-cell means: 48k/120 = -164.22 ms, 48k/97.3 = -155.01 ms,
  44.1k/120 = -157.23 ms, 44.1k/97.3 = -204.86 ms (average of rate-level means: 48k ≈
  -159.62 ms, 44.1k ≈ -181.04 ms) — both far more negative than
  `nominal-start`/`countin-start`, and both show `matched=15, missing=1` on every
  single repeat at both rates (one beat consistently unaccounted for — see Triage).
- `loop-wrap` per-repeat takes 1-3/4: flat (near-identical, <0.1 ms drift take-to-take)
  at both rates, consistent with prediction D's "flat across consecutive takes, not
  accumulating" — but signed magnitude (~-62 to -79 ms across all successful repeats
  measured) is far outside D's predicted 15-30 ms band, and take5 (final,
  teardown-finalized) is consistently more negative than takes1-4 at every rate/bpm
  measured.

## Triage

### Prediction outcomes (A-D)

- **A (head-loss, `janked-start`/`midtimeline-start`) — CONFIRMED, but only after the
  C1 fix; the original `janked-start` "confirmation" was invalid.** The original
  `janked-start` run's `headMissingMs` of 135-151 ms was NOT head-loss — it was the
  harness's OWN provocation bug (the busy-loop spin, run immediately after calling
  `project.startRecording()`, blocked that call's async continuation and delayed
  capture-connect itself, not just the SDK's post-flip position-tick handling).
  Evidence: the original (pre-fix) `janked-start` matrix runs' `headMissingMs`
  (baseline-corrected) across all 12 repeats (both rates, both bpms) ranged
  134.84-151.04 ms, mean 142.89 ms — every one of the 12 values exceeds
  `HEAD_MISSING_BASELINE_MS` (26 ms), so `raw = corrected + 26` exactly (not an
  approximation) for all of them: raw mean = 142.89 + 26 = **168.89 ms**. Against the
  bring-up control cell's directly-measured raw baseline (14.37-25.02 ms, mean 18.58
  ms — see "Bring-up calibration"), the jank run's raw head-missing exceeds nominal's
  by 168.89 − 18.58 ≈ **150.3 ms ≈ `JANK_MS` (150 ms)** almost exactly — the busy-loop
  duration was being measured back out of `headMissingMs` nearly 1:1, meaning the
  ENTIRE delay was attributable to the spin blocking capture-start, not to any
  SDK-side "accept the anchor immediately without waiting" behavior. **Fixed** (see
  "Fix round 1") by keying the spin off the harness's own subscription to
  `engine.isRecording` flipping true — verified live: post-fix `headMissingMs` across
  all 12 re-run repeats (both rates, both bpms) is 0-7 ms, matching
  `nominal-start`'s baseline exactly, confirming capture is no longer delayed. With
  that confound removed, A's actual signature shows up differently: one repeat
  (48k/120/r3) shows `matched=15, missing=1` — genuine content skip, the SAME
  mechanism `midtimeline-start` shows unconditionally (see below) — while the other 11
  repeats show full beat matches with medians in the -69.38 to -99.56 ms range (the
  fix-round `janked-start` population's own range, excluding the one severe outlier),
  overlapping `nominal-start`'s own B-mechanism range (-64.90 to -108.20 ms), meaning
  the 150 ms jank did NOT reliably
  overlap the SDK's critical position-tick window; when it doesn't, the measured
  result reduces to plain B. **A is confirmed as intermittent and severe when it does
  occur** (one clean content-skip case, matching prediction A's mechanism precisely),
  but does not manifest on every jank-provoked repeat with this jank duration/timing —
  a longer or better-timed jank window is a candidate follow-up to raise the hit rate.
  `midtimeline-start` shows the SAME content-skip mechanism **on every single
  repeat** (12/12, both bpms, both rates): `matched=15, missing=1/16`, plus a very
  large negative median (-147 to -209 ms). `region.position` (read once, at the first
  `isRecording=true` tick, per `RecordAudio.ts:212` `currentPosition =
  owner.getValue()`) is set to wherever the ALREADY-PLAYING transport happened to be
  at that first observation — because the transport was mid-timeline and running
  continuously, this genuinely skips real content between the true intended engage
  point and the first-observed position. Neither `janked-start`'s occasional content
  skip nor `midtimeline-start`'s consistent one is caught by the harness's
  `headMissingMs` metric (which measures the gap between `recordRequestContextTime`
  and the buffer's first captured frame, NOT the region-position anchor) — this is a
  harness instrumentation gap, not a refutation of A. See "Harness gaps" below.

- **B (random ~±15 ms band on `nominal-start`) — CONFIRMED IN MECHANISM AND DIRECTION,
  REFUTED IN MAGNITUDE.** 12 `nominal-start` matrix-run repeats (both bpms, both
  rates): range -64.90 to -108.20 ms, mean of the 4 per-cell means ≈ -88.74 ms — well
  outside both stated forms of the predicted band. Against the calibration file's
  formal band (`SIGNATURE_BANDS`, 4-25 ms): the measured range is **2.60x-4.33x** the
  25 ms ceiling. Against the design spec's informal "~±15 ms" wording: **4.33x-7.21x**.
  Root cause: see the bring-up section's three-term decomposition
  (`RecordAudio.ts:270-274`'s no-count-in `headStartSeconds`, uncompensated for the
  worklet-connect-to-transport-start gap, plus an anchor-position residual). The
  scatter itself (repeat-to-repeat spread of ~10-45 ms within a cell) is consistent
  with B's "random band" character — it's layered on top of a much larger,
  previously-unpredicted offset. **`countin-start` shows the identical signature**
  (12 repeats, mean of per-cell means ≈ -92.42 ms) — B's prediction also names
  `countin-start`, and the same uncompensated-gap mechanism applies (the counted-in
  branch DOES subtract `countInSeconds` per the code, but not the worklet-connect gap
  itself). **Recommend any upstream issue describe B's actual measured band as
  roughly -60 to -110 ms on this SDK/environment** (with the harness-path
  `outputLatency` term named separately, per the bring-up decomposition), not ±15 ms.

- **C (jank, 50-235 ms constant-late on `janked-start`) — could not be isolated from A
  even after the C1 fix; the correct reason it never matches is NOT the one stated in
  the first draft.** `SIGNATURE_BANDS["janked-start"]` configures BOTH `A` (head-loss)
  and `C` (constant-late, 50-235 ms) — the first draft's claim that "no C band is
  configured" was itself wrong. The real reasons, read directly from the classifier's
  own persisted `detail` strings: (1) `classifyCell` resolves the head-loss branch
  BEFORE the band-matching loop that would check `C` — a repeat with `missingBeats>0`
  (48k/120/r3, `detail: "repeat has unusable measurement:
  medianBeatErrorMs=-121.56249793370577, missingBeats=1"`) is forced straight to
  `investigate` and never reaches band matching at all; (2) for the other repeats, the
  classifier's own `detail` reads `"no band matched: mean=-80.21ms …"` (48k/97.3) /
  `"no band matched: mean=-85.11ms …"` (44.1k/120) / `"no band matched: mean=-82.34ms
  …"` (44.1k/97.3) — `constant-late`'s match condition requires `mean > 0` (per
  `classifyCell`'s code), and every measured mean is NEGATIVE (content early, not
  late), so `C` structurally cannot match regardless of magnitude. The 150 ms jank did
  measurably shift SOMETHING (see A above — one repeat showed genuine content skip),
  but the surviving 11 repeats' medians are statistically indistinguishable from
  `nominal-start`'s own B-mechanism bias — there is no clean, isolated C signature in
  this data. **C: not confirmed, not cleanly refuted — the current `janked-start`
  scenario does not isolate it from A/B.** A dedicated C-only provocation (jank that
  reliably overlaps the SDK's anchor-read window without ever causing outright content
  loss) is a candidate follow-up.

  **Explicit spec §6 deviation:** the design spec's success criteria state "Each
  predicted signature A–D is either confirmed with a measured magnitude or explicitly
  refuted in the register" — a binary outcome. Prediction C does not resolve to
  either: this campaign's `janked-start` provocation cannot isolate C's effect from A
  and B's (both of which ARE independently confirmed/characterized), so C's outcome
  is neither a clean confirmation nor a clean refutation. This is registered here as
  a deliberate, explicit deviation from that binary framing — not an oversight — with
  the reason (no C-specific provocation exists in this campaign's scenario set) and
  the concrete follow-up needed to resolve it (a jank provocation that reliably
  overlaps the SDK's post-flip anchor-read window without ever triggering outright
  content loss, so its effect can be measured in isolation from A). Campaign closure
  should treat this honestly as "open, not closed" rather than force-fitting it into
  confirmed or refuted.

- **D (loop-wrap, 15-30 ms constant-late, flat across takes) — CONFIRMED FLAT,
  REFUTED IN MAGNITUDE AND SIGN.** Every successfully-finalized `loop-wrap` repeat
  (both bpms, both rates) shows the flatness D predicts: consecutive wrap takes (1-4)
  agree to within 0.02-0.1 ms of each other within a repeat (e.g. 48k/120/r1: -71.17,
  -71.17, -71.17, -71.17 across takes 0-3). But the magnitude (~-62 to -79 ms across
  every successful repeat measured) is 2-5x D's predicted 15-30 ms ceiling, AND the
  sign is EARLY (negative), not LATE (D predicts wrapped content emerges late,
  positive). This is very likely the SAME uncompensated-worklet-connect-gap mechanism
  as B (loop-wrap's first take also goes through the no-count-in `waveformOffset`
  formula, and that same `currentWaveformOffset` baseline is inherited additively by
  every subsequent wrap take per `RecordAudio.ts:238`/`279` — see repo CLAUDE.md's
  "Loop Take Buffer Layout"), NOT the predicted 20 ms voice-crossfade lateness, which
  would be a much smaller, positive, per-wrap-independent effect. **D as originally
  predicted (crossfade lateness) is not confirmed by this data — the measured constant
  offset is dominated by an inherited B-mechanism bias, not the crossfade.** The
  crossfade effect may still be present underneath but is not separable from B's
  larger bias with this harness's current measurement. `take5` (final,
  teardown-finalized) is consistently more negative than takes 1-4 at every rate/bpm
  measured — small and separately explainable by the documented "up to one
  render-quantum overshoot" on the teardown-finalized take (CLAUDE.md), not
  investigated further here.

### C1 fix: `janked-start` provocation was measuring itself

See prediction A above for the full evidence and the corrected data. Code fix: the
busy-loop spin now runs inside the callback of a `project.engine.isRecording
.catchupAndSubscribe(...)` subscription set up BEFORE calling `project.startRecording()`,
firing only once `isRecording` genuinely flips true (by which point
`capture.prepareRecording()`'s worklet-connect and `engine.prepareRecordingState()`
have already run) — so the spin now blocks only the SDK's OWN post-flip position-tick
handling, not the capture pipeline's own startup. `src/demos/recording/recording-alignment-audit-debug-demo.tsx`,
tsc-clean, re-smoked on a single cell before the full 4-cell re-run.

**Undisclosed run, corrected (fix round 2, N2):** the single-cell C1 smoke test
(`?scenario=janked-start&bpm=120&rate=48000`) was actually run TWICE before the full
4-cell re-run: an initial attempt, `recaudit-summary-1788290585653.json`, and a
second attempt whose data is what "Fix round 1" cited above
(`recaudit-summary-1788290691302.json`'s bpm=120 rows, later superseded anyway by the
full re-run). The first attempt's repeat 1 is a genuinely degenerate outlier, not
previously documented: `waveformOffsetSec=118.679s`, `regionPositionPpqn=9313`
(→ `regionStartSec≈4.85s`), `matchedBeats=1`, `medianBeatErrorMs=-190.86`,
`clockNoiseIdentifiedClicks=117` (vs. the usual 26 — the reference-click schedule ran
long enough to still be sounding). A `waveformOffsetSec` of 118.7 SECONDS is an
extreme instance of term 2 in the bring-up decomposition (the RecordingWorklet's
frame counter, uncompensated, measuring far more elapsed time than the transport
clock's ~4.85s at the same tick) — nearly 3 orders of magnitude past the typical
20-90 ms range measured elsewhere in this campaign. The mechanism is not confirmed
(this campaign didn't instrument `recordingWorklet.numberOfFrames`'s own start
instant directly), but it raises a real question: **does every FIRST repeat after a
fresh page load carry some elevated risk of this term-2 mechanism running large**
(worklet setup/compile/connect overhead concentrated in the first recording of a
session), of which this 118.7s case is an extreme instance and the matrix's own
`nominal-start`/120/repeat1 `16/1` missing-beat case (see "Band separation" above,
also a repeat-1) might be a milder one? This campaign did not test for a
first-repeat-vs-later-repeat effect directly (repeats within a cell reuse the same
tape/session, so only the very first repeat of an entire page load is "first" in the
relevant sense, and only a few page loads were run per scenario). **Open
follow-up for Task 8 or a future campaign:** run a scenario with the SAME cell
repeated many times across FRESH page loads and compare repeat-1-of-session medians
against later ones, to test whether first-repeat-after-load carries a measurably
larger term-2 bias than steady-state repeats.

### C2: `loop-wrap` finalization timeout — characterized, not resolved

**Every `loop-wrap` failure across every run this campaign made (original matrix runs,
the retry, and this fix round's diagnostic re-runs — 27 total finalization attempts
across 5 separate campaign runs), verified directly from each run's persisted
`errorMessage` field, carries the identical text:
`"finalizing: finalization timed out after <deadline>s"`.** This was checked for
EVERY failing row individually (not spot-checked), including the original
44.1k/97.3 run's two failures (`…1788288625777.json` repeats 1-2), which carry this
same message. `waitForPosition`/transport-quirk wording never appears in any
loop-wrap row across this entire campaign — that quirk (which the original draft
attributed loop-wrap's failures to) appears only in one of the two excluded bring-up
`nominal-start` attempts (`…1788286745058.json`; the other excluded attempt,
`…1788283946271.json`, carries yet a third, different message,
`"finalizing: no take regions created"` — see "Bring-up calibration" above).

**Diagnostic test: does raising the deadline fix it?** Widened `loop-wrap`'s
finalization wait from 30s to 90s (3x) and re-ran (`recaudit-summary-1788291343233.json`,
48000 Hz): **4 of 6 repeats STILL timed out at 90s** (bpm 120: 3/3 failed; bpm 97.3:
1/3 failed). The 2 repeats that DID succeed finalized in **129-146 ms** — three orders
of magnitude under even the original 30s deadline. This is a **binary fast-success-or-
never-completes split, not a slow gradient** — refuting "genuinely needs more time"
(a harness deadline miscalibration) as the explanation. Reverted the deadline to 30s
(the 90s value bought nothing but wall-clock time) and re-ran at 44100 Hz for
cross-rate evidence (`recaudit-summary-1788291706370.json`): 120 bpm 2/3 succeeded
(86-100 ms each), 97.3 bpm 3/3 failed.

**Full tally across all 5 campaign runs that attempted `loop-wrap` finalization** (27
attempts, 5 separate page loads, run ids: `…1788287951691` [orig 48k],
`…1788288625777` [orig 44.1k], `…1788288803959` [retry 44.1k/120],
`…1788291343233` [fix-round 90s, 48k], `…1788291706370` [fix-round 30s, 44.1k]):
**18 of 27 attempts (67%) timed out.** Of the 9 successful attempts, the 4 from this
fix round's two diagnostic re-runs (the only ones with explicit finalize-duration
logging — added this round) completed in 86-146 ms; the other 5 successes (from the
original matrix runs and the retry, which predate that diagnostic) are confirmed
successful (non-error status) but their exact finalize duration was not logged. No
clean bpm or rate correlation — failure rates per cell ranged from 33% to 100% across
the different runs, consistent with an intermittent, timing-dependent condition rather
than a deterministic one tied to a specific bpm/rate combination.

**Classification: candidate new issue, NOT a harness-deadline-miscalibration
artifact.** The evidence (binary fast/never split; 90s insufficient; 67% failure rate
across 27 attempts spanning both rates and bpms) is inconsistent with "the buffer is
just bigger and needs proportionally more decode time" and consistent with a genuine,
reproducible hang somewhere in the finalization pipeline specific to `loop-wrap`'s
larger, multi-wrap shared `AudioFileBox`. Root cause NOT identified — attempts to
inspect the live `SampleLoader` state mid-hang via the React fiber (the
`__reactContainer$…` walk documented in repo CLAUDE.md) failed for this harness
specifically, because `project`/`audioContext` here are local closures inside the
`runAudit`/`runProbe` async functions, not React `useState` — the fiber-walk technique
that works for apps keeping `project` in component state doesn't find anything to walk
in this demo. Recommend Task 8 either accept this as a candidate finding for an
upstream issue draft (repro: `?scenario=loop-wrap&bpm=all&rate=<44100|48000>`,
run several times to reproduce) or add harness instrumentation that exposes the
live loader for future live-inspection.

### Every `investigate` cell — harness artifact vs. candidate new issue

- **`nominal-start` (both bpms, both rates, all repeats): candidate new issue**, not a
  harness artifact. Root cause traced to source (`RecordAudio.ts:270-274`), reproduced
  cleanly and consistently, magnitude far exceeds the originally predicted B band.
  Recommend this becomes the primary upstream issue this campaign produces (measured
  signature: roughly -60 to -110 ms early placement, no count-in, idle main thread;
  the harness-path `outputLatency` term (23 ms) should be named separately in any
  issue draft, per the bring-up decomposition).
- **`countin-start` (both bpms, both rates, all repeats): same candidate issue as
  `nominal-start`** (same mechanism, see prediction B above) — not a separate issue.
- **`midtimeline-start` (both bpms, both rates, all repeats): candidate new issue**,
  distinct from `nominal-start`'s. The consistent `missing=1` beat plus large negative
  median is the A-mechanism (region.position anchored at first-observed position while
  the transport was already running) COMPOUNDED with the same B-mechanism bias
  measured above (count-in is off, so `nominal-start`'s bias term is present too, on
  top of A's genuine content-skip). Recommend describing this as A's manifestation on
  an already-playing transport, cross-referencing the B-mechanism issue rather than
  filing a third, overlapping issue.
- **`janked-start` (both bpms, both rates, fix-round data): mostly the same B-mechanism
  issue as `nominal-start`, with one confirmed A-mechanism content-skip repeat.** Not
  a distinguishable third issue — see prediction A above.
- **`loop-wrap` (both bpms, both rates): candidate new issue for the magnitude/sign
  mismatch against D** (see prediction D above) — likely the same B-mechanism bias
  inherited into the loop-wrap take chain, not a separate placement defect.
  **Separately, `loop-wrap`'s finalization-timeout failures are a candidate new issue
  in their own right** — see the C2 entry above. NOT a harness artifact (the original
  attribution to the transport-start-delay quirk was wrong — see "Fix round 1").
- **`loop-wrap` take4's low `matched` count, likely HARNESS ARTIFACT, unresolved —
  corrected (fix round 2, N1): NOT consistently 1.** Across every successful
  loop-wrap repeat found in any run this campaign made (9 total, tallied directly
  from the persisted JSON across all 5 loop-wrap campaign runs), take4's
  `matchedBeats` is **0 for 2 of the 9** (48k/120/r1 `…1788287951691.json`;
  44.1k/120/r1 `…1788291706370.json`) and **1 for the other 7**. `take4` (the 5th
  and last WRAP-finalized take, 0-indexed) should be full-loop-length like takes 1-3
  (all governed by the same 2-bar loop area), yet its onset match count is far lower
  than takes 1-3/5 (which show 8) EVERY single time it was measured — the specific
  value (0 vs. 1) varies, but the pattern (far below 8) does not. Two candidate
  explanations, neither confirmed: (a) `waitForTakeCount`'s target
  (`LOOP_WRAP_TAKES + 1 = 6` regions) is satisfied the instant the 6th region is
  CREATED, which happens at the exact moment take4 (the 5th) finalizes — if
  measurement reads take4's `duration`/`loopDuration` fields before a final write
  settles, its effective onset-matching window could be truncated (variably, hence
  the 0-vs-1 split); (b) a genuine SDK effect specific to the second-to-last take in
  a `waitForTakeCount`-terminated sequence. Recommend Task 8 (or a follow-up) add a
  short settle-wait before measuring in loop-wrap cells and re-check whether take4's
  match count recovers to 8.

### Harness gaps identified (not code defects, instrumentation gaps)

- `headMissingMs` only measures the gap between `recordRequestContextTime` and the
  buffer's first captured frame — it does NOT measure `midtimeline-start`'s (or
  `janked-start`'s occasional) variant of head-loss (content skipped because
  `region.position` itself is anchored late while the transport was already running).
  A future harness iteration could add a `positionAnchorLossMs` metric (comparing
  `region.position`'s musical time against the true intended engage position)
  alongside `headMissingMs`.
- No dedicated C-only (jank reliably overlapping the anchor-read window without ever
  causing outright content loss) scenario exists, so C's contribution couldn't be
  isolated from A/B even after the C1 fix.
- The React-fiber live-inspection technique documented in repo CLAUDE.md does not work
  for this harness (no `project` in React state) — a live `loop-wrap` hang could not
  be inspected in-flight this round.

### Candidate new upstream findings, summarized

Three candidates emerge from this campaign, all reproduced with high consistency:
1. The `nominal-start`/`countin-start`/(most of) `janked-start` no-count-in
   `waveformOffset` bias (`RecordAudio.ts:270-274`, magnitude roughly -60 to -110 ms,
   three-term-decomposed in the bring-up section).
2. `midtimeline-start`'s (and one `janked-start` repeat's) A-mechanism content skip
   (missing beat, same code path's `currentPosition` anchor).
3. `loop-wrap`'s reproducible finalization-timeout hang (67% failure rate across 27
   attempts, binary fast/never split, not fixed by widening the harness's own
   deadline) — see the C2 entry.

All three are candidates for upstream issue drafts under `debug/drafts/` (Task 8), per
the repo's issue-filing convention (no suggested-fix section, draft for user review
before posting). `janked-start`'s A-mechanism confirmation and `loop-wrap`'s
D-flatness are confirmations of already-predicted signatures, not new findings on
their own, though both are worth folding into the write-ups above rather than filed
standalone.

## Task 7: harness-path bias adjustment

The team lead's Task 7 ruling recast the campaign's A/B verdict: zero upstream cells
ever reached `matches-known-defect` (see "Outcome summary"), so "every defect cell
flips aligned" is vacuous, and the bring-up decomposition's term 1
(`audioContext.outputLatency`, 23 ms, identical at both rates — see "Bring-up
calibration") is a genuine, harness-attributable additive term baked uncompensated
into every no-count-in `waveformOffset`. This section nets that one term out of the
classification math (NOT out of the published raw signature — both stay available)
and re-checks whether doing so changes any upstream verdict, before the candidate-build
comparison below.

### Lib change

`measureTakeAlignment` (`src/lib/audit/recordingAlignment.ts`) gained an optional
`harnessPathBiasSec` input (seconds, default 0) and a new `TakeAlignment` field,
`medianBeatErrorMsAdjusted = medianBeatErrorMs + harnessPathBiasSec * 1000` — content
that lands exactly `harnessPathBiasSec` early (raw median = `-harnessPathBiasSec*1000`
ms) nets to ~0 adjusted. The raw field is never modified. `classifyCell` now verdicts
on `medianBeatErrorMsAdjusted` (falling back to the raw field only for the structural
"no beats matched" unusable-check, which is bias-independent) — both raw and adjusted
values are persisted on every row and at the run's top level (`harnessPathBiasSec`,
set to `audioContext.outputLatency`, captured once per run). TDD coverage in
`recordingAlignment.test.ts`: 24/24 passing (4 new cases), including an explicit sign
proof (content early by exactly the bias classifies `aligned` under the adjustment)
and a classifyCell case where the adjusted median crosses the tolerance boundary while
the raw one doesn't. `npx vitest run src/lib/audit/`: 52/52 passing. tsc gate clean
before and after.

### Offline recompute — upstream matrix, adjusted classification

Recomputed adjusted classifications for all 20 upstream matrix cells (10
scenario/bpm combinations × 2 rates) directly from the persisted
`.verify-output/recaudit-summary-*.json` files this campaign already produced — **no
new upstream browser runs**. Methodology: for each cell, reconstruct the same
`TakeAlignment[]` the live page classified with (same source file, same take-index
filtering for `loop-wrap`, error rows excluded) with `medianBeatErrorMsAdjusted =
medianBeatErrorMs + outputLatency*1000` (`outputLatency` read from that file's own
top-level field), then call the SAME `classifyCell`/`SIGNATURE_BANDS`/
`ALIGNED_TOLERANCE_MS` the live page uses. Source file per cell mirrors exactly what
"Matrix results — 48000 Hz" / "Matrix results — 44100 Hz" above cite as that cell's
population (including the `janked-start` fix-round and `loop-wrap` split-provenance
exceptions). Two source files (`…1788287951691.json`, `…1788288625777.json`, the two
ORIGINAL matrix runs) predate the `outputLatency` top-level persistence (fix round 1,
I3) and lack the field entirely — those 12 cells use the documented 0.023 s constant
as a fallback (identical value independently confirmed in every OTHER source file
this recompute touches), flagged per-cell. As a self-consistency check, the "before"
column is independently re-derived the same way with the adjustment forced to 0 and
compared against the register's own already-published verdicts above — it matches on
all 20 cells (see raw script output, not committed —
`.superpowers/sdd/2026-09-01-recording-start-alignment-audit/scripts/
task7-adjusted-classification.ts`, session-internal per the task's scope).

| scenario | bpm | rate | before | after (adjusted) | adjusted medians (ms) |
|---|---|---|---|---|---|
| nominal-start | 120 | 48000 | investigate | investigate | -74.6, -71.9, -51.9 |
| nominal-start | 97.3 | 48000 | investigate | investigate | -85.2, -49.9, -79.9 |
| janked-start | 120 | 48000 | investigate | investigate | -47.9, -76.6, -98.6 |
| janked-start | 97.3 | 48000 | investigate | investigate | -50.6, -66.6, -54.5 |
| midtimeline-start | 120 | 48000 | investigate | investigate | -129.2, -131.9, -162.5 |
| midtimeline-start | 97.3 | 48000 | investigate | investigate | -143.4, -124.7, -128.0 |
| countin-start | 120 | 48000 | investigate | investigate | -78.5, -76.5, -61.2 |
| countin-start | 97.3 | 48000 | investigate | investigate | -54.6, -77.3, -58.6 |
| loop-wrap | 120 | 48000 | investigate | investigate | -48.2, -48.2, -48.2, null |
| loop-wrap | 97.3 | 48000 | investigate | investigate | -45.1, -45.1, -45.2, -45.2, -50.7, -50.7, -50.7, -50.8 |
| nominal-start | 120 | 44100 | investigate | investigate | -49.2, -41.9, -76.2 |
| nominal-start | 97.3 | 44100 | investigate | investigate | -75.4, -78.9, -54.0 |
| janked-start | 120 | 44100 | investigate | investigate | -56.3, -66.4, -63.7 |
| janked-start | 97.3 | 44100 | investigate | investigate | -46.4, -66.0, -65.6 |
| midtimeline-start | 120 | 44100 | investigate | investigate | -144.2, -124.6, -133.9 |
| midtimeline-start | 97.3 | 44100 | investigate | investigate | -185.1, -178.5, -182.0 |
| countin-start | 120 | 44100 | investigate | investigate | -76.5, -73.9, -66.2 |
| countin-start | 97.3 | 44100 | investigate | investigate | -70.1, -60.7, -78.7 |
| loop-wrap | 120 | 44100 | investigate | investigate | -48.0, -48.0, -48.1, null, -39.3, -39.3, -39.3, -39.4 |
| loop-wrap | 97.3 | 44100 | investigate | investigate | -44.2, -44.2, -44.2, -44.3 |

**Result: 20/20 cells unchanged (0 flips) — every upstream cell that was
`investigate` before the adjustment remains `investigate` after it.** This is
consistent with, not a refutation of, the bring-up section's own three-term
decomposition: term 1 (`outputLatency`, 23 ms) was always characterized as "small
enough (23 of ~90 ms, ~25%) that subtracting it would not materially change the
classification" — this recompute confirms that stated expectation numerically rather
than assuming it. The dominant terms (2 and 3 — the uncompensated worklet-connect
gap and the anchor-position residual) remain, unadjusted, in every cell's `investigate`
verdict. This sets the baseline the candidate-build comparison below is measured
against: any candidate improvement has to beat the SAME adjusted-classification bar,
not the easier raw one.
