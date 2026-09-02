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
| `task7-adjusted-classification.ts` | Task 7: the upstream matrix cells re-classified with the harness-path `outputLatency` term netted out |
| `task7c-fix1-replay.ts [scenario]` | Task 7c fix round 1: replays both beat grids (region-anchored and absolute) over every replayable row; provenance-checked (a row is joined to a WAV only when frame count, sample rate and write window match) |
| `task7c-fix1-analysis.ts <enum\|census\|gate\|regress\|correct\|fencepost\|missingrows>` | Task 7c fix round 1: the register's replay, census, gate, regression, correction and fencepost tables (`RECAUDIT_MAX_RUN=<runToken>` bounds the snapshot) |
| `task7c-fix1-verdict.ts` | Task 7c fix round 1: the 20-cell candidate-vs-upstream verdict re-derived on the absolute grid |
| `task8-amendment-recompute.ts` | Task 8: figures for the punch-in head-loss, skew and collision issue drafts |
| `task8-summary-recompute.ts` | Task 8: independent recomputation of every number in the register's outcome summary |
| `task9-branch-verification.ts` | Task 9: before (fresh upstream runs) vs after (reworked branch) per cell, finalization rate, loopback-hop decomposition, multi-mic skew |

History: three earlier Task 7c scripts joined a summary row to a capture WAV by filename
alone, before the harness stamped a run token into WAV names; every run overwrote the
previous run's capture of the same cell, so they silently read one run's geometry against
another run's audio. They were deleted in Task 7c fix round 1 and replaced by the
provenance-checked scripts above.
