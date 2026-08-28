import { describe, it, expect } from "vitest";
import {
  AUDIT_RATES,
  AUDIT_BPMS,
  AUDIT_SCENARIOS,
  expectedOnsets,
  expectedDownbeatIndices,
} from "./auditExpectations";

describe("audit matrix axes", () => {
  it("pins the spec's rates and BPMs", () => {
    expect(AUDIT_RATES).toEqual([44100, 48000, 88200, 96000]);
    expect(AUDIT_BPMS).toEqual([120, 90, 124, 133, 97.3]);
  });
  it("has a scenario per family", () => {
    expect(Object.keys(AUDIT_SCENARIOS).sort()).toEqual([
      "automation",
      "loop-wrap",
      "metronome",
      "note-onsets",
      "region-fencepost",
      "seam",
      "signature",
      "tempo-ramp",
      "transport-pos",
    ]);
  });
});

describe("expectedOnsets", () => {
  it("metronome at 120 BPM: 32 quarters, 0.5 s apart", () => {
    const onsets = expectedOnsets("metronome", 120);
    expect(onsets).toHaveLength(32);
    expect(onsets[0]).toBe(0);
    expect(onsets[1]).toBeCloseTo(0.5, 9);
    expect(onsets[31]).toBeCloseTo(15.5, 9);
  });
  it("loop-wrap at 120 BPM: 8 wraps 4 s apart", () => {
    const onsets = expectedOnsets("loop-wrap", 120);
    expect(onsets).toHaveLength(8);
    expect(onsets[3]).toBeCloseTo(12, 9);
  });
  it("region-fencepost at 97.3 BPM starts at 7/4 of a beat", () => {
    const beat = 60 / 97.3;
    const onsets = expectedOnsets("region-fencepost", 97.3);
    expect(onsets[0]).toBeCloseTo((7 * beat) / 4, 9);
    expect(onsets[1]).toBeCloseTo((7 * beat) / 4 + beat, 9);
  });
  it("note-onsets maps PPQN to seconds at 90 BPM", () => {
    const onsets = expectedOnsets("note-onsets", 90);
    expect(onsets[1]).toBeCloseTo((960 / 960) * (60 / 90), 9);
    expect(onsets[3]).toBeCloseTo((2400 / 960) * (60 / 90), 9);
  });
  it("automation rising edges at bars 0, 2, 3", () => {
    const bar = 4 * (60 / 124);
    const onsets = expectedOnsets("automation", 124);
    expect(onsets[0]).toBeCloseTo(0, 9);
    expect(onsets[1]).toBeCloseTo(2 * bar, 9);
    expect(onsets[2]).toBeCloseTo(3 * bar, 9);
  });
  it("tempo-ramp is monotonically slowing (intervals grow)", () => {
    const onsets = expectedOnsets("tempo-ramp", 120);
    const d0 = onsets[1] - onsets[0];
    const dEnd = onsets[onsets.length - 1] - onsets[onsets.length - 2];
    // First beat's interval is slightly MORE than 60/bpm (0.5s) because the
    // continuous tempo ramp is already slowing within that beat — a real DAW
    // integrates the ramp continuously, it doesn't hold bpm constant for one
    // whole beat then step. Task 6 measured d0 ~0.502s against the WASM
    // engine (see the "tempo-ramp" case comment in auditExpectations.ts).
    expect(d0).toBeGreaterThan(0.5);
    expect(d0).toBeCloseTo(0.5, 2);
    expect(dEnd).toBeGreaterThan(d0);
  });
  it("transport-pos first onset is 3/4 beat after the odd start", () => {
    const beat = 60 / 133;
    const onsets = expectedOnsets("transport-pos", 133);
    expect(onsets[0]).toBeCloseTo(0.75 * beat, 9);
    expect(onsets[1]).toBeCloseTo(0.75 * beat + beat, 9);
  });
  it("signature downbeat indices follow 3/4,3/4 then 4/4", () => {
    expect(expectedDownbeatIndices("signature")).toEqual([0, 3, 6, 10, 14, 18, 22]);
  });
  it("seam family has a single origin onset", () => {
    expect(expectedOnsets("seam", 120)).toEqual([0]);
  });
});
