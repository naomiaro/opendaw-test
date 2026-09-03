# Recording start-alignment audit — offline analysis scripts

Offline recomputation of the figures in `debug/recording-start-alignment-audit.md` from
the persisted run artifacts in `.verify-output/` (gitignored; produced by
`recording-alignment-audit-debug-demo.html`). Every script runs directly under Node ≥ 23
type stripping, from the repo root:

```
node scripts/audit/recording-alignment/<script>.ts [mode]
```

| script | what it recomputes |
|---|---|
| `artifacts.ts` | Not a script — the ONE loader every script reads `.verify-output/` through (`loadSummary`, `loadSummaries`, `loadMultitrackSummary`, `loadCalibrationSummary`, the `RECAUDIT_MAX_RUN` snapshot bound), plus the shared row → `TakeAlignment` reconstruction (`asClassifiable`), the classifier population (`cellPopulation`: every non-error repeat, loop-wrap takes 1..4, null-median repeats included as live) and the φ helpers (`phiCorrectionMs` asserts φ < P/2 wherever the absolute = region-anchored + φ identity is applied). Row/envelope types and the schema-generation table live in `src/lib/audit/recordingAuditArtifacts.ts` |
| `task7-adjusted-classification.ts` | Task 7: the upstream matrix cells re-classified with the harness-path `outputLatency` term netted out |
| `task7c-fix1-replay.ts [scenario]` | Task 7c fix round 1: replays both beat grids (region-anchored re-implemented; absolute = the shipped `measureTakeAlignment`) over every replayable row; provenance-checked (a row is joined to a WAV only when frame count, sample rate and write window match) |
| `task7c-fix1-analysis.ts <enum\|census\|gate\|regress\|correct\|fencepost\|missingrows\|ppqn>` | Task 7c fix round 1: the register's replay, census, gate, regression, correction, fencepost, missing-row and PPQN-placement tables (`RECAUDIT_MAX_RUN=<runToken>` bounds the snapshot) |
| `task7c-fix1-verdict.ts` | Task 7c fix round 1: the 20-cell candidate-vs-upstream verdict re-derived on the absolute grid |
| `task8-amendment-recompute.ts` | Task 8: figures for the punch-in head-loss, skew and collision issue drafts |
| `task8-summary-recompute.ts` | Task 8: independent recomputation of every number in the register's outcome summary |
| `task12a-keepalive-classification.ts` | The final-head standing sweep and multitrack run re-classified through `classifyCell` / `classifyMultitrackCell` with the band table each artifact's own build selects, printing the page-persisted verdict beside it so a change of table is visible; plus the head/tail integrity tally and the one older artifact whose verdict the per-build profile moves |
| `task12b-calibration-tables.ts [runs\|noise\|chains\|miss\|batches\|all]` | Task 12b: the register's input-latency-calibration tables — the per-build ground truth (least-squares fits recomputed and checked against the page's), the first build's pooled per-call noise and the 1σ slope/intercept it implies, the chain-state census with its frame lattice, the one-quantum calibration miss, and the `?repeat=` batches |
| `task9-branch-verification.ts [cells\|hang\|hop\|mt\|probe\|integrity\|all]` | Task 9: before (fresh upstream runs) vs after (reworked branch) per cell, finalization rate, loopback-hop decomposition, multi-mic skew, per-repeat finalization probe, head/tail integrity. Run ids default to the register's; override with `T9_UP48`/`T9_UP44`/`T9_BR48`/`T9_BR44` (matrix), `T9_MT` (one multi-mic run — the register quotes `…1788325557229` (default) and `…1788329084394`), `T9_MT_UP`, and `T9_PROBE` (comma-separated runs for `probe`) |

## Regression oracle for the scripts themselves

Two scripts have their full output persisted beside the artifacts, in
`.verify-output/task12a-keepalive-classification.txt` and
`.verify-output/task12b-calibration-tables.txt`. `.verify-output/` is gitignored, so
nothing in CI runs this; it is the local byte-for-byte check that a change to a script,
to `artifacts.ts`, or to the shared classifier did not move a figure the register quotes:

```
node scripts/audit/recording-alignment/task12a-keepalive-classification.ts | diff - .verify-output/task12a-keepalive-classification.txt
node scripts/audit/recording-alignment/task12b-calibration-tables.ts all    | diff - .verify-output/task12b-calibration-tables.txt
```

An empty diff is the pass. A change that legitimately moves a line (a new artifact, a
corrected label) re-persists the file with the same command minus the `diff`, and the
commit says which line moved and why.

History: three earlier Task 7c scripts joined a summary row to a capture WAV by filename
alone, before the harness stamped a run token into WAV names; every run overwrote the
previous run's capture of the same cell, so they silently read one run's geometry against
another run's audio. They were deleted in Task 7c fix round 1 and replaced by the
provenance-checked scripts above.
