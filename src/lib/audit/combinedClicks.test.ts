import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { buildPattern } from "./midiInputPattern";
import { clickContextTimes, inputLatencySecondsFor } from "./combinedClicks";

describe("clickContextTimes", () => {
  it("puts each click at the render time of its note's heard instant", () => {
    const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });
    const s = clickContextTimes(pattern, { contextTime: 12, position: 0 }, 120);
    expect(s[0].index).toBe(0);
    expect(s[0].contextSec).toBeCloseTo(14, 9); // one bar at 120 = 2 s after the anchor
    expect(s[1].contextSec - s[0].contextSec).toBeCloseTo(0.25, 9); // an eighth
    expect(s.length).toBe(48);
  });
});

describe("inputLatencySecondsFor", () => {
  it("is zero in the default state and the measured part in seconds when calibrated", () => {
    expect(inputLatencySecondsFor("default", 40.9)).toBe(0);
    expect(inputLatencySecondsFor("calibrated", 40.9)).toBeCloseTo(0.0409, 9);
  });
});
