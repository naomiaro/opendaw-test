/**
 * Measurement helpers for the stale-metronome-click repro page
 * (`metronome-stale-click-debug-demo.html`, note
 * `debug/metronome-click-survives-pause.md`).
 *
 * The page records the engine's output around a transport stop and the restart
 * that follows. Three numbers decide the verdict:
 *  - `cutBodyMs`: how much of the last click before the stop was rendered — the
 *    stop must land INSIDE a click (the engine's default click is a 2 ms attack
 *    and 50 ms release) for the stale-click path to be exercised at all;
 *  - `fullLevel`: the peak of the click the stop interrupted (the last burst in
 *    the pre-stop recording — its 2 ms attack has completed once the cut is past
 *    2.5 ms), so the ratio below is normalised by the SAME click's level (the
 *    440 Hz beat click is quieter than the 880 Hz downbeat); a cut shorter than
 *    that falls back to the loudest whole click after the restart;
 *  - `headRatio`: the peak in the first `HEAD_WINDOW_MS` (0.5 ms) after the
 *    restart's first non-silent sample, over `fullLevel`. A click that starts
 *    from zero ramps linearly for 2 ms, so 0.5 ms in it sits at ≤ 25 % of its
 *    level (≤ ~29 % of a beat click's when the restart is a downbeat); a click
 *    body already sounding when the transport resumes is at its release level
 *    (≥ 80 % for a cut within the first 12 ms of the 50 ms release), and any
 *    0.5 ms window of the 440 Hz beat click sees ≥ 64 % of the sine's peak
 *    whatever its phase — so ≥ 0.5 stale against ≤ 0.29 clean.
 */
export const HEAD_WINDOW_MS = 0.5;
/** A cut this long has completed the click's 2 ms attack, so its peak is the full level. */
export const ATTACK_COMPLETE_MS = 2.5;

export function firstOnsetIndex(samples: Float32Array, threshold: number, from = 0): number {
  for (let i = from; i < samples.length; i++) if (Math.abs(samples[i]) > threshold) return i;
  return -1;
}

/** Peak of `|samples|` over `[from, from + windowMs)`. */
export function peakIn(samples: Float32Array, rate: number, from: number, windowMs: number): number {
  const to = Math.min(samples.length, from + Math.round((windowMs / 1000) * rate));
  let peak = 0;
  for (let i = Math.max(0, from); i < to; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}

/** Peak of the first `windowMs` after `onset`, relative to `fullLevel`. */
export function headRatio(samples: Float32Array, rate: number, onset: number, windowMs: number, fullLevel: number): number {
  if (onset < 0 || fullLevel <= 0) return 0;
  return peakIn(samples, rate, onset, windowMs) / fullLevel;
}

/**
 * Rendered length, in ms, of the last burst of signal in `samples`: from the
 * last onset that follows at least `gapMs` of near-silence to the last sample
 * above `threshold`. The pre-stop recording ends where the transport stopped,
 * so on a click cut by the stop this is the part of its body that was rendered.
 */
export function lastBurstMs(samples: Float32Array, rate: number, threshold: number, gapMs = 20): number {
  let last = -1;
  for (let i = samples.length - 1; i >= 0; i--) if (Math.abs(samples[i]) > threshold) { last = i; break; }
  if (last < 0) return 0;
  const gap = Math.round((gapMs / 1000) * rate);
  let start = last;
  let quiet = 0;
  for (let i = last; i >= 0; i--) {
    if (Math.abs(samples[i]) > threshold) { start = i; quiet = 0; }
    else if (++quiet >= gap) break;
  }
  return ((last - start + 1) / rate) * 1000;
}

/** Peak of the last burst of signal in `samples` (see `lastBurstMs` for the burst bounds). */
export function lastBurstPeak(samples: Float32Array, rate: number, threshold: number, gapMs = 20): number {
  let last = -1;
  for (let i = samples.length - 1; i >= 0; i--) if (Math.abs(samples[i]) > threshold) { last = i; break; }
  if (last < 0) return 0;
  const gap = Math.round((gapMs / 1000) * rate);
  let peak = 0;
  let quiet = 0;
  for (let i = last; i >= 0; i--) {
    if (Math.abs(samples[i]) > threshold) { peak = Math.max(peak, Math.abs(samples[i])); quiet = 0; }
    else if (++quiet >= gap) break;
  }
  return peak;
}

export interface RestartAnalysis {
  /** Rendered body of the last click before the stop (ms). */
  cutBodyMs: number;
  /** Full level the head is compared with: the interrupted click's own peak
   *  (attack complete), else the loudest whole click after the restart. */
  fullLevel: number;
  /** Sample index of the restart's first non-silent sample in `post`. */
  restartOnset: number;
  /** Peak of the first `HEAD_WINDOW_MS` after the restart over `fullLevel`. */
  headRatio: number;
}

/**
 * `pre`: the output recorded up to the stop; `post`: the output recorded from
 * the play command on. `fullLevel` is the interrupted click's own peak when its
 * attack completed (cut ≥ 2.5 ms), else the largest peak found in `post` after
 * the first 60 ms (a whole click, not the restart head itself).
 */
export function analyzeRestart(pre: Float32Array, post: Float32Array, rate: number, threshold = 0.01): RestartAnalysis {
  const cutBodyMs = lastBurstMs(pre, rate, threshold);
  const restartOnset = firstOnsetIndex(post, threshold);
  let fullLevel = cutBodyMs >= ATTACK_COMPLETE_MS ? lastBurstPeak(pre, rate, threshold) : 0;
  if (fullLevel === 0) {
    const after = restartOnset >= 0 ? restartOnset + Math.round(0.06 * rate) : 0;
    for (let i = after; i < post.length; i++) fullLevel = Math.max(fullLevel, Math.abs(post[i]));
  }
  if (fullLevel === 0) fullLevel = peakIn(post, rate, Math.max(0, restartOnset), 60);
  return { cutBodyMs, fullLevel, restartOnset, headRatio: headRatio(post, rate, restartOnset, HEAD_WINDOW_MS, fullLevel) };
}
