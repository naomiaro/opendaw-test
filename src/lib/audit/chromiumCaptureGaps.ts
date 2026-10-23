// The judgement of the Chromium 40103985 probe (`?issue=capture-gaps`): a minute of a 1 kHz
// tone captured through a `MediaStreamAudioSourceNode`, read for runs of exact zeros (the
// tracker's 480-frame inserts on a FIFO underrun) and for 128-frame blocks repeated back to
// back (its duplications between unsynchronised clocks). The zeros before the first non-zero
// frame are the stream starting, counted apart as the head, not a gap. Events in the first
// `START_WINDOW_SEC` after the head are the source warming up: reported apart, and they read
// `START GAPS`, not the tracker's steady-state `GAPS`. A head longer than `MAX_HEAD_SEC` is no
// signal in the first 5 s (a muted microphone delivers exact zeros) and reads `NOT CHECKED no-signal`.
// A source that ended, was muted or fed the recorder an empty input during the capture leaves zeros
// that are not the browser's: the run reads `NOT CHECKED source-<ended|muted|empty-input>`.

import { notChecked, type Verdict } from "./chromiumWatched";

/** The shortest run of exact zeros counted as a gap: a tone never holds zero this long. */
export const MIN_ZERO_RUN = 100;
/** The length of a duplicated block: one render quantum. */
export const DUPLICATE_BLOCK = 128;
/** Less capture than this is not judged. */
export const MIN_CAPTURE_SECONDS = 30;
/** Events starting this soon after the first non-zero frame are the source starting up. */
export const START_WINDOW_SEC = 0.1;
/** A head of zeros longer than this is no signal in the first 5 s, not a stream starting. */
export const MAX_HEAD_SEC = 5;
/** One render quantum. */
export const QUANTUM_FRAMES = 128;

/**
 * The recorder's chunk length: whole render quanta, about one second, so no quantum is split
 * across two chunks (44 100 is not a multiple of 128).
 */
export function recorderChunkFrames(sampleRate: number): number {
  return QUANTUM_FRAMES * Math.max(1, Math.round(sampleRate / QUANTUM_FRAMES));
}

export interface ZeroRun {
  start: number;
  length: number;
}

export type CaptureGapsVerdict = "GAPS" | "START GAPS" | "CLEAN" | "NOT CHECKED" | "NOT CHECKED no-signal";

export interface CaptureGapsJudgement {
  verdict: CaptureGapsVerdict;
  /** Zero runs after the start window. */
  zeroRunCount: number;
  longestRunFrames: number;
  /** Duplicates after the start window. */
  duplicateCount: number;
  zeroRuns: ZeroRun[];
  duplicates: number[];
  /** Zero runs and duplicates starting within `START_WINDOW_SEC` after the head. */
  startZeroRuns: ZeroRun[];
  startDuplicates: number[];
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

/**
 * GAPS for any zero run or duplicate after the start window; START GAPS when the only ones start
 * within `START_WINDOW_SEC` after the head; NOT CHECKED under `MIN_CAPTURE_SECONDS`; NOT CHECKED
 * no-signal when the head is longer than `MAX_HEAD_SEC`, the whole capture included.
 */
export function judgeCaptureGaps(
  zeroRuns: readonly ZeroRun[],
  duplicates: readonly number[],
  headZeros: number,
  durationSec: number,
  sampleRate: number,
): CaptureGapsJudgement {
  const windowEnd = headZeros + START_WINDOW_SEC * sampleRate;
  const afterHead = zeroRuns.filter((run) => run.start >= headZeros);
  const repeatsAfterHead = duplicates.filter((start) => start >= headZeros);
  const startZeroRuns = afterHead.filter((run) => run.start < windowEnd);
  const runs = afterHead.filter((run) => run.start >= windowEnd);
  const startDuplicates = repeatsAfterHead.filter((start) => start < windowEnd);
  const repeats = repeatsAfterHead.filter((start) => start >= windowEnd);
  const verdict: CaptureGapsVerdict =
    durationSec < MIN_CAPTURE_SECONDS ? "NOT CHECKED"
    : headZeros > MAX_HEAD_SEC * sampleRate ? "NOT CHECKED no-signal"
    : runs.length > 0 || repeats.length > 0 ? "GAPS"
    : startZeroRuns.length > 0 || startDuplicates.length > 0 ? "START GAPS"
    : "CLEAN";
  return {
    verdict,
    zeroRunCount: runs.length,
    longestRunFrames: runs.reduce((longest, run) => Math.max(longest, run.length), 0),
    duplicateCount: repeats.length,
    zeroRuns: runs,
    duplicates: repeats,
    startZeroRuns,
    startDuplicates,
  };
}

/** What became of the capture's source while it ran. */
export interface SourceHealth {
  /** The track fired `ended`, or read `readyState === "ended"` at the end. */
  ended: boolean;
  /** The track fired `mute`, or read `muted` at the start or the end. */
  muted: boolean;
  /** Render quanta whose input had no channel: the recorder wrote zeros for them. */
  emptyQuanta: number;
}

/** Why the source's zeros are not the browser's, the worst first; null for a healthy source. */
export function sourceProblem(health: SourceHealth): "source-ended" | "source-muted" | "source-empty-input" | null {
  if (health.ended) return "source-ended";
  if (health.muted) return "source-muted";
  if (health.emptyQuanta > 0) return "source-empty-input";
  return null;
}

/**
 * The run's verdict, by precedence: a failed step (`NOT CHECKED <step>`), then a source problem,
 * then the judgement (its bare `NOT CHECKED` names the seconds captured).
 */
export function captureVerdict(
  judged: CaptureGapsJudgement,
  failedStep: string | null,
  health: SourceHealth,
  captureSeconds: number,
): Verdict {
  if (failedStep !== null) return notChecked(failedStep);
  const problem = sourceProblem(health);
  if (problem !== null) return notChecked(problem);
  if (judged.verdict === "NOT CHECKED") return notChecked(`${captureSeconds.toFixed(1)}-s`);
  return judged.verdict;
}
