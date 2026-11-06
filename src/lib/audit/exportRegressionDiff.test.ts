import { describe, expect, it } from "vitest";
import { diffRenders } from "./exportRegressionDiff.ts";

const ch = (...v: number[]) => new Float32Array(v);

describe("diffRenders", () => {
  it("reads identical", () => expect(diffRenders([ch(1, 2)], [ch(1, 2)]).kind).toBe("identical"));
  it("reads a change of sign on zero as bit-only, with no figures", () => {
    const d = diffRenders([ch(0, 1)], [ch(-0, 1)]);
    expect(d.kind).toBe("bit-only");
    expect(d.firstDifferingFrame).toBe(0);
    expect(d.largestDifferenceDb).toBeNull();
  });
  it("labels a difference under -100 dB with no shift as rounding-sized", () => {
    const d = diffRenders([ch(0.5, 0.5, 0.5)], [ch(0.5, 0.5 + 1.2e-7, 0.5)]);
    expect(d.kind).toBe("rounding-sized");
    expect(d.firstDifferingFrame).toBe(1);
    expect(d.largestDifferenceDb!).toBeCloseTo(-138.4, 0);
  });
  it("reads a larger difference as different", () => expect(diffRenders([ch(0.5)], [ch(0.4)]).kind).toBe("different"));
  it("reads a one-frame shift as different, whatever its size", () => {
    const impulse = (at: number) => {
      const c = new Float32Array(4000);
      c[at] = 1e-6;
      return c;
    };
    const d = diffRenders([impulse(2000)], [impulse(1999)]);
    expect(d.shiftFrames).toBe(-1);
    expect(d.kind).toBe("different");
  });
  it("compares a changed length over the shared frames and never throws", () => {
    const d = diffRenders([ch(1, 2, 3)], [ch(1, 2)]);
    expect(d.kind).toBe("different");
    expect(d.acceptedFrames).toBe(3);
    expect(d.nextFrames).toBe(2);
    expect(d.firstDifferingFrame).toBeNull();
  });
  it("reads a NaN against a number as different", () => {
    expect(diffRenders([ch(1)], [ch(NaN)]).kind).toBe("different");
  });
});
