import { describe, expect, it } from "vitest";
import {
  BASELINE_MIN_RATIO,
  HALF_SPEED_MAX_RATIO,
  STORED_BFCACHE_RUN_VERSION,
  clockRatio,
  judgeBfcache,
  parseStoredBfcacheRun,
  type ClockRatioSample,
  type StoredBfcacheRun,
} from "./chromiumBfcache";
import { judgeHalfRate } from "./chromiumSuspendResume";

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

  it("does not read a settled ratio of exactly HALF_SPEED_MAX_RATIO as slow", () => {
    const at = second(HALF_SPEED_MAX_RATIO);
    expect(judgeBfcache(before, [at, at, at], true, null).verdict).toBe("NORMAL");
  });

  it("judges against a baseline of exactly BASELINE_MIN_RATIO", () => {
    const edge: ClockRatioSample = { contextAdvanceSec: 2 * BASELINE_MIN_RATIO, wallAdvanceSec: 2 };
    expect(judgeBfcache(edge, halfSpeed, true, null).verdict).toBe("HALF SPEED");
  });

  it("does not judge an empty list of windows after the restore", () => {
    const judged = judgeBfcache(before, [], true, null);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.reason).toBe("too-few-windows");
  });

  it("reads a clock that stopped after the restore, ratio 0, as half speed", () => {
    expect(judgeBfcache(before, [second(0), second(0), second(0)], true, null).verdict).toBe("HALF SPEED");
  });

  it("does not judge a page that was not restored, even with windows measured after it", () => {
    const judged = judgeBfcache(before, halfSpeed, false, null);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.reason).toBe("not-restored, no reasons reported");
  });
});

describe("judgeHalfRate boundaries", () => {
  const before2 = { contextAdvanceSec: 2, wallAdvanceSec: 2 };

  it("does not read windows at exactly HALF_SPEED_MAX_RATIO as slow", () => {
    expect(judgeHalfRate(before2, [1, HALF_SPEED_MAX_RATIO, HALF_SPEED_MAX_RATIO].map(second)).halfRate).toBe(false);
  });

  it("judges against a baseline of exactly BASELINE_MIN_RATIO", () => {
    expect(judgeHalfRate({ contextAdvanceSec: 2 * BASELINE_MIN_RATIO, wallAdvanceSec: 2 }, [0.5, 0.5].map(second)).halfRate).toBe(true);
  });

  it("reads a clock stopped at ratio 0 for two windows as half rate", () => {
    expect(judgeHalfRate(before2, [1, 0, 0].map(second))).toMatchObject({ halfRate: true, firstHalfCycle: 1 });
  });

  it("does not judge an empty list of windows", () => {
    expect(judgeHalfRate(before2, [])).toMatchObject({ halfRate: false, firstHalfCycle: null, ratios: [] });
  });
});

describe("parseStoredBfcacheRun", () => {
  const run: StoredBfcacheRun = {
    version: STORED_BFCACHE_RUN_VERSION,
    runToken: "mvk1abcd-q1w2",
    chrome: "Google Chrome 155",
    date: "2026-10-22",
    before,
    pitchBefore: { control: 660, worklet: 440 },
    sampleRate: 48000,
    startedAt: 1_000_000,
  };

  it("parses what the run stored", () => {
    expect(parseStoredBfcacheRun(JSON.stringify(run))).toEqual(run);
  });

  it("refuses text that is not JSON, or JSON of another shape", () => {
    expect(parseStoredBfcacheRun("{not json")).toBeNull();
    expect(parseStoredBfcacheRun("null")).toBeNull();
    expect(parseStoredBfcacheRun(JSON.stringify({ ...run, before: { contextAdvanceSec: "1" } }))).toBeNull();
    expect(parseStoredBfcacheRun(JSON.stringify({ ...run, pitchBefore: null }))).toBeNull();
    expect(parseStoredBfcacheRun(JSON.stringify({ ...run, startedAt: "now" }))).toBeNull();
  });

  it("refuses an entry an older page stored: no version, or another one", () => {
    const { version: _version, ...unversioned } = run;
    expect(parseStoredBfcacheRun(JSON.stringify(unversioned))).toBeNull();
    expect(parseStoredBfcacheRun(JSON.stringify({ ...run, version: 1 }))).toBeNull();
  });
});
