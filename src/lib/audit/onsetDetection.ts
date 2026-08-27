/**
 * Pure DSP onset/discontinuity detection for the sample-rate alignment audit.
 *
 * No SDK imports — Float32Array in, numbers (seconds) out — so these
 * detectors can measure offline-rendered engine audio (or any WAV/PCM
 * buffer) independently of the box graph. Designed so the same physical
 * click content, sampled at different rates, yields the same detected time
 * within ~1 ms: the coarse, hop-quantized envelope stage only *locates* a
 * candidate; a rate-independent (seconds-based) refinement pass corrects it
 * to sub-hop precision, which is what actually buys the sub-ms accuracy.
 *
 * Assumptions / non-goals (not exercised by the test suite):
 * - Input must be finite (no NaN/Infinity handling) — offline-rendered
 *   engine audio always is.
 * - `detectOnsets` looks for RISING energy edges only; it will not flag a
 *   very slow fade-in with no clear attack. Every audit scenario here is
 *   percussive/step-like (clicks, note attacks), so this is not a limitation
 *   in practice.
 */

export interface OnsetOptions {
  /** Envelope hop size in samples. Default 64. */
  hopSize?: number;
  /** Fraction of the buffer's max hop-to-hop envelope rise that counts as an onset. Default 0.25. */
  thresholdRatio?: number;
  /** Minimum gap between accepted onsets, in seconds. Default 0.05. */
  refractorySec?: number;
}

/** Refinement search radius around a candidate hop: ±10 ms, seconds-based (rate-independent). */
const REFINE_WINDOW_SEC = 0.01;
/** Refined onset = first sample whose |x| exceeds this fraction of the local (±REFINE_WINDOW_SEC) peak. */
const REFINE_THRESHOLD_RATIO = 0.25;

/**
 * Detect rising-energy onsets in `channel`.
 *
 * Algorithm: compute an RMS energy envelope over `hopSize`-sample hops,
 * find hop-to-hop rises, and mark a candidate at the first hop whose rise
 * clears `thresholdRatio` of the buffer's max rise (at least one
 * `refractorySec` after the previous candidate). Each candidate is then
 * refined to the first sample — searching forward from `refineWindow`
 * samples before the candidate — whose |x| exceeds 25% of the local peak
 * (max |x| within ±`REFINE_WINDOW_SEC`). This refinement is what gives
 * sub-millisecond, rate-independent accuracy: the hop-quantized stage alone
 * only resolves to ~hopSize/sampleRate.
 *
 * Returns onset times in seconds, ascending. Silence (no envelope rise
 * anywhere) returns an empty array.
 */
export function detectOnsets(
  channel: Float32Array,
  sampleRate: number,
  options: OnsetOptions = {}
): number[] {
  const hopSize = options.hopSize ?? 64;
  const thresholdRatio = options.thresholdRatio ?? 0.25;
  const refractorySec = options.refractorySec ?? 0.05;
  const refractorySamples = Math.round(refractorySec * sampleRate);

  const length = channel.length;
  if (length === 0) return [];

  // --- Hop energy envelope (RMS per hop) ---
  const numHops = Math.ceil(length / hopSize);
  const envelope = new Float32Array(numHops);
  for (let h = 0; h < numHops; h++) {
    const start = h * hopSize;
    const end = Math.min(length, start + hopSize);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = channel[i];
      sumSq += v * v;
    }
    envelope[h] = Math.sqrt(sumSq / (end - start));
  }

  // --- Hop-to-hop rise + global max rise ---
  let maxRise = 0;
  const rise = new Float32Array(numHops);
  for (let h = 0; h < numHops; h++) {
    const prev = h === 0 ? 0 : envelope[h - 1];
    const r = envelope[h] - prev;
    rise[h] = r > 0 ? r : 0;
    if (rise[h] > maxRise) maxRise = rise[h];
  }
  if (maxRise === 0) return []; // silence: no rise anywhere

  const threshold = thresholdRatio * maxRise;

  // --- Candidate hops: first hop of each rising edge clearing threshold,
  //     spaced at least one refractory period apart ---
  const candidates: number[] = [];
  let lastCandidateSample = -Infinity;
  for (let h = 0; h < numHops; h++) {
    if (rise[h] < threshold) continue;
    const hopStartSample = h * hopSize;
    if (hopStartSample - lastCandidateSample < refractorySamples) continue;
    candidates.push(hopStartSample);
    lastCandidateSample = hopStartSample;
  }

  // --- Refine each candidate to sub-hop accuracy ---
  const refineWindowSamples = Math.round(REFINE_WINDOW_SEC * sampleRate);
  const refined: number[] = [];
  for (const candidateSample of candidates) {
    const lo = Math.max(0, candidateSample - refineWindowSamples);
    const hi = Math.min(length - 1, candidateSample + refineWindowSamples);

    let peak = 0;
    for (let i = lo; i <= hi; i++) {
      const a = Math.abs(channel[i]);
      if (a > peak) peak = a;
    }
    if (peak === 0) continue; // no signal in the local window; skip

    const refineThreshold = REFINE_THRESHOLD_RATIO * peak;
    let onsetSample = candidateSample;
    for (let i = lo; i <= hi; i++) {
      if (Math.abs(channel[i]) >= refineThreshold) {
        onsetSample = i;
        break;
      }
    }
    refined.push(onsetSample / sampleRate);
  }

  // --- Final refractory merge (refinement can, in principle, pull two
  //     candidates toward each other) ---
  const merged: number[] = [];
  for (const t of refined) {
    if (merged.length === 0 || t - merged[merged.length - 1] >= refractorySec) {
      merged.push(t);
    }
  }
  return merged;
}

/**
 * Largest local discontinuity around `atSec`, scanning ±`windowSec`
 * (default 10 ms).
 *
 * Implemented as the max discrete second difference
 * `|x[n+1] − 2·x[n] + x[n−1]|` rather than a plain first difference
 * `|x[n] − x[n−1]|`: a plain adjacent-sample delta misses a "seam" whose
 * value happens to be continuous but whose *slope* folds (a phase-inverted
 * splice landing on a zero crossing is the textbook case, and is exactly
 * what the accompanying test constructs — a 220 Hz tone flipped at 0.75 s,
 * where 220 × 0.75 = 165 whole cycles puts the flip exactly on a
 * zero-crossing). The second difference catches both a value jump and a
 * slope fold, and reduces to the same order of magnitude as a first
 * difference for an ordinary step discontinuity, so it generalizes to real
 * splice/seam clicks without losing sensitivity.
 */
export function maxStepAround(
  channel: Float32Array,
  sampleRate: number,
  atSec: number,
  windowSec: number = 0.01
): number {
  const center = Math.round(atSec * sampleRate);
  const windowSamples = Math.round(windowSec * sampleRate);
  const lo = Math.max(1, center - windowSamples);
  const hi = Math.min(channel.length - 2, center + windowSamples);

  let maxStep = 0;
  for (let i = lo; i <= hi; i++) {
    const step = Math.abs(channel[i + 1] - 2 * channel[i] + channel[i - 1]);
    if (step > maxStep) maxStep = step;
  }
  return maxStep;
}
