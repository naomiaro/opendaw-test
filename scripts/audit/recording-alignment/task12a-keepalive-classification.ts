/**
 * Task 12a — offline re-classification of the final-head standing sweep.
 *
 * Reads only the persisted `.verify-output/*.json` artifacts and re-runs
 * `classifyCell` over every cell, resolving the band table through
 * `signatureBandsFor(scenario, sdkBuildProbe, runId)` — so each run is judged
 * against the profile of the build it was measured on (see
 * `RECORDING_AUDIT_PROFILES`). It prints both verdicts per cell: the one the
 * live page persisted (computed with whatever profile existed when it ran) and
 * the one the current profiles give, so a change of table is visible rather
 * than silent.
 *
 * Run: `node scripts/audit/recording-alignment/task12a-keepalive-classification.ts`
 */
import {
  classifyCell, classifyMultitrackCell, type CellClassification, type CrossTrackSkew, type TakeAlignment,
} from "../../../src/lib/audit/recordingAlignment.ts";
import {
  ALIGNED_TOLERANCE_MS, LOOP_WRAP_TAKES, MULTITRACK_BASE_SCENARIO,
  RECORDING_AUDIT_BPMS, RECORDING_AUDIT_SCENARIOS, profileKeyFor, signatureBandsFor,
} from "../../../src/lib/audit/recordingAuditCalibration.ts";
import type { AuditRow } from "../../../src/lib/audit/recordingAuditArtifacts.ts";
import { asClassifiable, cellPopulation, loadMultitrackSummary, loadSummary, mean, withMedian } from "./artifacts.ts";

/** The final-head (SDK 3484e3265) standing sweep this task recorded. */
const SWEEPS: Record<number, string> = { 48000: "1788386290685", 44100: "1788386775464" };
const MULTITRACK = "1788387238856";
/**
 * Task 11's single `nominal-start` cell on the keep-alive build. It is not part
 * of this task's sweep, but it is the one OTHER artifact whose verdict the
 * profile moves (`investigate` -> `matches-known-defect/F`), and the task-11
 * re-review quotes the old value, so the change is printed here rather than
 * left to be discovered.
 */
const KEEP_ALIVE_SINGLE_CELL = "1788385420462";

const tally: Record<string, number> = {};
const bump = (status: string) => { tally[status] = (tally[status] ?? 0) + 1; };

console.log("=== Final-head standing sweep, re-classified per build profile ===");
for (const rate of [48000, 44100] as const) {
  const runId = SWEEPS[rate];
  const summary = loadSummary(runId);
  const profile = profileKeyFor(summary.sdkBuildProbe, Number(runId), summary.buildFeatures);
  const features = summary.buildFeatures ? `[${summary.buildFeatures.join(",")}]` : "(none persisted — run-token fallback)";
  console.log(`\nrun ${runId} — rate ${rate}, probe ${summary.sdkBuildProbe}, features ${features}, profile ${profile}, ` +
    `outputLatency ${summary.outputLatencySec ?? "n/a"}, rows ${summary.rows.length}`);
  for (const scenario of RECORDING_AUDIT_SCENARIOS) for (const bpm of RECORDING_AUDIT_BPMS) {
    const pop = cellPopulation(summary.rows, scenario, bpm) as AuditRow[];
    // loop-wrap classifies over its wrap takes only, as the live page does.
    const classified = scenario === "loop-wrap"
      ? pop.filter((r) => r.takeIndex >= 1 && r.takeIndex <= LOOP_WRAP_TAKES - 1)
      : pop;
    const usable = withMedian(classified);
    const persisted = summary.cellVerdicts.find((v) => v.scenario === scenario && v.bpm === bpm);
    if (usable.length === 0) {
      console.log(`  ${scenario}/${bpm}: NO USABLE ROWS (persisted ${persisted?.status ?? "—"})`);
      bump("no-rows");
      continue;
    }
    const repeats: TakeAlignment[] = classified.map((r) => asClassifiable(r));
    const cls = classifyCell(repeats, signatureBandsFor(scenario, summary.sdkBuildProbe, Number(runId), summary.buildFeatures), ALIGNED_TOLERANCE_MS);
    bump(cls.status);
    const medians = usable.map((r) => r.medianBeatErrorMsAdjusted);
    const spread = Math.max(...medians) - Math.min(...medians);
    const changed = persisted && persisted.status !== cls.status ? `  [was ${persisted.status}${persisted.matchedSignature ? "/" + persisted.matchedSignature : ""}]` : "";
    console.log(
      `  ${scenario}/${bpm}: ${cls.status}${cls.matchedSignature ? "/" + cls.matchedSignature : ""}` +
      ` mean=${mean(medians).toFixed(2)}ms spread=${spread.toFixed(2)}ms n=${usable.length}${changed}`
    );
  }
}

console.log("\n=== Multitrack cells, re-classified under the profile ===");
console.log("CAVEAT: an `aligned` multitrack cell means the two tapes agree with EACH OTHER within");
console.log("the tolerance and neither tape's own cell read `investigate`. It says nothing about where");
console.log("the takes landed: both tapes ~22 ms late in the same direction still reads `aligned`,");
console.log("because the quantity this scenario measures is the skew between them.");
const mt = loadMultitrackSummary(MULTITRACK);
const mtProfile = profileKeyFor(mt.sdkBuildProbe, Number(MULTITRACK), mt.buildFeatures);
const mtFeatures = mt.buildFeatures ? `[${mt.buildFeatures.join(",")}]` : "(none persisted — run-token fallback)";
console.log(`run ${MULTITRACK} — rate ${mt.rate}, probe ${mt.sdkBuildProbe}, features ${mtFeatures}, profile ${mtProfile}`);
for (const persisted of mt.cellVerdicts) {
  const rows = mt.rows.filter((r) => r.scenario === persisted.scenario && r.bpm === persisted.bpm && r.status !== "error");
  const base = MULTITRACK_BASE_SCENARIO[persisted.scenario as keyof typeof MULTITRACK_BASE_SCENARIO];
  const bands = signatureBandsFor(base, mt.sdkBuildProbe, Number(MULTITRACK), mt.buildFeatures);
  const tapeRows = (tape: "a" | "b") => rows.filter((r) => r.tape === tape);
  const classifyTape = (tape: "a" | "b"): CellClassification =>
    tapeRows(tape).length > 0
      ? classifyCell(tapeRows(tape).map((r) => asClassifiable(r)), bands, ALIGNED_TOLERANCE_MS)
      : { status: "investigate", matchedSignature: null, detail: `no successful repeats to classify (tape ${tape})` };
  const tapeA = classifyTape("a");
  const tapeB = classifyTape("b");
  // One skew per surviving repeat, as the page pairs them.
  const skews: CrossTrackSkew[] = [...new Set(tapeRows("a").map((r) => r.repeat))].map((repeat) => {
    const row = tapeRows("a").find((r) => r.repeat === repeat)!;
    return { medianSkewMs: row.medianSkewMs, maxAbsSkewMs: row.maxAbsSkewMs, pairedBeats: row.pairedSkewBeats, perBeatSkewMs: [] };
  });
  const verdict = classifyMultitrackCell(tapeA, tapeB, skews, ALIGNED_TOLERANCE_MS);
  const changed = verdict.status !== persisted.status ? `  [page persisted ${persisted.status} under bands A-D]` : "";
  const medians = rows.map((r) => r.medianBeatErrorMsAdjusted).filter((m): m is number => m !== null);
  console.log(
    `  ${persisted.scenario}/${persisted.bpm}: ${verdict.status}` +
    ` tapes ${tapeA.matchedSignature ?? tapeA.status}/${tapeB.matchedSignature ?? tapeB.status}` +
    ` ok=${persisted.successfulRepeats} err=${persisted.errorRepeats}` +
    ` skews=[${skews.map((s) => (s.medianSkewMs === null ? "null" : s.medianSkewMs.toFixed(2))).join(", ")}]` +
    ` tapeMedians=[${medians.map((m) => m.toFixed(2)).join(", ")}] ms${changed}`
  );
  bump(`multitrack-${verdict.status}`);
}

console.log("\n=== Other artifacts whose verdict the profile moves ===");
{
  const summary = loadSummary(KEEP_ALIVE_SINGLE_CELL);
  const profile = profileKeyFor(summary.sdkBuildProbe, Number(KEEP_ALIVE_SINGLE_CELL), summary.buildFeatures);
  for (const persisted of summary.cellVerdicts) {
    const pop = cellPopulation(summary.rows, persisted.scenario, persisted.bpm) as AuditRow[];
    const usable = withMedian(pop);
    if (usable.length === 0) continue;
    const cls = classifyCell(
      pop.map((r) => asClassifiable(r)),
      signatureBandsFor(persisted.scenario, summary.sdkBuildProbe, Number(KEEP_ALIVE_SINGLE_CELL), summary.buildFeatures),
      ALIGNED_TOLERANCE_MS
    );
    const medians = usable.map((r) => r.medianBeatErrorMsAdjusted);
    console.log(
      `  run ${KEEP_ALIVE_SINGLE_CELL} (keep-alive build ac1c15ea8, profile ${profile}) ` +
      `${persisted.scenario}/${persisted.bpm}: ${cls.status}${cls.matchedSignature ? "/" + cls.matchedSignature : ""}` +
      ` mean=${mean(medians).toFixed(2)}ms spread=${(Math.max(...medians) - Math.min(...medians)).toFixed(2)}ms` +
      `  [page persisted ${persisted.status}]`
    );
  }
}

console.log(`\n=== TALLY === ${JSON.stringify(tally)}`);

console.log("\n=== Head/tail integrity across both sweeps ===");
for (const rate of [48000, 44100] as const) {
  const summary = loadSummary(SWEEPS[rate]);
  const heads = summary.rows.map((r) => r.headMissingMs).filter((h): h is number => h !== null && h !== undefined);
  const tails = summary.rows.map((r) => r.tailMissingMs).filter((t): t is number => t !== null && t !== undefined);
  const errors = summary.rows.filter((r) => r.status === "error").length;
  console.log(
    `  rate ${rate}: rows ${summary.rows.length}, error rows ${errors}; ` +
    `headMissingMs > ${ALIGNED_TOLERANCE_MS}: ${heads.filter((h) => h > ALIGNED_TOLERANCE_MS).length}/${heads.length} (max ${Math.max(...heads).toFixed(2)}); ` +
    `tailMissingMs > ${ALIGNED_TOLERANCE_MS}: ${tails.filter((t) => t > ALIGNED_TOLERANCE_MS).length}/${tails.length} (max ${Math.max(...tails).toFixed(2)})`
  );
}
