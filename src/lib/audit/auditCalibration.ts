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
 * `auditVerdict.ts`. Measured as the SIGNED mean of (detected onset −
 * expected onset) over matched pairs on the bpm=120/rate=48000 control row,
 * run id 1787877588459 (post onset-detector and tail-artifact fixes, pre
 * this calibration file). A signed mean is required (not a mean of absolute
 * deviations) because a family whose residual isn't single-sign — e.g.
 * tempo-ramp, whose per-beat deviation drifts from positive to negative
 * across the ramp — would otherwise get a biased/wrong-signed correction;
 * see task-6-report.md's "Part A" addendum for the recomputation. 7 of the
 * 9 families happen to be single-sign, so their signed mean equals the
 * absolute mean already measured in Task 6 (values unchanged below). The
 * harness page's `?calibration=<json-url-encoded>` URL param (a
 * `{family: seconds}` map) overrides these per-run without a code change.
 */
export const AUDIT_CALIBRATION: Partial<Record<AuditFamily, number>> = {
  metronome: 0.0013242187500000953, // signed mean, measured 2026-08-27, run 1787877588459 (single-sign, 32 matched pairs)
  // loop-wrap: RECALIBRATED (Task 8 follow-up, register S28) after widening
  // ONSET_OPTIONS_BY_FAMILY's refractorySec to 0.6s (fixes the harness's
  // spurious release-ring re-trigger at bpm 90/97.3 — see debug/
  // sample-rate-alignment-audit.md Triage). Re-measured on the control row
  // (bpm=120/rate=48000, run id 1787881393241): value is unchanged to float
  // noise (the refractory widening only suppresses the spurious extra
  // trigger, it doesn't move the real onsets' detected time).
  "loop-wrap": 0.0037708333333333335, // signed mean, measured 2026-08-27, run 1787881393241 (single-sign, 8 matched pairs)
  // seam: no calibrationSec entry — the seam family's pass/fail reads
  // `seamStep` directly (see judgeCell's seam special case), calibration
  // never affects its verdict. Left out of this map (falls back to 0 bias).
  "region-fencepost": 0.0000208333333333181158, // signed mean, measured 2026-08-27, run 1787877588459 (single-sign, 15 matched pairs, ~1 sample at 48kHz)
  // note-onsets: RESPACED (controller ruling, Task 6 follow-up, 2026-08-27)
  // — `NOTE_ONSET_POSITIONS` widened to a 1200-tick (625ms @120) minimum
  // gap, replacing the old 480-tick (250ms @120) gap that collided with
  // Vaporisateur's ~350-400ms release ring. Re-measured against the NEW
  // scenario, run id 1787878787720: all 10 onsets are now single-sign
  // (+4.25..4.27ms raw), no outlier — the old BLOCKED status (see
  // task-6-report.md) is superseded.
  "note-onsets": 0.004262499999999924, // signed mean, measured 2026-08-27, run 1787878787720 (single-sign, 10 matched pairs, 0 missing/extra)
  // automation: RECALIBRATED (Task 8 follow-up, register S27) after
  // switching ONSET_OPTIONS_BY_FAMILY's automation entry from the default
  // fixed-64-sample hop to `hopSeconds: 64/44100` (rate-independent hop
  // duration — fixes the harness's sustained-tone false onsets at
  // 88.2k/96k, see debug/sample-rate-alignment-audit.md Triage). Re-measured
  // on the control row (bpm=120/rate=48000, run id 1787881384541): value is
  // unchanged to float noise (the hop-duration change only affects
  // sustained-tone ripple sensitivity, not the real onsets' detected time).
  automation: 0.0010347222222222222, // signed mean, measured 2026-08-27, run 1787881384541 (single-sign, 3 matched pairs)
  // tempo-ramp: NOT single-sign — deviation is +1.27ms at beat 0, crosses
  // zero around beat 10, and reaches -2.85ms at beat 31 (post closed-form
  // expectation fix). The mean-of-absolute-deviations value previously here
  // (0.0012139978521957598, Task 6) was the WRONG statistic for a bias
  // correction on a signed-varying residual; recomputed as the true signed
  // mean of (onset - expected) over all 32 matched pairs.
  "tempo-ramp": -0.0007328430372989456, // signed mean, measured 2026-08-27, run 1787877588459
  signature: 0.0013205128205128502, // signed mean, measured 2026-08-27, run 1787877588459 (single-sign, 26 matched pairs)
  "transport-pos": 0.001320312499999976, // signed mean, measured 2026-08-27, run 1787877588459 (single-sign, 8 matched pairs)
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
 * ramp — expected, see the file-header note) — documented individually.
 * `note-onsets` was recalibrated separately after a scenario respacing (see
 * its own entry below); no longer an exception.
 */
export const AUDIT_TOLERANCES: Record<AuditFamily, number> = {
  metronome: 0.002, // post-cal max dev 0.0000742s -> floor
  // loop-wrap: re-verified against the recalibrated value above (run
  // 1787881393241, Task 8 follow-up) — still ~0 (8.9e-16, float noise),
  // formula unchanged: max(0.002, 2*8.9e-16) -> floor.
  "loop-wrap": 0.002, // post-cal max dev ~0 (8.9e-16, float noise) -> floor
  seam: 0.002, // unused directly by the seam judging path — kept for Record<AuditFamily, …> completeness
  "region-fencepost": 0.002, // post-cal max dev 0 (exact) -> floor
  // note-onsets: RESPACED (Task 6 follow-up, 2026-08-27) — the old 250ms
  // gap that collided with Vaporisateur's release ring and produced a
  // sign-flipped outlier (see task-6-report.md for that BLOCKED analysis)
  // is superseded; `NOTE_ONSET_POSITIONS` now has a 625ms (@120) minimum
  // gap. Post-signed-cal residual (run 1787878787720) is a max abs
  // 0.0000125s (0.0125ms) — comfortably under the floor, so per the formula
  // tolerance = max(0.002, 2*0.0000125) = 0.002 (floor).
  "note-onsets": 0.002, // post-cal max abs residual 0.0000125s -> floor
  // automation: re-verified against the recalibrated value above (run
  // 1787881384541, Task 8 follow-up, `hopSeconds` fix) — post-cal max dev
  // 0.00093s (unchanged), formula: max(0.002, 2*0.00093) -> floor.
  automation: 0.002, // post-cal max dev 0.00093s -> floor
  // tempo-ramp: recomputed against the SIGNED-mean calibration above (not
  // the old mean-of-absolute-deviations value). Post-signed-cal residual
  // ranges from +2.00ms (beat 0) to -2.12ms (beat 31) around the new
  // (near-)zero-centered bias — max abs 0.0021180902683671583s, so
  // tolerance = max(0.002, 2*0.0021180902683671583) = 0.0042361805367343...
  "tempo-ramp": 0.004236180536734316, // 2x post-signed-cal max abs residual (0.002118090268367158s); residual grows toward the ramp's end, consistent with the engine applying the continuous tempo curve at finite block granularity rather than a bug
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
