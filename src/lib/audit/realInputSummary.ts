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
 * `transport-running`) report NaN figures, so they are counted by verdict and
 * otherwise left out; `usableCalls === 0` makes the whole summary `unusable`
 * and every statistic below it null.
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
 * Three different things a call off its chain's mode can be, kept apart in the
 * output because they point at different mechanisms:
 *  - an ANCHOR DISAGREEMENT: the two capture anchors of one call are distinct
 *    states (see `sameState`). The SDK's own detector for a capture node whose
 *    first-frame time is a quantum off; the reported round trip may still sit
 *    at the mode (batch 1788464404625 call 11: A = mode, B = mode − 128 frames).
 *  - a STATE TRANSITION: the round trip steps by at least half a quantum from
 *    the PREVIOUS call, both anchors agreeing, and STAYS there — the input path
 *    itself moved (batch 1788464591756 calls 28-30 and the applied call all
 *    read exactly −128 frames). Counted as transitions, with the calls in each
 *    state; a step within 25 % of one quantum is flagged `isOneQuantumStep`.
 *  - an ISOLATED DEVIATION: one call off its chain's mode with both anchors
 *    agreeing and the NEXT call back at the mode — the single-call case no
 *    anchor check can catch. Expected 0; if it is ever non-zero that is the
 *    finding.
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

/** One group of a chain's usable input parts whose range is within half a render quantum. */
export interface RealInputCluster {
  calls: number;
  /** Median of the cluster's input parts, seconds. */
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
}

export interface RealInputIsolatedDeviation {
  chainIndex: number;
  /** 0-based index of the deviating call. */
  index: number;
  /** Signed offset from the chain's modal round trip, in quanta. */
  deltaQuanta: number;
}

export interface RealInputChainSummary {
  chainIndex: number;
  calls: number;
  usableCalls: number;
  medianInputLatencySec: number | null;
  /** Modal input part at frame resolution over the chain's usable calls, and how many share it. */
  modeInputLatencySec: number | null;
  modeCount: number;
  /** Modal round trip at frame resolution — the quantity transitions and deviations are judged on. */
  modeRoundTripSec: number | null;
  /** True when every usable call of the chain is within half a quantum of the chain's modal input part. */
  withinHalfQuantum: boolean;
  /** The chain's usable input parts grouped greedily: a call joins the open cluster while it stays
   *  within half a quantum of that cluster's lowest value. Sorted ascending. */
  clusters: RealInputCluster[];
  /** The chain's consecutive round-trip states, in call order (isolated deviations excluded). */
  states: RealInputState[];
  transitions: RealInputTransition[];
  isolatedDeviations: RealInputIsolatedDeviation[];
}

export type RealInputVerdict = "repeatable" | "two-state" | "scattered" | "unusable";

/** What the verdict was decided on: one chain's input-part clusters, or the medians of two chains. */
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
  /** Round-trip steps that persisted, across all chains — see the header. */
  stateTransitions: {
    count: number;
    oneQuantumSteps: number;
    transitions: RealInputTransition[];
  };
  /** Single calls off their chain's mode, anchors agreeing, next call back — see the header. */
  isolatedDeviations: {
    count: number;
    deviations: RealInputIsolatedDeviation[];
  };
  /** One entry per chain seen, ascending `chainIndex`; a steady run has exactly one. */
  perChain: RealInputChainSummary[];
  /** Chain 1's median input part minus chain 0's, in quanta, when both have a usable call. */
  chainMedianDifferenceQuanta: number | null;
  /** For a `two-state` verdict, the separation of the two states in quanta: upper cluster minus
   *  lower (always positive) on per-chain clusters, chain 1 minus chain 0 (signed) on chain medians; else null. */
  stateSeparationQuanta: number | null;
  verdictBasis: RealInputVerdictBasis;
  /** `MediaTrackSettings.latency` as the browser reported it for the armed track, when it did. */
  reportedLatencySec: number | null;
  /** Pooled median measured input part minus the browser's reported figure. */
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
function clusterInputParts(values: number[], renderQuantumSec: number): RealInputCluster[] {
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

interface IndexedCall { call: RealInputCall; index: number }

/**
 * One chain's summary. Transitions and isolated deviations are found on the
 * chain's usable calls in call order:
 *  1. an isolated deviation is a call off the chain's modal round trip by at
 *     least half a quantum, anchors agreeing, whose neighbours on BOTH sides
 *     (where they exist; the call must have a next one) sit at the mode;
 *  2. with those removed, a transition is a call whose round trip is at least
 *     half a quantum from the previous kept call's, anchors agreeing on it;
 *     a call whose anchors disagree never opens a state (its reported round
 *     trip is the suspect figure) and is folded into the state it follows.
 */
function summarizeChain(chainIndex: number, all: IndexedCall[], sampleRate: number): RealInputChainSummary {
  const renderQuantumSec = 128 / sampleRate;
  const usable = all.filter(({ call }) => isUsableCall(call));
  const empty: RealInputChainSummary = {
    chainIndex, calls: all.length, usableCalls: usable.length,
    medianInputLatencySec: null, modeInputLatencySec: null, modeCount: 0, modeRoundTripSec: null,
    withinHalfQuantum: false, clusters: [], states: [], transitions: [], isolatedDeviations: [],
  };
  if (usable.length === 0) return empty;

  const inputParts = usable.map(({ call }) => call.inputLatencySeconds);
  const inputMode = modeAtFrameResolution(inputParts, sampleRate);
  const roundTripMode = modeAtFrameResolution(usable.map(({ call }) => call.roundTripSeconds), sampleRate);
  const atMode = (c: IndexedCall) => sameState(c.call.roundTripSeconds, roundTripMode.value, renderQuantumSec);

  const isolated: RealInputIsolatedDeviation[] = [];
  const kept: IndexedCall[] = [];
  usable.forEach((c, k) => {
    const next = usable[k + 1];
    const prev = usable[k - 1];
    const isIsolated = !atMode(c) && anchorsAgree(c.call, renderQuantumSec) &&
      next !== undefined && atMode(next) && (prev === undefined || atMode(prev));
    if (isIsolated) {
      isolated.push({ chainIndex, index: c.index, deltaQuanta: (c.call.roundTripSeconds - roundTripMode.value) / renderQuantumSec });
    } else {
      kept.push(c);
    }
  });

  const transitions: RealInputTransition[] = [];
  const stateRuns: IndexedCall[][] = [];
  for (const c of kept) {
    const open = stateRuns[stateRuns.length - 1];
    if (open === undefined) { stateRuns.push([c]); continue; }
    // The step is measured from the last call of the open state whose anchors
    // agree: a folded-in disagreeing call has a suspect round trip, and the
    // call after it must not read as a step back from that figure.
    const previous = [...open].reverse().find((k) => anchorsAgree(k.call, renderQuantumSec)) ?? open[open.length - 1];
    const step = c.call.roundTripSeconds - previous.call.roundTripSeconds;
    if (!sameState(c.call.roundTripSeconds, previous.call.roundTripSeconds, renderQuantumSec) && anchorsAgree(c.call, renderQuantumSec)) {
      const stepQuanta = step / renderQuantumSec;
      transitions.push({
        chainIndex, index: c.index,
        fromRoundTripSec: previous.call.roundTripSeconds, toRoundTripSec: c.call.roundTripSeconds,
        stepQuanta, isOneQuantumStep: Math.abs(Math.abs(stepQuanta) - 1) <= ONE_QUANTUM_TOLERANCE,
      });
      stateRuns.push([c]);
    } else {
      open.push(c);
    }
  }
  const states: RealInputState[] = stateRuns.map((run) => ({
    firstIndex: run[0].index,
    lastIndex: run[run.length - 1].index,
    calls: run.length,
    roundTripSec: modeAtFrameResolution(run.map(({ call }) => call.roundTripSeconds), sampleRate).value,
  }));

  return {
    ...empty,
    medianInputLatencySec: median(inputParts),
    modeInputLatencySec: inputMode.value,
    modeCount: inputMode.count,
    modeRoundTripSec: roundTripMode.value,
    withinHalfQuantum: inputParts.every((v) => sameState(v, inputMode.value, renderQuantumSec)),
    clusters: clusterInputParts(inputParts, renderQuantumSec),
    states, transitions, isolatedDeviations: isolated,
  };
}

const msText = (seconds: number) => (seconds * 1000).toFixed(3) + " ms";

/**
 * Summarize `calls` (in call order) at `sampleRate`. `reportedTrackLatencySec`
 * is the browser's `MediaTrackSettings.latency` for the armed track, or null
 * when it reported none.
 *
 * Verdict, kept as the brief defined it but decided per chain:
 *  - one chain (steady): `repeatable` when every usable call is within half a
 *    quantum of the chain's modal input part; `two-state` when the chain's
 *    input-part clusters are exactly two and at least half a quantum apart;
 *    `scattered` otherwise. Basis "per-chain clusters".
 *  - two chains (fresh): each chain must be internally within half a quantum
 *    of its own mode, else `scattered`; then `repeatable` when the chain
 *    medians are within half a quantum of each other and `two-state` when
 *    they are at least half a quantum apart. Basis "chain medians".
 */
export function summarizeRealInput(
  calls: RealInputCall[],
  sampleRate: number,
  reportedTrackLatencySec: number | null
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
  const chainIndices = [...new Set(calls.map((call) => call.chainIndex))].sort((a, b) => a - b);
  const perChain = chainIndices.map((chainIndex) =>
    summarizeChain(chainIndex, indexed.filter(({ call }) => call.chainIndex === chainIndex), sampleRate));
  const chainMedianDifferenceQuanta = (() => {
    if (perChain.length < 2) return null;
    const first = perChain.find((c) => c.chainIndex === 0)?.medianInputLatencySec ?? null;
    const second = perChain.find((c) => c.chainIndex === 1)?.medianInputLatencySec ?? null;
    return first === null || second === null ? null : (second - first) / renderQuantumSec;
  })();
  const transitions = perChain.flatMap((c) => c.transitions);
  const deviations = perChain.flatMap((c) => c.isolatedDeviations);

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
      transitions,
    },
    isolatedDeviations: { count: deviations.length, deviations },
    perChain,
    chainMedianDifferenceQuanta,
    reportedLatencySec: reportedTrackLatencySec,
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
  const medianInputMinusReportedSec = reportedTrackLatencySec === null ? null : inputStats.median - reportedTrackLatencySec;
  const usableChains = perChain.filter((c) => c.usableCalls > 0);

  let verdict: RealInputVerdict;
  let verdictBasis: RealInputVerdictBasis;
  let stateSeparationQuanta: number | null = null;
  let shape: string;
  if (usableChains.length === 1) {
    const chain = usableChains[0];
    verdictBasis = "per-chain clusters";
    const { clusters } = chain;
    if (chain.withinHalfQuantum) {
      verdict = "repeatable";
      shape = `chain ${chain.chainIndex}: ${chain.usableCalls} usable calls all within half a quantum of the modal input part ` +
        `${msText(chain.modeInputLatencySec as number)} (${chain.modeCount} at the mode)`;
    } else if (clusters.length === 2 && !sameState(clusters[1].centerSec, clusters[0].centerSec, renderQuantumSec)) {
      verdict = "two-state";
      stateSeparationQuanta = (clusters[1].centerSec - clusters[0].centerSec) / renderQuantumSec;
      shape = `chain ${chain.chainIndex}: two input-part clusters ${msText(clusters[0].centerSec)} ×${clusters[0].calls} and ` +
        `${msText(clusters[1].centerSec)} ×${clusters[1].calls}, ${stateSeparationQuanta.toFixed(2)} quanta apart`;
    } else {
      verdict = "scattered";
      const span = Math.max(...clusters.map((c) => c.maxSec)) - Math.min(...clusters.map((c) => c.minSec));
      shape = `chain ${chain.chainIndex}: ${clusters.length} input-part clusters spanning ${msText(span)} ` +
        `(${(span / renderQuantumSec).toFixed(2)} quanta)`;
    }
  } else {
    verdictBasis = "chain medians";
    const medians = usableChains.map((c) => c.medianInputLatencySec as number);
    const spreadQuanta = (Math.max(...medians) - Math.min(...medians)) / renderQuantumSec;
    const chainsText = usableChains
      .map((c) => `chain ${c.chainIndex} median ${msText(c.medianInputLatencySec as number)} ×${c.usableCalls}`)
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
      stateSeparationQuanta = chainMedianDifferenceQuanta ?? spreadQuanta;
      shape = `${chainsText} — ${spreadQuanta.toFixed(2)} quanta apart (the re-armed chain landed elsewhere)`;
    }
  }

  const transitionText = transitions.length === 0
    ? "no state transition"
    : `${transitions.length} state transition(s): ` + transitions
      .map((t) => `call ${t.index + 1} chain ${t.chainIndex} ${t.stepQuanta >= 0 ? "+" : ""}${t.stepQuanta.toFixed(2)} quanta` +
        (t.isOneQuantumStep ? " (one-quantum step)" : ""))
      .join(", ") +
      `; states ${perChain.flatMap((c) => c.states).map((s) => `${s.calls}×${msText(s.roundTripSec)}`).join(" / ")}`;
  const anchorText = `${anchorDisagreements.rederived} anchor disagreement(s)` +
    (anchorDisagreements.rederived > 0 ? ` (calls ${anchorDisagreements.indices.map((i) => i + 1).join(", ")})` : "");
  const deviationText = `${deviations.length} isolated deviation(s)` +
    (deviations.length > 0 ? ` (calls ${deviations.map((d) => d.index + 1).join(", ")})` : "");
  const detail = `${verdict} on ${verdictBasis}: ${shape}; ${transitionText}; ${anchorText}; ${deviationText}`;

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
