import { describe, expect, it } from "vitest";
import { exactFrame, metronomeClickFrame, ppqnAtBlockResidue, regionStartFrame, regionStartPpqn } from "./exportRegressionInBlock.ts";

const earlyClicks = (rate: number): number[] => {
  const early: number[] = [];
  for (let beat = 0; beat < 8 * 960; beat += 960) {
    const exact = exactFrame(beat, 120, rate);
    expect(metronomeClickFrame(beat, 120, rate) - exact, `${rate} beat ${beat}`).toBeGreaterThanOrEqual(-1);
    if (metronomeClickFrame(beat, 120, rate) !== exact) early.push(exact);
  }
  return early;
};

describe("exportRegressionInBlock", () => {
  it("places early exactly the clicks 0.0.183's metronome stems measured early, 120 bpm over 4 s", () => {
    // runs 1794246918474 (48 kHz) and 1794247036602 (44.1 kHz): first non-zero frame per click, minus one
    expect(earlyClicks(48000)).toEqual([24000, 72000]);
    expect(earlyClicks(44100)).toEqual([110250, 132300, 154350]);
  });
  it("picks the region starts the in-block rows rendered, one of them measured a frame early", () => {
    // runs 1794251449772 (48 kHz) and 1794251607099 (44.1 kHz): the predicted-early region's impulses a frame before the computed ones
    const picks = [48000, 44100].flatMap((rate) => [true, false].map((early) => {
      const ppqn = regionStartPpqn(1, 120, rate, early);
      return [rate, early, ppqn, regionStartFrame(ppqn, 120, rate), exactFrame(ppqn, 120, rate)];
    }));
    expect(picks).toEqual([
      [48000, true, 1930, 48249, 48250], [48000, false, 1921, 48025, 48025],
      [44100, true, 1920, 44099, 44100], [44100, false, 1952, 44835, 44835]
    ]);
  });
  it("puts a pulse on a block's first frame on that frame, whatever the arithmetic inside a block does", () => {
    for (const rate of [48000, 44100]) expect(regionStartFrame(0, 120, rate)).toBe(0);
    expect(regionStartFrame(4096, 120, 44100)).toBe(94080);
    expect(metronomeClickFrame(1920, 120, 48000)).toBe(48000);
  });
  it("picks a whole-frame start inside a block that the engine places early, and one it places on its frame", () => {
    for (const rate of [48000, 44100]) {
      for (const early of [true, false]) {
        const ppqn = regionStartPpqn(1, 120, rate, early);
        const frame = exactFrame(ppqn, 120, rate);
        expect(ppqn, `${rate} ${early}`).toBeGreaterThanOrEqual(1920);
        expect(Number.isInteger(frame)).toBe(true);
        expect(frame % 128).not.toBe(0);
        expect(regionStartFrame(ppqn, 120, rate) - frame).toBe(early ? -1 : 0);
      }
    }
  });
  it("finds the first whole frame on a block residue, the end of a block being residue 0", () => {
    expect(ppqnAtBlockResidue(2, 120, 48000, 0)).toBe(3840);
    expect(exactFrame(ppqnAtBlockResidue(2, 120, 48000, -1), 120, 48000)).toBe(98175);
    expect(exactFrame(ppqnAtBlockResidue(2, 120, 48000, 1), 120, 48000)).toBe(97025);
    for (const rate of [48000, 44100]) {
      for (const residue of [0, 1, 64, 127]) {
        const ppqn = ppqnAtBlockResidue(1.5, 120, rate, residue);
        const frame = exactFrame(ppqn, 120, rate);
        expect(Number.isInteger(frame), `${rate} ${residue}`).toBe(true);
        expect(frame % 128).toBe(residue);
        expect(frame).toBeGreaterThanOrEqual(1.5 * rate);
      }
    }
  });
  it("refuses a start it cannot convert rather than spinning", () => {
    expect(() => ppqnAtBlockResidue(Number.NaN, 120, 48000, 0)).toThrow();
    expect(() => regionStartPpqn(Number.NEGATIVE_INFINITY, 120, 48000, true)).toThrow();
  });
});
