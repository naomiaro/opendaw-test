/**
 * Chromium 560233271: repeated `suspend()` / `resume()` on a running context with an
 * AudioWorkletNode eventually leaves the output permanently distorted, "crackling" (macOS).
 * This file holds the judgement, pure and Node-testable; the browser half is
 * `chromiumSuspendResumeProbe.ts`.
 */

import { BASELINE_MIN_RATIO, HALF_SPEED_MAX_RATIO, clockRatio, type ClockRatioSample } from "./chromiumBfcache";
import { notChecked, type NotChecked } from "./chromiumWatched";

/** One measurement window of the 440 Hz tone, read from an analyser. */
export interface TonePurity {
  /** The tone's FFT bin, in dB. */
  fundamentalDb: number;
  /** The power sum of every bin outside the tone's window lobe, in dB. */
  harmonicsDb: number;
  /** Time-domain windows whose RMS fell below `DROPOUT_RMS_RATIO` of the baseline's. */
  dropouts: number;
  /** Samples whose second difference exceeds the baseline's click threshold. */
  clicks: number;
}

export type SuspendResumeVerdict = "DISTORTED" | "CLEAN" | "NOT CHECKED";

/**
 * Why a reading was not judged: too few windows, a baseline with no tone in it (silence, or a
 * level under `SIGNAL_FLOOR_RMS`), or a baseline whose purity is not a number.
 */
export type SuspendResumeNotCheckedReason = "too-few-cycles" | "no-signal" | "no-baseline-purity";

/** What one reading (the graph's, or the microphone's) reads as: a judged word, or why not. */
export type ReadingVerdict = "DISTORTED" | "CLEAN" | NotChecked;

export interface SuspendResumeJudgement {
  verdict: SuspendResumeVerdict;
  /** Null when judged. */
  notCheckedReason: SuspendResumeNotCheckedReason | null;
  /**
   * The lowest purity over the cycles; NaN when there were none. A silent window (every bin
   * −Infinity, so its purity is not a number) counts as −Infinity: it is the worst window, never
   * one left out.
   */
  worstPurityDb: number;
  /** The cycle (from 0) the worst purity was read after; null when there were none. */
  worstCycle: number | null;
  /** Dropouts over every cycle's window. */
  dropoutsAfter: number;
  /** The most clicks one cycle's window held; 0 when there were none. */
  worstClicks: number;
  /** The cycle (from 0) with the most clicks; null when no window held one. */
  worstClicksCycle: number | null;
  /** Windows whose purity is not a number: the analyser read silence. */
  silentWindows: number;
}

export const TONE_HZ = 440;
export const DROPOUT_RMS_RATIO = 0.1;
/** A purity this far below the baseline's, or further, is distortion. */
export const PURITY_DROP_DB = 12;
export const MIN_CYCLES = 10;
/**
 * A baseline window quieter than this RMS holds no tone to judge (−100 dBFS; the graph's tone
 * sits at 0.14, the microphone's measured windows tens of dB above the floor): a processor that
 * threw renders silence, a muted microphone delivers zeros.
 */
export const SIGNAL_FLOOR_RMS = 1e-5;
/**
 * Bins either side of the tone's own that belong to it: the analyser's Blackman window
 * spreads a pure sine over a main lobe three bins wide each side. Counting the lobe as
 * "other" would put most of the tone's own power into the harmonics.
 */
export const TONE_LOBE_BINS = 3;
/**
 * A click is a sample whose second difference exceeds this many times the baseline's
 * 99.9th percentile of it. A clean sine's second difference is bounded by its amplitude
 * times (2π f / rate)², so a step or a flipped sample stands far above it.
 */
export const CLICK_THRESHOLD_FACTOR = 20;
export const CLICK_PERCENTILE = 0.999;
/** A window may hold this many more clicks than the baseline's before it reads as distorted. */
export const CLICK_MARGIN = 2;

/** How far the tone stands above the rest of the spectrum, in dB. */
export function purityOf(tone: TonePurity): number {
  return tone.fundamentalDb - tone.harmonicsDb;
}

/**
 * A tone's purity from an analyser's `getFloatFrequencyData` read. Every bin outside the
 * lobe counts, however low: broadband crackle spreads thin over thousands of bins, each
 * under any per-bin gate, and only their sum shows it. `minHz` leaves out the bins below it:
 * a microphone's room rumble would otherwise outweigh the tone.
 */
export function tonePurityFromSpectrum(
  bins: Float32Array,
  sampleRate: number,
  fftSize: number,
  dropouts: number,
  clicks: number,
  toneHz: number = TONE_HZ,
  minHz: number = 0
): TonePurity {
  const toneBin = Math.round((toneHz * fftSize) / sampleRate);
  const firstBin = Math.max(1, Math.ceil((minHz * fftSize) / sampleRate));
  let power = 0;
  for (let i = firstBin; i < bins.length; i++) {
    if (Math.abs(i - toneBin) <= TONE_LOBE_BINS) continue;
    power += 10 ** (bins[i] / 10);
  }
  return { fundamentalDb: bins[toneBin], harmonicsDb: 10 * Math.log10(power), dropouts, clicks };
}

/**
 * Consecutive windows of `windowSize` samples whose RMS is below `DROPOUT_RMS_RATIO` × `baselineRms`;
 * an all-zero window is always one, so a baseline RMS of 0 still counts silence.
 */
export function countDropouts(samples: Float32Array, windowSize: number, baselineRms: number): number {
  let count = 0;
  for (let start = 0; start + windowSize <= samples.length; start += windowSize) {
    let sum = 0;
    for (let i = start; i < start + windowSize; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / windowSize);
    if (rms === 0 || rms < DROPOUT_RMS_RATIO * baselineRms) count++;
  }
  return count;
}

function secondDifferences(samples: Float32Array): Float64Array {
  const out = new Float64Array(Math.max(0, samples.length - 2));
  for (let i = 1; i < samples.length - 1; i++) out[i - 1] = Math.abs(samples[i + 1] - 2 * samples[i] + samples[i - 1]);
  return out;
}

/** The click threshold a clean baseline window sets: `CLICK_THRESHOLD_FACTOR` × its 99.9th percentile second difference. */
export function clickThreshold(baseline: Float32Array): number {
  const sorted = secondDifferences(baseline).sort();
  const at = Math.min(sorted.length - 1, Math.floor(CLICK_PERCENTILE * sorted.length));
  return CLICK_THRESHOLD_FACTOR * sorted[at];
}

/** Samples whose second difference exceeds `threshold`. */
export function countClicks(samples: Float32Array, threshold: number): number {
  let count = 0;
  for (const d of secondDifferences(samples)) if (d > threshold) count++;
  return count;
}

/**
 * The rules: `NOT CHECKED` under `MIN_CYCLES` windows (the fewer of `cycles` and the windows
 * given), against a silent baseline (fundamental −Infinity, or `baselineRms` under
 * `SIGNAL_FLOOR_RMS`) and against a baseline whose purity is not a number; else `DISTORTED`
 * when the worst purity falls more than `PURITY_DROP_DB` below the baseline's (a silent window
 * counts as −Infinity), when two consecutive windows hold dropouts, or when one window holds
 * more than `CLICK_MARGIN` clicks over the baseline's; else `CLEAN`.
 */
export function judgeSuspendResume(baseline: TonePurity, afterCycles: TonePurity[], cycles: number, baselineRms: number): SuspendResumeJudgement {
  let worstPurityDb = NaN;
  let worstCycle: number | null = null;
  let worstClicks = 0;
  let worstClicksCycle: number | null = null;
  let silentWindows = 0;
  for (let cycle = 0; cycle < afterCycles.length; cycle++) {
    const raw = purityOf(afterCycles[cycle]);
    if (Number.isNaN(raw)) silentWindows++;
    const purity = Number.isNaN(raw) ? -Infinity : raw;
    if (worstCycle === null || purity < worstPurityDb) {
      worstPurityDb = purity;
      worstCycle = cycle;
    }
    if (afterCycles[cycle].clicks > worstClicks) {
      worstClicks = afterCycles[cycle].clicks;
      worstClicksCycle = cycle;
    }
  }
  const dropoutsAfter = afterCycles.reduce((sum, tone) => sum + tone.dropouts, 0);
  const judged = { worstPurityDb, worstCycle, dropoutsAfter, worstClicks, worstClicksCycle, silentWindows };
  const notJudged = (reason: SuspendResumeNotCheckedReason): SuspendResumeJudgement => ({ verdict: "NOT CHECKED", notCheckedReason: reason, ...judged });
  if (Math.min(cycles, afterCycles.length) < MIN_CYCLES) return notJudged("too-few-cycles");
  if (baseline.fundamentalDb === -Infinity || !(baselineRms >= SIGNAL_FLOOR_RMS)) return notJudged("no-signal");
  const baselinePurity = purityOf(baseline);
  if (!Number.isFinite(baselinePurity)) return notJudged("no-baseline-purity");
  const purityFell = worstCycle !== null && worstPurityDb < baselinePurity - PURITY_DROP_DB;
  const dropoutsTogether = afterCycles.some((tone, i) => i > 0 && tone.dropouts > 0 && afterCycles[i - 1].dropouts > 0);
  const clicked = worstClicks > baseline.clicks + CLICK_MARGIN;
  return { verdict: purityFell || dropoutsTogether || clicked ? "DISTORTED" : "CLEAN", notCheckedReason: null, ...judged };
}

/**
 * One reading's word. A failed step reads `NOT CHECKED <step>` however many cycles were banked
 * before it: a run that did not finish is not a clean one. Then the judgement's own reason
 * (`<n>-cycles` for too few), else its word.
 */
export function readingWord(judged: SuspendResumeJudgement, completedCycles: number, failedStep: string | null): ReadingVerdict {
  if (failedStep !== null) return notChecked(failedStep);
  if (judged.verdict !== "NOT CHECKED") return judged.verdict;
  return notChecked(judged.notCheckedReason === "too-few-cycles" ? `${completedCycles}-cycles` : (judged.notCheckedReason ?? "unjudged"));
}

export interface HalfRateJudgement {
  /** The clock fell under `HALF_SPEED_MAX_RATIO` after a cycle and stayed there to the end of the run. */
  halfRate: boolean;
  ratioBefore: number;
  /** Each cycle's window's ratio, the context clock's advance over the wall clock's. */
  ratios: number[];
  /** The cycle (from 0) whose window first read slow and every later one too; null when none. */
  firstHalfCycle: number | null;
}

/**
 * The tracker's mechanism: after the failure each 256-frame output callback renders one
 * quantum instead of two, so the context clock runs at half the wall clock's speed and
 * stays there. Half rate needs a true baseline (at least `BASELINE_MIN_RATIO`) and a slow
 * window that every later window matches, two at the least: one slow window at the end
 * of a run cannot say whether it held.
 */
export function judgeHalfRate(before: ClockRatioSample, after: ClockRatioSample[]): HalfRateJudgement {
  const ratioBefore = clockRatio(before);
  const ratios = after.map(clockRatio);
  let firstHalfCycle: number | null = null;
  for (let i = ratios.length - 1; i >= 0 && ratios[i] < HALF_SPEED_MAX_RATIO; i--) firstHalfCycle = i;
  const held = firstHalfCycle !== null && ratios.length - firstHalfCycle >= 2;
  const halfRate = ratioBefore >= BASELINE_MIN_RATIO && held;
  return { halfRate, ratioBefore, ratios, firstHalfCycle: halfRate ? firstHalfCycle : null };
}
