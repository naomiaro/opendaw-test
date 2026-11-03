import { describe, expect, it } from "vitest";
import { INITIAL_STATE, desiredChain, pageReducer, type PageState } from "./pageState";

const stack = (tab: PageState["tab"], ...ids: PageState["stack"]): PageState => ({ mode: "stack", tab, stack: ids });

describe("pageReducer", () => {
  it("starts in single mode on dry with an empty chain", () => {
    expect(INITIAL_STATE).toEqual({ mode: "single", tab: "dry", stack: [] });
    expect(desiredChain(INITIAL_STATE)).toEqual([]);
  });

  it("selectTab in single mode sets the tab and the chain", () => {
    const s = pageReducer(INITIAL_STATE, { type: "selectTab", tab: "pitch" });
    expect(s).toEqual({ mode: "single", tab: "pitch", stack: [] });
    expect(desiredChain(s)).toEqual(["pitch"]);
  });

  it("selectTab in stack mode is ignored", () => {
    const before = stack("arpeggio", "arpeggio", "pitch");
    expect(pageReducer(before, { type: "selectTab", tab: "velocity" })).toBe(before);
  });

  it("addToStack from a single device carries that device as the first chip", () => {
    const s = pageReducer({ mode: "single", tab: "arpeggio", stack: [] }, { type: "addToStack", id: "pitch" });
    expect(s).toEqual({ mode: "stack", tab: "arpeggio", stack: ["arpeggio", "pitch"] });
    expect(desiredChain(s)).toEqual(["arpeggio", "pitch"]);
  });

  it("addToStack from dry starts the stack with the added device", () => {
    expect(pageReducer(INITIAL_STATE, { type: "addToStack", id: "zeitgeist" })).toEqual(stack("dry", "zeitgeist"));
  });

  it("addToStack of a device already stacked is ignored", () => {
    const before = stack("dry", "pitch");
    expect(pageReducer(before, { type: "addToStack", id: "pitch" })).toBe(before);
  });

  it("moveInStack reorders with arrayMove semantics", () => {
    const before = stack("dry", "pitch", "velocity", "arpeggio");
    expect(pageReducer(before, { type: "moveInStack", from: 2, to: 0 }).stack).toEqual(["arpeggio", "pitch", "velocity"]);
    expect(pageReducer(before, { type: "moveInStack", from: 0, to: 2 }).stack).toEqual(["velocity", "arpeggio", "pitch"]);
  });

  it("removeFromStack drops the chip", () => {
    expect(pageReducer(stack("dry", "pitch", "velocity"), { type: "removeFromStack", id: "pitch" })).toEqual(stack("dry", "velocity"));
  });

  it("removing the last chip returns to single/dry", () => {
    expect(pageReducer(stack("arpeggio", "arpeggio"), { type: "removeFromStack", id: "arpeggio" })).toEqual(INITIAL_STATE);
  });

  it("clearStack returns to single/dry", () => {
    expect(pageReducer(stack("pitch", "pitch", "velocity"), { type: "clearStack" })).toEqual(INITIAL_STATE);
  });

  it("desiredChain never has a duplicate", () => {
    let s = INITIAL_STATE;
    for (const id of ["pitch", "pitch", "velocity", "pitch"] as const) s = pageReducer(s, { type: "addToStack", id });
    expect(desiredChain(s)).toEqual(["pitch", "velocity"]);
  });
});
