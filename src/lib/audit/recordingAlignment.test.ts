import { describe, expect, it } from "vitest";
import {
  buildReferenceSchedule, bandSplit, identifyReferenceClicks, estimateAnchorT0,
  measureTakeAlignment, classifyCell, measureCrossTrackSkew,
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

  // Task 7 recast: audioContext.outputLatency is a harness-path term (see
  // debug/recording-start-alignment-audit.md "Bring-up calibration" decomposition
  // term 1) — a real hardware round-trip cost this harness's digital loopback never
  // incurs, baked uncompensated into every no-count-in waveformOffset. Content that
  // lands exactly harnessPathBiasSec early is content the SDK actually placed
  // correctly once that unearned compensation is netted back out.
  it("computes medianBeatErrorMsAdjusted by adding harnessPathBiasSec back onto the raw median", () => {
    const biasSec = 0.023; // measured audioContext.outputLatency, both rates (register)
    const early = perfectLow.map((t) => t - biasSec);
    const a = measureTakeAlignment({
      ...base, lowOnsets: early, highOnsets: [], harnessPathBiasSec: biasSec,
    });
    // Raw signature is untouched — still reports the harness-path-inflated bias.
    expect(a.medianBeatErrorMs!).toBeCloseTo(-biasSec * 1000, 1);
    // Adjusted nets the bias out: content early by exactly the bias reads as ~0.
    expect(a.medianBeatErrorMsAdjusted!).toBeCloseTo(0, 1);
  });

  it("defaults harnessPathBiasSec to 0 so medianBeatErrorMsAdjusted equals the raw median", () => {
    const a = measureTakeAlignment({ ...base, lowOnsets: perfectLow, highOnsets: [] });
    expect(a.medianBeatErrorMsAdjusted).toBeCloseTo(a.medianBeatErrorMs!, 6);
  });

  it("medianBeatErrorMsAdjusted is null when no beats matched, same as the raw median", () => {
    const a = measureTakeAlignment({
      ...base, lowOnsets: [], highOnsets: [], harnessPathBiasSec: 0.023,
    });
    expect(a.medianBeatErrorMs).toBeNull();
    expect(a.medianBeatErrorMsAdjusted).toBeNull();
  });
});

describe("classifyCell", () => {
  const bands: SignatureBand[] = [
    { id: "B", kind: "random-band", minAbsMs: 4, maxAbsMs: 25 },
    { id: "C", kind: "constant-late", minAbsMs: 50, maxAbsMs: 235 },
    { id: "D", kind: "constant-late", minAbsMs: 15, maxAbsMs: 30 },
  ];
  // medianBeatErrorMsAdjusted defaults to the raw median (harnessPathBiasSec=0 is
  // the implicit default) so every pre-existing test below is unaffected by the
  // Task 7 adjustment — classifyCell reads the adjusted field for its verdict math.
  const take = (medianMs: number): TakeAlignment => ({
    beatErrors: [], medianBeatErrorMs: medianMs, medianBeatErrorMsAdjusted: medianMs,
    anchorT0Sec: null, firstRefIndex: 0, headMissingMs: null, tailMissingMs: null,
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
  it("matches the head-loss band when headMissingMs is in-band even with aligned medians", () => {
    const bandsWithHeadLoss: SignatureBand[] = [
      ...bands,
      { id: "A", kind: "head-loss", minAbsMs: 20, maxAbsMs: 300 },
    ];
    const withHead = (medianMs: number, headMissingMs: number) => ({
      ...take(medianMs), headMissingMs,
    });
    const c = classifyCell(
      [withHead(0.3, 50), withHead(0.2, 60), withHead(0.4, 55)],
      bandsWithHeadLoss,
      2
    );
    expect(c.status).toBe("matches-known-defect");
    expect(c.matchedSignature).toBe("A");
  });
  it("investigate when headMissingMs exceeds tolerance but no head-loss band covers it, even with aligned medians", () => {
    const bandsWithHeadLoss: SignatureBand[] = [
      ...bands,
      { id: "A", kind: "head-loss", minAbsMs: 20, maxAbsMs: 300 },
    ];
    const withHead = (medianMs: number, headMissingMs: number) => ({
      ...take(medianMs), headMissingMs,
    });
    const c = classifyCell(
      [withHead(0.3, 400), withHead(0.2, 410), withHead(0.4, 395)],
      bandsWithHeadLoss,
      2
    );
    expect(c.status).toBe("investigate");
  });
  it("tail deficit forces investigate even with aligned medians and a head-loss band present — tail is never excused", () => {
    const bandsWithHeadLoss: SignatureBand[] = [
      ...bands,
      { id: "A", kind: "head-loss", minAbsMs: 20, maxAbsMs: 300 },
    ];
    const broken = { ...take(0.3), tailMissingMs: 50 };
    const c = classifyCell([broken, take(0.2), take(0.4)], bandsWithHeadLoss, 2);
    expect(c.status).toBe("investigate");
  });

  // Task 7 recast: classification runs on medianBeatErrorMsAdjusted (raw +
  // harnessPathBiasSec·1000), not the raw median — see recordingAlignment.ts's
  // measureTakeAlignment. classifyCell itself only ever sees the already-adjusted
  // field; these mocks set raw and adjusted independently to prove classifyCell
  // reads the adjusted one.
  it("classifies aligned from the adjusted median even when the raw median is outside tolerance", () => {
    const withAdjusted = (rawMs: number, adjustedMs: number): TakeAlignment => ({
      ...take(rawMs), medianBeatErrorMsAdjusted: adjustedMs,
    });
    const c = classifyCell(
      [withAdjusted(-23, 0.4), withAdjusted(-23, -0.5), withAdjusted(-23, 0.2)],
      bands,
      2
    );
    expect(c.status).toBe("aligned");
  });

  it("still requires a real (non-null) raw measurement — a null raw median is unusable regardless of adjustment", () => {
    const unusable: TakeAlignment = { ...take(0), medianBeatErrorMs: null, medianBeatErrorMsAdjusted: null };
    const c = classifyCell([unusable, take(0.2), take(0.4)], bands, 2);
    expect(c.status).toBe("investigate");
  });
});

// Task 7b (multi-mic simultaneous-recording audit): two tapes fed CLONES of the
// SAME loopback signal (see loopbackInjection.ts's loopbackDeviceId) cancel every
// common bias (loopback-path latency, harness-path bias, metronome content itself)
// — any difference in where matched beats land between the two takes' OWN
// beatErrors IS the inter-track skew, no calibration term needed.
describe("measureCrossTrackSkew", () => {
  // Minimal TakeAlignment fixture — only `beatErrors` matters to this function;
  // the rest is measureTakeAlignment's business and irrelevant here.
  const alignment = (errors: { beat: number; errorMs: number }[]): TakeAlignment => ({
    beatErrors: errors,
    medianBeatErrorMs: null,
    medianBeatErrorMsAdjusted: null,
    anchorT0Sec: null,
    firstRefIndex: null,
    headMissingMs: null,
    tailMissingMs: null,
    matchedBeats: errors.length,
    missingBeats: 0,
    extraLowOnsets: 0,
  });

  it("reports 0 skew on every beat for identical alignments", () => {
    const a = alignment([{ beat: 0, errorMs: -90 }, { beat: 1, errorMs: -88 }, { beat: 2, errorMs: -91 }]);
    const b = alignment([{ beat: 0, errorMs: -90 }, { beat: 1, errorMs: -88 }, { beat: 2, errorMs: -91 }]);
    const skew = measureCrossTrackSkew(a, b);
    expect(skew.pairedBeats).toBe(3);
    expect(skew.medianSkewMs).toBeCloseTo(0, 9);
    expect(skew.maxAbsSkewMs).toBeCloseTo(0, 9);
    expect(skew.perBeatSkewMs.every((s) => Math.abs(s.skewMs) < 1e-9)).toBe(true);
  });

  // Sign convention: skewMs = b's errorMs minus a's errorMs (b - a), so a
  // positive skew means B's content is placed LATE relative to A's — B lags A.
  it("reports +5ms median skew when b is shifted +5ms late on every beat", () => {
    const a = alignment([{ beat: 0, errorMs: -90 }, { beat: 1, errorMs: -88 }, { beat: 2, errorMs: -91 }]);
    const b = alignment([{ beat: 0, errorMs: -85 }, { beat: 1, errorMs: -83 }, { beat: 2, errorMs: -86 }]);
    const skew = measureCrossTrackSkew(a, b);
    expect(skew.pairedBeats).toBe(3);
    expect(skew.medianSkewMs).toBeCloseTo(5, 9);
    expect(skew.maxAbsSkewMs).toBeCloseTo(5, 9);
  });

  it("reports -5ms median skew when b is shifted 5ms EARLY on every beat (sign flips)", () => {
    const a = alignment([{ beat: 0, errorMs: -90 }, { beat: 1, errorMs: -88 }]);
    const b = alignment([{ beat: 0, errorMs: -95 }, { beat: 1, errorMs: -93 }]);
    const skew = measureCrossTrackSkew(a, b);
    expect(skew.medianSkewMs).toBeCloseTo(-5, 9);
  });

  it("returns nulls and 0 paired beats for disjoint matched beat sets", () => {
    const a = alignment([{ beat: 0, errorMs: -90 }, { beat: 2, errorMs: -91 }]);
    const b = alignment([{ beat: 1, errorMs: -85 }, { beat: 3, errorMs: -86 }]);
    const skew = measureCrossTrackSkew(a, b);
    expect(skew.pairedBeats).toBe(0);
    expect(skew.medianSkewMs).toBeNull();
    expect(skew.maxAbsSkewMs).toBeNull();
    expect(skew.perBeatSkewMs).toEqual([]);
  });

  it("pairs only beats present in BOTH alignments, ignoring unmatched ones on either side", () => {
    const a = alignment([{ beat: 0, errorMs: -90 }, { beat: 1, errorMs: -88 }, { beat: 5, errorMs: -80 }]);
    const b = alignment([{ beat: 0, errorMs: -84 }, { beat: 1, errorMs: -82 }, { beat: 2, errorMs: -70 }]);
    const skew = measureCrossTrackSkew(a, b);
    expect(skew.pairedBeats).toBe(2);
    expect(skew.perBeatSkewMs.map((s) => s.beat)).toEqual([0, 1]);
    expect(skew.medianSkewMs).toBeCloseTo(6, 9); // both beats: b - a = -84-(-90)=6, -82-(-88)=6
  });

  it("median of an even number of paired beats averages the two middle values", () => {
    const a = alignment([{ beat: 0, errorMs: 0 }, { beat: 1, errorMs: 0 }, { beat: 2, errorMs: 0 }, { beat: 3, errorMs: 0 }]);
    const b = alignment([{ beat: 0, errorMs: 1 }, { beat: 1, errorMs: 2 }, { beat: 2, errorMs: 4 }, { beat: 3, errorMs: 8 }]);
    const skew = measureCrossTrackSkew(a, b);
    // skews: 1, 2, 4, 8 -> median of (2,4) = 3
    expect(skew.medianSkewMs).toBeCloseTo(3, 9);
    expect(skew.maxAbsSkewMs).toBeCloseTo(8, 9);
  });

  it("perBeatSkewMs is sorted by beat index regardless of input order", () => {
    const a = alignment([{ beat: 2, errorMs: -91 }, { beat: 0, errorMs: -90 }, { beat: 1, errorMs: -88 }]);
    const b = alignment([{ beat: 1, errorMs: -83 }, { beat: 2, errorMs: -86 }, { beat: 0, errorMs: -85 }]);
    const skew = measureCrossTrackSkew(a, b);
    expect(skew.perBeatSkewMs.map((s) => s.beat)).toEqual([0, 1, 2]);
  });
});
