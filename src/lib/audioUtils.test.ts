import { describe, expect, it } from "vitest";
import { formatDuration } from "./audioUtils";

describe("formatDuration", () => {
  it("renders compact m:ss by default", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(30)).toBe("0:30");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(3661)).toBe("61:01");
  });

  it("carries when rounding at the displayed precision — never 1:60", () => {
    expect(formatDuration(119.6)).toBe("2:00");
    expect(formatDuration(59.5)).toBe("1:00");
    expect(formatDuration(59.4)).toBe("0:59");
  });

  it("pads minutes for mm formats", () => {
    expect(formatDuration(65, "mm:ss")).toBe("01:05");
    expect(formatDuration(65.3, "mm:ss.cc")).toBe("01:05.30");
    expect(formatDuration(5.017, "mm:ss.cc")).toBe("00:05.02");
  });

  it("renders tenths with carry", () => {
    expect(formatDuration(65.3, "m:ss.t")).toBe("1:05.3");
    expect(formatDuration(65.97, "m:ss.t")).toBe("1:06.0");
    expect(formatDuration(59.96, "m:ss.t")).toBe("1:00.0");
  });

  it("rounds decimally-exact inputs correctly despite binary-float droop", () => {
    // 1.005 * 100 === 100.49999999999999 — naive Math.round drops to "00:01.00"
    expect(formatDuration(1.005, "mm:ss.cc")).toBe("00:01.01");
    expect(formatDuration(8.005, "mm:ss.cc")).toBe("00:08.01");
  });

  it("truncates in floor mode so a live clock never runs ahead", () => {
    expect(formatDuration(5.999, "mm:ss.cc", "floor")).toBe("00:05.99");
    expect(formatDuration(59.999, "mm:ss.cc", "floor")).toBe("00:59.99");
    expect(formatDuration(59.5, "m:ss", "floor")).toBe("0:59");
  });

  it("renders non-finite and negative input as zeros in the requested format", () => {
    expect(formatDuration(NaN, "mm:ss.cc")).toBe("00:00.00");
    expect(formatDuration(Infinity)).toBe("0:00");
    expect(formatDuration(-3, "m:ss.t")).toBe("0:00.0");
  });
});
