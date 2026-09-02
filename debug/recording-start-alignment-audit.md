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

Every figure below was recomputed for this summary directly from the persisted
`.verify-output/*.json` artifacts it names; none is carried over from the prose of the
sections that follow. Where a figure was measured on the region-anchored beat grid that
Task 7c replaced, it is not quoted here at all — see "What still cannot be corrected".

### Matrix tally

**20/20 cells classified** (5 scenarios × 2 bpms × 2 rates), **0 run-failed cells**, on
each build.

| build | `aligned` | `matches-known-defect` | `investigate` | source |
|---|---|---|---|---|
| upstream 0.0.170 (campaign population) | 0/20 | 0/20 | **20/20** | `recaudit-summary-1788287951691.json` + `…1788288625777.json` (15 cells), `…1788290691302.json` + `…1788290774387.json` (4 `janked-start` cells), `…1788291706370.json` (`loop-wrap`/120/44100) |
| upstream 0.0.170 (fresh absolute-grid baseline) | 0/20 | 0/20 | **18/20 measured, 2 with no usable repeat** | `recaudit-summary-1788310164556.json` (48000 Hz), `…1788310817094.json` (44100 Hz) |
| candidate fix build | 0/20 | **5/20** | 15/20 | `recaudit-summary-1788299505584.json` (48000 Hz), `…1788299943226.json` (44100 Hz), corrected to the absolute grid and re-classified |

The two fresh-baseline cells with no usable repeat are `loop-wrap`/120/48000 and
`loop-wrap`/97.3/44100 — all three repeats of each hit the C2 finalization timeout.
Classification is identical across both sample rates for every scenario on the upstream
build; no rate-dependent effect was found. The candidate build's 5
`matches-known-defect` cells are `nominal-start`/120/48000, `countin-start`/120/48000,
`nominal-start`/120/44100, `nominal-start`/97.3/44100 and `countin-start`/120/44100, all
matching signature B.

**Candidate figures throughout this summary are analytically corrected from persisted
per-row geometry (absolute median = region-anchored median + `phi`), not re-measured** —
the Task 7 override build layout no longer exists on disk.

### Key findings

1. **No-count-in start-placement bias — the campaign's primary finding.** Every
   scenario without a count-in offset places its take EARLY on the timeline. On the
   fresh absolute-grid upstream baseline the per-cell means run **−34.97 to −52.51 ms
   adjusted** across all 18 measurable cells (`…1788310164556.json`,
   `…1788310817094.json`). Root-caused to `RecordAudio.ts:270-274`'s
   `headStartSeconds = wallclockSinceWorklet`, decomposed into three additive terms in
   "Bring-up calibration": a harness-path `audioContext.outputLatency` term (23 ms at
   both rates, out of scope per design spec §2), the dominant uncompensated
   worklet-connect-to-transport-start gap, and an anchor-position residual.
2. **`loop-wrap` finalization hang.** On upstream, **18 of 27** finalization attempts
   across the five campaign runs that attempted `loop-wrap` timed out
   (`…1788287951691`, `…1788288625777`, `…1788288803959`, `…1788291343233`,
   `…1788291706370`), and **10 of 12** on the fresh baseline (5/6 at each rate,
   `…1788310164556`, `…1788310817094`). Binary fast-success-or-never: raising the
   deadline from 30 s to 90 s left 4 of 6 still failing (`…1788291343233`). Root cause
   not identified. See C2.
3. **Multi-mic take collision (Task 7b Finding 1).** `SampleService.importFile` derives
   an `AudioFileBox` uuid as `SHA-256(arrayBuffer)` when none is passed, and
   `importRecording` never passes one. Two simultaneous takes whose encoded bytes are
   identical therefore derive the SAME uuid, and the second `BoxGraph.stageBox` panics
   with `AudioFileBox <uuid> already staged`. **Deterministic, not a race:** a dedicated
   same-device confirmation cell collided on **3 of 3** repeats
   (`recaudit-mt-summary-1788304987514.json`). In the official matrix the incidental
   timing jitter between two independently-scheduled worklets produced colliding content
   on **10 of 24** repeat attempts across both builds (`…1788302627819` 2/6,
   `…1788302870379` 4/6, `…1788303391228` 1/6, `…1788303605274` 3/6) — that count
   measures this harness's own capture-window jitter, not either SDK build.
4. **Inter-track skew (Task 7b Finding 2).** Of the **14** measurable `medianSkewMs`
   values across the four official multi-mic runs, **3** are zero to float precision,
   **10** are within 0.02 ms of ±1 WASM render quantum (2.667 ms @48000 Hz, 2.902 ms
   @44100 Hz), and **1** is a distinct constant outlier (−10.000001 ms = 441 samples at
   44100 Hz, holding to 6 decimal places across all 16 of its paired beats,
   `…1788303605274` `multitrack-start`/r2). **11 of 14 exceed the 2 ms tolerance, and
   the magnitude is identical on both builds** — the candidate fix corrects each tape
   against its own clock and does not synchronize two tapes to each other.
5. **A harness measurement defect, found and fixed in Task 7c.**
   `measureTakeAlignment` anchored its expected-beat grid at the region start, which
   manufactures a phantom grid point whenever no click was captured before the region
   start. That fencepost produced `midtimeline-start`'s permanent `missingBeats = 1` and
   biased every off-grid take's median by exactly `−phi`. The grid is now absolute
   (integer multiples of the beat period from timeline zero). 145 of 351 rows carrying
   geometry are off-grid, so this was not a measurement no-op.

### Content loss

**No genuine in-range content loss was observed on any surviving-buffer repeat; six
legacy rows are unresolved.** Of the **186 rows** whose geometry and capture audio
provably belong together, **zero** report a missing beat under the absolute grid; **29**
do under the region-anchored grid and every one carries unmatched index `[0]` — the
fencepost. **43 rows** across the campaign ever persisted `missingBeats > 0`, and **all
43 have lost their capture buffer** to the pre-fix filename collision, so none can be
re-measured. Six of those, outside `midtimeline-start`, are recorded as **unresolved
candidates** — never as instances — in "Unresolved candidates": `…1788287951691`
(`nominal-start`/120/48000 r1), `…1788290691302` (`janked-start`/120/48000 r3),
`…1788300424628` and `…1788305205480` (both `nominal-start`/120/48000 r1), plus
candidate-build `…1788296570300` (`janked-start`/120/48000 r3) and `…1788297229626`
(`nominal-start`/97.3/44100 r1). The guarantee that the fixed metric still catches a
genuinely absent in-range beat is a **unit-test guarantee**
(`src/lib/audit/recordingAlignment.test.ts:192` and `:237`), not a measurement one.

### Prediction outcomes (A–D)

| ID | Outcome | Evidence |
|----|---------|----------|
| A — take anchored at first-*observed* position, head content skipped | **WITHDRAWN** | Both supporting legs fell in Task 7c. `midtimeline-start`'s 12/12 was the harness fencepost — 0 of 12 fresh upstream midtimeline repeats report a missing beat (`…1788310164556`, `…1788310817094`), and 0 of 24 replayable midtimeline takes do under the absolute grid. The single remaining `janked-start` repeat is an unresolved candidate with no buffer left; 6 fresh repeats of its exact cell report `missingBeats = 0` (`…1788309532177`, `…1788309644009`). No upstream issue is drafted for A. |
| B — random ±15 ms band from ring-reader delivery lag | **CONFIRMED in mechanism and direction, REFUTED in magnitude** | The measured bias is roughly an order larger than predicted and systematically negative. Fresh absolute-grid per-cell means −34.97 to −52.51 ms (`…1788310164556`, `…1788310817094`). Any upstream report should describe B's measured band as this range on this SDK/environment, with the 23 ms harness-path `outputLatency` term named separately. |
| C — 50–235 ms constant-late under main-thread jank | **NOT CONFIRMED, NOT CLEANLY REFUTED — explicit design-spec §6 deviation** | `janked-start` cannot isolate C from A and B: `classifyCell` resolves the head-loss branch before band matching, and `constant-late` structurally requires a positive mean while every measured mean is negative. Registered as a deliberate deviation from the spec's binary framing, with the follow-up needed to resolve it (a jank provocation that overlaps the anchor-read window without causing content loss). |
| D — loop-wrap content ~20–24 ms LATE, flat across takes | **CONFIRMED FLAT, REFUTED in magnitude and sign** | Consecutive wrap takes agree to within 0.02–0.1 ms within a repeat, as predicted. But the offset is EARLY, not late, and 2–5× the predicted 15–30 ms band — the same inherited no-count-in bias as B, not the predicted voice-crossfade lateness. |

### Candidate-build verdict — partial pass

Measured against the recast criteria, on the absolute grid ("Task 7c fix round 1:
verdict re-derived on the absolute grid"):

- **(a) targeted cells read `aligned` — PARTIAL.** Zero of the 20 cells reach literal
  `aligned`. But 5 of 20 reach `matches-known-defect` (signature B), and the bias
  magnitude falls on **18 of 18 comparable cells** — none regresses. Recomputed
  reductions: `nominal-start`/`countin-start` **50.5–82.1 %** (8 cells),
  `janked-start` **71.5–81.2 %** (4 cells), `midtimeline-start` **42.1–69.3 %**
  (4 cells), `loop-wrap` **35.2–40.2 %** (2 comparable cells). The remaining 2 cells
  have no upstream comparison at all: all three fresh upstream repeats of
  `loop-wrap`/120/48000 and `loop-wrap`/97.3/44100 hit the C2 timeout.
- **(b) no cell regresses — MET.** 18 of 18 comparable cells smaller in magnitude.
- **(c) `loop-wrap` finalization-hang failure rate — MET, mechanism unexplained.**
  0 of 12 candidate repeats failed (`…1788299505584`, `…1788299943226`) against 10 of
  12 fresh upstream (`…1788310164556`, `…1788310817094`) and 18 of 27 historically. The
  candidate fixes do not touch the finalization pipeline, so this is reported as a
  **measured outcome without a confirmed causal mechanism**.
- **(d) head/tail integrity — MET.** `tailMissingMs` is 0 on all 120 candidate rows;
  `headMissingMs` exceeds the 2 ms gate on 12 of 120, none of which changes a
  classification.

**Overall: the candidate build passes (b), (c) and (d), and makes substantial,
consistent, non-regressing progress on (a) without clearing it.** The two orthogonal
multi-mic findings (collision, skew) are untouched by it and remain open on both builds.

### Evidence index

| quantity | artifact(s) |
|---|---|
| upstream 20-cell tally | `recaudit-summary-1788287951691.json`, `…1788288625777.json`, `…1788290691302.json`, `…1788290774387.json`, `…1788291706370.json` |
| fresh absolute-grid upstream baseline | `recaudit-summary-1788310164556.json`, `…1788310817094.json` |
| candidate matrix (corrected, not re-measured) | `recaudit-summary-1788299505584.json`, `…1788299943226.json` |
| `loop-wrap` C2 historical tally | the five runs named under key finding 2 |
| 90 s deadline diagnostic | `recaudit-summary-1788291343233.json` |
| Prediction A re-measurement | `recaudit-summary-1788309532177.json`, `…1788309644009.json` |
| multi-mic official matrix | `recaudit-mt-summary-1788302627819.json`, `…1788302870379.json`, `…1788303391228.json`, `…1788303605274.json` |
| multi-mic collision confirmation | `recaudit-mt-summary-1788304987514.json` |
| multi-mic geometry re-check | `recaudit-mt-summary-1788309690683.json`, `…1788309841868.json`, `…1788309988877.json` |
| replayable-row census, missing-beat census | all 40 `recaudit-summary-*.json` runs through `1788310817094` |

### Upstream contribution outcome

One PR-description draft (`pr-recording-start-alignment.md`) and **five** issue drafts,
all under `debug/drafts/` — one per confirmed finding the PR does not fully and
explainably fix:

| draft | finding |
|---|---|
| `issue-residual-start-placement-bias.md` | the no-count-in placement bias on all five scenarios, with the three-term decomposition, the fresh-upstream signature per scenario, and the post-fix residual per scenario (Predictions B and D's measured outcomes both live here) |
| `issue-loop-wrap-finalization-hang.md` | C2, filed on its own footing — resolved in the candidate data, mechanism unexplained |
| `issue-punch-in-head-loss.md` | the request-to-first-frame capture gap, present on every scenario, unchanged by the candidate fix |
| `issue-take-collision.md` | Task 7b Finding 1, the deterministic content-address collision |
| `issue-inter-track-quantum-skew.md` | Task 7b Finding 2, render-quantum-granular inter-track skew |

The PR draft's "what this does not fix" list points at all five, with the hang described
as resolved in the PR's data but with no mechanism identified.

**Deliberately not drafted, because neither is confirmed:** Prediction C's explicit
spec-§6 deviation (the campaign's `janked-start` provocation cannot isolate it from A
and B), and the six unresolved legacy rows under "Unresolved candidates" (buffers gone,
undecidable in either direction). The withdrawn Prediction A gets no draft.

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
   see the C1 fix and prediction A below; **[Task 7c: the A-mechanism leg of that
   "confirmed" is withdrawn — see "Midtimeline first-beat drop"]**). This residual is why the total measured
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
`REF_CLICK_HZ`/`highCutoffHz` adjustment was made. **[Task 7c: that row
(`…1788287951691` `nominal-start`/120/48000 r1) is now one of six unresolved candidates —
it persists no geometry and its buffer is gone, so "detector noise" versus absent content
cannot be decided, and three later `nominal-start` rows also reported `missing = 1`; see
"Unresolved candidates" in the Task 7c section.]**

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

**Grid caveat (Task 7c fix round 1):** every median in this table was measured against
the region-anchored beat grid, which subtracts each take's off-grid phase
`phi = regionStart mod beatPeriod` from its error. This run persists no per-row
geometry, so its `phi` values are unrecoverable and these medians cannot be corrected —
see "Task 7c fix round 1: verdict re-derived on the absolute grid" for the fresh
absolute-grid upstream measurement that replaces them. The `missing=1` flags in this
table are region-anchored-grid outputs too: the `janked-start` r3 row is an unresolved
candidate (see "Unresolved candidates" in the Task 7c section) and the
`midtimeline-start` rows carry the harness fencepost.

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

**Grid caveat (Task 7c fix round 1):** same as the 48000 Hz table above — region-anchored
medians, no persisted geometry, not correctable. See "Task 7c fix round 1: verdict
re-derived on the absolute grid".

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
scatter, not rate-dependent (**every per-cell mean below is a region-anchored-grid
figure — see the grid caveat on the two tables above and "Task 7c fix round 1: verdict
re-derived on the absolute grid"**):

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

- **A (head-loss, `janked-start`/`midtimeline-start`) — WITHDRAWN in Task 7c fix round
  1; the text below is the pre-withdrawal record.** Both supporting legs fell: the
  `midtimeline-start` 12/12 was this harness's expected-beat fencepost, and the single
  `janked-start` repeat cited here (`…1788290691302`, 48k/120/r3) is itself off-grid at
  `phi = 29.17 ms` with the same fencepost signature and was never re-measured before its
  buffer was overwritten — it is recorded as an unresolved candidate, not a resolved
  fencepost (see "Unresolved candidates" in the Task 7c section); 6 fresh repeats of
  that exact cell show `missing = 0`. See
  "Task 7c fix round 1: verdict re-derived on the absolute grid". Original text: **A
  CONFIRMED, but only after the C1 fix; the original `janked-start` "confirmation" was
  invalid.** The original
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
  large negative median (-147 to -209 ms). **[WITHDRAWN — the missing beat is a
  region-anchored-grid fencepost and the median carries that grid's `-phi` bias; see
  "Midtimeline first-beat drop" and "Task 7c fix round 1".]** `region.position` (read once, at the first
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
  measurably shift SOMETHING (see A above — one repeat showed genuine content skip
  **[Task 7c: that repeat is an unresolved candidate, not a shown content skip — see A's
  withdrawal note above]**),
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
  and B's (B is independently characterized; A's confirmation is withdrawn in Task 7c,
  which leaves C's isolation problem unchanged), so C's outcome
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
  distinct from `nominal-start`'s. **[WITHDRAWN in Task 7c — the distinguishing
  `missing=1` is a harness grid artifact; on the absolute grid `midtimeline-start`
  collapses into the same no-count-in placement bias as every other scenario. See
  "Task 7c fix round 1".]** The consistent `missing=1` beat plus large negative
  median is the A-mechanism (region.position anchored at first-observed position while
  the transport was already running) COMPOUNDED with the same B-mechanism bias
  measured above (count-in is off, so `nominal-start`'s bias term is present too, on
  top of A's genuine content-skip). Recommend describing this as A's manifestation on
  an already-playing transport, cross-referencing the B-mechanism issue rather than
  filing a third, overlapping issue.
- **`janked-start` (both bpms, both rates, fix-round data): mostly the same B-mechanism
  issue as `nominal-start`, with one confirmed A-mechanism content-skip repeat.** Not
  a distinguishable third issue — see prediction A above. **[Task 7c: "confirmed" is
  withdrawn — that repeat (`…1788290691302` r3) is an unresolved candidate whose buffer
  is gone; see "Unresolved candidates" in the Task 7c section.]**
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

- **[Task 7c fix round 1: the `midtimeline-start` head-loss this gap was written for
  does not exist — see "Task 7c fix round 1". The gap statement itself still holds for
  any genuine position-anchor loss.]** `headMissingMs` only measures the gap between
  `recordRequestContextTime` and the buffer's first captured frame — it does NOT measure
  `midtimeline-start`'s (or `janked-start`'s occasional) variant of head-loss (content skipped because
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

Three candidates emerged from this campaign, each reproduced with high consistency as
measured at the time; item 2 has since been withdrawn (Task 7c), so two remain live:
1. The `nominal-start`/`countin-start`/(most of) `janked-start` no-count-in
   `waveformOffset` bias (`RecordAudio.ts:270-274`, magnitude roughly -60 to -110 ms,
   three-term-decomposed in the bring-up section).
2. `midtimeline-start`'s (and one `janked-start` repeat's) A-mechanism content skip
   (missing beat, same code path's `currentPosition` anchor). **WITHDRAWN in Task 7c
   (fix rounds 1–3); do not file this as an upstream issue.** The two legs have
   different standings and are not both "proven fencepost": the `midtimeline-start`
   12/12 leg is dissolved by the harness's own expected-beat fencepost — the Task 7c
   verdict, resting on the 24 `midtimeline-start` rows whose capture audio survives
   (`missingBeats = 0` on 24 of 24 under the absolute grid) and on 12 fresh upstream
   repeats at 0 missing; the original 12 repeats' buffers on each build are gone and
   are explained by the mechanism, not re-measured. The `janked-start` leg
   (`…1788290691302`, 48k/120/r3) is an **unresolved candidate**: off-grid at
   φ = 29.17 ms and consistent with the fencepost the absolute grid dissolves, but its
   buffer is gone, so whether it was the fencepost cannot be decided; 6 fresh repeats
   of its cell report `missingBeats = 0`. See "Midtimeline first-beat drop" (Task 7c),
   its "Unresolved candidates" table, and "Prediction A, restated from fresh
   measurement" — A's withdrawal rests only on surviving-buffer evidence.
3. `loop-wrap`'s reproducible finalization-timeout hang (67% failure rate across 27
   attempts, binary fast/never split, not fixed by widening the harness's own
   deadline) — see the C2 entry.

Items 1 and 3 are candidates for upstream issue drafts under `debug/drafts/` (Task 8),
per the repo's issue-filing convention (no suggested-fix section, draft for user review
before posting); item 2 is withdrawn and gets no draft. `loop-wrap`'s D-flatness is a
confirmation of an already-predicted signature, not a new finding on its own, and is
worth folding into the `loop-wrap` write-up rather than filed standalone. The
`janked-start` A-mechanism repeat is NOT a confirmation and is not to be folded into any
write-up: it is the unresolved candidate described under item 2 (buffer gone, status
undecidable), and Prediction A is withdrawn — see "Prediction A, restated from fresh
measurement" in the Task 7c section.

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
I3) and lack the field entirely. Those two files source 15 of the 20 cells (8 from
the 48k original run: `nominal-start`/`midtimeline-start`/`countin-start`/`loop-wrap`
× 2 bpms each; 7 from the 44.1k original run: the same four scenarios × 2 bpms,
minus `loop-wrap`/120, which the fix-round `loop-wrap` re-run supplied instead) —
those 15 cells use the documented 0.023 s constant as a fallback (identical value
independently confirmed in every OTHER source file this recompute touches), flagged
per-cell. As a self-consistency check, the "before"
column is independently re-derived the same way with the adjustment forced to 0 and
compared against the register's own already-published verdicts above — it matches on
all 20 cells (see raw script output, not committed —
`.superpowers/sdd/2026-09-01-recording-start-alignment-audit/scripts/
task7-adjusted-classification.ts`, session-internal per the task's scope).

**Grid caveat (Task 7c fix round 1):** these adjusted medians are region-anchored-grid
figures over the two upstream matrix runs, which persist no per-row geometry — their
off-grid phase is unrecoverable and they are NOT comparable with any absolute-grid
figure. See "Task 7c fix round 1: verdict re-derived on the absolute grid".

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

## Task 7: candidate-build verification

A candidate-fix build (a separate, non-origin-named build — see repo convention)
was swapped in via `SDK_DIST_OVERRIDE` (dev-server-only mechanism, `vite.config.ts`,
Task 5) and both matrices (48000 Hz, then 44100 Hz — fresh page load each,
`?scenario=all&bpm=all&rate=<n>`, real click) were re-run against it, using the SAME
harness, SAME `SIGNATURE_BANDS`/`ALIGNED_TOLERANCE_MS`, and the SAME adjusted
classification introduced above. `sdkBuildProbe` read `"candidate"` on every run and
`"upstream"` again after the restore.

**N3 precondition (closes a Task 6 open item):** one live `janked-start`/120/48000
smoke cell was run BEFORE the override swap, on the upstream build with the new
adjustment fields wired (`recaudit-summary-1788295321703.json`). Recharacterized
honestly, correcting an overstatement in the first draft of this section: 3 repeats
completed with bounded errors and no run failures, but NOT uniformly "clean" —
repeat 1 shows `matched=5, missing=0` and a median of +31.12 ms raw (+54.12 ms
adjusted), a genuine positive outlier against repeats 2-3's -88 to -90 ms raw range,
consistent with the SAME "first-repeat-after-a-fresh-page-load" term-2 effect Task 6's
N2 finding already documented (that finding's own worked example was a much more
extreme instance, `waveformOffsetSec=118.7s`). `medianBeatErrorMsAdjusted` correctly
offset from the raw median by exactly +23.00 ms on every one of the 3 repeats
regardless (54.12, -65.23, -66.54 ms from raw 31.12, -88.23, -89.54 ms) — the
adjustment arithmetic itself is unaffected by which repeat is an outlier. This
precondition run used the UPSTREAM build (it ran before the override swap) — it is
unrelated to the C1 fix-round finding below and not itself invalidated by it. **[Task
7c: repeat 1's positive median is a region-anchored-grid artifact — the row is off-grid
at φ = 406.25 ms and degenerate (`matched = 5`); its re-aliased value is derived, not
measured. See "Prediction A, restated from fresh measurement".]**

### C1 (team-lead review, fix round 1): the "candidate-repo bug" claim was wrong — it was our own build/layout defect

The first draft of this section claimed a genuine bug in the candidate repo's own
JS/Rust contract (`contextTime` written by a JS-side schema but never wired on the
Rust side). **That claim is retracted — it was incorrect, and the actual cause was a
defect in how this task laid out the `SDK_DIST_OVERRIDE` directory, not anything
wrong in the candidate repo.**

The candidate's WASM engine's SyncStream writer lives in
`packages/studio/core-wasm/src/processor.ts` — a JS file, not Rust. It reads the raw
Rust engine-state buffer via hand-decoded `DataView` offsets into LOCAL variables,
then writes those (plus `state.contextTime = currentTime`, an AudioWorkletGlobalScope
value, not something read from Rust memory at all) into the schema-driven
`SyncStream.writer` by NAMED field assignment — the schema's own serializer handles
byte layout on the output side, fully decoupled from the Rust-side input offsets.
Verified directly: the candidate's `write_engine_state` (Rust) and its `STATE_*`
byte-offset constants are **byte-for-byte identical** between the candidate repo
(commit checked out for this task) and the pinned upstream SDK source checkout
(`diff` of both functions and both constant blocks: empty, exit 0) — there never was
a Rust-side field to add. `state.contextTime = currentTime` was added to
`processor.ts` in the SAME commit that added the field to the JS schema.

**The real defect: the first override layout paired the candidate's rebuilt
`studio-core` (which reads `contextTime` via the schema) with the UPSTREAM
`studio-core-wasm` package's compiled `wasm-processor.js` — which, being built from
UNMODIFIED upstream source, never runs the line that sets `state.contextTime`.** The
schema reader on the candidate side still decoded SEQUENTIALLY from the byte stream,
so it read `perfIndex`'s bytes (and part of `perfBuffer[0]`'s) as `contextTime`,
producing `engine.syncContextTime === 0` on every packet (0 ≥ any positive
`firstQuantumTime` is always false) — silently forcing every candidate take onto the
exact fallback path (`project.env.audioContext.currentTime`) the fix's
`syncContextTime` branch exists to replace. This was purely a consequence of NOT
rebuilding `@opendaw/studio-core-wasm` from candidate source — a scoping choice made
in the original build plan (limited to `studio-core` + its declared dependency chain,
which does not include `studio-core-wasm`), not a candidate-repo defect.

**Fix: rebuilt `@opendaw/studio-core-wasm` from candidate source.** `build:bundles`
(pure esbuild — `processor.ts`→`wasm-processor.js`, `offline-worker.ts`→
`wasm-offline-worker.js`, no Rust toolchain) ran clean. Verifying the rebuilt bundle
actually engages surfaced a SECOND, independent self-inflicted layout defect (not a
candidate-repo bug either): the candidate ships features and plugin packages absent
from upstream, and two of the package's own source files each carry their own
independent, hardcoded list of which device plugins exist — those two lists have
diverged from each other between the two builds (each ships plugin files the other
lacks). Mixing the candidate's rebuilt `wasm-processor.js` with upstream's
`dist/wasm/plugins/` satisfied one of those lists but not the other, producing 404s
that Vite's dev-server SPA-fallback turned into HTML responses where a `.wasm`
binary was expected (`WebAssembly.compile(): expected magic word ... found
3c 21 44 4f` — `<!DO`, an HTML document) — a completely different failure from the
first one, caught only by actually attempting a live run, not by inspecting file
layouts. (Every attempt in this failure state threw inside the AudioWorkletProcessor
constructor before any measurement could run, so by construction it produced NO
`recaudit-summary-*.json` artifact — the affected runs are fully accounted for by
"attempted, failed to boot, no data," not by any gap in the `.verify-output/`
enumeration elsewhere in this register.)

Resolution: built the candidate's COMPLETE WASM engine from source
(`build-wasm.sh` — cargo/rustc/wasm-pack and a `nightly` toolchain were all already
available in this environment; every device crate plus the main engine compiled
clean, `wasm-opt` unavailable so shipped unoptimized — size only, not correctness) —
so the plugin set and `wasm-processor.js` come from the same build, no more
cross-build device-catalog mismatch on that side. The package's separately-compiled
main-thread API layer was kept from upstream (unmodified by the fix commits, avoids
pulling in a dependency this campaign has no reason to build) — it still references
its own device names, so the final plugin directory is the UNION of the candidate's
full build and upstream's plugin-only files — additive only, nothing overwritten or
omitted, so every consumer's fetch list is satisfied regardless of which catalog it
reads from. Full package-and-file-level layout (which specific files came from
which build) is recorded in `.claude/local.md` ("Task 7 build/layout") rather than
enumerated here — the combination of candidate-specific feature/package names is
itself an identifying detail this register avoids per the campaign's privacy
convention, even without naming the candidate repo directly. The Rust
`write_engine_state` this build now ships was independently verified byte-identical
to upstream's (see above), so this substitution changes nothing observable there.

**Anchor-engagement verification (the team lead's required check).** The
React-fiber live-value probe documented elsewhere in this register does not work for
this harness (no `project` in React state — confirmed again this round), so this was
verified via BEHAVIORAL evidence instead, per the team lead's own fallback — but the
first draft of this paragraph cited a nonexistent "broken-layout smoke" and, on
review, was found to have recycled the AFTER run's own data as a fabricated BEFORE
value. Retracted and replaced with the real comparison: the BROKEN layout (upstream
`studio-core-wasm`, `syncContextTime` always 0) is represented by the janked-start/
120/48000 cell from the FIRST candidate matrix run, before any C1 investigation —
`recaudit-summary-1788296570300.json` — adjusted medians -201.23/-190.54/-213.23 ms
(mean ≈ -201.7), with `headMissingMs` 0.38/0/9.71 ms (small, NOT a universal
deficit — no claim about the broken layout's head-deficit pattern is made, since it
shows none worth remarking on). The CORRECTED layout is represented by a same-cell
smoke run right after the `studio-core-wasm` rebuild —
`recaudit-summary-1788299020715.json` — adjusted medians -10.54/-9.9/-15.9 ms (mean
≈ -12.1), an order-of-magnitude reduction consistent with the fix's
`syncContextTime`/`firstQuantumTime` branch genuinely engaging rather than falling
back. This corrected-layout smoke's OWN `headMissingMs` (153.69/0/0 ms — one of its
three repeats, not all) is real and unrelated to the broken layout; it is not
evidence about the "before" state, only a property of the "after" one. Stated
precisely as behavioral confirmation, not a direct numeric read of
`syncContextTime` itself, which this harness cannot obtain.

**Disclosure (I4, corrected):** an UNDISCLOSED candidate smoke run exists from
before this fix round, `recaudit-summary-1788295979783.json` — `nominal-start`/120/
48000 (corrected label; a prior draft mislabeled this `janked-start`), single cell,
run against the very first override layout (wholesale-upstream `studio-core-wasm`,
predating even the C1 investigation). Its repeat 1 shows a 151.04 ms head deficit —
disclosed here explicitly, by run id, rather than left as an unreferenced artifact
in `.verify-output/`; it is a separate data point from the anchor-engagement
comparison above (different scenario, different moment in this task's timeline), not
a source for any claim made there.

**I3 (fix round 2): upstream re-attempt.** The N3 precondition (above) ran on the
upstream build, but every OTHER `janked-start`/upstream comparison this fix round
made used pre-existing matrix data, not a fresh live run made under the current
harness (with `medianBeatErrorMsAdjusted`/`tailMissingMs` persisted per row). Ran
one upstream `janked-start`/120/48000 smoke, 3 repeats, on the dev server as
restored (no override): `recaudit-summary-1788301528380.json`,
`sdkBuildProbe: "upstream"`. Result: 3 clean repeats, no errors, no missing beats,
`headMissingMs` 0 on all three, adjusted medians -69.21/-85.23/-53.23 ms
(mean ≈ -69.2 ms) — squarely inside the -50 to -100 ms band this cell has shown
throughout the campaign (the offline-recompute baseline for this exact cell was
-47.9/-76.6/-98.6 ms adjusted, mean -74.4 ms — this fresh run lands within a few ms
of that mean). No surprises; characterized honestly as an unremarkable confirmation
run, not a new finding.

Full build commands and package layout are recorded in `.claude/local.md`
("Task 7 build/layout") — gitignored, never committed, per the campaign's privacy
convention; that section has been corrected in step with this one (the
"candidate-repo bug" language removed).

### Candidate matrix results — 48000 Hz (corrected layout)

`recaudit-summary-1788299505584.json` (60 rows, `sdkBuildProbe: "candidate"`).
Candidate means are the arithmetic mean of each successful repeat's
`medianBeatErrorMsAdjusted`; upstream means repeat the "Harness-path bias adjustment"
section's per-cell figures above — same source data, same adjustment, same
classification code, only the SDK build differs. `loop-wrap` means use ONLY
takeIndex 1-4 (I2 correction — the live classification always used this population;
an earlier draft's displayed mean incorrectly included takes 0 and 5, which are not
loop-scoped/are teardown-granular respectively and were never part of what
`classifyCell` itself evaluated).

**Grid caveat (Task 7c fix round 1):** the `upstream mean adj` column comes from the two
upstream matrix runs, whose region-anchored medians cannot be corrected (no persisted
geometry), so every Δ in this table is contaminated — including the `midtimeline-start`
rows' "32% / 46% smaller". The candidate column IS correctable and, at this rate, is
unchanged on 8 of its 10 cells (`phi = 0`). Corrected comparison: "Task 7c fix round 1:
verdict re-derived on the absolute grid".

| scenario | bpm | candidate mean adj (ms) | upstream mean adj (ms) | Δ (adjusted) | Δ (raw, offset-invariant) | missing-beat repeats | status |
|---|---|---|---|---|---|---|---|
| nominal-start | 97.3 | -7.67 | -71.67 | 89% smaller | 68% smaller | 0/3 | investigate |
| nominal-start | 120 | -14.55 | -66.13 | 78% smaller | 58% smaller | 0/3 | **matches-known-defect (B)** |
| janked-start | 97.3 | -12.55 | -57.23 | 78% smaller | 56% smaller | 0/3 | investigate |
| janked-start | 120 | -13.66 | -74.37 | 82% smaller | 62% smaller | 0/3 | investigate |
| midtimeline-start | 97.3 | -89.47 | -132.03 | 32% smaller | 27% smaller | **3/3 (unchanged)** | investigate |
| midtimeline-start | 120 | -75.54 | -141.20 | 46% smaller | 40% smaller | **3/3 (unchanged)** | investigate |
| countin-start | 97.3 | -22.77 | -63.50 | 64% smaller | 47% smaller | 0/3 | investigate |
| countin-start | 120 | -9.67 | -72.07 | 87% smaller | 66% smaller | 0/3 | **matches-known-defect (B)** |
| loop-wrap | 97.3 | -29.52 | -47.94 | 38% smaller | 26% smaller | 0/6 repeats, **0/3 attempts failed** | investigate |
| loop-wrap | 120 | -29.00 | -48.20 | 40% smaller | 27% smaller | 0/6 repeats, **0/3 attempts failed** | investigate |

### Candidate matrix results — 44100 Hz (corrected layout)

`recaudit-summary-1788299943226.json` (60 rows, `sdkBuildProbe: "candidate"`).

**Grid caveat (Task 7c fix round 1):** same as the 48000 Hz table above — the upstream
column is uncorrectable, so every Δ here (including "66% / 45% smaller" on
`midtimeline-start`) is contaminated. See "Task 7c fix round 1: verdict re-derived on the
absolute grid".

| scenario | bpm | candidate mean adj (ms) | upstream mean adj (ms) | Δ (adjusted) | Δ (raw, offset-invariant) | missing-beat repeats | status |
|---|---|---|---|---|---|---|---|
| nominal-start | 97.3 | -12.15 | -69.43 | 82% smaller | 62% smaller | 0/3 | **matches-known-defect (B)** |
| nominal-start | 120 | -8.03 | -55.77 | 86% smaller | 61% smaller | 0/3 | **matches-known-defect (B)** |
| janked-start | 97.3 | -13.21 | -59.33 | 78% smaller | 56% smaller | 0/3 | investigate |
| janked-start | 120 | -8.47 | -62.13 | 86% smaller | 63% smaller | 0/3 | investigate |
| midtimeline-start | 97.3 | -61.40 | -181.87 | 66% smaller | 59% smaller | **3/3 (unchanged)** | investigate |
| midtimeline-start | 120 | -73.34 | -134.23 | 45% smaller | 39% smaller | **3/3 (unchanged)** | investigate |
| countin-start | 97.3 | -18.77 | -69.83 | 73% smaller | 55% smaller | 0/3 | investigate |
| countin-start | 120 | -9.58 | -72.20 | 87% smaller | 66% smaller | 0/3 | **matches-known-defect (B)** |
| loop-wrap | 97.3 | -26.42 | -44.23 | 40% smaller | 26% smaller | 0/6 repeats, **0/3 attempts failed** | investigate |
| loop-wrap | 120 | -22.66 | -43.06 | 47% smaller | 31% smaller | 0/6 repeats, **0/3 attempts failed** | investigate |

**Every one of the 20 cells shows a smaller-magnitude bias than upstream, on BOTH the
adjusted and the raw (offset-invariant, M1) comparison — no cell regresses.**
**[Task 7c fix round 1: re-derived against a fresh absolute-grid upstream measurement —
the direction and the "no cell regresses" conclusion survive; the percentages move. See
"Task 7c fix round 1: verdict re-derived on the absolute grid".]** 5 of
the 20 cells (25%) now classify `matches-known-defect`, matching signature B
(random-band, 4-25 ms) — `nominal-start`/120/48k, `countin-start`/120/48k,
`nominal-start`/97.3/44.1k, `nominal-start`/120/44.1k, `countin-start`/120/44.1k.
This is the first time any cell has matched a predicted signature among the data
this campaign currently treats as valid (20 upstream cells + this candidate run —
every one of them classified `investigate`, as did every cell in the earlier
broken-layout candidate run). It is not the literal first signature match ever
recorded in this register's history: the original upstream campaign's first draft
reported `janked-start` matching signature C on 2 cells, later WITHDRAWN in fix
round 1 as measuring the harness's own provocation bug rather than the SDK (see
"Fix round 1") — those withdrawn matches don't count against "first" as meant here.

**(d) Head/tail integrity — restated with actual numbers (I1 correction, recounted
in fix round 2 after the first restatement itself undercounted).** `tailMissingMs`
is 0 on every one of the 120 candidate rows across both rates (persisted per-row as
of this fix round — see lib change below) — clean, no exceptions. `headMissingMs`
exceeds the 2 ms `ALIGNED_TOLERANCE_MS` gate on exactly 12 of the 120 rows (recounted
directly from both matrix JSON files, not from memory — this count is grid-independent,
`headMissingMs` never reads the beat grid):
- 48k `midtimeline-start`/97.3: 3.71 ms (repeat 1), 23.04 ms (repeat 2) — 2 rows
- 48k `midtimeline-start`/120: 3.02 ms (repeat 3) — 1 row
- 48k `countin-start`/97.3: 9.71 ms (repeat 3) — 1 row
- 48k `loop-wrap`/97.3, repeat 1: 2.35 ms on ALL SIX takes (0-5) — 6 rows
- 44.1k `midtimeline-start`/120: 12.02 ms (repeat 2), 6.05 ms (repeat 3) — 2 rows

`nominal-start` has zero rows exceeding the gate at either rate — not named among
the exceptions above (a prior draft incorrectly implied it was). Two values from
the prior draft (1.71 ms on a `countin-start`/97.3/48k repeat, 0.38 ms on a
`countin-start`/97.3/44.1k repeat) are BELOW the 2 ms gate and are removed from this
enumeration — they were never classification-relevant and shouldn't have been
listed as exceptions. None of the 12 rows above changes any cell's classification
(`classifyCell`'s head-deficit gate checked them and found no covering head-loss
band). Pattern: concentrated on `midtimeline-start` (which already has its own known
defect **[Task 7c: withdrawn — see "Midtimeline first-beat drop"]**) and one `loop-wrap` repeat's full take family, plus one isolated
`countin-start` residual — not spread evenly across scenarios.

### Verdict against the recast criteria (corrected)

> **Superseded in part — see "Task 7c fix round 1: verdict re-derived on the absolute
> grid" at the end of this register.** Every percentage in this section was computed
> against the region-anchored beat grid. The direction of the result and "no cell
> regresses" survive re-derivation; the magnitudes move, the `midtimeline-start`
> missing-beat leg is withdrawn, and two of the twenty cells lose their upstream
> comparison entirely.

**(a) Candidate cells whose root causes the candidate fixes address read `aligned`
under adjusted classification with no missing beats — literally NOT MET, but
substantially different in character from the first (broken-layout) draft's
verdict.** **[Task 7c fix round 1: every percentage in this paragraph is a
region-anchored-grid figure. The `midtimeline-start` "structurally unchanged
`missing=1`" leg is WITHDRAWN outright — that missing beat was the harness fencepost, on
both builds. The corrected figures are in "Task 7c fix round 1: verdict re-derived on
the absolute grid".]** Zero of the 20 cells reach the literal `aligned` status (every median
still exceeds the 2 ms tolerance). However: `nominal-start` and `countin-start` — two
of the three targeted mechanisms — now classify `matches-known-defect` (signature B)
on 5 of their 8 combined bpm/rate cells, with adjusted-bias magnitude reduced 64-89%
versus upstream at every cell (raw/offset-invariant: 47-68%) — this is the first
successful match to a predicted signature among the cells that survived this
campaign's own harness-fix reclassification (the original draft's `janked-start`
`matches-known-defect` calls were themselves withdrawn in fix round 1 of the
upstream campaign, before any candidate build existed — see "Fix round 1" — so this
is not literally the first signature match ever recorded in this register, only the
first that stands on data this campaign now treats as valid). The third
targeted mechanism, `midtimeline-start`'s A-mechanism missing-beat signature, is
**structurally unchanged**: `missing=1` (of 16/17 expected beats) on all 12 candidate
repeats measured (both rates, both bpms) — identical in pattern to all 12 upstream
repeats, though the accompanying bias magnitude is smaller (adjusted: 32-66%
smaller; raw/offset-invariant: 27-59% smaller). The
`Recording.wasStartingAt()` position walk-back this fix introduces specifically for
that mechanism reduces its magnitude but does not eliminate the content-skip itself
in this harness's measurement.

**(b) No cell regresses — MET.** **[Task 7c fix round 1: re-derived on the absolute
grid; "no cell regresses" survives, the 78-86% figure moves. See "Task 7c fix round 1".]** The first draft's "janked-start regresses 2.7-3.4x"
finding is RETRACTED along with the C1 root cause above — it measured the broken
override layout's fallback-only anchor path, not the candidate fix. With the layout
corrected, `janked-start`'s adjusted-bias magnitude is 78-86% SMALLER than upstream
at every bpm/rate (raw: 56-63% smaller) — among the largest improvements of any
scenario, not a regression. Every one of the 20 cells, across both the adjusted and
the raw/offset-invariant comparison, shows a smaller-magnitude bias than its
upstream counterpart; none regresses.

**(c) `loop-wrap` finalization-hang failure rate — FIXED.** 0 of 12 repeat attempts
failed across both rates (48k: 0/6, 44.1k: 0/6) — every single `loop-wrap` repeat
finalized successfully, versus the register's previously measured upstream rate of
18/27 (67%, across 5 separate campaign runs — see "C2") and the first (broken-layout)
candidate draft's 9/12 (75%, itself now understood to be measuring the same broken
anchor path, not the finalization pipeline specifically). The candidate fixes under
test do not directly touch the finalization pipeline's own code path, so this
resolution is not mechanistically explained by this campaign's source-reading — it
is reported as a measured outcome (100% success across all 12 candidate `loop-wrap`
repeat attempts — 3 repeats × 2 bpms × 2 rates, yielding 72 individual take rows —
0 finalization failures in any of them) without a confirmed
causal mechanism, flagged here for anyone porting the fix to note the finalization
behavior changed too, not just the timing-alignment math this campaign set out to
audit.

**(d) Head/tail integrity — see the restated numbers above.** Materially clean
(0/120 tail deficits; 12/120 head-deficit rows, concentrated on `midtimeline-start`
and one `loop-wrap` repeat's full take family), not literally spotless, but no
classification outcome changed as a result.

**Overall: the candidate build passes (b), (c), and (d) of the recast verdict, and
makes substantial, consistent, non-regressing progress on (a) without fully clearing
it.** **[Task 7c fix round 1: this paragraph's percentages — 64-89%, 32-66%/27-59%,
78-86% — are region-anchored-grid figures and are superseded; the `midtimeline-start`
"missing-beat defect persists unchanged" clause is WITHDRAWN. Corrected in "Task 7c fix
round 1: verdict re-derived on the absolute grid".]** `nominal-start`/`countin-start` now match a predicted signature (see the scope
note above on what "first" means here) with 64-89% smaller adjusted bias;
`midtimeline-start`'s magnitude drops 32-66% (adjusted) / 27-59% (raw) but its
missing-beat defect persists unchanged; `janked-start` — the
scenario the first draft reported as badly regressed — instead shows one of the
largest improvements (78-86% smaller) once the build/layout defect was corrected;
`loop-wrap`'s finalization-hang is fully resolved in this data. This verification is
flagged **DONE_WITH_CONCERNS** for a narrower reason than the retracted schema
claim: `loop-wrap`'s finalization fix is an unexplained (not mechanistically traced)
side effect of a build swap whose own code changes don't touch that pipeline, worth
a second look before treating it as confirmed-and-understood rather than
confirmed-and-unexplained; and `midtimeline-start`'s content-skip defect, while
smaller in magnitude, was NOT eliminated by the position walk-back specifically
built to address it, which the team lead or Task 8 may want to weigh against the
overall positive result before deciding on the upstream-PR track. **[Task 7c: this
second concern is withdrawn with the missing-beat leg — there was no content-skip
defect for the walk-back to eliminate, and nothing in it remains for Task 8 to weigh;
see "Task 7c fix round 1: verdict re-derived on the absolute grid".]**

### Lib change accompanying this fix round (I1)

`AuditRow` (`recording-alignment-audit-debug-demo.tsx`) gained `tailMissingMs`,
`stopRequestContextTime`, and `bufferDurationSec` fields, persisted per row from the
values `measureTakeAlignment` already computed but previously discarded after
classification — closing the gap where `tailMissingMs` was only recoverable (when at
all) by parsing `classifyCell`'s English `detail` string, which itself only includes
the full `medians=[…] … tailMissingMs=[…]` suffix outside the "unusable measurement"
early-return path (i.e., never for a repeat with `missingBeats>0` — exactly the
`midtimeline-start` cells this round's restated (d) needed to check). tsc gate clean;
`npx vitest run src/lib/audit/` 52/52 (unaffected — this is a page-only change, no
lib logic touched).

**M3 note:** `classifyCell`'s `detail` string's `medians=[…]` array switched
semantics at the Task 7 boundary — it now lists ADJUSTED medians (the field
`classifyCell` actually verdicts on), not raw ones, for every cell classified from
this fix round onward. Rows/summaries from before this commit still carry raw values
in that position if re-read from old `.verify-output/*.json` files; the persisted
`medianBeatErrorMs`/`medianBeatErrorMsAdjusted` fields on each row remain the
authoritative source for either value at any point in the campaign's history.

### Restore verification

Dev server restarted WITHOUT the override (`rm -rf node_modules/.vite` first), one
upstream smoke cell (`nominal-start`/120/48000, `recaudit-summary-1788297319085.json`):
`sdkBuildProbe: "upstream"`, medians -76.23, -91.56, -89.54 ms — same range as the
original matrix run's own -97.56, -94.88, -74.90 ms for this exact cell, confirming
no cache bleed from the override swap. Repeated AFTER the fix round's rebuild (a
second, independent restore — the fix round's own changes were entirely on the
candidate side of the override and never touched the upstream `node_modules` tree
this check reads from, but re-running it costs little and removes any doubt):
`recaudit-summary-1788300424628.json`, same cell, `sdkBuildProbe: "upstream"`,
medians -86.88, -88.90, -113.56 ms — range extended slightly beyond the first two
runs' (the original matrix's 74.90-97.56 ms and the first restore's 76.23-91.56 ms),
but the -113.56 ms repeat is still within the ordinary repeat-to-repeat scatter this
exact cell showed across the campaign (see "Matrix results — 48000 Hz" and the
first restore above — all three runs sit inside the same rough -74 to -114 ms band,
consistent with `nominal-start`'s own documented B-mechanism scatter, not a sign of
cache bleed). The `SDK_DIST_OVERRIDE`
directory used for this task was a local, gitignored scratch directory, not
committed at any point (verified via `git status` before and after every commit in
this task).

## Multi-mic simultaneous recording (Task 7b)

### Design rationale

Every scenario above is single-tape. Simultaneous multi-capture has a failure mode
single-tape cells cannot see: each armed tape gets its own `RecordingWorklet` and
places its take using that worklet's OWN frame counter plus the position observed
at ITS OWN creation — two tracks recording the SAME instant can still land at
different timeline positions ("inter-track skew"). Measuring this without
introducing new calibration terms requires cancelling every bias the single-tape
sections above had to characterize (loopback-path latency, the harness-path
`outputLatency` term, the metronome content's own timing): two tapes are armed on
two synthetic loopback devices (`loopbackDeviceId(1)`/`(2)`,
`src/lib/audit/loopbackInjection.ts` — `installLoopbackCapture(deviceCount)`), and
`getUserMedia` already hands out `dest.stream.clone()` regardless of which
deviceId is requested, so both tapes capture CLONES of the identical injected
signal. Any difference in where matched beats land between the two tapes' own
`beatErrors` (`measureCrossTrackSkew`, `src/lib/audit/recordingAlignment.ts`) IS
the skew — every shared bias cancels out of the subtraction by construction, no
calibration term needed. Sign convention: `skewMs = tape B's errorMs − tape A's
errorMs` (positive means B lags A).

Two new scenarios mirror the existing `nominal-start`/`janked-start` provocations
with two simultaneously-armed tapes instead of one: `multitrack-start` (idle main
thread) and `multitrack-janked` (the C1-fixed `armJankOnRecordingFlip` busy-loop,
reused unchanged — `engine.isRecording` is engine-wide, so one jank jams both
captures' post-flip handling at once). Cell verdict: `aligned` iff every repeat's
`|medianSkewMs| ≤ ALIGNED_TOLERANCE_MS` (2 ms — the same detector/graph-path noise
floor established in the bring-up calibration, reused rather than introducing a
second named constant) AND both tapes' own per-take alignment independently
classifies as clean (not `investigate`) against the equivalent single-tape
scenario's `SIGNATURE_BANDS` (`multitrack-start` ~ `nominal-start`,
`multitrack-janked` ~ `janked-start`); `investigate` with the skew named in detail
when skew exceeds tolerance but both tapes are otherwise clean — no signature band
predicts inter-track skew (no scenario in this campaign before Task 7b measured
simultaneous capture), so any measured excess is a candidate finding, not a
confirmation of a prediction. **(M3) "Classifies as clean" means the per-take
status is anything other than `investigate` — this INCLUDES `matches-known-defect`,
not only literal `aligned`.** A cell whose tapes both match a KNOWN single-tape
signature (e.g. candidate's B band, per Task 7) but whose skew is within
tolerance would reach the multitrack `aligned` verdict too — this campaign's
own data never exercises that path (every tape-level classification in this
data is `investigate`; see Finding 2's parenthetical), but the code accepts it.

### TDD evidence (lib)

`measureCrossTrackSkew(a, b)` (`src/lib/audit/recordingAlignment.ts`) pairs two
`TakeAlignment`s' `beatErrors` by beat index (a beat present in only one side is
excluded, not treated as an error — genuine content-skip is `missingBeats`'s job)
and reports `perBeatSkewMs`/`medianSkewMs`/`maxAbsSkewMs`/`pairedBeats`. 7 new
cases added test-first to `recordingAlignment.test.ts` (confirmed red —
`measureCrossTrackSkew is not a function` — before implementing): identical
alignments → 0 skew on every beat; a uniform +5ms/−5ms shift on every beat →
matching signed median (proves the sign convention); disjoint matched beat sets →
`pairedBeats=0`, both stats null; partial overlap → only the beats present on
both sides are paired; an even-count paired set → median averages the two middle
values; `perBeatSkewMs` sorted by beat index regardless of input order.
`npx vitest run src/lib/audit/`: 59/59 passing (52 pre-existing + 7 new).
`npx tsc --noEmit`: 0 `src/` errors, both before and after.

### Harness extension

`waitForTakeCount` (`recording-alignment-audit-debug-demo.tsx`) was refactored
from a single-`AudioUnitBoxAdapter` signature to accept a list with a
per-adapter target count (`loop-wrap`'s call site updated to `[unitAdapter]`,
behavior unchanged) — multitrack cells wait for BOTH tapes' take regions to exist
before trusting the recording-duration wait, since skipping that check would race
the very inter-track skew this scenario measures. The finalization barrier waits
for BOTH tapes' loaders (`Promise.all` over two `waitForLoaderTerminal` calls —
two independent `RecordingWorklet`s produce two independent loaders, unlike
`loop-wrap`'s single shared file across takes on ONE tape). Between-cell cleanup
(`resetForNextMultitrackCell`) clears both tapes' take regions and file boxes.
New URL contract: `?scenario=multitrack-start|multitrack-janked|multitrack-all`
(the pre-existing `?scenario=all` keeps its original single-tape-only meaning,
unchanged, for backward compatibility with re-runs of the earlier campaign data).

### Per-cell results

Matrix: 2 scenarios × 2 rates (44100, 48000) × bpm 120 × 3 repeats, on both
builds — **8 official cells total (4 per build), 12 repeat attempts per build
(24 across both builds)**. Run ids below are
`.verify-output/recaudit-mt-summary-<id>.json`; `medianAdj` is
`medianBeatErrorMsAdjusted` (raw + `harnessPathBiasSec·1000`, same field the
single-tape sections use). Every repeat's `tapeA`/`tapeB` medians below are
identical to 2 decimal places or noted where they diverge.

**Every one of the 8 official cells classified `investigate` on both builds — 0
cells reached `aligned`.** For 7 of the 8 cells this is directly persisted on
every row (`classifyMultitrackCell`'s verdict, applied uniformly across that
cell's rows in `runMultitrackAudit`). The 8th — candidate 44100 Hz
`multitrack-janked`, table below — had ZERO successful repeats (all 3 errored
on the `AudioFileBox` collision), so `classifyMultitrackCell` never ran its
skew-comparison branch for that cell; its rows all carry `status: "error"`
directly from the per-repeat error path, and the `investigate` verdict shown
for it in this register's prose is an EXPLICIT INFERENCE (from
`classifyMultitrackCell`'s own "no successful repeats to measure skew" branch,
which does return `investigate` for zero repeats — verified by reading the
function — but that return value was never attached to any row or persisted
JSON field for this cell). No cell's failure is attributable to a single
cause: some cells lost repeats entirely to a reproducible finalization hang
(below); among the repeats that DID succeed, every measured skew exceeded the
2 ms tolerance except three exact-0.00 ms cases (Finding 2 has the corrected count
and per-repeat identification), and even those three didn't clear the "both
tapes individually clean" half of the `aligned` test (see Finding 2 below).

#### Upstream — 48000 Hz (`recaudit-mt-summary-1788302627819.json`)

| scenario | repeat | tapeA medianAdj (ms) | tapeB medianAdj (ms) | medianSkewMs | maxAbsSkewMs | pairedBeats | outcome |
|---|---|---|---|---|---|---|---|
| multitrack-start | r1 | — | — | — | — | — | error: finalization tapeB timed out after 30s |
| multitrack-start | r2 | -76.56 | -76.56 | -0.00 | 2.81 | 17 | investigate |
| multitrack-start | r3 | -77.21 | -79.87 | -2.67 | 2.67 | 17 | investigate |
| multitrack-janked | r1 | — | — | — | — | — | error: finalization tapeB timed out after 30s |
| multitrack-janked | r2 | -68.56 | -65.90 | 2.67 | 2.67 | 17 | investigate |
| multitrack-janked | r3 | -73.21 | -70.54 | 2.67 | 2.67 | 16 | investigate |

#### Upstream — 44100 Hz (`recaudit-mt-summary-1788302870379.json`)

| scenario | repeat | tapeA medianAdj (ms) | tapeB medianAdj (ms) | medianSkewMs | maxAbsSkewMs | pairedBeats | outcome |
|---|---|---|---|---|---|---|---|
| multitrack-start | r1 | -43.36 | -46.26 | -2.90 | 2.90 | 17 | investigate |
| multitrack-start | r2 | — | — | — | — | — | error: finalization tapeB timed out after 30s |
| multitrack-start | r3 | — | — | — | — | — | error: finalization tapeB timed out after 30s |
| multitrack-janked | r1 | — | — | — | — | — | error: finalization tapeB timed out after 30s |
| multitrack-janked | r2 | -65.74 | -62.83 | 2.90 | 2.90 | 16 | investigate |
| multitrack-janked | r3 | — | — | — | — | — | error: finalization tapeB timed out after 30s |

#### Candidate — 48000 Hz (`recaudit-mt-summary-1788303391228.json`)

| scenario | repeat | tapeA medianAdj (ms) | tapeB medianAdj (ms) | medianSkewMs | maxAbsSkewMs | pairedBeats | outcome |
|---|---|---|---|---|---|---|---|
| multitrack-start | r1 | -18.56 | -18.56 | 0.00 | 2.67 | 17 | investigate |
| multitrack-start | r2 | — | — | — | — | — | error: finalization tapeA timed out after 30s |
| multitrack-start | r3 | -18.56 | -21.23 | -2.67 | 2.67 | 17 | investigate |
| multitrack-janked | r1 | -18.54 | -18.54 | 0.00 | 2.65 | 17 | investigate |
| multitrack-janked | r2 | -9.23 | -11.90 | -2.67 | 2.67 | 17 | investigate |
| multitrack-janked | r3 | -18.56 | -21.23 | -2.67 | 2.67 | 17 | investigate |

#### Candidate — 44100 Hz (`recaudit-mt-summary-1788303605274.json`)

| scenario | repeat | tapeA medianAdj (ms) | tapeB medianAdj (ms) | medianSkewMs | maxAbsSkewMs | pairedBeats | outcome |
|---|---|---|---|---|---|---|---|
| multitrack-start | r1 | -8.55 | -5.65 | 2.90 | 2.90 | 17 | investigate |
| multitrack-start | r2 | -15.12 | -25.12 | -10.00 | 10.00 | 16 | investigate |
| multitrack-start | r3 | -10.14 | -13.04 | -2.90 | 2.90 | 17 | investigate |
| multitrack-janked | r1 | — | — | — | — | — | error: finalization tapeA timed out after 30s |
| multitrack-janked | r2 | — | — | — | — | — | error: finalization tapeA timed out after 30s |
| multitrack-janked | r3 | — | — | — | — | — | error: finalization tapeA timed out after 30s |

### Finding 1: `AudioFileBox already staged` — a deterministic content-address collision when two simultaneous takes capture byte-identical audio

**Fix round 1 correction:** the first draft of this finding called this a
"staging race." It is not a race — it is deterministic, and the fix round's own
confirmation cell (below) proves it directly.

Ten repeat attempts (6 of 12 on upstream — 2 at 48000 Hz, 4 at 44100 Hz; 4 of 12
on candidate — 1 at 48000 Hz, 3 at 44100 Hz — **10 of 24 official-matrix repeat
attempts across both builds, 42%**) carry the identical `errorMessage`,
`"finalizing: finalization tape<A|B> timed out after 30s"`, and every one is
preceded by an identical browser-console panic (not previously seen anywhere in
the single-tape campaign):

```
Error: AudioFileBox <uuid> already staged
    at panic (…chunk-2OPVDVO5.js:50:37)
    at BoxGraph.stageBox (…chunk-AJMB7Q33.js:2121:14)
    at _AudioFileBox.create (…chunk-WAWGXPCR.js:3594:18)
    …
    at recordingWorklet.onSaved (…chunk-FW347FDO.js:3963:15)
```

**Mechanism (read from source — `SampleService.importFile`,
`packages/studio/core/src/samples/SampleService.ts` line 43 in the pinned
upstream SDK source checkout, verified identical in the candidate repo):**

```typescript
async importFile({uuid, name, bpm, arrayBuffer, …}: AssetService.ImportArgs, …) {
    uuid ??= await UUID.sha256(arrayBuffer)
    …
```

`RecordingWorklet.#finalize` calls `SampleService.importRecording`, which calls
`importFile({name, bpm, arrayBuffer, origin: "recording"})` — **no `uuid` is ever
passed for a recording import**, so `importFile` ALWAYS derives the
`AudioFileBox`'s uuid as `SHA-256(arrayBuffer)`, the WAV-encoded capture bytes
themselves. This is content-addressing: two DIFFERENT recordings normally produce
two different hashes. But this campaign's whole measurement design (see "Design
rationale" above) deliberately feeds both tapes CLONES of the identical injected
loopback signal — the two tapes are only prevented from capturing byte-identical
WAVs by ordinary, small, independent timing differences between their two
`RecordingWorklet`s' capture windows (length/start-offset jitter — the very
inter-track skew Finding 2 measures). When those differences happen to be zero —
both worklets capture the exact same frame count from the exact same starting
sample — the two tapes' `arrayBuffer`s ARE byte-identical, so `UUID.sha256`
produces the SAME uuid for both, and the second tape's `BoxGraph.stageBox` call
panics on a uuid already staged by the first. The affected tape's `AudioFileBox`
never reaches a usable state, its `SampleLoader` never emits a terminal state,
and the harness's finalization barrier (`waitForLoaderTerminal`, `Promise.all`
over both tapes) correctly times out at 30s rather than hanging forever — the
harness is behaving as designed against a genuine SDK-side stall, not a harness
bug.

**Evidence for the content-collision mechanism, not a race:**
1. **All 10 surviving tape-A/B WAV pairs on disk differ** (`shasum`, re-verified
   directly for this fix round — every pair distinct). This is exactly what
   content-addressing predicts: a pair that finalizes successfully is, by
   construction, a pair whose captured bytes were NOT identical (if they had
   been, the second one would have collided and never finalized at all). A
   genuine race would predict no such correlation between "finalized
   successfully" and "differs from its sibling."
2. **Dedicated confirmation cell** (this fix round): arm BOTH tapes on the SAME
   loopback deviceId (`?scenario=multitrack-start&confirmCollision=1` —
   `createMultitrackTapes`'s new `sameDeviceB` parameter), removing the small
   independent-worklet timing jitter that normally keeps the two captures'
   byte lengths apart. Prediction: every repeat collides. Result: 3 of 3 did
   (`recaudit-mt-summary-1788304987514.json`, upstream, 48000 Hz,
   `confirmCollision: true` persisted in the JSON) — every repeat's `tapeB`
   timed out with the identical `"finalization tapeB timed out after 30s"`
   error. This is the sharp, deterministic repro an upstream issue needs: **two
   simultaneous takes of identical audio always collide.**

The failure's specific manifestation still varies repeat-to-repeat in the
OFFICIAL matrix (different uuids, tapeA timed out in one candidate 48000 Hz
repeat vs. tapeB in every other official-matrix repeat) — that variation is
expected and fully explained by which of the two captures happens to differ in
length by even one sample, not by any non-determinism in the collision itself
once two captures ARE byte-identical.

**On the 6/12-vs-4/12 build comparison:** the first draft framed this as
"candidate's failure rate was numerically lower." That framing is now dropped —
**this metric does not measure the SDK build under either scenario.** It measures
how often two independent `RecordingWorklet`s, both fed clones of one loopback
signal, happen to capture the exact same number of samples starting at the exact
same offset — a property of THIS harness's timing/scheduling and each rate's
render-quantum granularity, not of `AudioFileBox`'s collision behavior (which the
confirmation cell shows is unconditional once bytes match) and not attributable
to either SDK build's own code. No build-comparison claim is made from these
counts; they are reported only as "how often the official matrix's two-distinct-
device wiring happened to produce colliding content in this session."

This is a **candidate new upstream finding**: `AudioFileBox`'s content-addressed
uuid (`SHA-256` of the encoded WAV, with no disambiguation for "these are two
DIFFERENT recordings that happen to contain identical audio") has no collision
handling in `BoxGraph.stageBox` — it panics instead of, e.g., reusing the
existing box or appending a disambiguator. Recommend a dedicated upstream issue
(repro: `?scenario=multitrack-start&bpm=120&rate=<44100|48000>&confirmCollision=1`,
which reproduces on every repeat, not intermittently).

### Finding 2: inter-track skew is quantized to roughly one render quantum, exceeds the 2 ms tolerance on nearly every successful repeat, and is unchanged by the candidate fix

**Fix round 1 correction:** the first draft undercounted — it examined only the
official-matrix cells' own per-cell tables and missed some of its own
`cellSkews` entries. Recomputed directly from every `cellSkews` entry across
the 4 OFFICIAL-MATRIX runs (matching the per-cell tables above): **14
measurable `medianSkewMs` values total**, not 9.

**Fix round 2 correction:** the fix-round-1 text above was itself
self-contradictory — it claimed this population spanned "all 5 runs" made this
task (the 4 official-matrix runs plus the restore-verification smoke), then
folded the smoke's `r1` (`+5.33 ms`) into the "10 near-quantum" bucket while
never counting the smoke's `r3` at all — despite the Restore Verification
section (below) correctly identifying `r1` as `≈2×` the quantum, not `≈1×`.
The population is, and always was, the **4 official-matrix runs only** — the
14/3/10/1 figures below were computed correctly from those 4 runs even in the
first draft; only the prose mis-described where they came from.

The skew clusters tightly around **exact multiples of one WASM render quantum**
(128 samples): `128/48000 = 2.667 ms` and `128/44100 = 2.902 ms`. Of the 14
official-matrix values: **3 are exact `0.00 ms`** (upstream 48000 Hz
`multitrack-start`/`r2`, candidate 48000 Hz `multitrack-start`/`r1`, candidate
48000 Hz `multitrack-janked`/`r1`), **10 are within 0.02 ms of `±1×`
render-quantum**, and **1 is a distinct outlier**: candidate 44100 Hz
`multitrack-start`/`r2`, `-10.00 ms`.

The restore-verification smoke's two successful repeats corroborate the
quantization independently (`r3` at `-2.67 ms` ≈ `-1×`, `r1` at `+5.33 ms` ≈
`+2×` the 48000 Hz quantum) and are excluded from the official tally above —
see the corrected restore-verification paragraph below for that run's own
numbers.

**The outlier is not scatter — it is a second, equally deterministic value.**
The first draft called this repeat's mismatch "one beat's onset match differed…
not just its timing," implying detector noise. Re-examined directly from the
persisted `perBeatSkewMs` array: the skew is `-10.000001450244…ms` on **every
one of its 16 paired beats**, agreeing to 6 decimal places — this is exactly as
rock-steady as the render-quantum cases, just at a DIFFERENT constant. `10.00 ms`
at 44100 Hz is exactly 441 samples (`44100 × 0.01`) — a clean decimal fraction of
the sample rate, and NOT an integer multiple of the 128-sample render quantum
(`441 / 128 ≈ 3.45`). This repeat's `pairedBeats` is 16, one fewer than the usual
17 — but a lower `pairedBeats` count does not, on its own, mean the outlier: a
SEPARATE repeat (upstream 48000 Hz `multitrack-janked`/`r3`) also measured
`pairedBeats=16` while its skew was an entirely ordinary `+2.67 ms` (exactly
`+1×` render-quantum) — the two `pairedBeats=16` repeats are unrelated instances,
not two data points for the same phenomenon. This 441-sample value is a distinct,
reproducible (within this one repeat, across all its beats) signature separate
from the render-quantum clustering, worth naming as its own candidate mechanism
rather than folded into "scatter."

This magnitude is well outside `ALIGNED_TOLERANCE_MS` (2 ms) on **11 of the 14**
measured repeats — only the 3 exact `0.00 ms` repeats clear the skew half of the
`aligned` test, and even they don't reach `aligned` overall because the
underlying per-take bias on their cells fails the *other* half of the test in
one of two ways: the two candidate-48000 Hz `0.00 ms` repeats' cells have
`spread=0.00 ms` across their own repeats, and `SIGNATURE_BANDS`' `B`
(random-band) requires `spread > 2·ALIGNED_TOLERANCE_MS` to match — a signature
calibrated to detect a NOISY defect, which a spread of exactly 0.00 ms
structurally cannot satisfy (see "Harness gaps" below); the upstream-48000 Hz
`0.00 ms` repeat's cell fails simply because its own median (≈-76.6 ms) is
nowhere near any band. (Whether the "clean" half of the `aligned` test — "both
tapes individually classify clean" — accepts `matches-known-defect`, not only
literal `aligned`, is addressed under M3 in "Design rationale" above; it does,
but no cell in this data reaches that branch regardless, since none of the 3
zero-skew repeats' own tapes classify as anything but `investigate`.)

**The candidate build does not reduce inter-track skew.** Both builds show the
same render-quantum-granular magnitude at the same two rates
(`2.667/2.902 ms` ≈ one quantum). This is consistent with the mechanism being
independent of the placement-math fix under test: each tape's take is anchored
by ITS OWN `RecordingWorklet`'s position-tick callback, and two independently-
scheduled AudioWorklet callbacks landing on different render quanta — even when
each one's OWN placement math is otherwise accurate — will disagree by whatever
quantum-boundary difference separates their two callback invocations. Candidate's
fix corrects each tape's placement relative to ITS OWN clock; it does not, and
by its own scope was never intended to, synchronize two tapes' independent
clocks to each other.

### Cross-build comparison

| | upstream | candidate |
|---|---|---|
| Cells reaching `aligned` | 0/4 | 0/4 |
| Repeat attempts lost to the `AudioFileBox` panic | 6/12 (50%) | 4/12 (33%) |
| Successful-repeat skew range | 0.00 – 2.90 ms (both rates) | 0.00 – 10.00 ms (44100 Hz outlier) |
| Underlying per-take bias (medianAdj) | -43 to -80 ms | -5.65 to -25.12 ms |

The "Repeat attempts lost to the `AudioFileBox` panic" row is included for
completeness but is **not a build comparison** — see Finding 1's correction
above: this count measures how often two independently-timed captures of one
shared loopback signal happened to land on byte-identical content in THIS
session, not a property of either SDK build.

The per-take bias reduction (candidate roughly 3-5× smaller in magnitude) matches
the single-tape Task 7 finding exactly, measured independently on a different
harness code path (two simultaneous tapes rather than one) — this is corroborating
evidence for that earlier result, not a new claim. The skew and finalization-hang
findings are ORTHOGONAL to that fix and remain open on both builds.

### Restore verification

After both builds' matrices, the dev server was restarted without
`SDK_DIST_OVERRIDE` (`rm -rf node_modules/.vite` first, and the scratch
`vite.candidate.config.ts` wrapper — see "Harness gaps" below — deleted), and one
upstream smoke cell run: `?scenario=multitrack-start&bpm=120&rate=48000`,
`recaudit-mt-summary-1788303708270.json`, `sdkBuildProbe: "upstream"`.

**Fix round 1 correction:** the first draft conflated `r1`'s and `r3`'s medians
into one figure and omitted `r3` (a genuine successful repeat) entirely. Correct
result, all 3 repeats: `r1` medians -66.54/-61.21 ms adjusted (tapeA/tapeB),
skew +5.33 ms (17 paired beats, ≈2× render-quanta, per Finding 2); `r2` errored
with the same `AudioFileBox` panic signature (`finalization tapeA timed out
after 30s`); `r3` medians -85.21/-87.87 ms adjusted, skew -2.67 ms (15 paired
beats, ≈1× render-quantum). All three repeats' medians sit inside the -43 to -80
ms range the official 48000 Hz matrix run above established for this exact cell
(`recaudit-mt-summary-1788302627819.json`'s `multitrack-start` rows) — `r3`'s
-85 to -88 ms is a few ms beyond that range's upper end, within the ordinary
repeat-to-repeat scatter this bias has shown throughout the wider single-tape
campaign, not a sign of cache bleed. No cache bleed from the override swap.
`git status` clean before and after — no `SDK_DIST_OVERRIDE` scratch files, the
temporary `vite.candidate.config.ts` wrapper, or the `yjs` dev-dependency
install (`npm install yjs --no-save`, never touched
`package.json`/`package-lock.json`) left any trace in the tracked tree.

**Fix round 1 addition (M7):** a second, single-tape sanity cell was also run
post-restore — `?scenario=nominal-start&bpm=120&rate=48000` on the STANDARD
`ScenarioRunnerHarness` (not the multitrack page) —
`recaudit-summary-1788305205480.json`, `sdkBuildProbe: "upstream"`. All 3
repeats completed normally (medians -92.23/-104.23/-93.54 ms, matched
16-17/17 beats, 0 errors), inside this exact cell's own previously-documented
-64.90 to -108.20 ms range (see "Matrix results — 48000 Hz" earlier in this
register). This confirms `installLoopbackCapture(2)` — advertising a second
synthetic loopback device for the multitrack page, added this fix round's
predecessor commit — does not disturb the pre-existing single-tape harness the
rest of this campaign's register depends on.

### Harness gaps / build-environment notes (not SDK defects)

- **Candidate build/layout needed two additions beyond Task 7's documented
  recipe**, both purely local dev-server plumbing, neither touching the
  candidate repo or opendaw-test's own source:
  1. **Fix round 1 correction:** the first draft framed this as a
     candidate-specific dependency; it is not — `yjs`/`y-websocket`/`zod`/
     `dropbox` are declared dependencies of `@opendaw/studio-core` ITSELF
     (verified in the package's own `package.json`, both builds), and its
     `index.js` re-exports the Yjs collaboration module
     (`export * from "./ysync"`) in the UPSTREAM package too — confirmed by
     reading upstream's own installed `node_modules/@opendaw/studio-core/`.
     A normal `npm install`/`npm ci` against the real, registry-resolved
     `@opendaw/studio-core` pulls these in automatically as transitive
     dependencies, which is why the single-tape harness never needed this
     fix. The actual, build-independent cause: `SDK_DIST_OVERRIDE` aliases
     `@opendaw/<pkg>` to a directory OUTSIDE `opendaw-test`'s own tree, so
     whichever package is aliased there loses npm's normal transitive-install
     mechanism, and upward Node module resolution from a file under
     `.claude/jobs/<job>/tmp/sdk-dist-override/@opendaw/studio-core/dist/…`
     never reaches `opendaw-test/node_modules` either. Fixed by installing
     the missing packages locally (`npm install yjs --no-save` — deliberately
     `--no-save` so `package.json`/`package-lock.json` stay untouched; the
     other five — `y-websocket`, `zod`, `dropbox`, `jszip`, `soundfont2` —
     were already present as transitive deps of something else in this
     project) and symlinking each into a `node_modules/` directory created
     INSIDE the override root itself, which IS on the upward-resolution path
     for every package the override aliases.
  2. This pinned candidate commit (see `.claude/local.md` "Task 7
     build/layout" for the exact SHA — not repeated here per this register's
     convention) predates several newer demos this repo has since grown —
     `modulation`, `Convolver`,
     `Cubed` — whose entry files import box/adapter symbols
     (`LfoModulatorBox(Adapter)`, `StepsModulatorBox(Adapter)`,
     `RandomModulatorBox(Adapter)`, `MacroModulatorBox(Adapter)`,
     `CubedDeviceBox(Adapter)`, `CubedPatternData`, `CubedRandomize`,
     `CubedStep`, `AblPattern`, `ConvolverDeviceBoxAdapter`) that genuinely
     don't exist in this candidate commit's `studio-boxes`/`studio-adapters`.
     Vite's dev-mode dependency scanner crawls every `*.html` entry point at
     repo root by default (this project has one per demo), so a missing
     export in ANY unrelated demo crashed dev-server startup entirely, not
     just that demo's own page. Worked around two ways, both temporary and
     never committed: (a) appended a small number of no-op stub class exports
     for the modulation symbols directly to the override's own
     `studio-boxes`/`studio-adapters` `dist/index.js` files (these are
     already-built JS artifacts inside the gitignored override tree, not
     repo source); (b) a scratch `vite.candidate.config.ts` at repo root
     (deleted before finishing, confirmed via `git status`) that wraps the
     real `vite.config.ts` with `mergeConfig` and restricts
     `optimizeDeps.entries` to just this task's own harness HTML, so the
     Convolver/Cubed gap (not worth stub-patching — deeper, un-stubbed
     adapter surface) never gets scanned at all. Neither workaround touched
     opendaw-test's committed source or the candidate repo's own commits;
     both are recorded here (rather than left as an unreferenced local
     artifact) per this register's evidence convention, and reused directly
     from `.claude/local.md`'s existing "gitignored, local-only" convention
     for `SDK_DIST_OVERRIDE` itself.
- **(M6) WAV filenames did not include a build/run disambiguator when this
  fix round began**, and this session re-ran the SAME scenario/bpm/rate/repeat
  combination four times (upstream, candidate, the restore-verification
  smoke, and the confirmation cell) — several of those runs' successful
  repeats share the identical cell coordinates (e.g. `multitrack-start`/120/
  48000/`r1` succeeded on BOTH the candidate matrix run and the restore
  smoke), so later runs silently overwrote earlier runs' saved audio under
  the same `.wav` name. **The persisted `recaudit-mt-summary-<id>.json` files
  (one per run, never overwritten) are authoritative for every number in this
  register — the WAV files on disk reflect only whichever run wrote to a
  given name LAST**, not necessarily the run a given table row's evidence
  came from. Fixed going forward: `uploadMultitrackRepeatWav` now appends
  `sdkBuildProbe` and a per-run `runToken` (shared with that run's own
  summary JSON filename) to every WAV name, so future re-runs of this
  harness won't collide and every surviving WAV is traceable to the exact
  summary that produced it.
- The `B` (random-band) signature's `spread > 2·ALIGNED_TOLERANCE_MS` gate,
  useful for distinguishing a genuine scattered defect from onset-detection
  noise everywhere else in this campaign, has a blind spot when a build's
  placement becomes MORE consistent than the 2 ms floor: a `spread=0.00 ms`
  repeat set structurally cannot match `B` regardless of how far its mean sits
  from the `aligned` tolerance (see Finding 2). Not fixed this task — noted as
  a candidate follow-up if a future campaign needs to classify a
  low-jitter/high-offset cell precisely rather than folding it into
  `investigate`.
- **(I6, superseded by fix round 1)** The first draft of this bullet said the
  `AudioFileBox already staged` panic was root-caused only as far as the
  console stack trace goes. That is now superseded: Finding 1's fix-round
  correction traces the mechanism to source (`SampleService.importFile`'s
  `uuid ??= await UUID.sha256(arrayBuffer)`) and confirms it directly with a
  dedicated same-device confirmation cell (3/3 collisions). What remains
  unverified is narrower — the harness's `project`/`audioContext` are local
  closures inside `runMultitrackAudit`, not React `useState`, so the
  React-fiber live-inspection technique documented elsewhere in this register
  still doesn't apply here, and no live in-flight inspection of
  `BoxGraph.stageBox`'s internal state was performed (the mechanism is
  established from source + the confirmation cell's black-box behavior, not
  from single-stepping the actual collision).
- **(I6) Does this collision explain the `loop-wrap` finalization hang (C2),
  which shows the same "fast success or 30s-never" symptom on the SINGLE-tape
  harness?** No — read from source
  (`packages/studio/core/src/RecordingWorklet.ts`): `RecordingWorklet` calls
  `SampleService.importRecording` exactly ONCE per worklet instance, when the
  worklet itself finalizes at `stopRecording()` time. A `loop-wrap` recording
  session has exactly ONE `RecordingWorklet` (one armed capture) producing
  exactly ONE `importRecording` call for the ENTIRE multi-wrap sequence — all
  of `loop-wrap`'s takes share one `AudioFileBox` precisely because there is
  only ever one uuid derivation per session (matches this register's own
  earlier "Loop Take Buffer Layout" description and the repo's
  `src/demos/recording/CLAUDE.md`). There is structurally no SECOND,
  concurrent `importFile` call within a single-tape session to collide with —
  this mechanism requires TWO independently-finalizing `RecordingWorklet`s
  (two ARMED captures), which only the multitrack scenarios create. `C2`'s
  hang is a different, still-uncharacterized defect; this finding does not
  reopen or reclassify it.

### Candidate new upstream findings, summarized (Task 7b)

1. **`AudioFileBox`'s content-addressed uuid (`SHA-256` of the WAV-encoded
   capture) collides — deterministically, not intermittently — whenever two
   simultaneous `RecordingWorklet`s finalize byte-identical audio**, panicking
   `BoxGraph.stageBox` and hanging the affected tape's finalization. Measured
   10/24 (42%) official-matrix repeat attempts across both builds where the
   official matrix's two-distinct-device wiring happened to produce colliding
   content; a dedicated same-device confirmation cell (both tapes on the
   IDENTICAL loopback device, removing the incidental timing jitter that
   normally keeps captures apart) reproduced the collision on 3/3 repeats.
   Root cause fully traced to `SampleService.importFile`'s uuid derivation;
   `AudioFileBox`/`BoxGraph.stageBox` has no collision handling. See Finding 1.
2. **Inter-track placement skew, render-quantum-granular, unaffected by the
   candidate timing-alignment fix** — 11 of 14 measured repeats' skew exceeds
   the 2 ms tolerance, clustering at integer multiples of one WASM render
   quantum (2.667 ms @48000 Hz, 2.902 ms @44100 Hz) with one distinct,
   equally deterministic outlier (441 samples / 10.00 ms @44100 Hz, constant
   across all 16 of its own paired beats), present identically on both
   builds. See Finding 2.

Both are candidates for upstream issue drafts under `debug/drafts/` (Task 8),
per the repo's issue-filing convention.

## Midtimeline first-beat drop — root cause and candidate fix (Task 7c)

`midtimeline-start` reported `missingBeats = 1` on 12/12 matrix repeats on
BOTH builds — the only scenario to do so unconditionally, and the campaign's
last unexplained head-loss signature. This section establishes what produced
it. **The verdict is that the missing beat was a phantom grid point manufactured by this
harness's own expected-beat generator, not dropped content.** Scope, stated once here and
honoured throughout the section: that verdict rests on the 24 `midtimeline-start` take
rows whose capture audio survives, which show 16 clicks in every buffer, no click before
the region start, and `missingBeats = 0` on 24 of 24 under the absolute grid. The
original matrix repeats — the 12 per build that reported the missing beat — had their
buffers overwritten before this task began, so they are explained by the mechanism
rather than re-measured. No SDK change is warranted or made;
the fix is in `src/lib/audit/recordingAlignment.ts`.

Three mechanisms were discriminated against the persisted evidence
(`.verify-output/recaudit-*.wav` decoded offline, band-split and
onset-detected with this repo's own `bandSplit`/`detectOnsets`, then
re-matched — scripts under
`.superpowers/sdd/2026-09-01-recording-start-alignment-audit/scripts/`; the
original three scripts joined a summary row to a capture WAV by filename alone and were
deleted in fix round 1, replaced by provenance-checked ones that verify the WAV belongs
to the row before using it — see that directory's `README-task7c.md`):

| # | Mechanism | Predicted signature | Measured | Verdict |
|---|-----------|--------------------|----------|---------|
| a | Content never captured — the punch-in beat's click is clipped or absent because the capture path connects inside `startRecording`'s async chain | a GAP in the raw buffer's click train (one interval ≈ 2× the beat period), and/or head lag well above the nominal baseline | click train uniform end-to-end on **24 midtimeline repeats** (population named below): 16 clicks in every buffer, consecutive gaps **499.9–510.0 ms against a 500.0 ms beat** @120 and **616.6–626.6 vs 616.65** @97.3. The two gaps above nominal are single clicks arriving ~10 ms late and staying late (`…1788307078098`/120/r3 at 510.0 ms, `…1788310817094`/97.3/r2 at 626.6 ms) — a step in the content, not an absence. A dropped click would read ≈1000 / 1233 ms; none does. `headMissingRawMs` on those 24 repeats is **12.21–38.37 ms**; across all 48 persisted `midtimeline-start` rows it is **12.21–49.04 ms**, median **20.42 ms** — statistically indistinguishable from every other scenario's (`nominal-start` median 19.02, `janked-start` 19.69, `loop-wrap` 17.37, `countin-start` 21.71 ms, recounted over all 351 rows carrying the field), and two orders of magnitude short of the ~500 ms a lost beat would require | **REFUTED** |
| b | Presented range starts after beat 0 — the content is in the buffer but region position / `waveformOffset` math skips it | a click sitting at a buffer time BEFORE `waveformOffsetSec` | clicks earlier than `waveformOffsetSec`: **0 on 24/24** midtimeline repeats, against **87 of 92** take-0 rows in the other four scenarios (the 5 exceptions are enumerated under "The confirmed mechanism" below, and every one of them shows the same fencepost) | **REFUTED** |
| c | Harness artifact — `measureTakeAlignment` expects a beat at exactly the region boundary | the unmatched beat is always index 0, and re-matching on the true musical grid clears it | unmatched beat index = **[0] on 24/24**; absolute-grid re-match gives **0 missing on 24/24** | **CONFIRMED** |

**Population note (Task 7c fix round 1, review finding 4; restated in fix round 2).** An
earlier version of this table claimed the buffer-level results held "on 24/24 candidate
+ 12/12 upstream repeats". That population never existed on disk. Capture WAV names
carried no run token until fix round 1, so every run overwrote the previous run's
capture of the same cell, and the upstream matrix runs' buffers had been overwritten
hours before the analysis. The figures above are recomputed over the **24
`midtimeline-start` take rows whose geometry and audio provably belong together**, which
are all four runs that still hold their own captures: `recaudit-summary-1788306957902.json`
(48000 Hz), `…1788307078098.json` (44100 Hz), `…1788310164556.json` (48000 Hz) and
`…1788310817094.json` (44100 Hz), 6 rows each. Each row is joined to its audio by frame
count against its own `bufferDurationSec`, by sample rate, and by write window against
the run's own token — never by filename. The harness now stamps the build probe and the
run token into every capture name so this cannot recur.

### The confirmed mechanism

`measureTakeAlignment` built its expected-beat grid as
`regionStartSec + k·beatPeriod`, i.e. anchored at the region start. That
silently assumes every take begins on a beat.

**It is not only `midtimeline-start` that breaks that assumption (Task 7c fix round 1,
review finding 1).** An earlier version of this section claimed
`regionStart mod beatPeriod` was "exactly 0.0 ms" for the four other scenarios on every
repeat. That is false.

Population: every row carrying per-row geometry across **all 40 summary runs on disk
through `1788310817094`**, this fix round's newest. Reproduce with

```
RECAUDIT_MAX_RUN=1788310817094 node \
  .superpowers/sdd/2026-09-01-recording-start-alignment-audit/scripts/task7c-fix1-analysis.ts census
```

| scenario | rows with geometry | off-grid (φ > 1 µs) | max φ |
|---|---|---|---|
| `nominal-start` | 51 | 24 | 47.92 ms |
| `janked-start` | 69 | 42 | 406.25 ms |
| `countin-start` | 39 | 15 | 34.69 ms |
| `loop-wrap` | 144 | 16 | 37.26 ms |
| `midtimeline-start` | 48 | 48 | 154.17 ms |
| **total** | **351** | **145** | — |

**97 of the 303 non-midtimeline rows are off-grid**, so the grid change is NOT a
measurement no-op for them: each of those rows' median moves by exactly +φ. The claim
that does survive, and that holds exactly in IEEE-754 rather than merely empirically,
is the narrower one: *the two grids are point-for-point identical for a region whose
start is exactly on a beat.*

Split by build, the off-grid population is itself a finding. Non-midtimeline rows:
**upstream 90 of 135 off-grid (max φ 406.25 ms); candidate 7 of 168 (max 35.33 ms, and
all 7 are `loop-wrap`'s wrap-finalized take 5)** — i.e. the candidate build places
non-punch-in takes ON the beat and upstream does not, a difference the region-anchored
grid subtracted away by construction.

The take-0 `regionPositionPpqn` distribution over the same bounded snapshot, populations
named (reproduce with `task7c-fix1-analysis.ts ppqn`):

| population | rows | range | zeros | above 92 PPQN |
|---|---|---|---|---|
| candidate, non-midtimeline | 93 | 0 only | **93** | 0 |
| upstream, non-midtimeline | 90 | 0–11340 | **9** | 2 |
| candidate, midtimeline | 24 | 7702–7835 | 0 | 24 |
| upstream, midtimeline | 24 | 7794–7976 | 0 | 24 |

Every candidate non-midtimeline take-0 region lands exactly on PPQN 0; on upstream only
9 of 90 do, and all 9 are `loop-wrap` take 0, whose position is the loop start rather
than a placement decision. The other 81 upstream rows run **4–92 PPQN** (the low end is
`…1788310817094` `nominal-start`/97.3/44100 r3 at 4) plus **two** outliers far above
that: 9313 (`…1788290585653` `janked-start`/120/48000 r1, `matched = 1`) and 11340
(`…1788295321703` `janked-start`/120/48000 r1, `matched = 5`), both degenerate rows. The
midtimeline rows are off-grid by design on both builds and are excluded from the
comparison. (An earlier version of this sentence gave "0 on all 93 candidate rows and
5–92 PPQN on the upstream rows, with one 11340 outlier" — the population was unnamed, the
low end was 4 not 5, it implied no upstream zeros, and it missed the 9313 outlier.)

What is special about `midtimeline-start` is not that its region is off-grid but that
**no captured click can reach the old grid's point 0.** Clicks sound on the absolute
beat grid, so the nearest one to a region start at `m·P + φ` is at most `min(φ, P−φ)`
away — always within the half-beat tolerance, *if it was captured*. So the fencepost
fires on exactly the takes where NO click was captured before the region start, and the
question is per-take, not per-scenario.

Measured over every replayable take-0 row in the snapshot named under "What could and
could not be replayed offline" below: **`midtimeline-start` 0 of 24 takes have a click
before the region start; the other four scenarios have one on 87 of 92** —
`countin-start` 24/24, `loop-wrap` 14/14, `nominal-start` 23/24, `janked-start` 26/30.
Reproduce this paragraph and the table under it with

```
RECAUDIT_MAX_RUN=1788310817094 node \
  .superpowers/sdd/2026-09-01-recording-start-alignment-audit/scripts/task7c-fix1-analysis.ts fencepost
```

The five exceptions are not noise, and they are the point. **Across the whole snapshot
the two properties coincide exactly: 29 rows show the old grid's fencepost
(`missing = 1`, unmatched `[0]`) — the 24 `midtimeline-start` takes plus these 5 — and
they are precisely the 29 rows with no click captured before the region start. No
row has one property without the other, in either direction.**

| run | build | cell | φ (ms) | clicks | first click | OLD grid | NEW grid |
|---|---|---|---|---|---|---|---|
| `…1788307183605` | upstream | `janked-start`/120/48000 r1 | 7.81 | 16 | 468.1 ms | 16 matched, **1 missing**, unmatched `[0]` | 16 matched, 0 missing |
| `…1788309532177` | upstream | `janked-start`/120/48000 r1 | 5.21 | 16 | 470.8 ms | 16, **1**, `[0]` | 16, 0 |
| `…1788309644009` | upstream | `janked-start`/120/48000 r3 | 26.56 | 16 | 470.8 ms | 16, **1**, `[0]` | 16, 0 |
| `…1788310164556` | upstream | `nominal-start`/120/48000 r2 | 26.56 | 16 | 470.8 ms | 16, **1**, `[0]` | 16, 0 |
| `…1788310817094` | upstream | `janked-start`/97.3/44100 r1 | 19.91 | 16 | 587.4 ms | 16, **1**, `[0]` | 16, 0 |

So the earlier claim that "for every beat-aligned-start scenario the click at `m·P` IS
in the buffer" is false as a universal — one `nominal-start` row inside a run this very
section tabulates as a baseline is a counter-example. What holds is the mechanism, and
it holds exactly: on `midtimeline-start` the punch lands mid-beat (φ = 73.23–154.17 ms
over the 24 replayable takes, all of them upstream), the preceding beat sounded BEFORE
the capture began, and the nearest
captured click is the NEXT beat, `P − φ` = 345.8–420.3 ms @120 and 477.9–543.4 ms
@97.3 after the region start — always beyond the half-beat tolerance (250.0 / 308.3 ms). Grid point 0 is
unmatchable, so the expected-beat count exceeds the captured-beat count by exactly one,
on 24 of 24. On the other scenarios the same thing happens only when the capture opens
late enough to miss the beat the region is anchored just after: 5 of 92 takes. Restricted
to the cell with the most such rows, `janked-start`/120/48000 on the upstream build, it
is **3 of 12 replayable repeats** across four runs.

`midtimeline-start`'s region lands wherever the punch fell, measured **11.46–80.73 ms**
past a beat over the 24 candidate rows (`…1788296570300`, `…1788297229626`,
`…1788299505584`, `…1788299943226`) and **73.23–154.17 ms** over the 24 upstream rows
(`…1788306957902`, `…1788307078098`, `…1788310164556`, `…1788310817094`).

Both the permanent `missingBeats = 1` and a systematic bias of
`−(regionStart mod beatPeriod)` on every beat's error follow directly from that.
Measured first-click position in the buffer, over the same 24 takes: **354.8–424.4 ms**
@120 and **484.7–549.0 ms** @97.3.

Part of the spread in that punch-in phase is the harness's own doing: `waitForPosition`
polls `engine.position` on a **50 ms** `setTimeout`, so the record request lands within
50 ms after the target beat. It is not the whole story, though — the measured per-cell
spread of φ across the 8 replayable `midtimeline-start` cells is **5.73–74.48 ms** —
per cell: 29.69, 24.41, 5.73, 55.24, 74.48, 59.10, 11.46, 55.24 ms — so **four** of the
eight exceed the poll interval and the SDK's own placement variation contributes too.
(`task7c-fix1-analysis.ts fencepost` prints the per-cell list and that count.) (An earlier version of this paragraph read the spread as "54.7 ms @120 and 49.9 ms
@97.3 — the poll interval, not an SDK quantity", which the wider population does not
support.)

### The fix

`measureTakeAlignment` now builds the expected-beat grid on the project's
**absolute** beat grid — integer multiples of the beat period from timeline
zero — restricted to the take's presented range, and reports each matched
beat by its absolute timeline index. For a beat-aligned region the two grids
are point-for-point identical — a provable no-op **for that region**, not for
any whole scenario (see the off-grid census above: 97 of 303 non-midtimeline
rows are off-grid and their medians move by exactly +φ). Replaying the shipped
function over the persisted WAVs of the runs whose geometry and audio provably
belong together reproduces the persisted median on 163 of 186 replayable rows to
within 0.05 ms with matched/missing counts exact; the 23 that do not are `loop-wrap`
takes 0, 4 and 5, whose presented range an offline replay has to reconstruct.

### Does the fix blind the metric to genuine head loss?

**The guarantee this register can make is a unit-test guarantee, not a measurement one.**
A beat inside the presented range whose content never reached the buffer stays unmatched
under both grids — that is pinned by
`src/lib/audit/recordingAlignment.test.ts:192` ("still catches a beat inside the
presented range whose content never reached the buffer") and, at a non-integer tempo
with a non-zero waveform offset, by `:237` ("still catches an absent in-range beat at
this tempo"). Both fixtures remove a click that belongs to an in-range beat and assert
the beat is still reported missing. The other two cases are pinned alongside them: no
missing beat when everything in range was captured, and ~0 error rather than the
off-grid phase for a correctly placed punch-in take.

**No live repeat demonstrates it, and none can.** Of the 186 rows whose geometry and
capture audio provably belong together, **zero report a missing beat under the absolute
grid** (29 do under the region-anchored grid, all with unmatched index `[0]` — the
fencepost). Every row that ever reported `missingBeats > 0` — **43 of them, all 43** —
has lost its capture buffer to the pre-fix filename collision. So there is no
surviving-buffer instance of a genuinely absent in-range beat, in either direction: no
replayable row shows one, and no row that reported one has a buffer left to check.
Reproduce these four counts with `task7c-fix1-analysis.ts missingrows`.

**Corrected claim (Task 7c fix round 2).** An earlier version of this paragraph cited run
`1788299505584`, `nominal-start`/120/r1 as a real case. That row's persisted values are
`matchedBeats = 17, missingBeats = 0` — it never lost a beat. Fix round 2 replaced it
with three legacy rows and called them "the genuine instances". **That label is
withdrawn in fix round 3**: nothing in the persisted fields distinguishes absent content
from a captured onset that drifted past the half-beat tolerance, or from a detector
miss, and one of the three persists no geometry at all.

### Unresolved candidates: the non-midtimeline rows that reported a missing beat

Six rows outside `midtimeline-start` reported `missingBeats > 0` across the campaign
(a seventh, `…1788283946271` `nominal-start`/120/48000 r1, is the `0/42` bring-up
failure this register already excludes). **All six have lost their capture buffers, so
none can be resolved.** Reproduce with `task7c-fix1-analysis.ts missingrows`.

These six are disjoint from the five fencepost exceptions tabled under "The confirmed
mechanism": those five have surviving buffers and their persisted `missingBeats` is 0,
because they were measured after the fix. The six below were measured under the
region-anchored grid and their audio is gone.

| run | build | cell | matched/missing | φ | adjusted median | `headMissingRawMs` | why it cannot be decided |
|---|---|---|---|---|---|---|---|
| `…1788287951691` | upstream | `nominal-start`/120/48000 r1 | 16 / 1 | **no geometry persisted** | not persisted | not persisted | the grid-identity argument is unavailable — this row predates the geometry fields entirely, so not even φ is known |
| `…1788290691302` | upstream | `janked-start`/120/48000 r3 | 15 / 1 | 29.17 ms | not persisted | 33.04 ms | off-grid, and consistent with the fencepost the absolute grid dissolves |
| `…1788300424628` | upstream | `nominal-start`/120/48000 r1 | 16 / 1 | 15.63 ms | −63.88 ms | 30.35 ms | off-grid, same |
| `…1788305205480` | upstream | `nominal-start`/120/48000 r1 | 16 / 1 | 5.21 ms | −69.23 ms | 38.38 ms | off-grid, same |
| `…1788296570300` | candidate | `janked-start`/120/48000 r3 | 15 / 1 | **0.00 ms** | −213.23 ms | 35.71 ms | on-grid, so not a fencepost — but its raw median sits only **13.77 ms** inside the 250 ms half-beat tolerance, so ordinary drift explains the unmatched beat without any content being absent |
| `…1788297229626` | candidate | `nominal-start`/97.3/44100 r1 | 16 / 1 | **0.00 ms** | −61.17 ms | 39.12 ms | on-grid, and its median sits 224.16 ms inside tolerance, so systematic drift does NOT explain it — but a single onset drifting or a detector miss still would, and no persisted field separates those from absent content |

What the φ = 0 rows do establish is narrow and worth stating exactly: at φ = 0 the two
grids are point-for-point identical, grid point 0 sits on the region start where a click
sounds, and no phantom expected beat can exist — so those two unmatched beats are **not**
the fencepost this task removed, on either grid. What they are instead is undetermined.
They are recorded here as open candidates for a future round that re-runs those cells
with the run-unique capture names this fix round introduced; they are **not** evidence
for or against Prediction A, and neither the Prediction A withdrawal below nor the
"no upstream issue" conclusion rests on them.

### Cross-track skew

`measureCrossTrackSkew` benefits incidentally: it pairs by beat index, and
those indices are now absolute, so two tapes whose regions landed at
different positions pair on the same musical instant instead of offsetting
one series against the other.

**Does Task 7b's Finding 2 move? Measured, not assumed (Task 7c fix round 1, review
finding 6).** The earlier reasoning here — "Task 7b's multi-mic regions are all
beat-aligned, so no Task 7b number changes" — was both unverifiable and wrong on its
premise. It was unverifiable because `recaudit-mt-summary-*.json` rows carried no
geometry; the harness now persists `regionPositionPpqn`, `regionStartSec`,
`waveformOffsetSec`, `regionDurationSec` and `bufferDurationSec` on every multi-mic row.
It was wrong on its premise because the multi-mic regions are not beat-aligned. The
algebra that matters is different: under the old region-relative grid the skew was
`(fileB − w_B) − (fileA − w_A)`, with the region positions cancelling; under absolute
indices it is `(S_B + fileB − w_B) − (S_A + fileA − w_A)`, which adds `S_B − S_A`.

Three fresh upstream `multitrack-start`/120/48000 runs (3 repeats each) produced two
successful repeats; the other seven hit Finding 1's `AudioFileBox` collision /
finalization timeout, at a rate consistent with that finding.

| run | repeat | tape A pos / S | tape B pos / S | `S_B − S_A` | median skew | max abs skew | paired beats |
|---|---|---|---|---|---|---|---|
| `recaudit-mt-summary-1788309690683.json` | r2 | 71 PPQN / 0.036979 s | 71 PPQN / 0.036979 s | **0** | −2.666667 ms | 2.666667 ms | 16 |
| `recaudit-mt-summary-1788309841868.json` | r1 | 15 PPQN / 0.007813 s | 15 PPQN / 0.007813 s | **0** | 4.371e-7 ms | 4.371e-7 ms | 16 |

Both tapes' regions land at the SAME timeline position in both repeats, so the term the
absolute grid adds is exactly zero and the skew is unchanged by the pairing change. The
measured skews are 4.371e-7 ms (zero to float precision) and −2.666667 ms — the latter
is exactly one 128-frame WASM render quantum at 48000 Hz — and 1 of the 2 repeats
exceeds the 2 ms `ALIGNED_TOLERANCE_MS`,
consistent with Finding 2's "integer multiples of one render quantum, exceeding the
tolerance on most repeats". The mechanism is therefore intra-buffer, not
region-placement: in `…1788309841868` r1 the two tapes' `waveformOffsetSec` differ by
one quantum (0.060333 vs 0.057667 s) and the content position inside each buffer
absorbs it, netting zero skew. **Finding 2's numbers stand.** Two repeats is a thin
population; the candidate side was NOT re-run (its build is no longer on disk — see the
verdict section below), so the cross-build half of Task 7b stays as originally
measured.

### Verification (all runs on the installed SDK, build probe `upstream`)

`missingBeats` is 0 on every row of every run below — previously 12/12
`midtimeline-start` repeats reported 1.

| Run id | Rate | Scenario | Cell | `missingBeats` | Adjusted medians (ms) |
|--------|------|----------|------|----------------|------------------------|
| 1788306957902 | 48000 | midtimeline-start | 120 | **0/3** | −61.71, −69.37, −48.38 |
| 1788306957902 | 48000 | midtimeline-start | 97.3 | **0/3** | −57.24, −41.40, −51.14 |
| 1788307078098 | 44100 | midtimeline-start | 120 | **0/3** | −35.51, −34.35, −48.46 |
| 1788307078098 | 44100 | midtimeline-start | 97.3 | **0/3** | −45.79, −34.92, −35.05 |

Regression cells (48000 Hz, 120 bpm — one cell each, as specified). **Corrected
presentation (Task 7c fix round 1, review finding 2):** an earlier version of this table
gave only the post-fix (absolute-grid) medians and called them "no regression" against
pre-fix numbers that had been measured on the region-anchored grid. Three of these four
runs are off-grid on all three repeats, so that was not a like-for-like comparison —
the inter-grid difference on those rows is 5.2–39.6 ms, the same order as the medians
themselves. Both grids are therefore recomputed here on the SAME capture WAVs, by
re-matching each run's own persisted onsets and geometry:

| Run id | Scenario | repeat | φ (ms) | OLD-grid m/miss | OLD adj median | NEW-grid m/miss | NEW adj median | Δ |
|---|---|---|---|---|---|---|---|---|
| 1788307141361 | nominal-start | 1 | 31.77 | 17/0 | −85.21 | 16/0 | −53.44 | +31.77 |
| 1788307141361 | nominal-start | 2 | 39.58 | 16/0 | −87.21 | 16/0 | −47.62 | +39.58 |
| 1788307141361 | nominal-start | 3 | 39.58 | 17/0 | −78.54 | 16/0 | −38.96 | +39.58 |
| 1788307183605 | janked-start | 1 | 7.81 | 16/**1** | −66.56 | 16/0 | −58.75 | +7.81 |
| 1788307183605 | janked-start | 2 | 26.56 | 17/0 | −77.21 | 16/0 | −50.65 | +26.56 |
| 1788307183605 | janked-start | 3 | 29.17 | 17/0 | −82.54 | 16/0 | −53.37 | +29.17 |
| 1788307228648 | countin-start | 1 | 31.77 | 16/0 | −87.90 | 16/0 | −56.12 | +31.77 |
| 1788307228648 | countin-start | 2 | 7.81 | 17/0 | −63.21 | 16/0 | −55.40 | +7.81 |
| 1788307228648 | countin-start | 3 | 5.21 | 17/0 | −61.23 | 16/0 | −56.02 | +5.21 |
| 1788307304777 | loop-wrap | 1, takes 0–3 | 0.00 | 8/0 each | −77.54 | 8/0 each | −77.54 | 0.00 |
| 1788307304777 | loop-wrap | 1, take 5 | 36.98 | —/0 | −114.52 | —/0 | −77.54 | +36.98 |
| 1788307304777 | loop-wrap | 2, takes 0–3 | 0.00 | 8/0 each | −36.23 | 8/0 each | −36.23 | 0.00 |
| 1788307304777 | loop-wrap | 2, take 5 | 15.63 | —/0 | −51.85 | —/0 | −36.23 | +15.63 |
| 1788307304777 | loop-wrap | 3, takes 0–3 | 0.00 | 8/0 each | −41.25 | 8/0 each | −41.25 | 0.00 |
| 1788307304777 | loop-wrap | 3, take 5 | 23.96 | —/0 | −65.21 | —/0 | −41.25 | +23.96 |

(`loop-wrap` take 4 is the teardown-finalized take whose presented range holds at most
one beat; takes 0–3 are the on-grid control and are bit-stable across grids. The take-5
matched counts are omitted because these rows predate the harness's per-row
`regionDurationSec` and an offline replay has to reconstruct that take's presented range;
the medians do not depend on the reconstruction and reproduce the persisted values.)

Every Δ equals φ exactly. **What "no regression" is established on:** `missingBeats`
(0 on all 27 rows under the absolute grid, versus one row that the old grid reported as
`missing = 1`), and cell verdicts (all `investigate` before and after). It is NOT
established for the medians as a like-for-like magnitude comparison against any
pre-fix figure measured on the old grid — those differ by φ by construction.

`loop-wrap`'s per-take matched-beat split reads 8,8,8,8,1,7 in **all three** repeats of
run 1788307304777, against 8,8,8,8,0,8 (run 1788287951691) and 8,8,8,8,8,1 (run
1788299505584) before the fix. **Corrected (Task 7c fix round 1, review M10):** an
earlier version attributed the trailing `7` to the pre-fix data's own run-to-run
variance. That variance is real (8,8,8,8,0,8 / 8,8,8,8,8,1 / 8,8,8,8,1,8 / 8,8,8,8,8,0
across pre-fix runs) but it is not the cause here: take 5 is off-grid in all three
repeats (φ = 36.98 / 15.63 / 23.96 ms), so the `7` is the deterministic consequence of
the grid change on that take, 3/3. Every take reports `missingBeats = 0` in all three
repeats, and all three `loop-wrap` repeats finalized without hitting `C2`'s timeout on
this run.

### What this changes about the campaign's conclusions

`midtimeline-start`'s corrected adjusted medians (−34.35 to −69.37 ms across
12 repeats, both rates) sit inside the same band as every other scenario in
the same runs (`nominal-start` −38.96 to −53.44, `janked-start` −50.65 to
−58.75, `countin-start` −55.40 to −56.12, `loop-wrap` −36.23 to −77.54).
Once the grid artifact is removed, **`midtimeline-start` stops being a
distinct finding and collapses into the campaign's Finding 1 — the universal
no-count-in placement bias**. It is not a separate content-skip defect.

Two consequences for the register above. Its numbers are not rewritten — they stand as
what was measured under the region-anchored grid — but every contaminated passage
carries a forward pointer to this section, added in fix round 1:

1. The pre-Task-8 outcome summary's finding 2 (`midtimeline-start` content skip,
   `matched=15, missing=1` on 12/12) is **withdrawn** — it measured this
   harness artifact. (The summary was rewritten in Task 8 and no longer carries that
   finding; this entry records the withdrawal for traceability.)
2. Prediction A is **withdrawn in full**, not merely on its `midtimeline-start` leg.

Every `midtimeline-start` median quoted earlier in this register is inflated
by that repeat's `regionStart mod beatPeriod` (11.46–80.73 ms over the 24 candidate
rows, 73.23–154.17 ms over the 24 upstream rows — see "The confirmed mechanism" for the
run ids) and should not be compared against the corrected figures in this section's
tables.

### Prediction A, restated from fresh measurement (Task 7c fix round 1, review finding 3)

A's remaining support after the `midtimeline-start` withdrawal was a single
`janked-start` repeat — `recaudit-summary-1788290691302.json`, 48000 Hz / 120 bpm /
r3, reported as `matched=15, missing=1`. That row is itself **off-grid at φ = 29.17 ms**
and carries exactly the fencepost signature this fix dissolves (`missing = 1`, unmatched
index `[0]`). Its capture buffer was overwritten before this round began, so it cannot
be re-measured; it was re-run instead.

**Six fresh repeats of that exact cell**, on the installed upstream build
(`recaudit-summary-1788309532177.json` and `…1788309644009.json`, three repeats each):

| run | repeat | φ (ms) | `missingBeats` | old-grid unmatched | adjusted median (ms) | `headMissingRawMs` (ms) |
|---|---|---|---|---|---|---|
| …1788309532177 | 1 | 5.21 | **0** | `[0]` under the old grid | −56.00 | 145.02 |
| …1788309532177 | 2 | 31.77 | **0** | — | −46.79 | 23.71 |
| …1788309532177 | 3 | 36.98 | **0** | — | −45.58 | 22.38 |
| …1788309644009 | 1 | 5.21 | **0** | — | −53.33 | 25.02 |
| …1788309644009 | 2 | 2.60 | **0** | — | −46.62 | 23.71 |
| …1788309644009 | 3 | 26.56 | **0** | `[0]` under the old grid | −58.65 | 33.02 |

Not one repeat loses a beat under the absolute grid. Two of the six DO reproduce the
old grid's `missing = 1, unmatched = [0]` — **`…1788309532177` r1 and `…1788309644009`
r3** — and in both, the buffer's click train is uniform end to end (499.9–500.1 ms
across 16 clicks), so nothing was dropped from captured content. What is absent in those
two is the beat-0 click that sounded before the capture opened; the region's own start
sits after it (φ = 5.21 and 26.56 ms), so that beat lies outside the take's presented
range and the absolute grid does not expect it. The head loss is measured directly
rather than as a whole beat, and it is **not** uniformly small: `headMissingRawMs` is
**145.02 ms on `…1788309532177` r1 and 33.02 ms on `…1788309644009` r3** — the same two
values the table above prints for those rows.

**The 145.02 ms repeat, characterized rather than softened.** It is the largest head lag
in the six fresh repeats and the only one over 100 ms. It does not coincide with a lost
beat (absolute grid: `matched = 16, missing = 0`) and its adjusted median, −56.00 ms,
sits mid-range for the cell; its off-grid phase, 5.21 ms, is tied for second-smallest of
the six (the smallest is 2.60 ms on `…1788309644009` r2), so nothing about its geometry
is exceptional.
Baseline-corrected it is 119.02 ms, which trips `classifyCell`'s 2 ms head-deficit gate
and is why that cell reads `investigate`. It is *below* the 134.84–151.04 ms
baseline-corrected band the `C1` triage entry attributes to the harness's own pre-fix
busy-loop (raw 160.84–177.04 ms), so it is not that artifact returning at full strength —
but it is the same order of magnitude, and whether the `C1` fix fully decoupled the jank
from capture-start is not settled by this round's data. One row does point the other way:
`…1788295979783` `nominal-start`/120/48000 r1 carries `headMissingMs` = **151.04 ms**
baseline-corrected, the exact top of the `C1` band, on a scenario that runs no busy-loop
at all.

Against every persisted row carrying the field (351 rows, 40 runs), **exactly three
exceed 100 ms**, and jank does not explain them:

| run | build | cell | `headMissingRawMs` | `missingBeats` | adjusted median |
|---|---|---|---|---|---|
| `…1788295979783` | candidate | `nominal-start`/120/48000 r1 | 177.04 ms | 0 | −50.56 ms |
| `…1788299020715` | candidate | `janked-start`/120/48000 r1 | 179.69 ms | 0 | −10.54 ms |
| `…1788309532177` | upstream | `janked-start`/120/48000 r1 | 145.02 ms | 0 | −56.00 ms |

One of the three is `nominal-start`, which does no jank at all, and two of the three are
on the candidate build. An occasional capture-start stall of 145–180 ms therefore occurs
on both builds and in a scenario with no provocation — it is not jank coupling. None of
the three loses a beat.

**Status: A is not observed on any repeat whose capture buffer survives.** That is the
strongest universal the artifacts support, and it is deliberately narrower than the one
an earlier version of this paragraph asserted ("no repeat, on any scenario"). Scoped to
surviving-buffer evidence, with the populations named:

- **186 rows** across the campaign have both their geometry and their capture audio on
  disk. **Zero** of them report a missing beat under the absolute grid. The 29 that do
  under the region-anchored grid all carry unmatched index `[0]` and are the fencepost
  this task removed.
- **The 6 fresh `janked-start`/120/48000 repeats** (`…1788309532177`,
  `…1788309644009`) — the cell A last rested on — report `missingBeats = 0` on 6 of 6,
  with a uniform 16-click train in every buffer.
- **The 12 fresh upstream `midtimeline-start` repeats** in the two fresh matrix runs
  (`…1788310164556`, `…1788310817094`) report `missingBeats = 0` on 12 of 12, on the
  build where A was originally called "confirmed unconditionally".

A's two original supports cannot be re-measured: the `midtimeline-start` 12/12 is
dissolved by the fencepost outright, and the `janked-start` row at φ = 29.17 ms
(`…1788290691302` r3) is off-grid with the fencepost signature and its buffer is gone.
**A is recorded as withdrawn — not reproduced on any repeat with a surviving buffer,
including 6 fresh repeats of the cell it last rested on — and no upstream issue should
be drafted for it.**

This withdrawal rests only on the surviving-buffer evidence above. It does **not** rest
on the six unresolved legacy rows tabled under "Unresolved candidates" earlier in this
section, in either direction: two of those are on-grid and therefore not fencepost
artifacts, but no persisted field can tell whether their unmatched beat was absent
content or a drifted onset, and their buffers are gone. If a future round re-runs those
cells with run-unique capture names and finds genuinely absent in-range content, A comes
back onto the table and this withdrawal must be revisited.

**The `janked-start` positive-median outlier is also a grid artifact.**
`recaudit-summary-1788295321703.json`, 48000 Hz / 120 bpm / r1 carries the campaign's
only positive median. Its persisted values are `medianBeatErrorMs` = **+31.12 ms** (raw)
and `medianBeatErrorMsAdjusted` = **+54.12 ms**; its φ is **406.25 ms**, by far the
largest off-grid phase in the register (`regionPositionPpqn` = 11340, i.e. the region
landed 5.906 s into the timeline). Its buffer was overwritten, so this is an analytic
re-derivation rather than a measurement, done consistently on the RAW median: 31.12 +
406.25 = 437.37 ms, past the 250 ms half-beat tolerance, so each onset re-pairs one beat
later and the raw error becomes 437.37 − 500 = **−62.63 ms raw**, i.e. an adjusted
median of about **−39.6 ms** — an ordinary value inside the universal-bias band, not an
outlier. (An earlier version of this paragraph ran the derivation from the raw median
but labelled the result adjusted, understating it by the 23 ms harness-path term.)

That row is degenerate on both grids for a second, independent reason: its persisted
`matchedBeats` is **5**, not the 16 or 17 every other `janked-start` repeat reports.
Nothing in the register should treat it as evidence of late placement, on either grid.

### Note: a real, small head loss on punch-in (not the missing beat)

Separately from the above, `headMissingRawMs` on `midtimeline-start`
(12.21–49.04 ms over all 48 persisted rows) is genuine content between the record request and the first
captured frame — the same worklet-connect setup lag the calibration baseline
absorbs on every scenario, not a midtimeline-specific defect. "Small" is scoped to
`midtimeline-start`: across all 351 rows the same quantity reaches 145–180 ms on three
occasions, tabled under "Prediction A, restated from fresh measurement" above. Pre-connecting
the recording worklet at ARM time so the ring holds pre-roll before the punch
would remove it for all scenarios. That is a design change to the SDK's
capture path, not a bug fix, and is out of this task's scope; it is recorded
here because the punch-in case is where a user would notice it first.

## Task 7c fix round 1: verdict re-derived on the absolute grid

Live runs made in this fix round, all on the installed SDK with no build override (build
probe reads `upstream` on every one). Every one was started from a FRESH page load — a
navigation, never a Vite HMR reload or an in-page "Re-run" — and no `src/` file was edited
while any cell was running; the harness's own measurement code was unchanged from the
commit that precedes the first run through the last.

Two qualifications, so the note is not read as stronger than it is. One in-page "Re-run"
WAS attempted, after the first `janked-start` run: it tripped the SDK's one-shot
`Workers.install` assert (the page read `error: Workers are already installed`, the
known Vite HMR remount artifact), produced no summary and no rows, and was discarded —
every run in the table below came from a fresh navigation instead. And two lines of the
multi-mic harness's on-page Configuration panel — display text describing the upload
filenames, no measurement logic — were corrected after the pre-run commit and sat
uncommitted across all seven runs; they were written before the first run started and
untouched until after the last, so no run overlapped an edit, but the runs were not made
from a fully committed tree.

The runs:

| run | cell(s) | purpose |
|---|---|---|
| `recaudit-summary-1788309532177.json` | `janked-start`/120/48000, 3 repeats | Prediction A re-measurement |
| `recaudit-summary-1788309644009.json` | `janked-start`/120/48000, 3 repeats | Prediction A re-measurement |
| `recaudit-mt-summary-1788309690683.json` | `multitrack-start`/120/48000, 3 repeats | multi-mic geometry (1 repeat succeeded) |
| `recaudit-mt-summary-1788309841868.json` | `multitrack-start`/120/48000, 3 repeats | multi-mic geometry (1 repeat succeeded) |
| `recaudit-mt-summary-1788309988877.json` | `multitrack-start`/120/48000, 3 repeats | multi-mic geometry (0 repeats succeeded) |
| `recaudit-summary-1788310164556.json` | full matrix, 48000 Hz | fresh absolute-grid upstream baseline |
| `recaudit-summary-1788310817094.json` | full matrix, 44100 Hz | fresh absolute-grid upstream baseline |

The absolute grid is the spec-§3.4-correct measure — map each onset to timeline time and
match it to the NEAREST beat — so **every median this campaign measured on an off-grid
take, on either build, was biased by −φ**. The campaign's candidate-vs-upstream verdict
("Verdict against the recast criteria (corrected)" above: 64-89 % bias reduction, 5/20
signature-B matches, janked 78-86 %, zero regressions) therefore had to be re-derived.
This section carries the corrected figures; where a figure cannot be corrected, it says
so and why.

### What could and could not be replayed offline

Every persisted matrix row was checked. A row is replayable only if it carries per-row
geometry AND its capture WAV provably belongs to it — matched by frame count against the
row's own `bufferDurationSec`, by sample rate, and by write window against the run's own
token, never by filename alone.

Snapshot: **all 40 summary runs on disk through `1788310817094`**, the newest run this
fix round made. Reproduce with

```
RECAUDIT_MAX_RUN=1788310817094 node \
  .superpowers/sdd/2026-09-01-recording-start-alignment-audit/scripts/task7c-fix1-analysis.ts enum
```

| population | rows | outcome |
|---|---|---|
| rows with no per-row geometry | 148 | not replayable — includes **both upstream matrix runs** (`recaudit-summary-1788287951691.json`, `…1788288625777.json`), which predate the geometry fields entirely |
| rows whose capture WAV was overwritten by a later run of the same cell | 165 | not replayable |
| rows replayed under both grids | 186 | 163 reproduce their persisted median to <0.05 ms with matched/missing counts exact |
| **total considered** | **499** | 148 + 165 + 186 |

The **23** non-reproducing rows are all `loop-wrap` takes 0, 4 and 5 from runs that
predate this fix round's per-row `regionDurationSec`: their medians reproduce, their
matched counts do not, because an offline replay has to reconstruct the presented range
of a take that tiles a shared buffer. That gap is now closed for future runs.

(An earlier version of this table quoted 143 / 195 / 126 / 113, a split that reproduced
from no snapshot at all — it mixed a row count taken before the two fresh matrix runs
landed with counts taken from a superseded ownership rule. The `RECAUDIT_MAX_RUN` bound
above exists so this table stays reproducible after future runs land.)

**The decisive gap: the upstream matrix runs carry no geometry at all, so their medians
are uncorrectable — the entire upstream column of the verdict tables was unreplayable.**
The candidate matrix runs do carry geometry, and their `phi` is 0 on 161 of their 168
non-midtimeline rows (the 7 exceptions are all `loop-wrap`'s wrap-finalized take 5), so
16 of the candidate side's 20 cell means need no correction at all. Only the 4
`midtimeline-start` cells move, by their own mean `phi` of 47.3-62.1 ms.

Two fresh upstream matrix runs were therefore made on the installed SDK (which IS
upstream — the build probe reads `upstream` on every run):
`recaudit-summary-1788310164556.json` (48000 Hz) and `…1788310817094.json` (44100 Hz),
3 repeats per cell, `harnessPathBiasSec` = 0.023 s, identical to the candidate runs'.
**The candidate side was NOT re-run: the Task 7 build layout no longer exists on disk**
(it was a local scratch directory, deleted after Task 7 per that task's own restore
note), so its rows are corrected analytically by adding each row's own `phi`. The
identity that licenses that — absolute median = region-anchored median + `phi` — was
verified directly on every row of this round where both grids were computed on the same
audio (27 regression rows and 6 janked repeats, delta = `phi` exactly on all of them).

### The corrected 20-cell comparison

Candidate means are the candidate matrix runs corrected to the absolute grid; upstream
means are the fresh runs as measured. `loop-wrap` cell means use takeIndex 1-4, the same
population `classifyCell` evaluates. The candidate status column is `classifyCell` re-run
over the corrected repeats.

| rate | scenario | bpm | candidate mean (ms) | upstream mean (ms) | Δ | candidate cell status |
|---|---|---|---|---|---|---|
| 48000 | nominal-start | 120 | −14.55 | −52.51 | 72 % smaller | **matches-known-defect (B)** |
| 48000 | nominal-start | 97.3 | −7.67 | −41.81 | 82 % smaller | investigate |
| 48000 | janked-start | 120 | −13.66 | −47.85 | 71 % smaller | investigate |
| 48000 | janked-start | 97.3 | −12.55 | −49.51 | 75 % smaller | investigate |
| 48000 | midtimeline-start | 120 | −15.99 | −46.83 | 66 % smaller | investigate |
| 48000 | midtimeline-start | 97.3 | −27.38 | −47.32 | 42 % smaller | investigate |
| 48000 | countin-start | 120 | −9.67 | −52.26 | 82 % smaller | **matches-known-defect (B)** |
| 48000 | countin-start | 97.3 | −22.77 | −46.04 | 51 % smaller | investigate |
| 48000 | loop-wrap | 120 | −29.00 | no data (all 3 upstream repeats hit `C2`) | — | investigate |
| 48000 | loop-wrap | 97.3 | −29.52 | −49.40 | 40 % smaller | investigate |
| 44100 | nominal-start | 120 | −8.03 | −44.73 | 82 % smaller | **matches-known-defect (B)** |
| 44100 | nominal-start | 97.3 | −12.15 | −41.57 | 71 % smaller | **matches-known-defect (B)** |
| 44100 | janked-start | 120 | −8.47 | −45.07 | 81 % smaller | investigate |
| 44100 | janked-start | 97.3 | −13.21 | −46.32 | 71 % smaller | investigate |
| 44100 | midtimeline-start | 120 | −19.52 | −47.16 | 59 % smaller | investigate |
| 44100 | midtimeline-start | 97.3 | −14.08 | −45.89 | 69 % smaller | investigate |
| 44100 | countin-start | 120 | −9.58 | −47.07 | 80 % smaller | **matches-known-defect (B)** |
| 44100 | countin-start | 97.3 | −18.77 | −47.33 | 60 % smaller | investigate |
| 44100 | loop-wrap | 120 | −22.66 | −34.97 | 35 % smaller | investigate |
| 44100 | loop-wrap | 97.3 | −26.42 | no data (all 3 upstream repeats hit `C2`) | — | investigate |

### How each verdict quantity moved

| quantity | as committed | corrected | note |
|---|---|---|---|
| bias reduction, `nominal-start`/`countin-start` | 64-89 % | **51-82 %** | 8 cells |
| bias reduction, `janked-start` | 78-86 % | **71-81 %** | 4 cells |
| bias reduction, `midtimeline-start` | 32-66 % | **42-69 %** | 4 cells; the only direction that improved |
| bias reduction, `loop-wrap` | 38-47 % | **35-40 %** | 2 comparable cells, 2 unmeasurable |
| cells where the candidate's bias is smaller | 20 of 20 | **18 of 18 comparable** | 2 cells have no upstream data |
| cells classifying `matches-known-defect` | 5 of 20 | **5 of 20 — the same 5 cells** | `nominal`/120/48k, `countin`/120/48k, `nominal`/97.3/44.1k, `nominal`/120/44.1k, `countin`/120/44.1k |
| `midtimeline-start` "missing beat persists unchanged on both builds" | 3/3 repeats per cell | **WITHDRAWN** | 0 of 12 fresh upstream midtimeline repeats report a missing beat |

**Direction and conclusion survive; the magnitudes move by up to 13 percentage points and
one leg is withdrawn outright.** No cell regresses under the corrected measure either.
Verdict (b) still holds. Verdict (a)'s "third targeted mechanism unchanged" leg is gone:
there was no third mechanism to fix.

Two independent re-confirmations fell out of the fresh runs. Verdict (c), the `loop-wrap`
finalization hang: **10 of 12 fresh upstream repeats failed** with `finalization timed out
after 30s` (48000 Hz 5 of 6, 44100 Hz 5 of 6), against the candidate build's 0 of 12 —
so the C2 failure rate is if anything worse upstream than the 18/27 the register records,
and the candidate side's clean sweep stands. And `midtimeline-start` reports
`missingBeats = 0` on all 12 fresh upstream repeats, which is the live confirmation, on
the upstream build, that the missing beat was the harness's own fencepost.

### What still cannot be corrected

- **The two original upstream matrix runs' medians** (`…1788287951691`, `…1788288625777`)
  and every figure derived from them — the "Matrix results" tables, the cross-rate
  per-cell means, and the `upstream mean adj` column of the candidate comparison tables.
  They persist no geometry and their capture WAVs are long gone. They are superseded by
  the fresh runs above rather than corrected.
- **The candidate build's own numbers were not re-measured**, only corrected. The
  correction is exact for the 16 cells whose `phi` is 0 and analytic for the 4
  `midtimeline-start` cells. A candidate re-run would need the Task 7 build layout
  rebuilt from scratch; that is a decision for the team lead, not something this round
  did unasked.
- **`janked-start`'s φ = 406.25 ms outlier** (`…1788295321703`, 48000 Hz/120/r1) — its
  buffer is gone, so its re-aliased value (≈ −39.6 ms adjusted / −62.63 ms raw, see
  "Prediction A, restated from fresh measurement") is derived, not measured. That row is
  degenerate on both grids anyway — its persisted `matchedBeats` is 5.
