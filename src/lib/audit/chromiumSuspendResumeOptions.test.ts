import { describe, expect, it } from "vitest";
import { overallVerdict, suspendResumeOptionsFrom } from "./chromiumSuspendResumeOptions";

const parse = (query: string) => suspendResumeOptionsFrom(new URLSearchParams(query));

describe("suspendResumeOptionsFrom", () => {
  it("defaults to the graph-only run: 20 cycles, the one-second window, no control, no tracker preconditions", () => {
    expect(parse("issue=suspend-resume")).toEqual({
      control: null,
      witness: null,
      paceMs: 0,
      cycles: 20,
      repro: null,
    });
  });

  it("reads every option", () => {
    expect(parse("witness=mic&pace=1000&cycles=40&control=crackle&repro=tracker")).toEqual({
      control: "crackle",
      witness: "mic",
      paceMs: 1000,
      cycles: 40,
      repro: "tracker",
    });
  });

  it("throws on a value it does not know, naming the parameter", () => {
    expect(() => parse("witness=speaker")).toThrow("&witness=speaker");
    expect(() => parse("control=noise")).toThrow("&control=noise");
    expect(() => parse("repro=other")).toThrow("&repro=other");
    expect(() => parse("pace=-5")).toThrow("&pace=-5");
    expect(() => parse("pace=1.5")).toThrow("&pace=1.5");
    expect(() => parse("cycles=0")).toThrow("&cycles=0");
    expect(() => parse("cycles=abc")).toThrow("&cycles=abc");
  });
});

describe("overallVerdict", () => {
  it("is the graph's verdict without a witness", () => {
    expect(overallVerdict("CLEAN", null)).toBe("CLEAN");
  });

  it("is the microphone's verdict when the witness is on, whatever the graph read", () => {
    expect(overallVerdict("CLEAN", "DISTORTED")).toBe("DISTORTED");
    expect(overallVerdict("DISTORTED", "CLEAN")).toBe("CLEAN");
    expect(overallVerdict("CLEAN", "NOT CHECKED mic-NotAllowedError")).toBe("NOT CHECKED mic-NotAllowedError");
  });
});
