/**
 * Chrome can bring a frozen page back (Page Lifecycle `freeze` → `resume`, which it does to
 * background tabs) with a context that hosts an AudioWorkletNode advancing `currentTime` at
 * about half speed (Chromium 575891839, comment #3): playback slowed, lower and distorted until
 * a reload. Unlike a back/forward-cache restore, a resumed page keeps whatever the visitor had
 * on it (unexported takes included), so this check does not reload: on `resume` it measures the
 * context clock against the wall clock, and only when the clock is slow it tells the page,
 * which shows a notice and leaves the reload to the visitor.
 *
 * `docs/known-vendor-issues.md`, the Chromium section, has the entry; the probe is
 * `chromium-watched-issues-debug-demo.html?issue=freeze`.
 */
import type { Terminable } from "@opendaw/lib-std";

/** The parts of an AudioContext the check reads. */
export interface ClockSource {
  readonly currentTime: number;
  readonly state: string;
}

/** The clock and timer the check runs on; injected so tests drive them. */
export interface CheckTiming {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
}

/** Time to let the clock settle after the resume before the window opens: a stall there is not a slow clock. */
export const SETTLE_MS = 500;
export const WINDOW_MS = 1000;
/** Below this the clock is slow: the tracker reads 0.50; a true clock reads about 1. */
export const SLOW_RATIO = 0.75;

export interface ClockWindow {
  contextAdvanceSec: number;
  wallAdvanceSec: number;
  /** The context state at the window's start and end: a suspended context's clock stands still on purpose. */
  runningAtStart: boolean;
  runningAtEnd: boolean;
}

export type ResumedClock = { kind: "slow"; ratio: number } | { kind: "true"; ratio: number } | { kind: "unknown" };

export function judgeResumedClock(window: ClockWindow): ResumedClock {
  if (!window.runningAtStart || !window.runningAtEnd || window.wallAdvanceSec <= 0) return { kind: "unknown" };
  const ratio = window.contextAdvanceSec / window.wallAdvanceSec;
  return ratio < SLOW_RATIO ? { kind: "slow", ratio } : { kind: "true", ratio };
}

const browserTiming: CheckTiming = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
};

/**
 * On every `resume` of `page`, measure `context` for `WINDOW_MS` after `SETTLE_MS` and call
 * `onSlow` with the ratio when the clock runs slow. One check at a time; a resume during a check
 * is covered by it.
 */
export function installFreezeClockCheck(
  page: EventTarget,
  context: ClockSource,
  onSlow: (ratio: number) => void,
  timing: CheckTiming = browserTiming
): Terminable {
  let checking = false;
  let terminated = false;
  const onResume = (): void => {
    if (checking || context.state !== "running") return;
    checking = true;
    timing.setTimeout(() => {
      const contextStart = context.currentTime;
      const wallStart = timing.now();
      const runningAtStart = context.state === "running";
      timing.setTimeout(() => {
        checking = false;
        if (terminated) return;
        const judged = judgeResumedClock({
          contextAdvanceSec: context.currentTime - contextStart,
          wallAdvanceSec: (timing.now() - wallStart) / 1000,
          runningAtStart,
          runningAtEnd: context.state === "running",
        });
        if (judged.kind === "slow") onSlow(judged.ratio);
      }, WINDOW_MS);
    }, SETTLE_MS);
  };
  page.addEventListener("resume", onResume);
  return {
    terminate: () => {
      terminated = true;
      page.removeEventListener("resume", onResume);
    },
  };
}
