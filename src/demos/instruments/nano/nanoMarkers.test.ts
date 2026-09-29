import { describe, it, expect } from "vitest";
import {
  clampUnit, xToUnit, unitToX, regionBounds, effectiveLoop, constrainMarker,
  fadeUnits, nudgeMarker, positionsToUnits, type MarkerValues,
} from "./nanoMarkers";

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
    expect(regionBounds(forward)).toEqual({ lo: 0.2, hi: 0.8, reversed: false, empty: false });
  });
  it("reports a reversed region with ordered bounds", () => {
    expect(regionBounds(reversed)).toEqual({ lo: 0.2, hi: 0.8, reversed: true, empty: false });
  });
  it("reports an empty region when start meets end", () => {
    expect(regionBounds({ ...forward, sampleStart: 0.5, sampleEnd: 0.5 }).empty).toBe(true);
    expect(regionBounds({ ...forward, sampleStart: 0.5, sampleEnd: 0.5004 }).empty).toBe(true);
  });
});

describe("effectiveLoop", () => {
  it("keeps a loop that lies inside the region", () => {
    expect(effectiveLoop(forward)).toEqual({ lo: 0.3, hi: 0.6, degenerate: false });
  });
  it("orders loop points given in either order", () => {
    expect(effectiveLoop({ ...forward, loopStart: 0.6, loopEnd: 0.3 })).toEqual({ lo: 0.3, hi: 0.6, degenerate: false });
  });
  it("clamps a loop that sticks out of the region", () => {
    expect(effectiveLoop({ ...forward, loopStart: 0.1, loopEnd: 0.95 })).toEqual({ lo: 0.2, hi: 0.8, degenerate: false });
  });
  it("behaves the same inside a reversed region", () => {
    expect(effectiveLoop({ ...reversed, loopStart: 0.1, loopEnd: 0.5 })).toEqual({ lo: 0.2, hi: 0.5, degenerate: false });
  });
  it("falls back to the region when the loop is degenerate", () => {
    expect(effectiveLoop({ ...forward, loopStart: 0.4, loopEnd: 0.4 })).toEqual({ lo: 0.2, hi: 0.8, degenerate: true });
  });
  it("falls back to the region when the loop lies wholly outside it", () => {
    expect(effectiveLoop({ ...forward, loopStart: 0.85, loopEnd: 0.95 })).toEqual({ lo: 0.2, hi: 0.8, degenerate: true });
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
  it("reads all entries when there is no terminator", () => {
    expect(positionsToUnits(Float32Array.of(100, 200), 1001)).toEqual([0.1, 0.2]);
  });
  it("clamps a position past the sample and skips a non-finite one", () => {
    expect(positionsToUnits(Float32Array.of(5000, Number.NaN, 500, -1), 1001)).toEqual([1, 0.5]);
  });
  it.each([0, 1, -5])("returns nothing for a sample of %d frames", frames => {
    expect(positionsToUnits(Float32Array.of(0, -1), frames)).toEqual([]);
  });
});
