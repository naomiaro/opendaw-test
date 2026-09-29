/**
 * Task 13 — the multi-mic verdict, replayed offline over saved runs.
 *
 * Reads the persisted `.verify-output/recaudit-mt-summary-<run>.json` envelopes
 * and re-runs each cell the way the page does: each tape through `classifyCell`
 * with the band table and netting its own build selects, then the pair through
 * `classifyMultitrackCell` with the two loopback streams' delays. It prints the
 * verdict the page persisted beside the one the classifier gives now, the raw
 * and netted skew per repeat, and the raw skew's spread over render quanta —
 * per cell, and pooled over all the runs named.
 *
 * Run: `node scripts/audit/recording-alignment/task13-multitrack-netted-verdict.ts [runId …]`
 * Without run ids it replays the register's runs (`REGISTER_RUNS`).
 */
import {
  classifyCell, classifyMultitrackCell, formatSkewDistribution, formatTwoDecimals, nettedSkewMs, skewDistribution,
  type CellClassification, type CrossTrackSkew, type LoopbackDelayPair,
} from "../../../src/lib/audit/recordingAlignment.ts";
import {
  ALIGNED_TOLERANCE_MS, MULTITRACK_BASE_SCENARIO, RENDER_QUANTUM_FRAMES, auditProfileFor, profileKeyFor, signatureBandsFor,
} from "../../../src/lib/audit/recordingAuditCalibration.ts";
import { asClassifiable, cellPopulation, loadMultitrackSummary } from "./artifacts.ts";

/** The runs `debug/recording-start-alignment-audit.md` quotes for this verdict, oldest first. */
const REGISTER_RUNS = [
  // Three repeats per cell, judged on the raw skew when they ran.
  "1790707818551", "1790710650174", "1790710747979", "1790710801157",
  // Eight repeats per cell, judged on the netted skew.
  "1790711541897", "1790711774452", "1790711921325", "1790712215292",
];

const runs = process.argv.length > 2 ? process.argv.slice(2) : REGISTER_RUNS;
const pooledRaw: (number | null)[] = [];
const pooledNetted: number[] = [];
const tally: Record<string, number> = {};
let quantumMs = 0;

for (const runId of runs) {
  const summary = loadMultitrackSummary(runId);
  const profile = auditProfileFor(summary.sdkBuildProbe, Number(runId), summary.buildFeatures);
  quantumMs = (RENDER_QUANTUM_FRAMES / summary.rate) * 1000;
  console.log(
    `\nrun ${runId} — rate ${summary.rate}, profile ${profileKeyFor(summary.sdkBuildProbe, Number(runId), summary.buildFeatures)}, ` +
    `rows ${summary.rows.length}, error rows ${summary.rows.filter((r) => r.status === "error").length}`
  );
  for (const persisted of summary.cellVerdicts) {
    const rows = cellPopulation(summary.rows, persisted.scenario, persisted.bpm);
    const base = MULTITRACK_BASE_SCENARIO[persisted.scenario as keyof typeof MULTITRACK_BASE_SCENARIO];
    const bands = signatureBandsFor(base, summary.sdkBuildProbe, Number(runId), summary.buildFeatures);
    const tapeRows = (tape: "a" | "b") => rows.filter((r) => r.tape === tape);
    const classifyTape = (tape: "a" | "b"): CellClassification =>
      tapeRows(tape).length > 0
        ? classifyCell(tapeRows(tape).map((r) => asClassifiable(r)), bands, ALIGNED_TOLERANCE_MS, { netLoopbackDelay: profile.netLoopbackDelay })
        : { status: "investigate", matchedSignature: null, detail: `no successful repeats to classify (tape ${tape})` };
    // One skew and one delay pair per surviving repeat, as the page pairs them.
    const repeats = [...new Set(tapeRows("a").map((r) => r.repeat))];
    const skews: CrossTrackSkew[] = [];
    const delays: LoopbackDelayPair[] = [];
    for (const repeat of repeats) {
      const a = tapeRows("a").find((r) => r.repeat === repeat)!;
      const b = tapeRows("b").find((r) => r.repeat === repeat);
      skews.push({ medianSkewMs: a.medianSkewMs, maxAbsSkewMs: a.maxAbsSkewMs, pairedBeats: a.pairedSkewBeats, perBeatSkewMs: [] });
      delays.push({ aMs: a.loopbackDelayMs ?? null, bMs: b?.loopbackDelayMs ?? null });
    }
    const verdict = classifyMultitrackCell(classifyTape("a"), classifyTape("b"), skews, ALIGNED_TOLERANCE_MS, {
      netLoopbackDelay: profile.netLoopbackDelay, loopbackDelays: delays, renderQuantumMs: quantumMs,
    });
    const netted = skews.map((s, index) => (profile.netLoopbackDelay ? nettedSkewMs(s.medianSkewMs, delays[index]) : null));
    pooledRaw.push(...skews.map((s) => s.medianSkewMs));
    pooledNetted.push(...netted.filter((n): n is number => n !== null));
    tally[verdict.status] = (tally[verdict.status] ?? 0) + 1;
    const moved = verdict.status !== persisted.status ? `  [page persisted ${persisted.status}]` : "";
    console.log(`  ${persisted.scenario}/${persisted.bpm}: ${verdict.status} ok=${persisted.successfulRepeats} err=${persisted.errorRepeats}${moved}`);
    console.log(`    raw    [${skews.map((s) => (s.medianSkewMs === null ? "null" : formatTwoDecimals(s.medianSkewMs))).join(", ")}] ms`);
    console.log(`    netted [${netted.map((n) => (n === null ? "null" : formatTwoDecimals(n))).join(", ")}] ms`);
    console.log(`    quanta ${formatSkewDistribution(skewDistribution(skews.map((s) => s.medianSkewMs), quantumMs))}`);
  }
}

console.log(`\n=== POOLED over ${runs.length} run(s) ===`);
console.log(`  cells: ${JSON.stringify(tally)}`);
console.log(`  repeats: ${pooledRaw.length}, netted on ${pooledNetted.length}`);
console.log(`  raw skew in render quanta: ${formatSkewDistribution(skewDistribution(pooledRaw, quantumMs))}`);
if (pooledNetted.length > 0) {
  console.log(`  largest netted skew: ${formatTwoDecimals(Math.max(...pooledNetted.map(Math.abs)))} ms (tolerance ${ALIGNED_TOLERANCE_MS} ms)`);
}
