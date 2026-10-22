/**
 * Chromium 575891839: a document with a running AudioContext and an AudioWorkletNode,
 * restored from the back/forward cache, keeps `state: running` but advances `currentTime`
 * at about half wall-clock speed. This file holds the judgement, pure and Node-testable;
 * the browser half is `chromiumBfcacheProbe.ts`.
 */

/** One measurement window: how far the context clock and the wall clock moved over it. */
export interface ClockRatioSample {
  /** `context.currentTime` at the end minus at the start. */
  contextAdvanceSec: number;
  /** `performance.now()` at the end minus at the start, in seconds. */
  wallAdvanceSec: number;
}

export type BfcacheVerdict = "HALF SPEED" | "NORMAL" | "NOT CHECKED";

export interface BfcacheJudgement {
  verdict: BfcacheVerdict;
  ratioBefore: number;
  /** The clock's speed over the windows after the first: the speed it settled at. */
  ratioAfter: number | null;
  /** Every window's ratio after the restore, the first included; empty when there were none. */
  windowRatios: number[];
  /** Why the restore was not judged: the not-restored reasons, or a short word; null when judged. */
  reason: string | null;
}

/** Below this the clock before leaving is already wrong, and nothing after it can be judged against it. */
export const BASELINE_MIN_RATIO = 0.9;

/** Below this after the restore the clock has slowed: the tracker's figure is 0.501. */
export const HALF_SPEED_MAX_RATIO = 0.75;

/**
 * The restore is measured in consecutive windows and judged on all but the first, so a
 * clock that stalls while it resumes and then runs true is not read as a slow one.
 */
export const RESTORE_WINDOWS = 3;
export const RESTORE_WINDOW_SECONDS = 1;

/** The context clock's speed against the wall clock: 1 is true. */
export function clockRatio(sample: ClockRatioSample): number {
  return sample.contextAdvanceSec / sample.wallAdvanceSec;
}

export function judgeBfcache(
  before: ClockRatioSample,
  after: ClockRatioSample[] | null,
  persisted: boolean,
  notRestoredReasons: string | null
): BfcacheJudgement {
  const ratioBefore = clockRatio(before);
  const windowRatios = after === null ? [] : after.map(clockRatio);
  const settled = after === null ? [] : after.slice(1);
  const ratioAfter =
    settled.length === 0 ? null
    : clockRatio({
        contextAdvanceSec: settled.reduce((sum, w) => sum + w.contextAdvanceSec, 0),
        wallAdvanceSec: settled.reduce((sum, w) => sum + w.wallAdvanceSec, 0),
      });
  const notChecked = (reason: string): BfcacheJudgement => ({
    verdict: "NOT CHECKED",
    ratioBefore,
    ratioAfter,
    windowRatios,
    reason,
  });
  if (!persisted) return notChecked(notRestoredReasons ?? "not-restored, no reasons reported");
  if (after === null) return notChecked("no-measurement-after-restore");
  if (ratioAfter === null) return notChecked("too-few-windows");
  if (ratioBefore < BASELINE_MIN_RATIO) return notChecked("baseline-slow");
  const verdict: BfcacheVerdict = ratioAfter < HALF_SPEED_MAX_RATIO ? "HALF SPEED" : "NORMAL";
  return { verdict, ratioBefore, ratioAfter, windowRatios, reason: null };
}
