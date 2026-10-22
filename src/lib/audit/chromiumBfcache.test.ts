import { describe, expect, it } from "vitest";
import { clockRatio, judgeBfcache, type ClockRatioSample } from "./chromiumBfcache";

// The tracker's figures (Chromium 575891839): 0.967 before the restore, 0.501 after.
const before: ClockRatioSample = { contextAdvanceSec: 1.934, wallAdvanceSec: 2 };
const second = (ratio: number): ClockRatioSample => ({ contextAdvanceSec: ratio, wallAdvanceSec: 1 });
const halfSpeed = [second(0.501), second(0.501), second(0.501)];
const fullSpeed = [second(0.98), second(0.98), second(0.98)];

describe("clockRatio", () => {
  it("divides the context clock's advance by the wall clock's", () => {
    expect(clockRatio(before)).toBeCloseTo(0.967, 6);
    expect(clockRatio(second(0.501))).toBeCloseTo(0.501, 6);
  });
});

describe("judgeBfcache", () => {
  it("reads a restored clock that stays at half the baseline's speed as half speed", () => {
    const judged = judgeBfcache(before, halfSpeed, true, null);
    expect(judged.verdict).toBe("HALF SPEED");
    expect(judged.ratioBefore).toBeCloseTo(0.967, 6);
    expect(judged.ratioAfter).toBeCloseTo(0.501, 6);
    expect(judged.windowRatios).toHaveLength(3);
    expect(judged.reason).toBeNull();
  });

  it("reads a restored clock at the baseline's speed as normal", () => {
    const judged = judgeBfcache(before, fullSpeed, true, null);
    expect(judged.verdict).toBe("NORMAL");
    expect(judged.ratioAfter).toBeCloseTo(0.98, 6);
  });

  it("reads a clock that stalls in the first second and then runs true as normal", () => {
    const judged = judgeBfcache(before, [second(0.2), second(1.0), second(1.0)], true, null);
    expect(judged.verdict).toBe("NORMAL");
    expect(judged.ratioAfter).toBeCloseTo(1.0, 6);
    expect(judged.windowRatios[0]).toBeCloseTo(0.2, 6);
  });

  it("does not judge a page that was not restored from the cache, and carries the reasons", () => {
    const reasons = '{"reasons":[{"reason":"WebSocket"}]}';
    const judged = judgeBfcache(before, null, false, reasons);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.ratioBefore).toBeCloseTo(0.967, 6);
    expect(judged.ratioAfter).toBeNull();
    expect(judged.reason).toBe(reasons);
  });

  it("does not judge a restore without the windows after the first", () => {
    expect(judgeBfcache(before, null, true, null).verdict).toBe("NOT CHECKED");
    const one = judgeBfcache(before, [second(0.5)], true, null);
    expect(one.verdict).toBe("NOT CHECKED");
    expect(one.reason).toBe("too-few-windows");
  });

  it("does not judge when the clock was already slow before leaving", () => {
    const slow: ClockRatioSample = { contextAdvanceSec: 1.6, wallAdvanceSec: 2 };
    const judged = judgeBfcache(slow, halfSpeed, true, null);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.reason).toBe("baseline-slow");
  });
});
