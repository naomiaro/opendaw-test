import { describe, expect, it } from "vitest";
import { GrooveShuffleBoxAdapter, ParameterFieldAdapters, type BoxAdaptersContext } from "@opendaw/studio-adapters";
import { graphWithZeitgeist, transact } from "@/lib/testing/boxGraphFixtures";
import { arpeggioSteps, echoCopies, expectedFrames, instrumentOffsetFrames, zeitgeistWarped } from "./midiEffectRules";

describe("arpeggioSteps", () => {
  it("lands on the absolute grid, includes a start on a grid line and excludes an end on one", () => {
    expect(arpeggioSteps(3840, 5760, 240)).toEqual([3840, 4080, 4320, 4560, 4800, 5040, 5280, 5520]);
    expect(arpeggioSteps(3850, 5760, 240)).toEqual([4080, 4320, 4560, 4800, 5040, 5280, 5520]);
  });
});

describe("echoCopies", () => {
  it("yields the original and repeats − 1 copies", () => {
    expect(echoCopies(3840, 120, 3)).toEqual([3840, 3960, 4080]);
    expect(echoCopies(3840, 120, 1)).toEqual([3840]);
  });
});

describe("zeitgeistWarped", () => {
  const adapterFor = (amount: number) => {
    const { boxGraph, groove } = graphWithZeitgeist();
    transact(boxGraph, () => groove.amount.setValue(amount));
    const context = { parameterFieldAdapters: new ParameterFieldAdapters(), isMainThread: false } as unknown as BoxAdaptersContext;
    return new GrooveShuffleBoxAdapter(context, groove);
  };
  it("keeps every cell start where it is and pushes the off-beat later at the factory amount", () => {
    const warped = zeitgeistWarped([3840, 4080, 4320, 4560], adapterFor(0.6));
    expect(warped[0]).toBe(3840);
    expect(warped[2]).toBe(4320);
    expect(warped[1]).toBeGreaterThan(4080);
    expect(warped[1]).toBeLessThan(4320);
    expect(warped[3]).toBeCloseTo(4560 + (warped[1] - 4080), 9);
  });
  it("keeps the warped pulse as the engine does, not rounded to a whole pulse (33 frames at 90 bpm)", () => {
    const warped = zeitgeistWarped([4080], adapterFor(0.6));
    expect(Number.isInteger(warped[0])).toBe(false);
  });
  it("is the identity at amount 0.5", () => {
    expect(zeitgeistWarped([3840, 4080, 4320], adapterFor(0.5))).toEqual([3840, 4080, 4320]);
  });
});

describe("frames", () => {
  it("maps pulses to frames at the tempo and adds the instrument offset", () => {
    expect(expectedFrames([3840, 4080], 120, 48000, 7)).toEqual([96007, 102007]);
    expect(instrumentOffsetFrames(96007, 3840, 120, 48000)).toBe(7);
  });
});
