import { describe, expect, it } from "vitest";
import {
  buildReferenceSchedule, bandSplit, identifyReferenceClicks, estimateAnchorT0,
} from "./recordingAlignment";

describe("buildReferenceSchedule", () => {
  it("uses unique growing gaps so consecutive pairs identify their index", () => {
    const s = buildReferenceSchedule(1.0, 5, 0.25, 0.005);
    expect(s.times[0]).toBeCloseTo(1.0, 9);
    expect(s.times[1] - s.times[0]).toBeCloseTo(0.25, 9);
    expect(s.times[2] - s.times[1]).toBeCloseTo(0.255, 9);
    expect(s.times[4] - s.times[3]).toBeCloseTo(0.265, 9);
  });
});

describe("bandSplit", () => {
  it("separates a 440Hz tone from a 6kHz tone", () => {
    const rate = 48000;
    const n = rate; // 1s
    const mixed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      mixed[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate)
               + 0.5 * Math.sin((2 * Math.PI * 6000 * i) / rate);
    }
    const { low, high } = bandSplit(mixed, rate);
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
    // Each band keeps its own tone (~0.354 rms) and rejects the other by >20 dB.
    expect(rms(low)).toBeGreaterThan(0.3);
    expect(rms(high)).toBeGreaterThan(0.3);
    const lowOnly = bandSplit(new Float32Array(mixed.map((_, i) =>
      0.5 * Math.sin((2 * Math.PI * 6000 * i) / rate))), rate).low;
    expect(rms(lowOnly)).toBeLessThan(0.035);
  });
  it("is zero-phase: a click's peak position survives filtering within 1ms", () => {
    const rate = 48000;
    const x = new Float32Array(rate);
    const clickAt = Math.round(0.5 * rate);
    for (let i = 0; i < 96; i++) x[clickAt + i] = Math.sin((2 * Math.PI * 6000 * i) / rate);
    const { high } = bandSplit(x, rate);
    let peakIdx = 0, peak = 0;
    for (let i = 0; i < high.length; i++) if (Math.abs(high[i]) > peak) { peak = Math.abs(high[i]); peakIdx = i; }
    expect(Math.abs(peakIdx - (clickAt + 48)) / rate).toBeLessThan(0.001);
  });
});

describe("identifyReferenceClicks / estimateAnchorT0", () => {
  const schedule = buildReferenceSchedule(10.0, 20, 0.25, 0.005);
  it("recovers indices and T0 from a truncated, shifted subset", () => {
    // Buffer starts at context time 11.3 → clicks 0..4 are before the buffer.
    const T0 = 11.3;
    const onsets = schedule.times.filter((t) => t >= T0).map((t) => t - T0);
    const identified = identifyReferenceClicks(onsets, schedule);
    expect(identified.length).toBe(onsets.length);
    expect(identified[0].index).toBe(schedule.times.findIndex((t) => t >= T0));
    expect(estimateAnchorT0(identified, schedule)).toBeCloseTo(T0, 4);
  });
  it("survives one spurious extra onset and one missing click", () => {
    const T0 = 10.0;
    const onsets = schedule.times.map((t) => t - T0);
    onsets.splice(3, 1);          // one missing
    onsets.push(onsets[5] + 0.03); // one spurious
    onsets.sort((a, b) => a - b);
    const identified = identifyReferenceClicks(onsets, schedule);
    // All real clicks except the removed one are identified; the spurious onset is dropped.
    expect(identified.length).toBe(19);
    expect(identified.some((c) => c.index === 3)).toBe(false);
    expect(estimateAnchorT0(identified, schedule)).toBeCloseTo(T0, 4);
  });
  it("returns empty for fewer than two onsets", () => {
    expect(identifyReferenceClicks([1.23], schedule)).toEqual([]);
    expect(estimateAnchorT0([], schedule)).toBeNull();
  });
});
