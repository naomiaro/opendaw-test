import { describe, expect, it, vi } from "vitest";
import { computePeaks, findContentStart } from "./waveform";

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

const bufferOf = (samples: number[], sampleRate = 48000): AudioBuffer =>
  ({
    getChannelData: () => new Float32Array(samples),
    sampleRate,
  }) as unknown as AudioBuffer;

describe("findContentStart", () => {
  it("returns 0 when content starts at sample 0", () => {
    const buffer = bufferOf([0.5, 0.5, 0.5]);
    expect(findContentStart(buffer)).toBe(0);
  });
  it("falls back to 0 for an all-silent buffer and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const buffer = bufferOf([0, 0.001, -0.002, 0]);
    expect(findContentStart(buffer)).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
  it("requires strictly greater than the threshold — exact match doesn't count, just-above does", () => {
    // Index 0 sits exactly at the threshold (must NOT trigger); index 1 is
    // just above it (must trigger) — findContentStart should skip index 0
    // and report index 1.
    const buffer = bufferOf([0.01, 0.0101, 0.02], 100);
    expect(findContentStart(buffer)).toBeCloseTo(1 / 100);
  });
});
