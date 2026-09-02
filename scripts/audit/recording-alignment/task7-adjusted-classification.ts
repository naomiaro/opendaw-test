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
// read from that file's own top-level field, not hard-coded), then call the SAME
// classifyCell/SIGNATURE_BANDS/ALIGNED_TOLERANCE_MS the live page uses. Source file
// per cell mirrors exactly what the register's "Matrix results" tables cite as that
// cell's population (documented inline below) — re-derive "before" too, as a
// self-consistency check against the register's already-published verdicts.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCell } from "../../../src/lib/audit/recordingAlignment.ts";
import type { TakeAlignment } from "../../../src/lib/audit/recordingAlignment.ts";
import { SIGNATURE_BANDS, ALIGNED_TOLERANCE_MS } from "../../../src/lib/audit/recordingAuditCalibration.ts";
import type { RecordingScenario } from "../../../src/lib/audit/recordingAuditCalibration.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFY_OUTPUT = resolve(__dirname, "../../../.verify-output");

interface Row {
  scenario: string;
  bpm: number;
  rate: number;
  repeat: number;
  takeIndex: number;
  medianBeatErrorMs: number | null;
  matchedBeats: number;
  missingBeats: number;
  headMissingMs: number | null;
  status: string;
  errorMessage?: string;
}
interface Summary {
  outputLatency?: number;
  rows: Row[];
}

// The two ORIGINAL matrix run files (1788287951691, 1788288625777) predate the
// outputLatency top-level persistence (Task 6 fix round 1, I3) — they simply don't
// have the field. Register's "Bring-up calibration" measured 0.023s at BOTH sample
// rates, confirmed identical across every run that DID persist it (including this
// script's own read-out below for the other 5 cell-source files) — use that
// documented constant as the fallback for the two files missing the field, rather
// than silently producing NaN. Flagged per-cell in the output (fallbackUsed).
const OUTPUT_LATENCY_FALLBACK_SEC = 0.023;

const fileCache = new Map<string, Summary>();
function loadSummary(file: string): Summary {
  const cached = fileCache.get(file);
  if (cached) return cached;
  const parsed = JSON.parse(readFileSync(resolve(VERIFY_OUTPUT, file), "utf8")) as Summary;
  fileCache.set(file, parsed);
  return parsed;
}

interface CellSource {
  scenario: RecordingScenario;
  bpm: number;
  rate: number;
  file: string;
  note: string;
}

// Provenance mirrors debug/recording-start-alignment-audit.md's "Matrix results —
// 48000 Hz" / "Matrix results — 44100 Hz" tables exactly (including their stated
// per-cell source-file exceptions for janked-start's fix-round data and loop-wrap's
// split 44.1k/97.3 provenance).
const CELLS: CellSource[] = [
  // 48000 Hz
  { scenario: "nominal-start", bpm: 120, rate: 48000, file: "recaudit-summary-1788287951691.json", note: "orig 48k" },
  { scenario: "nominal-start", bpm: 97.3, rate: 48000, file: "recaudit-summary-1788287951691.json", note: "orig 48k" },
  { scenario: "janked-start", bpm: 120, rate: 48000, file: "recaudit-summary-1788290691302.json", note: "fix-round re-run" },
  { scenario: "janked-start", bpm: 97.3, rate: 48000, file: "recaudit-summary-1788290691302.json", note: "fix-round re-run" },
  { scenario: "midtimeline-start", bpm: 120, rate: 48000, file: "recaudit-summary-1788287951691.json", note: "orig 48k" },
  { scenario: "midtimeline-start", bpm: 97.3, rate: 48000, file: "recaudit-summary-1788287951691.json", note: "orig 48k" },
  { scenario: "countin-start", bpm: 120, rate: 48000, file: "recaudit-summary-1788287951691.json", note: "orig 48k" },
  { scenario: "countin-start", bpm: 97.3, rate: 48000, file: "recaudit-summary-1788287951691.json", note: "orig 48k" },
  { scenario: "loop-wrap", bpm: 120, rate: 48000, file: "recaudit-summary-1788287951691.json", note: "orig 48k" },
  { scenario: "loop-wrap", bpm: 97.3, rate: 48000, file: "recaudit-summary-1788287951691.json", note: "orig 48k" },
  // 44100 Hz
  { scenario: "nominal-start", bpm: 120, rate: 44100, file: "recaudit-summary-1788288625777.json", note: "orig 44.1k" },
  { scenario: "nominal-start", bpm: 97.3, rate: 44100, file: "recaudit-summary-1788288625777.json", note: "orig 44.1k" },
  { scenario: "janked-start", bpm: 120, rate: 44100, file: "recaudit-summary-1788290774387.json", note: "fix-round re-run" },
  { scenario: "janked-start", bpm: 97.3, rate: 44100, file: "recaudit-summary-1788290774387.json", note: "fix-round re-run" },
  { scenario: "midtimeline-start", bpm: 120, rate: 44100, file: "recaudit-summary-1788288625777.json", note: "orig 44.1k" },
  { scenario: "midtimeline-start", bpm: 97.3, rate: 44100, file: "recaudit-summary-1788288625777.json", note: "orig 44.1k" },
  { scenario: "countin-start", bpm: 120, rate: 44100, file: "recaudit-summary-1788288625777.json", note: "orig 44.1k" },
  { scenario: "countin-start", bpm: 97.3, rate: 44100, file: "recaudit-summary-1788288625777.json", note: "orig 44.1k" },
  { scenario: "loop-wrap", bpm: 120, rate: 44100, file: "recaudit-summary-1788291706370.json", note: "fix-round re-run (30s deadline)" },
  { scenario: "loop-wrap", bpm: 97.3, rate: 44100, file: "recaudit-summary-1788288625777.json", note: "orig run (only usable 44.1k/97.3 data point)" },
];

function buildAlignments(rows: Row[], outputLatency: number, isLoopWrap: boolean): TakeAlignment[] {
  const usable = rows.filter((r) => r.status !== "error" && !r.errorMessage);
  const filtered = isLoopWrap ? usable.filter((r) => r.takeIndex >= 1 && r.takeIndex <= 4) : usable;
  return filtered.map((r) => ({
    beatErrors: [],
    medianBeatErrorMs: r.medianBeatErrorMs,
    medianBeatErrorMsAdjusted:
      r.medianBeatErrorMs === null ? null : r.medianBeatErrorMs + outputLatency * 1000,
    anchorT0Sec: null,
    firstRefIndex: null,
    headMissingMs: r.headMissingMs,
    tailMissingMs: null, // not persisted per-row; no cell's investigate verdict in the
    // register was attributed to a tail deficit, so omitting it cannot silently change
    // a verdict that actually happened live — see task-7-report.md for the caveat.
    matchedBeats: r.matchedBeats,
    missingBeats: r.missingBeats,
    extraLowOnsets: 0,
  }));
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
  const summary = loadSummary(cell.file);
  const outputLatencyUsed = summary.outputLatency ?? OUTPUT_LATENCY_FALLBACK_SEC;
  const fallbackUsed = summary.outputLatency === undefined;
  const rows = summary.rows.filter(
    (r) => r.scenario === cell.scenario && r.bpm === cell.bpm && r.rate === cell.rate
  );
  const alignments = buildAlignments(rows, outputLatencyUsed, cell.scenario === "loop-wrap");
  if (alignments.length === 0) {
    results.push({
      scenario: cell.scenario, bpm: cell.bpm, rate: cell.rate, note: cell.note,
      beforeStatus: "NO-DATA", afterStatus: "NO-DATA", afterSignature: null,
      rawMedians: "-", adjustedMedians: "-",
    });
    continue;
  }
  const before = classifyCell(buildAlignmentsRawOnly(alignments), SIGNATURE_BANDS[cell.scenario], ALIGNED_TOLERANCE_MS);
  const after = classifyCell(alignments, SIGNATURE_BANDS[cell.scenario], ALIGNED_TOLERANCE_MS);
  results.push({
    scenario: cell.scenario, bpm: cell.bpm, rate: cell.rate,
    note: fallbackUsed ? `${cell.note} [outputLatency fallback=0.023]` : cell.note,
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
