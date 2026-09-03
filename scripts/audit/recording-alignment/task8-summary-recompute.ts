/**
 * Task 8 — independent recomputation of every number the register's outcome
 * summary and the Task 8 drafts quote. Reads only the persisted
 * `.verify-output/*.json` artifacts. Nothing here trusts the register's prose.
 */
import { classifyCell, type TakeAlignment } from "../../../src/lib/audit/recordingAlignment.ts";
import { RECORDING_AUDIT_BPMS, RECORDING_AUDIT_SCENARIOS, signatureBandsFor } from "../../../src/lib/audit/recordingAuditCalibration.ts";
import type { AuditRow, MultitrackAuditRow } from "../../../src/lib/audit/recordingAuditArtifacts.ts";
import {
  asClassifiable, cellPopulation, listSummaryRunIds, loadMultitrackSummary, loadSummary, mean, phiCorrectionMs, withMedian,
} from "./artifacts.ts";

const SCEN = RECORDING_AUDIT_SCENARIOS;
const BPMS = RECORDING_AUDIT_BPMS;

console.log("=== 1. UPSTREAM 20-CELL TALLY (as-committed per-cell populations) ===");
// Register-stated source per cell (Matrix results 48000/44100 sections).
const UPSTREAM_CELL_SOURCE: Record<string, string> = {
  "48000|nominal-start": "1788287951691", "48000|midtimeline-start": "1788287951691",
  "48000|countin-start": "1788287951691", "48000|loop-wrap": "1788287951691",
  "48000|janked-start": "1788290691302",
  "44100|nominal-start": "1788288625777", "44100|midtimeline-start": "1788288625777",
  "44100|countin-start": "1788288625777",
  "44100|janked-start": "1788290774387",
};
// A cell whose every repeat errored carries no verdict on any row (the harness
// persisted cell verdicts only on successful rows before schema version 2), so
// an empty non-error status set IS the all-error cell — tallied as "error",
// never as a mixed/empty key.
const tally: Record<string, number> = { aligned: 0, "matches-known-defect": 0, investigate: 0, error: 0 };
let cells = 0, noRows = 0;
for (const rate of [48000, 44100]) for (const s of SCEN) for (const bpm of BPMS) {
  let id = UPSTREAM_CELL_SOURCE[`${rate}|${s}`];
  if (s === "loop-wrap" && rate === 44100) id = bpm === 120 ? "1788291706370" : "1788288625777";
  const summary = loadSummary(id);
  const rows = summary.rows.filter(r => r.scenario === s && r.bpm === bpm && r.rate === rate);
  const verdict = summary.cellVerdicts.find(v => v.scenario === s && v.bpm === bpm && v.rate === rate);
  const statuses = [...new Set(rows.map(r => r.status).filter(x => x !== "error"))];
  cells++;
  if (rows.length === 0) noRows++;
  const st = verdict ? verdict.status : rows.length === 0 ? "NO ROWS" : statuses.length === 0 ? "error" : statuses.length === 1 ? statuses[0] : `MIXED:${statuses.join("/")}`;
  tally[st] = (tally[st] ?? 0) + 1;
  console.log(`  ${rate} ${s}/${bpm}  src=${id} rows=${rows.length} status=${st}${verdict ? " (persisted cell verdict)" : ""}`);
}
console.log(`  TALLY cells=${cells} ${JSON.stringify(tally)} (cells with no rows at all: ${noRows})`);

console.log("\n=== 2. FRESH UPSTREAM ABSOLUTE-GRID MATRIX (1788310164556 / 1788310817094) ===");
const FRESH: Record<number, string> = { 48000: "1788310164556", 44100: "1788310817094" };
const freshTally: Record<string, number> = {};
const upsMean: Record<string, number | null> = {};
for (const rate of [48000, 44100]) {
  const f = loadSummary(FRESH[rate]);
  console.log(`  rate ${rate} probe=${f.sdkBuildProbe} grid=${f.beatGrid} rows=${f.rows.length}`);
  for (const s of SCEN) for (const bpm of BPMS) {
    const pop = withMedian(cellPopulation(f.rows, s, bpm));
    const all = f.rows.filter(r => r.scenario === s && r.bpm === bpm);
    const st = [...new Set(all.map(r => r.status))].join("/");
    freshTally[st] = (freshTally[st] ?? 0) + 1;
    upsMean[`${rate}|${s}|${bpm}`] = pop.length ? mean(pop.map(r => r.medianBeatErrorMsAdjusted)) : null;
    console.log(`    ${s}/${bpm} usableRows=${pop.length} status=${st} mean=${pop.length ? mean(pop.map(r => r.medianBeatErrorMsAdjusted)).toFixed(2) : "NO DATA"}`);
  }
}
console.log(`  fresh cell-status tally: ${JSON.stringify(freshTally)}`);

console.log("\n=== 3. CANDIDATE 20 CELLS, CORRECTED TO ABSOLUTE GRID (+phi/row) ===");
const CAND: Record<number, string> = { 48000: "1788299505584", 44100: "1788299943226" };
let mkd = 0, inv = 0, aligned = 0, comparable = 0, smaller = 0, skipped = 0;
const deltas: Record<string, number[]> = {};
for (const rate of [48000, 44100]) {
  const c = loadSummary(CAND[rate]);
  if (c.beatGrid !== "region-anchored") throw new Error(`candidate run ${CAND[rate]} is ${c.beatGrid}; +phi only applies to region-anchored rows`);
  for (const s of SCEN) for (const bpm of BPMS) {
    // The live population: every non-error repeat, null-median ones included
    // (they force `investigate` exactly as they did live); the mean is over the
    // repeats that have a median.
    const pop = cellPopulation(c.rows, s, bpm);
    if (!pop.length) { skipped++; console.log(`    ${rate} ${s}/${bpm}: NO CANDIDATE ROWS (skipped)`); continue; }
    const corrected = (r: AuditRow) => typeof r.medianBeatErrorMsAdjusted === "number" ? r.medianBeatErrorMsAdjusted + phiCorrectionMs(r) : null;
    const cAbs = mean(withMedian(pop).map(r => r.medianBeatErrorMsAdjusted + phiCorrectionMs(r)));
    const repeats: TakeAlignment[] = pop.map(r => ({
      ...asClassifiable(r, corrected(r)),
      missingBeats: s === "midtimeline-start" ? 0 : r.missingBeats,
    }));
    const cls = classifyCell(repeats, signatureBandsFor(s, c.sdkBuildProbe, Number(CAND[rate])), c.alignedToleranceMs);
    if (cls.status === "matches-known-defect") mkd++; else if (cls.status === "aligned") aligned++; else inv++;
    const u = upsMean[`${rate}|${s}|${bpm}`];
    let d = "no upstream data";
    if (u !== null) {
      comparable++;
      const pct = (1 - Math.abs(cAbs) / Math.abs(u)) * 100;
      if (Math.abs(cAbs) < Math.abs(u)) smaller++;
      d = `${pct.toFixed(1)}% smaller`;
      (deltas[s] ??= []).push(pct);
    }
    console.log(`    ${rate} ${s}/${bpm}: cand=${cAbs.toFixed(2)} ups=${u === null ? "—" : u.toFixed(2)} ${d} status=${cls.status}${cls.matchedSignature ? "(" + cls.matchedSignature + ")" : ""}`);
  }
}
console.log(`  candidate cell tally: aligned=${aligned} matches-known-defect=${mkd} investigate=${inv} skipped(no rows)=${skipped} (sum ${aligned + mkd + inv + skipped} of ${2 * SCEN.length * BPMS.length} cells)`);
console.log(`  comparable cells=${comparable}, candidate smaller on ${smaller}/${comparable}`);
const grp = (names: string[]) => {
  const xs = names.flatMap(n => deltas[n] ?? []);
  return `${Math.min(...xs).toFixed(1)}–${Math.max(...xs).toFixed(1)}% (n=${xs.length})`;
};
console.log(`  bias reduction nominal+countin: ${grp(["nominal-start", "countin-start"])}`);
console.log(`  bias reduction janked:          ${grp(["janked-start"])}`);
console.log(`  bias reduction midtimeline:     ${grp(["midtimeline-start"])}`);
console.log(`  bias reduction loop-wrap:       ${grp(["loop-wrap"])}`);

console.log("\n=== 4. LOOP-WRAP FINALIZATION (C2) ===");
const errRepeats = (id: string) => {
  const rows = loadSummary(id).rows.filter(r => r.scenario === "loop-wrap");
  const byRep = new Map<string, AuditRow[]>();
  for (const r of rows) { const k = `${r.rate}|${r.bpm}|${r.repeat}`; const l = byRep.get(k) ?? []; l.push(r); byRep.set(k, l); }
  let fail = 0, ok = 0; const msgs = new Set<string>();
  for (const [, rs] of byRep) {
    if (rs.some(r => r.status === "error")) { fail++; rs.forEach(r => r.errorMessage && msgs.add(r.errorMessage)); } else ok++;
  }
  return { fail, ok, total: byRep.size, msgs: [...msgs] };
};
for (const id of ["1788287951691", "1788288625777", "1788288803959", "1788291343233", "1788291706370"]) {
  const e = errRepeats(id); console.log(`  historical ${id}: ${e.fail}/${e.total} failed  msgs=${JSON.stringify(e.msgs)}`);
}
const hist = ["1788287951691", "1788288625777", "1788288803959", "1788291343233", "1788291706370"].map(errRepeats);
console.log(`  HISTORICAL TOTAL: ${hist.reduce((a, e) => a + e.fail, 0)}/${hist.reduce((a, e) => a + e.total, 0)} failed`);
for (const id of Object.values(FRESH)) { const e = errRepeats(id); console.log(`  fresh upstream ${id}: ${e.fail}/${e.total} failed msgs=${JSON.stringify(e.msgs)}`); }
const fr = Object.values(FRESH).map(errRepeats);
console.log(`  FRESH UPSTREAM TOTAL: ${fr.reduce((a, e) => a + e.fail, 0)}/${fr.reduce((a, e) => a + e.total, 0)} failed`);
for (const id of Object.values(CAND)) { const e = errRepeats(id); console.log(`  candidate ${id}: ${e.fail}/${e.total} failed`); }
const cd = Object.values(CAND).map(errRepeats);
console.log(`  CANDIDATE TOTAL: ${cd.reduce((a, e) => a + e.fail, 0)}/${cd.reduce((a, e) => a + e.total, 0)} failed`);

console.log("\n=== 5. MULTI-MIC (Task 7b) ===");
const MT_OFFICIAL = ["1788302627819", "1788302870379", "1788303391228", "1788303605274"];
let mtAttempts = 0, mtErr = 0;
const skews: { run: string; scen: string; rep: number; rate: number; skew: number; paired: number }[] = [];
const groupRepeats = (rows: MultitrackAuditRow[], key: (r: MultitrackAuditRow) => string) => {
  const reps = new Map<string, MultitrackAuditRow[]>();
  for (const r of rows) { const k = key(r); const l = reps.get(k) ?? []; l.push(r); reps.set(k, l); }
  return reps;
};
for (const id of MT_OFFICIAL) {
  const j = loadMultitrackSummary(id);
  const reps = groupRepeats(j.rows, r => `${r.scenario}|${r.bpm}|${r.repeat}`);
  let e = 0;
  for (const rs of reps.values()) { mtAttempts++; if (rs.some(r => r.status === "error")) { e++; mtErr++; } }
  for (const cs of j.cellSkews) {
    const m = cs.skew.medianSkewMs;
    if (m !== null) {
      skews.push({ run: id, scen: `${cs.scenario}/${cs.bpm}`, rep: cs.repeat, rate: j.rate, skew: m, paired: cs.skew.pairedBeats });
    }
  }
  console.log(`  ${id} (probe ${j.sdkBuildProbe}, rate ${j.rate}): repeats=${reps.size} errored=${e}`);
}
console.log(`  OFFICIAL MATRIX: ${mtErr}/${mtAttempts} repeat attempts lost`);
console.log(`  measurable medianSkewMs values: ${skews.length}`);
const q = (rate: number) => 128 / rate * 1000;
let zero = 0, oneQ = 0, other = 0, overTol = 0;
for (const s of skews) {
  const Q = q(s.rate);
  const isZero = Math.abs(s.skew) < 1e-6;
  const isOneQ = Math.abs(Math.abs(s.skew) - Q) <= 0.02;
  if (isZero) zero++; else if (isOneQ) oneQ++; else other++;
  if (Math.abs(s.skew) > 2) overTol++;
  console.log(`    ${s.run} ${s.scen} r${s.rep} rate=${s.rate} skew=${s.skew.toFixed(6)} quantum=${Q.toFixed(3)} paired=${s.paired} ${isZero ? "ZERO" : isOneQ ? "1xQUANTUM" : "OTHER"}`);
}
console.log(`  zero=${zero} within0.02of1quantum=${oneQ} other=${other} exceeding2ms=${overTol}/${skews.length}`);
const conf = loadMultitrackSummary("1788304987514");
const confReps = groupRepeats(conf.rows, r => `${r.scenario}|${r.repeat}`);
let confFail = 0;
for (const [, rs] of confReps) if (rs.some(r => r.status === "error")) confFail++;
console.log(`  confirmation cell 1788304987514 (confirmCollision=${conf.confirmCollision}, probe ${conf.sdkBuildProbe}, rate ${conf.rate}): ${confFail}/${confReps.size} collided`);

console.log("\n=== 6. MISSING-BEAT / CONTENT-LOSS CENSUS (all recaudit-summary runs) ===");
const allIds = listSummaryRunIds();
let totalRows = 0, everMissing = 0; const missingRows: string[] = [];
for (const id of allIds) {
  for (const r of loadSummary(id).rows) {
    totalRows++;
    if (r.missingBeats > 0) { everMissing++; missingRows.push(`${id} ${r.scenario}/${r.bpm}/${r.rate} r${r.repeat} t${r.takeIndex} m=${r.matchedBeats}/miss=${r.missingBeats}`); }
  }
}
console.log(`  summary runs on disk: ${allIds.length}, total rows: ${totalRows}`);
console.log(`  rows with missingBeats>0 (as persisted, any grid): ${everMissing}`);
missingRows.forEach(m => console.log(`    ${m}`));

console.log("\n=== 7. FRESH UPSTREAM MIDTIMELINE + JANKED (absolute grid) ===");
for (const id of Object.values(FRESH)) {
  const rows = loadSummary(id).rows.filter(r => r.scenario === "midtimeline-start");
  console.log(`  ${id} midtimeline rows=${rows.length} missing>0: ${rows.filter(r => r.missingBeats > 0).length}`);
}
for (const id of ["1788309532177", "1788309644009"]) {
  const s = loadSummary(id);
  console.log(`  ${id} janked rows=${s.rows.length} missing>0: ${s.rows.filter(r => r.missingBeats > 0).length} probe=${s.sdkBuildProbe}`);
}
