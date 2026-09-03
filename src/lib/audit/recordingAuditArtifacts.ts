/**
 * Persisted-artifact contract for the recording start-alignment audit: the row
 * and summary-envelope types the harness writes to `.verify-output/` (via the
 * dev server's `/__verify` sink), and ONE loader that maps every envelope on
 * disk — current or legacy — to an explicit schema generation.
 *
 * Producer: `src/demos/recording/recording-alignment-audit-debug-demo.tsx`
 * (`uploadSummary` / `uploadMultitrackSummary`). Consumers: the offline scripts
 * under `scripts/audit/recording-alignment/`, which import these types with a
 * `.ts` extension. No SDK or DOM imports here, so both sides can use it.
 *
 * Why generations are explicit: the campaign persisted artifacts across many
 * harness fix rounds, and the meaning of a row depends on which round wrote it
 * — most consequentially, whether `medianBeatErrorMs` was measured on the
 * region-anchored or the absolute beat grid, and whether the live rows were
 * adjusted by a harness-path bias at all. Before this module each script
 * inferred that from `??` fallbacks and one hard-coded run id. `parseAuditSummary`
 * decides it once, from the fields actually present, and every optional field
 * on `AuditRow` names the generation that introduced it. Legacy files on disk
 * are never rewritten.
 *
 * Generation table (single-tape `recaudit-summary-<runId>.json`):
 *
 * | generation | detected by (envelope / rows) | what the loader concludes |
 * |---|---|---|
 * | G1-bringup   | no `sdkBuildProbe`                                  | build not recorded → `sdkBuildProbe: "unknown"`; no `outputLatency` → `outputLatencySec: null`; rows carry no adjusted median → `harnessPathBiasSec: 0`; no geometry, no tail |
 * | G2-probe     | `sdkBuildProbe`, no `outputLatency`                 | as G1 with the build recorded |
 * | G3-latency   | `outputLatency`, no `harnessPathBiasSec`            | `outputLatencySec` persisted; rows still unadjusted → `harnessPathBiasSec: 0`; some runs carry per-row geometry (`regionStartSec` etc.), others not — `geometryPersisted` says which |
 * | G4-adjusted  | `harnessPathBiasSec`, rows without `tailMissingMs`  | rows adjusted by the persisted bias; tail deficit measured live but not persisted → `tailPersisted: false` (a script reconstructing a repeat must pass `tailMissingMs: null`, never 0) |
 * | G5-tail      | rows carry `tailMissingMs` (with `bufferDurationSec`, `stopRequestContextTime`), no `schemaVersion` | everything above persisted; `regionDurationSec`, `firstQuantumTimeSec` and the `finalize*` probe fields arrive within this generation and are simply present or absent per row |
 * | G6-versioned | `schemaVersion >= 2`                                | `beatGrid` persisted; `harnessPathBiasSec` on every row; `cellVerdicts` and `wavName`/`wavUploadError` present |
 *
 * Beat grid: G6 persists `beatGrid`. For every earlier generation the grid is
 * decided by the run id — the absolute grid shipped mid-session, and the first
 * run measured on it is `ABSOLUTE_GRID_FROM_RUN`; nothing in those envelopes
 * records the grid, so a cutoff is the only honest rule (it lives here, once).
 *
 * `alignedToleranceMs`, `rate` and `rows[*].scenario` are required in every
 * generation; the loader throws when they are absent or unknown rather than
 * defaulting.
 */
import type { CellStatus, CrossTrackSkew, SignatureBand } from "./recordingAlignment";
// Value import with an explicit `.ts` extension: this module sits in the Node
// scripts' import chain (type stripping resolves nothing without it).
import {
  isMultitrackScenario, isRecordingScenario,
  type AuditBuildFeature, type MultitrackScenario, type RecordingScenario,
} from "./recordingAuditCalibration.ts";

/** Written into every new envelope. 1 = every legacy file (inferred, never persisted). */
export const AUDIT_SCHEMA_VERSION = 2;

/** First run measured on the absolute beat grid (Task 7c). Earlier runs'
 *  persisted medians are region-anchored. Applies only to envelopes that carry
 *  no `beatGrid` of their own. */
export const ABSOLUTE_GRID_FROM_RUN = 1788306957902;

export type SdkBuildProbe = "candidate" | "upstream" | "unknown";
/** Whether the capture box named a device (`named`) or left it unset (`default`). */
export type CaptureMode = "named" | "default";
export type BeatGrid = "region-anchored" | "absolute";

/**
 * Finalization instrumentation, persisted per row (G5 onward, Task 9 fix round
 * 1): the SDK's `RecordingWorklet` is the take's SampleLoader while it records;
 * its `limit(count)` method is patched on the INSTANCE to record every call
 * together with `numberOfFrames` at that moment. A hung finalization is one with
 * NO `limit()` call and a loader still in the `record` state after the wait.
 */
export interface FinalizeProbe {
  finalizeNumberOfFramesAtStop?: number; // numberOfFrames when stopRecording() was called
  finalizeLimitCalls?: number[]; // every `count` passed to limit(), in order (empty = never called)
  finalizeNumberOfFramesAtLimit?: number[]; // numberOfFrames at each limit() call
  finalizeOvershootFrames?: number[]; // numberOfFrames − count at each call (ring frames past the limit)
  finalizeNumberOfFramesAfter?: number; // numberOfFrames after the finalize wait resolved or timed out
  finalizeLoaderState?: string; // loader.state.type after the wait ("loaded" = finalized, "record" = hung)
}

/** `pending` is the harness's in-flight state only — rows are classified
 *  before upload, so a persisted row is a `CellStatus` or `"error"`. */
export type AuditRowStatus = CellStatus | "pending" | "error";

/** Fields shared by the single-tape and multi-mic rows. */
interface TakeRowBase extends FinalizeProbe {
  bpm: number;
  rate: number;
  repeat: number;
  medianBeatErrorMs: number | null;
  /** G4+: raw + harnessPathBiasSec·1000 — `classifyCell`'s verdict runs on this
   *  field; the raw field above is unmodified and always persisted alongside it. */
  medianBeatErrorMsAdjusted?: number | null;
  matchedBeats: number;
  missingBeats: number;
  /** Baseline-corrected (HEAD_MISSING_BASELINE_MS already subtracted, clamped at 0);
   *  null when no reference-click anchor was found for the repeat. */
  headMissingMs: number | null;
  /** G3+: uncorrected head deficit. */
  headMissingRawMs?: number | null;
  /** G5+ (single-tape; every multi-mic run): tail deficit, null when unanchored.
   *  Absent on earlier rows — measured live but not persisted. */
  tailMissingMs?: number | null;
  /** G5+ */
  stopRequestContextTime?: number | null;
  /** G5+ */
  bufferDurationSec?: number;
  status: AuditRowStatus;
  detail: string;
  errorMessage?: string;
  /** G3+ (some runs): raw box-graph geometry behind the placement math. */
  regionPositionPpqn?: number;
  regionStartSec?: number;
  waveformOffsetSec?: number;
  /** G5+ (Task 7c fix round 1): the presented duration `measureTakeAlignment`
   *  was actually given, so a replay runs on the same range. */
  regionDurationSec?: number;
  /** G3+ (some runs): context time of the buffer's first frame as the loopback's
   *  reference clicks locate it; null when no click was identified. */
  anchorT0Sec?: number | null;
  recordRequestContextTime?: number | null;
  /** G4+: `stopRecording()` → loader terminal state, in performance.now() ms. */
  finalizeMs?: number;
  /** G5+ (Task 9), branch builds only: the RecordingWorklet's own report of the
   *  buffer's first frame; `firstQuantumTimeSec − anchorT0Sec` is the loopback
   *  path's input delay for that row. */
  firstQuantumTimeSec?: number;
  /** G6+: the bias this row's `medianBeatErrorMsAdjusted` was computed with —
   *  the run-wide value read once after output started. */
  harnessPathBiasSec?: number;
  /** G6+: the capture WAV this row was measured from, and why its upload failed
   *  (null on success). Lets "WAV absent" be told apart from "never uploaded". */
  wavName?: string;
  wavUploadError?: string | null;
}

export interface AuditRow extends TakeRowBase {
  scenario: RecordingScenario;
  takeIndex: number;
  matchedSignature: SignatureBand["id"] | null;
  /** G3+ (some runs): detector/graph-path noise for the repeat's reference-click match. */
  clockNoiseIdentifiedClicks?: number;
  clockNoiseMaxAbsResidualMs?: number;
}

export interface MultitrackAuditRow extends TakeRowBase {
  scenario: MultitrackScenario;
  tape: "a" | "b";
  tailMissingMs: number | null;
  /** Cross-track measurement, repeated on BOTH tapes' rows for the same repeat. */
  medianSkewMs: number | null;
  maxAbsSkewMs: number | null;
  pairedSkewBeats: number;
}

export interface ReferenceScheduleDescriptor {
  count: number;
  baseGapSec: number;
  gapIncrementSec: number;
}

/** G6+: one record per cell the run attempted, including all-error cells —
 *  the cell verdict used to exist only on successful rows, so a cell whose
 *  every repeat errored had no persisted verdict at all. */
export interface CellVerdictRecord {
  scenario: RecordingScenario | MultitrackScenario;
  bpm: number;
  rate: number;
  status: CellStatus;
  matchedSignature: SignatureBand["id"] | null;
  detail: string;
  successfulRepeats: number;
  errorRepeats: number;
}

interface SummaryBase {
  schemaVersion: number;
  beatGrid: BeatGrid;
  rate: number;
  sdkBuildProbe: SdkBuildProbe;
  /** Which SDK surfaces the served build exposed at load — see
   *  `src/lib/audit/buildFeatures.ts`. Absent on every envelope written before
   *  the field existed; `profileKeyFor` falls back to the run token there. */
  buildFeatures?: AuditBuildFeature[];
  /** How the tape was armed: `named` sets the capture box's `deviceId` to the
   *  synthetic loopback device, `default` leaves it unset so the SDK opens its
   *  default input (`?defaultInput=1`). The two take different paths through
   *  `CaptureAudio.#updateStream`, so a row means nothing without it. */
  captureMode?: CaptureMode;
  /** Streams the SDK opened during the run, counted by the loopback's
   *  `getUserMedia` override. One open for a whole cell means every take ran on
   *  the same audio chain; one per take means the chain was rebuilt each time. */
  getUserMediaOpens?: number;
  outputLatency: number;
  baseLatency: number;
  /** The bias every row's `medianBeatErrorMsAdjusted` was computed with (equals
   *  `outputLatency`, read once after output started — see the harness's
   *  `resolveHarnessPathBias`). */
  harnessPathBiasSec: number;
  /** How long the harness waited for `outputLatency` to report non-zero. */
  harnessPathBiasSettleMs: number;
  headMissingBaselineMs: number;
  repeatsPerCell: number;
  jankMs: number;
  alignedToleranceMs: number;
  referenceSchedule: ReferenceScheduleDescriptor;
  wavUploadFailures: number;
  cellVerdicts: CellVerdictRecord[];
}

export interface AuditSummary extends SummaryBase {
  loopWrapTakes: number;
  rows: AuditRow[];
}

export interface MultitrackCellSkew {
  scenario: MultitrackScenario;
  bpm: number;
  repeat: number;
  skew: CrossTrackSkew;
}

export interface MultitrackAuditSummary extends SummaryBase {
  skewToleranceMs: number;
  confirmCollision: boolean;
  rows: MultitrackAuditRow[];
  cellSkews: MultitrackCellSkew[];
}

export type AuditArtifactGeneration =
  | "G1-bringup" | "G2-probe" | "G3-latency" | "G4-adjusted" | "G5-tail" | "G6-versioned";

/** A single-tape envelope as the loader understands it — every generation
 *  difference resolved into an explicit field. `rows` are the persisted rows
 *  untouched (no synthesized numbers). */
export interface LoadedAuditSummary {
  runId: number;
  generation: AuditArtifactGeneration;
  schemaVersion: number;
  beatGrid: BeatGrid;
  beatGridSource: "persisted" | "run-id-cutoff";
  /** "unknown" for G1, where the build was not recorded. */
  sdkBuildProbe: SdkBuildProbe;
  /** null when the envelope predates the field — see `buildFeatures` above. */
  buildFeatures: AuditBuildFeature[] | null;
  /** null when the envelope predates the field; every run before it was `named`. */
  captureMode: CaptureMode | null;
  /** null when the envelope predates the field. */
  getUserMediaOpens: number | null;
  rate: number;
  alignedToleranceMs: number;
  /** null when the run predates `outputLatency` persistence (G1, G2). */
  outputLatencySec: number | null;
  /** `audioContext.baseLatency`; persisted from G3 on, null before. */
  baseLatencySec: number | null;
  /** The bias the live rows' adjusted medians were computed with: the persisted
   *  value from G4 on, 0 before (rows carry no adjusted median at all). */
  harnessPathBiasSec: number;
  harnessPathBiasSource: "persisted" | "rows-unadjusted";
  /** Whether rows persist `tailMissingMs` (G5+). When false a reconstructed
   *  repeat must carry `tailMissingMs: null` — "not persisted", not "no deficit". */
  tailPersisted: boolean;
  /** Whether any row persists `regionStartSec` (G3+, some runs). */
  geometryPersisted: boolean;
  headMissingBaselineMs: number | null;
  cellVerdicts: CellVerdictRecord[];
  rows: AuditRow[];
}

export interface LoadedMultitrackAuditSummary {
  runId: number;
  schemaVersion: number;
  beatGrid: BeatGrid;
  beatGridSource: "persisted" | "run-id-cutoff";
  sdkBuildProbe: SdkBuildProbe;
  /** null when the envelope predates the field — see `buildFeatures` above. */
  buildFeatures: AuditBuildFeature[] | null;
  /** null when the envelope predates the field; every run before it was `named`. */
  captureMode: CaptureMode | null;
  /** null when the envelope predates the field. */
  getUserMediaOpens: number | null;
  rate: number;
  alignedToleranceMs: number;
  skewToleranceMs: number;
  outputLatencySec: number | null;
  harnessPathBiasSec: number;
  /** false when the flag is absent: it was introduced with the dedicated
   *  collision-confirmation cell, and every run before it was an official-
   *  matrix run on two distinct devices. */
  confirmCollision: boolean;
  cellVerdicts: CellVerdictRecord[];
  rows: MultitrackAuditRow[];
  cellSkews: MultitrackCellSkew[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNumber(top: Record<string, unknown>, key: string, runId: number): number {
  const v = top[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`recaudit summary ${runId}: required field "${key}" is ${JSON.stringify(v)}`);
  }
  return v;
}

function optionalNumber(top: Record<string, unknown>, key: string): number | null {
  const v = top[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function probeOf(top: Record<string, unknown>): SdkBuildProbe {
  const v = top.sdkBuildProbe;
  if (v === "candidate" || v === "upstream" || v === "unknown") return v;
  if (v === undefined) return "unknown"; // G1: the build was not recorded
  throw new Error(`recaudit summary: unexpected sdkBuildProbe ${JSON.stringify(v)}`);
}

/** The persisted feature list, or null on an envelope written before the field. */
function buildFeaturesOf(top: Record<string, unknown>, runId: number): AuditBuildFeature[] | null {
  const v = top.buildFeatures;
  if (v === undefined) return null;
  if (!Array.isArray(v) || v.some((entry) => typeof entry !== "string")) {
    throw new Error(`recaudit summary ${runId}: "buildFeatures" is not an array of strings`);
  }
  return v as AuditBuildFeature[];
}

/** The persisted capture mode, or null on an envelope written before the field. */
function captureModeOf(top: Record<string, unknown>, runId: number): CaptureMode | null {
  const v = top.captureMode;
  if (v === undefined) return null;
  if (v !== "named" && v !== "default") {
    throw new Error(`recaudit summary ${runId}: unexpected captureMode ${JSON.stringify(v)}`);
  }
  return v;
}

/** The persisted stream-open count, or null on an envelope written before the field. */
function getUserMediaOpensOf(top: Record<string, unknown>, runId: number): number | null {
  const v = top.getUserMediaOpens;
  if (v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`recaudit summary ${runId}: unexpected getUserMediaOpens ${JSON.stringify(v)}`);
  }
  return v;
}

function beatGridOf(top: Record<string, unknown>, runId: number): { beatGrid: BeatGrid; beatGridSource: LoadedAuditSummary["beatGridSource"] } {
  const v = top.beatGrid;
  if (v === "absolute" || v === "region-anchored") return { beatGrid: v, beatGridSource: "persisted" };
  if (v !== undefined) throw new Error(`recaudit summary ${runId}: unexpected beatGrid ${JSON.stringify(v)}`);
  return { beatGrid: runId >= ABSOLUTE_GRID_FROM_RUN ? "absolute" : "region-anchored", beatGridSource: "run-id-cutoff" };
}

function rowsOf(top: Record<string, unknown>, runId: number): Record<string, unknown>[] {
  const rows = top.rows;
  if (!Array.isArray(rows)) throw new Error(`recaudit summary ${runId}: "rows" is not an array`);
  rows.forEach((r, i) => {
    if (!isRecord(r)) throw new Error(`recaudit summary ${runId}: rows[${i}] is not an object`);
  });
  return rows as Record<string, unknown>[];
}

function cellVerdictsOf(top: Record<string, unknown>): CellVerdictRecord[] {
  return Array.isArray(top.cellVerdicts) ? (top.cellVerdicts as CellVerdictRecord[]) : [];
}

/**
 * Parse one persisted single-tape summary (already JSON-decoded) into its
 * explicit generation. Throws on a missing required field or an unknown
 * scenario name — an offline script must never classify a row it cannot
 * place.
 */
export function parseAuditSummary(json: unknown, runId: number): LoadedAuditSummary {
  if (!isRecord(json)) throw new Error(`recaudit summary ${runId}: not an object`);
  const rawRows = rowsOf(json, runId);
  rawRows.forEach((r, i) => {
    const scenario = r.scenario;
    if (typeof scenario !== "string" || !isRecordingScenario(scenario)) {
      throw new Error(`recaudit summary ${runId}: rows[${i}].scenario ${JSON.stringify(scenario)} is not a recording scenario`);
    }
  });
  const rows = rawRows as unknown as AuditRow[];
  const schemaVersion = optionalNumber(json, "schemaVersion") ?? 1;
  const outputLatencySec = optionalNumber(json, "outputLatency");
  const persistedBias = optionalNumber(json, "harnessPathBiasSec");
  const tailPersisted = rows.some((r) => Object.prototype.hasOwnProperty.call(r, "tailMissingMs"));
  const geometryPersisted = rows.some((r) => typeof r.regionStartSec === "number");
  const generation: AuditArtifactGeneration =
    schemaVersion >= 2 ? "G6-versioned"
    : tailPersisted ? "G5-tail"
    : persistedBias !== null ? "G4-adjusted"
    : outputLatencySec !== null ? "G3-latency"
    : typeof json.sdkBuildProbe === "string" ? "G2-probe"
    : "G1-bringup";
  return {
    runId,
    generation,
    schemaVersion,
    ...beatGridOf(json, runId),
    sdkBuildProbe: probeOf(json),
    buildFeatures: buildFeaturesOf(json, runId),
    captureMode: captureModeOf(json, runId),
    getUserMediaOpens: getUserMediaOpensOf(json, runId),
    rate: requireNumber(json, "rate", runId),
    alignedToleranceMs: requireNumber(json, "alignedToleranceMs", runId),
    outputLatencySec,
    baseLatencySec: optionalNumber(json, "baseLatency"),
    harnessPathBiasSec: persistedBias ?? 0,
    harnessPathBiasSource: persistedBias !== null ? "persisted" : "rows-unadjusted",
    tailPersisted,
    geometryPersisted,
    headMissingBaselineMs: optionalNumber(json, "headMissingBaselineMs"),
    cellVerdicts: cellVerdictsOf(json),
    rows,
  };
}

/** Parse one persisted multi-mic summary. Same contract as `parseAuditSummary`. */
export function parseMultitrackAuditSummary(json: unknown, runId: number): LoadedMultitrackAuditSummary {
  if (!isRecord(json)) throw new Error(`recaudit mt summary ${runId}: not an object`);
  const rawRows = rowsOf(json, runId);
  rawRows.forEach((r, i) => {
    const scenario = r.scenario;
    if (typeof scenario !== "string" || !isMultitrackScenario(scenario)) {
      throw new Error(`recaudit mt summary ${runId}: rows[${i}].scenario ${JSON.stringify(scenario)} is not a multitrack scenario`);
    }
  });
  const cellSkews = Array.isArray(json.cellSkews) ? (json.cellSkews as MultitrackCellSkew[]) : [];
  const persistedBias = optionalNumber(json, "harnessPathBiasSec");
  return {
    runId,
    schemaVersion: optionalNumber(json, "schemaVersion") ?? 1,
    ...beatGridOf(json, runId),
    sdkBuildProbe: probeOf(json),
    buildFeatures: buildFeaturesOf(json, runId),
    captureMode: captureModeOf(json, runId),
    getUserMediaOpens: getUserMediaOpensOf(json, runId),
    rate: requireNumber(json, "rate", runId),
    alignedToleranceMs: requireNumber(json, "alignedToleranceMs", runId),
    skewToleranceMs: requireNumber(json, "skewToleranceMs", runId),
    outputLatencySec: optionalNumber(json, "outputLatency"),
    harnessPathBiasSec: persistedBias ?? 0,
    confirmCollision: json.confirmCollision === true,
    cellVerdicts: cellVerdictsOf(json),
    rows: rawRows as unknown as MultitrackAuditRow[],
    cellSkews,
  };
}

/**
 * The harness-path bias a persisted row was actually adjusted with, in ms:
 * `medianBeatErrorMsAdjusted − medianBeatErrorMs`. Null when either median is
 * null or the row predates adjustment. Lets a consumer detect a row adjusted
 * with a bias other than the envelope's (before the harness read
 * `outputLatency` once after output started, the first repeat of a fresh
 * session could be adjusted with Chrome's initial 0).
 */
export function appliedHarnessPathBiasMs(row: TakeRowBase): number | null {
  if (row.medianBeatErrorMs === null || row.medianBeatErrorMsAdjusted === null || row.medianBeatErrorMsAdjusted === undefined) {
    return null;
  }
  return row.medianBeatErrorMsAdjusted - row.medianBeatErrorMs;
}
