import { describe, expect, it } from "vitest";
import type { OutputRepeatFigures } from "./midiOutputTiming";
import {
  classifyEngineCell, classifyPageCell, isClean, MIDI_OUT_KNOWN_DEFECTS, PAGE_ARM_MAX_ABS_MS,
  type OutputBandContext, type OutputKnownDefectBand, type OutputVerdict,
} from "./midiOutputVerdict";

const clean = (median: number, maxDev: number): OutputRepeatFigures => ({
  medianErrorMs: median, maxAbsDevMs: maxDev, p5p95WidthMs: maxDev, lateTailMs: maxDev,
  medianErrorLiveMs: median, maxAbsDevLiveMs: maxDev,
  missing: 0, extra: 0, stuck: 0, velocityMismatches: 0, transportMessages: 0,
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

  it("pins the main-thread-base band on the rows that measured it (run 1792790180843, jank 80 ms, 44.1 kHz) and not on a clean row", () => {
    const jank: OutputBandContext = { delayInMs: 10, jankMs: 80, jankActive: true, sampleRate: 44100 }; // quantum 2.90 ms
    // The four engine repeats of run B: live median on the delay, inside-block median ~60, max dev ~70, two off-before-on notes each.
    const measured: OutputRepeatFigures[] = [
      { ...clean(10.18, 71.22), medianErrorLiveMs: 10.19, maxAbsDevLiveMs: 71.23, lateTailMs: 21.06, extra: 2, stuck: 2, notesInsideBlocks: 7, medianErrorInsideBlocksMs: 60.46 },
      { ...clean(9.57, 70.37), medianErrorLiveMs: 10.15, maxAbsDevLiveMs: 71.69, lateTailMs: 20.57, extra: 2, stuck: 2, notesInsideBlocks: 7, medianErrorInsideBlocksMs: 59.82 },
      { ...clean(11.92, 68.96), medianErrorLiveMs: 10.32, maxAbsDevLiveMs: 68.62, lateTailMs: 18.89, extra: 2, stuck: 2, notesInsideBlocks: 7, medianErrorInsideBlocksMs: 60.96 },
      { ...clean(10.70, 69.57), medianErrorLiveMs: 10.23, maxAbsDevLiveMs: 69.65, lateTailMs: 19.48, extra: 2, stuck: 2, notesInsideBlocks: 7, medianErrorInsideBlocksMs: 60.57 },
    ];
    const verdict = classifyEngineCell(measured, bus, jank);
    expect(verdict.status).toBe("matches-known-defect");
    expect(verdict.detail).toMatch(/midi-out-main-thread-base/);
    // The band is for a janked cell only, and does not swallow a clean janked cell, a missing note, or an inside median off its range.
    expect(classifyEngineCell(measured, bus, { ...jank, jankActive: false }).status).toBe("investigate");
    expect(classifyEngineCell([{ ...clean(10.2, 1.0), medianErrorLiveMs: 10.2, maxAbsDevLiveMs: 1.0, notesInsideBlocks: 7, medianErrorInsideBlocksMs: 10.3 }], bus, jank).status).toBe("on-time");
    expect(classifyEngineCell([{ ...measured[0], missing: 1 }], bus, jank).status).toBe("investigate");
    expect(classifyEngineCell([{ ...measured[0], medianErrorInsideBlocksMs: 150 }], bus, jank).status).toBe("investigate");
    expect(classifyEngineCell([{ ...measured[0], stuck: 3, extra: 2 }], bus, jank).status).toBe("investigate");
  });

  it("holds one band, and isClean reads the four counts", () => {
    expect(MIDI_OUT_KNOWN_DEFECTS.map((b) => b.id)).toEqual(["midi-out-main-thread-base"]);
    expect(isClean(clean(0, 0))).toBe(true);
    expect(isClean({ ...clean(0, 0), velocityMismatches: 1 })).toBe(false);
    expect(isClean({ ...clean(0, 0), transportMessages: 56 })).toBe(true);
  });
});
