import { describe, expect, it } from "vitest";
import { BAR_PPQN, isLeadInTake } from "./takeLeadIn";

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
