/**
 * Calibration/tolerance placeholders for the sample-rate alignment audit
 * harness (`samplerate-audit-debug-demo.tsx`). All three exports are
 * placeholders — Task 6 measures real values from browser runs of the
 * harness and updates this file; nothing here should be treated as a
 * verified threshold yet.
 */
import type { AuditFamily } from "./auditExpectations";

/**
 * Per-family onset-detector bias (seconds), subtracted from every detected
 * onset before judging — see `CellMeasurement.calibrationSec` in
 * `auditVerdict.ts`. Empty until Task 6 measures real per-family bias from a
 * browser run; every family defaults to zero bias until then. The harness
 * page's `?calibration=<json-url-encoded>` URL param (a `{family: seconds}`
 * map) overrides these per-run without a code change.
 */
export const AUDIT_CALIBRATION: Partial<Record<AuditFamily, number>> = {};

/**
 * Per-family pass/investigate threshold (seconds) for `judgeCell`'s
 * `toleranceSec` argument, used by every family except `seam` (which reads
 * its own threshold from `SEAM_THRESHOLDS` instead — see below). Placeholder
 * 2 ms for every family until Task 6 measures real per-family/per-rate
 * tolerances from rendered audio; a too-tight placeholder is expected to
 * over-flag "investigate" rather than silently pass a real misalignment.
 */
export const AUDIT_TOLERANCES: Record<AuditFamily, number> = {
  metronome: 0.002,
  "loop-wrap": 0.002,
  seam: 0.002, // unused directly by the seam judging path — kept for Record<AuditFamily, …> completeness
  "region-fencepost": 0.002,
  "note-onsets": 0.002,
  automation: 0.002,
  "tempo-ramp": 0.002,
  signature: 0.002,
  "transport-pos": 0.002,
};

/**
 * Seam family's `toleranceSec` argument to `judgeCell`, keyed by sample
 * rate. NOTE: despite the parameter name, `judgeCell`'s seam special case
 * compares this directly against `seamStep` — a `maxStepAround` amplitude
 * (discrete second-difference magnitude), not a duration — so these values
 * are amplitude thresholds, not seconds. Empty until Task 6 calibrates real
 * per-rate seam-click thresholds; the harness page falls back to `0.05`
 * (generous placeholder) for any rate not present here.
 */
export const SEAM_THRESHOLDS: Partial<Record<number, number>> = {};
