import { describe, expect, it } from "vitest";
import { PPQN } from "@opendaw/lib-dsp";
import { SECTION_PPQN, nextFreeSectionStart, barSeconds } from "./arrangement";

describe("nextFreeSectionStart", () => {
  it("returns 0 for an empty arrangement", () => {
    expect(nextFreeSectionStart([])).toBe(0);
  });
  it("returns the next section boundary after the furthest region end", () => {
    // one committed section: regions end at 4 bars
    expect(nextFreeSectionStart([SECTION_PPQN])).toBe(SECTION_PPQN);
    // ends at bars 4 and 8 -> next free is bar 8
    expect(nextFreeSectionStart([SECTION_PPQN, 2 * SECTION_PPQN])).toBe(2 * SECTION_PPQN);
  });
  it("rounds a partial section up to the next boundary", () => {
    expect(nextFreeSectionStart([PPQN.Bar])).toBe(SECTION_PPQN);
    expect(nextFreeSectionStart([SECTION_PPQN + 1])).toBe(2 * SECTION_PPQN);
  });
});

describe("barSeconds", () => {
  it("is 4 beats at the given tempo", () => {
    expect(barSeconds(124)).toBeCloseTo((60 / 124) * 4, 10);
  });
});
