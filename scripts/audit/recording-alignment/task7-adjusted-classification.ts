// Task 7, item 2: offline recompute of adjusted classifications for the existing
// upstream matrix cells, from the already-persisted .verify-output/recaudit-summary-*.json
// files (Task 6's live runs) — NO browser re-runs. Run with
// `node scripts/audit/recording-alignment/task7-adjusted-classification.ts`; the
// register quotes the methodology + results table this script produces.
//
// Methodology: for each of the 20 matrix cells (10 scenario/bpm combos x 2 rates),
// reconstruct the same TakeAlignment[] the live page would have classified with
// (same rows, same take-index filtering for loop-wrap), but with
// medianBeatErrorMsAdjusted = medianBeatErrorMs + outputLatency*1000 (outputLatency
// read from that file's own top-level field where persisted), then call the SAME
// classifyCell/SIGNATURE_BANDS/ALIGNED_TOLERANCE_MS the live page uses. Source file
// per cell mirrors exactly what the register's "Matrix results" tables cite as that
// cell's population (documented inline below) — re-derive "before" too, as a
// self-consistency check against the register's already-published verdicts.

import { classifyCell } from "../../../src/lib/audit/recordingAlignment.ts";
import type { TakeAlignment } from "../../../src/lib/audit/recordingAlignment.ts";
import { ALIGNED_TOLERANCE_MS, signatureBandsFor } from "../../../src/lib/audit/recordingAuditCalibration.ts";
import type { RecordingScenario } from "../../../src/lib/audit/recordingAuditCalibration.ts";
import type { AuditRow } from "../../../src/lib/audit/recordingAuditArtifacts.ts";
import { OUTPUT_LATENCY_BRING_UP_SEC, asClassifiable, cellPopulation, loadSummary } from "./artifacts.ts";

interface CellSource {
  scenario: RecordingScenario;
  bpm: number;
  rate: number;
  runId: string;
  note: string;
}

// Provenance mirrors debug/recording-start-alignment-audit.md's "Matrix results —
// 48000 Hz" / "Matrix results — 44100 Hz" tables exactly (including their stated
// per-cell source-file exceptions for janked-start's fix-round data and loop-wrap's
// split 44.1k/97.3 provenance).
const CELLS: CellSource[] = [
  // 48000 Hz
  { scenario: "nominal-start", bpm: 120, rate: 48000, runId: "1788287951691", note: "orig 48k" },
  { scenario: "nominal-start", bpm: 97.3, rate: 48000, runId: "1788287951691", note: "orig 48k" },
  { scenario: "janked-start", bpm: 120, rate: 48000, runId: "1788290691302", note: "fix-round re-run" },
  { scenario: "janked-start", bpm: 97.3, rate: 48000, runId: "1788290691302", note: "fix-round re-run" },
  { scenario: "midtimeline-start", bpm: 120, rate: 48000, runId: "1788287951691", note: "orig 48k" },
  { scenario: "midtimeline-start", bpm: 97.3, rate: 48000, runId: "1788287951691", note: "orig 48k" },
  { scenario: "countin-start", bpm: 120, rate: 48000, runId: "1788287951691", note: "orig 48k" },
  { scenario: "countin-start", bpm: 97.3, rate: 48000, runId: "1788287951691", note: "orig 48k" },
  { scenario: "loop-wrap", bpm: 120, rate: 48000, runId: "1788287951691", note: "orig 48k" },
  { scenario: "loop-wrap", bpm: 97.3, rate: 48000, runId: "1788287951691", note: "orig 48k" },
  // 44100 Hz
  { scenario: "nominal-start", bpm: 120, rate: 44100, runId: "1788288625777", note: "orig 44.1k" },
  { scenario: "nominal-start", bpm: 97.3, rate: 44100, runId: "1788288625777", note: "orig 44.1k" },
  { scenario: "janked-start", bpm: 120, rate: 44100, runId: "1788290774387", note: "fix-round re-run" },
  { scenario: "janked-start", bpm: 97.3, rate: 44100, runId: "1788290774387", note: "fix-round re-run" },
  { scenario: "midtimeline-start", bpm: 120, rate: 44100, runId: "1788288625777", note: "orig 44.1k" },
  { scenario: "midtimeline-start", bpm: 97.3, rate: 44100, runId: "1788288625777", note: "orig 44.1k" },
  { scenario: "countin-start", bpm: 120, rate: 44100, runId: "1788288625777", note: "orig 44.1k" },
  { scenario: "countin-start", bpm: 97.3, rate: 44100, runId: "1788288625777", note: "orig 44.1k" },
  { scenario: "loop-wrap", bpm: 120, rate: 44100, runId: "1788291706370", note: "fix-round re-run (30s deadline)" },
  { scenario: "loop-wrap", bpm: 97.3, rate: 44100, runId: "1788288625777", note: "orig run (only usable 44.1k/97.3 data point)" },
];

// The live population: every non-error repeat (a repeat with no matched beats
// stays in and forces `investigate`, exactly as it did live), loop-wrap on
// takes 1..4. Tail deficits were measured live but not persisted by these
// generations, so `asClassifiable` reconstructs them as null ("not measured");
// no cell's investigate verdict in the register was attributed to a tail
// deficit, so omitting it cannot silently change a verdict that happened live.
function buildAlignments(rows: AuditRow[], outputLatency: number): TakeAlignment[] {
  return rows.map((r) =>
    asClassifiable(r, r.medianBeatErrorMs === null ? null : r.medianBeatErrorMs + outputLatency * 1000)
  );
}

function buildAlignmentsRawOnly(alignments: TakeAlignment[]): TakeAlignment[] {
  // "before" reconstruction: adjusted == raw (bias 0), to self-check against the
  // register's already-published verdicts before trusting the "after" numbers.
  return alignments.map((a) => ({ ...a, medianBeatErrorMsAdjusted: a.medianBeatErrorMs }));
}

const results: {
  scenario: string; bpm: number; rate: number; note: string;
  beforeStatus: string; afterStatus: string; afterSignature: string | null;
  rawMedians: string; adjustedMedians: string;
}[] = [];

for (const cell of CELLS) {
  const summary = loadSummary(cell.runId);
  // The two ORIGINAL matrix runs (1788287951691, 1788288625777) are generation
  // G2 — they predate outputLatency persistence. The register's bring-up
  // calibration measured 0.023 s at BOTH sample rates, identical on every run
  // that did persist it, so that documented constant stands in for them (never
  // NaN), flagged per cell in the output.
  const outputLatencyUsed = summary.outputLatencySec ?? OUTPUT_LATENCY_BRING_UP_SEC;
  const fallbackUsed = summary.outputLatencySec === null;
  const rows = cellPopulation(summary.rows, cell.scenario, cell.bpm).filter((r) => r.rate === cell.rate);
  const alignments = buildAlignments(rows, outputLatencyUsed);
  if (alignments.length === 0) {
    results.push({
      scenario: cell.scenario, bpm: cell.bpm, rate: cell.rate, note: cell.note,
      beforeStatus: "NO-DATA", afterStatus: "NO-DATA", afterSignature: null,
      rawMedians: "-", adjustedMedians: "-",
    });
    continue;
  }
  const before = classifyCell(buildAlignmentsRawOnly(alignments), signatureBandsFor(cell.scenario, summary.sdkBuildProbe, Number(cell.runId)), ALIGNED_TOLERANCE_MS);
  const after = classifyCell(alignments, signatureBandsFor(cell.scenario, summary.sdkBuildProbe, Number(cell.runId)), ALIGNED_TOLERANCE_MS);
  results.push({
    scenario: cell.scenario, bpm: cell.bpm, rate: cell.rate,
    note: fallbackUsed ? `${cell.note} [${summary.generation}: outputLatency not persisted, bring-up constant ${OUTPUT_LATENCY_BRING_UP_SEC}]` : cell.note,
    beforeStatus: before.status, afterStatus: after.status, afterSignature: after.matchedSignature,
    rawMedians: alignments.map((a) => a.medianBeatErrorMs?.toFixed(1) ?? "null").join(","),
    adjustedMedians: alignments.map((a) => a.medianBeatErrorMsAdjusted?.toFixed(1) ?? "null").join(","),
  });
}

console.log("scenario | bpm | rate | before | after | signature | rawMedians(ms) | adjustedMedians(ms) | source");
for (const r of results) {
  console.log(
    `${r.scenario} | ${r.bpm} | ${r.rate} | ${r.beforeStatus} | ${r.afterStatus} | ${r.afterSignature ?? "-"} | ${r.rawMedians} | ${r.adjustedMedians} | ${r.note}`
  );
}

const changed = results.filter((r) => r.beforeStatus !== r.afterStatus);
console.log(`\n${results.length} cells recomputed, ${changed.length} changed status after adjustment.`);
console.log("Changed cells:", changed.map((r) => `${r.scenario}/${r.bpm}/${r.rate}: ${r.beforeStatus} -> ${r.afterStatus}`).join("\n  "));
