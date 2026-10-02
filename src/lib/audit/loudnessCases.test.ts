import { describe, it, expect } from "vitest";
import { LOUDNESS_CASES, WEIGHTING_HZ, caseSeconds, parseRate, rowSpecs, selectCases } from "./loudnessCases";

describe("LOUDNESS_CASES", () => {
  it("has unique ids", () => {
    const ids = LOUDNESS_CASES.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("runs for 610.1 seconds in all", () => {
    expect(LOUDNESS_CASES.reduce((sum, testCase) => sum + caseSeconds(testCase), 0)).toBeCloseTo(610.1, 6);
  });
  it("states Tech 3341 case 5 as published", () => {
    const [case5] = selectCases("3341-5");
    expect(case5.segments.map((segment) => [segment.levelDb, segment.seconds])).toEqual([
      [-26, 20],
      [-20, 20.1],
      [-26, 20],
    ]);
    expect(case5.judged).toEqual([
      { metric: "integrated", expected: -23, tolerancePlus: 0.1, toleranceMinus: 0.1, unit: "LUFS" },
    ]);
  });
  it("judges momentary, short-term and integrated on cases 1 and 2", () => {
    for (const id of ["3341-1", "3341-2"]) {
      expect(selectCases(id)[0].judged.map((expectation) => expectation.metric)).toEqual([
        "integrated",
        "maxMomentary",
        "maxShortTerm",
      ]);
    }
  });
  it("states Tech 3342 case 4 as published", () => {
    const [case4] = selectCases("3342-4");
    expect(case4.segments.map((segment) => segment.levelDb)).toEqual([-50, -35, -20, -35, -50]);
    expect(case4.judged).toEqual([{ metric: "range", expected: 15, tolerancePlus: 1, toleranceMinus: 1, unit: "LU" }]);
  });
  it("gives the true-peak cases the asymmetric tolerance and a 10 ms taper, and no other case a taper", () => {
    for (const testCase of LOUDNESS_CASES) {
      if (testCase.group !== "peak") {
        expect(testCase.taperMs).toBe(0);
        continue;
      }
      expect(testCase.taperMs).toBe(10);
      expect(testCase.judged).toEqual([
        { metric: "peak", expected: -6, tolerancePlus: 0.2, toleranceMinus: 0.4, unit: "dBTP" },
      ]);
    }
  });
});

describe("selectCases", () => {
  it("returns every case for all, and for no selector", () => {
    expect(selectCases("all")).toHaveLength(14);
    expect(selectCases(null)).toHaveLength(14);
  });
  it("returns a group", () => {
    expect(selectCases("loudness").map((testCase) => testCase.id)).toEqual([
      "3341-1",
      "3341-2",
      "3341-3",
      "3341-4",
      "3341-5",
    ]);
    expect(selectCases("peak")).toHaveLength(4);
  });
  it("returns one case by id", () => {
    expect(selectCases("3342-2").map((testCase) => testCase.id)).toEqual(["3342-2"]);
  });
  it("names the valid selectors when it knows none by that name", () => {
    expect(() => selectCases("nope")).toThrow(/unknown \?case= "nope".*weighting.*3341-1/s);
  });
});

describe("rowSpecs", () => {
  it("gives an EBU case one row, read at the end of the signal", () => {
    const [case3] = selectCases("3341-3");
    expect(rowSpecs(case3, 48000)).toEqual([{ rowId: "3341-3", readAt: { kind: "signalEnd" }, judged: case3.judged }]);
  });
  it("gives the weighting sweep one row per tone, read at that tone's end", () => {
    const [sweep] = selectCases("weighting");
    const rows = rowSpecs(sweep, 48000);
    expect(rows.map((row) => row.rowId)).toEqual(WEIGHTING_HZ.map((hz) => `kweight-${hz}`));
    expect(rows[6].readAt).toEqual({ kind: "segmentEnd", segment: 6 });
    expect(rows[6].judged[0].metric).toBe("shortTerm");
    expect(rows[6].judged[0].expected).toBeCloseTo(-19.9933, 3);
    expect(rows[6].judged[0].tolerancePlus).toBe(0.1);
  });
  it("computes the sweep's expectations at the running sample rate", () => {
    const [sweep] = selectCases("weighting");
    expect(rowSpecs(sweep, 44100)[6].judged[0].expected).toBeCloseTo(-19.9905, 3);
  });
  it("makes 28 rows for a full run", () => {
    expect(LOUDNESS_CASES.flatMap((testCase) => rowSpecs(testCase, 48000))).toHaveLength(28);
  });
});

describe("parseRate", () => {
  it("defaults to 48000", () => {
    expect(parseRate(null)).toBe(48000);
  });
  it("accepts 44100", () => {
    expect(parseRate("44100")).toBe(44100);
  });
  it("refuses anything else, naming what it accepts", () => {
    expect(() => parseRate("96000")).toThrow(/unsupported \?rate= "96000".*48000 or 44100/);
    expect(() => parseRate("abc")).toThrow(/unsupported \?rate= "abc"/);
  });
});
