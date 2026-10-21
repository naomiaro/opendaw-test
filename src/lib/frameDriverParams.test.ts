import { describe, expect, it } from "vitest";
import { resolveFrameDriver, resolveFrameEvery } from "./frameDriverParams";

describe("resolveFrameDriver", () => {
  it("defaults to the SDK's own frame path, takes the URL's choice, lets the option win, rejects the rest", () => {
    expect(resolveFrameDriver(undefined, "")).toBe("window");
    expect(resolveFrameDriver(undefined, "?scenario=all&bpm=120")).toBe("window");
    expect(resolveFrameDriver(undefined, "?frameDriver=hidden-safe")).toBe("hidden-safe");
    expect(resolveFrameDriver(undefined, "?frameDriver=throttled")).toBe("throttled");
    expect(resolveFrameDriver("hidden-safe", "?frameDriver=window")).toBe("hidden-safe");
    expect(() => resolveFrameDriver(undefined, "?frameDriver=worker")).toThrow(/invalid \?frameDriver= "worker"/);
  });
});

describe("resolveFrameEvery", () => {
  it("is 2 when absent, the integer given, and rejects anything else", () => {
    expect(resolveFrameEvery("")).toBe(2);
    expect(resolveFrameEvery("?frameEvery=4")).toBe(4);
    expect(() => resolveFrameEvery("?frameEvery=0")).toThrow(/invalid \?frameEvery= "0"/);
    expect(() => resolveFrameEvery("?frameEvery=abc")).toThrow(/invalid \?frameEvery= "abc"/);
  });
});
