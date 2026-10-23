import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { BEAT_PPQN, EIGHTH_BARS, THIRTYSECOND_BARS } from "./midiInputCalibration";
import { buildOutputPattern, JANK_PERIOD_MS, jankLabelFor, jankSchedule, patternEndPpqnOf } from "./midiOutputPattern";

describe("buildOutputPattern", () => {
  it("builds 96 thirty-second notes over 3 bars from the origin, held half a step, pitches cycling, no pitch held twice", () => {
    const notes = buildOutputPattern("32nd", 3, 2 * BAR_PPQN);
    expect(notes).toHaveLength(96);
    expect(notes[0]).toMatchObject({ index: 0, onPpqn: 2 * BAR_PPQN, durationPpqn: BEAT_PPQN / 16, tag: "thirtysecond", wrapAdjacent: false });
    expect(notes[95].onPpqn).toBe(2 * BAR_PPQN + 95 * (BEAT_PPQN / 8));
    expect(new Set(notes.slice(0, 48).map((n) => n.pitch)).size).toBe(48);
    expect(patternEndPpqnOf(notes)).toBe(5 * BAR_PPQN);
  });

  it("builds eighths, and 'both' as two bars of eighths then one bar of 1/32 regardless of bars", () => {
    const eighths = buildOutputPattern("8th", 2, 0);
    expect(eighths).toHaveLength(16);
    expect(eighths[1]).toMatchObject({ onPpqn: BEAT_PPQN / 2, durationPpqn: BEAT_PPQN / 4, tag: "eighth" });
    const both = buildOutputPattern("both", 8, 0);
    expect(both).toHaveLength(EIGHTH_BARS * 8 + THIRTYSECOND_BARS * 32);
    expect(patternEndPpqnOf(both)).toBe((EIGHTH_BARS + THIRTYSECOND_BARS) * BAR_PPQN);
  });

  it("gives every note a MIDI velocity byte", () => {
    for (const note of buildOutputPattern("8th", 1, 0)) {
      expect(Number.isInteger(note.velocity)).toBe(true);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(127);
    }
  });
});

describe("jankSchedule", () => {
  it("schedules blocks from the midpoint every 500 ms until the end", () => {
    expect(JANK_PERIOD_MS).toBe(500);
    expect(jankSchedule(1000, 2100, 80)).toEqual([
      { startPerfMs: 1000, endPerfMs: 1080 },
      { startPerfMs: 1500, endPerfMs: 1580 },
      { startPerfMs: 2000, endPerfMs: 2080 },
    ]);
    expect(jankSchedule(1000, 900, 80)).toEqual([]);
  });
});

describe("jankLabelFor", () => {
  it("labels a note by where its render time falls against the blocks", () => {
    const blocks = [{ startPerfMs: 1000, endPerfMs: 1080 }];
    expect(jankLabelFor(999, blocks, 107)).toBe("clear");
    expect(jankLabelFor(1000, blocks, 107)).toBe("inside");
    expect(jankLabelFor(1080, blocks, 107)).toBe("inside");
    expect(jankLabelFor(1150, blocks, 107)).toBe("first-after");
    expect(jankLabelFor(1188, blocks, 107)).toBe("clear");
    expect(jankLabelFor(1150, [], 107)).toBe("clear");
  });
});
