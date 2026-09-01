/**
 * Pure measurement library for the recording start-alignment audit:
 * reference-click schedule generation, zero-phase band splitting, and
 * click identification/anchor-time estimation.
 *
 * No SDK imports — Float32Array in, numbers (seconds) out — same contract
 * as `onsetDetection.ts`, so these functions can measure a captured
 * recording buffer (or any WAV/PCM buffer) independently of the box graph.
 *
 * Reference schedule: consecutive gaps grow monotonically
 * (`baseGapSec + k·gapIncrementSec` between click k and k+1), so a single
 * measured gap between two consecutive onsets — even from a truncated,
 * arbitrarily-shifted recording — uniquely identifies which pair of
 * schedule indices produced it. That's what lets `identifyReferenceClicks`
 * recover indices (and therefore the buffer's absolute start time) without
 * any prior knowledge of where in the schedule the recording begins.
 *
 * Band split: filtering a click stream to isolate its onset energy must not
 * itself shift onset time, or the shift would be indistinguishable from the
 * alignment error under measurement. A plain (causal) biquad has phase
 * delay that does exactly that, so `bandSplit` runs each biquad forward
 * then backward over the reversed output (filtfilt) — the two passes'
 * phase delays cancel, leaving zero net phase shift at the cost of doubled
 * filter order (attenuation) and non-causality (fine for offline analysis).
 */

export interface ReferenceSchedule {
  times: number[];
  baseGapSec: number;
  gapIncrementSec: number;
}

export interface IdentifiedClick {
  index: number;
  fileTimeSec: number;
}

/**
 * Build a reference click schedule with unique, monotonically growing gaps:
 * the gap between `times[k]` and `times[k+1]` is `baseGapSec + k·gapIncrementSec`.
 * Because every gap length is distinct, a single measured gap between two
 * consecutive detected onsets identifies which schedule indices produced it.
 */
export function buildReferenceSchedule(
  startSec: number,
  count: number,
  baseGapSec: number = 0.25,
  gapIncrementSec: number = 0.005
): ReferenceSchedule {
  const times: number[] = [startSec];
  for (let k = 0; k < count - 1; k++) {
    times.push(times[k] + baseGapSec + k * gapIncrementSec);
  }
  return { times, baseGapSec, gapIncrementSec };
}

function biquadCoeffs(type: "lowpass" | "highpass", f0: number, rate: number) {
  const w0 = (2 * Math.PI * f0) / rate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2 / 1); // Q = sqrt(2)/2 → alpha = sin/ (2Q)
  const cosw = Math.cos(w0);
  const a0 = 1 + alpha;
  if (type === "lowpass") {
    return {
      b0: (1 - cosw) / 2 / a0,
      b1: (1 - cosw) / a0,
      b2: (1 - cosw) / 2 / a0,
      a1: (-2 * cosw) / a0,
      a2: (1 - alpha) / a0,
    };
  }
  return {
    b0: (1 + cosw) / 2 / a0,
    b1: -(1 + cosw) / a0,
    b2: (1 + cosw) / 2 / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Zero-phase (forward-backward) biquad application over a fresh copy — never mutates `x`. */
function filtfilt(x: Float32Array, c: ReturnType<typeof biquadCoeffs>): Float32Array {
  const pass = (input: Float32Array): Float32Array => {
    const y = new Float32Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const v = c.b0 * input[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = input[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };
  const forward = pass(x);
  forward.reverse();
  const backward = pass(forward);
  backward.reverse();
  return backward;
}

/**
 * Split `channel` into a low band (below `lowCutoffHz`) and a high band
 * (above `highCutoffHz`) via zero-phase (filtfilt) RBJ biquads (Q = 1/√2),
 * so filtering adds no onset-time bias — a click's peak position survives
 * within ~1ms of its unfiltered location.
 */
export function bandSplit(
  channel: Float32Array,
  sampleRate: number,
  lowCutoffHz: number = 1500,
  highCutoffHz: number = 3000
): { low: Float32Array; high: Float32Array } {
  const low = filtfilt(channel, biquadCoeffs("lowpass", lowCutoffHz, sampleRate));
  const high = filtfilt(channel, biquadCoeffs("highpass", highCutoffHz, sampleRate));
  return { low, high };
}

/**
 * Recover which schedule indices produced `onsets` (buffer-relative
 * seconds, ascending) and the buffer's start context-time offset.
 *
 * Pass 1 — index recovery: for each consecutive onset pair, the gap
 * uniquely identifies a schedule index `i` (the growing-gap design);
 * accepted pairs vote `T0 = times[i] − onsets[k]`, and the median vote
 * becomes the working anchor.
 *
 * Pass 2 — final assignment: every onset is assigned to its nearest
 * schedule time under that anchor, kept only within `gapToleranceSec·2`,
 * with duplicate/outlier assignments (a spurious onset close to a real
 * click, or two onsets competing for one schedule slot) resolved by
 * preferring the closer match. This second pass — not pass 1 — is what
 * drops a spurious onset that happens to fall near a real click.
 */
export function identifyReferenceClicks(
  onsets: number[],
  schedule: ReferenceSchedule,
  gapToleranceSec: number = 0.002
): IdentifiedClick[] {
  if (onsets.length < 2) return [];

  const { times, baseGapSec, gapIncrementSec } = schedule;

  const votes: number[] = [];
  for (let k = 0; k < onsets.length - 1; k++) {
    const gap = onsets[k + 1] - onsets[k];
    const i = Math.round((gap - baseGapSec) / gapIncrementSec);
    if (i < 0 || i >= times.length - 1) continue;
    const expected = baseGapSec + i * gapIncrementSec;
    if (Math.abs(gap - expected) > gapToleranceSec) continue;
    votes.push(times[i] - onsets[k]);
  }
  if (votes.length === 0) return [];

  votes.sort((a, b) => a - b);
  const midVote = Math.floor(votes.length / 2);
  const anchorT0 =
    votes.length % 2 === 1 ? votes[midVote] : (votes[midVote - 1] + votes[midVote]) / 2;

  const assignTolerance = gapToleranceSec * 2;
  const candidates: { onsetIdx: number; scheduleIdx: number; diff: number }[] = [];
  for (let o = 0; o < onsets.length; o++) {
    const contextTime = onsets[o] + anchorT0;
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(times[i] - contextTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (bestDiff <= assignTolerance) {
      candidates.push({ onsetIdx: o, scheduleIdx: bestIdx, diff: bestDiff });
    }
  }

  // Resolve duplicates (two onsets competing for one schedule slot, or one
  // onset in range of two slots) by accepting the closest matches first.
  candidates.sort((a, b) => a.diff - b.diff);
  const usedSchedule = new Set<number>();
  const usedOnset = new Set<number>();
  const result: IdentifiedClick[] = [];
  for (const c of candidates) {
    if (usedSchedule.has(c.scheduleIdx) || usedOnset.has(c.onsetIdx)) continue;
    usedSchedule.add(c.scheduleIdx);
    usedOnset.add(c.onsetIdx);
    result.push({ index: c.scheduleIdx, fileTimeSec: onsets[c.onsetIdx] });
  }
  result.sort((a, b) => a.index - b.index);
  return result;
}

/**
 * Median, over identified clicks, of `schedule.times[index] − fileTimeSec`
 * — the context time of the buffer's first frame. `null` when `identified`
 * is empty.
 */
export function estimateAnchorT0(
  identified: IdentifiedClick[],
  schedule: ReferenceSchedule
): number | null {
  if (identified.length === 0) return null;
  const diffs = identified
    .map((c) => schedule.times[c.index] - c.fileTimeSec)
    .sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  return diffs.length % 2 === 1 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
}
