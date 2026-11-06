import { describe, expect, it } from "vitest";
import { GrooveShuffleBoxAdapter, ZeitgeistDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { midiEffectFixture } from "@/lib/testing/boxGraphFixtures";
import { patternById, REGION_START_PPQN, withGaps } from "./patterns";
import { applyZeitgeistTry, stillnessOf, ZEITGEIST_TRIES, zeitgeistShuffleOf } from "./zeitgeistGuide";

const zeitgeist = () => {
  const fixture = midiEffectFixture("zeitgeist");
  if (!(fixture.adapter instanceof ZeitgeistDeviceBoxAdapter)) throw new Error("not a zeitgeist fixture");
  const shuffle = zeitgeistShuffleOf(fixture.adapter);
  if (shuffle === null) throw new Error("the fixture's groove is not a shuffle");
  return { ...fixture, zeit: fixture.adapter, shuffle };
};

describe("stillnessOf", () => {
  it("names the default page's silence: Chords at 1/8 moves nothing, starts or ends", () => {
    expect(stillnessOf(patternById("chords").notes, 0.6, 480)).toBe("nothing");
  });
  it("Sixteenths at 1/8 moves its off-beats", () => {
    expect(stillnessOf(patternById("sixteenths").notes, 0.6, 480)).toBeNull();
  });
  it("Eighths at 1/8 start on the grid but end inside a cell: only the ends move", () => {
    expect(stillnessOf(patternById("eighths").notes, 0.75, 480)).toBe("ends-only");
  });
  it("Eighths at 1/4 move, Quarters at 1/4 only end differently, Quarters at 1/2 move", () => {
    expect(stillnessOf(patternById("eighths").notes, 0.75, 960)).toBeNull();
    expect(stillnessOf(patternById("quarters").notes, 0.75, 960)).toBe("ends-only");
    expect(stillnessOf(patternById("quarters").notes, 0.75, 1920)).toBeNull();
  });
  it("counts cells from position 0, not the region's start: a 3-bar cell is not on the region's grid", () => {
    // region-local this note starts and ends on a boundary; absolute it does neither
    const note = { position: 0, duration: 11520, pitch: 60, velocity: 1 };
    expect(REGION_START_PPQN % 11520).not.toBe(0);
    expect(stillnessOf([note], 0.75, 11520)).toBeNull();
  });
  it("reads the notes in the region: gapped Melody at 1/8 starts on the grid, but its shortened ends move", () => {
    expect(stillnessOf(patternById("melody").notes, 0.6, 480)).toBe("nothing");
    expect(stillnessOf(withGaps(patternById("melody"), 0.9).notes, 0.6, 480)).toBe("ends-only");
  });
  it("at 50 % time runs straight on any pattern", () => {
    expect(stillnessOf(patternById("sixteenths").notes, 0.5, 480)).toBe("straight");
  });
  it("one slider step off 50 % still moves notes, though the label rounds to 50 %", () => {
    expect(stillnessOf(patternById("sixteenths").notes, 0.495, 480)).toBeNull();
  });
});

describe("ZEITGEIST_TRIES", () => {
  it("every try moves its pattern's off-beats: none of them is a silent one", () => {
    for (const t of ZEITGEIST_TRIES) expect(stillnessOf(patternById(t.pattern).notes, t.amount, t.duration), t.label).toBeNull();
  });
  it("each Duration is twice its pattern's note spacing, on a duration the slider has", () => {
    for (const t of ZEITGEIST_TRIES) {
      const notes = patternById(t.pattern).notes;
      expect(t.duration, t.label).toBe(2 * (notes[1].position - notes[0].position));
      expect(GrooveShuffleBoxAdapter.DurationPPQNs).toContain(t.duration);
    }
  });
});

describe("applyZeitgeistTry", () => {
  it("writes the Amount and Duration from a state the try must change, as one undo step", () => {
    const { editing, shuffle } = zeitgeist();
    const try_ = ZEITGEIST_TRIES.find((t) => t.pattern === "quarters")!;
    expect(shuffle.namedParameter.duration.getValue()).not.toBe(try_.duration);
    expect(shuffle.namedParameter.amount.getValue()).not.toBeCloseTo(try_.amount, 3);
    applyZeitgeistTry(editing, shuffle, try_);
    expect(shuffle.namedParameter.duration.getValue()).toBe(try_.duration);
    expect(shuffle.namedParameter.amount.getValue()).toBeCloseTo(try_.amount, 6);
    editing.undo();
    expect(shuffle.namedParameter.duration.getValue()).toBe(480);
    expect(shuffle.namedParameter.amount.getValue()).toBeCloseTo(0.6, 6);
  });
  it("the off-beat moves further at each try, two and four times as far, as the copy says", () => {
    const { editing, shuffle } = zeitgeist();
    const moved = ZEITGEIST_TRIES.map((t) => {
      applyZeitgeistTry(editing, shuffle, t);
      const offBeat = REGION_START_PPQN + t.duration / 2;
      return Math.round((shuffle.warp(offBeat) - offBeat) * (60 / 120 / 960) * 1000);
    });
    expect(moved).toEqual([61, 122, 245]);
  });
});
