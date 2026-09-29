/**
 * Task 13 — the multi-mic verdict, replayed offline over saved runs.
 *
 * Reads the persisted `.verify-output/recaudit-mt-summary-<run>.json` envelopes
 * and re-runs each cell the way the page does: each tape through `classifyCell`
 * with the band table and netting its own build selects, then the pair through
 * `classifyMultitrackCell` with the two loopback streams' delays. The replay
 * uses the tolerance and raw skew limit of `recordingAuditCalibration.ts`, not
 * the ones a run was judged with; the header of each run prints the limit the
 * run itself applied, so a verdict that moved can be put down to the rule or
 * to the data. Per cell it prints the replayed verdict, the verdict the page
 * persisted, the raw and netted skew per repeat and the raw skew's spread over
 * render quanta; then the same pooled over all the runs named.
 *
 * All the runs named must share one sample rate: the spread is counted in
 * render quanta, and a quantum is a different time at each rate.
 *
 * Run: `node scripts/audit/recording-alignment/task13-multitrack-netted-verdict.ts [runId …]`
 * Without run ids it replays the register's runs (`REGISTER_RUNS`).
 */
import {
  classifyCell, classifyMultitrackCell, formatSkewDistribution, formatTwoDecimals, nettedSkewMs, skewDistribution,
  type CellClassification, type CrossTrackSkew, type LoopbackDelayPair,
} from "../../../src/lib/audit/recordingAlignment.ts";
import {
  ALIGNED_TOLERANCE_MS, MULTITRACK_BASE_SCENARIO, MULTITRACK_RAW_SKEW_LIMIT_MS, RENDER_QUANTUM_FRAMES,
  auditProfileFor, isMultitrackScenario, profileKeyFor, signatureBandsFor,
} from "../../../src/lib/audit/recordingAuditCalibration.ts";
import { cellPopulation, asClassifiable, loadMultitrackSummary } from "./artifacts.ts";

/** The runs `debug/recording-start-alignment-audit.md` quotes for this verdict, oldest first. */
const REGISTER_RUNS = [
  // Three repeats per cell; the page judged them on the raw skew.
  "1790707818551", "1790710650174", "1790710747979", "1790710801157",
  // Eight repeats per cell; the page judged them on the netted skew.
  "1790711541897", "1790711774452", "1790711921325", "1790712215292", "1790712952262",
];

const runs = process.argv.length > 2 ? process.argv.slice(2) : REGISTER_RUNS;
const summaries = runs.map((runId) => ({ runId, summary: loadMultitrackSummary(runId) }));
const rates = [...new Set(summaries.map((s) => s.summary.rate))];
if (rates.length !== 1) {
  throw new Error(`runs at more than one sample rate (${rates.join(", ")}): replay one rate at a time`);
}
const quantumMs = (RENDER_QUANTUM_FRAMES / rates[0]) * 1000;

const pooledRaw: number[] = [];
const pooledNetted: number[] = [];
const pooledRawOfNetted: number[] = [];
const tally: Record<string, number> = {};
let cells = 0;

console.log(`replayed with tolerance ${ALIGNED_TOLERANCE_MS} ms and raw skew limit ${MULTITRACK_RAW_SKEW_LIMIT_MS} ms`);

for (const { runId, summary } of summaries) {
  const profile = auditProfileFor(summary.sdkBuildProbe, Number(runId), summary.buildFeatures);
  console.log(
    `\nrun ${runId} — rate ${summary.rate}, profile ${profileKeyFor(summary.sdkBuildProbe, Number(runId), summary.buildFeatures)}, ` +
    `rows ${summary.rows.length}, error rows ${summary.rows.filter((r) => r.status === "error").length}, ` +
    `run's own tolerance ${summary.skewToleranceMs} ms, raw skew limit ${summary.rawSkewLimitMs === null ? "none" : `${summary.rawSkewLimitMs} ms`}`
  );
  // The cells are read off the rows: not every saved run carries `cellVerdicts`.
  const cellKeys = [...new Set(summary.rows.map((r) => `${r.scenario}|${r.bpm}`))];
  for (const key of cellKeys) {
    const [scenario, bpmText] = key.split("|");
    const bpm = Number(bpmText);
    if (!isMultitrackScenario(scenario)) throw new Error(`run ${runId}: ${scenario} is not a multitrack scenario`);
    const persisted = summary.cellVerdicts.find((v) => v.scenario === scenario && v.bpm === bpm);
    const rows = cellPopulation(summary.rows, scenario, bpm);
    const errorRows = summary.rows.filter((r) => r.scenario === scenario && r.bpm === bpm && r.status === "error").length;
    const bands = signatureBandsFor(MULTITRACK_BASE_SCENARIO[scenario], summary.sdkBuildProbe, Number(runId), summary.buildFeatures);
    const tapeRows = (tape: "a" | "b") => rows.filter((r) => r.tape === tape);
    const classifyTape = (tape: "a" | "b"): CellClassification =>
      tapeRows(tape).length > 0
        ? classifyCell(tapeRows(tape).map((r) => asClassifiable(r)), bands, ALIGNED_TOLERANCE_MS, { netLoopbackDelay: profile.netLoopbackDelay })
        : { status: "investigate", matchedSignature: null, detail: `no successful repeats to classify (tape ${tape})` };
    // One skew and one delay pair per surviving repeat, as the page pairs them.
    const repeats = [...new Set(rows.map((r) => r.repeat))].sort((x, y) => x - y);
    const skews: CrossTrackSkew[] = [];
    const delays: LoopbackDelayPair[] = [];
    for (const repeat of repeats) {
      const a = tapeRows("a").find((r) => r.repeat === repeat);
      const b = tapeRows("b").find((r) => r.repeat === repeat);
      if (a === undefined || b === undefined) {
        throw new Error(`run ${runId} ${scenario}/${bpm} r${repeat}: tape ${a === undefined ? "a" : "b"} has no row`);
      }
      skews.push({ medianSkewMs: a.medianSkewMs, maxAbsSkewMs: a.maxAbsSkewMs, pairedBeats: a.pairedSkewBeats, perBeatSkewMs: [] });
      delays.push({ aMs: a.loopbackDelayMs ?? null, bMs: b.loopbackDelayMs ?? null });
    }
    const verdict = classifyMultitrackCell(classifyTape("a"), classifyTape("b"), skews, ALIGNED_TOLERANCE_MS, {
      netLoopbackDelay: profile.netLoopbackDelay, loopbackDelays: delays, renderQuantumMs: quantumMs,
      rawSkewLimitMs: MULTITRACK_RAW_SKEW_LIMIT_MS,
    });
    const netted = skews.map((s, index) => (profile.netLoopbackDelay ? nettedSkewMs(s.medianSkewMs, delays[index]) : null));
    skews.forEach((s, index) => {
      if (s.medianSkewMs === null) return;
      pooledRaw.push(s.medianSkewMs);
      const n = netted[index];
      if (n !== null) { pooledNetted.push(n); pooledRawOfNetted.push(s.medianSkewMs); }
    });
    cells++;
    tally[verdict.status] = (tally[verdict.status] ?? 0) + 1;
    const was = persisted === undefined
      ? "page persisted no verdict"
      : `page persisted ${persisted.status}${persisted.status === verdict.status ? "" : " — MOVED"}`;
    console.log(`  ${scenario}/${bpm}: ${verdict.status} ok=${repeats.length} err=${errorRows / 2}  [${was}]`);
    console.log(`    raw    [${skews.map((s) => (s.medianSkewMs === null ? "null" : formatTwoDecimals(s.medianSkewMs))).join(", ")}] ms`);
    console.log(`    netted [${netted.map((n) => (n === null ? "—" : formatTwoDecimals(n))).join(", ")}] ms`);
    console.log(`    quanta ${formatSkewDistribution(skewDistribution(skews.map((s) => s.medianSkewMs), quantumMs))}`);
  }
}

const largest = (values: number[]) => (values.length === 0 ? "none" : `${formatTwoDecimals(Math.max(...values.map(Math.abs)))} ms`);
console.log(`\n=== POOLED over ${runs.length} run(s), ${cells} cell(s) ===`);
console.log(`  cells: ${JSON.stringify(tally)}`);
console.log(`  repeats with a skew: ${pooledRaw.length}, netted: ${pooledNetted.length}`);
console.log(`  raw skew in render quanta: ${formatSkewDistribution(skewDistribution(pooledRaw, quantumMs))}`);
console.log(`  largest netted skew: ${largest(pooledNetted)} (tolerance ${ALIGNED_TOLERANCE_MS} ms)`);
console.log(`  largest raw skew of a netted repeat: ${largest(pooledRawOfNetted)} (limit ${MULTITRACK_RAW_SKEW_LIMIT_MS} ms)`);
