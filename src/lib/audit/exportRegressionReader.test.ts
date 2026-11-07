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

  describe("a render with figures to read", () => {
    const FRAMES = 96000;
    const RANGE = 48000;
    const GUARD = 4800;
    const STEP = Math.fround(0.3);
    /** 0.5 past the range on channel 0, a one-frame spike in the first guard, 0.3 from `stepAt` until past the last guard. */
    const render = (stepAt: number): Float32Array[] => {
      const left = new Float32Array(FRAMES);
      left.fill(0.5, RANGE);
      left[100] = 0.8;
      left.fill(0.3, stepAt, RANGE - GUARD + 800);
      return [left, new Float32Array(FRAMES)];
    };
    const options = { rangeFrames: RANGE, pageRate: 48000 };

    it("averages the energy past the range over every channel's samples", async () => {
      // 48000 samples of 0.5 and 48000 of 0: the root of 0.25 × 48000 / 96000
      expect((await readRender(render(20000), options)).energyPastRange).toBe(Math.sqrt(0.125));
    });
    it("reads the peak off the spike and the largest step off the interior, not the guarded spike", async () => {
      const read = await readRender(render(20000), options);
      expect(read.peak).toBe(Math.fround(0.8));
      expect(read.largestStep).toEqual({ step: STEP, frame: 20000 });
    });
    it("ignores a step inside the first guard, and one inside the last", async () => {
      expect((await readRender(render(2000), options)).largestStep).toEqual({ step: 0, frame: -1 });
      const late = render(20000);
      late[0].fill(0, 20000, RANGE);
      late[0].fill(0.3, RANGE - GUARD + 100, RANGE);
      expect((await readRender(late, options)).largestStep).toEqual({ step: 0, frame: -1 });
    });
  });
});
