/**
 * Task 8 scope amendments — figures for issue drafts 3, 4 and 5.
 * Reads only .verify-output/*.json.
 */
import { RECORDING_AUDIT_BPMS } from "../../../src/lib/audit/recordingAuditCalibration.ts";
import type { AuditRow } from "../../../src/lib/audit/recordingAuditArtifacts.ts";
import {
  OUTPUT_LATENCY_BRING_UP_SEC, cellPopulation, listSummaryRunIds, loadSummary, mean, phiCorrectionMs, withMedian,
} from "./artifacts.ts";

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const SCEN = ["nominal-start", "countin-start", "janked-start", "midtimeline-start", "loop-wrap"];
const FRESH: Record<number, string> = { 48000: "1788310164556", 44100: "1788310817094" };
const CAND: Record<number, string> = { 48000: "1788299505584", 44100: "1788299943226" };

console.log("=== A. PER-SCENARIO SIGNATURE: fresh upstream vs corrected candidate ===");
for (const s of SCEN) {
  const ups: number[] = [], cand: number[] = [];
  const detail: string[] = [];
  for (const rate of [48000, 44100]) for (const bpm of RECORDING_AUDIT_BPMS) {
    // Cell means are over the repeats with a median (a null-median repeat has
    // nothing to average; it still forces `investigate` in the classifiers).
    const u = withMedian(cellPopulation(loadSummary(FRESH[rate]).rows, s, bpm));
    const c = withMedian(cellPopulation(loadSummary(CAND[rate]).rows, s, bpm));
    const um = u.length ? mean(u.map(r => r.medianBeatErrorMsAdjusted)) : null;
    // +phi per row: the region-anchored → absolute identity, asserted per row.
    const cm = c.length ? mean(c.map(r => r.medianBeatErrorMsAdjusted + phiCorrectionMs(r))) : null;
    if (um !== null) ups.push(um);
    if (cm !== null) cand.push(cm);
    detail.push(`      ${rate}/${bpm}: ups=${um === null ? "NO DATA" : um.toFixed(2)} cand=${cm === null ? "—" : cm.toFixed(2)}`);
  }
  console.log(`  ${s}: upstream ${Math.max(...ups).toFixed(2)}..${Math.min(...ups).toFixed(2)} (n=${ups.length}) | candidate ${Math.max(...cand).toFixed(2)}..${Math.min(...cand).toFixed(2)} (n=${cand.length})`);
  detail.forEach(d => console.log(d));
}

console.log("\n=== B. LOOP-WRAP FLATNESS across takeIndex 1-4 (per repeat) ===");
for (const [label, ids] of [["fresh upstream", Object.values(FRESH)], ["candidate", Object.values(CAND)]] as const) {
  let maxSpread = 0; let n = 0; const spreads: number[] = [];
  for (const id of ids) for (const r of [1, 2, 3]) for (const bpm of RECORDING_AUDIT_BPMS) {
    const takes = withMedian(loadSummary(id).rows.filter(x => x.scenario === "loop-wrap" && x.bpm === bpm && x.repeat === r
      && x.takeIndex >= 1 && x.takeIndex <= 4));
    if (takes.length < 2) continue;
    const vals = takes.map(x => x.medianBeatErrorMsAdjusted);
    const sp = Math.max(...vals) - Math.min(...vals);
    spreads.push(sp); maxSpread = Math.max(maxSpread, sp); n++;
    console.log(`    ${label} ${id} bpm=${bpm} r${r}: takes1-4 = [${vals.map(v => v.toFixed(2)).join(", ")}] spread=${sp.toFixed(3)}ms`);
  }
  console.log(`  ${label}: ${n} repeats, max within-repeat spread across takes 1-4 = ${maxSpread.toFixed(3)} ms`);
}

console.log("\n=== C. HEAD LOSS: headMissingRawMs ===");
const allIds = listSummaryRunIds();
const byScen: Record<string, number[]> = {};
const byScenBuild: Record<string, number[]> = {};
let withField = 0;
for (const id of allIds) {
  const { rows, sdkBuildProbe: probe } = loadSummary(id);
  for (const r of rows) {
    if (typeof r.headMissingRawMs !== "number") continue;
    withField++;
    (byScen[r.scenario] ??= []).push(r.headMissingRawMs);
    (byScenBuild[`${r.scenario}|${probe}`] ??= []).push(r.headMissingRawMs);
  }
}
console.log(`  rows carrying headMissingRawMs: ${withField}`);
for (const s of SCEN) {
  const xs = byScen[s] ?? [];
  console.log(`    ${s}: n=${xs.length} min=${Math.min(...xs).toFixed(2)} median=${med(xs).toFixed(2)} max=${Math.max(...xs).toFixed(2)}`);
}
console.log("  midtimeline split by build:");
for (const b of ["upstream", "candidate"]) {
  const xs = byScenBuild[`midtimeline-start|${b}`] ?? [];
  if (!xs.length) continue;
  console.log(`    ${b}: n=${xs.length} min=${Math.min(...xs).toFixed(2)} median=${med(xs).toFixed(2)} max=${Math.max(...xs).toFixed(2)}`);
}
console.log("  all scenarios split by build:");
for (const b of ["upstream", "candidate"]) {
  const xs = SCEN.flatMap(s => byScenBuild[`${s}|${b}`] ?? []);
  console.log(`    ${b}: n=${xs.length} min=${Math.min(...xs).toFixed(2)} median=${med(xs).toFixed(2)} max=${Math.max(...xs).toFixed(2)}`);
}
const persistedOrNot = (x: number | null) => (x === null ? "not persisted" : String(x));
console.log(`  HEAD_MISSING_BASELINE_MS as persisted: ${[...new Set(allIds.map(i => persistedOrNot(loadSummary(i).headMissingBaselineMs)))].join(",")}`);
console.log(`  outputLatency values across all runs: ${[...new Set(allIds.map(i => persistedOrNot(loadSummary(i).outputLatencySec)))].join(",")}`);
console.log(`  baseLatency values across all runs: ${[...new Set(allIds.map(i => loadSummary(i).baseLatencySec))].filter((x): x is number => x !== null).map(x => x.toFixed(5)).join(",")}`);

console.log("\n=== D. LOOP-WRAP FINALIZATION, per cell ===");
const cellFin = (id: string) => {
  const { rows, rate } = loadSummary(id);
  const out: string[] = [];
  for (const bpm of RECORDING_AUDIT_BPMS) {
    let fail = 0, ok = 0; const durs: number[] = [];
    for (const r of [1, 2, 3]) {
      const rs = rows.filter(x => x.scenario === "loop-wrap" && x.bpm === bpm && x.repeat === r);
      if (!rs.length) continue;
      if (rs.some(x => x.status === "error")) fail++;
      else { ok++; rs.forEach(x => { if (typeof x.finalizeMs === "number") durs.push(x.finalizeMs); }); }
    }
    out.push(`    ${id} rate=${rate} bpm=${bpm}: ${fail}/${fail + ok} failed${durs.length ? `, successful finalizeMs ${Math.min(...durs).toFixed(0)}-${Math.max(...durs).toFixed(0)}` : ""}`);
  }
  return out;
};
console.log("  fresh upstream:");
Object.values(FRESH).forEach(id => cellFin(id).forEach(l => console.log(l)));
console.log("  candidate:");
Object.values(CAND).forEach(id => cellFin(id).forEach(l => console.log(l)));
console.log("  90s diagnostic (1788291343233):");
cellFin("1788291343233").forEach(l => console.log(l));
console.log("  errorMessage set on every failing loop-wrap row, all runs:");
const msgs = new Set<string>();
for (const id of allIds) for (const r of loadSummary(id).rows) {
  if (r.scenario === "loop-wrap" && r.status === "error" && r.errorMessage) msgs.add(r.errorMessage);
}
[...msgs].forEach(m => console.log(`    "${m}"`));

console.log("\n=== E. THREE-TERM WORKED EXAMPLE (bring-up nominal row with regionPositionPpqn=5) ===");
for (const id of allIds) {
  const summary = loadSummary(id);
  for (const r of summary.rows as AuditRow[]) {
    if (r.scenario === "nominal-start" && r.regionPositionPpqn === 5 && typeof r.waveformOffsetSec === "number") {
      // G1/G2 runs never persisted outputLatency; the bring-up constant stands in, labelled.
      const ol = summary.outputLatencySec ?? OUTPUT_LATENCY_BRING_UP_SEC;
      const olLabel = summary.outputLatencySec === null ? `${ol} (bring-up constant, not persisted)` : String(ol);
      console.log(`    ${id} ${r.scenario}/${r.bpm}/${r.rate} r${r.repeat}: regionPositionPpqn=${r.regionPositionPpqn} regionStartSec=${r.regionStartSec} waveformOffsetSec=${r.waveformOffsetSec.toFixed(6)} outputLatency=${olLabel} => headStart=${(r.waveformOffsetSec - ol).toFixed(6)}s`);
    }
  }
}
