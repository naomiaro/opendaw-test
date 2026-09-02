/**
 * Which band table an artifact resolves to. The rule decides how every archived
 * run in `.verify-output/` is classified, so the cases that must not move are
 * pinned here rather than re-derived by reading the code.
 */
import { describe, expect, it } from "vitest";
import {
  KEEP_ALIVE_PROFILE_FROM_RUN,
  RECORDING_AUDIT_PROFILES,
  RECORDING_AUDIT_SCENARIOS,
  SIGNATURE_BANDS,
  profileKeyFor,
  signatureBandsFor,
} from "./recordingAuditCalibration";

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

  it("keeps builds with no calibration surfaces on the upstream bands", () => {
    expect(profileKeyFor("upstream", 1788386290685, FEATURES.installed)).toBe("upstream");
    expect(profileKeyFor("candidate", 1788386290685, FEATURES.startAlignment)).toBe("upstream");
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
  });
});

describe("signatureBandsFor", () => {
  it("returns the frozen A-D table for upstream artifacts", () => {
    for (const scenario of RECORDING_AUDIT_SCENARIOS) {
      expect(signatureBandsFor(scenario)).toBe(SIGNATURE_BANDS[scenario]);
      expect(signatureBandsFor(scenario, "candidate", 1788383997913)).toBe(SIGNATURE_BANDS[scenario]);
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
