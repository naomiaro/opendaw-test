import { describe, expect, it } from "vitest";
import { installFreezeClockCheck, judgeResumedClock, SETTLE_MS, WINDOW_MS, type CheckTiming } from "./freezeClockCheck";

/** A context whose clock advances at `speed` of the fake wall clock, and a timer queue the test runs by hand. */
function rig(speed: number, state = "running") {
  let wall = 0;
  const pending: { at: number; callback: () => void }[] = [];
  const context = {
    state,
    get currentTime() {
      return (wall / 1000) * speed;
    },
  };
  const timing: CheckTiming = {
    now: () => wall,
    setTimeout: (callback, ms) => pending.push({ at: wall + ms, callback }),
  };
  const advance = (ms: number) => {
    const until = wall + ms;
    for (;;) {
      pending.sort((a, b) => a.at - b.at);
      const next = pending[0];
      if (next === undefined || next.at > until) break;
      pending.shift();
      wall = next.at;
      next.callback();
    }
    wall = until;
  };
  return { context, timing, advance, pending };
}

describe("judgeResumedClock", () => {
  it("reads a clock under three quarters of real time as slow", () => {
    expect(judgeResumedClock({ contextAdvanceSec: 0.5, wallAdvanceSec: 1, runningAtStart: true, runningAtEnd: true })).toEqual({ kind: "slow", ratio: 0.5 });
  });
  it("reads a true clock as true", () => {
    expect(judgeResumedClock({ contextAdvanceSec: 1, wallAdvanceSec: 1, runningAtStart: true, runningAtEnd: true }).kind).toBe("true");
  });
  it("judges nothing when the context was not running through the window", () => {
    expect(judgeResumedClock({ contextAdvanceSec: 0, wallAdvanceSec: 1, runningAtStart: true, runningAtEnd: false }).kind).toBe("unknown");
  });
});

describe("installFreezeClockCheck", () => {
  it("tells the page once a resumed clock runs at half speed", () => {
    const page = new EventTarget();
    const { context, timing, advance } = rig(0.5);
    const slow: number[] = [];
    installFreezeClockCheck(page, context, (ratio) => slow.push(ratio), timing);
    page.dispatchEvent(new Event("resume"));
    advance(SETTLE_MS + WINDOW_MS - 1);
    expect(slow).toEqual([]); // the window has not closed yet
    advance(1);
    expect(slow).toHaveLength(1);
    expect(slow[0]).toBeCloseTo(0.5, 9);
  });

  it("says nothing when the resumed clock runs true", () => {
    const page = new EventTarget();
    const { context, timing, advance } = rig(1);
    const slow: number[] = [];
    installFreezeClockCheck(page, context, (ratio) => slow.push(ratio), timing);
    page.dispatchEvent(new Event("resume"));
    advance(SETTLE_MS + WINDOW_MS);
    expect(slow).toEqual([]);
  });

  it("does not measure a suspended context, whose clock stands still on purpose", () => {
    const page = new EventTarget();
    const { context, timing, advance, pending } = rig(0, "suspended");
    const slow: number[] = [];
    installFreezeClockCheck(page, context, (ratio) => slow.push(ratio), timing);
    page.dispatchEvent(new Event("resume"));
    expect(pending).toHaveLength(0);
    advance(SETTLE_MS + WINDOW_MS);
    expect(slow).toEqual([]);
  });

  it("ignores anything but resume, and stops after terminate", () => {
    const page = new EventTarget();
    const { context, timing, advance } = rig(0.5);
    const slow: number[] = [];
    const check = installFreezeClockCheck(page, context, (ratio) => slow.push(ratio), timing);
    page.dispatchEvent(new Event("freeze"));
    advance(SETTLE_MS + WINDOW_MS);
    expect(slow).toEqual([]);
    check.terminate();
    page.dispatchEvent(new Event("resume"));
    advance(SETTLE_MS + WINDOW_MS);
    expect(slow).toEqual([]);
  });

  it("runs one check at a time: a second resume during a check does not double the notice", () => {
    const page = new EventTarget();
    const { context, timing, advance } = rig(0.5);
    const slow: number[] = [];
    installFreezeClockCheck(page, context, (ratio) => slow.push(ratio), timing);
    page.dispatchEvent(new Event("resume"));
    advance(SETTLE_MS);
    page.dispatchEvent(new Event("resume"));
    advance(WINDOW_MS);
    expect(slow).toHaveLength(1);
  });
});
