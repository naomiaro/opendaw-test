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
 * One calibration call as `input-latency-calibration-debug-demo` persists it —
 * the SDK `Result` plus, on a sweep row, the delay the loopback was injecting.
 * The page owns the full type; this is the subset the offline scripts read.
 */
export interface CalibrationCall {
  verdict: string;
  requestedDelayMs?: number;
  requestedDelaySec?: number;
  roundTripSeconds: number;
  /** Present only on builds carrying the second capture anchor (66021385 on). */
  roundTripSecondsSecondary?: number;
  inputLatencySeconds: number;
  spreadSeconds: number;
  correlationRatioDb: number;
  identifiedBursts: number;
  sampleRate: number;
  reason?: string;
  /** `?repeat=` rows only: the delay THIS call ran at, and the previous call's. */
  delayMs?: number;
  previousDelayMs?: number | null;
  flaggedByAnchorCheck?: boolean;
}

/**
 * The `calib-summary-<runToken>.json` envelope, restricted to the fields the
 * offline calibration tables read. `harnessLoopbackHopPerRowSec` is the
 * harness's own independent measure of the chain's delay for the applied cell's
 * takes (`firstQuantumTimeSec − anchorT0Sec`), so a run carries one hop per
 * recorded repeat and none for its swept delays.
 */
export interface LoadedCalibrationSummary {
  runToken: number;
  rate: number;
  sdkBuildProbe: string;
  buildFeatures: string[] | null;
  captureMode: string | null;
  getUserMediaOpens: number | null;
  armState: string | null;
  warmup: CalibrationCall | null;
  sweep: CalibrationCall[];
  repeats: CalibrationCall[];
  /**
   * `?repeat=` phase envelope, null when the phase was skipped. A batch that
   * held one delay carries it here as `delayMs`; a batch that cycled carries
   * `delayCycleMs` and each call's own delay on the call.
   */
  repeatSummary: { calls: number; delayMs?: number; delayCycleMs?: number[] } | null;
  fit: { slope: number; interceptSec: number; points: number; maxAbsResidualMs: number } | null;
  /** null on the runs that predate the noisy-row exclusion (`404a70b` and earlier). */
  fitExcludedNoisy: { count: number; delaysMs: number[] } | null;
  applied: CalibrationCall | null;
  cell: {
    status: string;
    rows: { medianBeatErrorMsAdjusted: number | null; headMissingMs: number | null; tailMissingMs: number | null }[];
  };
  harnessLoopbackHopPerRowSec: number[];
}

/**
 * Read a calibration envelope. Unlike the audit summaries there is no schema
 * generation to reason about: the page has written the same shape since the
 * first run, and the three fields added later (`buildFeatures`, `captureMode`,
 * `getUserMediaOpens`) read `null` on the artifacts that predate them rather
 * than being inferred.
 */
export function loadCalibrationSummary(runId: string): LoadedCalibrationSummary {
  const json = JSON.parse(readFileSync(`${VERIFY_DIR}/calib-summary-${runId}.json`, "utf8")) as Record<string, unknown>;
  const summary = json as unknown as LoadedCalibrationSummary;
  if (summary.runToken !== Number(runId)) {
    throw new Error(`calib-summary-${runId}.json carries runToken ${summary.runToken}`);
  }
  return {
    ...summary,
    buildFeatures: Array.isArray(json.buildFeatures) ? (json.buildFeatures as string[]) : null,
    captureMode: typeof json.captureMode === "string" ? json.captureMode : null,
    getUserMediaOpens: typeof json.getUserMediaOpens === "number" ? json.getUserMediaOpens : null,
    armState: typeof json.armState === "string" ? json.armState : null,
    warmup: (json.warmup ?? null) as CalibrationCall | null,
    fitExcludedNoisy: (json.fitExcludedNoisy ?? null) as { count: number; delaysMs: number[] } | null,
    repeats: Array.isArray(json.repeats) ? (json.repeats as CalibrationCall[]) : [],
    repeatSummary: (json.repeatSummary ?? null) as LoadedCalibrationSummary["repeatSummary"],
  };
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
