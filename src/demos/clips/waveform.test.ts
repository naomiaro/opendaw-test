import { describe, expect, it } from "vitest";
import { computePeaks } from "./waveform";

describe("computePeaks", () => {
  it("takes the max absolute sample per bucket", () => {
    const channel = new Float32Array([0.1, -0.5, 0.2, 0.9]);
    const peaks = computePeaks(channel, 0, 4, 2);
    expect(peaks[0]).toBeCloseTo(0.5);
    expect(peaks[1]).toBeCloseTo(0.9);
  });
  it("clamps reads past the end of the channel to silence", () => {
    const channel = new Float32Array([0.5, 0.5]);
    const peaks = computePeaks(channel, 0, 8, 4);
    expect(peaks[0]).toBe(0.5);
    expect(peaks[3]).toBe(0);
  });
  it("respects a non-zero start frame", () => {
    const channel = new Float32Array([0.9, 0.9, 0.1, 0.2]);
    const peaks = computePeaks(channel, 2, 2, 1);
    expect(peaks[0]).toBeCloseTo(0.2);
  });
});
