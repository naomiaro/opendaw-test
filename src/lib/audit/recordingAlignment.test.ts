import { describe, expect, it } from "vitest";
import {
  buildReferenceSchedule, bandSplit, identifyReferenceClicks, estimateAnchorT0,
  measureTakeAlignment, classifyCell, classifyMultitrackCell, firstFrameCheckMs, judgedMedianMs, measureCrossTrackSkew,
  nettedSkewMs, skewDistribution, formatSkewDistribution, formatTwoDecimals,
} from "./recordingAlignment";
import type { CellClassification, CrossTrackSkew, TakeAlignment, SignatureBand, ClassifyMultitrackOptions } from "./recordingAlignment";

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
    bufferDurationSec: 6.0, bpm, schedule,
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

  // PR review (tests I2): the other branch of the clamp — the file runs PAST the
  // stop request (the ring's overshoot, or a build that keeps the buffer tail), so
  // the deficit must read 0, never negative.
  it("clamps tailMissingMs to 0 when the buffer ends after the stop request", () => {
    // Buffer covers context [5.0, 11.0]; stop was requested at 10.95, inside the buffer.
    const T0 = 5.0;
    const highOnsets = schedule.times.filter((t) => t >= T0 && t <= T0 + 6).map((t) => t - T0);
    const a = measureTakeAlignment({
      ...base, lowOnsets: perfectLow, highOnsets, stopRequestContextTime: 10.95,
    });
    expect(a.tailMissingMs).toBe(0);
  });

  // PR review (tests I1): every live row passes through the baseline subtraction
  // with HEAD_MISSING_BASELINE_MS = 26; the register's "raw = corrected + 26" and
  // "headMissingMs is 0 on all rows" claims rest on these two lines.
  describe("headMissingBaselineMs", () => {
    const T0 = 5.0;
    const highOnsets = schedule.times.filter((t) => t >= T0).map((t) => t - T0);
    it("subtracts the baseline from the raw head deficit", () => {
      // raw = (5.0 − 4.96) s = 40 ms; baseline 26 → corrected 14.
      const a = measureTakeAlignment({
        ...base, lowOnsets: perfectLow, highOnsets,
        recordRequestContextTime: 4.96, headMissingBaselineMs: 26,
      });
      expect(a.headMissingMs).toBeCloseTo(14, 1);
    });
    it("clamps at 0 when the baseline exceeds the raw deficit", () => {
      // raw = 20 ms; baseline 26 → 0, not −6.
      const a = measureTakeAlignment({
        ...base, lowOnsets: perfectLow, highOnsets,
        recordRequestContextTime: 4.98, headMissingBaselineMs: 26,
      });
      expect(a.headMissingMs).toBe(0);
    });
  });

  it("reports head/tail deficits as null when no reference clicks were identified", () => {
    const a = measureTakeAlignment({
      ...base, lowOnsets: perfectLow, highOnsets: [],
      recordRequestContextTime: 4.9, stopRequestContextTime: 11.05,
    });
    expect(a.anchorT0Sec).toBeNull();
    expect(a.headMissingMs).toBeNull();
    expect(a.tailMissingMs).toBeNull();
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

  it("numbers matched beats by their absolute timeline index, not from the region start", () => {
    // Region starts at timeline 4.0s = beat 8 at 120bpm.
    const a = measureTakeAlignment({
      ...base, regionStartSec: 4.0, waveformOffsetSec: 0, regionDurationSec: 2.0,
      lowOnsets: [0, 0.5, 1.0, 1.5], highOnsets: [],
    });
    expect(a.beatErrors.map((e) => e.beat)).toEqual([8, 9, 10, 11]);
    expect(a.missingBeats).toBe(0);
  });

  // Task 7c: a take punched in while the transport already runs lands at an
  // arbitrary off-beat position, and its first captured beat is up to a full
  // beat period after the region start. A grid anchored at the region start
  // manufactures a beat there that no capture can reach.
  describe("take punched in mid-timeline (region start off the beat grid)", () => {
    // Region at 4.045s — 45ms past beat 8 — running to 6.045s, so the beats
    // inside the presented range are 9, 10, 11 and 12 (timeline 4.5 … 6.0s).
    // Capture begins at the region start, putting beat 9 455ms into the buffer.
    const midtimeline = {
      ...base, regionStartSec: 4.045, waveformOffsetSec: 0, regionDurationSec: 2.0,
    };
    const capturedBeats = [0.455, 0.955, 1.455, 1.955]; // beats 9-12, perfectly placed

    it("reports no missing beat when every beat inside the presented range was captured", () => {
      const a = measureTakeAlignment({ ...midtimeline, lowOnsets: capturedBeats, highOnsets: [] });
      expect(a.missingBeats).toBe(0);
      expect(a.beatErrors.map((e) => e.beat)).toEqual([9, 10, 11, 12]);
    });

    it("reports ~0 error, not the region start's off-grid phase, for a correctly placed take", () => {
      const a = measureTakeAlignment({ ...midtimeline, lowOnsets: capturedBeats, highOnsets: [] });
      expect(Math.abs(a.medianBeatErrorMs!)).toBeLessThan(0.01);
    });

    it("still reports the real placement error when the take is genuinely misplaced", () => {
      const late = capturedBeats.map((t) => t + 0.030);
      const a = measureTakeAlignment({ ...midtimeline, lowOnsets: late, highOnsets: [] });
      expect(a.medianBeatErrorMs!).toBeCloseTo(30, 1);
      expect(a.missingBeats).toBe(0);
    });

    it("still catches a beat inside the presented range whose content never reached the buffer", () => {
      // Beat 9's click is absent; beats 10 and 11 are present and correct.
      const a = measureTakeAlignment({
        ...midtimeline, lowOnsets: capturedBeats.slice(1), highOnsets: [],
      });
      expect(a.missingBeats).toBe(1);
      expect(a.beatErrors.map((e) => e.beat)).toEqual([10, 11, 12]);
    });
  });

  // Task 7c fix round 1 (review M9): the two properties of the absolute grid most
  // likely to regress silently were covered only by live runs — a beat period that
  // does not terminate in binary (97.3 bpm), and a take read from part-way into a
  // shared capture buffer (waveformOffsetSec != 0, as every loop-wrap take is).
  describe("absolute grid at a non-integer tempo with a non-zero waveform offset", () => {
    const bpm973 = 97.3;
    const P = 60 / bpm973; // 0.61664954779…s, non-terminating
    // Region at beat 13 exactly, running for 4 beats, read from 3.2s into a buffer
    // whose first 3.2s belong to earlier takes.
    const regionStartSec = 13 * P;
    const waveformOffsetSec = 3.2;
    const offGrid = {
      ...base, bpm: bpm973, regionStartSec, waveformOffsetSec,
      regionDurationSec: 4 * P, bufferDurationSec: 3.2 + 4 * P,
    };
    // Beats 13-16 land at file time waveformOffset + k*P.
    const captured = [0, 1, 2, 3].map((k) => waveformOffsetSec + k * P);

    it("numbers a beat-aligned region's beats absolutely and loses none", () => {
      const a = measureTakeAlignment({ ...offGrid, lowOnsets: captured, highOnsets: [] });
      expect(a.missingBeats).toBe(0);
      expect(a.beatErrors.map((e) => e.beat)).toEqual([13, 14, 15, 16]);
      expect(Math.abs(a.medianBeatErrorMs!)).toBeLessThan(0.01);
    });

    it("reports the real error through the non-zero waveform offset", () => {
      const late = captured.map((t) => t + 0.030);
      const a = measureTakeAlignment({ ...offGrid, lowOnsets: late, highOnsets: [] });
      expect(a.medianBeatErrorMs!).toBeCloseTo(30, 1);
      expect(a.missingBeats).toBe(0);
      // Absolute numbering, not region-relative — without this the assertions
      // above pass on the old region-anchored grid too.
      expect(a.beatErrors.map((e) => e.beat)).toEqual([13, 14, 15, 16]);
    });

    it("still catches an absent in-range beat at this tempo", () => {
      const a = measureTakeAlignment({ ...offGrid, lowOnsets: captured.slice(1), highOnsets: [] });
      expect(a.missingBeats).toBe(1);
      expect(a.beatErrors.map((e) => e.beat)).toEqual([14, 15, 16]);
    });
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
  // A clean, fully measured repeat: reference clicks anchored, no head or tail
  // deficit. (A null headMissingMs means the anchor was never found and is
  // classified "integrity unmeasured" — see the dedicated test below.)
  const take = (medianMs: number): TakeAlignment => ({
    beatErrors: [], medianBeatErrorMs: medianMs, medianBeatErrorMsAdjusted: medianMs,
    anchorT0Sec: 5.0, firstRefIndex: 0, headMissingMs: 0, tailMissingMs: 0,
    matchedBeats: 8, missingBeats: 0, extraLowOnsets: 0,
  });
  it("aligned when every repeat is within tolerance", () => {
    expect(classifyCell([take(0.5), take(-1.1), take(0.9)], bands, 2).status).toBe("aligned");
  });
  // Release profile: the row's `loopbackDelayMs` — the loopback path's own input
  // delay, `firstQuantumTimeSec − anchorT0Sec` — is netted out of the adjusted
  // median before the tolerance test. Measured on the first release sweeps:
  // adjusted +10.8…+24.3 ms, delay 9.6…23.2 ms, netted +0.97…+1.19 ms.
  const netted = (adjustedMs: number, loopbackDelayMs: number | null): TakeAlignment =>
    ({ ...take(adjustedMs), loopbackDelayMs });
  it("nets the per-row loopback delay when asked, so a fixed build reads aligned", () => {
    const repeats = [netted(18.77, 17.6), netted(22.77, 21.6), netted(10.77, 9.6)];
    const unnetted = classifyCell(repeats, bands, 2);
    expect(unnetted.status).toBe("matches-known-defect"); // A-D by range coincidence
    expect(unnetted.matchedSignature).toBe("B");
    const c = classifyCell(repeats, bands, 2, { netLoopbackDelay: true });
    expect(c.status).toBe("aligned");
    expect(c.detail).toContain("medians=[1.17, 1.17, 1.17] netted on 3/3, adjusted=[18.77, 22.77, 10.77]");
  });
  it("a misplacement fails the netted verdict as investigate, whatever band the ADJUSTED values would match", () => {
    // adjusted [30, 34, 22] has mean 28.67 → band D on the un-netted path; netted [12.4, 12.4, 12.4] is
    // outside tolerance and no band applies to a netted cell
    const repeats = [netted(30, 17.6), netted(34, 21.6), netted(22, 9.6)];
    expect(classifyCell(repeats, bands, 2).matchedSignature).toBe("D");
    const c = classifyCell(repeats, bands, 2, { netLoopbackDelay: true });
    expect(c.status).toBe("investigate");
    expect(c.matchedSignature).toBeNull();
    expect(c.detail).toContain("medians=[12.40, 12.40, 12.40] netted on 3/3");
  });
  it("a netted cell never matches a band — a 15-30 ms late misplacement on a fixed build is investigate, not D", () => {
    // netted medians 18.4 / 20.4 / 16.4 sit squarely inside band D (constant-late 15-30 ms)
    const c = classifyCell([netted(36, 17.6), netted(42, 21.6), netted(26, 9.6)], bands, 2, { netLoopbackDelay: true });
    expect(c.status).toBe("investigate");
    expect(c.matchedSignature).toBeNull();
    // and a scattered 4-25 ms netted cell is not band B either
    const b = classifyCell([netted(22, 17.6), netted(26, 21.6), netted(31, 9.6)], bands, 2, { netLoopbackDelay: true });
    expect(b.status).toBe("investigate");
  });
  it("a netted cell with a head deficit is investigate even where a head-loss band would cover it", () => {
    const headLoss = [{ id: "A" as const, kind: "head-loss" as const, minAbsMs: 5, maxAbsMs: 300 }];
    const repeats = [{ ...netted(18.77, 17.6), headMissingMs: 30 }, { ...netted(22.77, 21.6), headMissingMs: 30 }];
    expect(classifyCell(repeats, headLoss, 2).status).toBe("matches-known-defect");
    expect(classifyCell(repeats, headLoss, 2, { netLoopbackDelay: true }).status).toBe("investigate");
  });
  it("nets only the repeats that carry a delay; the rest keep their adjusted median", () => {
    const c = classifyCell([netted(18.77, 17.6), netted(22.77, null), netted(10.77, 9.6)], bands, 2, { netLoopbackDelay: true });
    // judged list: two netted (1.17), one adjusted (22.77) — a mixed cell is outside tolerance and,
    // since a repeat WAS netted, no band applies
    expect(c.detail).toContain("medians=[1.17, 22.77, 1.17] netted on 2/3");
    expect(c.status).toBe("investigate");
    expect(c.matchedSignature).toBeNull();
  });
  describe("judgedMedianMs", () => {
    it("returns the adjusted median unless netting is on AND the delay is a finite number", () => {
      const r = netted(20, 17.6);
      expect(judgedMedianMs(r, false)).toBe(20);
      expect(judgedMedianMs(r, true)).toBeCloseTo(2.4, 6);
      expect(judgedMedianMs(netted(20, null), true)).toBe(20);
      expect(judgedMedianMs({ ...take(20) }, true)).toBe(20); // legacy object: field absent
      expect(judgedMedianMs(netted(20, Number.NaN), true)).toBe(20);
      expect(judgedMedianMs(netted(20, Number.POSITIVE_INFINITY), true)).toBe(20);
    });
    it("is null when the adjusted median is null", () => {
      expect(judgedMedianMs({ ...netted(20, 17.6), medianBeatErrorMsAdjusted: null }, true)).toBeNull();
    });
  });
  it("ignores loopbackDelayMs unless netting is requested", () => {
    expect(classifyCell([netted(1.1, 17.6), netted(0.5, 21.6)], bands, 2).status).toBe("aligned");
    expect(classifyCell([netted(1.1, 17.6), netted(0.5, 21.6)], bands, 2, { netLoopbackDelay: true }).status).not.toBe("aligned");
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

  // PR review (tests I5): a cell with no evidence must not read as the best verdict.
  it("investigate, never aligned, for an empty repeat list", () => {
    const c = classifyCell([], bands, 2);
    expect(c.status).toBe("investigate");
    expect(c.matchedSignature).toBeNull();
    expect(c.detail).toMatch(/no repeats/);
  });

  // PR review (errors I7): when no reference click was identified, headMissingMs is
  // null and the integrity gates would be skipped silently — a repeat whose reference
  // schedule never reached the buffer could classify aligned with no head/tail check.
  it("investigate with 'integrity unmeasured' when a repeat's headMissingMs is null, even with aligned medians", () => {
    const unmeasured = { ...take(0.3), headMissingMs: null, tailMissingMs: null };
    const c = classifyCell([unmeasured, take(0.2), take(0.4)], bands, 2);
    expect(c.status).toBe("investigate");
    expect(c.matchedSignature).toBeNull();
    expect(c.detail).toMatch(/integrity unmeasured/);
  });

  // The offline scripts reconstruct repeats from rows that predate tail persistence
  // (headMissingMs measured, tailMissingMs not persisted → null). Those rows were
  // anchored live, so only the tail gate is skipped — the verdict must be the live one.
  it("does not flag a measured head with an unpersisted (null) tail as unmeasured", () => {
    const legacy = { ...take(0.3), headMissingMs: 0, tailMissingMs: null };
    const c = classifyCell([legacy, legacy, legacy], bands, 2);
    expect(c.status).toBe("aligned");
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

describe("classifyMultitrackCell", () => {
  // The offline re-classification (task12a) runs this exact function over the
  // persisted multitrack run, so each return branch is pinned here.
  const cls = (status: CellClassification["status"], matchedSignature: string | null = null): CellClassification =>
    ({ status, matchedSignature: matchedSignature as CellClassification["matchedSignature"], detail: `${status} detail` });
  const skew = (medianSkewMs: number | null, maxAbsSkewMs: number = medianSkewMs === null ? 0 : Math.abs(medianSkewMs)): CrossTrackSkew =>
    ({ medianSkewMs, maxAbsSkewMs, pairedBeats: medianSkewMs === null ? 0 : 16, perBeatSkewMs: [] });

  it("no successful repeats → investigate", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [], 2);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/no successful repeats/);
  });

  it("a repeat with no paired beats (null skew) → investigate, counted in the detail", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0.5), skew(null), skew(0.2)], 2);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/skew unusable \(0 paired beats\) on 1\/3/);
  });

  it("skew within tolerance and both tapes clean → aligned, even when the tapes match a defect band", () => {
    // Both tapes 22 ms late in the same direction (matches-known-defect/F on
    // each) still reads `aligned` here: the quantity is the skew between them.
    const v = classifyMultitrackCell(cls("matches-known-defect", "F"), cls("matches-known-defect", "F"), [skew(0.1), skew(-1.9), skew(1.2)], 2);
    expect(v.status).toBe("aligned");
    expect(v.detail).toMatch(/both tapes individually clean/);
  });

  it("a tape that classified investigate → investigate, whatever the skew", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("investigate"), [skew(0.1), skew(0.2)], 2);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/at least one tape's own per-take alignment did not classify clean/);
  });

  it("skew past the tolerance with both tapes clean → investigate as a candidate finding", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0.5), skew(2.7), skew(0.3)], 2);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/candidate finding/);
  });

  // The saved output of the offline replay (task12a) holds these strings whole.
  it("without options: the whole detail, skew within the tolerance", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0.1), skew(-1.9), skew(1.2)], 2);
    expect(v.status).toBe("aligned");
    expect(v.detail).toBe(
      "skew within 2ms tolerance on every repeat and both tapes individually clean (tapeA=aligned, tapeB=aligned) — " +
      "medianSkewMs per repeat=[0.10, -1.90, 1.20] maxAbsMedianSkewMs=1.90"
    );
  });

  it("without options: the whole detail, skew past the tolerance", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0.5), skew(2.7), skew(0.3)], 2);
    expect(v.detail).toBe(
      "skew exceeds 2ms tolerance with both tapes otherwise clean (candidate finding — no predicted band for inter-track skew) — " +
      "medianSkewMs per repeat=[0.50, 2.70, 0.30] maxAbsMedianSkewMs=2.70"
    );
  });

  it("a skew past the tolerance in the other direction (tape b early) → investigate", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(-2.7)], 2);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^skew exceeds 2ms tolerance/);
    expect(v.detail).toMatch(/medianSkewMs per repeat=\[-2\.70\]/);
  });

  it("a skew at the tolerance passes, in either direction", () => {
    expect(classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(2), skew(-2)], 2).status).toBe("aligned");
    expect(classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(2.01)], 2).status).toBe("investigate");
  });

  it("prints a raw skew that rounds to zero without a minus sign", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(-1e-12), skew(0.5)], 2);
    expect(v.detail).toMatch(/medianSkewMs per repeat=\[0\.00, 0\.50\]/);
  });

  it("says nothing about quanta when it was not told the quantum", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0.5)], 2);
    expect(v.detail).not.toMatch(/render quanta/);
  });

  // --- Netting the two loopback streams' own delays out of the skew ---
  // Measured on a build that nets: the raw skew between the tapes equals the
  // difference of the two streams' delays, and each tape nets to the same value.
  const Q = (128 / 48000) * 1000;
  const delays = (aMs: number | null, bMs: number | null) => ({ aMs, bMs });
  const net = (loopbackDelays: ReturnType<typeof delays>[], extra: Partial<ClassifyMultitrackOptions> = {}): ClassifyMultitrackOptions =>
    ({ netLoopbackDelay: true, loopbackDelays, renderQuantumMs: Q, rawSkewLimitMs: 15, ...extra });
  const measured = {
    skews: [skew(-10.6667), skew(2.6667), skew(0), skew(-2.6667)],
    delays: [delays(20.9583, 10.2917), delays(17.625, 20.2917), delays(20.9583, 20.9583), delays(12.2917, 9.625)],
  };

  it("netted: skew that is the two streams' delay difference → aligned, and the detail says what was not shown", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), measured.skews, 2, net(measured.delays));
    expect(v.status).toBe("aligned");
    expect(v.detail).toMatch(/^netted skew within 2ms tolerance on every repeat, /);
    expect(v.detail).toMatch(/raw skew within 15ms \(largest 10\.67ms; not attributed — taken to be the two loopback streams' own delays\)/);
    expect(v.detail).toMatch(/netted on 4\/4/);
  });

  it("not netting: delays and a limit that are passed all the same change nothing", () => {
    const off = { netLoopbackDelay: false, loopbackDelays: [delays(10, 20)], rawSkewLimitMs: 15, renderQuantumMs: Q };
    // Netted, this would be −9.
    const within = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(1)], 2, off);
    expect(within.status).toBe("aligned");
    expect(within.detail).toMatch(/^skew within 2ms/);
    expect(within.detail).not.toMatch(/netted/);
    // Netted, this would be 0.
    const past = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(10)], 2, off);
    expect(past.status).toBe("investigate");
    expect(past.detail).toMatch(/^skew exceeds 2ms tolerance/);
    expect(past.detail).not.toMatch(/netted|raw skew exceeds/);
  });

  it("netted: a skew the delays do not account for → investigate, and the detail gives the netted value", () => {
    // Tape b placed 6 ms late on top of a one-quantum delay difference.
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0), skew(2.6667 + 6)], 2,
      net([delays(20, 20), delays(17.625, 20.2917)]));
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^netted skew exceeds 2ms tolerance/);
    expect(v.detail).toMatch(/nettedSkewMs per repeat=\[0\.00, 6\.00\]/);
  });

  // What netting is for: the two buffers agree, and the takes were placed 6.5 ms
  // apart against their own first-frame times.
  it("netted: a small raw skew with a large netted skew → investigate", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0.5)], 2, net([delays(16, 10)]));
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^netted skew exceeds 2ms tolerance/);
    expect(v.detail).toMatch(/nettedSkewMs per repeat=\[6\.50\]/);
  });

  it("netted: a netted skew past the tolerance in the other direction → investigate", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(-8)], 2, net([delays(12, 10)]));
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/nettedSkewMs per repeat=\[-6\.00\]/);
  });

  it("netted: a netted skew at the tolerance passes, in either direction", () => {
    const at = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(8), skew(-8)], 2, net([delays(10, 16), delays(16, 10)]));
    expect(at.status).toBe("aligned");
    expect(at.detail).toMatch(/nettedSkewMs per repeat=\[2\.00, -2\.00\]/);
    const past = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(8.01)], 2, net([delays(10, 16)]));
    expect(past.status).toBe("investigate");
  });

  it("netted: a repeat without both delays is judged on its raw skew, and marked as raw", () => {
    const passing = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(2.6667), skew(0.4)], 2,
      net([delays(17.625, 20.2917), delays(null, 20)]));
    expect(passing.status).toBe("aligned");
    expect(passing.detail).toMatch(/^netted skew \(1\/2 repeats, the rest raw\) within 2ms tolerance/);
    expect(passing.detail).toMatch(/nettedSkewMs per repeat=\[0\.00, raw 0\.40\] netted on 1\/2/);

    const failing = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(2.6667), skew(2.6667)], 2,
      net([delays(17.625, 20.2917), delays(null, 20)]));
    expect(failing.status).toBe("investigate");
    expect(failing.detail).toMatch(/^netted skew \(1\/2 repeats, the rest raw\) exceeds 2ms tolerance/);
    expect(failing.detail).toMatch(/nettedSkewMs per repeat=\[0\.00, raw 2\.67\]/);
  });

  it("netted: no repeat has both delays → every repeat judged raw, and the detail says none was netted", () => {
    const within = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0.5)], 2, net([delays(null, null)]));
    expect(within.status).toBe("aligned");
    expect(within.detail).toMatch(/^skew within 2ms/);
    expect(within.detail).toMatch(/netted on 0\/1/);
    const past = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(2.6667)], 2, net([delays(null, 20)]));
    expect(past.status).toBe("investigate");
    expect(past.detail).toMatch(/^skew exceeds 2ms tolerance/);
    expect(past.detail).toMatch(/no predicted band/);
    expect(past.detail).toMatch(/netted on 0\/1/);
  });

  // A list of another length would pair a repeat with some other repeat's delays.
  it.each([
    ["none", undefined],
    ["fewer than the repeats", [delays(17.625, 20.2917)]],
    ["more than the repeats", [delays(20, 20), delays(20, 20), delays(20, 20)]],
  ])("netted: refuses a list of delays that is not one per repeat (%s)", (_label, list) => {
    expect(() => classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0), skew(0)], 2, net([], { loopbackDelays: list })))
      .toThrow(/one delay record per repeat/);
  });

  it("netted: a repeat with no skew → investigate as unusable, before any netting", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(null), skew(2.6667)], 2,
      net([delays(20, 20), delays(17.625, 20.2917)]));
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/skew unusable \(0 paired beats\) on 1\/2/);
  });

  it("netted: a skew the delays account for prints as zero, without a minus sign", () => {
    // −2.6667 − (17.625 − 20.2917) leaves a hair below zero.
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(2.6667), skew(-2.6667)], 2,
      net([delays(17.625, 20.2917), delays(20.2917, 17.625)]));
    expect(v.detail).toMatch(/nettedSkewMs per repeat=\[0\.00, 0\.00\]/);
  });

  // Netting takes the sound's offset in the buffer out of the figure altogether, so
  // on its own it would pass a skew of any size that the two delays "account for".
  it("netted: a raw skew beyond the limit → investigate, though the delays account for it", () => {
    for (const raw of [50, -50]) {
      const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0), skew(raw)], 2,
        net([delays(20, 20), delays(20, 20 + raw)]));
      expect(v.status).toBe("investigate");
      expect(v.detail).toMatch(/^raw skew exceeds 15ms on 1\/2 repeat\(s\)/);
      expect(v.detail).not.toMatch(/netted skew exceeds/);
      expect(v.detail).toMatch(/nettedSkewMs per repeat=\[0\.00, 0\.00\]/);
    }
  });

  it("netted: a raw skew at the limit passes in either direction, one just past it does not", () => {
    expect(classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(15)], 2, net([delays(5, 20)])).status).toBe("aligned");
    expect(classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(-15)], 2, net([delays(20, 5)])).status).toBe("aligned");
    const past = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(15.01)], 2, net([delays(5, 20.01)]));
    expect(past.status).toBe("investigate");
    expect(past.detail).toMatch(/^raw skew exceeds 15ms on 1\/1 repeat\(s\)/);
  });

  // Without a limit nothing bounds how far apart the two buffers hold the sound.
  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -1])("netted: refuses a raw skew limit of %s", limit => {
    expect(() => classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0)], 2, net([delays(20, 20)], { rawSkewLimitMs: limit })))
      .toThrow(/rawSkewLimitMs/);
  });

  it("the raw skew limit says nothing new about a repeat judged on its raw skew", () => {
    const v = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(50)], 2, { rawSkewLimitMs: 15 });
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^skew exceeds 2ms tolerance/);
  });

  it("netted: a tape that classified investigate is what the detail names, whatever the skew", () => {
    const within = classifyMultitrackCell(cls("aligned"), cls("investigate"), measured.skews, 2, net(measured.delays));
    expect(within.status).toBe("investigate");
    expect(within.detail).toMatch(/did not classify clean/);
    const beyond = classifyMultitrackCell(cls("investigate"), cls("aligned"), [skew(50)], 2, net([delays(20, 70)]));
    expect(beyond.status).toBe("investigate");
    expect(beyond.detail).toMatch(/did not classify clean/);
  });

  it("reports how the raw skew is spread over render quanta on either verdict", () => {
    const aligned = classifyMultitrackCell(cls("aligned"), cls("aligned"), measured.skews, 2, net(measured.delays));
    expect(aligned.status).toBe("aligned");
    expect(aligned.detail).toMatch(/raw skew in render quanta: 0 ×1, 1 ×2, 4 ×1$/);
    const investigate = classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0), skew(8.6667)], 2,
      net([delays(20, 20), delays(17.625, 20.2917)]));
    expect(investigate.status).toBe("investigate");
    expect(investigate.detail).toMatch(/raw skew in render quanta: 0 ×1, 3\.25 ×1$/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("refuses a render quantum of %s", quantum => {
    expect(() => classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(0)], 2, { renderQuantumMs: quantum }))
      .toThrow(/render quantum/);
  });
});

describe("classifyMultitrackCell with node delays", () => {
  const cls = (status: CellClassification["status"]): CellClassification =>
    ({ status, matchedSignature: null, detail: `${status} detail` });
  const skew = (medianSkewMs: number): CrossTrackSkew =>
    ({ medianSkewMs, maxAbsSkewMs: Math.abs(medianSkewMs), pairedBeats: 16, perBeatSkewMs: [] });
  // Whole numbers and an offset of 1, so every figure below is exact.
  const OFFSET = 1;
  const pair = (aMs: number | null, bMs: number | null) => ({ aMs, bMs });
  /** A repeat whose tapes recorded through nodes of these delays, with true first-frame times. */
  const honest = (nodeA: number, nodeB: number) => ({
    skew: skew(nodeB - nodeA), loopback: pair(nodeA + OFFSET, nodeB + OFFSET), node: pair(nodeA, nodeB),
  });
  type Repeat = { skew: CrossTrackSkew; loopback: { aMs: number | null; bMs: number | null }; node: { aMs: number | null; bMs: number | null } };
  const classify = (repeats: Repeat[], a = cls("aligned"), b = cls("aligned")) =>
    classifyMultitrackCell(a, b, repeats.map((r) => r.skew), 2, {
      netLoopbackDelay: true, rawSkewLimitMs: 15,
      loopbackDelays: repeats.map((r) => r.loopback),
      nodeDelays: { pairs: repeats.map((r) => r.node), anchorOffsetMs: OFFSET },
    });

  it("a raw skew the two nodes' delays account for → aligned, the whole detail", () => {
    const v = classify([honest(10, 20), honest(18, 18), honest(21, 12)]);
    expect(v.status).toBe("aligned");
    expect(v.detail).toBe(
      "netted skew within 2ms tolerance on every repeat, " +
      "raw skew accounted for by the two source nodes' own delays on every repeat (largest raw 10.00ms, largest left over 0.00ms), " +
      "first-frame times true on every tape (largest deviation 0.00ms) " +
      "and both tapes individually clean (tapeA=aligned, tapeB=aligned) — " +
      "medianSkewMs per repeat=[10.00, 0.00, -9.00] maxAbsMedianSkewMs=10.00 " +
      "nettedSkewMs per repeat=[0.00, 0.00, 0.00] netted on 3/3 " +
      "node delays on 3/3 repeats (6/6 tapes) unaccountedSkewMs per repeat=[0.00, 0.00, 0.00] " +
      "firstFrameCheckMs per repeat a=[0.00, 0.00, 0.00] b=[0.00, 0.00, 0.00]"
    );
    expect(v.nodeDelayUse).toEqual({ tapesRead: 6, repeatsRead: 3, repeatsOnRawLimit: 0 });
  });

  it("does not hold a repeat with node delays to the raw limit", () => {
    const v = classify([honest(10, 30)]);
    expect(v.status).toBe("aligned");
    expect(v.detail).not.toMatch(/raw skew within 15ms/);
    expect(v.detail).toMatch(/largest raw 20\.00ms/);
  });

  it("a first-frame time one quantum late on one tape → investigate, though the netted skew is zero", () => {
    // Tape b's buffer starts 3 ms after the time the SDK gives for it: its anchor moves
    // with it, so the loopback delay reads 3 ms long and the netting cancels the lot.
    const late: Repeat = { skew: skew(13), loopback: pair(11, 24), node: pair(10, 20) };
    const v = classify([honest(10, 20), late]);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^first-frame time off by more than 2ms on 1\/2 repeat\(s\)/);
    expect(v.detail).toMatch(/nettedSkewMs per repeat=\[0\.00, 0\.00\]/);
    expect(v.detail).toMatch(/firstFrameCheckMs per repeat a=\[0\.00, 0\.00\] b=\[0\.00, 3\.00\]/);
    expect(v.detail).toMatch(/unaccountedSkewMs per repeat=\[0\.00, 3\.00\]/);
  });

  it("a first-frame time that is early fails like one that is late", () => {
    const early: Repeat = { skew: skew(7), loopback: pair(11, 18), node: pair(10, 20) };
    expect(classify([early]).status).toBe("investigate");
    expect(classify([early]).detail).toMatch(/b=\[-3\.00\]/);
  });

  it("both first-frame times off by the same amount → investigate, and nothing else sees it", () => {
    // Both buffers start 3 ms after the times given for them. The skew is what the
    // nodes' delays differ by, netted or not; only the first-frame check moves.
    const late: Repeat = { skew: skew(10), loopback: pair(14, 24), node: pair(10, 20) };
    const v = classify([late]);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^first-frame time off by more than 2ms on 1\/1/);
    expect(v.detail).toMatch(/nettedSkewMs per repeat=\[0\.00\]/);
    expect(v.detail).toMatch(/unaccountedSkewMs per repeat=\[0\.00\]/);
    expect(v.detail).toMatch(/a=\[3\.00\] b=\[3\.00\]/);
    const early: Repeat = { skew: skew(10), loopback: pair(8, 18), node: pair(10, 20) };
    expect(classify([early]).status).toBe("investigate");
    expect(classify([early]).detail).toMatch(/a=\[-3\.00\] b=\[-3\.00\]/);
  });

  it("checks tape a's first-frame time as it checks tape b's", () => {
    const lateA: Repeat = { skew: skew(7), loopback: pair(14, 21), node: pair(10, 20) };
    const v = classify([lateA]);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^first-frame time off/);
    expect(v.detail).toMatch(/a=\[3\.00\] b=\[0\.00\]/);
  });

  it("a first-frame deviation at the tolerance passes, past it fails", () => {
    const at: Repeat = { skew: skew(12), loopback: pair(11, 23), node: pair(10, 20) };
    const past: Repeat = { skew: skew(12.5), loopback: pair(11, 23.5), node: pair(10, 20) };
    expect(classify([at]).status).toBe("aligned");
    expect(classify([past]).status).toBe("investigate");
  });

  it("takes the anchor's offset out before it judges", () => {
    // With the offset ignored both tapes would read 1 ms off, inside the tolerance,
    // and 3.5 ms would read 3.5: the verdicts are the same. At 1.5 past the offset
    // the two readings part: 1.5 passes, 2.5 would not.
    const repeat: Repeat = { skew: skew(10), loopback: pair(12.5, 22.5), node: pair(10, 20) };
    const v = classify([repeat]);
    expect(v.status).toBe("aligned");
    expect(v.detail).toMatch(/a=\[1\.50\] b=\[1\.50\]/);
  });

  it("what the nodes leave over is judged on its own: both checks inside the tolerance, the remainder not", () => {
    // a reads 1.5 early, b 1.5 late, the netted skew is 1.5: each within 2 ms, and
    // the raw skew is 4.5 ms more than the nodes' delays differ by.
    const repeat: Repeat = { skew: skew(14.5), loopback: pair(9.5, 22.5), node: pair(10, 20) };
    const v = classify([repeat]);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^raw skew differs from what the two source nodes' delays account for by more than 2ms on 1\/1/);
    expect(v.detail).toMatch(/unaccountedSkewMs per repeat=\[4\.50\]/);
  });

  it("judges a remainder the other way round the same", () => {
    const repeat: Repeat = { skew: skew(5.5), loopback: pair(12.5, 19.5), node: pair(10, 20) };
    const v = classify([repeat]);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^raw skew differs from what the two source nodes' delays account for/);
    expect(v.detail).toMatch(/unaccountedSkewMs per repeat=\[-4\.50\]/);
  });

  it("the two tapes' node delays the wrong way round → investigate", () => {
    const swapped: Repeat = { skew: skew(10), loopback: pair(11, 21), node: pair(20, 10) };
    const v = classify([swapped]);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^first-frame time off/);
    expect(v.detail).toMatch(/a=\[-10\.00\] b=\[10\.00\]/);
    expect(v.detail).toMatch(/unaccountedSkewMs per repeat=\[20\.00\]/);
  });

  it("a repeat whose tap read nothing is held to the raw limit, the others are not", () => {
    const untapped = (raw: number): Repeat => ({ skew: skew(raw), loopback: pair(11, 11 + raw), node: pair(null, null) });
    const within = classify([honest(10, 30), untapped(10), honest(18, 18)]);
    expect(within.status).toBe("aligned");
    expect(within.detail).toMatch(/accounted for by the two source nodes' own delays on 2\/3 repeats \(largest raw 20\.00ms/);
    expect(within.detail).toMatch(/first-frame times true on 4\/6 tapes/);
    expect(within.detail).toMatch(/raw skew within 15ms on the 1 repeat\(s\) without both node delays \(largest 10\.00ms; not attributed\)/);
    expect(within.detail).toMatch(/node delays on 2\/3 repeats \(4\/6 tapes\) unaccountedSkewMs per repeat=\[0\.00, —, 0\.00\]/);
    expect(within.nodeDelayUse).toEqual({ tapesRead: 4, repeatsRead: 2, repeatsOnRawLimit: 1 });
    const beyond = classify([honest(10, 30), untapped(16)]);
    expect(beyond.status).toBe("investigate");
    expect(beyond.detail).toMatch(/^raw skew exceeds 15ms on 1\/2 repeat\(s\)/);
  });

  it("checks the first-frame time of a tape whose tap read, when the other tape's did not", () => {
    // Tape a's buffer starts 30 ms after the time given for it; tape b's tap read
    // nothing. The raw skew is 0 and inside the raw limit: nothing but tape a's
    // own check can see it.
    const lost: Repeat = { skew: skew(0), loopback: pair(41, 41), node: pair(10, null) };
    const v = classify([honest(10, 20), lost]);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^first-frame time off by more than 2ms on 1\/2 repeat\(s\)/);
    expect(v.detail).toMatch(/node delays on 1\/2 repeats \(3\/4 tapes\)/);
    expect(v.detail).toMatch(/firstFrameCheckMs per repeat a=\[0\.00, 30\.00\] b=\[0\.00, —\]/);
    expect(v.detail).toMatch(/unaccountedSkewMs per repeat=\[0\.00, —\]/);
    expect(v.nodeDelayUse).toEqual({ tapesRead: 3, repeatsRead: 1, repeatsOnRawLimit: 1 });
    const other: Repeat = { skew: skew(0), loopback: pair(41, 41), node: pair(null, 10) };
    expect(classify([honest(10, 20), other]).detail).toMatch(/a=\[0\.00, —\] b=\[0\.00, 30\.00\]/);
  });

  it("a tape read on a repeat that is on the raw limit counts, and passes when its time is true", () => {
    const half: Repeat = { skew: skew(3), loopback: pair(11, 14), node: pair(10, null) };
    const v = classify([honest(10, 20), half]);
    expect(v.status).toBe("aligned");
    expect(v.detail).toMatch(/first-frame times true on 3\/4 tapes/);
    expect(v.detail).toMatch(/raw skew within 15ms on the 1 repeat\(s\) without both node delays \(largest 3\.00ms; not attributed\)/);
  });

  it("with taps and no repeat that has both node delays → investigate, and not as a finding about the SDK", () => {
    const repeats: Repeat[] = [
      { skew: skew(10), loopback: pair(11, 21), node: pair(null, null) },
      { skew: skew(0), loopback: pair(11, 11), node: pair(10, null) },
    ];
    const v = classify(repeats);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/^the node taps gave no repeat both of its node delays/);
    expect(v.detail).toMatch(/not a finding about the SDK/);
    expect(v.detail).toMatch(/node delays on 0\/2 repeats \(1\/4 tapes\)/);
    expect(v.nodeDelayUse).toEqual({ tapesRead: 1, repeatsRead: 0, repeatsOnRawLimit: 2 });
    // The same repeats without taps pass on the raw limit, as a run without taps does.
    const without = classifyMultitrackCell(cls("aligned"), cls("aligned"), repeats.map((r) => r.skew), 2, {
      netLoopbackDelay: true, rawSkewLimitMs: 15, loopbackDelays: repeats.map((r) => r.loopback),
    });
    expect(without.status).toBe("aligned");
    expect(without.nodeDelayUse).toBeNull();
    expect(without.detail).not.toMatch(/node delays/);
  });

  it("with no tape read at all it says so in the detail", () => {
    const v = classify([{ skew: skew(1), loopback: pair(11, 12), node: pair(null, null) }]);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/node delays on 0\/1 repeats \(0\/2 tapes\)$/);
  });

  it("a finding comes before the taps having read nothing", () => {
    const beyond = classify([{ skew: skew(16), loopback: pair(11, 27), node: pair(null, null) }]);
    expect(beyond.detail).toMatch(/^raw skew exceeds 15ms/);
    const off = classify([{ skew: skew(0), loopback: pair(41, 41), node: pair(10, null) }]);
    expect(off.detail).toMatch(/^first-frame time off/);
  });

  it("node delays without loopback delays are not read: the repeat is judged raw", () => {
    const v = classify([{ skew: skew(1), loopback: pair(null, null), node: pair(10, 20) }]);
    expect(v.status).toBe("aligned");
    expect(v.detail).toMatch(/nettedSkewMs|netted on 0\/1/);
    expect(v.detail).toMatch(/node delays on 0\/1 repeats \(0\/2 tapes\)/);
    expect(v.nodeDelayUse).toEqual({ tapesRead: 0, repeatsRead: 0, repeatsOnRawLimit: 0 });
  });

  it("a tape that classified investigate comes first", () => {
    const late: Repeat = { skew: skew(13), loopback: pair(11, 24), node: pair(10, 20) };
    const v = classify([late], cls("aligned"), cls("investigate"));
    expect(v.detail).toMatch(/^at least one tape's own per-take alignment did not classify clean/);
  });

  it("does not read node delays when it does not net", () => {
    const skews = [skew(0.5), skew(-1)];
    const plain = classifyMultitrackCell(cls("aligned"), cls("aligned"), skews, 2);
    const given = classifyMultitrackCell(cls("aligned"), cls("aligned"), skews, 2, {
      nodeDelays: { pairs: [pair(10, 20), pair(10, 20)], anchorOffsetMs: OFFSET },
    });
    expect(given).toEqual(plain);
    expect(plain.nodeDelayUse).toBeNull();
  });

  it("refuses node delays it cannot pair with the repeats, or without an offset", () => {
    const base = { netLoopbackDelay: true, rawSkewLimitMs: 15, loopbackDelays: [pair(11, 21)] };
    const call = (extra: object) => () => classifyMultitrackCell(cls("aligned"), cls("aligned"), [skew(10)], 2, { ...base, ...extra });
    expect(call({ nodeDelays: { pairs: [], anchorOffsetMs: OFFSET } })).toThrow(/one record per repeat: 0 record\(s\) for 1 repeat/);
    expect(call({ nodeDelays: { pairs: [pair(10, 20)], anchorOffsetMs: Number.NaN } })).toThrow(/need an anchorOffsetMs/);
    expect(call({ nodeDelays: { pairs: [pair(10, 20)], anchorOffsetMs: Number.POSITIVE_INFINITY } })).toThrow(/need an anchorOffsetMs/);
  });
});

describe("firstFrameCheckMs", () => {
  it("is what the loopback delay exceeds the node's delay by, less the anchor's offset", () => {
    expect(firstFrameCheckMs(21, 20, 1)).toBe(0);
    expect(firstFrameCheckMs(24, 20, 1)).toBe(3);
    expect(firstFrameCheckMs(18, 20, 1)).toBe(-3);
  });

  it("is null when either delay is unknown", () => {
    expect(firstFrameCheckMs(null, 20, 1)).toBeNull();
    expect(firstFrameCheckMs(21, null, 1)).toBeNull();
    expect(firstFrameCheckMs(undefined, 20, 1)).toBeNull();
    expect(firstFrameCheckMs(21, Number.NaN, 1)).toBeNull();
  });
});

describe("formatTwoDecimals", () => {
  it("prints two decimals, and a value that rounds to zero without a minus sign", () => {
    expect(formatTwoDecimals(12.3456)).toBe("12.35");
    expect(formatTwoDecimals(-6.2)).toBe("-6.20");
    expect(formatTwoDecimals(-0)).toBe("0.00");
    expect(formatTwoDecimals(-0.004)).toBe("0.00");
    expect(formatTwoDecimals(-0.006)).toBe("-0.01");
  });
});

describe("nettedSkewMs", () => {
  it("takes the difference of the two delays out of the skew (skew is b − a)", () => {
    expect(nettedSkewMs(-10.5, { aMs: 20.75, bMs: 10.25 })).toBe(0);
    expect(nettedSkewMs(2.5, { aMs: 17.5, bMs: 20 })).toBe(0);
    expect(nettedSkewMs(8, { aMs: 10, bMs: 12 })).toBe(6);
    expect(nettedSkewMs(8, { aMs: 12, bMs: 10 })).toBe(10);
  });

  it.each([
    ["no record", undefined],
    ["tape a's delay unknown", { aMs: null, bMs: 12 }],
    ["tape b's delay unknown", { aMs: 10, bMs: null }],
    ["tape a's delay not a number", { aMs: Number.NaN, bMs: 12 }],
    ["tape b's delay not a number", { aMs: 10, bMs: Number.NaN }],
    ["tape a's delay infinite", { aMs: Number.NEGATIVE_INFINITY, bMs: 10 }],
    ["tape b's delay infinite", { aMs: 10, bMs: Number.POSITIVE_INFINITY }],
  ])("is null with %s", (_label, record) => {
    expect(nettedSkewMs(8, record)).toBeNull();
  });

  it("is null for a repeat that has no skew", () => {
    expect(nettedSkewMs(null, { aMs: 10, bMs: 12 })).toBeNull();
  });
});

describe("skewDistribution", () => {
  const Q = (128 / 48000) * 1000;

  it("counts repeats by the size of their skew in render quanta, ignoring its direction", () => {
    expect(skewDistribution([0, 2.6667, -2.6667, 10.6667, -0.0000004], Q)).toEqual([
      { quanta: 0, count: 2 }, { quanta: 1, count: 2 }, { quanta: 4, count: 1 },
    ]);
  });

  it("keeps a skew that is not a whole number of quanta as it is, to two decimals", () => {
    expect(skewDistribution([2.0, 7.3333], Q)).toEqual([
      { quanta: 0.75, count: 1 }, { quanta: 2.75, count: 1 },
    ]);
  });

  it("uses the quantum of the rate it is given", () => {
    const at441 = (128 / 44100) * 1000;
    expect(skewDistribution([2.9025, -2.9025], at441)).toEqual([{ quanta: 1, count: 2 }]);
  });

  it("leaves out repeats without a skew", () => {
    expect(skewDistribution([null, 0, null], Q)).toEqual([{ quanta: 0, count: 1 }]);
  });

  it("is empty when no repeat has a skew", () => {
    expect(skewDistribution([], Q)).toEqual([]);
    expect(skewDistribution([null, null], Q)).toEqual([]);
  });

  it("leaves out a skew that is not a number", () => {
    expect(skewDistribution([Number.NaN, Number.POSITIVE_INFINITY, 2.6667], Q)).toEqual([{ quanta: 1, count: 1 }]);
  });

  it("orders by size, whatever the direction", () => {
    expect(skewDistribution([-10.6667, -2.6667, -0.1], Q).map((bucket) => bucket.quanta)).toEqual([0.04, 1, 4]);
  });

  it("rounds to two decimals of a quantum", () => {
    expect(skewDistribution([Q * 0.125, Q * 1.004, Q * 0.996], Q)).toEqual([
      { quanta: 0.13, count: 1 }, { quanta: 1, count: 2 },
    ]);
  });

  // An empty spread would read as "no repeats", and an infinite quantum as "no skew".
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("refuses a quantum of %s", quantum => {
    expect(() => skewDistribution([0, 2.6667], quantum)).toThrow(/render quantum/);
  });

  it("prints as a list of sizes and counts", () => {
    expect(formatSkewDistribution(skewDistribution([0, 0, 2.6667, 2.0, 10.6667], Q))).toBe("0 ×2, 0.75 ×1, 1 ×1, 4 ×1");
    expect(formatSkewDistribution([])).toBe("none");
  });
});
