import { describe, expect, it } from "vitest";
import { computedFrame, findImpulses, readRender, sha256OfSamples } from "./exportRegressionReader.ts";

describe("export regression reader", () => {
  it("reads the same hash for the same samples and another for one changed bit", async () => {
    const a = new Float32Array([0, 0.5]);
    const b = new Float32Array([-0, 0.5]);
    expect(await sha256OfSamples([a])).toBe(await sha256OfSamples([a.slice()]));
    expect(await sha256OfSamples([a])).not.toBe(await sha256OfSamples([b]));
  });
  it("finds an impulse's peak, not its first sample over the threshold", () => {
    const c = new Float32Array(3000);
    c[100] = 0.2; c[101] = 0.9; c[102] = 0.2; c[2000] = -0.8;
    expect(findImpulses(c, 0.05, 1000)).toEqual([101, 2000]);
  });
  it("computes a resampled frame", () => {
    expect(computedFrame(24037, 48000, 44100)).toBe(22084);
    expect(computedFrame(24037, 48000, 48000)).toBe(24037);
  });
  it("counts NaN and Infinity and reads energy past the range", async () => {
    const left = new Float32Array(96000); left[10] = NaN; left[11] = Infinity;
    const read = await readRender([left, new Float32Array(96000)], { rangeFrames: 48000, pageRate: 48000 });
    expect(read.nonFinite).toBe(2);
    expect(read.energyPastRange).toBe(0);
    expect((await readRender([left, left], { rangeFrames: 96000, pageRate: 48000 })).energyPastRange).toBeNull();
  });
});
