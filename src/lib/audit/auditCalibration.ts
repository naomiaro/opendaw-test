/**
 * Calibration/tolerance values for the sample-rate alignment audit harness
 * (`samplerate-audit-debug-demo.tsx`), measured in Task 6
 * (2026-08-27, WASM engine, control row = bpm 120 / rate 48000 unless noted).
 * See `.superpowers/sdd/2026-08-27-samplerate-alignment-audit/task-6-report.md`
 * for the full evidence (parameter sweeps, per-onset deviation tables, run ids).
 *
 * Two harness-side bugs were found and fixed alongside this calibration
 * (both documented in detail at their fix sites, not repeated here):
 *  - `needsMetronome` families + `loop-wrap` always picked up one spurious
 *    onset from `auditBuilders.ts`'s `TAIL_PADDING_SEC` render tail — fixed
 *    in `samplerate-audit-debug-demo.tsx` (`TAIL_ARTIFACT_FAMILIES` filter).
 *  - `tempo-ramp`'s analytic expectation formula used a discrete per-beat
 *    step approximation instead of the engine's actual continuous
 *    linear-in-PPQN tempo integration, drifting up to 47ms by beat 21 —
 *    fixed in `auditExpectations.ts`'s "tempo-ramp" case (closed-form
 *    integral), now within a few ms across the whole ramp.
 *  - `loop-wrap` / `note-onsets` also needed per-family `detectOnsets`
 *    tuning (see `ONSET_OPTIONS_BY_FAMILY` in the demo) — Vaporisateur's
 *    voice isn't a clean percussive transient; its envelope keeps rippling
 *    for ~350-400ms after the true attack, which the default detector
 *    over-triggered on.
 */
import type { AuditFamily } from "./auditExpectations";

/**
 * Per-family onset-detector bias (seconds), subtracted from every detected
 * onset before judging — see `CellMeasurement.calibrationSec` in
 * `auditVerdict.ts`. Measured as the MEAN matched-pair deviation on the
 * bpm=120/rate=48000 control row, run id 1787877588459 (post onset-detector
 * and tail-artifact fixes, pre this calibration file). The harness page's
 * `?calibration=<json-url-encoded>` URL param (a `{family: seconds}` map)
 * overrides these per-run without a code change.
 */
export const AUDIT_CALIBRATION: Partial<Record<AuditFamily, number>> = {
  metronome: 0.0013242187500000953, // measured 2026-08-27, run 1787877588459: mean of 32 matched pairs
  "loop-wrap": 0.003770833333333952, // measured 2026-08-27, run 1787877588459: mean of 8 matched pairs (identical to maxDev — no spread)
  // seam: no calibrationSec entry — the seam family's pass/fail reads
  // `seamStep` directly (see judgeCell's seam special case), calibration
  // never affects its verdict. Left out of this map (falls back to 0 bias).
  "region-fencepost": 0.0000208333333333181158, // measured 2026-08-27, run 1787877588459: mean of 15 matched pairs (~1 sample at 48kHz)
  // note-onsets: BLOCKED, see AUDIT_TOLERANCES comment below — bias recorded
  // for reference only, NOT a validated calibration (one of its 10 onsets is
  // a known detector-ambiguity outlier, so this mean is skewed by it).
  "note-onsets": 0.003945833333333282, // measured 2026-08-27, run 1787877588459: mean of 10 matched pairs (9 clean + 1 outlier, see task-6-report.md)
  automation: 0.00103472222222226, // measured 2026-08-27, run 1787877588459: mean of 3 matched pairs
  "tempo-ramp": 0.0012139978521957598, // measured 2026-08-27, run 1787877588459: mean of 32 matched pairs (post closed-form expectation fix)
  signature: 0.0013205128205128502, // measured 2026-08-27, run 1787877588459: mean of 26 matched pairs
  "transport-pos": 0.001320312499999976, // measured 2026-08-27, run 1787877588459: mean of 8 matched pairs
};

/**
 * Per-family pass/investigate threshold (seconds) for `judgeCell`'s
 * `toleranceSec` argument, used by every family except `seam` (which reads
 * its own threshold from `SEAM_THRESHOLDS` instead — see below). Rule:
 * `max(0.002, 2 * observed control-row max deviation)`, control-row max
 * deviation measured WITH `AUDIT_CALIBRATION` applied (run id 1787877627775,
 * bpm=120/rate=48000, `?calibration=` set to the exact map above). Every
 * family's post-calibration max deviation was under 0.002s (the floor) EXCEPT
 * `tempo-ramp` (residual ramp-integration error grows toward the end of the
 * ramp — expected, see the file-header note) and `note-onsets` (BLOCKED,
 * see below) — both documented individually.
 */
export const AUDIT_TOLERANCES: Record<AuditFamily, number> = {
  metronome: 0.002, // post-cal max dev 0.0000742s -> floor
  "loop-wrap": 0.002, // post-cal max dev ~0 (8.9e-16, float noise) -> floor
  seam: 0.002, // unused directly by the seam judging path — kept for Record<AuditFamily, …> completeness
  "region-fencepost": 0.002, // post-cal max dev 0 (exact) -> floor
  // note-onsets: BLOCKED (Task 6, 2026-08-27) — NOT calibrated via the
  // formula above. Control-row post-calibration max deviation is 6.3ms,
  // over the 5ms STOP-and-investigate line. Root cause diagnosed precisely:
  // of the 10 onsets, 9 share the family's normal +4.2..4.3ms raw bias, but
  // the onset at expected=1.25s (NOTE_ONSET_POSITIONS 1920->2400 PPQN, only
  // 250ms after the previous note at 1.0s) measures -2.4ms raw — sign-
  // flipped versus every other onset in the same cell. Vaporisateur's voice
  // rings for ~350-400ms after an attack (see ONSET_OPTIONS_BY_FAMILY's
  // comment in the demo); the prior note's decay tail is still present when
  // the 1.25s note attacks, and biases the onset detector's local-peak
  // refinement early. This is a real detector/content ambiguity specific to
  // that one closely-spaced pair, not an engine timing bug (the other 9
  // onsets align to within 0.3ms of each other post-calibration — as clean
  // as any passing family). No detector-parameter retune found in the Task 6
  // sweep resolves it without either missing a real onset elsewhere or
  // reintroducing the ripple false-positives (see ONSET_OPTIONS_BY_FAMILY).
  // Leaving this at the floor keeps the family honestly reporting
  // "investigate" rather than masking the gap behind a widened tolerance;
  // widening to cover it (~12.6ms) would meaningfully reduce this family's
  // sensitivity to a real rate-dependent bug. Fix belongs in the SCENARIO
  // (e.g. widen that one gap, or use a percussive click-train like
  // region-fencepost instead of a sustained synth voice) — out of scope for
  // this calibration task. See task-6-report.md for the full per-onset table.
  "note-onsets": 0.002,
  automation: 0.002, // post-cal max dev 0.00093s -> floor
  "tempo-ramp": 0.00813, // post-cal max dev 0.004065s (2x = 0.00813) — residual grows toward the ramp's end (largest at the last beat), consistent with the engine applying the continuous tempo curve at finite block granularity rather than a bug; still small relative to the family's own event spacing
  signature: 0.002, // post-cal max dev 0.0000705s -> floor
  "transport-pos": 0.002, // post-cal max dev 0.0000703s -> floor
};

/**
 * Seam family's `toleranceSec` argument to `judgeCell`, keyed by sample
 * rate. NOTE: despite the parameter name, `judgeCell`'s seam special case
 * compares this directly against `seamStep` — a `maxStepAround` amplitude
 * (discrete second-difference magnitude), not a duration — so these values
 * are amplitude thresholds, not seconds.
 *
 * Per the controller ruling, calibrated PER RATE as 5x the measured clean
 * (0.0.165-transparent) seam step at seam@bpm=120, run id 1787877750412
 * (2026-08-27): 5x headroom against false positives while staying far below
 * a real discontinuity (a hard splice/phase-flip click measures orders of
 * magnitude higher — see `onsetDetection.test.ts`'s seam test fixture).
 */
export const SEAM_THRESHOLDS: Partial<Record<number, number>> = {
  44100: 0.002455860376358032, // measured 2026-08-27, run 1787877750412: seamStep=0.0004911720752716064 x5
  48000: 0.0022414326667785645, // measured 2026-08-27, run 1787877750412: seamStep=0.0004482865333557129 x5
  88200: 0.001227855682373047, // measured 2026-08-27, run 1787877750412: seamStep=0.0002455711364746094 x5
  96000: 0.0011201202869415283, // measured 2026-08-27, run 1787877750412: seamStep=0.00022402405738830566 x5
};
