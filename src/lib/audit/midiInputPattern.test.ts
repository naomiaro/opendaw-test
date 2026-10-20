import { describe, expect, it } from "vitest";
import { PPQN } from "@opendaw/lib-dsp";
import { BAR_PPQN } from "./auditExpectations";
import { BEAT_PPQN, EIGHTH_BARS, PITCH_RANGE, THIRTYSECOND_BARS } from "./midiInputCalibration";
import { buildPattern, countInSchedule, patternEndPpqn, patternOriginPpqn, pitchForIndex } from "./midiInputPattern";

describe("buildPattern", () => {
  it("lays two bars of eighths then one bar of thirty-seconds from the origin", () => {
    const notes = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });
    expect(notes.length).toBe(EIGHTH_BARS * 8 + THIRTYSECOND_BARS * 32);
    expect(notes[0]).toMatchObject({ index: 0, tag: "eighth", onPpqn: BAR_PPQN, durationPpqn: BEAT_PPQN / 4 });
    expect(notes[16]).toMatchObject({ index: 16, tag: "thirtysecond", onPpqn: 3 * BAR_PPQN, durationPpqn: BEAT_PPQN / 16 });
    expect(notes.at(-1)!.onPpqn + notes.at(-1)!.durationPpqn).toBeLessThan(patternEndPpqn(BAR_PPQN));
  });
  it("tags the note on a loop end as wrapAdjacent and no other", () => {
    const notes = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: 2 * BAR_PPQN });
    expect(notes.filter((n) => n.wrapAdjacent).map((n) => n.onPpqn)).toEqual([2 * BAR_PPQN]);
    expect(buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null }).some((n) => n.wrapAdjacent)).toBe(false);
  });
  it("never holds two notes of one pitch at the same time", () => {
    const notes = buildPattern({ originPpqn: 0, loopEndPpqn: null });
    for (const a of notes) for (const b of notes) {
      if (a.index >= b.index || a.pitch !== b.pitch) continue;
      expect(a.onPpqn + a.durationPpqn).toBeLessThan(b.onPpqn);
    }
  });
  it("cycles pitches over PITCH_RANGE and velocities over the set", () => {
    expect(pitchForIndex(0)).toBe(36);
    expect(pitchForIndex(PITCH_RANGE)).toBe(36);
    expect(buildPattern({ originPpqn: 0, loopEndPpqn: null }).slice(0, 4).map((n) => n.velocity)).toEqual([100, 64, 127, 32]);
  });
});

describe("patternOriginPpqn", () => {
  it("is the first bar boundary at or after now plus the lead", () => {
    expect(patternOriginPpqn(0, 120)).toBe(BAR_PPQN); // 300 ms = 576 pulses → bar 1
    expect(patternOriginPpqn(BAR_PPQN - 10, 120)).toBe(2 * BAR_PPQN);
    expect(patternOriginPpqn(BAR_PPQN, 120, 0)).toBe(BAR_PPQN);
    expect(patternOriginPpqn(0, 90)).toBe(BAR_PPQN); // 300 ms = 432 pulses
    expect(PPQN.secondsToPulses(0.3, 120)).toBeCloseTo(576, 6);
  });
});

describe("countInSchedule", () => {
  it("places two short notes inside the count-in bar and one that is still held at the downbeat", () => {
    const bar = (4 * 60_000) / 120;
    const notes = countInSchedule(120);
    expect(notes.map((n) => n.pitch)).toEqual([85, 86, 87]);
    expect(notes[0]).toMatchObject({ offsetMs: 0.15 * bar, holdMs: 100 });
    expect(notes[1]).toMatchObject({ offsetMs: 0.35 * bar, holdMs: 100 });
    expect(notes[2].offsetMs).toBeCloseTo(0.75 * bar, 6);
    expect(notes[2].offsetMs + notes[2].holdMs).toBeCloseTo(1.25 * bar, 6);
    const slow = countInSchedule(90);
    expect(slow[2].offsetMs + slow[2].holdMs).toBeGreaterThan((4 * 60_000) / 90);
  });
});
