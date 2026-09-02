import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_GRID_FROM_RUN, appliedHarnessPathBiasMs, parseAuditSummary, parseMultitrackAuditSummary,
} from "./recordingAuditArtifacts";

// Minimal envelopes shaped like the generations actually on disk (see the
// module's generation table). Only the fields the loader decides on are set.
const row = (extra: Record<string, unknown> = {}) => ({
  scenario: "nominal-start", bpm: 120, rate: 48000, repeat: 1, takeIndex: 0,
  medianBeatErrorMs: -85, matchedBeats: 16, missingBeats: 0, headMissingMs: 0,
  status: "aligned", matchedSignature: null, detail: "", ...extra,
});
const base = { rate: 48000, alignedToleranceMs: 2, jankMs: 150, loopWrapTakes: 5, repeatsPerCell: 3 };

describe("parseAuditSummary — generation table", () => {
  it("G1: no build probe → build not recorded, no latency, rows unadjusted, region-anchored grid", () => {
    const s = parseAuditSummary({ ...base, rows: [row()] }, 1788284188534);
    expect(s.generation).toBe("G1-bringup");
    expect(s.sdkBuildProbe).toBe("unknown");
    expect(s.outputLatencySec).toBeNull();
    expect(s.harnessPathBiasSec).toBe(0);
    expect(s.harnessPathBiasSource).toBe("rows-unadjusted");
    expect(s.tailPersisted).toBe(false);
    expect(s.geometryPersisted).toBe(false);
    expect(s.beatGrid).toBe("region-anchored");
    expect(s.beatGridSource).toBe("run-id-cutoff");
  });
  it("G2: build probe without outputLatency", () => {
    const s = parseAuditSummary({ ...base, sdkBuildProbe: "upstream", rows: [row()] }, 1788287951691);
    expect(s.generation).toBe("G2-probe");
    expect(s.sdkBuildProbe).toBe("upstream");
    expect(s.outputLatencySec).toBeNull();
  });
  it("G3: outputLatency persisted but rows not yet adjusted → bias 0, latency known", () => {
    const s = parseAuditSummary(
      { ...base, sdkBuildProbe: "upstream", outputLatency: 0.023, baseLatency: 0.005, rows: [row({ regionStartSec: 0.05 })] },
      1788290691302
    );
    expect(s.generation).toBe("G3-latency");
    expect(s.outputLatencySec).toBe(0.023);
    expect(s.harnessPathBiasSec).toBe(0);
    expect(s.harnessPathBiasSource).toBe("rows-unadjusted");
    expect(s.geometryPersisted).toBe(true);
  });
  it("G4: harnessPathBiasSec persisted, rows carry no tailMissingMs → tail not persisted", () => {
    const s = parseAuditSummary(
      { ...base, sdkBuildProbe: "candidate", outputLatency: 0.023, harnessPathBiasSec: 0.023, rows: [row({ medianBeatErrorMsAdjusted: -62 })] },
      1788299505584
    );
    expect(s.generation).toBe("G4-adjusted");
    expect(s.harnessPathBiasSec).toBe(0.023);
    expect(s.harnessPathBiasSource).toBe("persisted");
    expect(s.tailPersisted).toBe(false);
    expect(s.beatGrid).toBe("region-anchored");
  });
  it("G5: rows carry tailMissingMs; the beat grid follows the run-id cutoff", () => {
    const envelope = { ...base, sdkBuildProbe: "upstream", outputLatency: 0.023, harnessPathBiasSec: 0.023, rows: [row({ medianBeatErrorMsAdjusted: -62, tailMissingMs: 0 })] };
    const before = parseAuditSummary(envelope, ABSOLUTE_GRID_FROM_RUN - 1);
    const first = parseAuditSummary(envelope, ABSOLUTE_GRID_FROM_RUN);
    expect(before.generation).toBe("G5-tail");
    expect(before.tailPersisted).toBe(true);
    expect(before.beatGrid).toBe("region-anchored");
    expect(first.beatGrid).toBe("absolute");
    expect(first.beatGridSource).toBe("run-id-cutoff");
  });
  it("G6: schemaVersion 2 persists the grid itself, overriding the cutoff", () => {
    const s = parseAuditSummary(
      { ...base, schemaVersion: 2, beatGrid: "absolute", sdkBuildProbe: "upstream", outputLatency: 0.023, harnessPathBiasSec: 0.023, cellVerdicts: [{ scenario: "nominal-start", bpm: 120, rate: 48000, status: "aligned", matchedSignature: null, detail: "", successfulRepeats: 3, errorRepeats: 0 }], rows: [row({ medianBeatErrorMsAdjusted: -62, tailMissingMs: 0, harnessPathBiasSec: 0.023 })] },
      ABSOLUTE_GRID_FROM_RUN - 1 // a versioned envelope never depends on its run id
    );
    expect(s.generation).toBe("G6-versioned");
    expect(s.beatGrid).toBe("absolute");
    expect(s.beatGridSource).toBe("persisted");
    expect(s.cellVerdicts).toHaveLength(1);
  });
});

describe("parseAuditSummary — validation", () => {
  it("throws on an unknown scenario instead of admitting the row", () => {
    expect(() => parseAuditSummary({ ...base, rows: [row({ scenario: "multitrack-start" })] }, 1)).toThrow(/not a recording scenario/);
  });
  it("throws when alignedToleranceMs is missing rather than defaulting it", () => {
    const { alignedToleranceMs: _omit, ...noTol } = base;
    expect(() => parseAuditSummary({ ...noTol, rows: [] }, 1)).toThrow(/alignedToleranceMs/);
  });
  it("throws on an unexpected beatGrid or sdkBuildProbe value", () => {
    expect(() => parseAuditSummary({ ...base, beatGrid: "relative", rows: [] }, 1)).toThrow(/beatGrid/);
    expect(() => parseAuditSummary({ ...base, sdkBuildProbe: "moon", rows: [] }, 1)).toThrow(/sdkBuildProbe/);
  });
});

describe("parseMultitrackAuditSummary", () => {
  const mtRow = { scenario: "multitrack-start", bpm: 120, rate: 48000, repeat: 1, tape: "a", medianBeatErrorMs: -80, medianBeatErrorMsAdjusted: -57, matchedBeats: 16, missingBeats: 0, headMissingMs: 0, headMissingRawMs: 20, tailMissingMs: 0, medianSkewMs: 0, maxAbsSkewMs: 0, pairedSkewBeats: 16, status: "aligned", detail: "" };
  const mtBase = { ...base, skewToleranceMs: 2, sdkBuildProbe: "upstream", outputLatency: 0.023, harnessPathBiasSec: 0.023 };
  it("reads confirmCollision as false when the flag predates the run", () => {
    const s = parseMultitrackAuditSummary({ ...mtBase, rows: [mtRow], cellSkews: [] }, 1788302627819);
    expect(s.confirmCollision).toBe(false);
    expect(s.beatGrid).toBe("region-anchored");
    expect(s.rows[0].tape).toBe("a");
  });
  it("rejects a single-tape scenario in a multitrack envelope", () => {
    expect(() => parseMultitrackAuditSummary({ ...mtBase, rows: [{ ...mtRow, scenario: "nominal-start" }] }, 1)).toThrow(/not a multitrack scenario/);
  });
});

describe("appliedHarnessPathBiasMs", () => {
  it("recovers the bias a row was adjusted with from adjusted − raw", () => {
    expect(appliedHarnessPathBiasMs(row({ medianBeatErrorMsAdjusted: -62 }) as never)).toBeCloseTo(23, 9);
  });
  it("is null for an unadjusted or unmeasured row", () => {
    expect(appliedHarnessPathBiasMs(row() as never)).toBeNull();
    expect(appliedHarnessPathBiasMs(row({ medianBeatErrorMs: null, medianBeatErrorMsAdjusted: null }) as never)).toBeNull();
  });
});
