import { describe, expect, it } from "vitest";
import { judgeFirstRead, type FirstReadSample } from "./chromiumFirstRead";

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
});
