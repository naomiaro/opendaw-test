import { describe, it, expect } from "vitest";
import { WEIGHTING_HZ, selectCases, type LoudnessCase } from "./loudnessCases";
import { expectedToneLoudness, synthesize } from "./loudnessSignals";
import { chunksFromSignal, type CaseCapture, type LoudnessReading } from "./loudnessTap";
import {
  firstReadingAtOrAfter,
  judgeCapture,
  judgeRow,
  lastReadingAtOrBefore,
} from "./loudnessVerdict";

const RATE = 48000;
const LEAD_SECONDS = 1;
const TAIL_SECONDS = 6.5;

type Values = Omit<LoudnessReading, "atMs">;
/** What the meter reads `seconds` into the signal (negative before it starts). */
type Meter = (seconds: number) => Values;

const EMPTY: Values = { momentary: -120, shortTerm: -120, integrated: -120, range: 0, peak: -120 };
const steady =
  (level: number, overrides: Partial<Values> = {}): Meter =>
  (seconds) =>
    seconds < 0
      ? EMPTY
      : { momentary: level, shortTerm: level, integrated: level, range: 0, peak: level, ...overrides };

/** A capture of `testCase` as the page would make it: a second of silence, the signal, silence. */
function captureOf(
  testCase: LoudnessCase,
  meter: Meter,
  gain: number = 1,
  disturb: (output: Float32Array, signalStart: number) => void = () => {},
  disturbRight: (right: Float32Array, signalStart: number) => void = () => {}
): CaseCapture {
  const signal = synthesize(testCase.segments, RATE, testCase.taperMs);
  const lead = LEAD_SECONDS * RATE;
  const output = new Float32Array(lead + signal.length + TAIL_SECONDS * RATE);
  for (let i = 0; i < signal.length; i++) output[lead + i] = signal[i] * gain;
  disturb(output, lead);
  const readings: LoudnessReading[] = [];
  for (let atMs = 0; atMs <= (output.length / RATE) * 1000; atMs += 100) {
    readings.push({ atMs, ...meter(atMs / 1000 - LEAD_SECONDS) });
  }
  const right = output.slice();
  disturbRight(right, lead);
  return { readings, chunks: chunksFromSignal(output, right, RATE), hidden: false };
}

const case1 = selectCases("3341-1")[0];
const case16 = selectCases("3341-16")[0];
const sweep = selectCases("weighting")[0];

describe("reading lookup", () => {
  const readings = [100, 200, 300].map((atMs) => ({ atMs, ...EMPTY }));
  it("finds the first reading at or after a time", () => {
    expect(firstReadingAtOrAfter(readings, 200)?.atMs).toBe(200);
    expect(firstReadingAtOrAfter(readings, 201)?.atMs).toBe(300);
    expect(firstReadingAtOrAfter(readings, 301)).toBeNull();
  });
  it("finds the last reading at or before a time", () => {
    expect(lastReadingAtOrBefore(readings, 200)?.atMs).toBe(200);
    expect(lastReadingAtOrBefore(readings, 299)?.atMs).toBe(200);
    expect(lastReadingAtOrBefore(readings, 99)).toBeNull();
  });
});

describe("judgeRow", () => {
  const judged = selectCases("3341-3")[0].judged;
  const row = (integrated: number) => judgeRow({ judged, values: { integrated }, delivered: [], problems: [] });
  it("passes a reading exactly on the limit, as the stream's 32-bit floats state it", () => {
    expect(row(Math.fround(-23.1)).status).toBe("pass");
    expect(row(Math.fround(-22.9)).status).toBe("pass");
  });
  it("fails a reading just past the limit", () => {
    expect(row(-23.11).status).toBe("fail");
    expect(row(-22.89).status).toBe("fail");
  });
  it("never passes a reading that is not a number", () => {
    const verdict = row(Number.NaN);
    expect(verdict.status).toBe("invalid");
    expect(verdict.reasons).toEqual(["no reading for integrated"]);
    expect(verdict.metrics[0].got).toBeNull();
  });
  it("is invalid when a delivered level was not measured", () => {
    const verdict = judgeRow({
      judged,
      values: { integrated: -23 },
      delivered: [{ label: "segment 1 level L", intendedDb: -36, deliveredDb: null, toleranceDb: 0.02 }],
      problems: [],
    });
    expect(verdict.status).toBe("invalid");
    expect(verdict.reasons).toEqual(["segment 1 level L: not measured"]);
  });
});

describe("judgeCapture", () => {
  it("passes a case whose readings are within tolerance", () => {
    const rows = judgeCapture(case1, RATE, captureOf(case1, steady(-23)));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pass");
    expect(rows[0].reasons).toEqual([]);
    expect(rows[0].metrics.map((metric) => metric.got)).toEqual([-23, -23, -23]);
    expect(rows[0].delivered.map((check) => check.label)).toEqual(["segment 1 level L", "segment 1 level R"]);
    expect(rows[0].delivered[0].deliveredDb).toBeCloseTo(-23, 2);
  });
  it("fails a case whose readings are outside tolerance, and says by how much", () => {
    const [row] = judgeCapture(case1, RATE, captureOf(case1, steady(-23.25)));
    expect(row.status).toBe("fail");
    expect(row.reasons).toEqual([]);
    expect(row.metrics[0].error).toBeCloseTo(-0.25, 6);
    expect(row.metrics[0].within).toBe(false);
  });
  it("takes the maxima from the whole signal, not from the end", () => {
    const meter: Meter = (seconds) => ({
      ...steady(-23)(seconds),
      ...(seconds >= 5 && seconds < 6 ? { momentary: -22.5 } : {}),
    });
    const [row] = judgeCapture(case1, RATE, captureOf(case1, meter));
    expect(row.metrics.find((metric) => metric.metric === "maxMomentary")?.got).toBe(-22.5);
    expect(row.status).toBe("fail");
  });
  it("is invalid when the signal was not delivered at its level, though the readings would pass", () => {
    const [row] = judgeCapture(case1, RATE, captureOf(case1, steady(-23), 0.99));
    expect(row.status).toBe("invalid");
    expect(row.reasons[0]).toMatch(/^segment 1 level L: delivered -23\.09 dB, intended -23\.00 dB$/);
    expect(row.metrics.every((metric) => metric.within)).toBe(true);
  });
  it("is invalid when the tab was hidden", () => {
    const capture = { ...captureOf(case1, steady(-23)), hidden: true };
    const [row] = judgeCapture(case1, RATE, capture);
    expect(row.status).toBe("invalid");
    expect(row.reasons).toEqual(["the tab was hidden during the case"]);
  });
  it("is invalid when the meter was not empty at the start", () => {
    const meter: Meter = (seconds) => (seconds < 0 ? { ...EMPTY, integrated: -30 } : steady(-23)(seconds));
    const [row] = judgeCapture(case1, RATE, captureOf(case1, meter));
    expect(row.status).toBe("invalid");
    expect(row.reasons).toEqual(["the meter was not empty at the start (integrated -30.00)"]);
  });
  it("is invalid when nothing reached the output", () => {
    const [row] = judgeCapture(case1, RATE, captureOf(case1, steady(-23), 0));
    expect(row.status).toBe("invalid");
    expect(row.reasons).toContain("the tap never saw the signal start and end");
    expect(row.metrics.every((metric) => metric.got === null)).toBe(true);
  });
  it("is invalid when no reading arrived", () => {
    const capture = { ...captureOf(case1, steady(-23)), readings: [] };
    const [row] = judgeCapture(case1, RATE, capture);
    expect(row.status).toBe("invalid");
    expect(row.reasons).toContain("no loudness reading arrived");
  });
  it("reports the late reading without judging it", () => {
    const meter: Meter = (seconds) => (seconds > 22 ? steady(-23, { integrated: -25 })(seconds) : steady(-23)(seconds));
    const [row] = judgeCapture(case1, RATE, captureOf(case1, meter));
    expect(row.late.integrated).toBe(-25);
    expect(row.status).toBe("pass");
  });
  it("applies the true-peak tolerance, wider below than above", () => {
    const status = (peak: number) => judgeCapture(case16, RATE, captureOf(case16, steady(-9, { peak })))[0].status;
    expect(status(-6.3)).toBe("pass");
    expect(status(-5.7)).toBe("fail");
    expect(status(-6.5)).toBe("fail");
  });
  it("checks a peak case's delivered sample peak against the tone's own", () => {
    const [row] = judgeCapture(case16, RATE, captureOf(case16, steady(-9, { peak: -6 })));
    const check = row.delivered.find((entry) => entry.label === "segment 1 sample peak");
    expect(check?.intendedDb).toBeCloseTo(-9.031, 2);
    expect(check?.deliveredDb).toBeCloseTo(-9.031, 2);
    expect(row.status).toBe("pass");
  });
  it("is invalid when a sample outside the measured interior is above the tone's highest", () => {
    // The meter holds its peak from the moment it is switched on, so a click at the region's
    // edge moves the reading. Here the reading would pass.
    const click = (output: Float32Array, signalStart: number) => {
      output[signalStart + 10] = 0.9;
    };
    const [row] = judgeCapture(case16, RATE, captureOf(case16, steady(-9, { peak: -6 }), 1, click));
    expect(row.status).toBe("invalid");
    expect(row.reasons).toEqual(["whole capture sample peak: delivered -0.92 dB, intended -9.03 dB"]);
    expect(row.metrics[0].within).toBe(true);
  });
  it("is invalid when the tap's timing of the signal does not match its length", () => {
    // The first loud chunk reaches the main thread 300 ms late: every reading time that is
    // counted from it would be 300 ms late too.
    const capture = captureOf(case1, steady(-23));
    const first = capture.chunks.findIndex((chunk) => chunk.peak[0] > 0);
    capture.chunks[first] = { ...capture.chunks[first], atMs: capture.chunks[first].atMs + 300 };
    const [row] = judgeCapture(case1, RATE, capture);
    expect(row.status).toBe("invalid");
    expect(row.reasons).toEqual(["the tap timed the signal at 19.732 s, it is 20.000 s long"]);
  });
  it("takes each metric from its own field of the stream", () => {
    const distinct: Meter = (seconds) =>
      seconds < 0 ? EMPTY : { momentary: -21, shortTerm: -22, integrated: -23, range: 7, peak: -9 };
    const got = (testCase: LoudnessCase) =>
      judgeCapture(testCase, RATE, captureOf(testCase, distinct))[0].metrics.map((metric) => [
        metric.metric,
        metric.got,
      ]);
    expect(got(case1)).toEqual([
      ["integrated", -23],
      ["maxMomentary", -21],
      ["maxShortTerm", -22],
    ]);
    expect(got(selectCases("3342-1")[0])).toEqual([["range", 7]]);
    expect(got(case16)).toEqual([["peak", -9]]);
    expect(judgeCapture(case1, RATE, captureOf(case1, distinct))[0].late).toEqual({
      integrated: -23,
      range: 7,
      peak: -9,
    });
  });
  it("checks the right channel's level on its own", () => {
    const quieter = (right: Float32Array) => {
      for (let i = 0; i < right.length; i++) right[i] *= 0.99;
    };
    const [row] = judgeCapture(case1, RATE, captureOf(case1, steady(-23), 1, undefined, quieter));
    expect(row.status).toBe("invalid");
    expect(row.reasons).toEqual(["segment 1 level R: delivered -23.09 dB, intended -23.00 dB"]);
  });
  it("sees a click that is on the right channel only", () => {
    const click = (right: Float32Array, signalStart: number) => {
      right[signalStart + 10] = 0.9;
    };
    const capture = captureOf(case16, steady(-9, { peak: -6 }), 1, undefined, click);
    expect(judgeCapture(case16, RATE, capture)[0].reasons).toEqual([
      "whole capture sample peak: delivered -0.92 dB, intended -9.03 dB",
    ]);
  });
  it("checks every segment of a case against that segment's own level", () => {
    // Tech 3341 case 3 is 10 s, 60 s, 10 s. Only the middle segment is delivered low.
    const case3 = selectCases("3341-3")[0];
    const lowMiddle = (output: Float32Array, signalStart: number) => {
      for (let i = signalStart + 10 * RATE; i < signalStart + 70 * RATE; i++) output[i] *= 0.99;
    };
    const [row] = judgeCapture(case3, RATE, captureOf(case3, steady(-23), 1, lowMiddle));
    expect(row.status).toBe("invalid");
    expect(row.reasons).toEqual([
      "segment 2 level L: delivered -23.09 dB, intended -23.00 dB",
      "segment 2 level R: delivered -23.09 dB, intended -23.00 dB",
    ]);
  });
  it("reads a sweep tone 300 ms before its end, once the 3 s window holds only that tone", () => {
    // The meter is right only from 3 s into each tone until 300 ms before the tone ends.
    const meter: Meter = (seconds) => {
      if (seconds < 0) return EMPTY;
      const ms = Math.round(seconds * 1000);
      const hz = WEIGHTING_HZ[Math.min(Math.floor(ms / 6000), WEIGHTING_HZ.length - 1)];
      const settled = ms % 6000 >= 3000 && ms % 6000 <= 5700;
      return { ...steady(-20)(seconds), shortTerm: settled ? expectedToneLoudness(RATE, hz, -20) : -99 };
    };
    const rows = judgeCapture(sweep, RATE, captureOf(sweep, meter));
    expect(rows.map((row) => row.status)).toEqual(Array(15).fill("pass"));
  });
  it("is invalid when the readings stopped during the signal", () => {
    // No reading for the whole of the second tone: its row would otherwise be judged from
    // the last reading of the first tone.
    const meter: Meter = (seconds) => {
      if (seconds < 0) return EMPTY;
      const hz = WEIGHTING_HZ[Math.min(Math.floor(seconds / 6), WEIGHTING_HZ.length - 1)];
      return { ...steady(-20)(seconds), shortTerm: expectedToneLoudness(RATE, hz, -20) };
    };
    const capture = captureOf(sweep, meter);
    capture.readings = capture.readings.filter((reading) => reading.atMs < 7000 || reading.atMs >= 13000);
    const rows = judgeCapture(sweep, RATE, capture);
    expect(rows.map((row) => row.status)).toEqual(Array(15).fill("invalid"));
    expect(rows[1].reasons).toEqual(["no loudness reading for 6.100 s during the signal"]);
  });
  it("judges each sweep tone by the short-term reading at that tone's end", () => {
    // Every tone reads its expected loudness, except 1500 Hz, which reads 0.49 low.
    const meter: Meter = (seconds) => {
      if (seconds < 0) return EMPTY;
      const hz = WEIGHTING_HZ[Math.min(Math.floor(seconds / 6), WEIGHTING_HZ.length - 1)];
      const shortTerm = expectedToneLoudness(RATE, hz, -20) - (hz === 1500 ? 0.49 : 0);
      return { ...steady(-20)(seconds), shortTerm };
    };
    const rows = judgeCapture(sweep, RATE, captureOf(sweep, meter));
    expect(rows.map((row) => row.rowId)).toEqual(WEIGHTING_HZ.map((hz) => `kweight-${hz}`));
    expect(rows.filter((row) => row.status === "fail").map((row) => row.rowId)).toEqual(["kweight-1500"]);
    expect(rows.filter((row) => row.status === "pass")).toHaveLength(14);
    expect(rows[7].metrics[0].error).toBeCloseTo(-0.49, 6);
    expect(rows[7].delivered.map((check) => check.label)).toEqual(["segment 8 level L", "segment 8 level R"]);
  });
});
