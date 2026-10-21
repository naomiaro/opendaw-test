/**
 * Decides where a frame request goes: to the real animation frame while the page is visible,
 * to a worker tick while it is hidden and the transport active, or nowhere while it is hidden
 * and idle. Pure: every clock, flag and scheduler is injected, so the rules are tested in Node.
 * The hidden-safe driver (`hiddenSafeFrameDriver.ts`) binds it to the page.
 *
 * Why the request gate: the engine's own flags (playing, recording, counting in) reach the
 * page through the sync these ticks pump, so a page hidden and idle when a transport request
 * arrives would never see the flag flip and never tick. A request counts as activity for the
 * grace period, by which time the engine's flag has arrived through the ticks it started.
 */
export interface FrameSchedulerDeps {
  isHidden(): boolean;
  isActive(): boolean;
  now(): number;
  requestFrame(cb: (t: number) => void): number;
  cancelFrame(id: number): void;
  requestTick(cb: (t: number) => void): number;
  cancelTick(id: number): void;
  /** How long after the last observed activity, or the last transport request, the ticks keep coming. */
  graceMs: number;
}

export interface FrameScheduler {
  requestAnimationFrame(cb: (t: number) => void): number;
  cancelAnimationFrame(id: number): void;
  visibilityChanged(): void;
  activityChanged(): void;
  transportRequested(): void;
}

type Where = "frame" | "tick" | "parked";

interface Pending {
  cb: (t: number) => void;
  where: Where;
  underlying: number | null;
}

export function createFrameScheduler(deps: FrameSchedulerDeps): FrameScheduler {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let lastActiveAt = Number.NEGATIVE_INFINITY;

  const active = (): boolean => {
    const now = deps.now();
    if (deps.isActive()) lastActiveAt = now;
    return now - lastActiveAt <= deps.graceMs;
  };

  const target = (): Where => (!deps.isHidden() ? "frame" : active() ? "tick" : "parked");

  const place = (id: number, entry: Pending, where: Where): void => {
    entry.where = where;
    const fire = (t: number): void => {
      if (pending.get(id) !== entry) return;
      pending.delete(id);
      entry.cb(t);
    };
    entry.underlying = where === "frame" ? deps.requestFrame(fire) : where === "tick" ? deps.requestTick(fire) : null;
  };

  const unplace = (entry: Pending): void => {
    if (entry.underlying === null) return;
    if (entry.where === "frame") deps.cancelFrame(entry.underlying);
    else if (entry.where === "tick") deps.cancelTick(entry.underlying);
    entry.underlying = null;
  };

  const replaceAll = (): void => {
    const where = target();
    for (const [id, entry] of pending) {
      if (entry.where === where) continue;
      unplace(entry);
      place(id, entry, where);
    }
  };

  return {
    requestAnimationFrame(cb) {
      const id = nextId++;
      const entry: Pending = { cb, where: "parked", underlying: null };
      pending.set(id, entry);
      place(id, entry, target());
      return id;
    },
    cancelAnimationFrame(id) {
      const entry = pending.get(id);
      if (entry === undefined) return;
      unplace(entry);
      pending.delete(id);
    },
    visibilityChanged: replaceAll,
    activityChanged: replaceAll,
    transportRequested() {
      lastActiveAt = deps.now();
      replaceAll();
    },
  };
}
