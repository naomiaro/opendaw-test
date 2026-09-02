/**
 * Task 7c fix round 1 — the 20-cell candidate-vs-upstream verdict, re-derived
 * on the absolute beat grid.
 *
 * Candidate side: the two candidate matrix runs, whose persisted medians are
 * region-anchored; each row is corrected to the absolute grid by adding its own
 * `phi = regionStart mod beatPeriod` (the identity NEW = OLD + phi, verified on
 * every row of this session where both grids were computed on the same audio;
 * it holds only for phi < P/2, which `phiCorrectionMs` asserts per row).
 * Upstream side: the two FRESH upstream matrix runs, measured on the absolute
 * grid directly.
 *
 * `classifyCell` is then re-run over the corrected candidate repeats — the
 * same population the live harness classifies (every non-error repeat,
 * including one with no matched beats).
 */
import { classifyCell, type TakeAlignment } from "../../../src/lib/audit/recordingAlignment.ts";
import { RECORDING_AUDIT_BPMS, RECORDING_AUDIT_SCENARIOS, signatureBandsFor } from "../../../src/lib/audit/recordingAuditCalibration.ts";
import { asClassifiable, cellPopulation, loadSummary, mean, phiCorrectionMs, withMedian } from "./artifacts.ts";

const CAND = { 48000: "1788299505584", 44100: "1788299943226" };
const UPS = { 48000: "1788310164556", 44100: "1788310817094" };

console.log("| rate | scenario | bpm | candidate mean (absolute, ms) | upstream mean (absolute, ms) | Δ | candidate cell status (recomputed) |");
console.log("|---|---|---|---|---|---|---|");
let comparable = 0, smaller = 0, matches = 0, skipped = 0, cells = 0;
const missingUpstream: string[] = [];
for (const rate of [48000, 44100] as const) {
  const cand = loadSummary(CAND[rate]);
  const ups = loadSummary(UPS[rate]);
  if (cand.beatGrid !== "region-anchored") throw new Error(`candidate run ${CAND[rate]} is ${cand.beatGrid}; the +phi correction only applies to region-anchored rows`);
  if (ups.beatGrid !== "absolute") throw new Error(`upstream run ${UPS[rate]} is ${ups.beatGrid}; expected absolute-grid rows`);
  for (const scenario of RECORDING_AUDIT_SCENARIOS) {
    for (const bpm of RECORDING_AUDIT_BPMS) {
      cells++;
      const cRows = cellPopulation(cand.rows, scenario, bpm);
      const uRows = cellPopulation(ups.rows, scenario, bpm);
      if (cRows.length === 0) {
        skipped++;
        console.log(`| ${rate} | ${scenario} | ${bpm} | NO CANDIDATE DATA (all repeats errored) | — | — | — |`);
        continue;
      }
      const corrected = (r: (typeof cRows)[number]) =>
        r.medianBeatErrorMsAdjusted === null || r.medianBeatErrorMsAdjusted === undefined ? null : r.medianBeatErrorMsAdjusted + phiCorrectionMs(r);
      const cAbs = mean(withMedian(cRows).map((r) => r.medianBeatErrorMsAdjusted + phiCorrectionMs(r)));
      // classifyCell over the corrected candidate repeats (take 0 for
      // single-take scenarios; loop-wrap classifies its take-1..4 population).
      const repeats: TakeAlignment[] = cRows.map((r) => ({
        ...asClassifiable(r, corrected(r)),
        // The absolute grid removes the region-boundary fencepost: every
        // midtimeline repeat measured missing=1 under the old grid and 0 under
        // the new one (verified live on 12 upstream repeats).
        missingBeats: scenario === "midtimeline-start" ? 0 : r.missingBeats,
      }));
      const cls = classifyCell(repeats, signatureBandsFor(scenario), cand.alignedToleranceMs);
      if (cls.status === "matches-known-defect") matches++;
      if (withMedian(uRows).length === 0) {
        missingUpstream.push(`${rate}/${scenario}/${bpm}`);
        console.log(`| ${rate} | ${scenario} | ${bpm} | ${cAbs.toFixed(2)} | NO UPSTREAM DATA (all repeats errored) | — | ${cls.status}${cls.matchedSignature ? " (" + cls.matchedSignature + ")" : ""} |`);
        continue;
      }
      const uAbs = mean(withMedian(uRows).map((r) => r.medianBeatErrorMsAdjusted));
      const pct = (1 - Math.abs(cAbs) / Math.abs(uAbs)) * 100;
      comparable++;
      if (Math.abs(cAbs) < Math.abs(uAbs)) smaller++;
      console.log(`| ${rate} | ${scenario} | ${bpm} | ${cAbs.toFixed(2)} | ${uAbs.toFixed(2)} | ${pct >= 0 ? pct.toFixed(0) + "% smaller" : (-pct).toFixed(0) + "% LARGER"} | ${cls.status}${cls.matchedSignature ? " (" + cls.matchedSignature + ")" : ""} |`);
    }
  }
}
console.log(`\ncells: ${cells}; candidate cells classified: ${cells - skipped}; skipped (no candidate rows): ${skipped}; comparable cells: ${comparable}; candidate smaller in magnitude: ${smaller}; candidate cells classifying matches-known-defect: ${matches} of ${cells - skipped} classified`);
console.log(`cells with no fresh upstream data: ${missingUpstream.join(", ") || "none"}`);
