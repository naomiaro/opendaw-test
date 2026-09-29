import { describe, it, expect } from "vitest";
import {
  clampUnit, xToUnit, unitToX, regionBounds, effectiveLoop, constrainMarker,
  fadeUnits, markerKeyTarget, nudgeMarker, positionsToUnits, type MarkerValues,
} from "./nanoMarkers";

const FRAMES = 48000;
const forward: MarkerValues = { sampleStart: 0.2, sampleEnd: 0.8, loopStart: 0.3, loopEnd: 0.6 };
const reversed: MarkerValues = { sampleStart: 0.8, sampleEnd: 0.2, loopStart: 0.3, loopEnd: 0.6 };

describe("clampUnit", () => {
  it.each([[-0.5, 0], [0, 0], [0.4, 0.4], [1, 1], [1.5, 1]])("clamps %d to %d", (input, expected) => {
    expect(clampUnit(input)).toBe(expected);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("maps %d to 0", input => {
    expect(clampUnit(input)).toBe(0);
  });
});

describe("pixel mapping", () => {
  it("round-trips inside the canvas", () => {
    for (const unit of [0, 0.25, 0.5, 1]) expect(xToUnit(unitToX(unit, 640), 640)).toBeCloseTo(unit, 9);
  });
  it("clamps a pointer outside the canvas", () => {
    expect(xToUnit(-30, 640)).toBe(0);
    expect(xToUnit(900, 640)).toBe(1);
  });
  it("returns 0 for a canvas with no width", () => {
    expect(xToUnit(10, 0)).toBe(0);
  });
});

describe("regionBounds", () => {
  it("reports a forward region", () => {
    expect(regionBounds(forward, FRAMES)).toEqual({ lo: 0.2, hi: 0.8, reversed: false, empty: false });
  });
  it("reports a reversed region with ordered bounds", () => {
    expect(regionBounds(reversed, FRAMES)).toEqual({ lo: 0.2, hi: 0.8, reversed: true, empty: false });
  });
  it("reports an empty region when start meets end", () => {
    expect(regionBounds({ ...forward, sampleStart: 0.5, sampleEnd: 0.5 }, FRAMES).empty).toBe(true);
  });

  // The voice gives up when the region holds less than ONE source frame.
  it("counts a region as empty below one frame, whatever the sample's length", () => {
    const oneFrame = (frames: number) => 1 / (frames - 1);
    for (const frames of [720, 19200, 96000, 2880000]) {
      const under = { ...forward, sampleStart: 0.5, sampleEnd: 0.5 + 0.3 * oneFrame(frames) };
      const over = { ...forward, sampleStart: 0.5, sampleEnd: 0.5 + 1.5 * oneFrame(frames) };
      expect(regionBounds(under, frames).empty, `under, ${frames} frames`).toBe(true);
      expect(regionBounds(over, frames).empty, `over, ${frames} frames`).toBe(false);
    }
  });

  it("plays a region of one slider step, for values as the box stores them", () => {
    // Box fields hold 32-bit floats, so a span of 0.001 lands a hair under or over it.
    for (let k = 0; k < 1000; k++) {
      const values = { ...forward, sampleStart: Math.fround(k / 1000), sampleEnd: Math.fround((k + 1) / 1000) };
      expect(regionBounds(values, 19200).empty, `step ${k}`).toBe(false);
    }
  });

  it("plays a short slice of a long sample", () => {
    expect(regionBounds({ ...forward, sampleStart: 0.5, sampleEnd: 0.5005 }, 2880000).empty).toBe(false);
  });

  it("counts a region of a very short sample as empty when it holds less than a frame", () => {
    expect(regionBounds({ ...forward, sampleStart: 0.5, sampleEnd: 0.501 }, 720).empty).toBe(true);
  });

  it.each([0, 1, -4, Number.NaN])("counts every region of a sample of %d frames as empty", frames => {
    expect(regionBounds(forward, frames).empty).toBe(true);
  });
});

describe("effectiveLoop", () => {
  it("keeps a loop that lies inside the region", () => {
    expect(effectiveLoop(forward, FRAMES)).toEqual({ lo: 0.3, hi: 0.6, degenerate: false });
  });
  it("orders loop points given in either order", () => {
    expect(effectiveLoop({ ...forward, loopStart: 0.6, loopEnd: 0.3 }, FRAMES)).toEqual({ lo: 0.3, hi: 0.6, degenerate: false });
  });
  it("clamps a loop that sticks out of the region", () => {
    expect(effectiveLoop({ ...forward, loopStart: 0.1, loopEnd: 0.95 }, FRAMES)).toEqual({ lo: 0.2, hi: 0.8, degenerate: false });
  });
  it("behaves the same inside a reversed region", () => {
    expect(effectiveLoop({ ...reversed, loopStart: 0.1, loopEnd: 0.5 }, FRAMES)).toEqual({ lo: 0.2, hi: 0.5, degenerate: false });
  });
  it("falls back to the region when the loop is degenerate", () => {
    expect(effectiveLoop({ ...forward, loopStart: 0.4, loopEnd: 0.4 }, FRAMES)).toEqual({ lo: 0.2, hi: 0.8, degenerate: true });
  });
  it("keeps a sliver of a loop that still holds a frame, as the voice does", () => {
    const values = { sampleStart: 0.1, sampleEnd: 0.3009, loopStart: 0.3, loopEnd: 0.6 };
    const loop = effectiveLoop(values, 96000);
    expect(loop.degenerate).toBe(false);
    expect(loop.lo).toBeCloseTo(0.3, 9);
    expect(loop.hi).toBeCloseTo(0.3009, 9);
    expect(fadeUnits(0.05, 2, loop)).toBeCloseTo(0.00045, 6);
  });

  it("falls back to the region when the clamped loop holds less than a frame", () => {
    const values = { sampleStart: 0.1, sampleEnd: 0.300005, loopStart: 0.3, loopEnd: 0.6 };
    expect(effectiveLoop(values, 96000)).toEqual({ lo: 0.1, hi: 0.300005, degenerate: true });
  });

  it("falls back to the region when the loop lies wholly outside it", () => {
    expect(effectiveLoop({ ...forward, loopStart: 0.85, loopEnd: 0.95 }, FRAMES)).toEqual({ lo: 0.2, hi: 0.8, degenerate: true });
  });
});

describe("constrainMarker", () => {
  it("lets region markers reach both ends and cross each other", () => {
    expect(constrainMarker("sampleStart", 0.95, forward)).toBe(0.95);
    expect(constrainMarker("sampleEnd", -0.2, forward)).toBe(0);
  });
  it("keeps loop markers inside a forward region", () => {
    expect(constrainMarker("loopStart", 0.05, forward)).toBe(0.2);
    expect(constrainMarker("loopEnd", 0.99, forward)).toBe(0.8);
    expect(constrainMarker("loopEnd", 0.5, forward)).toBe(0.5);
  });
  it("keeps loop markers inside a reversed region", () => {
    expect(constrainMarker("loopStart", 0.05, reversed)).toBe(0.2);
    expect(constrainMarker("loopEnd", 0.99, reversed)).toBe(0.8);
  });
});

describe("fadeUnits", () => {
  const loop = { lo: 0.2, hi: 0.6, degenerate: false };
  it("converts the fade time to a share of the sample", () => {
    expect(fadeUnits(0.1, 2, loop)).toBeCloseTo(0.05, 9);
  });
  it("caps the fade at half the loop span", () => {
    expect(fadeUnits(1, 2, loop)).toBeCloseTo(0.2, 9);
  });
  it.each([0, -1, Number.NaN])("returns 0 for a sample of %d seconds", seconds => {
    expect(fadeUnits(0.1, seconds, loop)).toBe(0);
  });
});

describe("nudgeMarker", () => {
  it("steps by one hundredth", () => {
    expect(nudgeMarker(0.5, 1, false)).toBeCloseTo(0.51, 9);
    expect(nudgeMarker(0.5, -1, false)).toBeCloseTo(0.49, 9);
  });
  it("steps by one thousandth when fine", () => {
    expect(nudgeMarker(0.5, 1, true)).toBeCloseTo(0.501, 9);
  });
  it("stops at the ends", () => {
    expect(nudgeMarker(0.999, 1, false)).toBe(1);
    expect(nudgeMarker(0.001, -1, false)).toBe(0);
  });
});

describe("positionsToUnits", () => {
  it("reads positions up to the first terminator", () => {
    expect(positionsToUnits(Float32Array.of(0, 500, 1000, -1, 250), 1001)).toEqual([0, 0.5, 1]);
  });
  it("returns nothing when the first entry is the terminator", () => {
    expect(positionsToUnits(Float32Array.of(-1, 300), 1001)).toEqual([]);
  });
  it("reads all sixteen entries when every slot holds a voice and there is no terminator", () => {
    const full = Float32Array.from({ length: 16 }, (_, index) => index * 50);
    expect(positionsToUnits(full, 1001)).toEqual(Array.from({ length: 16 }, (_, index) => (index * 50) / 1000));
  });
  it("clamps a position past the sample and skips a non-finite one", () => {
    expect(positionsToUnits(Float32Array.of(5000, Number.NaN, 500, -1), 1001)).toEqual([1, 0.5]);
  });
  it.each([0, 1, -5])("returns nothing for a sample of %d frames", frames => {
    expect(positionsToUnits(Float32Array.of(0, -1), frames)).toEqual([]);
  });
});

describe("markerKeyTarget", () => {
  // Loop start is stored at 0.10 but the region begins at 0.50, so the marker is drawn at 0.50.
  const clampedLoop: MarkerValues = { sampleStart: 0.5, sampleEnd: 0.9, loopStart: 0.1, loopEnd: 0.8 };

  it("steps a region marker from where it is", () => {
    expect(markerKeyTarget("sampleStart", "ArrowRight", false, forward)).toBeCloseTo(0.21, 9);
    expect(markerKeyTarget("sampleEnd", "ArrowLeft", false, forward)).toBeCloseTo(0.79, 9);
    expect(markerKeyTarget("sampleEnd", "ArrowLeft", true, forward)).toBeCloseTo(0.799, 9);
  });

  it("steps a loop marker from where it is drawn, not from a stored value outside the region", () => {
    expect(markerKeyTarget("loopStart", "ArrowRight", false, clampedLoop)).toBeCloseTo(0.51, 9);
    expect(markerKeyTarget("loopStart", "ArrowRight", true, clampedLoop)).toBeCloseTo(0.501, 9);
  });

  it("holds a loop marker at the edge of the region when stepped outwards", () => {
    expect(markerKeyTarget("loopStart", "ArrowLeft", false, clampedLoop)).toBe(0.5);
    expect(markerKeyTarget("loopEnd", "ArrowRight", false, { ...clampedLoop, loopEnd: 0.9 })).toBe(0.9);
  });

  it("sends Home and End to the ends of the sample for a region marker", () => {
    expect(markerKeyTarget("sampleStart", "Home", false, forward)).toBe(0);
    expect(markerKeyTarget("sampleStart", "End", false, forward)).toBe(1);
  });

  it("sends Home and End to the ends of the region for a loop marker", () => {
    expect(markerKeyTarget("loopStart", "Home", false, forward)).toBe(0.2);
    expect(markerKeyTarget("loopEnd", "End", false, forward)).toBe(0.8);
    expect(markerKeyTarget("loopEnd", "End", false, reversed)).toBe(0.8);
  });

  it.each(["Enter", "a", "ArrowUp", "Tab", ""])("leaves the %s key alone", key => {
    expect(markerKeyTarget("sampleStart", key, false, forward)).toBeNull();
  });
});
