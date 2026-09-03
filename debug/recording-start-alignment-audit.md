# Recording Start-Alignment Audit — campaign register & results

**Title:** Recording Start-Alignment Audit — campaign register & results

**SDK Pin:** `@opendaw/studio-sdk@0.0.170` (installed npm package; WASM engine only)

**Filed:** upstream PR [andremichelle/openDAW#376](https://github.com/andremichelle/openDAW/pull/376)
(the reworked fix, fork branch `naomiaro:fix/recording-start-alignment`); issues
[andremichelle/openDAW#374](https://github.com/andremichelle/openDAW/issues/374) (residual
start-placement bias) and [andremichelle/openDAW#375](https://github.com/andremichelle/openDAW/issues/375)
(simultaneous-take `AudioFileBox` collision). A third contribution — the loopback
input-latency calibration that closes #374's remaining term — is prepared but not posted; see
"Input-latency calibration (2026-09-02)" at the end of this register.

**Harness:** unlisted debug demo `recording-alignment-audit-debug-demo.html?scenario=<name|all>&bpm=<n|all>&rate=<44100|48000>`
on the dev server (`?scenario=probe` runs the same-context loopback feasibility probe
instead of the matrix). Measurement library: `src/lib/audit/recordingAlignment.ts`;
calibration constants: `src/lib/audit/recordingAuditCalibration.ts`. WAV
(`recaudit-<scenario>-<bpm>-<rate>-r<repeat>-<build>-<runToken>.wav`; multi-mic
`recaudit-mt-<scenario>-<bpm>-<rate>-r<repeat>-tape<a|b>-<build>-<runToken>.wav`) and JSON
(`recaudit-summary-<runToken>.json` / `recaudit-mt-summary-<runToken>.json`) uploads land in
`.verify-output/` via the dev server's `/__verify` sink. Every summary JSON also carries `outputLatency`,
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
| candidate fix build (superseded, history) | 0/20 | **5/20** | 15/20 | `recaudit-summary-1788299505584.json` (48000 Hz), `…1788299943226.json` (44100 Hz), corrected to the absolute grid and re-classified |
| **reworked fix, this branch (Task 9, amended)** | 0/20 | 8/20 | **12/20** | `recaudit-summary-1788328219906.json` (48000 Hz), `…1788328656062.json` (44100 Hz) — measured live on the branch; every `investigate` is the classifier's "no band matched" (a late mean of 15–24 ms) and the 8 band matches are magnitude coincidences — both are the loopback's own input delay, quantified per row; head and tail deficits 0 on all 120 rows (see Task 9) |

The two fresh-baseline cells with no usable repeat are `loop-wrap`/120/48000 and
`loop-wrap`/97.3/44100 — all three repeats of each hit the C2 finalization timeout.
Classification is identical across both sample rates for every scenario on the upstream
build; no rate-dependent effect was found. The candidate build's 5
`matches-known-defect` cells are `nominal-start`/120/48000, `countin-start`/120/48000,
`nominal-start`/120/44100, `nominal-start`/97.3/44100 and `countin-start`/120/44100, all
matching signature B.

**Candidate-build figures in this summary are analytically corrected from persisted
per-row geometry (absolute median = region-anchored median + `phi`, valid for `phi < P/2`,
which every corrected row satisfies — see "Task 7c fix round 1"), not re-measured** —
the Task 7 override build layout no longer exists on disk. **They are history: the
reworked fix was re-measured live on its own branch in Task 9** (section "Task 9:
best-fix rework — branch-measured verification"), which supersedes the candidate column
wherever the two disagree.

### Key findings

1. **Start-placement bias — the campaign's primary finding.** **Every** scenario
   measured places its take EARLY on the timeline, count-in included. On the fresh
   absolute-grid upstream baseline the per-cell means run **−34.97 to −52.51 ms
   adjusted** across all 18 measurable cells — 4 `nominal-start`, 4 `countin-start`,
   4 `janked-start`, 4 `midtimeline-start` and 2 `loop-wrap`
   (`…1788310164556.json`, `…1788310817094.json`) — and the most negative single take
   in that baseline is a **`countin-start`** row (`…1788310817094`, 120 bpm r3,
   −59.33 ms). The counted-in branch subtracts `countInSeconds` but not the
   worklet-connect gap, so it carries the same signature as the rest.
   Root-caused to `RecordAudio.ts:270-274`'s
   `headStartSeconds = wallclockSinceWorklet`, decomposed into three additive terms in
   "Bring-up calibration": a harness-path `audioContext.outputLatency` term (23 ms at
   both rates, out of scope per design spec §2), the dominant uncompensated
   worklet-connect-to-transport-start gap, and an anchor-position residual. **Task 9
   found that the "anchor-position residual" is a fourth mechanism**:
   `RecordingWorklet.#finalize` kept the LAST `limit` frames of the ring, dropping the
   32–51 ms overshoot from the buffer HEAD on every recording (`…1788328085978`, persisted
   `finalizeOvershootFrames` 1535–2431 on 6 of 6), and
   that the loopback path's own delay (10–23 ms, late) partially masks the early terms.
   On the reworked branch the per-cell means are +9.33 … +23.77 ms, and netting out the
   per-row loopback delay leaves +1.13 … +1.19 ms on 59 of 60 rows
   (`…1788328219906`, `…1788328656062`).
2. **`loop-wrap` finalization hang.** On upstream, **18 of 27** finalization attempts
   across the five campaign runs that attempted `loop-wrap` timed out
   (`…1788287951691`, `…1788288625777`, `…1788288803959`, `…1788291343233`,
   `…1788291706370`), and **10 of 12** on the fresh baseline (5/6 at each rate,
   `…1788310164556`, `…1788310817094`). Binary fast-success-or-never: raising the
   deadline from 30 s to 90 s left 4 of 6 still failing (`…1788291343233`). **Root-caused
   in Task 9** (`…1788327757434`, persisted per-repeat probe: 4 of 6 hung, every one a
   take whose live duration is still ≤ 0 at stop, deleted without the worklet ever being
   asked to finalize — no `limit()` call, loader left in `record`) and fixed on the
   branch: 0 of 12 branch repeats fail (`…1788328219906`, `…1788328656062`); the hang
   evidence is persisted per repeat (`…1788327757434`: 4 of 6 hung, all four without any
   `limit()` call). See C2 and Task 9.
3. **Multi-mic take collision (Task 7b Finding 1).** `SampleService.importFile` derives
   an `AudioFileBox` uuid as `SHA-256(arrayBuffer)` when none is passed, and
   `importRecording` never passes one. Two simultaneous takes whose encoded bytes are
   identical therefore derive the SAME uuid, and the second `BoxGraph.stageBox` panics
   with `AudioFileBox <uuid> already staged`. **Deterministic, not a race:** a dedicated
   same-device confirmation cell collided on **3 of 3** repeats
   (`recaudit-mt-summary-1788304987514.json`). In the official matrix the incidental
   timing jitter between two independently-scheduled worklets produced colliding content
   on **10 of 24** repeat attempts across upstream and the superseded candidate build (`…1788302627819` 2/6,
   `…1788302870379` 4/6, `…1788303391228` 1/6, `…1788303605274` 3/6) — that count
   measures this harness's own capture-window jitter, not either SDK build.
4. **Inter-track skew (Task 7b Finding 2).** Of the **14** measurable `medianSkewMs`
   values across the four official multi-mic runs, **3** are zero to float precision,
   **10** are within 0.02 ms of ±1 WASM render quantum (2.667 ms @48000 Hz, 2.902 ms
   @44100 Hz), and **1** is a distinct constant outlier (−10.000001 ms = 441 samples at
   44100 Hz, holding to 6 decimal places across all 16 of its paired beats,
   `…1788303605274` `multitrack-start`/r2). **11 of 14 exceed the 2 ms tolerance, and
   the magnitude is identical on both builds.** **Task 9 attributes it**: with per-tape
   first-frame times persisted on the reworked branch, each tape's residual after
   netting its OWN loopback delay is identical (+1.15 / +1.15 ms) and the skew equals
   the difference of the two loopback streams' delays exactly (`…1788325557229`) — the
   harness's two streams, not the SDK. The skew draft is withdrawn.
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
| B — random ±15 ms band from ring-reader delivery lag | **CONFIRMED in direction, REFUTED in magnitude and mechanism** | The measured bias is 2.3–3.5× the predicted ±15 ms and systematically negative. Fresh absolute-grid per-cell means −34.97 to −52.51 ms (`…1788310164556`, `…1788310817094`). Task 9: the random component is the ring's overshoot at stop being dropped from the buffer HEAD by `#finalize` (32–51 ms, `…1788328085978`), not delivery lag in the anchor read. |
| C — 50–235 ms constant-late under main-thread jank | **NOT CONFIRMED, NOT CLEANLY REFUTED — explicit design-spec §6 deviation** | `janked-start` cannot isolate C from A and B: `classifyCell` resolves the head-loss branch before band matching, and `constant-late` structurally requires a positive mean while every measured mean is negative. Registered as a deliberate deviation from the spec's binary framing, with the follow-up needed to resolve it (a jank provocation that overlaps the anchor-read window without causing content loss). |
| D — loop-wrap content ~20–24 ms LATE, flat across takes | **CONFIRMED FLAT, REFUTED in magnitude and sign** | Flatness holds on the absolute grid: the within-repeat spread across takes 1–4 is **0.079 ms** (`…1788310164556`, 97.3 bpm r1) and **0.136 ms** (`…1788310817094`, 120 bpm r2) on the two fresh upstream repeats that finalized, and at most **0.142 ms** over the 12 candidate repeats — no accumulation take to take. But the offset is EARLY, not late, and the two fresh cell means (−34.97, −49.40 ms) are **1.2–3.3×** the predicted 15–30 ms band — the same inherited placement bias as B, not the predicted voice-crossfade lateness. |

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

**Superseded by Task 9 (reworked fix, measured live on its branch, amended stop path):**
(a) not `aligned` on any cell — 8 `matches-known-defect` (magnitude coincidences), 12
`investigate` ("no band matched", late means of 15–24 ms); the whole remainder is the
loopback's own input delay, quantified per row (residual +1.13 … +1.19 ms on 59 of 60
rows); (b) 18 of 18 comparable cells smaller in magnitude, 2 more cells measurable;
(c) 0 of 12 with the mechanism traced, fixed and its evidence persisted; (d) **passed on
the amended branch** — `headMissingMs` and `tailMissingMs` are 0 on all 120 rows — after
the first branch build had FAILED it on the tail (94 of 120 rows, its stop path truncated
the file at the last position tick; kept as history in Task 9); collision unchanged; skew
attributed to the harness's two streams.

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

What this campaign has put upstream, or has ready to:

| contribution | what it carries | status |
|---|---|---|
| PR [#376](https://github.com/andremichelle/openDAW/pull/376) — anchor takes on the engine's own recording start | the one-shot `recordingStart` engine report, the processor's first-frame time, the finalization hang and the `#finalize` head drop | **posted** (fork branch `naomiaro:fix/recording-start-alignment`); measured before/after under "Task 9: best-fix rework" |
| PR [#378](https://github.com/andremichelle/openDAW/pull/378) — apply the input latency the browser reports | `InputLatency.resolve` and the `Reported` default, bounded and read after output has started | **posted**; the branch below stacks on it |
| PR [#380](https://github.com/andremichelle/openDAW/pull/380) — loopback input-latency calibration | the loopback calibration routine (`InputLatencyCalibration.measure`, `CaptureAudio.calibrateInputLatency`, the per-device store, the `calibrated` resolver rung, the keep-alive sink, the chain-reuse fix, the second capture anchor), upstream PR head `9d0cccb88` (figures measured at `66021385`; the real-device runs at `9d0cccb88` — the measurement code is the same, see the head reconciliation in the calibration section) | **posted** 2026-09-03 (fork branch `naomiaro:feat/input-latency-calibration`, stacks on #378 and #376); measurements and open findings under "Input-latency calibration (2026-09-02)"; **real device measured** 2026-09-03 — six acoustic runs on a built-in microphone, section "Real-device calibration (2026-09-03)" |

One PR-description draft (`pr-recording-start-alignment.md`, rewritten in Task 9 around
the reworked fix with branch-measured before/after) and **two** issue drafts under
`debug/drafts/`; three earlier drafts are withdrawn under `debug/drafts/withdrawn/`
with the reason at their head:

| draft | finding | status |
|---|---|---|
| `issue-residual-start-placement-bias.md` | the start-placement bias on all five scenarios, count-in included, with the four-term decomposition, the fresh-upstream signature per scenario, and what remains after the fix (the input path's own delay) | to file |
| `issue-take-collision.md` | Task 7b Finding 1, the deterministic content-address collision (unchanged: 6 of 12 repeats on the two upstream official runs, 9 of 18 on the three branch runs) | to file |
| `withdrawn/issue-loop-wrap-finalization-hang.md` | C2 — root-caused and fixed by the PR | withdrawn |
| `withdrawn/issue-punch-in-head-loss.md` | its measured quantity was the `#finalize` head drop minus the loopback delay; the true request-to-first-frame gap is 0–3 render quanta (0–8.7 ms) | withdrawn |
| `withdrawn/issue-inter-track-quantum-skew.md` | the skew equals the two loopback streams' delay difference; SDK-side skew is zero on the branch | withdrawn |

The PR draft's "what this does not fix" list points at the two remaining drafts.

The calibration section adds one more issue candidate, not drafted yet: the stop path
truncating input in flight beyond its incidental post-stop margin. A second candidate — a
terminated capture never tearing its audio chain down, nor releasing its microphone — was fixed
on the calibration branch instead (`b8e08b97e`).

**Deliberately not drafted, because neither is confirmed:** Prediction C's explicit
spec-§6 deviation (the campaign's `janked-start` provocation cannot isolate it from A
and B), and the six unresolved legacy rows under "Unresolved candidates" (buffers gone,
undecidable in either direction). The withdrawn Prediction A gets no draft.

## Fix round 1 (2026-09-01) — corrections after review

The team lead's review of the first draft found 3 Critical and 4 Important issues.
This register has been rewritten to reflect the corrected data; the corrections
themselves (what was wrong, what changed, what was re-run) are summarized here for
traceability, with full detail folded into the relevant sections below and in the
Task 6 fix-round session report (not committed).

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

> **Superseded in Task 9** ("Task 9: best-fix rework — branch-measured verification"):
> the quantity this baseline absorbs is not a request-to-first-frame gap. On the
> installed 0.0.170 it is the `RecordingWorklet.#finalize` head drop (the file kept the
> LAST `limit` frames; ring overshoot 1535–2431 frames, `…1788328085978`) minus the
> loopback path's own delay (10–23 ms); the SDK-reported first captured frame follows
> the request by 0–3 render quanta, and on the reworked branch `headMissingRawMs` is 0
> on all 120 rows. The constant still works as the empirical baseline it was measured
> as; the interpretation below is history.

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

> **Resolved in Task 9** ("Task 9: best-fix rework — branch-measured verification"): the
> hang is the stop path deleting a take whose live duration is still ≤ 0 (a stop right
> behind a wrap) without ever asking the worklet to finalize — 4 of 6 repeats in
> `recaudit-summary-1788327757434.json` hung, all four with an empty `finalizeLimitCalls`
> and `finalizeLoaderState: "record"` (persisted per row). Fixed on the reworked branch
> (0 of 12 repeats). The characterization below stands as written.

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
  collapses into the same start-placement bias as every other scenario, count-in
  included. See "Task 7c fix round 1".]** The consistent `missing=1` beat plus large negative
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
before posting); item 2 is withdrawn and gets no draft. (Task 9 outcome: item 3, the
hang, was root-caused and fixed by the PR and its draft withdrawn — see "Task 9:
best-fix rework — branch-measured verification".) `loop-wrap`'s D-flatness is a
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
all 20 cells (reproduce with
`node scripts/audit/recording-alignment/task7-adjusted-classification.ts`).

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

> **Attributed in Task 9** ("Multi-mic on the branch"): with per-tape first-frame times
> persisted, the skew equals the difference of the two loopback streams' own delays
> exactly on every successful pair and each tape's residual after netting its own delay
> is identical (+1.15 / +1.15 ms) — the harness's two streams, not the SDK. The issue
> draft is withdrawn (`debug/drafts/withdrawn/issue-inter-track-quantum-skew.md`). The
> characterization below stands as measured.

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

> **Task 9 outcome:** Finding 1 is drafted (`issue-take-collision.md`, unchanged on the
> reworked branch: 9 of 18 repeats); Finding 2 is withdrawn — the skew is the two
> loopback streams' delay difference, not the SDK's (see "Multi-mic on the branch").

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
`scripts/audit/recording-alignment/`; the
original three scripts joined a summary row to a capture WAV by filename alone and were
deleted in fix round 1, replaced by provenance-checked ones that verify the WAV belongs
to the row before using it — see that directory's `README.md`):

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
  scripts/audit/recording-alignment/task7c-fix1-analysis.ts census
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
  scripts/audit/recording-alignment/task7c-fix1-analysis.ts fencepost
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
start-placement bias, which every scenario carries, count-in included**. It is not a
separate content-skip defect.

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

> **Reinterpreted in Task 9:** `headMissingRawMs` is the `#finalize` head drop (ring
> overshoot, 32–51 ms measured) minus the loopback delay, not a capture-start gap, so a
> 145–180 ms value would need a ~170 ms overshoot or a real stall — neither is measured,
> and all three rows have lost their capture buffers. They are unexplained, not evidence
> of a stall.

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

> **Superseded in Task 9** ("Task 9: best-fix rework — branch-measured verification"):
> `headMissingRawMs` is the `#finalize` head drop minus the loopback delay, not content
> lost between the request and the first captured frame; the SDK's first captured frame
> follows the request by 0–3 render quanta, and the quantity is 0 on all 120 rows of
> the reworked branch. The punch-in draft was withdrawn for this reason
> (`debug/drafts/withdrawn/issue-punch-in-head-loss.md`); the pre-connect-at-arm
> suggestion below is moot. The note stands as history.

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
  scripts/audit/recording-alignment/task7c-fix1-analysis.ts enum
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
**It holds only for `phi < P/2`**: past the half period the region-anchored grid's nearest
expected beat to the first captured onset is the region start itself, at distance `P − phi`,
so the anchored error is `e + (P − phi)` and the correct correction is `phi − P`, a full
beat period away from `+phi`. Every corrected row in the tables below satisfies the
condition (midtimeline `phi` ≤ 154 ms against a 250/308 ms half period; the loop-wrap take-5
rows ≤ 45 ms), and since the PR-review fix wave (2026-09-02) the scripts assert it per row
(`phiCorrectionMs` in `scripts/audit/recording-alignment/artifacts.ts`) rather than assume it.

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

## Task 9: best-fix rework — branch-measured verification

The upstream fix was reworked into the SDK's own idiom (design brief: the whole-branch
review's "Port design assessment") and then measured **on that branch itself**, built from
upstream `main` (`4a9f183f6`, package versions identical to the installed 0.0.170) and served
through `SDK_DIST_OVERRIDE`. Every figure in this section is recomputed from the named
`.verify-output/*.json` artifacts by
`node scripts/audit/recording-alignment/task9-branch-verification.ts` (modes `cells`,
`hang`, `hop`, `mt`, `probe`, `integrity`); nothing is carried over from earlier prose. The
"before" side is the fresh absolute-grid upstream baseline (`recaudit-summary-1788310164556.json`
48000 Hz, `…1788310817094.json` 44100 Hz), never the two original upstream runs. The earlier
"analytically corrected" candidate figures ("Task 7c fix round 1", "Task 7: candidate-build
verification") stay above as history of a build that no longer exists; this section
supersedes them as the campaign's after-side evidence.

**Fix round 1 (review of this section, C1/I1):** the first branch build measured here
truncated the file at the last position tick, which failed the spec's tail-integrity
criterion on 94 of 120 rows while the first version of this section reported only head
integrity and attributed every `investigate` verdict to the loopback delay. That build's
runs (`…1788324358634`, `…1788324856598`) are kept below as history under "First branch
build"; the stop path was changed to keep every delivered frame and the matrix was re-run
(`…1788328219906`, `…1788328656062`). Every verdict below now carries the classifier's own
`detail`, and criterion (d) is stated per build.

### The reworked fix, in upstream terms

- **`EngineToClient.recordingStarted(contextTime, position)`** — a one-shot message the wasm
  processor dispatches on the rising edge of the engine's recording flag, read straight from
  the engine state buffer after `engine.render()`: the context time at the END of the render
  quantum recording began in, paired with the playhead position after that quantum. One
  instant, one message; the per-quantum `contextTime` schema field of the earlier port is
  gone and the sync packet's byte layout is untouched. `EngineWorklet` stores it as
  `recordingStart: ObservableOption<RecordingStart>` (cleared when a recording is prepared),
  `EngineFacade` mirrors it, the `Engine` interface declares it.
- **`RecordingProcessor` first-frame announcement / `RecordingWorklet.firstQuantumTime`** —
  kept from the port (the reviewer judged it the right design).
- **`RecordAudio` first take** — created on the first `isRecording` tick with both anchors
  present: `waveformOffset = (start.contextTime − firstQuantumTime) + outputLatency +
  inputLatency`, `takePosition = start.position` (floored to the Int32 field with the
  fraction moved into the offset; a negative offset — first frame after the start — moves
  the take to the first integer position the audio covers). Fallback to the 0.0.170
  main-thread arithmetic only after a 0.25 s context-clock wait, with a debug line naming
  which anchor is missing. Gone: the three-tick cap, the `wasStartingAt` walk-back, the 1 s
  window, and the loop-wrap "restart-fade" compensation (the fresh upstream data showed no
  wrap lateness to compensate — takes 0 and 1–4 agree to 0.07 ms).
- **Stop path** (mechanisms below): after the source is disconnected, the current take's
  duration is set to the delivered length (`numberOfFrames / sampleRate − currentWaveformOffset`;
  the live update only ran on position ticks and chunks keep arriving between the last tick
  and the stop), a take whose delivered length is ≤ 0 is dropped, the file always finalizes
  for the takes that remain with `limit(numberOfFrames)` — every delivered frame kept, both
  ends — and a recording that leaves no take is aborted with its file box deleted.
- **`RecordingWorklet.#finalize` head-keep** (new finding, below): the imported sample keeps
  the FIRST `limit` frames instead of the last (`recordedFrames`, a pure exported helper).
- Dropped from the PR: the `RecordMidi` `?? 10.0` one-liner and the `getUserMedia`
  constraint change (recorded in the task report, not branched).
- Tests: `packages/studio/core/src/capture/RecordAudio.test.ts` (8 tests: anchored placement,
  fractional position, a first frame after the start, waiting for both anchors, the fallback,
  stop extends the take to the delivered frames, stop with a zero-duration take finalizes the
  earlier takes, abort deletes the file box) and `RecordingWorklet.test.ts` (3 tests on
  `recordedFrames` with ramp chunks, asserting frame values); the scoped turbo build,
  `core-wasm` bundles and the `studio-core` vitest (45 files, 411 tests) all green before
  the commit.

### Two mechanisms found on the installed build before anything was claimed

**C2, the loop-wrap finalization hang — confirmed and root-caused, evidence persisted.**
The harness's finalization probe (`finalizeLimitCalls`, `finalizeNumberOfFramesAtStop`,
`finalizeNumberOfFramesAtLimit`, `finalizeOvershootFrames`, `finalizeNumberOfFramesAfter`,
`finalizeLoaderState`; `limit()` patched on the take's live `RecordingWorklet` instance
before `stopRecording()`) on the installed 0.0.170, plain server,
`?scenario=loop-wrap&bpm=all&rate=48000`, `recaudit-summary-1788327757434.json`:

| repeat | frames at stop | `limit()` calls | frames after the wait | loader state | outcome |
|---|---|---|---|---|---|
| 120/r1 | 1057664 | **none** | 1059456 | `record` | timed out 30 s |
| 120/r2 | 1057536 | **none** | 1059584 | `record` | timed out 30 s |
| 120/r3 | 1058176 | **none** | 1060096 | `record` | timed out 30 s |
| 97.3/r1 | 1304192 | **none** | 1306240 | `record` | timed out 30 s |
| 97.3/r2 | 1305728 | 1305728 (frames at the call 1307648, overshoot 1920) | 1307648 | `loaded` | finalized 101 ms |
| 97.3/r3 | 1305088 | 1305089 (frames 1306752, overshoot 1663) | 1306752 | `loaded` | finalized 118 ms |

Every hang is a repeat in which **nobody ever called `limit()`**; the ring kept delivering
(frames after > frames at stop) and the loader stayed in `record`. Mechanism: the harness
stops as soon as the 6th take exists (right after the 5th wrap); that take's live duration
(`numberOfFrames / sampleRate − currentWaveformOffset`) is still ≤ 0 while the ring has not
delivered past the chained offset — a window widened by the placement bias itself, since
the bias inflates every chained offset — so the stop path takes the #840 zero-duration
branch, deletes the region and never asks the worklet to finalize. The review's competing
hypothesis (a float-rounding `limit === numberOfFrames + 1`) has no instance: both
finalized repeats' limits sat 1663 and 1920 frames BELOW `numberOfFrames`. An earlier
console-only run of the same test (`…1788323077339`, 2 of 6 finalized, same pattern) is
superseded by this persisted one. Why the candidate build "fixed" it without touching
finalization: its smaller bias narrows the window; a lower hit rate, not a fix.

**A head drop in `RecordingWorklet.#finalize` — the random term of the placement bias.**
The same probe on `nominal-start` (`recaudit-summary-1788328085978.json`, 6 repeats,
installed build): every repeat finalized with one `limit()` call, and at that call the ring
had delivered **1535–2431 frames (32.0–50.6 ms) more than the limit** (per repeat: 1535,
1919, 1663, 2431, 1536, 1535). `#finalize` kept the LAST `limit` frames
(`frame.slice(-totalSamples)`), so the file's frame 0 was the buffer's frame
`numberOfFrames − limit`. Regions address the buffer from frame 0 through `waveformOffset`,
so every take's content shifted early by that overshoot — random per recording, invisible
to any anchor arithmetic. Persisted corroboration on the fresh upstream matrix rows: the
raw median regresses on `headMissingRawMs` (the loopback-derived buffer start minus the
request, which the head drop inflates) with slope −0.93 (n = 25, `…1788310164556`) and
−0.92 (n = 25, `…1788310817094`). The `onSaved` comment in `RecordAudio.ts` already
assumed the truncation happens at the tail.

### Before (fresh upstream) vs after (this branch), per cell, absolute grid

Population as `classifyCell` sees it (loop-wrap over wrap takes 1–4, 12 rows per cell; the
other scenarios 3 repeats per cell). Branch runs: `recaudit-summary-1788328219906.json`
(48000 Hz) and `…1788328656062.json` (44100 Hz), 60 rows each, **0 error rows**, build probe
`candidate` on both. The status column is the classifier's verdict WITH its own `detail`
reason.

| rate | scenario | bpm | upstream mean (ms) | branch mean (ms) | branch status — classifier detail | \|branch\| / \|upstream\| |
|---|---|---|---|---|---|---|
| 48000 | nominal-start | 120 | −52.51 | 9.33 (anomaly note: 16.99 re-adjusted) | matches-known-defect (B) — random-band B, spread 23.00 ms | 18 % |
| 48000 | nominal-start | 97.3 | −41.81 | 19.67 | investigate — no band matched (mean 19.67, spread 1.33) | 47 % |
| 48000 | janked-start | 120 | −47.85 | 19.44 | investigate — no band matched (spread 9.33) | 41 % |
| 48000 | janked-start | 97.3 | −49.51 | 15.00 | investigate — no band matched (spread 7.33) | 30 % |
| 48000 | midtimeline-start | 120 | −46.83 | 20.33 | investigate — no band matched (spread 2.67) | 43 % |
| 48000 | midtimeline-start | 97.3 | −47.32 | 17.00 | investigate — no band matched (spread 9.33) | 36 % |
| 48000 | countin-start | 120 | −52.26 | 15.44 | matches-known-defect (B) — random-band B, spread 11.33 | 30 % |
| 48000 | countin-start | 97.3 | −46.04 | 18.33 | matches-known-defect (B) — random-band B, spread 9.33 | 40 % |
| 48000 | loop-wrap | 120 | no data (3/3 hit C2) | 10.78 | investigate — no band matched (mean 10.78) | — |
| 48000 | loop-wrap | 97.3 | −49.40 | 18.30 | matches-known-defect (D) — constant-late D, mean 18.30 | 37 % |
| 44100 | nominal-start | 120 | −44.73 | 14.50 (anomaly note: 22.17 re-adjusted) | matches-known-defect (B) — random-band B, spread 23.18 | 32 % |
| 44100 | nominal-start | 97.3 | −41.57 | 22.36 | investigate — no band matched (spread 2.54) | 54 % |
| 44100 | janked-start | 120 | −45.07 | 22.28 | investigate — no band matched (spread 1.34) | 49 % |
| 44100 | janked-start | 97.3 | −46.32 | 23.77 | investigate — no band matched (spread 0.73) | 51 % |
| 44100 | midtimeline-start | 120 | −47.16 | 18.97 | investigate — no band matched (spread 8.21) | 40 % |
| 44100 | midtimeline-start | 97.3 | −45.89 | 21.56 | investigate — no band matched (spread 1.45) | 47 % |
| 44100 | countin-start | 120 | −47.07 | 21.14 | investigate — no band matched (spread 1.93) | 45 % |
| 44100 | countin-start | 97.3 | −47.33 | 21.40 | matches-known-defect (B) — random-band B, spread 4.58 | 45 % |
| 44100 | loop-wrap | 120 | −34.97 | 21.28 | matches-known-defect (D) — constant-late D, mean 21.28 | 61 % |
| 44100 | loop-wrap | 97.3 | no data (3/3 hit C2) | 21.13 | matches-known-defect (D) — constant-late D, mean 21.13 | — |

- **Sign flips, magnitude falls on 18 of 18 comparable cells** (18–61 % of the upstream
  magnitude); the two cells with no upstream baseline now measure like every other. Branch
  per-cell means run **+9.33 … +23.77 ms** — late, not early — and the per-scenario ranges
  overlap completely (nominal 9.33–22.36, janked 15.00–23.77, midtimeline 17.00–21.56,
  count-in 15.44–21.40, loop-wrap 10.78–21.28).
- **Verdicts, honestly:** 0 `aligned`, 8 `matches-known-defect`, 12 `investigate`. Every
  `investigate` is the classifier's "no band matched": a late mean of 15–24 ms with a
  within-cell spread of 0.7–9.3 ms that no predicted signature band covers. The 8 band
  matches are coincidences of magnitude, not mechanism: the five "B" cells match the
  random-band signature only because the loopback delay (below) varies 10–23 ms per stream
  instance and so scatters the three repeats; the three loop-wrap "D" cells land inside D's
  15–30 ms constant-late band because the loopback delay is that size — Prediction D's
  mechanism (voice-crossfade lateness, accumulating or not) was refuted earlier in this
  register, and takes 0 and 1–4 agree to 0.08 ms here. None of the 20 verdicts is produced
  by a head or tail deficit (next).
- **Criterion (d), head/tail integrity, per build:**

  | build | rows | `tailMissingMs` > 2 ms | tail max / mean | `headMissingMs` > 2 ms | true-clock file end − stop request (take 0) |
  |---|---|---|---|---|---|
  | upstream 48000 (`…1788310164556`) | 30 | 0 | 0.00 / 0.00 | 3 (max 5.69) | n/a (no `firstQuantumTimeSec`) |
  | upstream 44100 (`…1788310817094`) | 30 | 0 | 0.00 / 0.00 | 2 (max 7.61) | n/a |
  | first branch build 48000 (`…1788324358634`, history) | 60 | **48** | 24.29 / 14.90 | 0 | −5.33 … +32.02 ms, 8 of 30 end before the request |
  | first branch build 44100 (`…1788324856598`, history) | 60 | **46** | 25.80 / 15.09 | 0 | −5.78 … +31.95 ms, 6 of 30 end before |
  | **branch 48000 (`…1788328219906`)** | 60 | **0** | 0.00 / 0.00 | 0 | +24.00 … +72.00 ms, 0 of 30 end before |
  | **branch 44100 (`…1788328656062`)** | 60 | **0** | 0.00 / 0.00 | 0 | +29.02 … +78.37 ms, 0 of 30 end before |

  The first branch build failed (d): its stop path limited the file to the last position
  tick's duration, discarding chunks delivered after that tick (the file ended up to 5.8 ms
  before the stop request on the true clock; the harness's `tailMissingMs`, which also
  carries the loopback delay, flagged 94 of 120 rows and produced 17 of its 19
  `investigate` verdicts as "tail deficit exceeds 2ms tolerance"). Upstream and the
  superseded candidate build passed (d) with tail 0 of 120 because upstream's `#finalize`
  kept the LAST frames — complete tail, dropped head. The amended branch keeps both ends:
  tail and head deficits are 0 on all 120 rows, and the file now ends 24–78 ms AFTER the
  stop request (the stop command's round trip plus the packet observation and the chunks
  still delivered before the disconnect); the current take is extended to that point.
- **Loop-wrap stays flat**: within-repeat spread across takes 1–4 is 0.063–0.079 ms at
  48000 Hz and 0.137–0.142 ms at 44100 Hz on all 12 branch repeats, and take 0 sits within
  0.08 ms of the takes 1–4 mean — the earlier port's 12.7 ms wrap-take offset is gone.
- **Harness-bias anomaly, two rows.** The harness reads `audioContext.outputLatency` per
  cell as its path-bias term; Chrome reports 0 until output has started, so the first cell of
  each fresh session (`nominal-start`/120/r1 at both rates) was measured with a bias of 0
  instead of 0.023 s (`medianBeatErrorMsAdjusted − medianBeatErrorMs` = 0.00 on those two
  rows, 23.00 on the other 118). Re-adjusted with the run's own `outputLatency` they read
  +20.10 and +23.06 ms and the cell means +16.99 / +22.17 ms; the table keeps the persisted
  values. Not an SDK effect (the SDK read 0.023 on those repeats — `waveformOffsetSec` is
  identical to the neighbouring repeats). Fix pending in the harness: read the term after
  the first output, or per repeat.
- **Region start granularity (not head loss):** the take's region starts at
  `floor(position after the quantum in which the transport flipped to recording)`, i.e.
  1–3 render quanta after the musical start (`regionPositionPpqn` 4, 5 or 10 on the branch
  rows). The content is not shifted — the fraction is moved into `waveformOffset` — only the
  region's left edge is that late. Sub-quantum exactness would need the transport to expose
  the block offset of the flip; optional follow-up.

### The residual is the loopback path, quantified per row

`firstQuantumTimeSec` (per-row field: the SDK's own context time of the buffer's first
frame) and `anchorT0Sec` (the harness's estimate of the same instant from the loopback's
reference clicks, which uses no region field) differ by the loopback path's own delay —
`MediaStreamAudioDestinationNode → getUserMedia → MediaStreamAudioSourceNode` — which the
review flagged as the one harness-path unknown. On the branch it is **9.62–22.92 ms,
varying per stream instance** (60 take-0 rows over both rates). Netting it out of the
adjusted median leaves **+1.13 … +1.19 ms on 59 of 60 rows** (the 60th is the 48000
first-cell anomaly row, −0.85 ms after re-adjustment: its `waveformOffsetSec` is
0.027604 against 0.025604 on its neighbours, i.e. the SDK read `outputLatency` as 0.025
instead of 0.023 on the session's first recording and placed that take 2 ms earlier —
the same first-recording latency-report wobble that feeds the harness-side anomaly), a
rate-independent constant inside
the 2 ms tolerance, consistent with detector onset latency and not investigated further.
The SDK-reported first captured frame follows the record request by **0–8.7 ms (0–3
render quanta, exactly)** on every row, and `headMissingRawMs` is 0 on all 120 rows. So:
on this harness the reworked SDK places takes exactly to within the detector's own
constant; what the classification calls `investigate` or a band match is the loopback's
input delay, which a real device would report as its `inputLatency`. Upstream rows carry
no `firstQuantumTimeSec`, so the same decomposition cannot be run on the before side.

### Loop-wrap finalization

| build | repeats | failed | successes | probe |
|---|---|---|---|---|
| upstream (`…1788310164556`, `…1788310817094`) | 12 | **10** (`finalization timed out after 30s`) | 72–91 ms | (no probe fields; the persisted probe run above shows the no-`limit()` pattern on 4 of 6) |
| branch (`…1788328219906`, `…1788328656062`) | 12 | **0** | 72–100 ms | one `limit()` call per repeat, overshoot 0 on all 60 rows, loader `loaded` on all |

With the mechanism traced and fixed, `issue-loop-wrap-finalization-hang.md` is withdrawn
from the to-file set (moved to `debug/drafts/withdrawn/`, reason at its head).

### First branch build (history)

`recaudit-summary-1788324358634.json` (48000) and `…1788324856598.json` (44100), 60 rows
each, 0 error rows: per-cell means +6.44 … +21.95 ms, 18 of 18 comparable smaller, 0 of 12
loop-wrap hangs, hop 9.62–22.90 ms, residual +1.13 … +1.19 on 59 of 60 rows — and tail
deficits on 94 of 120 rows (table above). Superseded by the amended branch; kept because
the review's finding is part of the record.

### Multi-mic on the branch

Branch runs `recaudit-mt-summary-1788325292003.json` and `…1788325557229.json` (first
branch build; the second after the harness gained per-tape `anchorT0Sec`) and
`…1788329084394.json` (amended branch, with the finalization probe), all
`multitrack-start` + `multitrack-janked`, 48000 Hz / 120 bpm, 3 repeats each, against the
two upstream official runs:

| run | build | rate | repeats lost to the collision | skew medians (ms) |
|---|---|---|---|---|
| `…1788302627819` | upstream (official) | 48000 | 2 of 6 | −0.000, −2.667, 2.667, 2.667 |
| `…1788302870379` | upstream (official) | 44100 | 4 of 6 | −2.902, 2.902 |
| `…1788325292003` | first branch build | 48000 | 3 of 6 | 2.667, 0.000, −2.667 |
| `…1788325557229` | first branch build | 48000 | 3 of 6 | 2.000, 2.667, −2.667 |
| `…1788329084394` | amended branch | 48000 | 3 of 6 | −2.667, 2.667, 2.667 |

- **Collision (Finding 1): unchanged** — 6 of 12 repeats on the two upstream official runs
  and 9 of 18 on the three branch runs (`finalization tape<A|B> timed out after 30s` on
  every lost repeat). The populations differ in rate (upstream 48000 + 44100, branch
  48000 × 3), so this is "same rate", not a matched comparison; nothing in the data says
  the branch collides more or less often. The probe now separates the collision from the
  loop-wrap hang: on every collided repeat of `…1788329084394` BOTH tapes' `limit()` was
  called (`finalizeLimitCalls` one entry each, overshoot 0) and only the colliding tape's
  loader stayed in `record` — the import panicked after `limit()`, whereas a hung
  loop-wrap never reached `limit()` at all.
- **Skew (Finding 2): same magnitude, attributable.** In `…1788325557229` and
  `…1788329084394` every successful repeat's two tapes have identical residuals after
  netting their OWN loopback delay (+1.15 / +1.15 ms; the first-cell row pairs −21.85 /
  −21.85 under the bias anomaly), and the measured skew equals the difference of the two
  delays exactly: 18.96 vs 21.63 ms → 2.667; 18.96 vs 20.96 → 2.000; 12.29 vs 9.62 →
  −2.667; 20.96 vs 18.29 → −2.667; 18.29 vs 20.96 → 2.667; 9.62 vs 12.29 → 2.667. In
  `…1788325292003` r2 the two first frames sat one quantum apart (8.2667 vs 8.2693 s) and
  the skew was 0.000 — the shared `recordingStarted` anchor compensates a first-frame
  difference exactly. The skew is the two loopback streams' delay difference, not the SDK's
  arithmetic; `issue-inter-track-quantum-skew.md` is withdrawn (`debug/drafts/withdrawn/`).
  Tail and head deficits are 0 on all 6 successful tape rows of the amended run.

### What this changes about the campaign's conclusions

- **Key finding 1 (placement bias)** now decomposes into: (1) the harness `outputLatency`
  term (23 ms, unchanged); (2) the main-thread anchors (worklet-connect gap + observed
  position) — fixed by the `recordingStarted` design; (3) the `#finalize` head drop of
  32–51 ms per recording — fixed; and (4) the loopback hop of 10–23 ms in the LATE
  direction, which partially masked the others and is the whole of what remains. The
  "anchor-position residual" term of the residual-bias draft was (3).
- **Prediction B** (random band from ring delivery lag): the randomness was the head drop
  (the ring overshoot at stop), not delivery lag in the anchor read. The branch's five "B"
  matches are the loopback delay's per-stream variation, not B's mechanism.
- **Prediction D**: the three loop-wrap "D" matches on the branch are the loopback delay's
  magnitude landing in D's band; D's mechanism stays refuted (flat takes, take 0 = takes 1–4).
- **Key finding 2 (C2)**: root-caused and fixed, evidence persisted; not "unexplained".
- **Criterion (d)**: passed on upstream (tail complete, head dropped), failed on the first
  branch build (tail truncated at the last tick), passed on the amended branch (both ends).
- **The punch-in head-loss draft is withdrawn** (`debug/drafts/withdrawn/`): its measured
  quantity was the head drop minus the hop, not a capture-start gap; the true
  request-to-first-frame interval is 0–3 quanta.
- **Multi-mic**: the collision stands unchanged (Finding 1, 6 of 12 upstream, 9 of 18 branch); the skew draft is withdrawn (Finding 2 is the harness's two stream delays).

### Evidence index (Task 9)

| quantity | artifact |
|---|---|
| hang mechanism, installed build, persisted probe | `recaudit-summary-1788327757434.json` (fields `finalizeLimitCalls`, `finalizeLoaderState`, …); earlier console-only run `…1788323077339.json` |
| head drop / ring overshoot, installed build, persisted probe | `recaudit-summary-1788328085978.json`; earlier console-only run `…1788323424682.json`; slope −0.93/−0.92 on `…1788310164556`/`…1788310817094` |
| override engagement smoke (amended branch) | `recaudit-summary-1788328182481.json` (probe `candidate`, overshoot 0, tail 0) — first build's smoke `…1788324070880.json` |
| branch matrix (amended) | `recaudit-summary-1788328219906.json` (48000), `…1788328656062.json` (44100) |
| first branch build matrix (history) | `recaudit-summary-1788324358634.json`, `…1788324856598.json` |
| branch multi-mic | `recaudit-mt-summary-1788329084394.json` (amended); first build `…1788325292003.json`, `…1788325557229.json` |
| before side | `recaudit-summary-1788310164556.json`, `…1788310817094.json`; multi-mic `recaudit-mt-summary-1788302627819.json`, `…1788302870379.json` |

Restore: the override server was killed by PID, `node_modules/.vite` cleared, the plain
server restarted, and the build probe read `upstream` on a fresh load
(`recaudit-summary-1788329377765.json`: `nominal-start`/120/48000, adjusted medians −53.33,
−36.38, −40.06 ms, no `firstQuantumTimeSec`, ring overshoot at `limit()` back to 2047 / 1535 /
1536 frames; the first-build round's restore run was `…1788325938960.json`).

## PR review fixes (2026-09-02)

The five-agent review of PR #123 (0 Critical, 25 Important) was fixed in one wave. Nothing
in this section re-measures anything; it records what the fixes changed in the
recomputation scripts and the harness, and that the figures above stand.

**Scripts re-run, every figure unchanged.** All seven committed scripts were run before and
after the fixes, unbounded and under the documented `RECAUDIT_MAX_RUN=1788310817094`
bound, and their outputs diffed. Every numeric and status figure this register quotes is
byte-identical. The differences are: relabelled provenance notes (the two G2 upstream
runs now say "outputLatency not persisted, bring-up constant 0.023" instead of
"fallback"); added counts (verdict and task8 footers now print skipped/no-row cells so
the tallies sum to 20); the task9 multi-mic header now names the beat grid each run's
per-tape medians sit on; and two corrections in `task7c-fix1-analysis.ts correct`, a
mode this register never quotes: cells whose rows predate `medianBeatErrorMsAdjusted`
printed `NaN` means and now print no data, and one row past the φ-identity's
precondition (`…1788295321703`, `janked-start`/120/48000 r1, φ = 406.25 ms against a
250 ms half period) is now listed and excluded — its old "+φ" figure was wrong by a full
beat period. The null-median repeat the review flagged (`…1788296570300`, `loop-wrap`/120
r1) is take 5, outside the take-1..4 population every classifier evaluates, so passing
null-median repeats through to `classifyCell` (as the harness does live) moved no verdict.

**Classifier rules added** (`classifyCell`): an empty repeat list is `investigate` (it read
`aligned` before, vacuously); a repeat whose `headMissingMs` is null — no reference-click
anchor — is `investigate` with detail "integrity unmeasured" instead of silently skipping
both integrity gates. No persisted non-error row in any run has a null head figure, so no
recorded verdict changes; the rule protects future sweeps.

**Persisted contract.** Row and envelope types now live in
`src/lib/audit/recordingAuditArtifacts.ts` with an explicit schema-generation table
(G1–G6) that replaces every run-id and `??` inference the scripts used to make; the
harness writes `schemaVersion: 2`, `beatGrid: "absolute"`, `cellVerdicts` (one record per
attempted cell, all-error cells included), `wavUploadFailures`, and per row the applied
`harnessPathBiasSec` plus `wavName`/`wavUploadError`. Legacy files are untouched.

**Harness.** `audioContext.outputLatency` is read once per page load after output has
started (the per-repeat read behind the first-cell "bias 0" rows in Task 9 is gone);
the engine boots once per page so "Re-run" works; position polls stop on timeout; a
repeat abandoned by the outer cell deadline (now 180 s single-tape / 200 s multi-mic,
above the inner stages' worst-case sums) can no longer call `stopRecording()` or patch a
loader during the next repeat. Smoke run on the installed build, plain server:
`recaudit-summary-1788333632997.json` (`nominal-start`/120/48000, 3 repeats,
`harnessPathBiasSec` 0.024 on every row and in the envelope, settled in 0 ms, adjusted
medians −48.02 / −56.25 / −61.58 ms, verdict `investigate` as expected for the installed
build); a Re-run on the same page produced `…1788333706282.json` under a fresh token
with the same per-row bias (−48.06 / −42.77 / −42.37 ms). This session's
`outputLatency` read 0.024 s, not the campaign's 0.023 s — a device-state difference the
per-row persistence now makes visible rather than assumed.

## Input-latency calibration (2026-09-02)

An extension of this campaign, stacked on the same upstream branch. #376 anchors a take on
the engine's own recording start and #378 applies the input latency the browser reports; what
remains is the input path's own delay whenever the browser reports nothing, reports zero, or
reports a figure that does not describe the device in use — the residual #374 names. The
branch adds a loopback calibration routine to the SDK that measures that delay, and this repo
adds a ground-truth page that measures the routine against a delay it injects itself.

**Upstream branch:** `feat/input-latency-calibration`, PR head **`9d0cccb88`** (34 commits), on
top of the merge of PR #376 and PR #378. Fourteen commits up to `66021385` — the head every measurement
below was taken at — then four more, covered in the note after this list. The fourteen: the MLS
generator, the FFT correlation and peak refinement, `analyzeBursts` and the worker protocol, the worker executor and sender, the
capture worklet, `InputLatencyCalibration.measure`, the per-device store and the `calibrated`
resolver rung, `CaptureAudio.calibrateInputLatency` / `clearInputLatencyCalibration`, the
polarity-tolerant peak search, the stored-spread clamp, the keep-alive sink (`ac1c15ea8`), the
configurable probe (`3484e3265`), the unstamped-capture chain reuse (`546b5bfaa`) and the
second capture anchor (`66021385`). **Filed** as PR [#380](https://github.com/andremichelle/openDAW/pull/380) on 2026-09-03.

Every measurement in this section was taken at or below `66021385`; `b51951082`, five commits
above it, is the head the PR was filed at, and none of the five touches the measurement, the
protocol or the analysis. `e539e543f` plays the probe through the context destination unconditionally (see
Method), `b8e08b97e` makes the terminator tear the audio chain down (finding 3), `a9df2da18`
refuses `Options` that would hang the wait (`burstCount` not a positive integer, a
non-positive or non-finite `burstSpacingSeconds`, a non-finite `gainDb` — each of which left the
last burst's scheduled end NaN, which the default clock wait can neither reach nor time out on),
`bca9dcb5e` is review polish, and `b51951082` corrects the second-anchor comment's own count of
the one-quantum observation to the 1-in-29 this section derives. Test counts at `bca9dcb5e`,
which `b51951082` does not change: lib-dsp 14 files / 137, studio-core 48 files / 511.

**Head reconciliation.** The PR's head is now **`9d0cccb88`**, 8 commits above `b51951082` by
`git rev-list` — 6 on the branch's first parent, two of them merges of
`fix/recording-start-alignment` that bring in `38d453c6c` (drop a recording-start report
belonging to an earlier recording) and `2bbc9ee39` (start the processor's recording generation
below the client's); the other four are `4ae040cc8` (a type guard on nested preference labels
in the studio app) and three on `InputLatencyCalibration.ts`: `d2780316d` (the scheduling
runs inside a `Promises.tryCatch` closure, so a capture node that throws on construction
takes the gain node off the output), `1d0a864e2` (the capture's stop is bounded, and a
rejected stop returns `context-not-running` instead of hanging) and `9d0cccb88` (that return
carries reason "capture delivered no frames"). Read-only `git diff 66021385..9d0cccb88` over
`packages/lib/dsp/src/latency-calibration.ts` and
`packages/studio/core/src/capture/InputLatencyCalibration.ts` (70 insertions, 36 deletions):
the dsp file changes by **one guard in `analyzeBursts`** (`bca9dcb5e`) that skips a burst whose
capture start time is NaN — a capture that never saw input — instead of letting it fall through
into an empty subarray; for a finite start time the window, the correlation and the peak
refinement are byte-for-byte the same. The core file changes by the option refusal
(`a9df2da18`), the doc comment's count (`b51951082`), the `NoFramesReason` constant, the two
`tryCatch` wrappers around the capture stop and its disconnect, and the closure above; the
lead-in, the burst start times, the second anchor's opening instant
(`firstBurst + min(referenceSeconds, burstSpacingSeconds)`) and the final wait are the same
expressions. **So a call that completes runs the same measurement code at `9d0cccb88` as at
`66021385`**, and the real-device runs (section "Real-device calibration (2026-09-03)", served
from `9d0cccb88`) are comparable with the loopback runs above. Test counts at `9d0cccb88`:
lib-dsp 14 files / 137, studio-core 48 files / **512** (the bounded stop adds one test, per the
PR's Verification section).

**Design spec:** `docs/superpowers/specs/2026-09-02-input-latency-calibration-design.md` and its
plan, both deleted in the PR that completes this work per repo convention — recovery:
`git log --all --oneline -- 'docs/superpowers/*/2026-09-02-input-latency-calibration*'`. This
section supersedes the spec on three points: the sub-sample refinement bound is 0.25 sample,
not §6's 0.1; the probe plays through the context destination unconditionally, not §4.2's
monitor output when one is set; and the capture buffer reaches the worker structured-cloned,
not "transferred", which is what the spec's analysis step and its protocol block both claim.

**Harness:** unlisted debug demo
`input-latency-calibration-debug-demo.html?delays=<ms,…>&bpm=<n>&rate=<44100|48000>&armState=<steady|fresh>&defaultInput=1&repeat=<n>`.
It sweeps a `DelayNode` in the synthetic loopback's return path, calibrates at each value,
fits the measured input part against the injected delay, applies the calibration and then runs
one `nominal-start` cell through the standing sweep's own runner
(`src/lib/audit/recordingCellRunner.ts`), so the verdict is this register's metric and not a
look-alike. Runs upload `calib-summary-<runToken>.json` into `.verify-output/`. The page reaches
the branch API through local structural interfaces plus a runtime feature check, documented at
its head as a shim to delete when a release ships the API.

**Every figure below was recomputed from the named artifacts** by
`node scripts/audit/recording-alignment/task12b-calibration-tables.ts [runs|noise|chains|miss|batches]`
(calibration tables) and
`node scripts/audit/recording-alignment/task12a-keepalive-classification.ts` (the standing
sweep's cells). Neither script trusts the page's arithmetic: the least-squares fits are
recomputed and any disagreement with the persisted `fit` is printed, and the sweep cells are
re-classified through `classifyCell`.

### What the measurements support

**(i) The standing sweep on this build.** On SDK `3484e3265` (calibration routine, keep-alive
sink, MLS probe), uncalibrated, same-context loopback, the full standing sweep at 48 and
44.1 kHz (60 rows each) recorded every row with head and tail deficits of 0 and lost no
repeat, as every branch build since run 1788299505584 has (installed 0.0.170 lost 3–5
loop-wrap repeats per sweep); every repeat median was late by 13.36–24.22 ms (cell means
16.33–23.67 ms). The harness names the loopback device on a stream that reports no id, so the
SDK rebuilt the input chain before every take, and each take's chain landed in one of two
delay states (48 kHz: hop 12.29 ms on 9 of 30 chains, 20.29–21.63 ms on the rest; 44.1 kHz:
13.18 ms on 2 of 30). Under the campaign's predicted bands A–D the 20 single-tape cells read 8
`matches-known-defect` (B ×4, D ×4) and 12 `investigate`; under bands E/F, fitted to these two
runs, all 20 fall inside the envelope by construction. `janked-start` and `midtimeline-start`
no longer differ from `nominal-start`, so the sweep is a regression guard on a constant. On
`546b5bfaa` the same configuration still rebuilt per take (`nominal-start` 48 kHz: 12.29 /
12.29 / 20.96 ms, E; 44.1 kHz: spread 1.75 ms, F); with the box naming no device
(`defaultInput=1`) one cell recorded three takes on one chain (hop 20.96 ×3, spread 0.00 ms,
F) with a single `getUserMedia` open persisted on the envelope.

**(ii) Calibration ground truth.** On `3484e3265` the routine recovered the injected return
delay with slope 1.0000 on all ten runs (spans 0–50 ms, four points each, max residual
≤ 0.003 ms, every burst identified at 45–53 dB, nothing skipped or excluded); in the two
steady runs the intercept matched the harness's independent hop of the same chain to within
0.30 ms and the applied cell classified `aligned` at +1.44 / +1.45 ms, identical across
repeats; in 7 of 8 fresh runs the rebuilt chain landed within 1.04 ms of the calibrated chain
and the cell classified `aligned` at +0.10…+1.82 ms, and in 1 of 8 it landed in the low state,
8.38 ms below the stored value, placing all three takes 7.23 ms early (`investigate`). On
`546b5bfaa` four further runs classified `aligned` at +0.10 (48 kHz fresh), +0.21 (44.1 kHz
fresh) and +1.44 ms twice (48 kHz steady, default input, one stream for the whole run), with
slope 1.0000 on three of them; on the 44.1 kHz run one of the four sweep calls returned a
value 128.00 frames (one render quantum, 2.90 ms) short with verdict `ok` and burst spread
9e-9 s, giving a fitted slope of 0.941 — the routine's self-check does not catch a one-quantum
error on which all three bursts agree.

**(iii) Rebuilt-chain residual.** A chain's input delay is constant for the chain's life (all 72 rows
of the 24 calibration runs from `ac1c15ea8` on read one hop within their own run) but is set when the chain is built, in one of two states
8.0–9.3 ms apart at 48 kHz (hops on a 32-frame lattice: 590 against 974 / 1006 / 1038 frames);
across every fresh chain in this build's artifacts the low state took 11 of 49 chains at
48 kHz and 2 of 35 at 44.1 kHz. A chain is built at arm, at every explicit disarm/re-arm, and
— before `546b5bfaa` — before every recording on a capture box naming no device; a box naming
a device that the stream reports (every real device) reused its chain on every build. A stored
calibration is therefore wrong by the step whenever a take's chain lands in the other state
from the calibrated one, and nothing the harness records predicts which; the mechanism is
measured, not identified.

**(iv) What is unmeasured.** Every figure is a same-context digital loopback result; no
microphone track has been measured, so whether a real device track shows the two chain states,
the 32-frame lattice, the one-quantum calibration miss, or the +1.2 ms constant residual is
unknown, and the real-device run is the only evidence that could say so. The chain-reuse path
on `546b5bfaa` is supported by two consistent runs plus a `getUserMediaOpens: 1` on each
envelope, not by an SDK-side observation; the multitrack `AudioFileBox` collision (#375) still
loses 3 of 6 multitrack repeats. *Since measured, on one device — section "Real-device
calibration (2026-09-03)": the two chain states and the 32-frame lattice do not appear on it,
the one-quantum step does and holds, and the residual is still unmeasured because no take was
recorded on the real path.*

These four sentences are the referee's, with **seven departures** — four figures the
recomputation in `task12b-calibration-tables.ts` disagreed with, and three places where a
better artifact existed. None changes a conclusion.

| # | referee's text | as written here | why |
|---|---|---|---|
| 1 | 11 of 50 chains low at 48 kHz | 11 of **49** | the referee's per-source tally counts eight arm-built calibration chains where the build has seven 48 kHz runs; one high chain was double-counted |
| 2 | 2 of 36 at 44.1 kHz | 2 of **35** | same: three arm chains, counted as four |
| 3 | 1 of 24 keep-alive-era 44.1 kHz calls | 1 of **29** sweep calls | the seven runs' sweeps are 4+4+5+4+4+4+4, including the wide-span run's fifth point and the miss run's own four |
| 4 | fresh chains "within 0.66 ms" of the calibrated one | within **1.04 ms** | 0.66 is the largest 44.1 kHz value; `1788388011786` is 1.041 ms, listed in the referee's own table |
| 5 | 39 of 39 within-chain repeats identical | **72 of 72** rows across 24 runs | the full population from `ac1c15ea8` on, not the thirteen runs the referee counted |
| 6 | the `defaultInput=1` cell `1788390729375`, open count console-observed | the fix-round-3 re-run **`1788391499692`** (hop 20.96 ×3), open count persisted | same verdict and spread; the evidence is on the envelope instead of in a console log |
| 7 | "three further runs" on `546b5bfaa`, slope 1.0000 on two | **four** further runs, slope 1.0000 on three | the fourth is `1788391548108`, the re-run above's calibration counterpart |

The rates (22 % and 6 %) and every verdict are unaffected. One nuance (ii) compresses: "one
stream for the whole run" is persisted as `getUserMediaOpens: 1` for `1788391548108`; for the
earlier `1788390783792` it is console-observed, as the ground-truth table below says.

### Method

1. **Probe.** A maximum-length sequence of order 15 (32 767 samples, ≈ 0.68 s at 48 kHz)
   rendered once at the context's rate and played at −12 dBFS; three bursts by default, spaced
   by the sequence length plus a 0.5 s tail. Since `3484e3265` the probe is an injectable
   `LatencyProbe { name, render(sampleRate) }`, with `LatencyProbes.mls(order)` the default —
   the analysis is unchanged by a probe swap, because every probe is located by the same
   correlation-peak search and the same peak-to-mean gate.
2. **Both ends on the context clock.** Each burst is an `AudioBufferSourceNode` started at an
   explicit `AudioContext` time (the first 100 ms after the routine begins); arrival is
   captured by a minimal worklet that reports the context time of its first frame — the same
   contract `RecordingProcessor` gained in #376. Both readings are of the clock takes are
   anchored on.
3. **Analysis in the worker.** The captured buffer goes to the SDK's existing worker —
   structured-cloned, not transferred: `Communicator` transfers only top-level
   `Transfer`-wrapped arguments and the buffer sits inside the protocol's input object, so each
   anchor costs about a megabyte of copy per call at 48 kHz (the design spec said
   "transferred (not copied)"; it is wrong). There each burst's window is cross-correlated with the reference through
   `@opendaw/lib-dsp`'s `FFT`. The peak lag is the delay, refined by three-point parabolic interpolation; the
   peak-to-mean power ratio in dB is the burst's trust figure. The peak is located on the
   correlation's **magnitude**, so a polarity-inverting loopback does not read as no signal.
   The refinement's tested bound is **within 0.25 sample** on a triangular peak — the design
   spec's "within 0.1 sample" was arithmetic that the interpolation does not deliver against a
   linearly interpolated synthetic delay, and it is superseded by 0.25.
4. **Decomposition and verdict.** The probe plays through **`audioContext.destination`
   unconditionally**, never the per-capture monitor output — the route has to be the one whose
   `outputLatency` is subtracted here and added back at placement, or the stored input part
   silently absorbs the difference between the monitor's `<audio>`-element path and the context
   sink and the call still reports `ok`. (Spec §4.2 chose the monitor output when one was set;
   the spec is wrong on this point and the branch fixes it.) `outputLatency` is read only after
   the last burst has played (Chrome reports 0 until audio has actually reached the device);
   `inputLatency = roundTrip − outputLatency`, with the whole round trip taken as the input part
   and
   `outputLatencyReported: false` when the report is missing, zero or non-finite. A burst
   counts as identified at `RatioThresholdDb` = 18 dB. No burst identified is `no-signal`;
   every burst identified with `spreadSeconds` within `SpreadBoundSeconds` = 1.0 ms is `ok`;
   anything between is `noisy`, returned with all its figures. `context-not-running`,
   `no-stream` and `transport-running` are precondition verdicts that never touch audio.
5. **Second capture anchor** (`66021385`). The same emission is captured through two worklets,
   the second opened in the first burst's tail; the result carries
   `roundTripSecondsSecondary`, `captureStartTimes`, `burstDelays` and a `reason`, and the
   verdict becomes `noisy` with reason "capture anchors disagree" when the two round trips
   differ by more than half a render quantum. It exists because of the one-quantum miss below.

The probe and its trust figure follow, cited verbatim in the module doc of
`packages/lib/dsp/src/latency-calibration.ts`:

> Gil Panal, J. M., Richard, G., & David, A. (2025). A Maximum Length Sequence–Based Method for
> Robust Round-Trip Latency Estimation in online Digital Audio Workstations. In Proceedings of
> the Web Audio Conference (WAC 2025). https://doi.org/10.5281/zenodo.17642262
> Reference implementation: https://github.com/gilpanal/weblatencytest (MIT)

Taken from that work: the MLS probe, locating it by the cross-correlation peak, and the
peak-to-mean ratio as the gate. Different here: emission and arrival are both `AudioContext`
clock readings rather than being anchored on `MediaRecorder.start()`. No code is copied.

The harness's own two path notes, both persisted per run: the probe plays out through
`audioContext.destination`, which has no outputs to tap, so the loopback tees destination
connections into its return path for the duration of each call; that tee carries a virtual
output-device leg of `audioContext.outputLatency` seconds, the same term the sweep already adds
back as `harnessPathBiasSec` before judging a take, so the raw round trip and the leg are both
in the artifact and either space can be recomputed offline.

### Ground truth, build by build

`node scripts/audit/recording-alignment/task12b-calibration-tables.ts runs`. Slope and
intercept are recomputed over the `ok` sweep rows; `L` is the applied calibration's input part;
`hop` is the harness's independent `firstQuantumTimeSec − anchorT0Sec` per recorded take.

**SDK `f0c44b06c` — the first build, noise-limited.** No keep-alive sink: a source node left
un-pulled after its first use ratcheted its input delay up by ~45 ms and never recovered, so
the per-call figure moved between calls and the slope could not be resolved on the required
span.

| run | rate | span | slope | intercept | max resid | L | L − median hop | applied-cell medians |
|---|---|---|---|---|---|---|---|---|
| `1788381518785` | 48 k | 0–50 | 0.8831 | 66.317 ms | 5.94 ms | 60.667 | −0.958 | +1.44 / +9.44 / +2.10 |
| `1788381617706` | 44.1 k | 0–50 | 0.9000 (0.8400 as persisted, fitted over all four rows including one `noisy`) | 67.959 ms | 2.20 ms | 62.513 | +0.745 | −0.18 / +5.92 / +0.41 |
| `1788381715449` | 48 k | 0–400 | 0.9905 | 66.127 ms | 3.75 ms | 64.000 | +4.375 | +5.44 / −1.23 / −1.23 |
| `1788381865054` | 48 k | 0–50 | 0.9900 | 63.046 ms | 3.61 ms | 69.333 | +4.375 | −3.90 / −3.23 / −1.90 |
| `1788383812745` | 48 k | 0–400 | 0.9947 | 63.733 ms | 3.20 ms | 70.667 | +7.042 | −3.90 / −0.56 / −5.23 |
| `1788383904062` | 44.1 k | 0–400 | 0.9968 | 63.144 ms | 5.68 ms | 57.275 | −5.446 | +6.60 / +9.48 / +2.36 |
| `1788383382606` | 48 k | 0–50, `armState=fresh` | 0.9289 | 64.344 ms | 2.99 ms | 68.000 | +3.708 | **−55.23** / −2.56 / +1.44 |

Pooled per-call noise over the six runs of the original session (`…827527`, `…023857`,
`…518785`, `…617706`, `…715449`, `…865054`), excluding the two fresh-chain first pulls:
**n = 26, mean 64.014 ms, sd 3.167 ms, range 57.33…69.33 ms**. That noise gives a 1σ slope
uncertainty of **±0.0841** on the required 0–50 ms span and **±0.0095** on 0–400 ms, and a 1σ
intercept uncertainty of **±2.388 ms**. So the design spec's 1.00 ± 0.01 bar is unresolvable on
the required span with this build's path — 0.883, 0.900 and 0.990 are all inside 2σ of 1.00 —
and the three concordant wide-span slopes (0.9905, 0.9947, 0.9968, each ±0.010) are the
defensible figure for it. The intercept bar of 2 ms sits at its own 1σ. **These are disclosed as
first-build data, not as evidence about the routine**: the noise was the un-pulled node's
ratchet sampled at different phases, and the keep-alive sink removed it.

The `armState=fresh` run is the ratchet measured in both directions: the calibration stored
68.000 ms on a chain in the high state, the disarm/re-arm built a chain reading 11.625 ms, and
take 1 landed **55.23 ms early** while takes 2 and 3, on the ratcheted-up chain, landed −2.56 /
+1.44 ms. Applied-cell tail deficits on this build reached 31.62 ms on the calibration page and
34.29 ms on the standing harness (`recaudit-summary-1788381289172`); see finding 2.

**SDK `ac1c15ea8` — the keep-alive sink.** Six runs, both rates, both spans, both arm states:
slope **1.0000** on every one (max residual ≤ 0.003 ms), intercept within **0.30 ms** of the
same chain's harness hop, every applied cell **`aligned`** with head and tail deficits of 0 and
medians identical across the three repeats: +1.44 ms at 48 kHz (`1788384874160`,
`1788385066131`, `1788385236496`), +1.45 ms at 44.1 kHz (`1788385001347`, `1788385315180`) and
+0.87 ms on the one 44.1 kHz fresh run (`1788385161872`). Pooled `input − D` across the 26
sweep rows: mean 21.140 ms, **sd 0.312 ms** — and all of that sd is between chains; each run's
own points agree to ≤ 0.003 ms.

**SDK `3484e3265` — the final code head for the measurement set.** Ten runs, slope 1.0000 on
all ten, max residual 0.0000 ms at 48 kHz and 0.0028 ms at 44.1 kHz, every sweep row `ok`,
3/3 bursts, ratios 45.2–52.9 dB, nothing skipped or excluded.

| run | rate | armState | L | rebuilt-chain hop | L − hop | medians | cell |
|---|---|---|---|---|---|---|---|
| `1788387758809` | 48 k | steady | 20.667 | 20.958 ×3 | −0.291 | +1.44 ×3 | `aligned` |
| `1788387844291` | 44.1 k | steady | 20.949 | 21.247 ×3 | −0.298 | +1.45 ×3 | `aligned` |
| `1788387924745` | 48 k | fresh | 20.667 | **12.292 ×3** | +8.375 | **−7.23 ×3** | `investigate` |
| `1788388011786` | 48 k | fresh | 21.333 | 20.292 ×3 | +1.041 | +0.10 ×3 | `aligned` |
| `1788388441928` | 48 k | fresh | 20.667 | 20.292 ×3 | +0.375 | +0.77 ×3 | `aligned` |
| `1788388530136` | 48 k | fresh | 20.667 | 20.958 ×3 | −0.291 | +1.44 ×3 | `aligned` |
| `1788388610945` | 48 k | fresh | 20.667 | 20.958 ×3 | −0.291 | +1.44 ×3 | `aligned` |
| `1788388693481` | 48 k | fresh | 20.667 | 20.958 ×3 | −0.291 | +1.44 ×3 | `aligned` |
| `1788388770256` | 44.1 k | fresh | 21.606 | 22.268 ×3 | −0.662 | +1.82 ×3 | `aligned` |
| `1788388847147` | 44.1 k | fresh | 21.606 | 21.315 ×3 | +0.291 | +0.87 ×3 | `aligned` |

Head and tail deficits are 0 on all 30 rows. The one `investigate` is the chain-state lottery
of finding 1, not a calibration error: the routine measured the chain it ran on exactly, and
the disarm/re-arm built a different one.

**SDK `546b5bfaa` — chain reuse for an unstamped capture.** Four calibration runs, every cell
`aligned`: `1788389912522` (48 k fresh, slope 1.000000, L 21.333, hop 20.292 ×3, +0.10 ×3),
`1788389998986` (44.1 k fresh, **slope 0.9412** — see the miss below — L 21.606, hop 20.658 ×3,
+0.21 ×3), `1788390783792` and `1788391548108` (48 k steady, `defaultInput=1`, slope 1.000000,
L 20.667, hop 20.958 ×3, +1.44 ×3). The later of the two persists `captureMode: "default"` and
`getUserMediaOpens: 1` — one stream for priming, four sweep points, the applied calibration and
all three takes.

**SDK `66021385` — the second capture anchor.** Four `?repeat=` batches, 122 calls, no sweep
regression (`1788393692168`'s own four-point sweep fits slope 1.000009, intercept 20.949 ms).

### The applied cells, and the residual

After `apply`, the `nominal-start` cell's adjusted medians are identical across the three
repeats of every run from `ac1c15ea8` on, and equal `hop − L + 1.1458 ms` at 48 kHz and
`hop − L + 1.1565 ms` at 44.1 kHz — **exactly, to four decimals, on all 72 rows of the 24
calibration runs from `ac1c15ea8` on**. On the first build the same identity holds on 23 of its
30 rows and fails on seven: `1788381518785` r1 sits 2.667 ms above it, and all three rows of
`1788381715449` and all three of `1788383812745` sit 2.000 ms above it. Those seven are not
explained here; they are first-build rows, taken while the un-pulled-node ratchet was still in
play, and nothing in this campaign re-measures them.

Where the identity holds, that **+1.15 ms is a constant of the harness/SDK pair, not noise**:
it is the same on every repeat and every run, it sits inside the 2 ms `ALIGNED_TOLERANCE_MS`
with 0.85 ms of margin, and it is **unattributed**. Candidates, neither tested: the harness's
click-onset detection latency, or a one-quantum term in the SDK's `firstQuantumTime`
anchoring.

### The chain state: a ratchet, a sink, and a residual two-state lottery

`node scripts/audit/recording-alignment/task12b-calibration-tables.ts chains` pools every
fresh chain instance the `3484e3265` artifacts contain. A recorded take reports the harness's
hop and a calibrated chain reports the routine's own input latency; the two differ by the
harness's constant (+0.29 ms at 48 kHz), far below the ~8 ms step being counted.

| source | 48 kHz chains | low | 44.1 kHz chains | low |
|---|---|---|---|---|
| standing sweep (one chain per recording) | 30 | 9 | 30 | 2 |
| multitrack (one per tape per repeat) | 6 | 1 | — | — |
| calibration, chain built at arm | 7 | 0 | 3 | 0 |
| calibration, chain rebuilt by `armState=fresh` | 6 | 1 | 2 | 0 |
| **pooled** | **49** | **11 (22 %)** | **35** | **2 (6 %)** |

At 48 kHz the low group is 12.292 ms on every instance and the high group spans
20.292–21.625 ms. Every 48 kHz hop sits on a **32-frame lattice** — 590, 974, 1006, 1038
frames, all ≡ 14 mod 32, the 14 being the harness's own constant — so in input-latency terms
the states are 576 / 960 / 992 / 1024 frames = 12.000 / 20.000 / 20.667 / 21.333 ms = 4.5 /
7.5 / 7.75 / 8 render quanta. **Low-to-high is therefore not one number**: 384, 416 or 448
frames (8.000, 8.667 or 9.333 ms = 3, 3.25 or 3.5 quanta) depending on which high member the
chain took; 8.667 ms is only the gap between the two commonest. It is *not* a 480-frame 10 ms
media chunk and not a fixed quantum multiple, and the 32-frame lattice unit is unexplained. At
44.1 kHz there is no lattice (24 distinct hop values over 581–1017 frames, 18 distinct residues
mod 32): a 13.175 ms low against a 20.635–23.061 ms cluster, a 7.5–9.9 ms step.

**When a chain is drawn.** A state is drawn whenever `#rebuildAudioChain` creates a
`MediaStreamAudioSourceNode`, which happens on four triggers:

1. **At arm** — no stream yet, so open and build. One draw per armed capture.
2. **At every explicit disarm/re-arm** — `armed.setValue(false)` runs `#stopStream()`
   unconditionally, whatever the box names, so the re-arm opens and builds. This is
   `?armState=fresh`, on every build.
3. **Before a recording**, only when the open stream is judged changed: a box that names a
   device re-opens iff the named id differs from the id the open track **reports**; a box that
   names none re-opens iff the open stream was itself requested with a named device. Before
   `546b5bfaa` a box naming none always re-opened, since `undefined` never equalled the
   reported id.
4. On a `deviceId` change while armed, on the exact-device fallback retry, and on a
   `requestChannels` change (which rebuilds the chain on the same stream — whether that redraws
   the state is unmeasured).

Per configuration, which is the distinction the campaign's own phrasing kept losing:

| configuration | when the state is drawn |
|---|---|
| standing sweep (box names `loopback-injection`, stream reports an empty id) | **per take**, on every build including `66021385` |
| calibration page (named **and** reported) | **per arm**, on every build since `3484e3265` |
| `defaultInput=1` (box unnamed, request unconstrained) | **per arm on `546b5bfaa`**; per take before it, by the code, not measured |
| **a real device** (names an id the track reports) | **per arm on every build** |

So the per-take rebuild the standing sweep shows is a property of *this harness's* synthetic
device — named but not reported — and never described a real named device. `546b5bfaa` changes
the default-input case only.

### The one-quantum calibration miss, and what the batches say

`node scripts/audit/recording-alignment/task12b-calibration-tables.ts miss`. On run
`1788389998986` (44.1 kHz, `armState=fresh`, SDK `546b5bfaa`) the four sweep points read
`input − D` of 21.6063, 21.6063, 21.6099 and **18.7037 ms**. The short one is
**2.9025 ms = 128.001 frames = exactly one render quantum** below the median of the other
three, and the run's fitted slope is 0.9412 (intercept 22.131 ms, max residual 0.949 ms)
because of it alone.

What makes it a finding rather than noise: **that call's verdict was `ok`.** Its three bursts
agreed to 9e-9 s, its correlation ratio was 48.90 dB, and 3 of 3 bursts were identified, so
neither the SDK's own spread gate nor the harness's `noisy` exclusion could see it. The priming
call before it and the applied call after it both read 21.6062 ms, so the chain did not stay
stepped: either the chain moved one quantum for that one call, or the peak locator landed one
quantum early with all three bursts agreeing. Across the keep-alive era at 44.1 kHz this is
**1 of 29 sweep calls**; the six other runs' 25 calls vary by ≤ 0.0037 ms within their own run
(and that 0.0037 ms is the correlator resolving the half-frame of a 25 ms delay at 44.1 kHz,
1102.5 frames — the refinement working, not an error).

The upstream response was the second capture anchor (`66021385`), which cross-checks the
reported first-frame time against a second worklet opened in burst 1's tail and returns `noisy`
with reason "capture anchors disagree" when the two round trips differ by more than half a
quantum. It is a **guard, not a fix**: no direct fix landed, because no mechanism was found.

`… batches` recomputes the four `?repeat=` batches run to look for the miss on `66021385`:

| run | rate | capture | D (ms) | calls | modal round trip, own delay removed | one-quantum misses | anchors disagreeing | secondary − primary |
|---|---|---|---|---|---|---|---|---|
| `1788392793660` | 44.1 k | default | 0 | 30 | 43.9487 ms (1938 frames) on 30/30 | 0 | 0 | ≤ 0.00025 frames |
| `1788392963167` | 48 k | default | 0 | 30 | 44.3333 ms (2128 frames) on 30/30 | 0 | 0 | ≤ 0.00000 frames |
| `1788393319769` | 44.1 k | named | 50 | 30 | 44.6063 ms (1967 frames) on 30/30 | 0 | 0 | ≤ 0.00051 frames |
| `1788393692168` | 44.1 k | named | 0/10/25/50 cycling | 32 | 43.95 ms (1938 frames) on 32/32 | 0 | 0 | ≤ 0.00063 frames |

**122 calls, 0 one-quantum misses, 0 anchor disagreements**, against 1 in 4 on the run that
showed it. The delay value, the delay changing per call, the sample rate and the capture mode
were all varied without reproducing it; what remains untried is `armState=fresh`, where each
call would run on a chain the disarm/re-arm had just rebuilt. Two consequences to state
plainly: the miss's per-call rate on this configuration is under ~2.5 % at 95 % confidence, and
**the detector's hit rate on a real miss is untested, because no miss occurred**. Two mechanical
observations from the persisted `burstDelays`: node B opens 290–302 render quanta after node A,
in burst 1's tail as designed, and its **first burst delay is null in all 122 calls** — so the
cross-check rests on bursts 2 and 3, and a fault confined to burst 1 would be invisible to it.

### The standing sweep on this build, and the descriptive bands E/F

`node scripts/audit/recording-alignment/task12a-keepalive-classification.ts` re-classifies the
two final-head sweeps through `classifyCell` with the band table its own build selects.

Bands **E** (`random-band` 4–30 ms) and **F** (`constant-late` 10–30 ms) were **fitted to runs
`1788386290685` and `1788386775464`** by rounding those runs' measured range outward to 5 ms.
A cell of those two runs "matching" them therefore states only that the envelope contains its
own source data; it cannot fail unless the rounding was done wrong. Both tallies belong
together and quoting only the second is an overclaim:

- Under the campaign's **predicted** bands A–D — written before their data existed — the 20
  single-tape cells read **8 `matches-known-defect` (B ×4, D ×4) and 12 `investigate`**, the 12
  because this build's `nominal-start`-like signature falls outside the `janked-start` and
  `midtimeline-start` predictions and below band B's spread precondition at 44.1 kHz.
- Under **E/F**, all **20 of 20** fall inside the envelope (E ×10, F ×10 across the rates).
  That is the envelope's construction. Predictive content begins with the first run the bands
  did not come from.

E vs F is not two defects: F means all three chains of a cell landed in the high cluster, E
means at least one landed low, so the split per rate is the per-cell luck of the chain lottery.
The profile is selected by the `buildFeatures` list the harness persists (keyed on
`latencyProbes`, which exists only from `3484e3265`, a descendant of the sink commit), with the
run-token threshold retained only as the documented fallback for envelopes written before the
field. One artifact outside these sweeps moves under the profile and is printed by the script
so the change is visible: **`1788385420462`** (Task 11's single keep-alive `nominal-start`
cell) reads `matches-known-defect/F` (mean 22.33 ms, spread 0.67 ms) where the page persisted
`investigate`.

The provocations no longer differentiate: `janked-start` and `midtimeline-start` produce
`nominal-start`'s hop set and magnitudes, head deficits are 0 everywhere so bands A and C are
unreachable, and the matrix measures one thing five ways. Whether the provocations lost their
grip or the fix removed what they provoked is not decidable from this data. The sweep's value
going forward is as a regression guard on a constant and on head/tail integrity — a tail
deficit, a head deficit, a drift out of 10–30 ms, a third chain state or a lost repeat would
all surface.

### Multitrack on this build

`recaudit-mt-summary-1788387238856`: 12 rows, **3 of 6 repeats lost**, every error
`finalizing: finalization tapeB timed out after 30s` — openDAW#375 unchanged. Of the three
survivors, two show a cross-track skew of −0.00 ms and one shows **−8.000 ms** = 384 frames =
exactly 3 render quanta = the 974-frame high state minus the 590-frame low state, i.e. the two
tapes' chains landing one in each state. With one chain per tape, a cross-track skew of
8.0–9.3 ms at 48 kHz appears whenever exactly one tape's chain lands low, and a per-device
calibration entry cannot remove it, since both tapes read the same loopback device.

**Verdict caveat.** Under the build's profile `multitrack-janked/120` classifies **`aligned`**.
That label is **skew-only**: it means the two tapes agree with each other within tolerance and
neither tape's own cell read `investigate`. Both tapes in that cell were **22.10 ms late**, and
it rests on a single surviving repeat. It must never be quoted as takes landing on the beat.

### Findings, with status

1. **Two-state input delay on a chain left un-pulled — FIXED on the branch.** On `f0c44b06c` a
   `MediaStreamAudioSourceNode` that had been rendered once and was then left un-pulled
   buffered what arrived meanwhile and never drained it: the first pull on a fresh chain read
   13–21 ms and every later pull on that chain read 58–69 ms, permanently. It is a **ratchet,
   not a fill to steady state** — the low first pull after seconds of idle shows the browser
   does not buffer before the first render. The branch's keep-alive sink (`ac1c15ea8`) connects
   the source to a zero-gain node on the destination for the chain's life, so the node is
   rendered from creation and the ratchet never engages; both arm states then measure ~21 ms.
   The mechanism is **inferred from timing, not read from browser source**. A real microphone
   has since been measured (section "Real-device calibration (2026-09-03)"): its chains show
   neither the ~45 ms ratchet nor the loopback's two-state 8–9 ms step.
2. **The stop path truncates input in flight beyond its incidental post-stop margin — OPEN,
   no longer exercised.** `tailMissingMs ≡ hop − postStopCapture` in every row, independent of
   the applied calibration, and it appeared uncalibrated on the same stream (5.6–34.3 ms). The
   SDK's stop path keeps whatever frames were delivered when the stop landed (32–77 ms over
   this build's 30 calibration rows, an artifact of message and quantum latency, not a margin
   sized against input latency); audio still in flight beyond that is lost. Calibration **exposes** this rather than causing it —
   uncalibrated, the missing tail hid under a placement that was ~64 ms late anyway. On the
   keep-alive builds every tail deficit is 0 — on all 120 standing-sweep rows and all 72
   calibration rows — because every hop (12.3–22.3 ms) sits under every margin (24.0–72.6 ms
   over the calibration rows), so the harness can no longer provoke it; any device whose true
   input latency exceeds the margin still would. **Issue candidate**, not yet drafted.
3. **`CaptureAudio.terminate()` never tore the audio chain down — FIXED on the branch
   (`b8e08b97e`).** The terminator disconnected monitoring and detached the monitor element but
   never called `#stopStream()` or `#destroyAudioChain()`, so a terminated capture left the mic
   stream live and the source wired. Pre-existing on `origin/main` in its open-mic form; the
   keep-alive sink converted it from a dormant leak into an active one, because the
   sink→destination edge survived termination and the dead capture's source and gain were
   rendered every quantum for the life of the page. `CaptureDevices` terminates a capture on
   capture-pointer change, unit removal and project close/switch, so a page that switched
   projects stranded one pulled dead chain per armed capture. The whole-branch review ruled this
   the branch's to fix rather than a follow-up, since the branch is what made it render.
   **What the fix does:** the terminator's teardown calls `#stopStream()` in place of the bare
   `#disconnectMonitoring()`, which is the same teardown a disarm runs — disconnect monitoring,
   destroy the audio chain, and stop every track of the open stream. So the chain stops
   rendering **and the microphone is released**: the pre-existing open-mic half of this finding
   is closed by the same line, not left over. A capture terminated mid-recording loses its
   input, which the commit states as the intent — the recording it fed cannot outlive its
   capture — and it is safe: `RecordAudio`'s own terminator wraps its
   `sourceNode.disconnect(recordingWorklet)` in `tryCatch`, so a chain already destroyed does
   not throw on the way out. The commit's test pins both halves: after `terminate()` the output
   node is `Option.None`, the keep-alive sink took a bare disconnect, and the opened track reads
   `stopped`. One residual is untouched — the terminator still does not discard a
   prepared-but-unused `RecordingWorklet`. **Not measured here:** no run in this campaign
   exercises the terminator, so the fix rests on that upstream test, not on anything in
   `.verify-output/`.
4. **`prepareRecording` rebuilt the chain for a capture box carrying no device id — note,
   fixed on the branch.** The reuse test compared `undefined` against the reported id, so it
   never matched and the default-input path rebuilt per recording. `546b5bfaa` compares what
   the box names against what the open stream was *requested* with, remembering the named id in
   memory so clearing a named device back to the default still re-opens; the box is never
   written. One named consequence: an unstamped capture no longer follows a change of OS
   default input mid-arm. On Chrome the requested id is the virtual `"default"` entry, which
   follows the OS itself, so the stream tracks the change anyway; the exposure is browsers whose
   enumeration carries no `"default"` device, and a disarm/re-arm recovers.
5. **The exact 10.000 ms `noisy` spread was one MediaStream chunk.** The single `noisy` row of
   the whole campaign (`1788381617706`, 44.1 kHz, D = 50 ms) had `spreadSeconds` = 0.0099999967 s
   = **440.9999 frames = one 10 ms MediaStream chunk at 44.1 kHz** — not a render quantum
   (128 frames = 2.9 ms), not the fixed `DelayNode`, not the analyzer. One burst of three landed
   exactly one media chunk from the other two. Consistent with the reuse-state buffer sitting at
   capacity, where a 441-frame push against a 128-frame pull periodically cannot fit; named as
   consistent, not proven, since the `Result` did not expose per-burst delays at that build. The
   routine handled it correctly: verdict `noisy`, median unaffected, round trip on the fit line.

### What remains

- **The real-device run — RUN on 2026-09-03**, a laptop microphone and speakers, six runs:
  section "Real-device calibration (2026-09-03)" below. Neither the two chain states nor the
  32-frame lattice appear on it; the one-quantum step does, and holds; the +1.15 ms residual is
  still unmeasured there, since no take is recorded on a real path. Still open from that
  section: a cable loopback, other browsers and devices, and the applied cell on a real path.
- **Finding 2 (stop-path truncation)** as an upstream issue; it is drafted nowhere yet. It is
  the only finding here still open — finding 3 is fixed on the branch, microphone release
  included, leaving one residual too small to file on its own: the terminator does not discard
  a prepared-but-unused `RecordingWorklet`.
- **`armState=fresh` batches** for the one-quantum miss — the one condition of the original
  observation that 122 calls did not vary.
- **The +1.15 ms residual's attribution.**
- **The multitrack collision (#375)**, which still costs 3 of 6 repeats and leaves cross-track
  skew measured on three sessions only.
- **A `?scenario=calibrated` variant of the standing sweep**, which the design spec listed and
  which was not built. It cannot be: the standing sweep runs against the installed release, and
  no release exposes `calibrateInputLatency`, so there is nothing for such a scenario to call.
  What stands in for it is the calibration page's own modes — `?armState`, `?defaultInput=1`
  and `?repeat=` — together with the per-build signature profiles, run against an override
  build after each SDK upgrade. The variant becomes worth building on the release that ships
  the API, at which point the sweep can carry a calibrated arm on the plain server.

### Evidence index (input-latency calibration)

| quantity | artifact(s) |
|---|---|
| first-build ground truth, noise-limited slopes | `calib-summary-1788380827527/…1788381023857/…1788381518785/…1788381617706/…1788381715449/…1788381865054.json` |
| first-build wide spans, fresh-chain −55 ms take | `calib-summary-1788383382606/…1788383812745/…1788383904062/…1788383997913.json` |
| first-build uncalibrated two states, tail deficits | `recaudit-summary-1788381192364.json`, `…1788381289172.json` (reporting on); `…1788381341876/…1788381404900/…1788381808038.json` (off) |
| keep-alive build, six runs | `calib-summary-1788384874160/…1788385001347/…1788385066131/…1788385161872/…1788385236496/…1788385315180.json`; single sweep cell `recaudit-summary-1788385420462.json` |
| final-head standing sweep + multitrack | `recaudit-summary-1788386290685.json` (48 k), `…1788386775464.json` (44.1 k), `recaudit-mt-summary-1788387238856.json` |
| final-head calibration, ten runs | `calib-summary-1788387758809/…1788387844291/…1788387924745/…1788388011786/…1788388441928/…1788388530136/…1788388610945/…1788388693481/…1788388770256/…1788388847147.json` |
| chain-reuse build, four runs + the one-quantum miss | `calib-summary-1788389912522/…1788389998986/…1788390783792/…1788391548108.json` |
| chain-reuse build, alignment cells | `recaudit-summary-1788390078851.json`, `…1788390134814.json`, `…1788390729375.json`, `…1788391499692.json` (the last two `defaultInput=1`) |
| second-anchor batches, 122 calls | `calib-summary-1788392793660/…1788392963167/…1788393319769/…1788393692168.json` |
| real device, six runs (section "Real-device calibration (2026-09-03)") | `calib-summary-1788463872683/…1788463933323/…1788464100870/…1788464254347/…1788464404625/…1788464591756.json` |
| offline recomputation | `.verify-output/task12b-calibration-tables.txt`, `.verify-output/task12a-keepalive-classification.txt`, `.verify-output/task12c-real-input-tables.txt` |

## Real-device calibration (2026-09-03)

The run the section above closes on as unmeasured. The same routine, the same page in its
`?input=real` mode, against a **physical microphone**: the MacBook Pro's built-in microphone
("MacBook Pro Microphone (Built-in)"), fed **acoustically** — the probe plays out of the laptop's
speakers and comes back through the room — in Chrome on macOS, with the calibration branch
served through `SDK_DIST_OVERRIDE` at **`9d0cccb88`**. Six runs: one two-call Playwright smoke
run, then five thirty-call acoustic runs, at 48 and 44.1 kHz, `armState=steady` and `fresh`.
Every call is a direct `calibrateInputLatency({})` on the armed capture and the run ends with
one `{apply: true}`; a `fresh` run disarms and re-arms after call 15, so its second fifteen
calls measure a chain the SDK rebuilt (`chainIndex` 1). No delay is injected and no take is
recorded, so there is no slope and no applied cell here — what a real device can show is
whether the detector hits, how repeatable the answer is, what the browser's own latency figure
is worth, and whether the chain states, the lattice and the one-quantum step of the loopback
appear on a real path.

**The acoustic caveat.** The air path from the speakers to the microphone is inside every
"input part" below — of the order of 1 ms at a laptop's speaker-to-microphone distance — and
so is whatever the room adds; nothing here can separate it from the device's own delay. That
takes a cable loopback through an interface, which was not measured. The figures are therefore
about the routine and about this path, not a datasheet value for the microphone.

**Every figure below was recomputed from the six envelopes** by
`node scripts/audit/recording-alignment/task12c-real-input-tables.ts [runs|chains|events|all]`,
from the per-call fields only — never from the page's persisted `realSummary` or
`repeatSummary`. The one half-quantum state rule and the frame-resolution mode are imported from
`src/lib/audit/realInputSummary.ts`, so the classifications agree with the page's by
construction; the tables are the script's own. Its `all` output is persisted as
`.verify-output/task12c-real-input-tables.txt` (the byte-identity oracle in the scripts README).
Indices below are stated both ways where it matters: "index 10" is 0-based among a run's
repeat calls, "call 11 (1-based)" is the same call.

### The runs

Frames are at the run's context rate; q = one 128-frame render quantum (2.667 ms at 48 kHz,
2.902 ms at 44.1 kHz). The **mode** is the modal round trip at frame resolution over a chain's
usable repeat calls; **spread at mode** is max − min over the calls within half a quantum of
it; **|A−B|** is the two capture anchors' round-trip difference. The applied call is not in the
mode population and is judged against it.

| run | rate | arm | label | calls | verdicts | chain | mode round trip | input part | spread at mode | ratio | \|A−B\| max | applied − mode |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `1788463872683` | 48 k | steady | playwright smoke | 2 | ok ×2 | 0 | 4211.860 fr = 87.747 ms on 2/2 | 64.747 ms | 0.002 fr | 37.6…37.7 dB | 0.002 fr | **−127.998 fr** (−1.000 q), both anchors |
| `1788463933323` | 48 k | steady | acoustic | 30 | ok ×30 | 0 | 3067.259 fr = 63.901 ms on 30/30 | 40.901 ms | 0.019 fr | 34.7…37.3 dB | 0.004 fr | −0.002 fr |
| `1788464100870` | 48 k | fresh | acoustic | 30 | ok ×30 | 0 | 3103.563 fr = 64.658 ms on 15/15 | 41.658 ms | 0.024 fr | 30.5…35.8 dB | 0.005 fr | — |
| | | | | | | 1 | 3093.566 fr = 64.449 ms on 15/15 | 41.449 ms | 0.021 fr | 31.8…36.3 dB | 0.006 fr | −0.004 fr |
| `1788464254347` | 44.1 k | steady | acoustic | 30 | ok ×30 | 0 | 2742.153 fr = 62.180 ms on 30/30 | 39.180 ms | 0.011 fr | 37.1…37.9 dB | 0.002 fr | +0.006 fr |
| `1788464404625` | 44.1 k | fresh | acoustic | 30 | ok ×29, noisy ×1 | 0 | 2656.102 fr = 60.229 ms on 15/15 | 37.229 ms | 0.011 fr | 37.8…38.1 dB | 0.005 fr over 14 agreeing; **127.999 fr on index 10** | — |
| | | | | | | 1 | 2763.587 fr = 62.666 ms on 15/15 | 39.666 ms | 0.017 fr | 35.9…36.2 dB | 0.003 fr | +0.002 fr |
| `1788464591756` | 48 k | steady | acoustic run 2 | 30 | ok ×29, noisy ×1 | 0 | 4264.011 fr = 88.834 ms on **27/30** | 65.834 ms | 0.015 fr (27 calls) | 35.5…38.2 dB | 0.003 fr | **−127.997 fr** (−1.000 q), both anchors |

Over all **152 repeat calls + 6 applied calls: 3 of 3 bursts identified on 158 of 158, ratio
30.55…38.16 dB, input part 37.229…65.834 ms**. `audioContext.outputLatency` read **0.023 s on
every call at both rates** (and 0.023 s at page start, before any audio had played — the
harness's 0-read guard is loopback-only and was not needed). The browser's own
`MediaTrackSettings.latency` for the armed track read **0.002666 s on every run** = 127.968
frames at 48 kHz — the track's own `sampleRate` is 48 000 on the 44.1 kHz runs too, where the
same figure is 117.571 frames at the context rate. Every stored entry equals its run's
applied call.

### Every call off its chain's mode

`… events`. A call is listed when its anchor A or B round trip is at least half a quantum off
its chain's mode. **anchor-disagreement** = |A−B| ≥ ½ q, the SDK's own detector;
**state-transition** = A ≈ B and the next call stays at the new value (or the previous call was
already there — the call holds a state a transition opened); **isolated** = A ≈ B and the next
call is back at the mode. Burst delays are anchor A's three bursts as frames off the mode, then
anchor B's (its first burst is always null: it opens in burst 1's tail).

| run | chain | call | verdict / reason | A − mode | B − mode | \|A−B\| | burst spread | ratio | class | bursts A / B (fr off mode) |
|---|---|---|---|---|---|---|---|---|---|---|
| `1788463872683` 48 k | 0 | applied (after 2 repeats) | ok | −127.998 fr | −127.998 fr | 0.001 fr | 0.003 fr | 36.5 dB | **state-transition** — last call, nothing after it to confirm the hold | −127.994 / −127.998 / −127.999 · null / −127.998 / −127.999 |
| `1788464404625` 44.1 k | 0 | index 10 (call 11, 1-based) | **noisy, "capture anchors disagree"** | −0.008 fr | **−128.008 fr** | **127.999 fr** | 0.001 fr | 37.9 dB | **anchor-disagreement** — A at the mode, B one quantum off | −0.009 / −0.008 / −0.007 · null / −128.008 / −128.007 |
| `1788464591756` 48 k | 0 | index 27 (call 28, 1-based) | **noisy**, no reason | −127.998 fr | −128.001 fr | 0.003 fr | **128.000 fr** | 35.5 dB | **state-transition** — opens the new state; index 28 stays there | **+0.002** / −128.004 / −127.998 · null / −128.004 / −127.998 |
| | 0 | index 28 (call 29) | ok | −128.004 fr | −128.002 fr | 0.002 fr | 0.004 fr | 37.9 dB | holds the state index 27 opened | −128.005 / −128.004 / −128.000 · null / −128.004 / −128.000 |
| | 0 | index 29 (call 30) | ok | −128.002 fr | −128.002 fr | 0.000 fr | 0.003 fr | 38.0 dB | holds | −128.002 / −128.004 / −127.999 · null / −128.004 / −127.999 |
| | 0 | applied | ok | −127.997 fr | −127.997 fr | 0.000 fr | 0.004 fr | 37.8 dB | holds | −128.001 / −127.997 / −127.996 · null / −127.997 / −127.996 |

**6 event calls over 152 repeat + 6 applied calls: 1 anchor disagreement, 2 state
transitions, 0 isolated deviations.** The two `noisy` verdicts are the two mechanisms: the
44.1 kHz one is the second-anchor detector firing (spread 0.001 fr, ratio 37.9 dB — nothing
else about the call is off); the 48 kHz one is the spread gate firing because the chain's step
landed **between burst 1 and burst 2 of that call** — its first burst reads the old state to
+0.002 fr and its last two the new state, so the median moved to the new state and the spread
is exactly one quantum, 128.000 fr = 2.667 ms, over the 1.0 ms `SpreadBoundSeconds`.

### Page loads and re-arms

`… chains`. One page load is one arm and one chain 0; a fresh run's chain 1 is the re-arm
inside the same page. Differences are later minus earlier in run order; "mod 128" is the
residue of the frame difference, so a difference on the quantum lattice reads 0.

| rate | chain instance | how built | mode | input part |
|---|---|---|---|---|
| 48 k | `1788463872683` / 0 | arm at page load | 4211.860 fr = 87.747 ms | 64.747 ms |
| 48 k | `1788463933323` / 0 | arm at page load | 3067.259 fr = 63.901 ms | 40.901 ms |
| 48 k | `1788464100870` / 0 | arm at page load | 3103.563 fr = 64.658 ms | 41.658 ms |
| 48 k | `1788464100870` / 1 | **re-arm, same page** | 3093.566 fr = 64.449 ms | 41.449 ms |
| 48 k | `1788464591756` / 0 | arm at page load | 4264.011 fr = 88.834 ms | 65.834 ms |
| 44.1 k | `1788464254347` / 0 | arm at page load | 2742.153 fr = 62.180 ms | 39.180 ms |
| 44.1 k | `1788464404625` / 0 | arm at page load | 2656.102 fr = 60.229 ms | 37.229 ms |
| 44.1 k | `1788464404625` / 1 | **re-arm, same page** | 2763.587 fr = 62.666 ms | 39.666 ms |

| difference (later − earlier) | frames | ms | quanta | mod 128 | mod 32 |
|---|---|---|---|---|---|
| 48 k re-arm: `…100870`/1 − `…100870`/0 | **−9.996 fr** | −0.208 ms | −0.08 q | 118 | 22.00 |
| 44.1 k re-arm: `…404625`/1 − `…404625`/0 | **+107.485 fr** | +2.437 ms | **+0.84 q** | 107 | 11.48 |
| 48 k page loads: `…591756`/0 − `…933323`/0 | +1196.752 fr | **+24.932 ms** | +9.35 q | 45 | 12.75 |
| 48 k page loads: `…591756`/0 − `…100870`/0 | +1160.448 fr | +24.176 ms | +9.07 q | 8 | 8.45 |
| 48 k page loads: `…933323`/0 − `…872683`/0 | −1144.601 fr | −23.846 ms | −8.94 q | 7 | 7.40 |
| 48 k page loads: `…100870`/0 − `…933323`/0 | +36.303 fr | +0.756 ms | +0.28 q | 36 | 4.30 |
| 48 k page loads: `…591756`/0 − `…872683`/0 | +52.151 fr | +1.086 ms | +0.41 q | 52 | 20.15 |
| 44.1 k page loads: `…404625`/0 − `…254347`/0 | −86.050 fr | −1.951 ms | −0.67 q | 42 | 9.95 |

### Findings, with status

1. **The routine works on a real microphone, acoustically — MEASURED.** Over 152 repeat calls
   and 6 applied calls on the built-in microphone through the room, **every call identified 3 of
   3 bursts at 30.55…38.16 dB** (the loopback's 45–53 dB, less the air path and the room, still
   12 dB and more above the 18 dB gate); 156 verdicts `ok` and **2 `noisy`**, each for a reason
   the tables above state. Within a chain, and within a state, the round trip is **constant to
   ≤ 0.024 frame** (0.5 µs at 48 kHz — the 8 chain instances read spreads at mode of 0.002,
   0.019, 0.024, 0.021, 0.011, 0.011, 0.017 and 0.015 fr), and the two anchors agree to
   ≤ 0.006 fr on every call but the one the detector flagged. Repeatability is therefore not a
   property of the synthetic loopback; it is the routine's.
2. **The browser-reported track latency is nominal, and the `Reported` default underestimates
   this device by 35–63 ms — MEASURED.** `MediaTrackSettings.latency` read **0.002666 s on all
   six runs** — 127.968 frames at 48 kHz, i.e. 128/48000 truncated to six decimals, and the same
   figure at 44.1 kHz where it is 117.571 frames at the context rate — while the measured input
   part on the same track was
   **37.229…65.834 ms**. The difference, **34.563…63.168 ms**, is what #378's `Reported` default
   would place a take late by on this device, and what a calibration entry removes. One device,
   one browser: the size of the gap is this device's, but that the report is a constant of the
   track's own rate and not a measurement is the structural point.
3. **The second-anchor detector's first real hit — MEASURED, 1 in 152 repeat calls.** Run
   `1788464404625` (44.1 kHz, fresh), **index 10 (call 11, 1-based)**, chain 0: anchor A's round
   trip at the chain's mode (−0.008 fr), anchor B's **one quantum below it (−128.008 fr,
   |A−B| = 127.999 fr)**, verdict `noisy` with reason "capture anchors disagree", ratio 37.9 dB,
   burst spread 0.001 fr, 3 of 3 bursts on both anchors. The call before and the call after both
   read the mode with both anchors agreeing, so B's own capture start was the figure a quantum
   off, on that call alone — the fault the detector was built for, on the anchor whose figure is
   not the one reported. The reported round trip was right; the verdict withheld a correct value.
   That is the guard's design: it cannot tell which anchor is off, so it distrusts both. The
   loopback's 122 calls on `66021385` never produced a hit; this run says the detector fires and
   says what it fires on.
4. **The input path itself steps by one render quantum — MEASURED: stepped on 2 of 5 48 kHz
   chains, held through the following calls on one of them (the other stepped on its last
   call); 0 of 3 chains at 44.1 kHz.** Run `1788464591756`: 27 calls at 4264.01 fr, then
   **index 27 (call 28, 1-based)** at **−127.998 fr, both anchors agreeing** (|A−B| 0.003 fr),
   and indices 28, 29 and the applied call all at −128.00 fr with |A−B| ≤ 0.002 fr. The step
   landed inside call 28, between its first and second burst (burst delays +0.002 / −128.004 /
   −127.998 fr off the old mode), which is why that one call is `noisy` on spread and the next
   are `ok`. The smoke run `1788463872683` is the same event with less context: two repeat calls
   at 4211.86 fr, then the applied call at **−127.998 fr, both anchors** — nothing after it to
   confirm the hold. Both steps are **downward** (the path got one quantum shorter), both are on
   chains in the ~64–66 ms state, and the stored entry is in each case the post-step value
   (63.167 ms and 62.080 ms). **Consequence:** a stored calibration is off by one quantum
   (2.667 ms at 48 kHz) from the state the chain held before the step, and stays off until
   recalibrated; and **the anchor check cannot see it by construction** — both anchors capture
   the same chain, and after the step both read the new state. The loopback's one-quantum miss
   (1 of 29 sweep calls on `546b5bfaa`, verdict `ok`) was a chain that did *not* stay stepped;
   this is a chain that did. Mechanism not identified; the count is 2 steps in 5 chains at
   48 kHz (chains of 2, 30, 15, 15 and 30 repeat calls plus one applied call each; the steps on
   the 2-call chain's applied call and the last 30-call chain's call 28) and 0 in 3 at 44.1 kHz
   (30, 15 and 15 calls).
5. **Chain states on a real path: sub-quantum on re-arm, ~24 ms between page loads, not on the
   loopback's lattice — MEASURED.** A disarm/re-arm within one page moved the chain by
   **−9.996 fr = −0.208 ms (48 kHz)** and by **+107.485 fr = +2.437 ms = +0.84 q (44.1 kHz)**.
   Across page loads at 48 kHz the input part landed at **40.901, 41.658 and 65.834 ms** (and
   64.747 ms on the smoke run): two clusters **≈ 24 ms apart** — +1196.752 fr = 24.932 ms =
   9.35 q, and −1144.601 fr = 23.846 ms = 8.94 q — with residues 45 and 7 mod 128 and 12.75 and
   7.40 mod 32, so neither the loopback's 32-frame lattice nor the quantum lattice describes them.
   At 44.1 kHz the two page loads sat 1.951 ms = 0.67 q apart. The loopback's two-state
   8.0–9.3 ms step does not appear on this device; what appears instead is a ~24 ms page-load
   difference of unknown origin (a device buffer configuration drawn per stream open is the
   obvious candidate, untested) and re-arm differences under one quantum. **Consequence for a
   stored calibration:** a value measured on one page load can be ~24 ms wrong on the next, on
   this device, and nothing in the envelope predicts which state a load draws — of the four
   48 kHz loads, two read ~41 ms and two ~65 ms; the two 44.1 kHz loads read 37 and 39 ms.
   Mechanism measured, not identified.
6. **Not measured — OPEN.** A **cable loopback** through an interface, which would take the
   air path and the room out of the input part and put a second device under the same tables.
   **Other browsers** (Safari, Firefox), whose `outputLatency` and track-latency reports differ
   from Chrome's. **Other devices** (a USB interface at another buffer size). **The applied
   take cell on a real path** — take placement was not measured here, because the cell's
   reference clicks and band split assume the loopback tap; whether the +1.15 ms residual holds
   on a real path, and whether a take on this device lands where its calibration says, is
   still unknown. And the mechanisms of findings 4 and 5.

### Evidence index (real device)

| quantity | artifact(s) |
|---|---|
| smoke run, 48 kHz steady, 2 calls, applied call one quantum down | `calib-summary-1788463872683.json` |
| acoustic runs, 48 kHz: steady 30, fresh 30, steady 30 (the one-quantum step at index 27) | `calib-summary-1788463933323/…1788464100870/…1788464591756.json` |
| acoustic runs, 44.1 kHz: steady 30, fresh 30 (the anchor disagreement at index 10) | `calib-summary-1788464254347/…1788464404625.json` |
| offline recomputation | `.verify-output/task12c-real-input-tables.txt` |
