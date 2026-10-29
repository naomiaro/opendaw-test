/**
 * Chrome can bring a frozen page back (Page Lifecycle `freeze` → `resume`, which it does to
 * background tabs) with a context that hosts an AudioWorkletNode advancing `currentTime` at
 * about half speed (Chromium 575891839, comment #3): playback slowed, lower and distorted until
 * a reload. Unlike a back/forward-cache restore, a resumed page keeps whatever the visitor had
 * on it (unexported takes included), so this check does not reload: on `resume` it measures the
 * context clock against the wall clock, and only when the clock is slow it tells the page,
 * which shows a notice and leaves the reload to the visitor.
 *
 * Scope: it runs on `resume` only. A renderer stopped and restarted some other way (system sleep,
 * a paused hidden window) fires no Page Lifecycle event and is not checked.
 *
 * `docs/known-vendor-issues.md`, the Chromium section, has the entry; the probe is
 * `chromium-watched-issues-debug-demo.html?issue=freeze`.
 */
import type { Terminable } from "@opendaw/lib-std";

/** The parts of an AudioContext the check reads: its clock, its state and the event that says the state changed. */
export interface ClockSource extends EventTarget {
  readonly currentTime: number;
  readonly state: string;
}

/** The clock and timer the check runs on; injected so tests drive them. */
export interface CheckTiming {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
}

/** Time to let the clock settle after it starts running again before the windows open: a stall there is not a slow clock. */
export const SETTLE_MS = 500;
export const WINDOW_MS = 1000;
/** Both windows must read slow: one window can catch a device that is still reopening. */
export const WINDOWS = 2;
/** Below this the clock is slow: the tracker reads 0.50; a true clock reads about 1. */
export const SLOW_RATIO = 0.75;

export interface ClockWindow {
  contextAdvanceSec: number;
  wallAdvanceSec: number;
  /** The context state at the window's start and end: a suspended context's clock stands still on purpose. */
  runningAtStart: boolean;
  runningAtEnd: boolean;
}

export type ResumedClock = { kind: "slow"; ratio: number } | { kind: "true"; ratio: number } | { kind: "unknown"; why: string };

export function judgeResumedClock(window: ClockWindow): ResumedClock {
  if (!window.runningAtStart || !window.runningAtEnd) {
    return { kind: "unknown", why: `runningAtStart=${window.runningAtStart} runningAtEnd=${window.runningAtEnd}` };
  }
  if (window.wallAdvanceSec <= 0) return { kind: "unknown", why: `wall=${window.wallAdvanceSec}s` };
  const ratio = window.contextAdvanceSec / window.wallAdvanceSec;
  return ratio < SLOW_RATIO ? { kind: "slow", ratio } : { kind: "true", ratio };
}

/** The clock is slow only when every window is: the reported ratio is the faster of them. */
export function judgeWindows(windows: readonly ClockWindow[]): ResumedClock {
  const judged = windows.map(judgeResumedClock);
  const unknown = judged.find((j) => j.kind === "unknown");
  if (unknown !== undefined) return unknown;
  const ratios = judged.map((j) => (j.kind === "unknown" ? NaN : j.ratio));
  const fastest = Math.max(...ratios);
  return judged.every((j) => j.kind === "slow") ? { kind: "slow", ratio: fastest } : { kind: "true", ratio: fastest };
}

const browserTiming: CheckTiming = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
};

const log = (message: string): void => console.debug(`[freeze-clock-check] ${message}`);

/**
 * On every `resume` of `page`, wait for `context` to be running, let it settle for `SETTLE_MS`,
 * measure `WINDOWS` windows of `WINDOW_MS`, and call `onSlow` with the ratio when every window
 * reads slow. A `freeze` cancels a check in progress (its windows would span the freeze), and the
 * next `resume` starts a new one. Every outcome logs one line. Installed for the page's lifetime,
 * like the back/forward-cache guard; the handle is for tests.
 */
export function installFreezeClockCheck(
  page: EventTarget,
  context: ClockSource,
  onSlow: (ratio: number) => void,
  timing: CheckTiming = browserTiming
): Terminable {
  let generation = 0;
  let waitingForRunning: (() => void) | null = null;
  const stopWaiting = (): void => {
    if (waitingForRunning === null) return;
    context.removeEventListener("statechange", waitingForRunning);
    waitingForRunning = null;
  };

  const measure = (check: number, windows: ClockWindow[]): void => {
    const contextStart = context.currentTime;
    const wallStart = timing.now();
    const runningAtStart = context.state === "running";
    timing.setTimeout(() => {
      if (check !== generation) return;
      windows.push({
        contextAdvanceSec: context.currentTime - contextStart,
        wallAdvanceSec: (timing.now() - wallStart) / 1000,
        runningAtStart,
        runningAtEnd: context.state === "running",
      });
      if (windows.length < WINDOWS) return measure(check, windows);
      const judged = judgeWindows(windows);
      const ratios = windows.map((w) => (w.contextAdvanceSec / w.wallAdvanceSec).toFixed(3)).join(" / ");
      if (judged.kind === "unknown") return log(`unknown (${judged.why}; ratios ${ratios})`);
      log(`${judged.kind} (ratios ${ratios})`);
      if (judged.kind === "slow") onSlow(judged.ratio);
    }, WINDOW_MS);
  };

  const start = (check: number): void => {
    timing.setTimeout(() => {
      if (check === generation) measure(check, []);
    }, SETTLE_MS);
  };

  const onResume = (): void => {
    const check = ++generation;
    stopWaiting();
    if (context.state === "running") return start(check);
    log(`resume: context ${context.state}, checking once it runs`);
    const onStateChange = (): void => {
      if (check !== generation || context.state !== "running") return;
      stopWaiting();
      start(check);
    };
    waitingForRunning = onStateChange;
    context.addEventListener("statechange", onStateChange);
  };

  const onFreeze = (): void => {
    generation++;
    stopWaiting();
  };

  page.addEventListener("resume", onResume);
  page.addEventListener("freeze", onFreeze);
  return {
    terminate: () => {
      generation++;
      stopWaiting();
      page.removeEventListener("resume", onResume);
      page.removeEventListener("freeze", onFreeze);
    },
  };
}
