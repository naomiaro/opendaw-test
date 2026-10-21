/**
 * What `initializeOpenDAW` hands to the SDK's `AnimationFrame.start` instead of `window`: an
 * owner whose `requestAnimationFrame` is the real one while the page is visible and a worker
 * tick while the page is hidden and the transport active. Chrome stops animation frames for a
 * hidden document and a fully covered window; the engine's main-thread sync (the position,
 * the recording flags, take management) runs on them, so without this a take begun or
 * stopped behind another tab or window never finalized. The rules live in `frameScheduler.ts`.
 */
import { createFrameScheduler } from "./frameScheduler";
import { createWorkerTicker, type WorkerTicker } from "./workerTicker";

/** The frame guard in lib-dom drops a callback within 16 ms of the last accepted one; 20 ms clears it. */
export const HIDDEN_TICK_MS = 20;
/** How long the ticks keep coming after the transport went idle, or after a transport request. */
export const HIDDEN_GRACE_MS = 2000;

export interface HiddenSafeFrameDriver {
  requestAnimationFrame(cb: (t: number) => void): number;
  cancelAnimationFrame(id: number): void;
  /** The engine's playing / recording / counting-in flags changed. */
  activityChanged(): void;
  /** A transport request was issued (play, stop, record, position, clip scheduling). */
  transportRequested(): void;
  terminate(): void;
}

/** The globals the driver binds to, injectable so the binding is testable without a DOM. */
export interface HiddenSafeFrameDriverDeps {
  doc: {
    readonly visibilityState: DocumentVisibilityState;
    addEventListener(type: "visibilitychange", fn: () => void): void;
    removeEventListener(type: "visibilitychange", fn: () => void): void;
  };
  win: {
    requestAnimationFrame(cb: (t: number) => void): number;
    cancelAnimationFrame(id: number): void;
  };
  now(): number;
  createTicker(intervalMs: number): WorkerTicker;
}

const browserDeps = (): HiddenSafeFrameDriverDeps => ({
  doc: document,
  win: { requestAnimationFrame: (cb) => window.requestAnimationFrame(cb), cancelAnimationFrame: (id) => window.cancelAnimationFrame(id) },
  now: () => performance.now(),
  createTicker: createWorkerTicker,
});

export function createHiddenSafeFrameDriver(
  isActive: () => boolean,
  deps: HiddenSafeFrameDriverDeps = browserDeps(),
): HiddenSafeFrameDriver {
  let ticker: WorkerTicker | null = null;
  let tickId = 0;
  let pendingTick: { id: number; cb: (t: number) => void } | null = null;
  let tickSub: { terminate(): void } | null = null;
  // The worker lives only while a tick is pending: a hidden idle page runs no timer at all.
  const releaseTickerIfIdle = (): void => {
    if (pendingTick !== null) return;
    tickSub?.terminate();
    tickSub = null;
    ticker?.terminate();
    ticker = null;
  };
  const onTick = (): void => {
    const entry = pendingTick;
    if (entry === null) return;
    pendingTick = null;
    entry.cb(deps.now());
    releaseTickerIfIdle();
  };
  const scheduler = createFrameScheduler({
    isHidden: () => deps.doc.visibilityState === "hidden",
    isActive,
    now: () => deps.now(),
    graceMs: HIDDEN_GRACE_MS,
    requestFrame: (cb) => deps.win.requestAnimationFrame(cb),
    cancelFrame: (id) => deps.win.cancelAnimationFrame(id),
    requestTick: (cb) => {
      ticker ??= deps.createTicker(HIDDEN_TICK_MS);
      tickSub ??= ticker.subscribe(onTick);
      pendingTick = { id: ++tickId, cb };
      return pendingTick.id;
    },
    cancelTick: (id) => {
      if (pendingTick?.id === id) pendingTick = null;
      releaseTickerIfIdle();
    },
  });
  const onVisibility = (): void => scheduler.visibilityChanged();
  deps.doc.addEventListener("visibilitychange", onVisibility);
  return {
    requestAnimationFrame: (cb) => scheduler.requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => scheduler.cancelAnimationFrame(id),
    activityChanged: () => scheduler.activityChanged(),
    transportRequested: () => scheduler.transportRequested(),
    terminate: () => {
      deps.doc.removeEventListener("visibilitychange", onVisibility);
      pendingTick = null;
      releaseTickerIfIdle();
    },
  };
}
