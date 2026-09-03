/**
 * The shape verdicts of a real-input calibration run are pinned here so the
 * page's summary card cannot drift from the rule the register quotes:
 * repeatable = every usable call within half a quantum of the mode; two-state =
 * exactly two clusters at least half a quantum apart; scattered otherwise;
 * unusable = no usable call at all.
 */
import { describe, expect, it } from "vitest";
import { isUsableCall, modeAtFrameResolution, summarizeRealInput, type RealInputCall } from "./realInputSummary";

const RATE = 48000;
const QUANTUM = 128 / RATE;
const OUTPUT = 0.023;

function call(inputLatencySeconds: number, overrides: Partial<RealInputCall> = {}): RealInputCall {
  return {
    verdict: "ok",
    roundTripSeconds: inputLatencySeconds + OUTPUT,
    inputLatencySeconds,
    outputLatencySeconds: OUTPUT,
    outputLatencyReported: true,
    spreadSeconds: 0.0001,
    correlationRatioDb: 30,
    identifiedBursts: 3,
    chainIndex: 0,
    ...overrides,
  };
}

describe("summarizeRealInput", () => {
  it("reads a run whose calls all sit within half a quantum of the mode as repeatable", () => {
    const calls = [0.0216, 0.0216, 0.02165, 0.0216, 0.02155].map((v) => call(v));
    const summary = summarizeRealInput(calls, RATE, null);
    expect(summary.verdict).toBe("repeatable");
    expect(summary.calls).toBe(5);
    expect(summary.usableCalls).toBe(5);
    expect(summary.verdictCounts).toEqual({ ok: 5 });
    expect(summary.modeInputLatencySec).toBeCloseTo(0.0216, 9);
    expect(summary.modeCount).toBe(3);
    expect(summary.oneQuantumMisses).toBe(0);
    expect(summary.clusters).toHaveLength(1);
    expect(summary.stateSeparationQuanta).toBeNull();
    expect(summary.perChain).toBeNull();
    expect(summary.inputLatencySec).not.toBeNull();
    expect(summary.inputLatencySec!.median).toBeCloseTo(0.0216, 9);
    expect(summary.inputLatencySec!.min).toBeCloseTo(0.02155, 9);
    expect(summary.inputLatencySec!.max).toBeCloseTo(0.02165, 9);
    expect(summary.inputLatencySec!.stdev).toBeGreaterThan(0);
    expect(summary.outputLatencyReportedCount).toBe(5);
    expect(summary.detail).toContain("within half a quantum");
  });

  it("reads two clusters exactly one quantum apart as two-state and counts the misses", () => {
    const low = 0.0216;
    const high = low + QUANTUM;
    const calls = [low, high, low, low, high, low].map((v) => call(v));
    const summary = summarizeRealInput(calls, RATE, null);
    expect(summary.verdict).toBe("two-state");
    expect(summary.clusters).toHaveLength(2);
    expect(summary.clusters[0].calls).toBe(4);
    expect(summary.clusters[1].calls).toBe(2);
    expect(summary.stateSeparationQuanta).toBeCloseTo(1, 6);
    // The round trip carries the same lattice, so the two high calls are one-quantum misses off the mode.
    expect(summary.modeRoundTripSec).toBeCloseTo(low + OUTPUT, 9);
    expect(summary.oneQuantumMisses).toBe(2);
    expect(summary.detail).toContain("two states");
  });

  it("reads values spread over more than two groups, or two groups too close, as scattered", () => {
    const spread = [0, 0.4, 0.8, 1.2, 1.6].map((q) => call(0.02 + q * QUANTUM));
    expect(summarizeRealInput(spread, RATE, null).verdict).toBe("scattered");
    // A staircase: not within half a quantum of the mode (the earliest tied value, 0),
    // and the two greedy groups it forms are only 0.45 quanta apart — neither one state nor two.
    const close = [0, 0, 0.45, 0.9, 0.9].map((q) => call(0.02 + q * QUANTUM));
    const summary = summarizeRealInput(close, RATE, null);
    expect(summary.verdict).toBe("scattered");
    expect(summary.stateSeparationQuanta).toBeNull();
    expect(summary.detail).toContain("scattered");
  });

  it("is unusable when no call returned a stored verdict with finite figures, and nulls every statistic", () => {
    const calls: RealInputCall[] = [
      call(Number.NaN, { verdict: "no-signal", roundTripSeconds: Number.NaN, reason: "no burst identified" }),
      call(Number.NaN, { verdict: "no-stream", roundTripSeconds: Number.NaN }),
      // A finite figure under a non-stored verdict is not a measurement either.
      call(0.02, { verdict: "context-not-running" }),
    ];
    const summary = summarizeRealInput(calls, RATE, 0.01);
    expect(summary.verdict).toBe("unusable");
    expect(summary.usableCalls).toBe(0);
    expect(summary.verdictCounts).toEqual({ "no-signal": 1, "no-stream": 1, "context-not-running": 1 });
    expect(summary.inputLatencySec).toBeNull();
    expect(summary.roundTripSec).toBeNull();
    expect(summary.modeInputLatencySec).toBeNull();
    expect(summary.clusters).toEqual([]);
    expect(summary.reportedLatencySec).toBe(0.01);
    expect(summary.medianInputMinusReportedSec).toBeNull();
    expect(summary.detail).toContain("no usable call");
    expect(calls.map(isUsableCall)).toEqual([false, false, false]);
  });

  it("keeps noisy calls in the population and counts anchor disagreements both ways", () => {
    const calls = [
      call(0.0216, { roundTripSecondsSecondary: 0.0216 + OUTPUT }),
      call(0.0216, { verdict: "noisy", reason: "capture anchors disagree", roundTripSecondsSecondary: 0.0216 + OUTPUT + QUANTUM }),
      // Anchors a quantum apart WITHOUT the SDK flag — the re-derived count must still see it.
      call(0.0216, { roundTripSecondsSecondary: 0.0216 + OUTPUT - QUANTUM }),
      call(0.0216, { verdict: "noisy", reason: "spread 0.4 ms exceeds bound" }),
    ];
    const summary = summarizeRealInput(calls, RATE, null);
    expect(summary.usableCalls).toBe(4);
    expect(summary.verdictCounts).toEqual({ ok: 2, noisy: 2 });
    expect(summary.anchorDisagreements).toEqual({ flaggedBySdk: 1, rederived: 2, secondAnchorAvailable: true });
    expect(summary.verdict).toBe("repeatable");
  });

  it("reports no second anchor when no call carried one", () => {
    const summary = summarizeRealInput([call(0.02), call(0.02)], RATE, null);
    expect(summary.anchorDisagreements).toEqual({ flaggedBySdk: 0, rederived: 0, secondAnchorAvailable: false });
  });

  it("gives per-chain medians and their difference in quanta when a fresh re-arm split the run", () => {
    const chain0 = [0.0216, 0.0216, 0.0217].map((v) => call(v, { chainIndex: 0 }));
    const chain1 = [0.0216 + QUANTUM, 0.0216 + QUANTUM, 0.0215 + QUANTUM].map((v) => call(v, { chainIndex: 1 }));
    const summary = summarizeRealInput([...chain0, ...chain1], RATE, null);
    expect(summary.perChain).toHaveLength(2);
    expect(summary.perChain![0]).toEqual({ chainIndex: 0, calls: 3, usableCalls: 3, medianInputLatencySec: 0.0216 });
    expect(summary.perChain![1].calls).toBe(3);
    expect(summary.perChain![1].medianInputLatencySec).toBeCloseTo(0.0216 + QUANTUM, 9);
    expect(summary.chainMedianDifferenceQuanta).toBeCloseTo(1, 6);
    expect(summary.verdict).toBe("two-state");
    expect(summary.detail).toContain("chain 1 − chain 0");
  });

  it("subtracts the browser's reported track latency from the median input part", () => {
    const summary = summarizeRealInput([call(0.030), call(0.032), call(0.031)], RATE, 0.01);
    expect(summary.reportedLatencySec).toBe(0.01);
    expect(summary.medianInputMinusReportedSec).toBeCloseTo(0.021, 9);
    expect(summary.inputLatencySec!.median).toBeCloseTo(0.031, 9);
    expect(summary.spreadSec!.median).toBeCloseTo(0.0001, 9);
    expect(summary.correlationRatioDb!.median).toBe(30);
  });

  it("chain difference is null when one chain has no usable call", () => {
    const calls = [call(0.02, { chainIndex: 0 }), call(Number.NaN, { chainIndex: 1, verdict: "no-signal", roundTripSeconds: Number.NaN })];
    const summary = summarizeRealInput(calls, RATE, null);
    expect(summary.perChain![1]).toEqual({ chainIndex: 1, calls: 1, usableCalls: 0, medianInputLatencySec: null });
    expect(summary.chainMedianDifferenceQuanta).toBeNull();
  });
});

describe("modeAtFrameResolution", () => {
  it("groups values that differ below a frame and breaks ties toward the earliest call", () => {
    const frame = 1 / RATE;
    const mode = modeAtFrameResolution([0.02, 0.03, 0.02 + frame * 0.1, 0.03 + frame * 0.2], RATE);
    expect(mode.value).toBe(0.02);
    expect(mode.count).toBe(2);
  });
});
