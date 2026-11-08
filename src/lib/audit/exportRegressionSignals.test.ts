import { describe, expect, it } from "vitest";
import { IMPULSE_SOURCE_FRAMES, hotSource, probeSource, sweepSource } from "./exportRegressionSignals.ts";

describe("export regression signals", () => {
  it("mixes impulses on a quantum boundary and off one", () => {
    expect(IMPULSE_SOURCE_FRAMES.filter((f) => f % 128 === 0)).toEqual([4096, 72064, 168064]);
    expect(IMPULSE_SOURCE_FRAMES.filter((f) => f % 128 !== 0)).toEqual([24037, 120037]);
  });
  it("puts one-sample impulses on the right channel and a sine on the left", () => {
    const [left, right] = probeSource(48000, 4);
    expect(left.length).toBe(192000);
    expect(right[4096]).toBeCloseTo(0.9, 6);
    expect(right[4095]).toBe(0);
    expect(right[4097]).toBe(0);
    expect(right.filter((s) => s !== 0).length).toBe(5);
    expect(Math.max(...left.subarray(0, 4800))).toBeCloseTo(0.5, 2);
  });
  it("drops impulses past the end of a short source", () => {
    expect(probeSource(48000, 0.9)[1].filter((s) => s !== 0).length).toBe(2);
  });
  it("drives the master Maximizer over its limit", () => {
    expect(Math.max(...hotSource(48000, 1)[0].subarray(0, 4800))).toBeGreaterThan(1.4);
  });
  it("sweeps the full range", () => {
    const [left] = sweepSource(48000, 4);
    const crossings = (from: number, to: number) => {
      let n = 0;
      for (let i = from + 1; i < to; i++) if (left[i - 1] < 0 !== left[i] < 0) n++;
      return n;
    };
    expect(crossings(0, 4800)).toBeLessThan(crossings(187200, 192000) / 50);
  });
});
