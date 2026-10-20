import { describe, expect, it } from "vitest";
import {
  contextSecAtPosition, heardContextSecAt, isFreshAnchor, perfMsAtHeardContextSec, positionAtContextSec, pulsesToMs,
  renderPpqnFromHeard,
} from "./midiClockMap";

const pair = { contextTime: 10.0, performanceTime: 5000 };
const anchor = { contextTime: 12.0, position: 3840 };

describe("midiClockMap", () => {
  it("maps a performance stamp to the heard context time and back", () => {
    expect(heardContextSecAt(pair, 5250)).toBeCloseTo(10.25, 9);
    expect(perfMsAtHeardContextSec(pair, 10.25)).toBeCloseTo(5250, 9);
  });
  it("is linear from the anchor at the cell's bpm", () => {
    expect(positionAtContextSec(anchor, 120, 12.5)).toBeCloseTo(3840 + 960, 6); // one beat at 120 = 0.5 s
    expect(contextSecAtPosition(anchor, 120, 3840 + 960)).toBeCloseTo(12.5, 9);
    expect(positionAtContextSec(anchor, 90, 12.0)).toBe(3840);
  });
  it("converts pulses to milliseconds at the cell's bpm", () => {
    expect(pulsesToMs(960, 120)).toBeCloseTo(500, 9);
    expect(pulsesToMs(1, 90)).toBeCloseTo(0.6944, 3);
  });
  it("rejects an anchor from before this repeat's record request", () => {
    expect(isFreshAnchor(anchor, 11.9)).toBe(true);
    expect(isFreshAnchor(anchor, 12.0)).toBe(true);
    expect(isFreshAnchor(anchor, 12.1)).toBe(false);
  });
  it("offsets the heard position by the output latency for the render column", () => {
    expect(renderPpqnFromHeard(3840, 0.023, 120)).toBeCloseTo(3840 + 44.16, 1);
  });
});
