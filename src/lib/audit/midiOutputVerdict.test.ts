import { describe, expect, it } from "vitest";
import type { OutputRepeatFigures } from "./midiOutputTiming";
import {
  classifyEngineCell, classifyPageCell, isClean, MIDI_OUT_KNOWN_DEFECTS, PAGE_ARM_MAX_ABS_MS,
  type OutputBandContext, type OutputKnownDefectBand, type OutputVerdict,
} from "./midiOutputVerdict";

const clean = (median: number, maxDev: number): OutputRepeatFigures => ({
  medianErrorMs: median, maxAbsDevMs: maxDev, p5p95WidthMs: maxDev, lateTailMs: maxDev,
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

  it("ships with no bands, and isClean reads the four counts", () => {
    expect(MIDI_OUT_KNOWN_DEFECTS).toEqual([]);
    expect(isClean(clean(0, 0))).toBe(true);
    expect(isClean({ ...clean(0, 0), velocityMismatches: 1 })).toBe(false);
    expect(isClean({ ...clean(0, 0), transportMessages: 56 })).toBe(true);
  });
});
