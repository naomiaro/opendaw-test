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
    expect(judgePassThrough(dry, dry, 2400, 0.9, RATE, 8, 8).verdict).toEqual({ status: "as-predicted" });
    const late = judgePassThrough(dry, burstsAt([1240, 4240]), 2400, 0.9, RATE, 8, 8);
    expect(late.lag).toBe(240);
    expect(late.verdict.status).toBe("investigate");
  });
  it("flags a dropped or an added note by the count, which the correlation alone would clear", () => {
    const dry = burstsAt([1000, 4000, 7000, 10000, 13000, 16000, 19000, 22000]);
    const seven = judgePassThrough(dry, burstsAt([1000, 4000, 7000, 10000, 13000, 16000, 19000]), 2400, 0.9, RATE, 7, 8);
    expect(seven.score).toBeGreaterThan(0.9);
    expect(seven.verdict).toEqual({ status: "investigate", figure: "7 onsets, 8 notes in the pattern" });
    const nine = judgePassThrough(dry, burstsAt([1000, 4000, 7000, 10000, 13000, 16000, 19000, 22000, 25000]), 2400, 0.9, RATE, 9, 8);
    expect(nine.score).toBeGreaterThan(0.9);
    expect(nine.verdict.status).toBe("investigate");
  });
  it("reports a silent render as an error and a different render as a low score", () => {
    const dry = burstsAt([1000, 4000]);
    expect(judgePassThrough(dry, new Float32Array(RATE), 2400, 0.9, RATE, 8, 8).verdict.status).toBe("error");
    const different = judgePassThrough(dry, burstsAt([1000, 4000, 7000, 10000]), 2400, 0.9, RATE, 8, 8);
    expect(different.verdict.status).toBe("investigate");
    expect((different.verdict as { figure: string }).figure).toMatch(/below 0.9/);
  });
});

describe("judgeRule", () => {
  it("reports a silent render as an error before counting", () => {
    expect(judgeRule([], [1000, 4000], 1, RATE, 0).verdict).toEqual({ status: "error", message: "render is silent (peak 0): the sample did not load or the device muted it" });
  });
  it("flags an early onset too, and names the onset furthest off", () => {
    const early = judgeRule([998, 4000], [1000, 4000], 1, RATE, 1);
    expect((early.verdict as { figure: string }).figure).toMatch(/onset 0 off by -2 frames/);
    const worst = judgeRule([1000, 4002, 6997], [1000, 4000, 7000], 1, RATE, 1);
    expect((worst.verdict as { figure: string }).figure).toMatch(/onset 2 off by -3 frames/);
  });
  it("accepts one frame, flags two, and flags a count mismatch before any figure", () => {
    expect(judgeRule([1001, 4000], [1000, 4000], 1, RATE, 1).verdict).toEqual({ status: "as-predicted" });
    const off = judgeRule([1002, 4000], [1000, 4000], 1, RATE, 1);
    expect(off.verdict.status).toBe("investigate");
    expect((off.verdict as { figure: string }).figure).toMatch(/onset 0 off by 2 frames/);
    const count = judgeRule([1000, 4000, 7000], [1000, 4000], 1, RATE, 1);
    expect(count.deltas).toEqual([]);
    expect((count.verdict as { figure: string }).figure).toMatch(/3 onsets, rule predicts 2/);
  });
});
