import { describe, expect, it } from "vitest";
import { EmittedBars } from "./emittedNotes";

const on = (...pitches: number[]) => (p: number) => pitches.includes(p);

describe("EmittedBars", () => {
  it("opens a bar when a pitch turns on and closes it when it turns off", () => {
    const e = new EmittedBars();
    e.sample(on(60), 100);
    e.sample(on(60), 200);
    e.sample(on(), 300);
    expect(e.bars).toEqual([{ pitch: 60, from: 100, to: 300 }]);
  });

  it("keeps a sounding bar open", () => {
    const e = new EmittedBars();
    e.sample(on(60), 100);
    e.sample(on(60), 200);
    expect(e.bars).toEqual([{ pitch: 60, from: 100, to: null }]);
  });

  it("wrap clears open bars", () => {
    const e = new EmittedBars();
    e.sample(on(60), 7000);
    e.sample(on(60), 100);
    expect(e.bars).toEqual([{ pitch: 60, from: 100, to: null }]);
  });

  it("reset drops everything", () => {
    const e = new EmittedBars();
    e.sample(on(60, 64), 100);
    e.reset();
    expect(e.bars).toEqual([]);
  });

  it("two pitches at once make two bars", () => {
    const e = new EmittedBars();
    e.sample(on(60, 64), 100);
    e.sample(on(64), 200);
    expect(e.bars).toEqual([
      { pitch: 60, from: 100, to: 200 },
      { pitch: 64, from: 100, to: null },
    ]);
  });

  it("a stop and restart between two frames is not seen: two hits of one pitch read as one bar", () => {
    const e = new EmittedBars();
    e.sample(on(60), 100);
    // a frame later the pitch is on again: nothing says it stopped in between
    e.sample(on(60), 133);
    e.sample(on(), 300);
    expect(e.bars).toEqual([{ pitch: 60, from: 100, to: 300 }]);
  });

  it("drops bars that fell more than a pattern behind", () => {
    const e = new EmittedBars(7680);
    e.sample(on(60), 100);
    e.sample(on(), 200);
    e.sample(on(), 7881);
    expect(e.bars).toEqual([]);
  });
});
