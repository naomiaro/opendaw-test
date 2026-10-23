import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { quantumMs } from "./midiInputAlignment";
import { perfMsAtHeardContextSec, type OutputStampPair, type RecordingAnchor } from "./midiClockMap";
import { RECEIPT_WINDOW_MS, type Receipt } from "./midiLoopback";
import { buildOutputPattern, type JankBlock, type OutputPatternNote } from "./midiOutputPattern";
import { anchorTooLate, expectedSchedule, measureOutputRepeat, receiptWindowMs, type MeasureInput } from "./midiOutputTiming";

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
