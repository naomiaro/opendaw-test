/**
 * Chromium 560233271: repeated `suspend()` / `resume()` on a running context with an
 * AudioWorkletNode eventually leaves the output permanently distorted (macOS). This file
 * holds the judgement, pure and Node-testable; the browser half is
 * `chromiumSuspendResumeProbe.ts`.
 */

/** One measurement window of the 440 Hz tone, read from an analyser. */
export interface TonePurity {
  /** The tone's FFT bin, in dB. */
  fundamentalDb: number;
  /**
   * The power sum of every other bin above `SPECTRUM_FLOOR_DB`, in dB, and never below the floor:
   * a clean sine puts nothing above it, and its purity then reads as the bound the floor sets.
   */
  harmonicsDb: number;
  /** Time-domain windows whose RMS fell below `DROPOUT_RMS_RATIO` of the baseline's. */
  dropouts: number;
}

export type SuspendResumeVerdict = "DISTORTED" | "CLEAN" | "NOT CHECKED";

export interface SuspendResumeJudgement {
  verdict: SuspendResumeVerdict;
  /** The lowest purity over the cycles; NaN when there were none. */
  worstPurityDb: number;
  /** The cycle (from 0) the worst purity was read after; null when there were none. */
  worstCycle: number | null;
  /** Dropouts over every cycle's window. */
  dropoutsAfter: number;
}

export const TONE_HZ = 440;
export const SPECTRUM_FLOOR_DB = -80;
export const DROPOUT_RMS_RATIO = 0.1;
/** A purity this far below the baseline's, or further, is distortion. */
export const PURITY_DROP_DB = 12;
export const MIN_CYCLES = 10;
/**
 * Bins either side of the tone's own that belong to it: the analyser's Blackman window
 * spreads a pure sine over a main lobe three bins wide each side. Counting the lobe as
 * "other" would put most of the tone's own power into the harmonics.
 */
export const TONE_LOBE_BINS = 3;

/** How far the tone stands above the rest of the spectrum, in dB. */
export function purityOf(tone: TonePurity): number {
  return tone.fundamentalDb - tone.harmonicsDb;
}

/** A tone's purity from an analyser's `getFloatFrequencyData` read. */
export function tonePurityFromSpectrum(
  bins: Float32Array,
  sampleRate: number,
  fftSize: number,
  dropouts: number,
  toneHz: number = TONE_HZ
): TonePurity {
  const toneBin = Math.round((toneHz * fftSize) / sampleRate);
  let power = 0;
  for (let i = 1; i < bins.length; i++) {
    if (Math.abs(i - toneBin) <= TONE_LOBE_BINS) continue;
    if (bins[i] > SPECTRUM_FLOOR_DB) power += 10 ** (bins[i] / 10);
  }
  const harmonicsDb = Math.max(SPECTRUM_FLOOR_DB, power === 0 ? -Infinity : 10 * Math.log10(power));
  return { fundamentalDb: bins[toneBin], harmonicsDb, dropouts };
}

/** Consecutive windows of `windowSize` samples whose RMS is below `DROPOUT_RMS_RATIO` × `baselineRms`. */
export function countDropouts(samples: Float32Array, windowSize: number, baselineRms: number): number {
  let count = 0;
  for (let start = 0; start + windowSize <= samples.length; start += windowSize) {
    let sum = 0;
    for (let i = start; i < start + windowSize; i++) sum += samples[i] * samples[i];
    if (Math.sqrt(sum / windowSize) < DROPOUT_RMS_RATIO * baselineRms) count++;
  }
  return count;
}

export function judgeSuspendResume(baseline: TonePurity, afterCycles: TonePurity[], cycles: number): SuspendResumeJudgement {
  let worstPurityDb = NaN;
  let worstCycle: number | null = null;
  for (let cycle = 0; cycle < afterCycles.length; cycle++) {
    const purity = purityOf(afterCycles[cycle]);
    if (worstCycle === null || purity < worstPurityDb) {
      worstPurityDb = purity;
      worstCycle = cycle;
    }
  }
  const dropoutsAfter = afterCycles.reduce((sum, tone) => sum + tone.dropouts, 0);
  if (cycles < MIN_CYCLES) return { verdict: "NOT CHECKED", worstPurityDb, worstCycle, dropoutsAfter };
  const purityFell = worstCycle !== null && worstPurityDb < purityOf(baseline) - PURITY_DROP_DB;
  const dropoutsTogether = afterCycles.some((tone, i) => i > 0 && tone.dropouts > 0 && afterCycles[i - 1].dropouts > 0);
  const verdict: SuspendResumeVerdict = purityFell || dropoutsTogether ? "DISTORTED" : "CLEAN";
  return { verdict, worstPurityDb, worstCycle, dropoutsAfter };
}
