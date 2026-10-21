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

export function createHiddenSafeFrameDriver(isActive: () => boolean): HiddenSafeFrameDriver {
  let ticker: WorkerTicker | null = null;
  let tickId = 0;
  let pendingTick: { id: number; cb: (t: number) => void } | null = null;
  let tickSub: { terminate(): void } | null = null;
  const onTick = (): void => {
    const entry = pendingTick;
    if (entry === null) return;
    pendingTick = null;
    entry.cb(performance.now());
  };
  const scheduler = createFrameScheduler({
    isHidden: () => document.visibilityState === "hidden",
    isActive,
    now: () => performance.now(),
    graceMs: HIDDEN_GRACE_MS,
    requestFrame: (cb) => window.requestAnimationFrame(cb),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    requestTick: (cb) => {
      ticker ??= createWorkerTicker(HIDDEN_TICK_MS);
      tickSub ??= ticker.subscribe(onTick);
      pendingTick = { id: ++tickId, cb };
      return pendingTick.id;
    },
    cancelTick: (id) => {
      if (pendingTick?.id === id) pendingTick = null;
    },
  });
  const onVisibility = (): void => scheduler.visibilityChanged();
  document.addEventListener("visibilitychange", onVisibility);
  return {
    requestAnimationFrame: (cb) => scheduler.requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => scheduler.cancelAnimationFrame(id),
    activityChanged: () => scheduler.activityChanged(),
    transportRequested: () => scheduler.transportRequested(),
    terminate: () => {
      document.removeEventListener("visibilitychange", onVisibility);
      tickSub?.terminate();
      tickSub = null;
      ticker?.terminate();
      ticker = null;
      pendingTick = null;
    },
  };
}
