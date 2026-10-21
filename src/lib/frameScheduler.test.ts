import { describe, expect, it } from "vitest";
import { createFrameScheduler, createThrottledFrames, type FrameSchedulerDeps } from "./frameScheduler";

function harness(opts: { hidden?: boolean; active?: boolean; graceMs?: number } = {}) {
  let hidden = opts.hidden ?? false;
  let active = opts.active ?? true;
  let now = 0;
  const frames = new Map<number, (t: number) => void>();
  const ticks = new Map<number, (t: number) => void>();
  let nextId = 100;
  const deps: FrameSchedulerDeps = {
    isHidden: () => hidden, isActive: () => active, now: () => now, graceMs: opts.graceMs ?? 2000,
    requestFrame: (cb) => { const id = nextId++; frames.set(id, cb); return id; },
    cancelFrame: (id) => { frames.delete(id); },
    requestTick: (cb) => { const id = nextId++; ticks.set(id, cb); return id; },
    cancelTick: (id) => { ticks.delete(id); },
  };
  const s = createFrameScheduler(deps);
  const fireFrames = () => { const cbs = [...frames.values()]; frames.clear(); cbs.forEach((cb) => cb(now)); };
  const fireTicks = () => { const cbs = [...ticks.values()]; ticks.clear(); cbs.forEach((cb) => cb(now)); };
  return {
    s, frames, ticks, fireFrames, fireTicks,
    setHidden: (h: boolean) => { hidden = h; s.visibilityChanged(); },
    setActive: (a: boolean) => { active = a; s.activityChanged(); },
    advance: (ms: number) => { now += ms; },
  };
}

describe("createFrameScheduler", () => {
  it("sends a visible request to the real frame and a hidden active one to the tick", () => {
    const v = harness(); let fired = 0;
    v.s.requestAnimationFrame(() => fired++);
    expect(v.frames.size).toBe(1); expect(v.ticks.size).toBe(0);
    v.fireFrames(); expect(fired).toBe(1);
    const h = harness({ hidden: true });
    h.s.requestAnimationFrame(() => fired++);
    expect(h.ticks.size).toBe(1); expect(h.frames.size).toBe(0);
  });
  it("moves a pending request to the tick when the page hides, and back on the reverse move, firing once", () => {
    const v = harness(); let fired = 0;
    v.s.requestAnimationFrame(() => fired++);
    v.setHidden(true);
    expect(v.frames.size).toBe(0); expect(v.ticks.size).toBe(1);
    v.setHidden(false);
    expect(v.ticks.size).toBe(0); expect(v.frames.size).toBe(1);
    v.fireFrames(); v.fireTicks();
    expect(fired).toBe(1);
  });
  it("cancels across the move by the scheduler's own id", () => {
    const v = harness();
    const id = v.s.requestAnimationFrame(() => { throw new Error("must not fire"); });
    v.setHidden(true);
    v.s.cancelAnimationFrame(id);
    expect(v.ticks.size).toBe(0); expect(v.frames.size).toBe(0);
  });
  it("parks a hidden idle request, keeps ticking through the grace period, and resumes on activity", () => {
    const h = harness({ hidden: true, active: true, graceMs: 2000 });
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(1);
    h.setActive(false);
    h.advance(500); h.fireTicks();
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(1); // still inside the grace period
    h.advance(2000); h.fireTicks();
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(0); // parked: idle past the grace
    h.setActive(true);
    expect(h.ticks.size).toBe(1); // activity resumes the parked request
  });
  it("resumes a parked request on a transport request while hidden and idle, before the engine's flag can arrive", () => {
    const h = harness({ hidden: true, active: false, graceMs: 2000 });
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(0); // parked: hidden and idle
    h.s.transportRequested();
    expect(h.ticks.size).toBe(1); // the request counts as activity
    h.advance(1000); h.fireTicks();
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(1); // still inside the request grace, the flag not yet observed
    h.advance(2000); h.fireTicks();
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(0); // the grace passed with the engine still idle: parked again
  });
  it("gives every request a distinct id and passes the clock to the callback", () => {
    const v = harness(); let seen = -1;
    const a = v.s.requestAnimationFrame((t) => { seen = t; });
    const b = v.s.requestAnimationFrame(() => {});
    expect(a).not.toBe(b);
    v.advance(16.7); v.fireFrames();
    expect(seen).toBeCloseTo(16.7, 6);
  });
});

describe("createThrottledFrames", () => {
  it("delivers every Nth underlying frame with that frame's timestamp, and a cancel by id after an intermediate frame drops the pending underlying request", () => {
    const frames = new Map<number, (t: number) => void>();
    let nextId = 100;
    const t = createThrottledFrames(3, {
      requestFrame: (cb) => { const id = nextId++; frames.set(id, cb); return id; },
      cancelFrame: (id) => { frames.delete(id); },
    });
    const fireOne = (ts: number) => { const [id, cb] = [...frames.entries()][0]; frames.delete(id); cb(ts); };
    const seen: number[] = [];
    t.requestAnimationFrame((ts) => seen.push(ts));
    for (let i = 1; i <= 3; i++) fireOne(i * 8.33);
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeCloseTo(24.99, 6);
    const second = t.requestAnimationFrame((ts) => seen.push(ts));
    fireOne(4 * 8.33);
    t.cancelAnimationFrame(second);
    expect(frames.size).toBe(0);
    expect(seen.length).toBe(1);
  });
});
