import { describe, expect, it } from "vitest";
import { overallVerdict, suspendResumeOptionsFrom } from "./chromiumSuspendResumeOptions";

const parse = (query: string) => suspendResumeOptionsFrom(new URLSearchParams(query));

describe("suspendResumeOptionsFrom", () => {
  it("defaults to the plain run: 20 cycles, the one-second window, the module file, no stall", () => {
    expect(parse("issue=suspend-resume")).toEqual({
      control: null,
      witness: null,
      paceMs: 0,
      cycles: 20,
      stallMs: 0,
      gapMs: 0,
      rate: null,
      firstCycle: false,
      module: "file",
      manual: false,
      tracker: false,
    });
  });

  it("reads the tracker preset as the repro page's setup", () => {
    expect(parse("tracker=1")).toMatchObject({
      stallMs: 80,
      rate: 44100,
      firstCycle: true,
      paceMs: 1000,
      tracker: true,
      module: "file",
    });
  });

  it("lets an explicit parameter override the preset", () => {
    expect(parse("tracker=1&stallMs=0&module=blob&gapMs=500")).toMatchObject({
      stallMs: 0,
      module: "blob",
      gapMs: 500,
      rate: 44100,
      firstCycle: true,
    });
  });

  it("reads every other option", () => {
    expect(parse("witness=mic&pace=250&cycles=40&control=crackle&rate=48000&firstCycle=1&manual=1")).toMatchObject({
      control: "crackle",
      witness: "mic",
      paceMs: 250,
      cycles: 40,
      rate: 48000,
      firstCycle: true,
      manual: true,
    });
  });

  it("throws on a value it does not know, naming the parameter", () => {
    expect(() => parse("witness=speaker")).toThrow("&witness=speaker");
    expect(() => parse("control=noise")).toThrow("&control=noise");
    expect(() => parse("module=inline")).toThrow("&module=inline");
    expect(() => parse("tracker=yes")).toThrow("&tracker=yes");
    expect(() => parse("pace=-5")).toThrow("&pace=-5");
    expect(() => parse("pace=1.5")).toThrow("&pace=1.5");
    expect(() => parse("cycles=0")).toThrow("&cycles=0");
    expect(() => parse("cycles=abc")).toThrow("&cycles=abc");
    expect(() => parse("rate=100")).toThrow("&rate=100");
  });
});

describe("overallVerdict", () => {
  it("is the graph's verdict without a witness", () => {
    expect(overallVerdict("CLEAN", null, false)).toBe("CLEAN");
    expect(overallVerdict("DISTORTED", null, false)).toBe("DISTORTED");
  });

  it("is HALF RATE whenever the clock rule fires, over either reading", () => {
    expect(overallVerdict("CLEAN", null, true)).toBe("HALF RATE");
    expect(overallVerdict("DISTORTED", "DISTORTED", true)).toBe("HALF RATE");
    expect(overallVerdict("NOT CHECKED 5-cycles", null, true)).toBe("HALF RATE");
  });

  it("is DISTORTED when the graph rule fires, whatever the microphone read", () => {
    expect(overallVerdict("DISTORTED", "CLEAN", false)).toBe("DISTORTED");
    expect(overallVerdict("DISTORTED", "DISTORTED", false)).toBe("DISTORTED");
  });

  it("marks distortion the microphone alone heard as mic only: a room sound reads the same", () => {
    expect(overallVerdict("CLEAN", "DISTORTED", false)).toBe("DISTORTED (mic only)");
  });

  it("is CLEAN when every rule is clean", () => {
    expect(overallVerdict("CLEAN", "CLEAN", false)).toBe("CLEAN");
  });

  it("keeps NOT CHECKED when a reading could not be judged and no rule fired", () => {
    expect(overallVerdict("NOT CHECKED 5-cycles", "NOT CHECKED 5-cycles", false)).toBe("NOT CHECKED 5-cycles");
    expect(overallVerdict("CLEAN", "NOT CHECKED mic-NotAllowedError", false)).toBe("NOT CHECKED mic-NotAllowedError");
  });
});
