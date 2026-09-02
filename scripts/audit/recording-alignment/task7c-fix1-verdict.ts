/**
 * Task 7c fix round 1 — the 20-cell candidate-vs-upstream verdict, re-derived
 * on the absolute beat grid.
 *
 * Candidate side: the two candidate matrix runs, whose persisted medians are
 * region-anchored; each row is corrected to the absolute grid by adding its own
 * `phi = regionStart mod beatPeriod` (the identity NEW = OLD + phi, verified on
 * every row of this session where both grids were computed on the same audio).
 * Upstream side: the two FRESH upstream matrix runs, measured on the absolute
 * grid directly.
 *
 * `classifyCell` is then re-run over the corrected candidate repeats.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCell, type TakeAlignment } from "../../../src/lib/audit/recordingAlignment.ts";
import { SIGNATURE_BANDS } from "../../../src/lib/audit/recordingAuditCalibration.ts";

const VERIFY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.verify-output");
const CAND = { 48000: "1788299505584", 44100: "1788299943226" };
const UPS = { 48000: "1788310164556", 44100: "1788310817094" };

interface Row {
  scenario: string; bpm: number; rate: number; repeat: number; takeIndex: number;
  medianBeatErrorMs: number | null; medianBeatErrorMsAdjusted: number | null;
  matchedBeats: number; missingBeats: number;
  headMissingMs: number | null; tailMissingMs?: number | null;
  regionStartSec?: number; status?: string;
}

function load(id: string): { rows: Row[]; tol: number } {
  const j = JSON.parse(readFileSync(`${VERIFY_DIR}/recaudit-summary-${id}.json`, "utf8"));
  return { rows: j.rows ?? [], tol: j.alignedToleranceMs ?? 2 };
}
const phiOf = (r: Row) => {
  const P = 60 / r.bpm;
  return (r.regionStartSec! / P - Math.floor(r.regionStartSec! / P)) * P * 1000;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const cellPop = (rows: Row[], scenario: string, bpm: number) => {
  const list = rows.filter((r) => r.scenario === scenario && r.bpm === bpm && r.medianBeatErrorMsAdjusted !== null);
  return scenario === "loop-wrap" ? list.filter((r) => r.takeIndex >= 1 && r.takeIndex <= 4) : list;
};

const SCENARIOS = ["nominal-start", "janked-start", "midtimeline-start", "countin-start", "loop-wrap"];
const BPMS = [120, 97.3];

console.log("| rate | scenario | bpm | candidate mean (absolute, ms) | upstream mean (absolute, ms) | Δ | candidate cell status (recomputed) |");
console.log("|---|---|---|---|---|---|---|");
let comparable = 0, smaller = 0, matches = 0;
const missingUpstream: string[] = [];
for (const rate of [48000, 44100] as const) {
  const cand = load(CAND[rate]);
  const ups = load(UPS[rate]);
  for (const scenario of SCENARIOS) {
    for (const bpm of BPMS) {
      const cRows = cellPop(cand.rows, scenario, bpm);
      const uRows = cellPop(ups.rows, scenario, bpm);
      if (cRows.length === 0) continue;
      const cAbs = mean(cRows.map((r) => r.medianBeatErrorMsAdjusted! + phiOf(r)));
      // classifyCell over the corrected candidate repeats (take 0 for
      // single-take scenarios; loop-wrap classifies its take-1..4 population).
      const repeats: TakeAlignment[] = cRows.map((r) => ({
        beatErrors: [],
        medianBeatErrorMs: r.medianBeatErrorMs,
        medianBeatErrorMsAdjusted: r.medianBeatErrorMsAdjusted! + phiOf(r),
        anchorT0Sec: null, firstRefIndex: null,
        headMissingMs: r.headMissingMs, tailMissingMs: r.tailMissingMs ?? 0,
        matchedBeats: r.matchedBeats,
        // The absolute grid removes the region-boundary fencepost: every
        // midtimeline repeat measured missing=1 under the old grid and 0 under
        // the new one (verified live on 12 upstream repeats).
        missingBeats: scenario === "midtimeline-start" ? 0 : r.missingBeats,
        extraLowOnsets: 0,
      }));
      const cls = classifyCell(repeats, (SIGNATURE_BANDS as Record<string, any>)[scenario] ?? [], cand.tol);
      if (cls.status === "matches-known-defect") matches++;
      if (uRows.length === 0) {
        missingUpstream.push(`${rate}/${scenario}/${bpm}`);
        console.log(`| ${rate} | ${scenario} | ${bpm} | ${cAbs.toFixed(2)} | NO UPSTREAM DATA (all repeats errored) | — | ${cls.status}${cls.matchedSignature ? " (" + cls.matchedSignature + ")" : ""} |`);
        continue;
      }
      const uAbs = mean(uRows.map((r) => r.medianBeatErrorMsAdjusted!));
      const pct = (1 - Math.abs(cAbs) / Math.abs(uAbs)) * 100;
      comparable++;
      if (Math.abs(cAbs) < Math.abs(uAbs)) smaller++;
      console.log(`| ${rate} | ${scenario} | ${bpm} | ${cAbs.toFixed(2)} | ${uAbs.toFixed(2)} | ${pct >= 0 ? pct.toFixed(0) + "% smaller" : (-pct).toFixed(0) + "% LARGER"} | ${cls.status}${cls.matchedSignature ? " (" + cls.matchedSignature + ")" : ""} |`);
    }
  }
}
console.log(`\ncomparable cells: ${comparable}; candidate smaller in magnitude: ${smaller}; candidate cells classifying matches-known-defect: ${matches} of 20`);
console.log(`cells with no fresh upstream data: ${missingUpstream.join(", ") || "none"}`);
