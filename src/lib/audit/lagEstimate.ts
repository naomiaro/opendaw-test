/**
 * Lag estimate between two renders of the same material, by normalized cross-correlation.
 * Pure DSP: Float32Array in, frames out. Used by the plug-in delay compensation repro page to
 * read how far a device's look-ahead shifts a track against a dry render of the same source.
 */

export interface LagEstimate {
  /** Frames by which `candidate` lags `reference`: positive = candidate arrives later. */
  lag: number;
  /** Normalized correlation at `lag`, 1 = identical shape. */
  score: number;
}

/**
 * Search lags in `[-maxLag, maxLag]` and return the one where `candidate` shifted back by that
 * many frames best matches `reference`. Both arrays must be the same length and finite (a
 * non-finite sample or `maxLag` throws). The window is capped at half the length so every lag
 * is scored over at least half the material: a lag overlapping a handful of samples correlates
 * perfectly by construction and would otherwise win. A silent input (zero energy on either side)
 * reads as lag 0 with score 0. Trust the lag only when the score is near 1: a true lag outside
 * the window reads as some lag with a low score. The maximum is unique for aperiodic material;
 * a periodic signal ties at every period multiple inside the window.
 */
export function bestLag(reference: Float32Array, candidate: Float32Array, maxLag: number): LagEstimate {
  if (reference.length !== candidate.length) {
    throw new Error(`bestLag: lengths differ (${reference.length} vs ${candidate.length})`);
  }
  if (!Number.isFinite(maxLag)) throw new Error(`bestLag: maxLag is not finite (${maxLag})`);
  for (let i = 0; i < reference.length; i++) {
    if (!Number.isFinite(reference[i]) || !Number.isFinite(candidate[i])) {
      throw new Error(`bestLag: non-finite sample at ${i}`);
    }
  }
  const n = reference.length;
  const limit = Math.min(Math.max(0, Math.floor(maxLag)), Math.floor(n / 2));
  let best: LagEstimate = { lag: 0, score: 0 };
  for (let lag = -limit; lag <= limit; lag++) {
    // candidate[i + lag] against reference[i]
    const from = Math.max(0, -lag);
    const to = Math.min(n, n - lag);
    let dot = 0;
    let refEnergy = 0;
    let candEnergy = 0;
    for (let i = from; i < to; i++) {
      const r = reference[i];
      const c = candidate[i + lag];
      dot += r * c;
      refEnergy += r * r;
      candEnergy += c * c;
    }
    if (refEnergy === 0 || candEnergy === 0) continue;
    const score = dot / Math.sqrt(refEnergy * candEnergy);
    if (score > best.score) best = { lag, score };
  }
  return best;
}
