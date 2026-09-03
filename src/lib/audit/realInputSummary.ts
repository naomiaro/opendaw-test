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

/** One group of usable input parts whose range is within half a render quantum. */
export interface RealInputCluster {
  calls: number;
  /** Median of the cluster's input parts, seconds. */
  centerSec: number;
  minSec: number;
  maxSec: number;
}

export interface RealInputChainSummary {
  chainIndex: number;
  calls: number;
  usableCalls: number;
  medianInputLatencySec: number | null;
}

export type RealInputVerdict = "repeatable" | "two-state" | "scattered" | "unusable";

export interface RealInputSummary {
  calls: number;
  usableCalls: number;
  /** Calls per SDK verdict string, every verdict seen. */
  verdictCounts: Record<string, number>;
  renderQuantumSec: number;
  inputLatencySec: RealInputStats | null;
  roundTripSec: RealInputStats | null;
  spreadSec: RealInputStats | null;
  correlationRatioDb: RealInputStats | null;
  /** Calls on which the SDK said `audioContext.outputLatency` was reported (non-zero). */
  outputLatencyReportedCount: number;
  anchorDisagreements: {
    /** Calls whose `reason` carries the SDK's own "capture anchors disagree" flag. */
    flaggedBySdk: number;
    /** Usable calls whose two anchors differ by more than half a quantum, re-derived here. */
    rederived: number;
    /** False when no call reported a second anchor at all. */
    secondAnchorAvailable: boolean;
  };
  /** Modal input part at frame resolution over the usable calls, and how many share it. */
  modeInputLatencySec: number | null;
  modeCount: number;
  /** Modal round trip at frame resolution — the quantity the one-quantum rule is judged on. */
  modeRoundTripSec: number | null;
  /** Usable calls whose round trip is one render quantum (±25 %) off the modal round trip. */
  oneQuantumMisses: number;
  /** Usable input parts grouped greedily: a call joins the open cluster while it stays
   *  within half a quantum of that cluster's lowest value. Sorted ascending. */
  clusters: RealInputCluster[];
  /** For a `two-state` verdict, the gap between the two cluster centres in quanta; else null. */
  stateSeparationQuanta: number | null;
  /** Per chain, when `chainIndex` varies across the calls; null when every call ran on one chain. */
  perChain: RealInputChainSummary[] | null;
  /** Chain 1's median input part minus chain 0's, in quanta, when both have a usable call. */
  chainMedianDifferenceQuanta: number | null;
  /** `MediaTrackSettings.latency` as the browser reported it for the armed track, when it did. */
  reportedLatencySec: number | null;
  /** Median measured input part minus the browser's reported figure. */
  medianInputMinusReportedSec: number | null;
  verdict: RealInputVerdict;
  detail: string;
}

/** The SDK's second-anchor reason text, matched the way the loopback page matches it. */
const ANCHOR_DISAGREE_REASON = "capture anchors disagree";
/** |delta| within 25 % of exactly one 128-frame quantum — the loopback page's rule. */
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

function clusterInputParts(values: number[], halfQuantumSec: number): RealInputCluster[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const value of sorted) {
    const open = groups[groups.length - 1];
    if (open !== undefined && value - open[0] <= halfQuantumSec) open.push(value);
    else groups.push([value]);
  }
  return groups.map((group) => ({
    calls: group.length,
    centerSec: median(group) as number,
    minSec: group[0],
    maxSec: group[group.length - 1],
  }));
}

const msText = (seconds: number) => (seconds * 1000).toFixed(3) + " ms";

/**
 * Summarize `calls` at `sampleRate`. `reportedTrackLatencySec` is the browser's
 * `MediaTrackSettings.latency` for the armed track, or null when it reported none.
 */
export function summarizeRealInput(
  calls: RealInputCall[],
  sampleRate: number,
  reportedTrackLatencySec: number | null
): RealInputSummary {
  const renderQuantumSec = 128 / sampleRate;
  const halfQuantumSec = 0.5 * renderQuantumSec;
  const verdictCounts: Record<string, number> = {};
  for (const call of calls) verdictCounts[call.verdict] = (verdictCounts[call.verdict] ?? 0) + 1;
  const usable = calls.filter(isUsableCall);
  const outputLatencyReportedCount = calls.filter((call) => call.outputLatencyReported).length;
  const secondAnchorAvailable = calls.some((call) => call.roundTripSecondsSecondary !== undefined);
  const anchorDisagreements = {
    flaggedBySdk: calls.filter((call) => (call.reason ?? "").includes(ANCHOR_DISAGREE_REASON)).length,
    rederived: usable.filter((call) =>
      call.roundTripSecondsSecondary !== undefined && Number.isFinite(call.roundTripSecondsSecondary) &&
      Math.abs(call.roundTripSecondsSecondary - call.roundTripSeconds) > halfQuantumSec
    ).length,
    secondAnchorAvailable,
  };
  const chainIndices = [...new Set(calls.map((call) => call.chainIndex))].sort((a, b) => a - b);
  const perChain: RealInputChainSummary[] | null = chainIndices.length > 1
    ? chainIndices.map((chainIndex) => {
      const chainUsable = usable.filter((call) => call.chainIndex === chainIndex);
      return {
        chainIndex,
        calls: calls.filter((call) => call.chainIndex === chainIndex).length,
        usableCalls: chainUsable.length,
        medianInputLatencySec: median(chainUsable.map((call) => call.inputLatencySeconds)),
      };
    })
    : null;
  const chainMedianDifferenceQuanta = (() => {
    if (perChain === null) return null;
    const first = perChain.find((c) => c.chainIndex === 0)?.medianInputLatencySec ?? null;
    const second = perChain.find((c) => c.chainIndex === 1)?.medianInputLatencySec ?? null;
    return first === null || second === null ? null : (second - first) / renderQuantumSec;
  })();

  const base = {
    calls: calls.length,
    usableCalls: usable.length,
    verdictCounts,
    renderQuantumSec,
    outputLatencyReportedCount,
    anchorDisagreements,
    perChain,
    chainMedianDifferenceQuanta,
    reportedLatencySec: reportedTrackLatencySec,
  };

  if (usable.length === 0) {
    return {
      ...base,
      inputLatencySec: null, roundTripSec: null, spreadSec: null, correlationRatioDb: null,
      modeInputLatencySec: null, modeCount: 0, modeRoundTripSec: null, oneQuantumMisses: 0,
      clusters: [], stateSeparationQuanta: null, medianInputMinusReportedSec: null,
      verdict: "unusable",
      detail: `no usable call in ${calls.length} (verdicts: ${
        Object.entries(verdictCounts).map(([k, v]) => `${k}×${v}`).join(", ") || "none"
      }) — nothing below describes a measurement`,
    };
  }

  const inputParts = usable.map((call) => call.inputLatencySeconds);
  const roundTrips = usable.map((call) => call.roundTripSeconds);
  const inputMode = modeAtFrameResolution(inputParts, sampleRate);
  const roundTripMode = modeAtFrameResolution(roundTrips, sampleRate);
  const oneQuantumMisses = roundTrips.filter((rt) => {
    const deltaQuanta = Math.abs(rt - roundTripMode.value) / renderQuantumSec;
    return Math.abs(deltaQuanta - 1) <= ONE_QUANTUM_TOLERANCE;
  }).length;
  const clusters = clusterInputParts(inputParts, halfQuantumSec);
  const inputStats = stats(inputParts) as RealInputStats;
  const medianInputMinusReportedSec = reportedTrackLatencySec === null ? null : inputStats.median - reportedTrackLatencySec;

  const repeatable = inputParts.every((v) => Math.abs(v - inputMode.value) <= halfQuantumSec);
  const twoState = !repeatable && clusters.length === 2 && (clusters[1].minSec - clusters[0].maxSec) >= halfQuantumSec;
  const stateSeparationQuanta = twoState ? (clusters[1].centerSec - clusters[0].centerSec) / renderQuantumSec : null;
  const verdict: RealInputVerdict = repeatable ? "repeatable" : twoState ? "two-state" : "scattered";
  const chainNote = perChain === null || chainMedianDifferenceQuanta === null
    ? ""
    : `; chain 1 − chain 0 median ${chainMedianDifferenceQuanta.toFixed(2)} quanta`;
  const missNote = oneQuantumMisses > 0 ? `; ${oneQuantumMisses} one-quantum miss(es) on the round trip` : "";
  const detail = repeatable
    ? `${usable.length}/${calls.length} usable calls all within half a quantum of the modal input part ${msText(inputMode.value)}` +
      ` (range ${msText(inputStats.max - inputStats.min)})${missNote}${chainNote}`
    : twoState
      ? `${usable.length}/${calls.length} usable calls in two states ${msText(clusters[0].centerSec)} ×${clusters[0].calls}` +
        ` and ${msText(clusters[1].centerSec)} ×${clusters[1].calls}, ${(stateSeparationQuanta as number).toFixed(2)} quanta apart${missNote}${chainNote}`
      : `${usable.length}/${calls.length} usable calls scattered over ${clusters.length} groups spanning` +
        ` ${msText(inputStats.max - inputStats.min)} (${((inputStats.max - inputStats.min) / renderQuantumSec).toFixed(2)} quanta)${missNote}${chainNote}`;

  return {
    ...base,
    inputLatencySec: inputStats,
    roundTripSec: stats(roundTrips),
    spreadSec: stats(usable.map((call) => call.spreadSeconds)),
    correlationRatioDb: stats(usable.map((call) => call.correlationRatioDb)),
    modeInputLatencySec: inputMode.value,
    modeCount: inputMode.count,
    modeRoundTripSec: roundTripMode.value,
    oneQuantumMisses,
    clusters,
    stateSeparationQuanta,
    medianInputMinusReportedSec,
    verdict,
    detail,
  };
}
