// The judgement of the Chromium 40103985 probe (`?issue=capture-gaps`): a minute of a 1 kHz
// tone captured through a `MediaStreamAudioSourceNode`, read for runs of exact zeros (the
// tracker's 480-frame inserts on a FIFO underrun) and for 128-frame blocks repeated back to
// back (its duplications between unsynchronised clocks). The zeros before the first non-zero
// frame are the stream starting, counted apart as the head, not a gap.

/** The shortest run of exact zeros counted as a gap: a tone never holds zero this long. */
export const MIN_ZERO_RUN = 100;
/** The length of a duplicated block: one render quantum. */
export const DUPLICATE_BLOCK = 128;
/** Less capture than this is not judged. */
export const MIN_CAPTURE_SECONDS = 30;

export interface ZeroRun {
  start: number;
  length: number;
}

export type CaptureGapsVerdict = "GAPS" | "CLEAN" | "NOT CHECKED";

export interface CaptureGapsJudgement {
  verdict: CaptureGapsVerdict;
  zeroRunCount: number;
  longestRunFrames: number;
  duplicateCount: number;
}

/** The frames before the first non-zero one; the whole length when there is none. */
export function headZerosOf(frames: Float32Array): number {
  for (let i = 0; i < frames.length; i++) if (frames[i] !== 0) return i;
  return frames.length;
}

/** Runs of exact zeros of at least `minRun` frames after the head, in order. */
export function findZeroRuns(frames: Float32Array, minRun: number = MIN_ZERO_RUN): ZeroRun[] {
  const runs: ZeroRun[] = [];
  let start = -1;
  for (let i = headZerosOf(frames); i <= frames.length; i++) {
    const zero = i < frames.length && frames[i] === 0;
    if (zero && start < 0) start = i;
    else if (!zero && start >= 0) {
      if (i - start >= minRun) runs.push({ start, length: i - start });
      start = -1;
    }
  }
  return runs;
}

/**
 * Where a `block`-frame stretch begins that repeats the `block` frames just before it,
 * bit for bit, on any alignment; a stretch of zeros is a zero run, not a duplicate. A
 * repeat longer than one block is reported once, at its start.
 */
export function findDuplicateBlocks(frames: Float32Array, block: number = DUPLICATE_BLOCK): number[] {
  const bits = new Uint32Array(frames.buffer, frames.byteOffset, frames.length);
  const starts: number[] = [];
  let runStart = -1;
  let nonZero = false;
  for (let i = block; i <= frames.length; i++) {
    const same = i < frames.length && bits[i] === bits[i - block];
    if (same) {
      if (runStart < 0) {
        runStart = i;
        nonZero = false;
      }
      if (frames[i] !== 0) nonZero = true;
    } else if (runStart >= 0) {
      if (i - runStart >= block && nonZero) starts.push(runStart);
      runStart = -1;
    }
  }
  return starts;
}

/** GAPS for any zero run or duplicate after the head; NOT CHECKED under `MIN_CAPTURE_SECONDS`. */
export function judgeCaptureGaps(
  zeroRuns: readonly ZeroRun[],
  duplicates: readonly number[],
  headZeros: number,
  durationSec: number,
): CaptureGapsJudgement {
  const runs = zeroRuns.filter((run) => run.start >= headZeros);
  const repeats = duplicates.filter((start) => start >= headZeros);
  const zeroRunCount = runs.length;
  const longestRunFrames = runs.reduce((longest, run) => Math.max(longest, run.length), 0);
  const duplicateCount = repeats.length;
  const verdict: CaptureGapsVerdict =
    durationSec < MIN_CAPTURE_SECONDS ? "NOT CHECKED" : zeroRunCount > 0 || duplicateCount > 0 ? "GAPS" : "CLEAN";
  return { verdict, zeroRunCount, longestRunFrames, duplicateCount };
}
