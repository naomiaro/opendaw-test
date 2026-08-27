import { describe, it, expect } from "vitest";
import { judgeCell, assessRateConsistency, type CellMeasurement } from "./auditVerdict";

const base: CellMeasurement = {
  family: "metronome", bpm: 120, rate: 48000,
  expected: [0, 0.5, 1.0, 1.5], onsets: [0.001, 0.501, 1.001, 1.501],
};

describe("judgeCell", () => {
  it("passes within tolerance and reports deviations", () => {
    const v = judgeCell(base, 0.002);
    expect(v.status).toBe("pass");
    expect(v.matched).toBe(4);
    expect(v.maxDeviationSec).toBeCloseTo(0.001, 6);
  });
  it("subtracts calibration bias before judging", () => {
    const v = judgeCell({ ...base, calibrationSec: 0.001 }, 0.0005);
    expect(v.status).toBe("pass");
    expect(v.maxDeviationSec).toBeLessThan(0.0005);
  });
  it("flags a missing onset as investigate", () => {
    const v = judgeCell({ ...base, onsets: [0.001, 0.501, 1.501] }, 0.002);
    expect(v.missing).toBe(1);
    expect(v.status).toBe("investigate");
  });
  it("flags an extra onset (the #367 shape) as investigate", () => {
    const v = judgeCell({ ...base, onsets: [...base.onsets, 2.0] }, 0.002);
    expect(v.extra).toBe(1);
    expect(v.status).toBe("investigate");
  });
  it("flags out-of-tolerance deviation", () => {
    const v = judgeCell({ ...base, onsets: [0.02, 0.5, 1.0, 1.5] }, 0.002);
    expect(v.status).toBe("investigate");
  });
});

describe("judgeCell pairing order-independence", () => {
  it("pairing is independent of expected-array order (reviewer's adversarial case)", () => {
    const detected = [0.0009, 0.0027];
    const a = judgeCell({ family: "metronome", bpm: 120, rate: 48000,
      expected: [0, -0.045], onsets: detected }, 0.047);
    const b = judgeCell({ family: "metronome", bpm: 120, rate: 48000,
      expected: [-0.045, 0], onsets: detected }, 0.047);
    expect(a.status).toBe("pass");
    expect(b.status).toBe("pass");
    expect(a.maxDeviationSec).toBeCloseTo(b.maxDeviationSec, 9);
    expect(a.maxDeviationSec).toBeCloseTo(0.0459, 4);
  });

  it("scarce detections pair with the truly nearest expected onset", () => {
    const v = judgeCell({ family: "metronome", bpm: 120, rate: 48000,
      expected: [0, 0.01], onsets: [0.011] }, 0.05);
    expect(v.matched).toBe(1);
    expect(v.missing).toBe(1);
    expect(v.maxDeviationSec).toBeCloseTo(0.001, 6);
  });
});

describe("assessRateConsistency", () => {
  const mk = (rate: number, dev: number) =>
    judgeCell({ ...base, rate, onsets: base.expected.map((t) => t + dev) }, 1);
  it("consistent when all rates deviate alike", () => {
    expect(assessRateConsistency(
      [mk(44100, 0.001), mk(48000, 0.0012), mk(96000, 0.0009)], 0.002
    )).toBe("consistent");
  });
  it("rate-dependent when one rate diverges (the bug signature)", () => {
    expect(assessRateConsistency(
      [mk(44100, 0.02), mk(48000, 0.0005), mk(96000, 0.0006)], 0.002
    )).toBe("rate-dependent");
  });
});
