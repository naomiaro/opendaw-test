/**
 * Task 8 scope amendments — figures for issue drafts 3, 4 and 5.
 * Reads only .verify-output/*.json.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const V = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.verify-output");
interface Row {
  scenario: string; bpm: number; rate: number; repeat: number; takeIndex: number;
  medianBeatErrorMs: number | null; medianBeatErrorMsAdjusted: number | null;
  matchedBeats: number; missingBeats: number;
  headMissingMs: number | null; headMissingRawMs?: number | null; tailMissingMs?: number | null;
  regionStartSec?: number; waveformOffsetSec?: number; regionPositionPpqn?: number;
  finalizeMs?: number | null; status?: string; errorMessage?: string;
}
const load = (id: string) => {
  const j = JSON.parse(readFileSync(`${V}/recaudit-summary-${id}.json`, "utf8"));
  return { rows: (j.rows ?? []) as Row[], probe: j.sdkBuildProbe, outputLatency: j.outputLatency,
           baseLatency: j.baseLatency, headMissingBaselineMs: j.headMissingBaselineMs, rate: j.rate };
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const phiOf = (r: Row) => { const P = 60 / r.bpm;
  return (r.regionStartSec! / P - Math.floor(r.regionStartSec! / P)) * P * 1000; };
const cellPop = (rows: Row[], s: string, bpm: number) => {
  const l = rows.filter(r => r.scenario === s && r.bpm === bpm && r.medianBeatErrorMsAdjusted !== null);
  return s === "loop-wrap" ? l.filter(r => r.takeIndex >= 1 && r.takeIndex <= 4) : l;
};
const SCEN = ["nominal-start", "countin-start", "janked-start", "midtimeline-start", "loop-wrap"];
const FRESH: Record<number, string> = { 48000: "1788310164556", 44100: "1788310817094" };
const CAND: Record<number, string> = { 48000: "1788299505584", 44100: "1788299943226" };

console.log("=== A. PER-SCENARIO SIGNATURE: fresh upstream vs corrected candidate ===");
for (const s of SCEN) {
  const ups: number[] = [], cand: number[] = [];
  const detail: string[] = [];
  for (const rate of [48000, 44100]) for (const bpm of [120, 97.3]) {
    const u = cellPop(load(FRESH[rate]).rows, s, bpm);
    const c = cellPop(load(CAND[rate]).rows, s, bpm);
    const um = u.length ? mean(u.map(r => r.medianBeatErrorMsAdjusted!)) : null;
    const cm = c.length ? mean(c.map(r => r.medianBeatErrorMsAdjusted! + phiOf(r))) : null;
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
  for (const id of ids) for (const r of [1, 2, 3]) for (const bpm of [120, 97.3]) {
    const takes = load(id).rows.filter(x => x.scenario === "loop-wrap" && x.bpm === bpm && x.repeat === r
      && x.takeIndex >= 1 && x.takeIndex <= 4 && x.medianBeatErrorMsAdjusted !== null);
    if (takes.length < 2) continue;
    const vals = takes.map(x => x.medianBeatErrorMsAdjusted!);
    const sp = Math.max(...vals) - Math.min(...vals);
    spreads.push(sp); maxSpread = Math.max(maxSpread, sp); n++;
    console.log(`    ${label} ${id} bpm=${bpm} r${r}: takes1-4 = [${vals.map(v => v.toFixed(2)).join(", ")}] spread=${sp.toFixed(3)}ms`);
  }
  console.log(`  ${label}: ${n} repeats, max within-repeat spread across takes 1-4 = ${maxSpread.toFixed(3)} ms`);
}

console.log("\n=== C. HEAD LOSS: headMissingRawMs ===");
const allIds = readdirSync(V).filter(f => /^recaudit-summary-\d+\.json$/.test(f)).map(f => f.match(/(\d+)/)![1]).sort();
const byScen: Record<string, number[]> = {};
const byScenBuild: Record<string, number[]> = {};
let withField = 0;
for (const id of allIds) {
  const { rows, probe } = load(id);
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
console.log(`  HEAD_MISSING_BASELINE_MS as persisted: ${[...new Set(allIds.map(i => load(i).headMissingBaselineMs))].join(",")}`);
console.log(`  outputLatency values across all runs: ${[...new Set(allIds.map(i => load(i).outputLatency))].join(",")}`);
console.log(`  baseLatency values across all runs: ${[...new Set(allIds.map(i => load(i).baseLatency))].filter(x => x !== undefined).map(x => Number(x).toFixed(5)).join(",")}`);

console.log("\n=== D. LOOP-WRAP FINALIZATION, per cell ===");
const cellFin = (id: string) => {
  const { rows, rate } = load(id);
  const out: string[] = [];
  for (const bpm of [120, 97.3]) {
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
for (const id of allIds) for (const r of load(id).rows) {
  if (r.scenario === "loop-wrap" && r.status === "error" && r.errorMessage) msgs.add(r.errorMessage);
}
[...msgs].forEach(m => console.log(`    "${m}"`));

console.log("\n=== E. THREE-TERM WORKED EXAMPLE (bring-up nominal row with regionPositionPpqn=5) ===");
for (const id of allIds) {
  for (const r of load(id).rows) {
    if (r.scenario === "nominal-start" && r.regionPositionPpqn === 5 && typeof r.waveformOffsetSec === "number") {
      const ol = load(id).outputLatency ?? 0.023;
      console.log(`    ${id} ${r.scenario}/${r.bpm}/${r.rate} r${r.repeat}: regionPositionPpqn=${r.regionPositionPpqn} regionStartSec=${r.regionStartSec} waveformOffsetSec=${r.waveformOffsetSec?.toFixed(6)} outputLatency=${ol} => headStart=${(r.waveformOffsetSec! - ol).toFixed(6)}s`);
    }
  }
}
