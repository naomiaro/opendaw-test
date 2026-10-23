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
// With `&stallMs`, the render thread is held at known frames; runs and duplicates after the start
// window that start in a stall's span are reported apart and named in the detail, the verdict word
// unchanged. The span runs from one quantum before the stall frame to twice the stall's length and
// one quantum after it: the render thread catches the stall up after it, and the sink's FIFO
// underruns while it does (measured: the zeros start about 48 ms into an 80 ms stall's catch-up).

import { notChecked, type Verdict } from "./chromiumWatched";
import { clockRatio } from "./chromiumBfcache";

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
  /** Of `zeroRuns` and `duplicates`, those starting in a stall's span (`atStall`). */
  stallZeroRuns: ZeroRun[];
  stallDuplicates: number[];
  /** How many runs and duplicates coincide with a stall; null when the run had no stalls. */
  detail: string | null;
}

/** True when `start` lies in a stall's span: one quantum before its frame to two stall lengths and one quantum after. */
function atStall(start: number, stallFrames: readonly number[], stallLengthFrames: number): boolean {
  return stallFrames.some((frame) => start >= frame - QUANTUM_FRAMES && start <= frame + 2 * stallLengthFrames + QUANTUM_FRAMES);
}

/** The frames from the latest stall at or before `start` to it; null when no stall came before. */
export function sinceLastStall(start: number, stallFrames: readonly number[]): number | null {
  let latest: number | null = null;
  for (const frame of stallFrames) if (frame <= start && (latest === null || frame > latest)) latest = frame;
  return latest === null ? null : start - latest;
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
  stallFrames: readonly number[] = [],
  stallLengthFrames: number = 0,
): CaptureGapsJudgement {
  const windowEnd = headZeros + START_WINDOW_SEC * sampleRate;
  const afterHead = zeroRuns.filter((run) => run.start >= headZeros);
  const repeatsAfterHead = duplicates.filter((start) => start >= headZeros);
  const startZeroRuns = afterHead.filter((run) => run.start < windowEnd);
  const runs = afterHead.filter((run) => run.start >= windowEnd);
  const startDuplicates = repeatsAfterHead.filter((start) => start < windowEnd);
  const repeats = repeatsAfterHead.filter((start) => start >= windowEnd);
  const stallZeroRuns = runs.filter((run) => atStall(run.start, stallFrames, stallLengthFrames));
  const stallDuplicates = repeats.filter((start) => atStall(start, stallFrames, stallLengthFrames));
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
    stallZeroRuns,
    stallDuplicates,
    detail:
      stallFrames.length === 0 ? null
      : `${stallZeroRuns.length} of ${runs.length} zero runs at stall times; ` +
        `${stallDuplicates.length} of ${repeats.length} duplicates at stall times`,
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

/** The capture context's `latencyHint`: seconds above 0, or a category word. */
export type LatencyHint = number | "interactive" | "balanced" | "playback";

/** The hint named by `&latencyHint=`; "interactive" without one; throws on anything else. */
export function latencyHintFrom(value: string | null): LatencyHint {
  if (value === null) return "interactive";
  if (value === "interactive" || value === "balanced" || value === "playback") return value;
  const seconds = Number(value);
  if (value.trim() !== "" && Number.isFinite(seconds) && seconds > 0) return seconds;
  throw new Error(`&latencyHint=${value}: expected seconds above 0, interactive, balanced or playback`);
}

/** Each length in units of 480 frames (10 ms at 48 kHz, the tracker's hole size), two decimals. */
export function lengthsIn480s(lengths: readonly number[]): string {
  return lengths.map((length) => String(Number((length / 480).toFixed(2)))).join(" ");
}

/** The RMS of the frames after the head; 0 when there are none. */
export function rmsAfterHead(frames: Float32Array, headZeros: number): number {
  const count = frames.length - headZeros;
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = headZeros; i < frames.length; i++) sum += frames[i] * frames[i];
  return Math.sqrt(sum / count);
}

/** The first input whose label holds `text` (any case), the "default" and "communications" aliases skipped. */
export function matchInput<T extends { deviceId: string; label: string }>(inputs: readonly T[], text: string): T | null {
  const wanted = text.toLowerCase();
  return (
    inputs.find(
      (input) => input.deviceId !== "default" && input.deviceId !== "communications" && input.label.toLowerCase().includes(wanted),
    ) ?? null
  );
}

/** The runs starting within `windowFrames` either side of `markFrame`. */
export function runsNearMark(runs: readonly ZeroRun[], markFrame: number, windowFrames: number): ZeroRun[] {
  return runs.filter((run) => Math.abs(run.start - markFrame) <= windowFrames);
}

/** One clock reading: `context.currentTime` and `performance.now()`, both in seconds. */
export interface ClockReading {
  contextSec: number;
  wallSec: number;
}

/** The context clock's advance over the wall clock's, per interval between consecutive readings. */
export function clockRatios(readings: readonly ClockReading[]): number[] {
  const ratios: number[] = [];
  for (let i = 1; i < readings.length; i++) {
    ratios.push(
      clockRatio({
        contextAdvanceSec: readings[i].contextSec - readings[i - 1].contextSec,
        wallAdvanceSec: readings[i].wallSec - readings[i - 1].wallSec,
      }),
    );
  }
  return ratios;
}

/** A per-second clock ratio under this is a dip. */
export const CLOCK_DIP_RATIO = 0.75;

/** The seconds (from 1) whose clock ratio is under `CLOCK_DIP_RATIO`. */
export function clockDipSeconds(ratios: readonly number[]): number[] {
  return ratios.flatMap((ratio, i) => (ratio < CLOCK_DIP_RATIO ? [i + 1] : []));
}

/** The run's detail: the stall coincidence, the zero runs near the 30 s mark, the clock dips; null when empty. */
export function captureDetail(stallDetail: string | null, nearMark: readonly ZeroRun[], dips: readonly number[]): string | null {
  const parts: string[] = [];
  if (stallDetail !== null) parts.push(stallDetail);
  if (nearMark.length > 0) parts.push(`${nearMark.length} zero runs within 2 s of the 30 s mark`);
  if (dips.length > 0) parts.push(`clock under ${CLOCK_DIP_RATIO} in second ${dips.join(", ")}`);
  return parts.length === 0 ? null : parts.join("; ");
}

/** The capture length named by `&seconds=`: whole seconds from 30 to 600; 60 without one. */
export function secondsFrom(value: string | null): number {
  if (value === null) return 60;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 600) throw new Error(`&seconds=${value}: expected whole seconds from 30 to 600`);
  return seconds;
}
