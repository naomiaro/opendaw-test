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
| `task12c-real-input-tables.ts [runs\|chains\|events\|all]` | Task 12c: the register's real-device calibration tables — the six `?input=real` envelopes (a MacBook Pro built-in microphone, acoustic path) per run and per chain (modal round trip and input part at frame resolution, within-chain spread, ratio range, bursts, largest anchor disagreement, where the applied call sat), the page-load table of every chain instance's mode with pairwise differences in frames / ms / quanta, and the event table classifying every call ≥ ½ quantum off its chain's mode as `anchor-disagreement`, `state-transition` or `isolated`. The state rule and the frame-resolution mode are imported from `src/lib/audit/realInputSummary.ts`; nothing is read from the persisted `realSummary`, and the script deliberately RE-DERIVES the event classification rather than calling `summarizeRealInput`, so a divergence between what the page persists and what the register says is caught by the local byte-identity diff below, and only there |
| `task13-multitrack-netted-verdict.ts [runId …]` | The multi-mic verdict replayed over saved `recaudit-mt-summary` envelopes the way the page computes it: each tape through `classifyCell`, the pair through `classifyMultitrackCell` with the two loopback streams' delays, under the tolerance and raw skew limit of `recordingAuditCalibration.ts`. Per run it prints the limit the run itself applied; per cell the replayed verdict, the verdict the page persisted (marked when the two differ), the raw and netted skew per repeat and the raw skew's spread over render quanta; then the same pooled over all the runs named. The runs named must share one sample rate. Without run ids it replays the runs the register quotes. A run whose envelope carries an `anchorOffsetMs` had node taps and a verdict that read them: its repeats are replayed with the node delays of its rows and the offset the run applied, and the node delays, what they leave of the raw skew and the first-frame check are printed per repeat. A run without is replayed as it ran |
| `task9-branch-verification.ts [cells\|hang\|hop\|mt\|probe\|integrity\|all]` | Task 9: before (fresh upstream runs) vs after (reworked branch) per cell, finalization rate, loopback-hop decomposition, multi-mic skew, per-repeat finalization probe, head/tail integrity. Run ids default to the register's; override with `T9_UP48`/`T9_UP44`/`T9_BR48`/`T9_BR44` (matrix), `T9_MT` (one multi-mic run — the register quotes `…1788325557229` (default) and `…1788329084394`), `T9_MT_UP`, and `T9_PROBE` (comma-separated runs for `probe`) |

## Browser-side probes (`stream-tap/`)

These run in the browser, not under Node. They measure the delay of a
`MediaStreamAudioSourceNode` on the context clock, with nothing of the SDK's in the
figure. The `*.playwright.js` files are passed to the Playwright MCP's tool that runs a
code snippet against the page (dev server on `https://localhost:5173`); the two `run-*`
files fetch the page-side script through the dev server's `?raw`, so the text that runs
is the text in the repo. Artifacts land in `.verify-output/`.

| file | what it does |
|---|---|
| `two-tap-spike.page.js` + `run-two-tap-spike.playwright.js` | No SDK. One `MediaStreamAudioDestinationNode` fed with noise, several source nodes and recorders on clones of its stream, every render quantum stamped with `currentFrame`. Variants `together`, `staggered`, `lateCreate` (two nodes per clone) and `sameNode` (two recorders on one node). One variant per call, set in `cfg`. Writes `spike-two-tap-<rate>-<variant>-<time>.json` |
| `two-tap-spike.read.cjs` | Tabulates every `spike-two-tap-*.json`: exactness of the match, skipped quanta, delays and their lattice, how often two nodes on one clone, two nodes on two clones and two recorders on one node agree |
| `node-tap.init.js` + `run-multitrack-node-tap.playwright.js` + `read-node-tap.playwright.js` | The standing multi-mic run with a probe injected before the page's scripts: it records what goes into the loopback's destination node, and attaches a recorder to each source node the SDK builds, 150 ms after the SDK connects that chain to its recording worklet. Writes `node-tap-<time>.json` beside the run's own `recaudit-mt-summary` |
| `harness-node-delays.read.cjs <run id>[:<node-tap time>] …` | What the multi-mic page's OWN node taps read, run by run and pooled per sample rate: how many rows have a node delay and why the others do not, `loopbackDelayMs` against the node's delay in frames, `firstFrameCheckMs`, what the two nodes' delays leave of the raw skew. With a node-tap time after the colon it also compares the page's figure with the external probe's, row by row |
| `node-tap.read.cjs <node-tap json> <recaudit-mt-summary json>` | Joins the probe's taps to the run's rows (by tape, and by the SDK connection that precedes the row's first-frame time) and prints, per row, `loopbackDelayMs` against the node's delay, and per repeat, the raw skew against the difference of the two nodes' delays |

The register's figures are persisted in `.verify-output/two-tap-spike-tables.txt`,
`.verify-output/node-tap-tables.txt`, `.verify-output/harness-node-delays.txt` and
`.verify-output/harness-node-delays-after-review.txt`; the replay of the runs that carry
node delays in `.verify-output/task13-node-delay-runs-48000.txt` and `…-44100.txt`.

## Regression oracle for the scripts themselves

Four scripts have their full output persisted beside the artifacts, in
`.verify-output/task12a-keepalive-classification.txt`,
`.verify-output/task12b-calibration-tables.txt`,
`.verify-output/task12c-real-input-tables.txt` and
`.verify-output/task13-multitrack-netted-verdict.txt`. `.verify-output/` is gitignored, so
nothing in CI runs this; it is the local byte-for-byte check that a change to a script,
to `artifacts.ts`, or to the shared classifier did not move a figure the register quotes:

```
node scripts/audit/recording-alignment/task12a-keepalive-classification.ts | diff - .verify-output/task12a-keepalive-classification.txt
node scripts/audit/recording-alignment/task12b-calibration-tables.ts all    | diff - .verify-output/task12b-calibration-tables.txt
node scripts/audit/recording-alignment/task12c-real-input-tables.ts all     | diff - .verify-output/task12c-real-input-tables.txt
node scripts/audit/recording-alignment/task13-multitrack-netted-verdict.ts  | diff - .verify-output/task13-multitrack-netted-verdict.txt
```

An empty diff is the pass. A change that legitimately moves a line (a new artifact, a
corrected label) re-persists the file with the same command minus the `diff`, and the
commit says which line moved and why.

History: three earlier Task 7c scripts joined a summary row to a capture WAV by filename
alone, before the harness stamped a run token into WAV names; every run overwrote the
previous run's capture of the same cell, so they silently read one run's geometry against
another run's audio. They were deleted in Task 7c fix round 1 and replaced by the
provenance-checked scripts above.
