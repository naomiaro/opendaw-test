import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { quantumMs } from "./midiInputAlignment";
import { heardContextSecAt, perfMsAtHeardContextSec, type OutputStampPair, type RecordingAnchor } from "./midiClockMap";
import { RECEIPT_WINDOW_MS, type Receipt } from "./midiLoopback";
import { buildOutputPattern, type JankBlock, type OutputPatternNote } from "./midiOutputPattern";
import {
  anchorTooLate, expectedSchedule, livePairAt, measureOutputRepeat, pairDriftSummary, pairOffsetDriftMs, receiptWindowMs,
  type MeasureInput, type PairSample,
} from "./midiOutputTiming";

const anchor: RecordingAnchor = { contextTime: 10, position: 0 };
const pair: OutputStampPair = { contextTime: 10.02, performanceTime: 5000 };
const bpm = 140;
const pattern = buildOutputPattern("32nd", 1, 0); // 32 notes, one bar, origin 0
const scheduled = expectedSchedule(pattern, anchor, pair, bpm);

/** On/off receipts at the heard performance times plus `offsetMs`, velocities as sent; `lateBy` overrides per index. */
function receiptsAt(notes: readonly OutputPatternNote[], offsetMs: number, lateBy: Record<number, number> = {}): Receipt[] {
  const out: Receipt[] = [];
  notes.forEach((note, i) => {
    const late = lateBy[i] ?? offsetMs;
    out.push({ kind: "on", pitch: note.pitch, velocity: note.velocity, timeStamp: scheduled[i].onPerfMs + late });
    out.push({ kind: "off", pitch: note.pitch, velocity: 0, timeStamp: scheduled[i].offPerfMs + late });
  });
  return out;
}

const base: MeasureInput = {
  pattern, receipts: [], transportMessages: 0, anchor, pair, bpm,
  delayInMs: 10, jankMs: 80, blocks: [], outputLatencyMs: 20, sampleRate: 48000,
};

describe("expectedSchedule", () => {
  it("places each note at the heard performance time of its position, held for its duration", () => {
    expect(scheduled).toHaveLength(32);
    expect(scheduled[0].onPerfMs).toBeCloseTo(perfMsAtHeardContextSec(pair, 10), 6);
    const stepMs = (60_000 / bpm) / 8;
    expect(scheduled[1].onPerfMs - scheduled[0].onPerfMs).toBeCloseTo(stepMs, 6);
    expect(scheduled[0].offPerfMs - scheduled[0].onPerfMs).toBeCloseTo(stepMs / 2, 6);
    expect(scheduled[0]).toMatchObject({ pitch: pattern[0].pitch, velocity: pattern[0].velocity });
  });
});

describe("measureOutputRepeat", () => {
  it("reads a receipt exactly at the heard time as 0.00 ms, and one 12 ms later as +12.00", () => {
    const exact = measureOutputRepeat({ ...base, receipts: receiptsAt(pattern, 0) });
    expect(exact.figures.medianErrorMs).toBeCloseTo(0, 6);
    expect(exact.figures.maxAbsDevMs).toBeCloseTo(0, 6);
    expect(exact.figures).toMatchObject({ missing: 0, extra: 0, stuck: 0, velocityMismatches: 0 });
    expect(exact.notes[0].durationErrorMs).toBeCloseTo(0, 6);
    const late = measureOutputRepeat({ ...base, receipts: receiptsAt(pattern, 12) });
    expect(late.figures.medianErrorMs).toBeCloseTo(12, 6);
    expect(late.notes[0].errorMs).toBeCloseTo(12, 6);
    expect(late.notes[0].receiptHeardCtxSec).toBeCloseTo(10.012, 6);
  });

  it("pairs a note late by a 500 ms delay, because the window includes the delay", () => {
    const r = measureOutputRepeat({ ...base, delayInMs: 500, receipts: receiptsAt(pattern, 500) });
    expect(r.figures.missing).toBe(0);
    expect(r.figures.medianErrorMs).toBeCloseTo(500, 6);
    expect(receiptWindowMs(500, 80, 48000)).toBeCloseTo(RECEIPT_WINDOW_MS + 500 + 80 + quantumMs(48000), 6);
  });

  it("counts a receipt of a pitch outside the pattern as extra, pairs nothing to it, and does not throw", () => {
    const stray: Receipt = { kind: "off", pitch: 120, velocity: 0, timeStamp: 5100 };
    const r = measureOutputRepeat({ ...base, receipts: [...receiptsAt(pattern, 0), stray] });
    expect(r.figures.extra).toBe(1);
    expect(r.figures.missing).toBe(0);
  });

  it("reports a note without its off as stuck, a missing on as missing, and a velocity one byte off as matching", () => {
    const receipts = receiptsAt(pattern, 0);
    const withoutOff = receipts.filter((r) => !(r.kind === "off" && r.pitch === pattern[3].pitch));
    expect(measureOutputRepeat({ ...base, receipts: withoutOff }).figures.stuck).toBe(1);
    const withoutOn = receipts.filter((r) => !(r.kind === "on" && r.pitch === pattern[3].pitch));
    const missing = measureOutputRepeat({ ...base, receipts: withoutOn });
    expect(missing.figures.missing).toBe(1);
    expect(missing.notes[3].errorMs).toBeNull();
    const oneOff = receipts.map((r) => (r.kind === "on" && r.pitch === pattern[0].pitch ? { ...r, velocity: r.velocity + 1 } : r));
    expect(measureOutputRepeat({ ...base, receipts: oneOff }).figures.velocityMismatches).toBe(0);
    const twoOff = receipts.map((r) => (r.kind === "on" && r.pitch === pattern[0].pitch ? { ...r, velocity: r.velocity + 2 } : r));
    expect(measureOutputRepeat({ ...base, receipts: twoOff }).figures.velocityMismatches).toBe(1);
  });

  it("labels notes inside a block by render time, takes their median apart, and gives null when no note is inside", () => {
    // Render time = heard perf − outputLatencyMs; a block covering notes 10 and 11's render times.
    const render = (i: number): number => scheduled[i].onPerfMs - base.outputLatencyMs;
    const blocks: JankBlock[] = [{ startPerfMs: render(10) - 1, endPerfMs: render(11) + 1 }];
    const r = measureOutputRepeat({ ...base, blocks, receipts: receiptsAt(pattern, 0, { 10: 80, 11: 80 }) });
    expect(r.notes[10].jankLabel).toBe("inside");
    expect(r.notes[11].jankLabel).toBe("inside");
    expect(r.notes[12].jankLabel).toBe("first-after");
    expect(r.notes[9].jankLabel).toBe("clear");
    expect(r.figures.notesInsideBlocks).toBe(2);
    expect(r.figures.medianErrorInsideBlocksMs).toBeCloseTo(80, 6);
    expect(measureOutputRepeat({ ...base, blocks: [], receipts: receiptsAt(pattern, 0) }).figures.medianErrorInsideBlocksMs).toBeNull();
  });

  it("passes the transport count through and reads a late tail as p95 minus the median", () => {
    const r = measureOutputRepeat({ ...base, transportMessages: 56, receipts: receiptsAt(pattern, 0, { 29: 40, 30: 40, 31: 40 }) });
    expect(r.figures.transportMessages).toBe(56);
    expect(r.figures.medianErrorMs).toBeCloseTo(0, 6);
    expect(r.figures.lateTailMs).toBeGreaterThan(0);
    expect(r.figures.maxAbsDevMs).toBeCloseTo(40, 6);
    expect(r.figures.p5p95WidthMs).toBeGreaterThan(0);
  });

  it("counts a duplicated note-on as extra and takes the velocity from the paired receipt", () => {
    const receipts = receiptsAt(pattern, 0);
    const first = receipts.find((r) => r.kind === "on" && r.pitch === pattern[0].pitch) as Receipt;
    const duplicate: Receipt = { ...first, velocity: first.velocity + 20 };
    const r = measureOutputRepeat({ ...base, receipts: [...receipts, duplicate] });
    expect(r.figures.extra).toBe(1);
    expect(r.figures.velocityMismatches).toBe(0);
    expect(r.notes[0].velocityMatch).toBe(true);
    const twoOffs = measureOutputRepeat({ ...base, receipts: [...receipts, { ...receipts[1] }] });
    expect(twoOffs.figures.extra).toBe(1);
  });

  it("reads the spread of the notes outside the blocks apart, and counts the stuck notes inside them", () => {
    const render = (i: number): number => scheduled[i].onPerfMs - base.outputLatencyMs;
    const blocks: JankBlock[] = [{ startPerfMs: render(10) - 1, endPerfMs: render(11) + 1 }];
    const receipts = receiptsAt(pattern, 0, { 10: 80, 11: 80, 20: 5 }).filter((r) => !(r.kind === "off" && r.pitch === pattern[10].pitch));
    const r = measureOutputRepeat({ ...base, blocks, receipts });
    expect(r.figures.maxAbsDevMs).toBeCloseTo(80, 6);
    expect(r.figures.maxAbsDevOutsideBlocksMs).toBeCloseTo(5, 6);
    expect(r.figures.maxAbsDevOutsideBlocksLiveMs).toBeNull();
    expect(r.figures.stuck).toBe(1);
    expect(r.figures.stuckInsideBlocks).toBe(1);
    const stuckOutside = measureOutputRepeat({ ...base, blocks, receipts: receiptsAt(pattern, 0, { 10: 80, 11: 80 }).filter((x) => !(x.kind === "off" && x.pitch === pattern[3].pitch)) });
    expect(stuckOutside.figures.stuck).toBe(1);
    expect(stuckOutside.figures.stuckInsideBlocks).toBe(0);
  });

  it("gives null figures, not NaN, with no receipts at all", () => {
    const r = measureOutputRepeat({ ...base, receipts: [] });
    expect(r.figures.missing).toBe(32);
    expect(r.figures.medianErrorMs).toBeNull();
    expect(r.figures.maxAbsDevMs).toBeNull();
    expect(r.figures.lateTailMs).toBeNull();
  });
});

describe("anchorTooLate", () => {
  it("says the anchor is too late when the origin is under 300 ms ahead of now", () => {
    // origin bar 2 = one bar in = 1.714 s at 140 bpm; the anchor's context time is 10
    expect(anchorTooLate(anchor, BAR_PPQN, 140, 10 + 1.714 - 0.5)).toBe(false);
    expect(anchorTooLate(anchor, BAR_PPQN, 140, 10 + 1.714 - 0.2)).toBe(true);
  });
});

describe("the pair-drift witness", () => {
  const sampleAt = (perfMs: number, driftMs: number, outputLatencyMs = 23): PairSample => ({
    perfMs,
    // The heard-clock relation moved by driftMs: the same performance time maps driftMs later on the context clock.
    contextTime: heardContextSecAt(pair, perfMs) + driftMs / 1000,
    performanceTime: perfMs,
    outputLatencyMs,
  });

  it("reads a sample on the repeat's pair as 0 drift and one 4 ms further along as +4", () => {
    expect(pairOffsetDriftMs(sampleAt(6000, 0), pair)).toBeCloseTo(0, 6);
    expect(pairOffsetDriftMs(sampleAt(6000, 4), pair)).toBeCloseTo(4, 6);
    expect(pairOffsetDriftMs(sampleAt(6000, -2.5), pair)).toBeCloseTo(-2.5, 6);
  });

  it("summarises the drift and the output latency over the samples, null without any", () => {
    const summary = pairDriftSummary([sampleAt(5000, 0), sampleAt(5500, -2.5, 23), sampleAt(6000, 4, 27)], pair);
    expect(summary).toEqual({ samples: 3, driftMinMs: expect.closeTo(-2.5, 6), driftMaxMs: expect.closeTo(4, 6), outputLatencyMinMs: 23, outputLatencyMaxMs: 27 });
    expect(pairDriftSummary([], pair)).toEqual({ samples: 0, driftMinMs: null, driftMaxMs: null, outputLatencyMinMs: null, outputLatencyMaxMs: null });
  });

  it("picks the last sample at or before a time", () => {
    const samples = [sampleAt(5000, 0), sampleAt(5500, 1), sampleAt(6000, 2)];
    expect(livePairAt(samples, 5499)).toBe(samples[0]);
    expect(livePairAt(samples, 5500)).toBe(samples[1]);
    expect(livePairAt(samples, 9000)).toBe(samples[2]);
    expect(livePairAt(samples, 4000)).toBeNull();
    expect(livePairAt([], 5000)).toBeNull();
  });

  it("reads each note against the live pair too: a +4 ms drift over the last notes moves their live error by +4", () => {
    const lastOn = scheduled[16].onPerfMs;
    const samples = [sampleAt(scheduled[0].onPerfMs - 1, 0), sampleAt(lastOn - 1, 4)];
    const r = measureOutputRepeat({ ...base, receipts: receiptsAt(pattern, 10), pairSamples: samples });
    expect(r.notes[0].errorLiveMs).toBeCloseTo(10, 6);
    expect(r.notes[20].errorLiveMs).toBeCloseTo(14, 6);
    expect(r.figures.medianErrorMs).toBeCloseTo(10, 6);
    expect(r.figures.medianErrorLiveMs).toBeCloseTo(12, 6);
    expect(r.figures.maxAbsDevLiveMs).toBeCloseTo(2, 6);
    expect(r.figures.maxAbsDevOutsideBlocksLiveMs).toBeCloseTo(2, 6);
    const none = measureOutputRepeat({ ...base, receipts: receiptsAt(pattern, 10) });
    expect(none.notes[0].errorLiveMs).toBeNull();
    expect(none.figures.medianErrorLiveMs).toBeNull();
  });
});
