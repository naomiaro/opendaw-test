import { describe, it, expect } from "vitest";
import { judgeFreeze, type FreezeRun } from "./chromiumFreeze";
import type { ClockRatioSample } from "./chromiumBfcache";

const at = (ratio: number, seconds = 1): ClockRatioSample => ({ contextAdvanceSec: ratio * seconds, wallAdvanceSec: seconds });
const windows = (...ratios: number[]) => ratios.map((r) => at(r));

const halfSpeed: FreezeRun = {
  workletBefore: at(1, 2),
  controlBefore: at(1, 2),
  froze: true,
  resumed: true,
  // The first window after resume is left out: a clock that stalls while it resumes is not a slow one.
  workletAfter: windows(0.2, 0.5, 0.5),
  controlAfter: windows(0.2, 1, 1),
};

describe("judgeFreeze", () => {
  it("reads a worklet clock at half speed beside a true control as HALF SPEED", () => {
    const judged = judgeFreeze(halfSpeed);
    expect(judged.verdict).toBe("HALF SPEED");
    expect(judged.workletRatioAfter).toBeCloseTo(0.5, 9);
    expect(judged.controlRatioAfter).toBeCloseTo(1, 9);
  });

  it("reads both clocks true after the resume as NORMAL, the first window's stall ignored", () => {
    expect(judgeFreeze({ ...halfSpeed, workletAfter: windows(0.1, 1, 1) }).verdict).toBe("NORMAL");
  });

  it("judges nothing when the page never froze: the condition was not exercised", () => {
    expect(judgeFreeze({ ...halfSpeed, froze: false, resumed: false }).verdict).toBe("NOT CHECKED no-freeze");
  });

  it("judges nothing when the control slows too: that is not this issue", () => {
    expect(judgeFreeze({ ...halfSpeed, controlAfter: windows(0.5, 0.5, 0.5) }).verdict).toBe("NOT CHECKED control-slow");
  });

  it("judges nothing against a baseline that was already slow", () => {
    expect(judgeFreeze({ ...halfSpeed, workletBefore: at(0.6, 2) }).verdict).toBe("NOT CHECKED baseline-slow");
  });

  it("judges nothing on fewer than two windows after the resume", () => {
    expect(judgeFreeze({ ...halfSpeed, workletAfter: windows(0.5), controlAfter: windows(1) }).verdict).toBe(
      "NOT CHECKED too-few-windows"
    );
  });
});
