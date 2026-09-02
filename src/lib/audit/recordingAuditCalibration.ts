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
 * Total lookup into a build profile's band table: throws on a scenario name the
 * table does not know, so an offline script fed a mistyped or foreign scenario
 * can never classify against an empty band list and land a spurious `aligned` /
 * `investigate`.
 *
 * `features` is the artifact's persisted `buildFeatures` list and decides the
 * profile on its own; `build`/`runId` are the fallback for artifacts written
 * before that field existed (see `profileKeyFor`). Passing none of them selects
 * the `upstream` profile, so every call site that predates per-build profiles
 * keeps the behaviour it had.
 */
export function signatureBandsFor(
  scenario: string,
  build?: string | null,
  runId?: number | null,
  features?: readonly string[] | null
): SignatureBand[] {
  if (!isRecordingScenario(scenario)) {
    throw new Error(`no signature bands for unknown scenario "${scenario}" (known: ${RECORDING_AUDIT_SCENARIOS.join(", ")})`);
  }
  return RECORDING_AUDIT_PROFILES[profileKeyFor(build, runId, features)].signatureBands[scenario];
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
/** Predicted upstream signatures (spec §1) — predictions to test, not truths.
 *  This is the `upstream` profile's table (see `RECORDING_AUDIT_PROFILES`); it is
 *  frozen, so every historical artifact keeps classifying exactly as it did. */
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

/**
 * Which band table a run is judged against. The harness already persists the
 * build it measured (`sdkBuildProbe`), so the profile follows the artifact
 * rather than the checkout: a historical JSON classifies against the bands it
 * was designed for however the working tree has moved on.
 *
 * `unknown` (bring-up runs that predate the probe) resolves to `upstream`,
 * which is what those runs measured.
 */
export type AuditBuildProfileKey = "upstream" | "candidate";

/**
 * SDK surfaces the harness probes at load and persists per run (`buildFeatures`
 * on the envelope), so a profile follows what the served build actually exposes
 * instead of when the run happened:
 *  - `recordingStart`: the engine's one-shot audio-thread report of where and
 *    when recording began (the recording start-alignment fix).
 *  - `calibrateInputLatency`: the loopback calibration on `CaptureAudio`.
 *  - `latencyProbes`: `LatencyProbes` exported from `@opendaw/lib-dsp` (the
 *    configurable calibration probe).
 * Detection lives in `src/lib/audit/buildFeatures.ts`; this module only reasons
 * about the persisted names, so it stays free of SDK imports for the Node
 * scripts.
 */
export type AuditBuildFeature = "recordingStart" | "calibrateInputLatency" | "latencyProbes";

/**
 * Fallback for artifacts written BEFORE `buildFeatures` existed. The build probe
 * alone cannot select their profile: `sdkBuildProbe` reads `candidate` for every
 * branch build the campaign has measured, Task 9's recording start-alignment
 * branch included, whose runs the register quotes and which must keep
 * classifying against bands A-D. The run token separates those from the
 * keep-alive era — the last pre-keep-alive run is 1788383997913 and the first
 * keep-alive run is 1788384874160 — the same device `ABSOLUTE_GRID_FROM_RUN`
 * uses in recordingAuditArtifacts.ts for the beat-grid change. New runs never
 * reach this rule; they carry the feature list.
 */
export const KEEP_ALIVE_PROFILE_FROM_RUN = 1788384000000;

/**
 * Which band table an artifact is judged against.
 *
 * With `features` present the answer is a property of the served build:
 * `calibrateInputLatency` means the calibration branch, whose measured
 * behaviour bands E/F describe. Without it, the run-token fallback above
 * applies, and a caller passing neither gets `upstream` — so every call site
 * predating per-build profiles is unchanged and no historical output moves.
 *
 * Known limit: the flag cannot separate the calibration branch's own builds
 * from one another, so a future run on a PRE-keep-alive calibration build would
 * be judged against E/F. Every such run this campaign made predates
 * `buildFeatures` and therefore takes the run-token path instead.
 */
export function profileKeyFor(
  build: string | null | undefined,
  runId?: number | null,
  features?: readonly string[] | null
): AuditBuildProfileKey {
  if (Array.isArray(features)) {
    return features.includes("calibrateInputLatency") ? "candidate" : "upstream";
  }
  const isKeepAliveEra = typeof runId === "number" && Number.isFinite(runId) && runId >= KEEP_ALIVE_PROFILE_FROM_RUN;
  return build === "candidate" && isKeepAliveEra ? "candidate" : "upstream";
}

export interface RecordingAuditProfile {
  key: AuditBuildProfileKey;
  /** What the profile describes, and whether its bands are predictions or measurements. */
  description: string;
  signatureBands: Record<RecordingScenario, SignatureBand[]>;
}

/**
 * DESCRIPTIVE bands for the calibration branch's keep-alive build.
 *
 * READ THIS BEFORE QUOTING A MATCH. Bands A-D above are PREDICTIONS: the
 * campaign spec wrote them before the data existed, so a cell matching one
 * reproduced a defect that had been predicted in advance. Bands E and F are the
 * opposite — they were FITTED to the very runs they now classify, by taking the
 * measured range of those runs and rounding it outward. A cell matching E or F
 * therefore says only "this build behaved within the range it was measured to
 * behave in here"; it is close to tautological on the source runs themselves and
 * carries no predictive content until a run the bands did not come from matches
 * them. The classifier needs them so it stops reporting `investigate` for
 * behaviour that is now characterised; the register must not present a match as
 * a reproduced prediction.
 *
 * Source data — full standing sweep on SDK `3484e3265`, both rates, both bpms,
 * 3 repeats, run tokens `1788386290685` (48 kHz) and `1788386775464`
 * (44.1 kHz), persisted in `.verify-output/`:
 *  - 96 repeat medians (`medianBeatErrorMsAdjusted`, loop-wrap counted over its
 *    classified takes 1-4): min 13.36 ms, max 24.22 ms, every one LATE.
 *  - 20 cell means: min 16.33 ms, max 23.67 ms.
 *  - head and tail deficits 0 on every row of both runs; no error repeats.
 *  - Every cell's repeats land in ONE of two shapes: a single chain state
 *    (spread 0.06-2.13 ms) or two states about 8.0-9.6 ms apart (spread
 *    8.00-9.64 ms). No cell is scattered across more than two values.
 *
 * Hence two bands, in the order `classifyCell` reads them:
 *  - `E` random-band 4-30 ms catches the two-state cells (its spread > 2·tol
 *    precondition is exactly what a two-state cell satisfies and a one-state
 *    cell does not); the 4 ms floor is band B's, kept so `reachesMin` stays
 *    trivially satisfied at these magnitudes.
 *  - `F` constant-late 10-30 ms catches the one-state cells by their mean; it
 *    is not spread-gated (see `classifyCell`). The 10 ms floor sits below the
 *    smallest measured cell mean (16.33 ms) so the band cannot claim a cell
 *    that has drifted towards aligned, and 30 ms sits above the largest
 *    measured median (24.22 ms), both rounded outward to 5 ms.
 *
 * The same pair applies to every single-tape scenario because the measured data
 * no longer distinguishes them: on this build `janked-start` and
 * `midtimeline-start` produce the same magnitudes as `nominal-start` (their
 * upstream bands C and A described a late/lossy signature this build does not
 * show), and head-loss bands are unreachable with head deficits at 0.
 */
const KEEP_ALIVE_BANDS: SignatureBand[] = [
  { id: "E", kind: "random-band", minAbsMs: 4, maxAbsMs: 30 },
  { id: "F", kind: "constant-late", minAbsMs: 10, maxAbsMs: 30 },
];

export const RECORDING_AUDIT_PROFILES: Record<AuditBuildProfileKey, RecordingAuditProfile> = {
  upstream: {
    key: "upstream",
    description:
      "Predicted signatures from the campaign spec (bands A-D), tested against the installed " +
      "0.0.170 and the pre-keep-alive branch builds. Frozen so historical artifacts keep their verdicts.",
    signatureBands: SIGNATURE_BANDS,
  },
  candidate: {
    key: "candidate",
    description:
      "Measured signatures of the calibration branch's keep-alive build (bands E/F), derived from " +
      "runs 1788386290685 (48 kHz) and 1788386775464 (44.1 kHz). Descriptive, not predictive.",
    signatureBands: {
      "nominal-start": KEEP_ALIVE_BANDS,
      "janked-start": KEEP_ALIVE_BANDS,
      "midtimeline-start": KEEP_ALIVE_BANDS,
      "countin-start": KEEP_ALIVE_BANDS,
      "loop-wrap": KEEP_ALIVE_BANDS,
    },
  },
};
