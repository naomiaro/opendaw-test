/**
 * Chromium 575891839, comment #3: a page frozen and resumed (Page Lifecycle `freeze` →
 * `resume`, which Chrome does to background tabs and which `Page.setWebLifecycleState`
 * forces) comes back with a context that hosts an AudioWorkletNode advancing `currentTime`
 * at about half wall-clock speed, while a context with no worklet runs true. The judgement,
 * pure and Node-testable; the browser half is `chromiumFreezeProbe.ts`.
 */
import { BASELINE_MIN_RATIO, HALF_SPEED_MAX_RATIO, clockRatio, type ClockRatioSample } from "./chromiumBfcache";

export type FreezeVerdict = "HALF SPEED" | "NORMAL" | `NOT CHECKED ${string}`;

export interface FreezeRun {
  workletBefore: ClockRatioSample;
  controlBefore: ClockRatioSample;
  /** Did the document see `freeze`, then `resume`: the positive control that the condition was exercised. */
  froze: boolean;
  resumed: boolean;
  /** Consecutive windows after `resume`, the first included (judged on the rest). */
  workletAfter: ClockRatioSample[];
  controlAfter: ClockRatioSample[];
}

export interface FreezeJudgement {
  verdict: FreezeVerdict;
  workletRatioBefore: number;
  controlRatioBefore: number;
  /** The settled speed after the resume (every window but the first); null with fewer than two. */
  workletRatioAfter: number | null;
  controlRatioAfter: number | null;
}

/** The speed over every window but the first, as one window. */
function settledRatio(windows: readonly ClockRatioSample[]): number | null {
  const settled = windows.slice(1);
  if (settled.length === 0) return null;
  return clockRatio({
    contextAdvanceSec: settled.reduce((sum, w) => sum + w.contextAdvanceSec, 0),
    wallAdvanceSec: settled.reduce((sum, w) => sum + w.wallAdvanceSec, 0),
  });
}

export function judgeFreeze(run: FreezeRun): FreezeJudgement {
  const figures = {
    workletRatioBefore: clockRatio(run.workletBefore),
    controlRatioBefore: clockRatio(run.controlBefore),
    workletRatioAfter: settledRatio(run.workletAfter),
    controlRatioAfter: settledRatio(run.controlAfter),
  };
  const notChecked = (reason: string): FreezeJudgement => ({ verdict: `NOT CHECKED ${reason}`, ...figures });
  if (!run.froze) return notChecked("no-freeze");
  if (!run.resumed) return notChecked("no-resume");
  if (figures.workletRatioBefore < BASELINE_MIN_RATIO || figures.controlRatioBefore < BASELINE_MIN_RATIO) {
    return notChecked("baseline-slow");
  }
  if (figures.workletRatioAfter === null || figures.controlRatioAfter === null) return notChecked("too-few-windows");
  // Both slow is not this issue (a stalled device, a throttled renderer): the control has to run true.
  if (figures.controlRatioAfter < BASELINE_MIN_RATIO) return notChecked("control-slow");
  return { verdict: figures.workletRatioAfter < HALF_SPEED_MAX_RATIO ? "HALF SPEED" : "NORMAL", ...figures };
}
