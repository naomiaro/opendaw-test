import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installFreezeClockCheck,
  judgeResumedClock,
  judgeWindows,
  SETTLE_MS,
  WINDOW_MS,
  WINDOWS,
  type CheckTiming,
  type ClockWindow,
} from "./freezeClockCheck";

const CHECK_MS = SETTLE_MS + WINDOWS * WINDOW_MS;

/** A context whose clock advances at `speed` of the fake wall clock while running, and a timer queue run by hand. */
class FakeContext extends EventTarget {
  state: string;
  speed: number;
  private clock = 0;
  constructor(speed: number, state = "running") {
    super();
    this.speed = speed;
    this.state = state;
  }
  get currentTime() {
    return this.clock;
  }
  tick(ms: number) {
    if (this.state === "running") this.clock += (ms / 1000) * this.speed;
  }
  setState(state: string) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

function rig(speed: number, state = "running") {
  let wall = 0;
  const pending: { at: number; callback: () => void }[] = [];
  const context = new FakeContext(speed, state);
  const timing: CheckTiming = {
    now: () => wall,
    setTimeout: (callback, ms) => pending.push({ at: wall + ms, callback }),
  };
  /** Advance the wall clock (and the context with it); `timers: false` is a frozen page, whose timers do not run. */
  const advance = (ms: number, timers = true) => {
    const until = wall + ms;
    for (;;) {
      pending.sort((a, b) => a.at - b.at);
      const next = pending[0];
      if (!timers || next === undefined || next.at > until) break;
      pending.shift();
      context.tick(next.at - wall);
      wall = next.at;
      next.callback();
    }
    context.tick(until - wall);
    wall = until;
  };
  const page = new EventTarget();
  const slow: number[] = [];
  const check = installFreezeClockCheck(page, context, (ratio) => slow.push(ratio), timing);
  const fire = (type: "resume" | "freeze") => page.dispatchEvent(new Event(type));
  return { context, advance, pending, slow, check, fire };
}

let debug: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  debug = vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const logged = () => debug.mock.calls.map((call) => String(call[0]));

const window = (ratio: number, running = true): ClockWindow => ({
  contextAdvanceSec: ratio,
  wallAdvanceSec: 1,
  runningAtStart: running,
  runningAtEnd: running,
});

describe("judgeResumedClock / judgeWindows", () => {
  it("reads a clock under three quarters of real time as slow", () => {
    expect(judgeResumedClock(window(0.5))).toEqual({ kind: "slow", ratio: 0.5 });
  });
  it("judges nothing when the context was not running through a window", () => {
    expect(judgeResumedClock(window(0, false)).kind).toBe("unknown");
  });
  it("calls the clock slow only when every window is", () => {
    expect(judgeWindows([window(0.5), window(0.5)]).kind).toBe("slow");
    expect(judgeWindows([window(0.7), window(1)]).kind).toBe("true"); // a stall in one window, then true
  });
});

describe("installFreezeClockCheck", () => {
  it("tells the page once a resumed clock runs at half speed in every window", () => {
    const { advance, slow, fire } = rig(0.5);
    fire("resume");
    advance(CHECK_MS - 1);
    expect(slow).toEqual([]); // the last window has not closed yet
    advance(1);
    expect(slow).toHaveLength(1);
    expect(slow[0]).toBeCloseTo(0.5, 9);
    expect(logged().some((line) => line.includes("slow (ratios 0.500 / 0.500)"))).toBe(true);
  });

  it("says nothing, and logs that the clock is true, when it runs true", () => {
    const { advance, slow, fire } = rig(1);
    fire("resume");
    advance(CHECK_MS);
    expect(slow).toEqual([]);
    expect(logged().some((line) => line.includes("true (ratios 1.000 / 1.000)"))).toBe(true);
  });

  it("does not raise the notice for one window that stalls while the device reopens", () => {
    const { context, advance, slow, fire } = rig(1);
    fire("resume");
    advance(SETTLE_MS);
    context.speed = 0.6;
    advance(WINDOW_MS);
    context.speed = 1;
    advance(WINDOW_MS);
    expect(slow).toEqual([]);
  });

  it("checks a context that was suspended at resume once it starts running", () => {
    const { context, advance, slow, fire } = rig(0.5, "suspended");
    fire("resume");
    advance(CHECK_MS);
    expect(slow).toEqual([]);
    expect(logged().some((line) => line.includes("context suspended, checking once it runs"))).toBe(true);
    context.setState("running"); // the visitor's click resumes it
    advance(CHECK_MS);
    expect(slow).toHaveLength(1);
  });

  it("logs a window in which the context stopped running as unknown, and says nothing else", () => {
    const { context, advance, slow, fire } = rig(1);
    fire("resume");
    advance(SETTLE_MS + 100);
    context.setState("suspended");
    advance(WINDOWS * WINDOW_MS);
    expect(slow).toEqual([]);
    expect(logged().some((line) => line.includes("unknown (runningAtStart=true runningAtEnd=false"))).toBe(true);
  });

  describe("a freeze inside the window cancels the check, and the next resume checks afresh", () => {
    it("with a slow clock that kept running through the freeze: the second check still catches it", () => {
      const { advance, slow, fire } = rig(0.5);
      fire("resume");
      advance(SETTLE_MS + 800);
      fire("freeze");
      advance(60_000, false); // frozen: timers do not run, the wall clock and the context clock do
      fire("resume");
      advance(CHECK_MS);
      expect(slow).toHaveLength(1);
      expect(slow[0]).toBeCloseTo(0.5, 9);
      // Only the post-resume check judged: no window spanned the 60 s freeze.
      expect(logged().filter((line) => line.includes("(ratios"))).toEqual([expect.stringContaining("slow (ratios 0.500 / 0.500)")]);
    });

    it("with a true clock that stood still through the freeze: no false notice", () => {
      const { context, advance, slow, fire } = rig(1);
      fire("resume");
      advance(SETTLE_MS + 800);
      fire("freeze");
      context.state = "suspended"; // rendering paused while frozen
      advance(60_000, false);
      context.state = "running";
      fire("resume");
      advance(CHECK_MS);
      expect(slow).toEqual([]);
      // The check after the resume measured only post-resume time: no window reads the frozen span.
      expect(logged().filter((line) => line.includes("(ratios"))).toEqual([expect.stringContaining("true (ratios 1.000 / 1.000)")]);
    });
  });

  it("ignores events after terminate", () => {
    const { advance, slow, fire, check } = rig(0.5);
    check.terminate();
    fire("resume");
    advance(CHECK_MS);
    expect(slow).toEqual([]);
  });
});
