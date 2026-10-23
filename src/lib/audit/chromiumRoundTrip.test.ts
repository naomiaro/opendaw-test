import { describe, expect, it } from "vitest";
import { clockOffsetMs, contextTimeToPerformanceMs, expectedCaptureFrame, findClickOffsets, median, percentile, performanceMsToContextTime, type ClockPair } from "./chromiumRoundTrip";

const RATE = 48000;

function capture(seconds: number, clicksAtFrame: readonly number[], noise = 0.0005): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let seed = 1;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out[i] = (seed / 2 ** 32 - 0.5) * 2 * noise;
  }
  for (const at of clicksAtFrame) {
    for (let i = 0; i < Math.round(0.008 * RATE); i++) out[at + i] += 0.3 * Math.sin((2 * Math.PI * 6000 * i) / RATE);
  }
  return out;
}

describe("findClickOffsets", () => {
  it("finds each click at its known offset from the expected frame", () => {
    const expected = [RATE, 2 * RATE, 3 * RATE];
    const offsets = [1344, 7000, 0];
    const samples = capture(4.5, expected.map((e, i) => e + offsets[i]));
    const found = findClickOffsets(samples, RATE, expected, 6000, 0.008);
    found.forEach((f, i) => {
      expect(f).not.toBeNull();
      expect(Math.abs((f as number) - offsets[i])).toBeLessThanOrEqual(8);
    });
  });

  it("finds none in a capture without clicks", () => {
    expect(findClickOffsets(capture(3, []), RATE, [RATE, 2 * RATE], 6000, 0.008)).toEqual([null, null]);
  });

  it("reports a click that arrives after the search range as missed", () => {
    const samples = capture(4, [RATE + Math.round(0.8 * RATE)]);
    expect(findClickOffsets(samples, RATE, [RATE], 6000, 0.008)).toEqual([null]);
  });
});

describe("findClickOffsets in loud broadband noise", () => {
  it("finds a click whose plain RMS is below the noise floor", () => {
    const samples = capture(3, [RATE + 5000], 0.02);
    const found = findClickOffsets(samples, RATE, [RATE], 6000, 0.008);
    expect(found[0]).not.toBeNull();
    expect(Math.abs((found[0] as number) - 5000)).toBeLessThanOrEqual(16);
  });
});

describe("median and percentile", () => {
  it("summarise", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(median([])).toBeNull();
  });
});

function pairsAt(offsetMs: number, driftMsPerSecond = 0, lateEvery = 0): ClockPair[] {
  return Array.from({ length: 150 }, (_, i) => {
    const contextTime = i * 0.1;
    const late = lateEvery > 0 && i % lateEvery === 0 ? 4 : 0;
    return { contextTime, performanceMs: contextTime * 1000 + offsetMs + driftMsPerSecond * contextTime + late };
  });
}

describe("clock pairs", () => {
  it("maps a context time to the page's clock and back", () => {
    const pairs = pairsAt(5000);
    expect(contextTimeToPerformanceMs(pairs, 7.25)).toBeCloseTo(12250, 6);
    expect(performanceMsToContextTime(pairs, 12250)).toBeCloseTo(7.25, 6);
  });

  it("takes the offset locally, so a drifting clock is followed", () => {
    const pairs = pairsAt(5000, 0.7);
    expect(clockOffsetMs(pairs, 2)).toBeCloseTo(5001.4, 0);
    expect(clockOffsetMs(pairs, 12)).toBeCloseTo(5008.4, 0);
  });

  it("ignores a pair read late on the main thread", () => {
    expect(clockOffsetMs(pairsAt(5000, 0, 3), 5)).toBeCloseTo(5000, 6);
  });

  it("places a click on a capture whose device clock is unrelated to the output's", () => {
    const output = pairsAt(5000);
    const capture = pairsAt(9000);
    // Output context 8 s is page time 13 000 ms, which is capture context 4 s.
    const frame = expectedCaptureFrame(output, capture, 8, 48000, 1000);
    expect(frame).toBeCloseTo(4 * 48000 - 1000, 3);
  });

  it("throws without any pair", () => {
    expect(() => clockOffsetMs([], 1)).toThrow();
  });
});
