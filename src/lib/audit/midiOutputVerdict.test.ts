import { describe, expect, it } from "vitest";
import type { OutputRepeatFigures } from "./midiOutputTiming";
import {
  classifyEngineCell, classifyPageCell, engineCellVerdict, isClean, MIDI_OUT_KNOWN_DEFECTS, PAGE_ARM_MAX_ABS_MS, pageCellVerdict,
  type OutputBandContext, type OutputKnownDefectBand, type OutputVerdict,
} from "./midiOutputVerdict";

const clean = (median: number, maxDev: number): OutputRepeatFigures => ({
  medianErrorMs: median, maxAbsDevMs: maxDev, p5p95WidthMs: maxDev, lateTailMs: maxDev,
  medianErrorLiveMs: median, maxAbsDevLiveMs: maxDev,
  maxAbsDevOutsideBlocksMs: maxDev, maxAbsDevOutsideBlocksLiveMs: maxDev,
  missing: 0, extra: 0, stuck: 0, stuckInsideBlocks: 0, velocityMismatches: 0, transportMessages: 0,
  notesInsideBlocks: 0, medianErrorInsideBlocksMs: null,
});
const ctx: OutputBandContext = { delayInMs: 10, jankMs: 80, jankActive: false, sampleRate: 48000 }; // quantum 2.67 ms
const bus: OutputVerdict = { status: "bus-true", detail: "" };

describe("classifyPageCell", () => {
  it("reads a page arm at 0 ± 1 ms as bus-true, and one 2 ms off or unclean as investigate naming the figure", () => {
    expect(PAGE_ARM_MAX_ABS_MS).toBe(1);
    expect(classifyPageCell([clean(0.1, 0.4), clean(-0.2, 0.9)]).status).toBe("bus-true");
    expect(classifyPageCell([clean(0.1, 2)])).toMatchObject({ status: "investigate", detail: expect.stringMatching(/maxAbsDevMs 2/) });
    expect(classifyPageCell([clean(1.5, 0)])).toMatchObject({ status: "investigate", detail: expect.stringMatching(/medianErrorMs 1\.5/) });
    expect(classifyPageCell([{ ...clean(0, 0), missing: 1 }]).detail).toMatch(/missing 1/);
    expect(classifyPageCell([clean(0, 0), { ...clean(0, 0), extra: 2 }]).detail).toMatch(/repeat 2/);
  });

  it("does not judge an empty cell or a repeat without figures", () => {
    expect(classifyPageCell([]).status).toBe("investigate");
    expect(classifyPageCell([{ ...clean(0, 0), medianErrorMs: null, maxAbsDevMs: null }]).status).toBe("investigate");
  });
});

describe("classifyEngineCell", () => {
  it("reads an engine arm at the delay within half a quantum and a quantum of spread as on-time", () => {
    expect(classifyEngineCell([clean(10.8, 2.0)], bus, ctx).status).toBe("on-time");   // 0.8 ms off the delay, spread under a quantum
    expect(classifyEngineCell([clean(14, 2.0)], bus, ctx).status).toBe("investigate");  // 4 ms off the delay
    expect(classifyEngineCell([clean(10, 3.0)], bus, ctx).status).toBe("investigate");  // spread over a quantum
    expect(classifyEngineCell([clean(10, 1), { ...clean(10, 1), stuck: 1 }], bus, ctx).detail).toMatch(/stuck 1 on repeat 2/);
  });

  it("judges the engine arm against the live pair when the repeat has one, and says so", () => {
    // One-pair median 12.9 (the heard-clock relation drifted 3 ms during the repeat), live median 10.2: on the delay.
    const drifted: OutputRepeatFigures = { ...clean(12.9, 1.2), medianErrorLiveMs: 10.2, maxAbsDevLiveMs: 1.5 };
    expect(classifyEngineCell([drifted], bus, ctx)).toMatchObject({ status: "on-time", detail: expect.stringMatching(/live pair/) });
    // Live figures failing fail the cell even when the one-pair figures would pass.
    const liveOff: OutputRepeatFigures = { ...clean(10.2, 1.2), medianErrorLiveMs: 14, maxAbsDevLiveMs: 1.5 };
    expect(classifyEngineCell([liveOff], bus, ctx)).toMatchObject({ status: "investigate", detail: expect.stringMatching(/medianErrorLiveMs 14/) });
    // Without samples (null live figures) the one pair judges, as before.
    const noWitness: OutputRepeatFigures = { ...clean(10.2, 1.2), medianErrorLiveMs: null, maxAbsDevLiveMs: null };
    expect(classifyEngineCell([noWitness], bus, ctx)).toMatchObject({ status: "on-time", detail: expect.stringMatching(/one pair/) });
  });

  it("does not judge an engine arm without a true control", () => {
    expect(classifyEngineCell([clean(10, 0)], null, ctx)).toEqual({ status: "not-judged", detail: "no-control" });
    expect(classifyEngineCell([clean(10, 0)], { status: "investigate", detail: "x" }, ctx)).toEqual({ status: "not-judged", detail: "bus" });
  });

  it("names a band that applies and matches every repeat, and ignores one that does not apply", () => {
    const band: OutputKnownDefectBand = {
      id: "test-band",
      applies: (c) => c.jankActive,
      matches: (f) => f.medianErrorMs !== null && f.medianErrorMs > 20,
      detail: "late",
    };
    expect(classifyEngineCell([clean(40, 30), clean(45, 30)], bus, { ...ctx, jankActive: true }, [band]))
      .toMatchObject({ status: "matches-known-defect", detail: expect.stringMatching(/test-band/) });
    expect(classifyEngineCell([clean(40, 30)], bus, ctx, [band]).status).toBe("investigate");
    expect(classifyEngineCell([clean(40, 30), clean(15, 30)], bus, { ...ctx, jankActive: true }, [band]).status).toBe("investigate");
  });

  it("reads the main-thread-base rows (run 1792790180843, jank 80 ms, 44.1 kHz, before openDAW#356 was fixed) as investigate: no band swallows them", () => {
    const jank: OutputBandContext = { delayInMs: 10, jankMs: 80, jankActive: true, sampleRate: 44100 }; // quantum 2.90 ms
    // The four engine repeats of that run: live median on the delay, inside-block median ~60, max dev ~70, two off-before-on notes each.
    const outside = { maxAbsDevOutsideBlocksMs: 3.4, maxAbsDevOutsideBlocksLiveMs: 3.4, stuckInsideBlocks: 2 };
    const measured: OutputRepeatFigures[] = [
      { ...clean(10.18, 71.22), ...outside, medianErrorLiveMs: 10.19, maxAbsDevLiveMs: 71.23, lateTailMs: 21.06, extra: 2, stuck: 2, notesInsideBlocks: 7, medianErrorInsideBlocksMs: 60.46 },
      { ...clean(9.57, 70.37), ...outside, medianErrorLiveMs: 10.15, maxAbsDevLiveMs: 71.69, lateTailMs: 20.57, extra: 2, stuck: 2, notesInsideBlocks: 7, medianErrorInsideBlocksMs: 59.82 },
    ];
    const verdict = classifyEngineCell(measured, bus, jank);
    expect(verdict.status).toBe("investigate");
    expect(verdict.detail).not.toMatch(/known-defect|midi-out-main-thread-base/);
  });

  it("reads run B on the audio-clock base (run 1793814094848, after openDAW#356 was fixed) as on-time", () => {
    const jank: OutputBandContext = { delayInMs: 10, jankMs: 80, jankActive: true, sampleRate: 44100 };
    // The four engine repeats of that run: live medians on the delay, inside-block medians on the delay too, no inversion.
    const fixed: OutputRepeatFigures[] = [
      { ...clean(9.97, 0.02), medianErrorLiveMs: 10.0, maxAbsDevLiveMs: 0.01, maxAbsDevOutsideBlocksMs: 0.02, maxAbsDevOutsideBlocksLiveMs: 0.01, lateTailMs: 0.01, notesInsideBlocks: 7, medianErrorInsideBlocksMs: 9.97 },
      { ...clean(10.26, 1.06), medianErrorLiveMs: 10.0, maxAbsDevLiveMs: 2.25, maxAbsDevOutsideBlocksMs: 1.06, maxAbsDevOutsideBlocksLiveMs: 2.25, lateTailMs: 0.49, notesInsideBlocks: 7, medianErrorInsideBlocksMs: 10.32 },
      { ...clean(10.01, 0.53), medianErrorLiveMs: 9.99, maxAbsDevLiveMs: 0.66, maxAbsDevOutsideBlocksMs: 0.53, maxAbsDevOutsideBlocksLiveMs: 0.59, lateTailMs: 0.15, notesInsideBlocks: 7, medianErrorInsideBlocksMs: 9.82 },
      { ...clean(12.78, 0.53), medianErrorLiveMs: 10.01, maxAbsDevLiveMs: 0.69, maxAbsDevOutsideBlocksMs: 0.53, maxAbsDevOutsideBlocksLiveMs: 0.69, lateTailMs: 0.11, notesInsideBlocks: 7, medianErrorInsideBlocksMs: 12.78 },
    ];
    const verdict = classifyEngineCell(fixed, bus, jank);
    expect(verdict.status).toBe("on-time");
    expect(verdict.detail).not.toMatch(/midi-out-main-thread-base/);
  });

  it("holds no band, and isClean reads the four counts", () => {
    expect(MIDI_OUT_KNOWN_DEFECTS).toEqual([]);
    expect(isClean(clean(0, 0))).toBe(true);
    expect(isClean({ ...clean(0, 0), velocityMismatches: 1 })).toBe(false);
    expect(isClean({ ...clean(0, 0), transportMessages: 56 })).toBe(true);
  });
});

describe("cell verdicts with failed repeats", () => {
  it("checks the control before the failed-repeat count, so ?arm=engine with a failed repeat still reads no-control", () => {
    expect(engineCellVerdict([clean(10, 1)], 1, null, ctx)).toEqual({ status: "not-judged", detail: "no-control" });
    expect(engineCellVerdict([clean(10, 1)], 1, { status: "investigate", detail: "x" }, ctx)).toEqual({ status: "not-judged", detail: "bus" });
    expect(engineCellVerdict([clean(10, 1)], 1, bus, ctx)).toEqual({ status: "investigate", detail: "1 of 2 engine repeats failed" });
    expect(engineCellVerdict([clean(10, 1)], 0, bus, ctx).status).toBe("on-time");
  });

  it("reads a page cell with a failed repeat as investigate naming the count", () => {
    expect(pageCellVerdict([clean(0, 0)], 1)).toEqual({ status: "investigate", detail: "1 of 2 page repeats failed" });
    expect(pageCellVerdict([clean(0, 0)], 0).status).toBe("bus-true");
  });
});

