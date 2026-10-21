import { describe, expect, it } from "vitest";
import { createHiddenSafeFrameDriver, HIDDEN_GRACE_MS, type HiddenSafeFrameDriverDeps } from "./hiddenSafeFrameDriver";
import type { WorkerTicker } from "./workerTicker";

function fakeTicker() {
  const subs = new Set<() => void>();
  const t = {
    terminated: false,
    fire: () => { for (const fn of [...subs]) fn(); },
    ticker: {
      subscribe: (fn: () => void) => { subs.add(fn); return { terminate: () => { subs.delete(fn); } }; },
      terminate: () => { t.terminated = true; subs.clear(); },
    } satisfies WorkerTicker,
  };
  return t;
}

function harness(opts: { hidden?: boolean; active?: boolean } = {}) {
  let visibility: "visible" | "hidden" = opts.hidden ? "hidden" : "visible";
  let active = opts.active ?? true;
  let now = 0;
  const listeners = new Set<() => void>();
  const frames = new Map<number, (t: number) => void>();
  let nextFrameId = 500;
  const tickers: ReturnType<typeof fakeTicker>[] = [];
  const deps: HiddenSafeFrameDriverDeps = {
    doc: {
      get visibilityState() { return visibility; },
      addEventListener: (_type: string, fn: () => void) => { listeners.add(fn); },
      removeEventListener: (_type: string, fn: () => void) => { listeners.delete(fn); },
    },
    win: {
      requestAnimationFrame: (cb) => { const id = nextFrameId++; frames.set(id, cb); return id; },
      cancelAnimationFrame: (id) => { frames.delete(id); },
    },
    now: () => now,
    createTicker: () => { const t = fakeTicker(); tickers.push(t); return t.ticker; },
  };
  const driver = createHiddenSafeFrameDriver(() => active, deps);
  return {
    driver, frames, tickers, listeners,
    fireFrames: () => { const cbs = [...frames.values()]; frames.clear(); cbs.forEach((cb) => cb(now)); },
    fireTick: () => { tickers.at(-1)?.fire(); },
    setVisibility: (v: "visible" | "hidden") => { visibility = v; for (const fn of [...listeners]) fn(); },
    setActive: (a: boolean) => { active = a; driver.activityChanged(); },
    advance: (ms: number) => { now += ms; },
  };
}

describe("createHiddenSafeFrameDriver", () => {
  it("a hidden tick's callback can re-request from inside the tick, and the next tick fires it", () => {
    const h = harness({ hidden: true });
    let fired = 0;
    const exe = (): void => { h.driver.requestAnimationFrame(exe); fired++; };
    h.driver.requestAnimationFrame(exe);
    expect(h.tickers.length).toBe(1);
    h.fireTick(); expect(fired).toBe(1);
    h.fireTick(); expect(fired).toBe(2);
    expect(h.tickers[0].terminated).toBe(false);
  });
  it("releases the worker ticker when a tick's re-request parks after the grace, and makes a new one on the next request", () => {
    const h = harness({ hidden: true });
    const exe = (): void => { h.driver.requestAnimationFrame(exe); };
    h.driver.requestAnimationFrame(exe);
    h.setActive(false);
    h.advance(HIDDEN_GRACE_MS + 1);
    h.fireTick();
    expect(h.tickers[0].terminated).toBe(true);
    h.driver.transportRequested();
    expect(h.tickers.length).toBe(2);
    expect(h.tickers[1].terminated).toBe(false);
  });
  it("releases the worker ticker when the pending tick is cancelled", () => {
    const h = harness({ hidden: true });
    const id = h.driver.requestAnimationFrame(() => {});
    expect(h.tickers[0].terminated).toBe(false);
    h.driver.cancelAnimationFrame(id);
    expect(h.tickers[0].terminated).toBe(true);
  });
  it("a request parked while hidden and idle resumes on the real frame when the page is visible again", () => {
    const h = harness({ hidden: true, active: false });
    let fired = 0;
    h.driver.requestAnimationFrame(() => fired++);
    expect(h.tickers.length).toBe(0); expect(h.frames.size).toBe(0);
    h.setVisibility("visible");
    expect(h.frames.size).toBe(1);
    h.fireFrames(); expect(fired).toBe(1);
  });
  it("a visible idle page that hides parks without making a worker, and a hidden ticker is released when the page returns", () => {
    const idle = harness({ active: false });
    idle.driver.requestAnimationFrame(() => {});
    idle.setVisibility("hidden");
    expect(idle.tickers.length).toBe(0);
    const busy = harness({ hidden: true });
    busy.driver.requestAnimationFrame(() => {});
    busy.setVisibility("visible");
    expect(busy.tickers[0].terminated).toBe(true);
    expect(busy.frames.size).toBe(1);
  });
  it("terminate removes the visibility listener and the ticker", () => {
    const h = harness({ hidden: true });
    h.driver.requestAnimationFrame(() => {});
    h.driver.terminate();
    expect(h.listeners.size).toBe(0);
    expect(h.tickers[0].terminated).toBe(true);
  });
});
