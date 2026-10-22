import { describe, expect, it } from "vitest";
import { clockRatio, judgeBfcache, type ClockRatioSample } from "./chromiumBfcache";

// The tracker's figures (Chromium 575891839): 0.967 before the restore, 0.501 after.
const before: ClockRatioSample = { contextAdvanceSec: 1.934, wallAdvanceSec: 2 };
const halfSpeed: ClockRatioSample = { contextAdvanceSec: 1.503, wallAdvanceSec: 3 };
const fullSpeed: ClockRatioSample = { contextAdvanceSec: 2.94, wallAdvanceSec: 3 };

describe("clockRatio", () => {
  it("divides the context clock's advance by the wall clock's", () => {
    expect(clockRatio(before)).toBeCloseTo(0.967, 6);
    expect(clockRatio(halfSpeed)).toBeCloseTo(0.501, 6);
  });
});

describe("judgeBfcache", () => {
  it("reads a restored clock at half the baseline's speed as half speed", () => {
    const judged = judgeBfcache(before, halfSpeed, true, null);
    expect(judged.verdict).toBe("HALF SPEED");
    expect(judged.ratioBefore).toBeCloseTo(0.967, 6);
    expect(judged.ratioAfter).toBeCloseTo(0.501, 6);
    expect(judged.reason).toBeNull();
  });

  it("reads a restored clock at the baseline's speed as normal", () => {
    const judged = judgeBfcache(before, fullSpeed, true, null);
    expect(judged.verdict).toBe("NORMAL");
    expect(judged.ratioAfter).toBeCloseTo(0.98, 6);
  });

  it("does not judge a page that was not restored from the cache, and carries the reasons", () => {
    const reasons = '{"reasons":[{"reason":"WebSocket"}]}';
    const judged = judgeBfcache(before, null, false, reasons);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.ratioBefore).toBeCloseTo(0.967, 6);
    expect(judged.ratioAfter).toBeNull();
    expect(judged.reason).toBe(reasons);
  });

  it("does not judge a restore without a second measurement", () => {
    const judged = judgeBfcache(before, null, true, null);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.reason).not.toBeNull();
  });

  it("does not judge when the clock was already slow before leaving", () => {
    const slow: ClockRatioSample = { contextAdvanceSec: 1.6, wallAdvanceSec: 2 };
    const judged = judgeBfcache(slow, halfSpeed, true, null);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.reason).toBe("baseline-slow");
  });
});
