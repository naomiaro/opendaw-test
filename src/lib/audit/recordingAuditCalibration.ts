import type { SignatureBand } from "./recordingAlignment";

export const RECORDING_AUDIT_RATES = [44100, 48000] as const;
export const RECORDING_AUDIT_BPMS = [120, 97.3] as const;
export const RECORDING_AUDIT_SCENARIOS = [
  "nominal-start", "janked-start", "midtimeline-start", "countin-start", "loop-wrap",
] as const;
export type RecordingScenario = (typeof RECORDING_AUDIT_SCENARIOS)[number];

export function isRecordingScenario(value: string): value is RecordingScenario {
  return (RECORDING_AUDIT_SCENARIOS as readonly string[]).includes(value);
}

/** Multi-mic simultaneous-recording scenarios (two tapes armed on clones of the
 *  same loopback signal). Each mirrors a single-tape scenario's provocation and
 *  is judged, per tape, against that scenario's `SIGNATURE_BANDS`. */
export const MULTITRACK_SCENARIOS = ["multitrack-start", "multitrack-janked"] as const;
export type MultitrackScenario = (typeof MULTITRACK_SCENARIOS)[number];
export const MULTITRACK_BASE_SCENARIO: Record<MultitrackScenario, RecordingScenario> = {
  "multitrack-start": "nominal-start",
  "multitrack-janked": "janked-start",
};

export function isMultitrackScenario(value: string): value is MultitrackScenario {
  return (MULTITRACK_SCENARIOS as readonly string[]).includes(value);
}

/**
 * Total lookup into `SIGNATURE_BANDS`: throws on a scenario name the table
 * does not know, so an offline script fed a mistyped or foreign scenario can
 * never classify against an empty band list and land a spurious `aligned` /
 * `investigate`.
 */
export function signatureBandsFor(scenario: string): SignatureBand[] {
  if (!isRecordingScenario(scenario)) {
    throw new Error(`no signature bands for unknown scenario "${scenario}" (known: ${RECORDING_AUDIT_SCENARIOS.join(", ")})`);
  }
  return SIGNATURE_BANDS[scenario];
}
export const REPEATS_PER_CELL = 3;
export const JANK_MS = 150;
export const LOOP_WRAP_TAKES = 5;
/**
 * Bring-up calibration (Task 6, 2026-09-01, control cell nominal-start/120bpm/
 * 48000, six fresh-page-load runs = 18 valid repeats — run ids
 * 1788284188534, 1788285202428, 1788286810273, 1788286887454, 1788287122505,
 * 1788287338875; two further attempts, 1788283946271 and 1788286745058,
 * excluded as broken/all-failed — harness's `clockNoise` diagnostic,
 * persisted per row as `clockNoiseMaxAbsResidualMs`/`clockNoiseIdentifiedClicks`
 * since fix round 1): the detector/graph-path itself (reference clicks
 * matched against their own schedule, independent of any SDK placement math)
 * measured `maxAbsResidualMs` of ~0 (float noise only, e.g. 1.44e-12 — a
 * synthetic oscillator-scheduled click in a purely digital signal chain has
 * no acoustic/detector jitter to speak of). 2x that is far under the 2ms
 * floor, so the floor applies unchanged from the provisional value — no
 * revision needed. See debug/recording-start-alignment-audit.md "Bring-up
 * calibration" for the full residual arrays and run detail.
 */
export const ALIGNED_TOLERANCE_MS = 2;
/**
 * Baseline (ms) subtracted from every take's raw `headMissingMs` before
 * classification — see `TakeMeasurementInput.headMissingBaselineMs` in
 * `recordingAlignment.ts`. Measured on the same bring-up control cell's 15
 * repeats predating this constant's own introduction (run ids 1788284188534,
 * 1788285202428, 1788286810273, 1788286887454, 1788287122505 — those rows'
 * `headMissingMs` field holds the then-uncorrected raw value directly): raw
 * headMissingMs ranged 14.37-25.02ms (mean ~18.58ms), NOT random detector
 * noise. What the quantity IS was established later (Task 9 of the register):
 * on the installed 0.0.170 it is the `RecordingWorklet.#finalize` head drop —
 * the file kept the LAST `limit` frames, so the loopback-derived buffer start
 * sits the ring's overshoot (32-51ms measured) later than the true first
 * frame — minus the loopback path's own delay (10-23ms); the SDK's first
 * captured frame follows the request by 0-3 render quanta, and on a build
 * that keeps the buffer head the raw value is 0 on every row. The constant
 * remains a purely empirical baseline for the installed build's rows. Set to
 * 26ms (just above the measured max, zeroing every control-cell repeat's
 * corrected headMissingMs) so this universal finalize head drop doesn't force
 * `investigate` via the head-deficit path on scenarios that predict no
 * head-loss (nominal-start, countin-start).
 *
 * Caveat — what the clamp hides: `measureTakeAlignment` computes
 * `max(0, raw − 26)` and `classifyCell` gates on `headMissingMs > 2`, so on
 * the installed build a head loss under ~28 ms raw is INVISIBLE to the
 * head-deficit gate. Band A predicts head loss of 20-300 ms (janked-start) and
 * 5-300 ms (midtimeline-start): the upper parts of both ranges are 1-12x this
 * baseline and remain distinguishable, but each band's lower edge (20 ms,
 * 5 ms — 0.77x and 0.19x the baseline) is unreachable in corrected space. A
 * genuine head loss inside those lower bands classifies as if there were
 * none; the raw figure (`headMissingRawMs`, persisted per row since fix round
 * 1 (I3) alongside the corrected `headMissingMs`) is the only place it shows.
 * Both are persisted — the correction is never silently applied.
 */
export const HEAD_MISSING_BASELINE_MS = 26;
/** Predicted upstream signatures (spec §1) — predictions to test, not truths. */
export const SIGNATURE_BANDS: Record<RecordingScenario, SignatureBand[]> = {
  "nominal-start": [{ id: "B", kind: "random-band", minAbsMs: 4, maxAbsMs: 25 }],
  "janked-start": [
    { id: "C", kind: "constant-late", minAbsMs: 50, maxAbsMs: 235 },
    { id: "A", kind: "head-loss", minAbsMs: 20, maxAbsMs: 300 },
  ],
  "midtimeline-start": [{ id: "A", kind: "head-loss", minAbsMs: 5, maxAbsMs: 300 }],
  "countin-start": [{ id: "B", kind: "random-band", minAbsMs: 4, maxAbsMs: 25 }],
  "loop-wrap": [{ id: "D", kind: "constant-late", minAbsMs: 15, maxAbsMs: 30 }],
};
