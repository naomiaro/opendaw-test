import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { buildPattern } from "./midiInputPattern";
import { applyInputLatencyState, audioFiguresFrom, SPAN_SLACK_AFTER_SEC, SPAN_SLACK_BEFORE_SEC, takeSpanSec } from "./combinedCellRunner";

const tempo120 = { ppqnToSeconds: (p: number) => p / 1920, secondsToPPQN: (s: number) => s * 1920 };
const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });

describe("takeSpanSec", () => {
  it("runs from a little before the origin to a little after the last release, so an early or late audio side stays inside", () => {
    const span = takeSpanSec(BAR_PPQN, pattern, tempo120);
    expect(span.startSec).toBeCloseTo(2 - SPAN_SLACK_BEFORE_SEC, 9);
    expect(span.endSec).toBeCloseTo((pattern.at(-1)!.onPpqn + pattern.at(-1)!.durationPpqn) / 1920 + SPAN_SLACK_AFTER_SEC, 9);
    expect(SPAN_SLACK_AFTER_SEC).toBeGreaterThanOrEqual(0.1); // the uncalibrated audio side has read 65 ms late
  });
});

describe("audioFiguresFrom", () => {
  it("finds synthetic clicks in a take and pairs them with MIDI rows", () => {
    const rate = 44100, regionStartSec = 2, waveformOffsetSec = 0.05;
    const mono = new Float32Array(rate * 8);
    for (const n of pattern) {
      const t = n.onPpqn / 1920 + 0.040 - regionStartSec + waveformOffsetSec;
      const at = Math.round(t * rate);
      for (let k = 0; k < 353; k++) mono[at + k] += 0.5 * Math.sin((2 * Math.PI * 6000 * k) / rate);
    }
    const midiNotes = pattern.map((n) => ({ index: n.index, outcome: "matched", recordedPpqn: n.onPpqn + 61.4 } as never)); // +32 ms at 120
    const { figures } = audioFiguresFrom({
      mono, sampleRate: rate, regionStartSec, waveformOffsetSec, span: takeSpanSec(BAR_PPQN, pattern, tempo120), pattern, bpm: 120, tempoMap: tempo120, midiNotes,
    });
    expect(figures.clicksFound).toBe(48);
    expect(figures.clicksMissing).toBe(0);
    expect(Math.abs((figures.audioMedianMs as number) - 40)).toBeLessThan(3); // onset hop 1.45 ms plus envelope lag
    expect(Math.abs((figures.partsApartMedianMs as number) + 8)).toBeLessThan(3);
  });
});

describe("applyInputLatencyState", () => {
  it("writes seconds to the capture box field inside a transaction and reports the ms applied", () => {
    const writes: number[] = [];
    let inTransaction = false;
    const project = { editing: { modify: (fn: () => void) => { inTransaction = true; fn(); inTransaction = false; } } } as never;
    const capture = { captureBox: { inputLatency: { setValue: (v: number) => { expect(inTransaction).toBe(true); writes.push(v); } } } } as never;
    expect(applyInputLatencyState(project, capture, "calibrated", 64.35)).toBeCloseTo(64.35, 9);
    expect(applyInputLatencyState(project, capture, "default", 64.35)).toBe(0);
    expect(writes[0]).toBeCloseTo(0.06435, 9);
    expect(writes[1]).toBe(0);
  });
  it("reports what the SDK applies: a negative part is floored to zero by the recorder", () => {
    const project = { editing: { modify: (fn: () => void) => fn() } } as never;
    const capture = { captureBox: { inputLatency: { setValue: () => undefined } } } as never;
    expect(applyInputLatencyState(project, capture, "calibrated", -3)).toBe(0);
  });
});
