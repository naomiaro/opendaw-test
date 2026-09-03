/**
 * Which band table an artifact resolves to. The rule decides how every archived
 * run in `.verify-output/` is classified, so the cases that must not move are
 * pinned here rather than re-derived by reading the code.
 */
import { describe, expect, it } from "vitest";
import {
  ALIGNED_TOLERANCE_MS,
  KEEP_ALIVE_PROFILE_FROM_RUN,
  RECORDING_AUDIT_PROFILES,
  RECORDING_AUDIT_SCENARIOS,
  SIGNATURE_BANDS,
  profileKeyFor,
  signatureBandsFor,
} from "./recordingAuditCalibration";
import { classifyCell, type TakeAlignment } from "./recordingAlignment";

/** The three surfaces each build in this branch's history exposes. */
const FEATURES = {
  /** Installed 0.0.170: none of them. */
  installed: [] as string[],
  /** Task 9's recording start-alignment branch. */
  startAlignment: ["recordingStart"],
  /** f0c44b06c — calibration routine, NO keep-alive sink. Its override is kept for A/B. */
  preKeepAliveCalibration: ["recordingStart", "calibrateInputLatency"],
  /** ac1c15ea8 — sink added, probe not yet configurable. */
  keepAlive: ["recordingStart", "calibrateInputLatency"],
  /** 3484e3265 and later — the builds bands E/F were measured on. */
  configurableProbe: ["recordingStart", "calibrateInputLatency", "latencyProbes"],
};

describe("profileKeyFor", () => {
  it("selects the candidate profile only when the served build exposes LatencyProbes", () => {
    expect(profileKeyFor("candidate", 1788386290685, FEATURES.configurableProbe)).toBe("candidate");
  });

  it("keeps a pre-keep-alive calibration build on the upstream bands", () => {
    // The regression this rule exists for: `calibrateInputLatency` alone is NOT
    // enough, because f0c44b06c exposes it and its input chain behaves
    // differently from the build bands E/F were fitted to. A run served from
    // that override would otherwise be judged against the wrong table.
    expect(profileKeyFor("candidate", 1788386290685, FEATURES.preKeepAliveCalibration)).toBe("upstream");
  });

  it("keeps the keep-alive build on the upstream bands, which is the fail-loud side", () => {
    // ac1c15ea8 has the sink but not the configurable probe, and its override is
    // also kept for A/B. Resolving it to `upstream` means a new sweep on it would
    // read `investigate` for nominal-start (its spread is ≤ 0.7 ms, below band B's
    // precondition) rather than quietly matching bands fitted to a later build —
    // the safe direction for a key that cannot see the sink itself.
    expect(profileKeyFor("candidate", 1788386290685, FEATURES.keepAlive)).toBe("upstream");
  });

  it("keeps builds with no calibration surfaces on the upstream bands", () => {
    expect(profileKeyFor("upstream", 1788386290685, FEATURES.installed)).toBe("upstream");
    expect(profileKeyFor("candidate", 1788386290685, FEATURES.startAlignment)).toBe("upstream");
  });

  it("ignores the build probe once a feature list is present — the served SDK decides, not the label", () => {
    // INTENDED (see the comment on `profileKeyFor`): a release that ships
    // `LatencyProbes` will be stamped `upstream` by the page's marker (which only
    // detects `recordingStart`), and must still be judged against E/F — bands A-D
    // were fitted to the pre-#376 release and stop describing such a build.
    expect(profileKeyFor("upstream", 1788386290685, FEATURES.configurableProbe)).toBe("candidate");
    expect(profileKeyFor("unknown", 1788386290685, FEATURES.configurableProbe)).toBe("candidate");
    expect(profileKeyFor("upstream", null, ["latencyProbes"])).toBe("candidate");
    expect(profileKeyFor(undefined, undefined, ["latencyProbes"])).toBe("candidate");
  });

  it("ignores the run token entirely once a feature list is present", () => {
    // A list, even an empty one, is a positive statement about the served build;
    // the token is only for artifacts that could not make it.
    expect(profileKeyFor("candidate", 1, FEATURES.configurableProbe)).toBe("candidate");
    expect(profileKeyFor("candidate", Number.MAX_SAFE_INTEGER, FEATURES.installed)).toBe("upstream");
  });

  it("falls back to the run token for artifacts written before the field existed", () => {
    expect(profileKeyFor("candidate", KEEP_ALIVE_PROFILE_FROM_RUN)).toBe("candidate");
    expect(profileKeyFor("candidate", KEEP_ALIVE_PROFILE_FROM_RUN - 1)).toBe("upstream");
    // Every pre-keep-alive artifact on disk: probe "candidate", id below the cutoff.
    expect(profileKeyFor("candidate", 1788383997913)).toBe("upstream");
    expect(profileKeyFor("candidate", 1788384874160)).toBe("candidate");
  });

  it("resolves upstream when nothing identifies the build", () => {
    expect(profileKeyFor(undefined)).toBe("upstream");
    expect(profileKeyFor("unknown", null, null)).toBe("upstream");
    expect(profileKeyFor("upstream", 1788386290685)).toBe("upstream");
    // A keep-alive-era token does not promote an `unknown` probe: the fallback
    // needs BOTH the candidate label and the token.
    expect(profileKeyFor("unknown", 1788386290685)).toBe("upstream");
  });
});

/**
 * The A-D table, written out. `SIGNATURE_BANDS` is documented as frozen so
 * every historical artifact keeps its verdict; an object-identity check cannot
 * catch an edit to a bound, this literal can.
 */
const FROZEN_UPSTREAM_BANDS = {
  "nominal-start": [{ id: "B", kind: "random-band", minAbsMs: 4, maxAbsMs: 25 }],
  "janked-start": [
    { id: "C", kind: "constant-late", minAbsMs: 50, maxAbsMs: 235 },
    { id: "A", kind: "head-loss", minAbsMs: 20, maxAbsMs: 300 },
  ],
  "midtimeline-start": [{ id: "A", kind: "head-loss", minAbsMs: 5, maxAbsMs: 300 }],
  "countin-start": [{ id: "B", kind: "random-band", minAbsMs: 4, maxAbsMs: 25 }],
  "loop-wrap": [{ id: "D", kind: "constant-late", minAbsMs: 15, maxAbsMs: 30 }],
};

describe("signatureBandsFor", () => {
  it("returns the frozen A-D table for upstream artifacts", () => {
    for (const scenario of RECORDING_AUDIT_SCENARIOS) {
      expect(signatureBandsFor(scenario)).toBe(SIGNATURE_BANDS[scenario]);
      expect(signatureBandsFor(scenario, "candidate", 1788383997913)).toBe(SIGNATURE_BANDS[scenario]);
    }
  });

  it("keeps the A-D table's literal values frozen", () => {
    expect(SIGNATURE_BANDS).toEqual(FROZEN_UPSTREAM_BANDS);
    expect(RECORDING_AUDIT_PROFILES.upstream.signatureBands).toEqual(FROZEN_UPSTREAM_BANDS);
  });

  it("keeps the descriptive E/F pair's literal values", () => {
    const pair = [
      { id: "E", kind: "random-band", minAbsMs: 4, maxAbsMs: 30 },
      { id: "F", kind: "constant-late", minAbsMs: 10, maxAbsMs: 30 },
    ];
    for (const scenario of RECORDING_AUDIT_SCENARIOS) {
      expect(RECORDING_AUDIT_PROFILES.candidate.signatureBands[scenario]).toEqual(pair);
    }
  });

  it("returns the descriptive E/F pair for a build that exposes LatencyProbes", () => {
    for (const scenario of RECORDING_AUDIT_SCENARIOS) {
      const bands = signatureBandsFor(scenario, "candidate", 1788386290685, FEATURES.configurableProbe);
      expect(bands.map((band) => band.id)).toEqual(["E", "F"]);
      expect(bands).toBe(RECORDING_AUDIT_PROFILES.candidate.signatureBands[scenario]);
    }
  });

  it("throws on a scenario no table knows, rather than classifying against no bands", () => {
    expect(() => signatureBandsFor("not-a-scenario")).toThrow(/no signature bands/);
  });
});

/**
 * `classifyCell` against the E/F table, on cells built from the medians the
 * bands were fitted to (runs 1788386290685 / 1788386775464, see
 * `KEEP_ALIVE_BANDS`). The order matters: E (random-band, spread-gated) is read
 * before F (constant-late, mean-gated), and the two together must leave the
 * cases the bands were NOT fitted to on `investigate`.
 */
describe("classifyCell under the candidate (E/F) profile", () => {
  const bands = signatureBandsFor("nominal-start", "candidate", 1788386290685, ["latencyProbes"]);
  const take = (medianMs: number, headMissingMs: number = 0): TakeAlignment => ({
    beatErrors: [], medianBeatErrorMs: medianMs, medianBeatErrorMsAdjusted: medianMs,
    anchorT0Sec: 5.0, firstRefIndex: 0, headMissingMs, tailMissingMs: 0,
    matchedBeats: 8, missingBeats: 0, extraLowOnsets: 0,
  });

  it("a two-state cell (spread ~8-9 ms) matches E before F reads its mean", () => {
    // The 48 kHz low/high pair: 12.29 ms against 20.29-21.63 ms, persisted as
    // adjusted medians of 13.36 and ~22.0. Mean 19.1 would also satisfy F, so
    // this pins that E claims it first.
    const c = classifyCell([take(13.36), take(22.0), take(22.0)], bands, ALIGNED_TOLERANCE_MS);
    expect(c.status).toBe("matches-known-defect");
    expect(c.matchedSignature).toBe("E");
  });

  it("a one-state cell with its mean in [10, 30] ms matches F", () => {
    // Spread 0.2 ms fails E's spread > 2·tol precondition; F is not spread-gated.
    const c = classifyCell([take(16.3), take(16.5), take(16.4)], bands, ALIGNED_TOLERANCE_MS);
    expect(c.status).toBe("matches-known-defect");
    expect(c.matchedSignature).toBe("F");
  });

  it("a one-state cell whose mean sits under F's 10 ms floor is investigate", () => {
    // Late by 8 ms on every repeat: past the 2 ms tolerance, too tight for E,
    // below the smallest cell mean F was fitted to (16.33 ms) — a drift toward
    // aligned that the descriptive band must not claim.
    const c = classifyCell([take(8.0), take(8.5), take(8.2)], bands, ALIGNED_TOLERANCE_MS);
    expect(c.status).toBe("investigate");
    expect(c.matchedSignature).toBeNull();
  });

  it("a one-state cell whose every median is EARLY is investigate — F is constant-LATE", () => {
    // Same magnitude as the F case with the sign flipped: `mean > 0` fails.
    // (E is symmetric in |median|, so an early TWO-state cell would still match
    // it; the one-state early cell is the case that must fall through.)
    const c = classifyCell([take(-16.3), take(-16.5), take(-16.4)], bands, ALIGNED_TOLERANCE_MS);
    expect(c.status).toBe("investigate");
    expect(c.matchedSignature).toBeNull();
  });

  it("a head deficit on the candidate profile is investigate — E/F carry no head-loss band", () => {
    const c = classifyCell([take(16.3, 5), take(16.5), take(16.4)], bands, ALIGNED_TOLERANCE_MS);
    expect(c.status).toBe("investigate");
    expect(c.detail).toMatch(/head deficit exceeds/);
  });
});
