import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderScheduler, type SchedulerStatus } from "./renderScheduler";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("RenderScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = (run: () => Promise<void>) => {
    const statuses: SchedulerStatus[] = [];
    const errors: string[] = [];
    const scheduler = new RenderScheduler(run, {
      settleMs: 300,
      onStatus: status => statuses.push(status),
      onError: message => errors.push(message)
    });
    return { scheduler, statuses, errors };
  };

  it("three requests within the settle time run once, after the settle", async () => {
    const run = vi.fn(async () => {});
    const { scheduler } = make(run);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(100);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(100);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(299);
    expect(run).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("goes stale on request, rendering on run, idle after", async () => {
    const { scheduler, statuses } = make(async () => {});
    scheduler.request();
    scheduler.request();
    await vi.advanceTimersByTimeAsync(300);
    expect(statuses).toEqual(["stale", "rendering", "idle"]);
  });

  it("a request during a run runs exactly one more time after it", async () => {
    const first = deferred();
    const run = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => {});
    const { scheduler, statuses } = make(run);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.request();
    scheduler.request();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toEqual(["stale", "rendering", "stale"]);
    await vi.advanceTimersByTimeAsync(299);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["stale", "rendering", "stale", "rendering", "idle"]);
  });

  it("reports a rejected run and returns to idle", async () => {
    const { scheduler, statuses, errors } = make(async () => {
      throw new Error("boom");
    });
    scheduler.request();
    await vi.advanceTimersByTimeAsync(300);
    expect(errors).toEqual(["boom"]);
    expect(statuses).toEqual(["stale", "rendering", "idle"]);
  });

  it("a rejected run with a pending request goes stale and runs again", async () => {
    const first = deferred();
    const run = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => {});
    const { scheduler, statuses, errors } = make(run);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(300);
    scheduler.request();
    first.reject(new Error("boom"));
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual(["boom"]);
    expect(statuses).toEqual(["stale", "rendering", "stale"]);
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe("idle");
  });

  it("a throwing onError or onStatus does not wedge the scheduler: the next request still runs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("boom");
      })
      .mockImplementation(async () => {});
    let throwOnError = true;
    let throwOnStatus = false;
    const statuses: SchedulerStatus[] = [];
    const scheduler = new RenderScheduler(run, {
      settleMs: 300,
      onStatus: status => {
        statuses.push(status);
        if (throwOnStatus) {
          throwOnStatus = false;
          throw new Error("status listener");
        }
      },
      onError: () => {
        if (throwOnError) {
          throwOnError = false;
          throw new Error("error listener");
        }
      }
    });
    scheduler.request();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("[render-scheduler] onError threw: error listener");
    expect(statuses.at(-1)).toBe("idle");

    throwOnStatus = true;
    scheduler.request();
    expect(consoleError).toHaveBeenCalledWith("[render-scheduler] onStatus threw: status listener");
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["stale", "rendering", "idle", "stale", "rendering", "idle"]);
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("dispose cancels the timer", async () => {
    const run = vi.fn(async () => {});
    const { scheduler, statuses } = make(run);
    scheduler.request();
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(0);
    expect(statuses).toEqual(["stale"]);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(0);
  });

  it("dispose silences the in-flight run, resolved or rejected", async () => {
    for (const outcome of ["resolve", "reject"] as const) {
      const inFlight = deferred();
      const run = vi.fn(() => inFlight.promise);
      const { scheduler, statuses, errors } = make(run);
      scheduler.request();
      await vi.advanceTimersByTimeAsync(300);
      scheduler.request();
      scheduler.dispose();
      if (outcome === "resolve") {
        inFlight.resolve();
      } else {
        inFlight.reject(new Error("late"));
      }
      await vi.advanceTimersByTimeAsync(2000);
      expect(statuses).toEqual(["stale", "rendering"]);
      expect(errors).toEqual([]);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });
});
