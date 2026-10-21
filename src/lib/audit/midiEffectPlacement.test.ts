import { describe, expect, it } from "vitest";
import { judgePassThrough, judgeRule, onsetsOf } from "./midiEffectPlacement";

const RATE = 48000;
const burstsAt = (frames: number[], length = RATE): Float32Array => {
  const out = new Float32Array(length);
  for (const at of frames) for (let i = 0; i < 480 && at + i < length; i++) out[at + i] = 1 - i / 480;
  return out;
};

describe("onsetsOf", () => {
  it("finds each burst once and steps past its body", () => {
    expect(onsetsOf(burstsAt([1000, 4000, 7000]), RATE, 0.05, 30)).toEqual([1000, 4000, 7000]);
    expect(onsetsOf(new Float32Array(RATE), RATE, 0.05, 30)).toEqual([]);
  });
});

describe("judgePassThrough", () => {
  it("reads a shifted copy as its shift and an identical one as predicted", () => {
    const dry = burstsAt([1000, 4000]);
    expect(judgePassThrough(dry, dry, 2400, 0.9, RATE).verdict).toEqual({ status: "as-predicted" });
    const late = judgePassThrough(dry, burstsAt([1240, 4240]), 2400, 0.9, RATE);
    expect(late.lag).toBe(240);
    expect(late.verdict.status).toBe("investigate");
  });
  it("reports a silent render as an error and a different render as a low score", () => {
    const dry = burstsAt([1000, 4000]);
    expect(judgePassThrough(dry, new Float32Array(RATE), 2400, 0.9, RATE).verdict.status).toBe("error");
    const different = judgePassThrough(dry, burstsAt([1000, 4000, 7000, 10000]), 2400, 0.9, RATE);
    expect(different.verdict.status).toBe("investigate");
    expect((different.verdict as { figure: string }).figure).toMatch(/below 0.9/);
  });
});

describe("judgeRule", () => {
  it("accepts one frame, flags two, and flags a count mismatch before any figure", () => {
    expect(judgeRule([1001, 4000], [1000, 4000], 1, RATE).verdict).toEqual({ status: "as-predicted" });
    const off = judgeRule([1002, 4000], [1000, 4000], 1, RATE);
    expect(off.verdict.status).toBe("investigate");
    expect((off.verdict as { figure: string }).figure).toMatch(/onset 0 off by 2 frames/);
    const count = judgeRule([1000, 4000, 7000], [1000, 4000], 1, RATE);
    expect(count.deltas).toEqual([]);
    expect((count.verdict as { figure: string }).figure).toMatch(/3 onsets, rule predicts 2/);
  });
});
