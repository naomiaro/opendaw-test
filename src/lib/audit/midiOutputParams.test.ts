import { describe, expect, it } from "vitest";
import { classifyMidiStatus, parseMidiOutputParams, repeatDeadlineMs } from "./midiOutputParams";

describe("parseMidiOutputParams", () => {
  it("defaults to both arms, 140 bpm, 1/32, 3 bars, 2 repeats, delay 10, no jank, transport on, origin bar 2, bus IAC", () => {
    expect(parseMidiOutputParams(new URLSearchParams(""))).toEqual({
      arms: ["page", "engine"],
      bpms: [140],
      densities: ["32nd"],
      bars: 3,
      repeats: 2,
      delayInMs: 10,
      janks: ["none"],
      jankMs: 80,
      transports: [true],
      originBar: 2,
      bus: "IAC",
    });
  });

  it("reads bpm=all, jank=both, transport=both, arm=engine", () => {
    const p = parseMidiOutputParams(new URLSearchParams("bpm=all&jank=both&transport=both&arm=engine"));
    expect(p.bpms).toEqual([90, 120, 140]);
    expect(p.janks).toEqual(["none", "mid"]);
    expect(p.transports).toEqual([true, false]);
    expect(p.arms).toEqual(["engine"]);
  });

  it("reads arm=page alone, a single bpm, density, bars, delay, jankMs, origin and bus", () => {
    const p = parseMidiOutputParams(new URLSearchParams("arm=page&bpm=120&density=8th&bars=2&delay=0&jank=mid&jankMs=120&origin=3&bus=Bus 1&repeats=5"));
    expect(p).toEqual({
      arms: ["page"], bpms: [120], densities: ["8th"], bars: 2, repeats: 5, delayInMs: 0,
      janks: ["mid"], jankMs: 120, transports: [true], originBar: 3, bus: "Bus 1",
    });
  });

  it("refuses out-of-range and unknown values, naming the parameter", () => {
    for (const q of ["bpm=50", "delay=501", "repeats=0", "jankMs=5", "origin=9", "density=16th", "arm=x", "transport=yes", "bars=0", "jank=late"]) {
      expect(() => parseMidiOutputParams(new URLSearchParams(q))).toThrow(new RegExp(q.split("=")[0]));
    }
  });
});

describe("classifyMidiStatus", () => {
  it("tells notes from transport from the rest", () => {
    expect(classifyMidiStatus(0x90)).toBe("note-on");
    expect(classifyMidiStatus(0x9f)).toBe("note-on");
    expect(classifyMidiStatus(0x8f)).toBe("note-off");
    for (const s of [0xf8, 0xfa, 0xfc, 0xf2]) expect(classifyMidiStatus(s)).toBe("transport");
    expect(classifyMidiStatus(0xb0)).toBe("other");
    expect(classifyMidiStatus(0xfe)).toBe("other");
  });
});

describe("repeatDeadlineMs", () => {
  it("covers the origin, the pattern, the trailing bar and the setup, so the longest allowed cell is not cut off", () => {
    // 60 bpm, 8 bars of eighths from bar 8: 28 s to the origin, 32 s of pattern, a 4 s tail = 64 s of transport.
    const longest = repeatDeadlineMs({ bpm: 60, density: "8th", bars: 8, originBar: 8 });
    expect(longest).toBeGreaterThan(64_000 + 30_000);
    expect(longest).toBeLessThan(64_000 + 60_000);
    // The default cell (140 bpm, 3 bars of 1/32 from bar 2) stays near the minute it had.
    expect(repeatDeadlineMs({ bpm: 140, density: "32nd", bars: 3, originBar: 2 })).toBeLessThan(60_000);
    // Density "both" is three bars whatever `bars` says.
    expect(repeatDeadlineMs({ bpm: 60, density: "both", bars: 8, originBar: 1 })).toBeLessThan(repeatDeadlineMs({ bpm: 60, density: "8th", bars: 8, originBar: 1 }));
  });
});

