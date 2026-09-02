/**
 * The one loader every script in this directory reads `.verify-output/` through.
 * Type and generation semantics live in `src/lib/audit/recordingAuditArtifacts.ts`
 * (pure, tested); this file adds the filesystem, the snapshot bound and the
 * row → `TakeAlignment` reconstruction the offline classifiers share.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TakeAlignment } from "../../../src/lib/audit/recordingAlignment.ts";
import {
  parseAuditSummary, parseMultitrackAuditSummary,
  type AuditRow, type LoadedAuditSummary, type LoadedMultitrackAuditSummary, type MultitrackAuditRow,
} from "../../../src/lib/audit/recordingAuditArtifacts.ts";

export const VERIFY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.verify-output");

/**
 * Optional snapshot bound. `RECAUDIT_MAX_RUN=<runId>` restricts every population
 * to runs with an id at or below that token, so a number quoted in the register
 * stays reproducible after later runs land in `.verify-output/`.
 */
export const MAX_RUN = process.env.RECAUDIT_MAX_RUN ? Number(process.env.RECAUDIT_MAX_RUN) : Infinity;

/**
 * `audioContext.outputLatency` as the register's bring-up calibration measured
 * it, identical at both sample rates and on every run that persisted the
 * field. The only value available for generations G1/G2, which predate
 * `outputLatency` persistence (`LoadedAuditSummary.outputLatencySec === null`);
 * a script that uses it must say so in its output.
 */
export const OUTPUT_LATENCY_BRING_UP_SEC = 0.023;

const SUMMARY_NAME = /^recaudit-summary-(\d+)\.json$/;

export function listSummaryRunIds(): string[] {
  return readdirSync(VERIFY_DIR)
    .map((f) => f.match(SUMMARY_NAME)?.[1])
    .filter((id): id is string => id !== undefined && Number(id) <= MAX_RUN)
    .sort();
}

const cache = new Map<string, LoadedAuditSummary>();
export function loadSummary(runId: string): LoadedAuditSummary {
  const cached = cache.get(runId);
  if (cached !== undefined) return cached;
  const parsed = parseAuditSummary(JSON.parse(readFileSync(`${VERIFY_DIR}/recaudit-summary-${runId}.json`, "utf8")), Number(runId));
  cache.set(runId, parsed);
  return parsed;
}

/** Every summary run on disk within the snapshot bound, oldest first, with the
 *  summary file's mtime (the replay's provenance window needs it). */
export function loadSummaries(): { runId: string; file: string; mtimeMs: number; summary: LoadedAuditSummary }[] {
  return listSummaryRunIds().map((runId) => {
    const file = `recaudit-summary-${runId}.json`;
    return { runId, file, mtimeMs: statSync(`${VERIFY_DIR}/${file}`).mtimeMs, summary: loadSummary(runId) };
  });
}

export function loadMultitrackSummary(runId: string): LoadedMultitrackAuditSummary {
  return parseMultitrackAuditSummary(JSON.parse(readFileSync(`${VERIFY_DIR}/recaudit-mt-summary-${runId}.json`, "utf8")), Number(runId));
}

/**
 * The population `classifyCell` sees for a cell: every non-error row of the
 * scenario/bpm, loop-wrap restricted to wrap takes 1..4 (0-based). A successful
 * repeat with NO matched beats (null median) stays in — the live harness passes
 * it to `classifyCell`, which returns `investigate` for it; dropping it here
 * would let the surviving repeats re-classify cleaner than the cell did live.
 */
export function cellPopulation<R extends AuditRow | MultitrackAuditRow>(rows: R[], scenario: string, bpm: number): R[] {
  const list = rows.filter((r) => r.scenario === scenario && r.bpm === bpm && r.status !== "error");
  return scenario === "loop-wrap" ? list.filter((r) => (r as AuditRow).takeIndex >= 1 && (r as AuditRow).takeIndex <= 4) : list;
}

/** The subset of a population whose adjusted median exists — what a cell MEAN
 *  is taken over (a null median has nothing to average). */
export function withMedian<R extends AuditRow | MultitrackAuditRow>(rows: R[]): (R & { medianBeatErrorMsAdjusted: number })[] {
  return rows.filter((r): r is R & { medianBeatErrorMsAdjusted: number } => typeof r.medianBeatErrorMsAdjusted === "number");
}

/**
 * Reconstruct the `TakeAlignment` a persisted row would present to
 * `classifyCell`. Only the fields the classifier reads are meaningful; the rest
 * are placeholders. `adjustedMedianMs` overrides the persisted adjusted median
 * (a φ-correction, or an after-the-fact bias adjustment). A tail figure the row
 * never persisted is `null` ("not measured"), never 0.
 */
export function asClassifiable(row: AuditRow | MultitrackAuditRow, adjustedMedianMs?: number | null): TakeAlignment {
  return {
    beatErrors: [],
    medianBeatErrorMs: row.medianBeatErrorMs,
    medianBeatErrorMsAdjusted: adjustedMedianMs !== undefined ? adjustedMedianMs : (row.medianBeatErrorMsAdjusted ?? null),
    anchorT0Sec: row.anchorT0Sec === undefined ? null : row.anchorT0Sec,
    firstRefIndex: null,
    headMissingMs: row.headMissingMs,
    tailMissingMs: row.tailMissingMs === undefined ? null : row.tailMissingMs,
    matchedBeats: row.matchedBeats,
    missingBeats: row.missingBeats,
    extraLowOnsets: 0,
  };
}

/** `regionStart mod beatPeriod`, in ms, from a row's persisted geometry. Throws
 *  when the row has none. */
export function phiMs(row: AuditRow | MultitrackAuditRow): number {
  if (typeof row.regionStartSec !== "number") {
    throw new Error(`phiMs: row ${row.scenario}/${row.bpm}/r${row.repeat} has no persisted regionStartSec`);
  }
  const P = 60 / row.bpm;
  const S = row.regionStartSec;
  return (S / P - Math.floor(S / P)) * P * 1000;
}

/**
 * The φ-correction identity `absolute median = region-anchored median + φ`
 * holds only while φ < P/2: past that, the region-anchored grid's nearest
 * expected beat to the first captured onset is the region start itself (at
 * distance P − φ), the anchored error is `e + (P − φ)` and the correct
 * correction is `φ − P`. Every site that applies the identity goes through
 * this function so a row in the other half cannot be corrected by a full beat
 * period silently.
 */
export function phiCorrectionMs(row: AuditRow | MultitrackAuditRow): number {
  const phi = phiMs(row);
  const halfPeriodMs = (60 / row.bpm) * 500;
  if (phi >= halfPeriodMs) {
    throw new Error(`phi-correction identity invalid for ${row.scenario}/${row.bpm}/r${row.repeat}: phi ${phi.toFixed(2)} ms >= P/2 ${halfPeriodMs.toFixed(2)} ms`);
  }
  return phi;
}

export const bpmToken = (b: number) => String(b).replace(".", "p");

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
