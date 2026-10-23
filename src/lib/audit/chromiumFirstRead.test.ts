import { describe, expect, it } from "vitest";
import { FIRST_READ_QUANTUM, isStaleFirstRead, judgeFirstRead, type FirstReadSample } from "./chromiumFirstRead";

// The three cases are the tracker's own lines (Chromium 571344687), in frames at 48 kHz.
const busy: FirstReadSample = {
  creationFrame: 10240,
  constructorFrame: 5120,
  processFrames: [5120, 10368, 10496],
};
const none: FirstReadSample = {
  creationFrame: 5120,
  constructorFrame: 5120,
  processFrames: [5120, 5248, 5376],
};

describe("judgeFirstRead", () => {
  it("reads a constructor behind the node's creation and a second call that jumps as stale", () => {
    const judged = judgeFirstRead([busy, busy, busy]);
    expect(judged.verdict).toBe("STALE FIRST READ");
    expect(judged.staleRuns).toBe(3);
    expect(judged.largestLagQuanta).toBe(40);
    expect(judged.jumpQuanta).toEqual([41, 41, 41]);
  });

  it("reads a constructor at the node's creation and calls a quantum apart as true", () => {
    const judged = judgeFirstRead([none, none, none]);
    expect(judged.verdict).toBe("FIRST READ TRUE");
    expect(judged.staleRuns).toBe(0);
    expect(judged.largestLagQuanta).toBe(0);
    expect(judged.jumpQuanta).toEqual([1, 1, 1]);
  });

  it("counts only the stale runs of a mixed set, and calls the set stale", () => {
    const judged = judgeFirstRead([none, busy, none]);
    expect(judged.verdict).toBe("STALE FIRST READ");
    expect(judged.staleRuns).toBe(1);
  });

  it("does not judge fewer than three samples", () => {
    expect(judgeFirstRead([busy, busy]).verdict).toBe("NOT CHECKED");
  });

  it("does not judge an empty list", () => {
    const judged = judgeFirstRead([]);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.largestLagQuanta).toBe(0);
    expect(judged.jumpQuanta).toEqual([]);
  });
});

describe("isStaleFirstRead: both halves of the signature", () => {
  const q = FIRST_READ_QUANTUM;

  it("does not read a lag without a jump as stale", () => {
    expect(isStaleFirstRead({ creationFrame: 10240, constructorFrame: 5120, processFrames: [5120, 5120 + q, 5120 + 2 * q] })).toBe(false);
  });

  it("does not read a jump without a lag as stale", () => {
    expect(isStaleFirstRead({ creationFrame: 5120, constructorFrame: 5120, processFrames: [5120, 10368, 10496] })).toBe(false);
  });

  it("does not read a lag of exactly one quantum as a lag", () => {
    expect(isStaleFirstRead({ creationFrame: 5120 + q, constructorFrame: 5120, processFrames: [5120, 10368, 10496] })).toBe(false);
    expect(isStaleFirstRead({ creationFrame: 5121 + q, constructorFrame: 5120, processFrames: [5120, 10368, 10496] })).toBe(true);
  });

  it("does not read a constructor ahead of the node's creation as a lag, and counts it as no lag", () => {
    const ahead: FirstReadSample = { creationFrame: 5120, constructorFrame: 5376, processFrames: [5376, 10368, 10496] };
    expect(isStaleFirstRead(ahead)).toBe(false);
    expect(judgeFirstRead([ahead, ahead, ahead]).largestLagQuanta).toBe(0);
  });
});
