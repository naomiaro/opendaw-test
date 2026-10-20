import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { buildPattern } from "./midiInputPattern";
import { matchClicks, measureCombined, onsetsToTimelineSec, withinSpan } from "./combinedAudio";

const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });
const late = (ms: number, bpm = 120) => (ms / (60_000 / bpm)) * 960;

describe("onsetsToTimelineSec / withinSpan", () => {
  it("maps file time through the region start and waveform offset and splits the span", () => {
    expect(onsetsToTimelineSec([0.5, 1.5], 2.0, 0.1)).toEqual([2.4, 3.4]);
    expect(withinSpan([1.9, 2.4, 3.4, 9.0], 2.0, 8.0)).toEqual({ inside: [2.4, 3.4], outside: 2 });
  });
});

describe("matchClicks", () => {
  it("anchors on the eighth bars and matches a 65 ms late 1/32 bar to the right notes", () => {
    const clicks = pattern.map((n) => n.onPpqn + late(65));
    const m = matchClicks(pattern, clicks, 120);
    expect(m.pairs.length).toBe(48);
    expect(m.anchorOffsetMs).toBeCloseTo(65, 6);
    expect(m.pairs.every((p) => Math.abs(p.audioErrorMs - 65) < 1e-6)).toBe(true);
    expect(m.clicksMissing).toEqual([]);
  });
  it("leaves a lost click missing without shifting the pairs after it", () => {
    const clicks = pattern.filter((n) => n.index !== 20).map((n) => n.onPpqn + late(40));
    const m = matchClicks(pattern, clicks, 120);
    expect(m.clicksMissing).toEqual([20]);
    expect(m.pairs.find((p) => p.index === 21)!.audioErrorMs).toBeCloseTo(40, 6);
  });
  it("does not let a burst between the grid and a late click steal an eighth's pair", () => {
    const clicks = [...pattern.map((n) => n.onPpqn + late(64)), pattern[5].onPpqn + 30]; // the burst 16 ms after the grid, the click 64 ms
    const m = matchClicks(pattern, clicks, 120);
    expect(m.pairs.find((p) => p.index === 5)!.audioErrorMs).toBeCloseTo(64, 6);
    expect(m.clicksExtraPpqn).toEqual([pattern[5].onPpqn + 30]);
  });
  it("counts a noise burst as extra and never pairs it", () => {
    const clicks = [...pattern.map((n) => n.onPpqn + late(40)), pattern[5].onPpqn + late(40) + 200];
    const m = matchClicks(pattern, clicks, 120);
    expect(m.clicksExtraPpqn).toEqual([pattern[5].onPpqn + late(40) + 200]);
    expect(m.pairs.find((p) => p.index === 5)!.audioErrorMs).toBeCloseTo(40, 6);
  });
});

describe("measureCombined", () => {
  it("pairs a matched click with a matched MIDI row and reports midi minus audio", () => {
    const clicks = pattern.map((n) => n.onPpqn + late(40));
    const m = matchClicks(pattern, clicks, 120);
    const rows = pattern.map((n) => ({ index: n.index, outcome: "matched", recordedPpqn: n.onPpqn + late(32) } as never));
    const { figures, pairs } = measureCombined(m, rows, 120, 1);
    expect(pairs.length).toBe(48);
    expect(figures.partsApartMedianMs).toBeCloseTo(-8, 6);
    expect(figures).toMatchObject({ clicksFound: 48, clicksMissing: 0, clicksExtra: 0, onsetsOutsideSpan: 1 });
    expect(figures.audioMedianMs).toBeCloseTo(40, 6);
  });
  it("drops a pair whose MIDI row is missing and keeps the figures over the rest", () => {
    const clicks = pattern.map((n) => n.onPpqn);
    const rows = pattern.map((n) => ({ index: n.index, outcome: n.index === 3 ? "missing" : "matched", recordedPpqn: n.index === 3 ? null : n.onPpqn } as never));
    expect(measureCombined(matchClicks(pattern, clicks, 120), rows, 120, 0).pairs.length).toBe(47);
  });
});
