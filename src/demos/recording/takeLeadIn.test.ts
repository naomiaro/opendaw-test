import { describe, expect, it } from "vitest";
import type { TakeIteration, TakeRegion } from "./TakeTimeline";
import { BAR_PPQN, isLeadInTake, takeIterationNumber, takeNumberOf, trackedTakeBaselines, withTakeRegion } from "./takeLeadIn";

describe("isLeadInTake", () => {
  it("a take that starts before the loop area is the lead-in, whatever its number", () => {
    expect(isLeadInTake(0, 1)).toBe(true);
    expect(isLeadInTake(BAR_PPQN - 1, 1)).toBe(true);
    expect(isLeadInTake(BAR_PPQN - 1, 2)).toBe(true);
  });

  it("a take that starts at or after the loop start is a loop take", () => {
    expect(isLeadInTake(BAR_PPQN, 1)).toBe(false);
    expect(isLeadInTake(3 * BAR_PPQN, 1)).toBe(false);
  });

  it("without lead-in bars no take is a lead-in, the first one included", () => {
    expect(isLeadInTake(0, 0)).toBe(false);
  });
});

describe("take labels", () => {
  it("reads the number of a take label and nothing else", () => {
    expect(takeNumberOf("Take 12")).toBe(12);
    expect(takeNumberOf("Take 1 (original)")).toBeNull();
    expect(takeNumberOf("Vocal")).toBeNull();
  });

  it("each tape's baseline is the highest take the demo lists for it; an unlisted tape has none", () => {
    const rows = [
      { regions: [{ inputTapeId: "a", takeNumber: 1 }] },
      { regions: [{ inputTapeId: "a", takeNumber: 3 }, { inputTapeId: "b", takeNumber: 7 }] },
      { regions: [{ inputTapeId: "a", takeNumber: 2 }] },
    ];
    const baselines = trackedTakeBaselines(rows);
    expect(baselines.get("a")).toBe(3);
    expect(baselines.get("b")).toBe(7);
    expect(baselines.get("c")).toBeUndefined();
    expect(trackedTakeBaselines([]).size).toBe(0);
  });
});

describe("takeIterationNumber", () => {
  it("two tapes with different numbers land on the same row of the same pass", () => {
    // Tape 1 recorded alone before (Take 1–3), Tape 2 is new: the second recording gives
    // Tape 1 "Take 4–6" and Tape 2 "Take 1–3"; three rows existed before it.
    expect(takeIterationNumber(4, 3, 3)).toBe(4);
    expect(takeIterationNumber(1, 0, 3)).toBe(4);
    expect(takeIterationNumber(6, 3, 3)).toBe(6);
    expect(takeIterationNumber(3, 0, 3)).toBe(6);
  });

  it("a take that predates the recording has no row in it", () => {
    expect(takeIterationNumber(3, 3, 3)).toBeNull();
    expect(takeIterationNumber(1, 3, 3)).toBeNull();
  });

  it("the first recording on an empty unit numbers its rows from one", () => {
    expect(takeIterationNumber(1, 0, 0)).toBe(1);
  });
});

describe("withTakeRegion", () => {
  const region = (tape: string, takeNumber: number, positionPpqn: number, isMuted = true): TakeRegion => ({
    regionBox: { id: `${tape}:${takeNumber}` } as unknown as TakeRegion["regionBox"],
    inputTapeId: tape,
    takeNumber,
    positionPpqn,
    isMuted,
    sampleLoader: null,
    waveformOffsetFrames: 0,
    durationFrames: 0,
  });
  // One tape's takes of one recording pass; `rowsBefore` is the pass's snapshot, shared by every tape in it
  const record = (rows: TakeIteration[], tape: string, numbers: number[], baseline: number, leadInBars: number, rowsBefore = rows.length) => {
    for (const n of numbers) {
      const ordinal = n - baseline;
      const position = ordinal === 1 ? 0 : leadInBars * BAR_PPQN;
      const row = takeIterationNumber(n, baseline, rowsBefore);
      if (row !== null) rows = withTakeRegion(rows, region(tape, n, position), row, leadInBars);
    }
    return rows;
  };

  it("a second recording on the same tape opens new rows, its first take the lead-in", () => {
    let rows = record([], "a", [1, 2, 3, 4], 0, 1);
    rows = record(rows, "a", [5, 6, 7, 8], 4, 1);
    expect(rows.map((r) => r.takeNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows.filter((r) => r.isLeadIn).map((r) => r.takeNumber)).toEqual([1, 5]);
    expect(rows.every((r) => r.regions.length === 1)).toBe(true);
  });

  it("two tapes with different numbers share the rows of one pass, and the row's mute is theirs together", () => {
    let rows = record([], "a", [1, 2, 3], 0, 0);
    // tape a continues at 4; tape b, new, starts at 1 — the same three passes, one snapshot
    const rowsBefore = rows.length;
    rows = record(rows, "a", [4, 5, 6], 3, 0, rowsBefore);
    rows = record(rows, "b", [1, 2, 3], 0, 0, rowsBefore);
    expect(rows.map((r) => r.takeNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.slice(0, 3).every((r) => r.regions.length === 1)).toBe(true);
    expect(rows.slice(3).map((r) => r.regions.map((x) => `${x.inputTapeId}:${x.takeNumber}`))).toEqual([
      ["a:4", "b:1"],
      ["a:5", "b:2"],
      ["a:6", "b:3"],
    ]);
    const withOneUnmuted = withTakeRegion(rows.slice(0, 3), region("b", 7, 0, false), 4, 0);
    expect(withOneUnmuted[3].isMuted).toBe(false);
  });

  it("a region delivered again is not listed twice", () => {
    const rows = record([], "a", [1, 2], 0, 0);
    const again = withTakeRegion(rows, rows[1].regions[0], 2, 0);
    expect(again.map((r) => r.regions.length)).toEqual([1, 1]);
  });

  it("rows arriving out of order are sorted", () => {
    let rows = withTakeRegion([], region("a", 2, BAR_PPQN), 2, 1);
    rows = withTakeRegion(rows, region("a", 1, 0), 1, 1);
    expect(rows.map((r) => r.takeNumber)).toEqual([1, 2]);
  });
});
