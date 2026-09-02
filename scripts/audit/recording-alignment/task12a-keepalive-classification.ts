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
import { classifyCell, type TakeAlignment } from "../../../src/lib/audit/recordingAlignment.ts";
import {
  ALIGNED_TOLERANCE_MS, LOOP_WRAP_TAKES, RECORDING_AUDIT_BPMS, RECORDING_AUDIT_SCENARIOS,
  profileKeyFor, signatureBandsFor,
} from "../../../src/lib/audit/recordingAuditCalibration.ts";
import type { AuditRow } from "../../../src/lib/audit/recordingAuditArtifacts.ts";
import { asClassifiable, cellPopulation, loadMultitrackSummary, loadSummary, mean, withMedian } from "./artifacts.ts";

/** The final-head (SDK 3484e3265) standing sweep this task recorded. */
const SWEEPS: Record<number, string> = { 48000: "1788386290685", 44100: "1788386775464" };
const MULTITRACK = "1788387238856";

const tally: Record<string, number> = {};
const bump = (status: string) => { tally[status] = (tally[status] ?? 0) + 1; };

console.log("=== Final-head standing sweep, re-classified per build profile ===");
for (const rate of [48000, 44100] as const) {
  const runId = SWEEPS[rate];
  const summary = loadSummary(runId);
  const profile = profileKeyFor(summary.sdkBuildProbe, Number(runId));
  console.log(`\nrun ${runId} — rate ${rate}, probe ${summary.sdkBuildProbe}, profile ${profile}, ` +
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
    const cls = classifyCell(repeats, signatureBandsFor(scenario, summary.sdkBuildProbe, Number(runId)), ALIGNED_TOLERANCE_MS);
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

console.log("\n=== Multitrack cells (verdicts are the page's own; skew has no band) ===");
const mt = loadMultitrackSummary(MULTITRACK);
console.log(`run ${MULTITRACK} — rate ${mt.rate}, probe ${mt.sdkBuildProbe}, profile ${profileKeyFor(mt.sdkBuildProbe, Number(MULTITRACK))}`);
for (const verdict of mt.cellVerdicts) {
  const rows = mt.rows.filter((r) => r.scenario === verdict.scenario && r.bpm === verdict.bpm);
  const skews = rows.map((r) => r.medianSkewMs).filter((s): s is number => s !== null);
  console.log(
    `  ${verdict.scenario}/${verdict.bpm}: ${verdict.status} ok=${verdict.successfulRepeats} err=${verdict.errorRepeats}` +
    ` skews=[${[...new Set(skews)].map((s) => s.toFixed(2)).join(", ")}]`
  );
  bump(`multitrack-${verdict.status}`);
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
