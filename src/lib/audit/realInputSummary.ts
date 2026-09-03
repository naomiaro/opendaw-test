/**
 * Descriptive summary of a REAL-input calibration run — N back-to-back
 * `calibrateInputLatency` calls on a physical device (laptop mic acoustically,
 * or an interface with a cable loopback) instead of the synthetic loopback.
 *
 * This module describes; it does not judge. There is no injected delay to fit
 * against and no applied take cell, so nothing here is a band classification or
 * a pass/fail. The `verdict` says what SHAPE the calls took — one value, two
 * values a lattice apart, or neither — and the figures beside it are what a
 * reader needs to argue about the routine's repeatability and its detector's
 * hit rate on a device the campaign's loopback could never stand in for.
 *
 * Every figure is over the USABLE calls only: a call whose verdict is `ok` or
 * `noisy` (the two the SDK stores) AND whose round trip and input part are
 * finite. The other verdicts (`no-signal`, `no-stream`, `context-not-running`,
 * `transport-running`) report a NaN round trip and input part (spread 0,
 * ratio −∞), and the page's own `error` rows are NaN throughout; they are
 * counted by verdict and otherwise left out. `usableCalls === 0` makes the
 * whole summary `unusable` and every statistic below it null.
 *
 * EVERYTHING IS JUDGED PER CHAIN. `?armState=fresh` rebuilds the SDK's input
 * chain halfway through the run, and a rebuilt chain legitimately lands at a
 * different delay — the first real-mic batches measured 107 frames between
 * the two chains of one run. A call of the second chain compared against the
 * pooled mode would read as a "miss" of the first chain's value, which is not
 * what happened. So modes, clusters and transitions are computed within each
 * `chainIndex`, and the cross-chain difference lives ONLY in
 * `chainMedianDifferenceQuanta` (and `stateSeparationQuanta` when it decides
 * the verdict).
 *
 * WHICH SERIES THE SHAPE IS READ ON. Transitions and deviations are always
 * judged on the ROUND TRIP (the anchors measure it). Clusters — and so the
 * verdict — are read on the INPUT PART, the figure the SDK stores, as long as
 * `outputLatencyReported` is identical across the usable calls: the input part
 * is then the round trip minus one constant. When it flips within a run the
 * input part carries a step the input path never made, so the clusters are
 * read on the round trip instead and `verdictSeries` / `detail` say so.
 *
 * Three different things a call off its chain's mode can be, kept apart in the
 * output because they point at different mechanisms:
 *  - an ANCHOR DISAGREEMENT: the two capture anchors of one call are distinct
 *    states (see `sameState`). The SDK's own detector for a capture node whose
 *    first-frame time is a quantum off; the reported round trip may still sit
 *    at the mode (batch 1788464404625 call 11: A = mode, B = mode − 128 frames).
 *  - a STATE TRANSITION: the round trip steps by at least half a quantum from
 *    the PREVIOUS agreeing call, both anchors agreeing on the stepping call —
 *    the input path itself moved (batch 1788464591756 calls 28-30 and the
 *    applied call all read exactly −128 frames). Counted as transitions, with
 *    the calls in each state; a step within 25 % of one quantum is flagged
 *    `isOneQuantumStep`. `confirmedByFollowingCall` is true when at least one
 *    LATER agreeing call sat in the state the step opened, false when none
 *    did — a step on the chain's last call (nothing follows it) or a one-call
 *    state in mid-run that the next call stepped out of again. A persisted
 *    step and an unconfirmed one stay distinguishable. A chain's FIRST state
 *    is seeded by its first anchors-agreeing call; disagreeing calls before
 *    it are folded into that state, never used as the reference a step is
 *    measured from.
 *  - an ISOLATED DEVIATION: one call off its chain's mode with both anchors
 *    agreeing, the previous call at the mode and the NEXT call back at the
 *    mode — the single-call case no anchor check can catch. Expected 0; if it
 *    is ever non-zero that is the finding. The chain's FIRST usable call is
 *    never counted here (it has no previous call to return from): when it is
 *    off the mode, anchors agreeing, and the second call sits at the mode, it
 *    is reported as `firstCallOff` on the chain and left out of the state
 *    walk, which then starts at the second call.
 */

export interface RealInputCall {
  verdict: string;
  roundTripSeconds: number;
  /** Present only on builds carrying the second capture anchor. */
  roundTripSecondsSecondary?: number;
  inputLatencySeconds: number;
  outputLatencySeconds: number;
  outputLatencyReported: boolean;
  spreadSeconds: number;
  correlationRatioDb: number;
  identifiedBursts: number;
  reason?: string;
  /** 0 for the chain armed at the start, 1 for the chain a mid-run re-arm rebuilt. */
  chainIndex: number;
}

/** Order statistics plus the sample standard deviation (null below two values). */
export interface RealInputStats {
  count: number;
  median: number;
  min: number;
  max: number;
  stdev: number | null;
}

/** One group of a chain's usable values (of `clusterSeries`) whose span is under half a render quantum. */
export interface RealInputCluster {
  calls: number;
  /** Median of the cluster's values, seconds. */
  centerSec: number;
  minSec: number;
  maxSec: number;
}

/** A run of consecutive usable calls of one chain at one round trip, between transitions. */
export interface RealInputState {
  /** 0-based call indices (positions in the input list) of the first and last call in the state. */
  firstIndex: number;
  lastIndex: number;
  calls: number;
  /** Modal round trip of the state's calls, seconds. */
  roundTripSec: number;
}

export interface RealInputTransition {
  chainIndex: number;
  /** 0-based index of the first call in the NEW state. */
  index: number;
  fromRoundTripSec: number;
  toRoundTripSec: number;
  /** Signed step in render quanta. */
  stepQuanta: number;
  /** |step| within 25 % of exactly one quantum. */
  isOneQuantumStep: boolean;
  /** True when at least one later anchors-agreeing call of the chain sat in the state this step
   *  opened; false when none did — the chain's last call, or a one-call state the next call left. */
  confirmedByFollowingCall: boolean;
}

export interface RealInputIsolatedDeviation {
  chainIndex: number;
  /** 0-based index of the deviating call. */
  index: number;
  /** Signed offset from the chain's modal round trip, in quanta. */
  deltaQuanta: number;
}

/** Which series a chain's clusters (and so the verdict) were read on — see the header. */
export type RealInputSeries = "inputLatency" | "roundTrip";

export interface RealInputChainSummary {
  chainIndex: number;
  calls: number;
  usableCalls: number;
  medianInputLatencySec: number | null;
  medianRoundTripSec: number | null;
  /** Modal input part at frame resolution over the chain's usable calls, and how many share it. */
  modeInputLatencySec: number | null;
  modeCount: number;
  /** Modal round trip at frame resolution — the quantity transitions and deviations are judged on. */
  modeRoundTripSec: number | null;
  /** The series `clusters` and `withinHalfQuantum` were read on. */
  clusterSeries: RealInputSeries;
  /** True when every usable call of the chain is the same state as the chain's mode on `clusterSeries`. */
  withinHalfQuantum: boolean;
  /** The chain's usable values of `clusterSeries` grouped greedily: a call joins the open cluster
   *  while it is the same state as that cluster's lowest value. Sorted ascending. */
  clusters: RealInputCluster[];
  /** The chain's consecutive round-trip states, in call order (isolated deviations and an off first call excluded). */
  states: RealInputState[];
  transitions: RealInputTransition[];
  isolatedDeviations: RealInputIsolatedDeviation[];
  /** The chain's first usable call off the mode with the second at it — see the header; null otherwise. */
  firstCallOff: { index: number; deltaQuanta: number } | null;
  /** `MediaTrackSettings.latency` the browser reported for THIS chain's track, when it did. */
  reportedLatencySec: number | null;
  /** The chain's median input part minus its reported track latency. */
  medianInputMinusReportedSec: number | null;
}

export type RealInputVerdict = "repeatable" | "two-state" | "scattered" | "unusable";

/** What the verdict was decided on: one chain's clusters, or the medians of two chains. */
export type RealInputVerdictBasis = "per-chain clusters" | "chain medians" | "none";

export interface RealInputSummary {
  calls: number;
  usableCalls: number;
  /** Calls per SDK verdict string, every verdict seen. */
  verdictCounts: Record<string, number>;
  renderQuantumSec: number;
  /** Pooled over every usable call, all chains — the per-chain figures are in `perChain`. */
  inputLatencySec: RealInputStats | null;
  roundTripSec: RealInputStats | null;
  spreadSec: RealInputStats | null;
  correlationRatioDb: RealInputStats | null;
  /** Calls on which the SDK said `audioContext.outputLatency` was reported (non-zero). */
  outputLatencyReportedCount: number;
  anchorDisagreements: {
    /** Calls whose `reason` carries the SDK's own "capture anchors disagree" flag. */
    flaggedBySdk: number;
    /** Usable calls whose two anchors are distinct states (at least half a quantum apart), re-derived here. */
    rederived: number;
    /** 0-based indices of the re-derived disagreements. */
    indices: number[];
    /** False when no call reported a second anchor at all. */
    secondAnchorAvailable: boolean;
  };
  /** Round-trip steps, across all chains — see the header. */
  stateTransitions: {
    count: number;
    oneQuantumSteps: number;
    /** Of `count`, the steps whose new state no later agreeing call sat in. */
    unconfirmedSteps: number;
    transitions: RealInputTransition[];
  };
  /** Single calls off their chain's mode, anchors agreeing, neighbours at the mode — see the header. */
  isolatedDeviations: {
    count: number;
    deviations: RealInputIsolatedDeviation[];
  };
  /** One entry per chain seen, ascending `chainIndex`; a steady run has exactly one. */
  perChain: RealInputChainSummary[];
  /** Chain 1's median (of `verdictSeries`) minus chain 0's, in quanta, when both have a usable call. */
  chainMedianDifferenceQuanta: number | null;
  /** For a `two-state` verdict, the separation of the two states in quanta: upper cluster minus
   *  lower (always positive) on per-chain clusters, chain 1 minus chain 0 (signed) on chain medians; else null. */
  stateSeparationQuanta: number | null;
  verdictBasis: RealInputVerdictBasis;
  /** The series the clusters and chain medians behind the verdict were read on — see the header. */
  verdictSeries: RealInputSeries;
  /** The first usable chain's reported track latency (a scalar argument applies to every chain). */
  reportedLatencySec: number | null;
  /** Pooled median measured input part minus `reportedLatencySec`. */
  medianInputMinusReportedSec: number | null;
  verdict: RealInputVerdict;
  detail: string;
}

/** The SDK's second-anchor reason text, matched the way the loopback page matches it. */
const ANCHOR_DISAGREE_REASON = "capture anchors disagree";
/** |step| within 25 % of exactly one 128-frame quantum — the loopback page's rule. */
const ONE_QUANTUM_TOLERANCE = 0.25;

/**
 * The most common value in `values`, compared at frame resolution so floats that
 * differ only in the last bits count as the same measurement. Ties go to the
 * first value seen, which is the earliest call.
 */
export function modeAtFrameResolution(values: number[], sampleRate: number): { value: number; count: number } {
  const counts = new Map<number, { value: number; count: number }>();
  for (const value of values) {
    const key = Math.round(value * sampleRate);
    const entry = counts.get(key);
    if (entry === undefined) counts.set(key, { value, count: 1 });
    else entry.count++;
  }
  let best = { value: values[0], count: 0 };
  for (const entry of counts.values()) if (entry.count > best.count) best = entry;
  return best;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stats(values: number[]): RealInputStats | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const stdev = finite.length < 2
    ? null
    : Math.sqrt(finite.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (finite.length - 1));
  return {
    count: finite.length,
    median: median(finite) as number,
    min: Math.min(...finite),
    max: Math.max(...finite),
    stdev,
  };
}

export function isUsableCall(call: RealInputCall): boolean {
  return (call.verdict === "ok" || call.verdict === "noisy") &&
    Number.isFinite(call.roundTripSeconds) && Number.isFinite(call.inputLatencySeconds);
}

/** Tolerance on the half-quantum boundary, as a fraction of a quantum, so a float that lands a
 *  hair under exactly 0.5 q still reads as the boundary case it is. */
const STATE_BOUNDARY_TOLERANCE = 1e-3;

/**
 * THE ONE STATE RULE, used by every comparison in this module: two figures are the
 * same state when they differ by LESS than half a render quantum (minus the
 * tolerance), and distinct states at exactly half a quantum and beyond. So a
 * cluster is a maximal set whose span is under half a quantum, two anchors agree
 * when they are the same state, a transition is a step to a distinct state, and
 * two clusters or chain medians are two states when their centres are distinct.
 */
export function sameState(a: number, b: number, renderQuantumSec: number): boolean {
  return Math.abs(a - b) < (0.5 - STATE_BOUNDARY_TOLERANCE) * renderQuantumSec;
}

/** Both anchors agree: the second is absent (nothing to disagree), or the same state as the first. */
function anchorsAgree(call: RealInputCall, renderQuantumSec: number): boolean {
  const b = call.roundTripSecondsSecondary;
  return b === undefined || !Number.isFinite(b) || sameState(b, call.roundTripSeconds, renderQuantumSec);
}

/** Greedy over the sorted values: a value joins the open cluster while it is the same
 *  state as that cluster's lowest value, so every cluster's span is under half a quantum. */
function clusterValues(values: number[], renderQuantumSec: number): RealInputCluster[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const value of sorted) {
    const open = groups[groups.length - 1];
    if (open !== undefined && sameState(value, open[0], renderQuantumSec)) open.push(value);
    else groups.push([value]);
  }
  return groups.map((group) => ({
    calls: group.length,
    centerSec: median(group) as number,
    minSec: group[0],
    maxSec: group[group.length - 1],
  }));
}

interface IndexedCall {
  call: RealInputCall;
  index: number;
  /** Set on a call that opened a state: the reference round trip its step was measured from. */
  stepFromSec?: number;
}

const seriesValue = (call: RealInputCall, series: RealInputSeries): number =>
  series === "inputLatency" ? call.inputLatencySeconds : call.roundTripSeconds;

/**
 * One chain's summary. Transitions and isolated deviations are found on the
 * chain's usable calls in call order:
 *  1. an isolated deviation is a call off the chain's modal round trip,
 *     anchors agreeing, whose previous AND next usable calls sit at the mode;
 *     the chain's first usable call cannot be one (no previous call) — if it
 *     is off with the second call at the mode it is `firstCallOff` instead,
 *     and likewise left out of the state walk;
 *  2. with those removed, a transition is a call whose round trip is a
 *     distinct state from the previous agreeing call's, anchors agreeing on
 *     it; a call whose anchors disagree never opens a state (its reported
 *     round trip is the suspect figure) and is folded into the state it
 *     follows; the first state is seeded by the first agreeing call.
 */
function summarizeChain(
  chainIndex: number,
  all: IndexedCall[],
  sampleRate: number,
  clusterSeries: RealInputSeries,
  reportedLatencySec: number | null
): RealInputChainSummary {
  const renderQuantumSec = 128 / sampleRate;
  const usable = all.filter(({ call }) => isUsableCall(call));
  const empty: RealInputChainSummary = {
    chainIndex, calls: all.length, usableCalls: usable.length,
    medianInputLatencySec: null, medianRoundTripSec: null, modeInputLatencySec: null, modeCount: 0, modeRoundTripSec: null,
    clusterSeries, withinHalfQuantum: false, clusters: [], states: [], transitions: [], isolatedDeviations: [],
    firstCallOff: null, reportedLatencySec, medianInputMinusReportedSec: null,
  };
  if (usable.length === 0) return empty;

  const inputParts = usable.map(({ call }) => call.inputLatencySeconds);
  const inputMode = modeAtFrameResolution(inputParts, sampleRate);
  const roundTripMode = modeAtFrameResolution(usable.map(({ call }) => call.roundTripSeconds), sampleRate);
  const seriesValues = usable.map(({ call }) => seriesValue(call, clusterSeries));
  const seriesMode = clusterSeries === "inputLatency" ? inputMode : roundTripMode;
  const atMode = (c: IndexedCall) => sameState(c.call.roundTripSeconds, roundTripMode.value, renderQuantumSec);
  const agrees = (k: IndexedCall) => anchorsAgree(k.call, renderQuantumSec);
  const deltaQuanta = (c: IndexedCall) => (c.call.roundTripSeconds - roundTripMode.value) / renderQuantumSec;

  const isolated: RealInputIsolatedDeviation[] = [];
  let firstCallOff: RealInputChainSummary["firstCallOff"] = null;
  const kept: IndexedCall[] = [];
  usable.forEach((c, k) => {
    const next = usable[k + 1];
    const prev = usable[k - 1];
    const singleExcursion = !atMode(c) && agrees(c) && next !== undefined && atMode(next);
    if (singleExcursion && k === 0) {
      firstCallOff = { index: c.index, deltaQuanta: deltaQuanta(c) };
    } else if (singleExcursion && atMode(prev)) {
      isolated.push({ chainIndex, index: c.index, deltaQuanta: deltaQuanta(c) });
    } else {
      kept.push(c);
    }
  });

  const stateRuns: IndexedCall[][] = [];
  const openers: (IndexedCall | null)[] = [];
  // The first state is seeded by the chain's first anchors-agreeing call;
  // disagreeing calls before it are folded into that state rather than
  // opening one of their own (a first call with A a quantum off and B at the
  // mode would otherwise manufacture a transition on call 2).
  const firstAgreeing = kept.findIndex(agrees);
  const seedCount = firstAgreeing === -1 ? kept.length : firstAgreeing + 1;
  if (kept.length > 0) {
    stateRuns.push(kept.slice(0, seedCount));
    openers.push(null);
  }
  for (const c of kept.slice(seedCount)) {
    const open = stateRuns[stateRuns.length - 1];
    // The step is measured from the last call of the open state whose anchors
    // agree: a folded-in disagreeing call has a suspect round trip, and the
    // call after it must not read as a step back from that figure.
    const previous = [...open].reverse().find(agrees) ?? open[open.length - 1];
    if (!sameState(c.call.roundTripSeconds, previous.call.roundTripSeconds, renderQuantumSec) && agrees(c)) {
      stateRuns.push([c]);
      openers.push(c);
      c.stepFromSec = previous.call.roundTripSeconds;
    } else {
      open.push(c);
    }
  }
  const transitions: RealInputTransition[] = [];
  stateRuns.forEach((run, k) => {
    const opener = openers[k];
    if (opener === null || opener === undefined) return;
    const stepQuanta = (opener.call.roundTripSeconds - (opener.stepFromSec as number)) / renderQuantumSec;
    transitions.push({
      chainIndex, index: opener.index,
      fromRoundTripSec: opener.stepFromSec as number, toRoundTripSec: opener.call.roundTripSeconds,
      stepQuanta, isOneQuantumStep: Math.abs(Math.abs(stepQuanta) - 1) <= ONE_QUANTUM_TOLERANCE,
      // The opener agrees by construction; a second agreeing call in the run confirms the hold.
      confirmedByFollowingCall: run.filter(agrees).length >= 2,
    });
  });
  const states: RealInputState[] = stateRuns.map((run) => ({
    firstIndex: run[0].index,
    lastIndex: run[run.length - 1].index,
    calls: run.length,
    roundTripSec: modeAtFrameResolution(run.map(({ call }) => call.roundTripSeconds), sampleRate).value,
  }));

  const medianInputLatencySec = median(inputParts);
  return {
    ...empty,
    medianInputLatencySec,
    medianRoundTripSec: median(usable.map(({ call }) => call.roundTripSeconds)),
    modeInputLatencySec: inputMode.value,
    modeCount: inputMode.count,
    modeRoundTripSec: roundTripMode.value,
    withinHalfQuantum: seriesValues.every((v) => sameState(v, seriesMode.value, renderQuantumSec)),
    clusters: clusterValues(seriesValues, renderQuantumSec),
    states, transitions, isolatedDeviations: isolated, firstCallOff,
    medianInputMinusReportedSec:
      reportedLatencySec === null || medianInputLatencySec === null ? null : medianInputLatencySec - reportedLatencySec,
  };
}

const msText = (seconds: number) => (seconds * 1000).toFixed(3) + " ms";

/**
 * Summarize `calls` (in call order) at `sampleRate`. `reportedTrackLatencySec`
 * is the browser's `MediaTrackSettings.latency` for the armed track: a scalar
 * applies to every chain, a list gives one figure per `chainIndex` (a re-armed
 * chain has its own track), null where the browser reported none.
 *
 * Verdict, kept as the brief defined it but decided per chain on
 * `verdictSeries` (see the header):
 *  - one chain (steady): `repeatable` when every usable call is the same state
 *    as the chain's mode; `two-state` when the chain's clusters are exactly
 *    two with distinct centres; `scattered` otherwise. Basis "per-chain clusters".
 *  - two chains (fresh): each chain must be internally the same state as its
 *    own mode, else `scattered`; then `repeatable` when the chain medians are
 *    the same state and `two-state` when they are distinct. Basis "chain medians".
 */
export function summarizeRealInput(
  calls: RealInputCall[],
  sampleRate: number,
  reportedTrackLatencySec: number | null | ReadonlyArray<number | null>
): RealInputSummary {
  const renderQuantumSec = 128 / sampleRate;
  const verdictCounts: Record<string, number> = {};
  for (const call of calls) verdictCounts[call.verdict] = (verdictCounts[call.verdict] ?? 0) + 1;
  const indexed: IndexedCall[] = calls.map((call, index) => ({ call, index }));
  const usable = indexed.filter(({ call }) => isUsableCall(call));
  const outputLatencyReportedCount = calls.filter((call) => call.outputLatencyReported).length;
  const secondAnchorAvailable = calls.some((call) => call.roundTripSecondsSecondary !== undefined);
  const rederivedIndices = usable
    .filter(({ call }) => call.roundTripSecondsSecondary !== undefined && !anchorsAgree(call, renderQuantumSec))
    .map(({ index }) => index);
  const anchorDisagreements = {
    flaggedBySdk: calls.filter((call) => (call.reason ?? "").includes(ANCHOR_DISAGREE_REASON)).length,
    rederived: rederivedIndices.length,
    indices: rederivedIndices,
    secondAnchorAvailable,
  };
  // The input part is the round trip minus the SDK's output-latency figure; if
  // that figure was reported on some calls and not others, the input part
  // carries a step the input path never made — read the clusters on the round
  // trip then.
  const reportedFlags = new Set(usable.map(({ call }) => call.outputLatencyReported));
  const verdictSeries: RealInputSeries = reportedFlags.size > 1 ? "roundTrip" : "inputLatency";
  const reportedFor = (chainIndex: number): number | null =>
    Array.isArray(reportedTrackLatencySec)
      ? (reportedTrackLatencySec[chainIndex] ?? null)
      : (reportedTrackLatencySec as number | null);
  const chainIndices = [...new Set(calls.map((call) => call.chainIndex))].sort((a, b) => a - b);
  const perChain = chainIndices.map((chainIndex) =>
    summarizeChain(chainIndex, indexed.filter(({ call }) => call.chainIndex === chainIndex), sampleRate, verdictSeries, reportedFor(chainIndex)));
  const chainMedian = (c: RealInputChainSummary): number | null =>
    verdictSeries === "inputLatency" ? c.medianInputLatencySec : c.medianRoundTripSec;
  const chainMedianDifferenceQuanta = (() => {
    if (perChain.length < 2) return null;
    const first = perChain.find((c) => c.chainIndex === 0);
    const second = perChain.find((c) => c.chainIndex === 1);
    const a = first === undefined ? null : chainMedian(first);
    const b = second === undefined ? null : chainMedian(second);
    return a === null || b === null ? null : (b - a) / renderQuantumSec;
  })();
  const transitions = perChain.flatMap((c) => c.transitions);
  const deviations = perChain.flatMap((c) => c.isolatedDeviations);
  const usableChains = perChain.filter((c) => c.usableCalls > 0);
  const reportedLatencySec = usableChains[0]?.reportedLatencySec ?? perChain[0]?.reportedLatencySec ?? null;

  const base = {
    calls: calls.length,
    usableCalls: usable.length,
    verdictCounts,
    renderQuantumSec,
    outputLatencyReportedCount,
    anchorDisagreements,
    stateTransitions: {
      count: transitions.length,
      oneQuantumSteps: transitions.filter((t) => t.isOneQuantumStep).length,
      unconfirmedSteps: transitions.filter((t) => !t.confirmedByFollowingCall).length,
      transitions,
    },
    isolatedDeviations: { count: deviations.length, deviations },
    perChain,
    chainMedianDifferenceQuanta,
    verdictSeries,
    reportedLatencySec,
  };

  if (usable.length === 0) {
    return {
      ...base,
      inputLatencySec: null, roundTripSec: null, spreadSec: null, correlationRatioDb: null,
      stateSeparationQuanta: null, verdictBasis: "none", medianInputMinusReportedSec: null,
      verdict: "unusable",
      detail: `no usable call in ${calls.length} (verdicts: ${
        Object.entries(verdictCounts).map(([k, v]) => `${k}×${v}`).join(", ") || "none"
      }) — nothing below describes a measurement`,
    };
  }

  const inputStats = stats(usable.map(({ call }) => call.inputLatencySeconds)) as RealInputStats;
  const medianInputMinusReportedSec = reportedLatencySec === null ? null : inputStats.median - reportedLatencySec;
  const seriesName = verdictSeries === "inputLatency" ? "input part" : "round trip";

  let verdict: RealInputVerdict;
  let verdictBasis: RealInputVerdictBasis;
  let stateSeparationQuanta: number | null = null;
  let shape: string;
  if (usableChains.length === 1) {
    const chain = usableChains[0];
    verdictBasis = "per-chain clusters";
    const { clusters } = chain;
    const modeSec = verdictSeries === "inputLatency" ? chain.modeInputLatencySec : chain.modeRoundTripSec;
    if (chain.withinHalfQuantum) {
      verdict = "repeatable";
      shape = `chain ${chain.chainIndex}: ${chain.usableCalls} usable calls all within half a quantum of the modal ${seriesName} ` +
        `${msText(modeSec as number)} (${chain.modeCount} at the mode)`;
    } else if (clusters.length === 2 && !sameState(clusters[1].centerSec, clusters[0].centerSec, renderQuantumSec)) {
      verdict = "two-state";
      stateSeparationQuanta = (clusters[1].centerSec - clusters[0].centerSec) / renderQuantumSec;
      shape = `chain ${chain.chainIndex}: two ${seriesName} clusters ${msText(clusters[0].centerSec)} ×${clusters[0].calls} and ` +
        `${msText(clusters[1].centerSec)} ×${clusters[1].calls}, ${stateSeparationQuanta.toFixed(2)} quanta apart`;
    } else {
      verdict = "scattered";
      const span = Math.max(...clusters.map((c) => c.maxSec)) - Math.min(...clusters.map((c) => c.minSec));
      shape = `chain ${chain.chainIndex}: ${clusters.length} ${seriesName} clusters spanning ${msText(span)} ` +
        `(${(span / renderQuantumSec).toFixed(2)} quanta)`;
    }
  } else {
    verdictBasis = "chain medians";
    const medians = usableChains.map((c) => chainMedian(c) as number);
    const spreadQuanta = (Math.max(...medians) - Math.min(...medians)) / renderQuantumSec;
    const chainsText = usableChains
      .map((c) => `chain ${c.chainIndex} median ${seriesName} ${msText(chainMedian(c) as number)} ×${c.usableCalls}`)
      .join(", ");
    const unstable = usableChains.filter((c) => !c.withinHalfQuantum);
    if (unstable.length > 0) {
      verdict = "scattered";
      shape = `chain(s) ${unstable.map((c) => c.chainIndex).join(", ")} not within half a quantum of their own mode; ${chainsText}`;
    } else if (sameState(Math.max(...medians), Math.min(...medians), renderQuantumSec)) {
      verdict = "repeatable";
      shape = `${chainsText} — within half a quantum of each other (${spreadQuanta.toFixed(2)} quanta)`;
    } else {
      verdict = "two-state";
      // Chains not indexed 0/1 have no signed difference; the spread stands in.
      stateSeparationQuanta = chainMedianDifferenceQuanta ?? spreadQuanta;
      shape = `${chainsText} — ${spreadQuanta.toFixed(2)} quanta apart (the re-armed chain landed elsewhere)`;
    }
  }
  const seriesNote = verdictSeries === "roundTrip"
    ? " [clusters read on the round trip: outputLatencyReported flipped within the run]"
    : "";

  const transitionText = transitions.length === 0
    ? "no state transition"
    : `${transitions.length} state transition(s): ` + transitions
      .map((t) => `call ${t.index + 1} chain ${t.chainIndex} ${t.stepQuanta >= 0 ? "+" : ""}${t.stepQuanta.toFixed(2)} quanta` +
        (t.isOneQuantumStep ? " (one-quantum step)" : "") +
        (t.confirmedByFollowingCall ? "" : " (unconfirmed — no further agreeing call in the state it opened)"))
      .join(", ") +
      `; states ${perChain.flatMap((c) => c.states).map((s) => `${s.calls}×${msText(s.roundTripSec)}`).join(" / ")}`;
  const anchorText = `${anchorDisagreements.rederived} anchor disagreement(s)` +
    (anchorDisagreements.rederived > 0 ? ` (calls ${anchorDisagreements.indices.map((i) => i + 1).join(", ")})` : "");
  const deviationText = `${deviations.length} isolated deviation(s)` +
    (deviations.length > 0 ? ` (calls ${deviations.map((d) => d.index + 1).join(", ")})` : "");
  const firstOff = perChain.filter((c) => c.firstCallOff !== null);
  const firstOffText = firstOff.length === 0
    ? ""
    : `; first call off on chain(s) ${firstOff.map((c) => `${c.chainIndex} (call ${(c.firstCallOff as { index: number }).index + 1}, ${(c.firstCallOff as { deltaQuanta: number }).deltaQuanta.toFixed(2)} quanta)`).join(", ")}`;
  const detail = `${verdict} on ${verdictBasis}${seriesNote}: ${shape}; ${transitionText}; ${anchorText}; ${deviationText}${firstOffText}`;

  return {
    ...base,
    inputLatencySec: inputStats,
    roundTripSec: stats(usable.map(({ call }) => call.roundTripSeconds)),
    spreadSec: stats(usable.map(({ call }) => call.spreadSeconds)),
    correlationRatioDb: stats(usable.map(({ call }) => call.correlationRatioDb)),
    stateSeparationQuanta,
    verdictBasis,
    medianInputMinusReportedSec,
    verdict,
    detail,
  };
}
