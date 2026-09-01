import { describe, expect, it } from "vitest";
import {
  buildReferenceSchedule, bandSplit, identifyReferenceClicks, estimateAnchorT0,
  measureTakeAlignment, classifyCell,
} from "./recordingAlignment";
import type { TakeAlignment, SignatureBand } from "./recordingAlignment";

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

describe("measureTakeAlignment", () => {
  const bpm = 120; // beat = 0.5s
  const schedule = buildReferenceSchedule(0, 40, 0.25, 0.005);
  const base = {
    regionStartSec: 0, waveformOffsetSec: 2.0, regionDurationSec: 4.0,
    bufferDurationSec: 6.0, bpm, countInBeats: 4, schedule,
    recordRequestContextTime: null, stopRequestContextTime: null,
  };
  // Perfect capture: metronome beat k lands at file time waveformOffset + k*0.5.
  const perfectLow = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => 2.0 + k * 0.5);
  it("reports ~0 error for a perfectly placed take", () => {
    const a = measureTakeAlignment({ ...base, lowOnsets: perfectLow, highOnsets: [] });
    expect(a.medianBeatErrorMs).not.toBeNull();
    expect(Math.abs(a.medianBeatErrorMs!)).toBeLessThan(0.01);
    expect(a.matchedBeats).toBe(8);
  });
  it("reports a +30ms error when waveformOffset under-compensates by 30ms", () => {
    // Content actually at +30ms relative to where the region math expects it.
    const late = perfectLow.map((t) => t + 0.030);
    const a = measureTakeAlignment({ ...base, lowOnsets: late, highOnsets: [] });
    expect(a.medianBeatErrorMs!).toBeCloseTo(30, 1);
  });
  it("computes headMissingMs from reference clicks vs the record request time", () => {
    // Buffer starts at context 5.0 (T0), record was requested at context 4.9 →
    // 100ms of post-request signal never reached the buffer.
    const T0 = 5.0;
    const highOnsets = schedule.times.filter((t) => t >= T0).map((t) => t - T0);
    const a = measureTakeAlignment({
      ...base, lowOnsets: perfectLow, highOnsets, recordRequestContextTime: 4.9,
    });
    expect(a.anchorT0Sec).toBeCloseTo(T0, 3);
    expect(a.headMissingMs).toBeCloseTo(100, 0);
  });
  it("computes tailMissingMs when the buffer ends before the stop request", () => {
    // Buffer covers context [5.0, 11.0]; stop was requested at 11.05 → 50ms of tail lost.
    const T0 = 5.0;
    const highOnsets = schedule.times.filter((t) => t >= T0 && t <= T0 + 6).map((t) => t - T0);
    const a = measureTakeAlignment({
      ...base, lowOnsets: perfectLow, highOnsets, stopRequestContextTime: 11.05,
    });
    expect(a.tailMissingMs).toBeCloseTo(50, 0);
  });
});

describe("classifyCell", () => {
  const bands: SignatureBand[] = [
    { id: "B", kind: "random-band", minAbsMs: 4, maxAbsMs: 25 },
    { id: "C", kind: "constant-late", minAbsMs: 50, maxAbsMs: 235 },
    { id: "D", kind: "constant-late", minAbsMs: 15, maxAbsMs: 30 },
  ];
  const take = (medianMs: number): TakeAlignment => ({
    beatErrors: [], medianBeatErrorMs: medianMs, anchorT0Sec: null,
    firstRefIndex: 0, headMissingMs: null, tailMissingMs: null,
    matchedBeats: 8, missingBeats: 0, extraLowOnsets: 0,
  });
  it("aligned when every repeat is within tolerance", () => {
    expect(classifyCell([take(0.5), take(-1.1), take(0.9)], bands, 2).status).toBe("aligned");
  });
  it("matches a random-band signature when repeats scatter inside the band", () => {
    const c = classifyCell([take(9), take(-12), take(5)], bands, 2);
    expect(c.status).toBe("matches-known-defect");
    expect(c.matchedSignature).toBe("B");
  });
  it("matches a constant-late signature when repeats agree inside the band", () => {
    const c = classifyCell([take(80), take(85), take(78)], bands, 2);
    expect(c.matchedSignature).toBe("C");
  });
  it("investigate when magnitude fits no band", () => {
    expect(classifyCell([take(400), take(410), take(395)], bands, 2).status).toBe("investigate");
  });
  it("investigate when beats are missing even if placement is aligned", () => {
    const broken = { ...take(0.3), missingBeats: 2 };
    expect(classifyCell([broken, take(0.2), take(0.4)], bands, 2).status).toBe("investigate");
  });
  it("investigate when tailMissingMs exceeds tolerance even if placement is aligned", () => {
    const broken = { ...take(0.3), tailMissingMs: 50 };
    const c = classifyCell([broken, take(0.2), take(0.4)], bands, 2);
    expect(c.status).toBe("investigate");
  });
  it("is not forced to investigate on tailMissingMs when a head-loss band excuses it", () => {
    const bandsWithHeadLoss: SignatureBand[] = [
      ...bands,
      { id: "A", kind: "head-loss", minAbsMs: 20, maxAbsMs: 300 },
    ];
    const broken = { ...take(0.3), tailMissingMs: 50 };
    const c = classifyCell([broken, take(0.2), take(0.4)], bandsWithHeadLoss, 2);
    expect(c.status).not.toBe("investigate");
  });
});
