import type { SignatureBand } from "./recordingAlignment";

export const RECORDING_AUDIT_RATES = [44100, 48000] as const;
export const RECORDING_AUDIT_BPMS = [120, 97.3] as const;
export const RECORDING_AUDIT_SCENARIOS = [
  "nominal-start", "janked-start", "midtimeline-start", "countin-start", "loop-wrap",
] as const;
export type RecordingScenario = (typeof RECORDING_AUDIT_SCENARIOS)[number];
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
 * noise — it is the genuine async gap between the JS `startRecording()` call
 * and the RecordingWorklet's first captured frame reaching the ring buffer
 * (Promise/worklet-connect message-passing setup; recording genuinely had
 * not started yet at `recordRequestContextTime`, so this is expected
 * latency, not lost content). Set to 26ms (just above the measured max,
 * zeroing every control-cell repeat's corrected headMissingMs) so this
 * universal setup lag doesn't force `investigate` via the head-deficit path
 * on scenarios that predict no head-loss (nominal-start, countin-start).
 * Scenarios that DO predict head-loss (A: janked-start 20-300ms,
 * midtimeline-start 5-300ms) remain trivially distinguishable — their
 * predicted magnitudes are 1-12x this baseline even at the predicted
 * minimum. Both the raw (`headMissingRawMs`) and corrected (`headMissingMs`)
 * values are persisted per row since fix round 1 (I3) — never silently
 * applied.
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
