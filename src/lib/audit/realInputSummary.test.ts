/**
 * The shape verdicts of a real-input calibration run are pinned here so the
 * page's summary card cannot drift from the rule the register quotes:
 * repeatable = every usable call within half a quantum of its chain's mode;
 * two-state = exactly two clusters (steady) or two chain medians (fresh) at
 * least half a quantum apart; scattered otherwise; unusable = no usable call.
 *
 * The batch cases carry the frame counts of the first real-mic batches in
 * `.verify-output/` (calib-summary-<runToken>.json), so the labelling defects
 * they exposed — pooled-mode "misses" on a fresh run, a persisting one-quantum
 * step read as misses — cannot come back.
 */
import { describe, expect, it } from "vitest";
import { isUsableCall, modeAtFrameResolution, sameState, summarizeRealInput, type RealInputCall } from "./realInputSummary";

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

/** A call as the envelopes persist it: round trip and output latency in frames at `rate`, both anchors agreeing unless `bFrames` says otherwise. */
function frames(rate: number, rtFrames: number, outFrames: number, chainIndex: number, overrides: Partial<RealInputCall> = {}, bFrames = rtFrames): RealInputCall {
  return {
    verdict: "ok",
    roundTripSeconds: rtFrames / rate,
    roundTripSecondsSecondary: bFrames / rate,
    inputLatencySeconds: (rtFrames - outFrames) / rate,
    outputLatencySeconds: outFrames / rate,
    outputLatencyReported: true,
    spreadSeconds: 0,
    correlationRatioDb: 37,
    identifiedBursts: 3,
    chainIndex,
    ...overrides,
  };
}

const repeat = <T,>(n: number, make: (k: number) => T): T[] => Array.from({ length: n }, (_, k) => make(k));

describe("summarizeRealInput — the real-mic batches", () => {
  it("batch 1788464591756 (48 kHz steady): a persisting −128-frame step is one transition, not three misses", () => {
    // Calls 1-27 at 4264 frames; call 28 (noisy) and 29-30 at 4136, both anchors agreeing throughout.
    const calls = [
      ...repeat(27, () => frames(48000, 4264, 1104, 0)),
      frames(48000, 4136, 1104, 0, { verdict: "noisy" }),
      frames(48000, 4136, 1104, 0),
      frames(48000, 4136, 1104, 0),
    ];
    const summary = summarizeRealInput(calls, 48000, 0.002666);
    expect(summary.verdict).toBe("two-state");
    expect(summary.verdictBasis).toBe("per-chain clusters");
    // Cluster separation is upper minus lower; the signed step lives on the transition.
    expect(summary.stateSeparationQuanta).toBeCloseTo(1, 6);
    expect(summary.stateTransitions.count).toBe(1);
    expect(summary.stateTransitions.oneQuantumSteps).toBe(1);
    expect(summary.stateTransitions.transitions[0]).toMatchObject({ chainIndex: 0, index: 27, isOneQuantumStep: true, confirmedByFollowingCall: true });
    expect(summary.stateTransitions.unconfirmedSteps).toBe(0);
    expect(summary.stateTransitions.transitions[0].stepQuanta).toBeCloseTo(-1, 6);
    expect(summary.perChain).toHaveLength(1);
    expect(summary.perChain[0].states.map((s) => s.calls)).toEqual([27, 3]);
    expect(summary.perChain[0].states[1].roundTripSec).toBeCloseTo(4136 / 48000, 12);
    expect(summary.perChain[0].modeRoundTripSec).toBeCloseTo(4264 / 48000, 12);
    expect(summary.isolatedDeviations.count).toBe(0);
    expect(summary.anchorDisagreements).toMatchObject({ flaggedBySdk: 0, rederived: 0, secondAnchorAvailable: true });
    expect(summary.verdictCounts).toEqual({ ok: 29, noisy: 1 });
    expect(summary.detail).toContain("1 state transition(s): call 28 chain 0 -1.00 quanta (one-quantum step)");
    expect(summary.detail).not.toContain("miss");
  });

  it("batch 1788464404625 (44.1 kHz fresh): the re-armed chain's 107 frames are a chain difference, not 15 misses", () => {
    // Chain 0: 15 calls at 2656 frames, call 11 noisy with anchor B at 2528 (A stays at the mode).
    // Chain 1 (re-armed): 15 calls at 2764 frames.
    const calls = [
      ...repeat(15, (k) => k === 10
        ? frames(44100, 2656, 1014, 0, { verdict: "noisy", reason: "capture anchors disagree" }, 2528)
        : frames(44100, 2656, 1014, 0)),
      ...repeat(15, () => frames(44100, 2764, 1014, 1)),
    ];
    const summary = summarizeRealInput(calls, 44100, 0.002666);
    expect(summary.verdict).toBe("two-state");
    expect(summary.verdictBasis).toBe("chain medians");
    expect(summary.chainMedianDifferenceQuanta).toBeCloseTo(108 / 128, 6);
    expect(summary.stateSeparationQuanta).toBeCloseTo(108 / 128, 6);
    expect(summary.stateTransitions.count).toBe(0);
    expect(summary.isolatedDeviations.count).toBe(0);
    expect(summary.anchorDisagreements).toEqual({ flaggedBySdk: 1, rederived: 1, indices: [10], secondAnchorAvailable: true });
    expect(summary.perChain.map((c) => c.modeRoundTripSec)).toEqual([2656 / 44100, 2764 / 44100]);
    expect(summary.perChain.map((c) => c.withinHalfQuantum)).toEqual([true, true]);
    expect(summary.perChain.map((c) => c.states.length)).toEqual([1, 1]);
    expect(summary.detail).toContain("1 anchor disagreement(s) (calls 11)");
    expect(summary.detail).not.toContain("miss");
  });

  it("batch 1788464100870 (48 kHz fresh): chains 10 frames apart are repeatable on chain medians", () => {
    const calls = [
      ...repeat(15, () => frames(48000, 3104, 1104, 0)),
      ...repeat(15, () => frames(48000, 3094, 1104, 1)),
    ];
    const summary = summarizeRealInput(calls, 48000, 0.002666);
    expect(summary.verdict).toBe("repeatable");
    expect(summary.verdictBasis).toBe("chain medians");
    expect(summary.chainMedianDifferenceQuanta).toBeCloseTo(-10 / 128, 6);
    expect(summary.stateSeparationQuanta).toBeNull();
    expect(summary.stateTransitions.count).toBe(0);
    expect(summary.perChain.map((c) => c.medianInputLatencySec)).toEqual([2000 / 48000, 1990 / 48000]);
  });

  it("batch 1788463933323 (48 kHz steady): thirty identical calls are repeatable with one state", () => {
    const summary = summarizeRealInput(repeat(30, () => frames(48000, 3067, 1104, 0)), 48000, 0.002666);
    expect(summary.verdict).toBe("repeatable");
    expect(summary.verdictBasis).toBe("per-chain clusters");
    expect(summary.perChain[0]).toMatchObject({ usableCalls: 30, modeCount: 30, withinHalfQuantum: true });
    expect(summary.perChain[0].states).toEqual([{ firstIndex: 0, lastIndex: 29, calls: 30, roundTripSec: 3067 / 48000 }]);
    expect(summary.medianInputMinusReportedSec).toBeCloseTo(1963 / 48000 - 0.002666, 9);
  });
});

describe("summarizeRealInput — the three mechanisms kept apart", () => {
  it("an isolated deviation (off, anchors agreeing, next call back) is neither a transition nor a disagreement", () => {
    const calls = repeat(10, (k) => (k === 4 ? frames(48000, 4264 - 128, 1104, 0) : frames(48000, 4264, 1104, 0)));
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.isolatedDeviations.count).toBe(1);
    expect(summary.isolatedDeviations.deviations[0]).toMatchObject({ chainIndex: 0, index: 4 });
    expect(summary.isolatedDeviations.deviations[0].deltaQuanta).toBeCloseTo(-1, 6);
    expect(summary.stateTransitions.count).toBe(0);
    expect(summary.anchorDisagreements.rederived).toBe(0);
    // The deviating call still forms a second input-part cluster, so the shape rule still reads two-state.
    expect(summary.verdict).toBe("two-state");
    expect(summary.perChain[0].states).toHaveLength(1);
    expect(summary.detail).toContain("1 isolated deviation(s) (calls 5)");
  });

  it("a call whose anchors disagree never opens a state, even when its reported round trip is off", () => {
    const calls = repeat(8, (k) => (k === 3
      ? frames(48000, 4264 - 128, 1104, 0, { verdict: "noisy", reason: "capture anchors disagree" }, 4264)
      : frames(48000, 4264, 1104, 0)));
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.anchorDisagreements).toMatchObject({ flaggedBySdk: 1, rederived: 1, indices: [3] });
    expect(summary.stateTransitions.count).toBe(0);
    expect(summary.isolatedDeviations.count).toBe(0);
    expect(summary.perChain[0].states).toHaveLength(1);
  });

  it("a step on the last call is a transition, marked unconfirmed (nothing follows it)", () => {
    const calls = [...repeat(9, () => frames(48000, 4264, 1104, 0)), frames(48000, 4264 + 128, 1104, 0)];
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.stateTransitions.count).toBe(1);
    expect(summary.stateTransitions.unconfirmedSteps).toBe(1);
    expect(summary.stateTransitions.transitions[0]).toMatchObject({ index: 9, isOneQuantumStep: true, confirmedByFollowingCall: false });
    expect(summary.isolatedDeviations.count).toBe(0);
    expect(summary.perChain[0].states.map((s) => s.calls)).toEqual([9, 1]);
    expect(summary.detail).toContain("unconfirmed — no further agreeing call in the state it opened");
  });

  it("an unconfirmed step is one no later agreeing call sat in: a mid-run one-call state counts too", () => {
    // [10×4264, 4136, 5×4200]: call 11 opens a state the next call leaves (unconfirmed, −1 q);
    // call 12 opens the 4200 state that four more calls confirm (+0.5 q).
    const calls = [...repeat(10, () => frames(48000, 4264, 1104, 0)), frames(48000, 4136, 1104, 0), ...repeat(5, () => frames(48000, 4200, 1104, 0))];
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.stateTransitions.transitions.map((t) => [t.index, t.confirmedByFollowingCall])).toEqual([[10, false], [11, true]]);
    expect(summary.stateTransitions.transitions[0].stepQuanta).toBeCloseTo(-1, 6);
    expect(summary.stateTransitions.transitions[1].stepQuanta).toBeCloseTo(0.5, 6);
    expect(summary.stateTransitions.unconfirmedSteps).toBe(1);
    expect(summary.isolatedDeviations.count).toBe(0);
    expect(summary.perChain[0].states.map((s) => s.calls)).toEqual([10, 1, 5]);
  });

  it("[27×4264, 4136, 4136, 4200]: a confirmed one-quantum step, then a half-quantum step on the last call, unconfirmed", () => {
    const calls = [...repeat(27, () => frames(48000, 4264, 1104, 0)), frames(48000, 4136, 1104, 0), frames(48000, 4136, 1104, 0), frames(48000, 4200, 1104, 0)];
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.stateTransitions.count).toBe(2);
    expect(summary.stateTransitions.transitions.map((t) => [t.index, t.isOneQuantumStep, t.confirmedByFollowingCall])).toEqual([[27, true, true], [29, false, false]]);
    expect(summary.stateTransitions.unconfirmedSteps).toBe(1);
    expect(summary.perChain[0].states.map((s) => s.calls)).toEqual([27, 2, 1]);
    expect(summary.isolatedDeviations.count).toBe(0);
  });

  it("[27×4264, 4136, 4264, 4136, 4136]: call 28 is isolated, the transition opens at call 30 and is confirmed", () => {
    const calls = [
      ...repeat(27, () => frames(48000, 4264, 1104, 0)),
      frames(48000, 4136, 1104, 0), frames(48000, 4264, 1104, 0), frames(48000, 4136, 1104, 0), frames(48000, 4136, 1104, 0),
    ];
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.isolatedDeviations.deviations.map((d) => d.index)).toEqual([27]);
    expect(summary.stateTransitions.transitions.map((t) => [t.index, t.confirmedByFollowingCall])).toEqual([[29, true]]);
    // The isolated call is left out of the states: 27 + call 29 at the mode, then the two at 4136.
    expect(summary.perChain[0].states.map((s) => s.calls)).toEqual([28, 2]);
    expect(summary.perChain[0].states[0].lastIndex).toBe(28);
  });

  it("two consecutive off calls are a state the run stepped into and back out of, not deviations", () => {
    const calls = [...repeat(10, () => frames(48000, 4264, 1104, 0)), ...repeat(2, () => frames(48000, 4136, 1104, 0)), ...repeat(10, () => frames(48000, 4264, 1104, 0))];
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.isolatedDeviations.count).toBe(0);
    expect(summary.stateTransitions.transitions.map((t) => [t.index, t.confirmedByFollowingCall])).toEqual([[10, true], [12, true]]);
    expect(summary.perChain[0].states.map((s) => s.calls)).toEqual([10, 2, 10]);
  });

  it("an off FIRST call with the second at the mode is firstCallOff, not an isolated deviation, and opens no state", () => {
    const calls = [frames(48000, 4136, 1104, 0), ...repeat(9, () => frames(48000, 4264, 1104, 0))];
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.perChain[0].firstCallOff).not.toBeNull();
    expect(summary.perChain[0].firstCallOff!.index).toBe(0);
    expect(summary.perChain[0].firstCallOff!.deltaQuanta).toBeCloseTo(-1, 6);
    expect(summary.isolatedDeviations.count).toBe(0);
    expect(summary.stateTransitions.count).toBe(0);
    expect(summary.perChain[0].states).toEqual([{ firstIndex: 1, lastIndex: 9, calls: 9, roundTripSec: 4264 / 48000 }]);
    expect(summary.detail).toContain("first call off on chain(s) 0 (call 1, -1.00 quanta)");
    // Two off calls at the start are a state the chain started in, so the step out of it is a transition.
    const started = summarizeRealInput([frames(48000, 4136, 1104, 0), frames(48000, 4136, 1104, 0), ...repeat(8, () => frames(48000, 4264, 1104, 0))], 48000, null);
    expect(started.perChain[0].firstCallOff).toBeNull();
    expect(started.stateTransitions.transitions.map((t) => [t.index, t.confirmedByFollowingCall])).toEqual([[2, true]]);
  });

  it("reads the clusters on the round trip when outputLatencyReported flips within the run, and says so", () => {
    // Same round trip throughout; the SDK reported the output leg on half the calls only, so the
    // input part carries a 1104-frame step the input path never made.
    const calls = repeat(10, (k) => (k < 5
      ? frames(48000, 4264, 1104, 0)
      : frames(48000, 4264, 0, 0, { outputLatencyReported: false })));
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.verdictSeries).toBe("roundTrip");
    expect(summary.verdict).toBe("repeatable");
    expect(summary.perChain[0].clusterSeries).toBe("roundTrip");
    expect(summary.perChain[0].clusters).toHaveLength(1);
    expect(summary.detail).toContain("clusters read on the round trip");
    // On the input part the same calls would have read as two clusters 8.6 quanta apart.
    const consistent = summarizeRealInput(calls.map((c) => ({ ...c, outputLatencyReported: true })), 48000, null);
    expect(consistent.verdictSeries).toBe("inputLatency");
    expect(consistent.verdict).toBe("two-state");
  });

  it("uses a per-chain reported track latency when given a list, and the spread when chains are not 0/1", () => {
    const calls = [...repeat(3, () => call(0.030, { chainIndex: 1 })), ...repeat(3, () => call(0.030 + QUANTUM, { chainIndex: 2 }))];
    const summary = summarizeRealInput(calls, RATE, [null, 0.010, 0.020]);
    expect(summary.perChain.map((c) => c.reportedLatencySec)).toEqual([0.010, 0.020]);
    expect(summary.perChain[0].medianInputMinusReportedSec).toBeCloseTo(0.020, 9);
    expect(summary.perChain[1].medianInputMinusReportedSec).toBeCloseTo(0.010 + QUANTUM, 9);
    expect(summary.reportedLatencySec).toBe(0.010);
    // No chain 0/1 pair: the signed difference is null and the two-state separation falls back to the spread.
    expect(summary.chainMedianDifferenceQuanta).toBeNull();
    expect(summary.verdict).toBe("two-state");
    expect(summary.stateSeparationQuanta).toBeCloseTo(1, 6);
  });

  it("a first call whose anchors disagree does not seed the chain's state (no spurious transition on call 2)", () => {
    // A = mode − 1 q with B at the mode on call 1, then nine calls at the mode.
    const calls = [frames(48000, 4264 - 128, 1104, 0, {}, 4264), ...repeat(9, () => frames(48000, 4264, 1104, 0))];
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.anchorDisagreements.rederived).toBe(1);
    expect(summary.stateTransitions.count).toBe(0);
    expect(summary.isolatedDeviations.count).toBe(0);
    expect(summary.perChain[0].states).toHaveLength(1);
    expect(summary.perChain[0].states[0].calls).toBe(10);
    expect(summary.perChain[0].states[0].roundTripSec).toBeCloseTo(4264 / 48000, 12);
  });

  it("transitions are judged within a chain: the first call of a re-armed chain is not a step from the old chain", () => {
    const calls = [...repeat(5, () => frames(48000, 4264, 1104, 0)), ...repeat(5, () => frames(48000, 4264 + 128, 1104, 1))];
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.stateTransitions.count).toBe(0);
    expect(summary.isolatedDeviations.count).toBe(0);
    expect(summary.verdict).toBe("two-state");
    expect(summary.verdictBasis).toBe("chain medians");
    expect(summary.chainMedianDifferenceQuanta).toBeCloseTo(1, 6);
  });

  it("a fresh run whose chain is not internally stable is scattered, whatever the chain medians say", () => {
    const calls = [
      ...repeat(3, (k) => frames(48000, 4264 + k * 100, 1104, 0)),
      ...repeat(3, () => frames(48000, 4264, 1104, 1)),
    ];
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.verdict).toBe("scattered");
    expect(summary.verdictBasis).toBe("chain medians");
    expect(summary.perChain[0].withinHalfQuantum).toBe(false);
    expect(summary.detail).toContain("chain(s) 0 not within half a quantum");
  });
});

describe("summarizeRealInput — the state boundary (one rule, float-robust)", () => {
  it("two values exactly half a quantum apart are two states, at the boundary and a hair under it", () => {
    for (const fraction of [0.5, 0.5 - 1e-4]) {
      const calls = [call(0.02), call(0.02 + fraction * QUANTUM)];
      const summary = summarizeRealInput(calls, RATE, null);
      expect(summary.verdict, `fraction ${fraction}`).toBe("two-state");
      expect(summary.perChain[0].clusters).toHaveLength(2);
      expect(summary.perChain[0].withinHalfQuantum).toBe(false);
      expect(summary.stateSeparationQuanta).toBeCloseTo(fraction, 3);
    }
    // Comfortably under half a quantum: one state.
    expect(summarizeRealInput([call(0.02), call(0.02 + 0.45 * QUANTUM)], RATE, null).verdict).toBe("repeatable");
  });

  it("[0, 0.5, 0.5, 1.0] quanta is three states, so scattered — not two", () => {
    const calls = [0, 0.5, 0.5, 1.0].map((q) => call(0.02 + q * QUANTUM));
    const summary = summarizeRealInput(calls, RATE, null);
    expect(summary.perChain[0].clusters.map((c) => c.calls)).toEqual([1, 2, 1]);
    expect(summary.verdict).toBe("scattered");
  });

  it("anchors exactly half a quantum apart disagree; chain medians exactly half a quantum apart are two states", () => {
    const disagree = summarizeRealInput([call(0.02, { roundTripSecondsSecondary: 0.02 + OUTPUT + 0.5 * QUANTUM })], RATE, null);
    expect(disagree.anchorDisagreements.rederived).toBe(1);
    const agree = summarizeRealInput([call(0.02, { roundTripSecondsSecondary: 0.02 + OUTPUT + 0.45 * QUANTUM })], RATE, null);
    expect(agree.anchorDisagreements.rederived).toBe(0);
    const fresh = summarizeRealInput([
      ...repeat(3, () => call(0.02, { chainIndex: 0 })),
      ...repeat(3, () => call(0.02 + 0.5 * QUANTUM, { chainIndex: 1 })),
    ], RATE, null);
    expect(fresh.verdict).toBe("two-state");
    expect(fresh.verdictBasis).toBe("chain medians");
  });

  it("a 64-frame alternation at 48 kHz: two states half a quantum apart, every excursion an isolated deviation", () => {
    // 4264 / 4328 frames alternating, nine calls so the run ends at the mode.
    const calls = repeat(9, (k) => frames(48000, k % 2 === 0 ? 4264 : 4328, 1104, 0));
    const summary = summarizeRealInput(calls, 48000, null);
    expect(summary.verdict).toBe("two-state");
    expect(summary.perChain[0].clusters.map((c) => c.calls)).toEqual([5, 4]);
    expect(summary.stateSeparationQuanta).toBeCloseTo(0.5, 6);
    expect(summary.isolatedDeviations.deviations.map((d) => d.index)).toEqual([1, 3, 5, 7]);
    expect(summary.isolatedDeviations.deviations[0].deltaQuanta).toBeCloseTo(0.5, 6);
    expect(summary.stateTransitions.count).toBe(0);
    expect(summary.perChain[0].states).toHaveLength(1);
  });

  it("error rows (a call that threw or timed out) are counted by verdict and otherwise unusable", () => {
    const error: RealInputCall = {
      verdict: "error", roundTripSeconds: Number.NaN, inputLatencySeconds: Number.NaN, outputLatencySeconds: Number.NaN,
      outputLatencyReported: false, spreadSeconds: Number.NaN, correlationRatioDb: Number.NaN, identifiedBursts: 0,
      reason: "calibrateInputLatency(apply=false) timed out after 60000ms", chainIndex: 0,
    };
    const mixed = summarizeRealInput([call(0.02), error, call(0.02)], RATE, null);
    expect(mixed.verdictCounts).toEqual({ ok: 2, error: 1 });
    expect(mixed.usableCalls).toBe(2);
    expect(mixed.verdict).toBe("repeatable");
    expect(summarizeRealInput([error, error], RATE, null).verdict).toBe("unusable");
  });
});

describe("summarizeRealInput — shape rules", () => {
  it("reads a run whose calls all sit within half a quantum of the mode as repeatable", () => {
    const calls = [0.0216, 0.0216, 0.02165, 0.0216, 0.02155].map((v) => call(v));
    const summary = summarizeRealInput(calls, RATE, null);
    expect(summary.verdict).toBe("repeatable");
    expect(summary.usableCalls).toBe(5);
    expect(summary.verdictCounts).toEqual({ ok: 5 });
    expect(summary.perChain[0].modeInputLatencySec).toBeCloseTo(0.0216, 9);
    expect(summary.perChain[0].modeCount).toBe(3);
    expect(summary.perChain[0].clusters).toHaveLength(1);
    expect(summary.stateSeparationQuanta).toBeNull();
    expect(summary.inputLatencySec!.median).toBeCloseTo(0.0216, 9);
    expect(summary.inputLatencySec!.min).toBeCloseTo(0.02155, 9);
    expect(summary.inputLatencySec!.max).toBeCloseTo(0.02165, 9);
    expect(summary.inputLatencySec!.stdev).toBeGreaterThan(0);
    expect(summary.outputLatencyReportedCount).toBe(5);
  });

  it("reads two clusters exactly one quantum apart as two-state; alternating single calls are isolated deviations", () => {
    const low = 0.0216;
    const high = low + QUANTUM;
    const calls = [low, high, low, low, high, low].map((v) => call(v));
    const summary = summarizeRealInput(calls, RATE, null);
    expect(summary.verdict).toBe("two-state");
    expect(summary.perChain[0].clusters.map((c) => c.calls)).toEqual([4, 2]);
    expect(summary.stateSeparationQuanta).toBeCloseTo(1, 6);
    expect(summary.isolatedDeviations.deviations.map((d) => d.index)).toEqual([1, 4]);
    expect(summary.stateTransitions.count).toBe(0);
  });

  it("reads values spread over more than two groups, or a staircase, as scattered", () => {
    const spread = [0, 0.4, 0.8, 1.2, 1.6].map((q) => call(0.02 + q * QUANTUM));
    expect(summarizeRealInput(spread, RATE, null).verdict).toBe("scattered");
    // A staircase: the value at 0 is a distinct state from the mode (0.5, ×3), yet the
    // two greedy groups it forms have centres 0.49 and 0.5 — the same state. Neither
    // one state nor two.
    const close = [0, 0.49, 0.49, 0.5, 0.5, 0.5].map((q) => call(0.02 + q * QUANTUM));
    const summary = summarizeRealInput(close, RATE, null);
    expect(summary.verdict).toBe("scattered");
    expect(summary.stateSeparationQuanta).toBeNull();
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
    expect(summary.verdictBasis).toBe("none");
    expect(summary.usableCalls).toBe(0);
    expect(summary.verdictCounts).toEqual({ "no-signal": 1, "no-stream": 1, "context-not-running": 1 });
    expect(summary.inputLatencySec).toBeNull();
    expect(summary.perChain[0].usableCalls).toBe(0);
    expect(summary.perChain[0].clusters).toEqual([]);
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
    expect(summary.anchorDisagreements).toEqual({ flaggedBySdk: 1, rederived: 2, indices: [1, 2], secondAnchorAvailable: true });
    expect(summary.verdict).toBe("repeatable");
  });

  it("reports no second anchor when no call carried one", () => {
    const summary = summarizeRealInput([call(0.02), call(0.02)], RATE, null);
    expect(summary.anchorDisagreements).toEqual({ flaggedBySdk: 0, rederived: 0, indices: [], secondAnchorAvailable: false });
  });

  it("gives per-chain medians and their difference in quanta when a fresh re-arm split the run", () => {
    const chain0 = [0.0216, 0.0216, 0.0217].map((v) => call(v, { chainIndex: 0 }));
    const chain1 = [0.0216 + QUANTUM, 0.0216 + QUANTUM, 0.0215 + QUANTUM].map((v) => call(v, { chainIndex: 1 }));
    const summary = summarizeRealInput([...chain0, ...chain1], RATE, null);
    expect(summary.perChain).toHaveLength(2);
    expect(summary.perChain[0]).toMatchObject({ chainIndex: 0, calls: 3, usableCalls: 3, medianInputLatencySec: 0.0216 });
    expect(summary.perChain[1].medianInputLatencySec).toBeCloseTo(0.0216 + QUANTUM, 9);
    expect(summary.chainMedianDifferenceQuanta).toBeCloseTo(1, 6);
    expect(summary.verdict).toBe("two-state");
    expect(summary.verdictBasis).toBe("chain medians");
    expect(summary.detail).toContain("chain medians");
  });

  it("subtracts the browser's reported track latency from the pooled median input part", () => {
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
    expect(summary.perChain[1]).toMatchObject({ chainIndex: 1, calls: 1, usableCalls: 0, medianInputLatencySec: null });
    expect(summary.chainMedianDifferenceQuanta).toBeNull();
    // Only one chain has data, so the verdict falls back to that chain's clusters.
    expect(summary.verdictBasis).toBe("per-chain clusters");
    expect(summary.verdict).toBe("repeatable");
  });
});

describe("sameState", () => {
  it("is the one boundary rule: same under half a quantum, distinct at half a quantum and a hair under it", () => {
    expect(sameState(0.02, 0.02 + 0.49 * QUANTUM, QUANTUM)).toBe(true);
    expect(sameState(0.02, 0.02 + 0.5 * QUANTUM, QUANTUM)).toBe(false);
    expect(sameState(0.02, 0.02 + (0.5 - 5e-4) * QUANTUM, QUANTUM)).toBe(false);
    expect(sameState(0.02 + 0.5 * QUANTUM, 0.02, QUANTUM)).toBe(false);
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
