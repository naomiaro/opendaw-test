import { describe, expect, it } from "vitest";
import { BAR_PPQN, isLeadInTake, takeIterationNumber, takeNumberOf, trackedTakeBaselines } from "./takeLeadIn";

describe("isLeadInTake", () => {
  it("a take that starts before the loop area is the lead-in, whatever its number", () => {
    expect(isLeadInTake(0, 1)).toBe(true);
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
