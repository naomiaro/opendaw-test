import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { churnGraph } from "./graphChurn";

/** A stand-in for the two things the churn touches: `createGain`, and a node's connect/disconnect. */
function fakeContext() {
  const calls: string[] = [];
  const node = () => ({
    connect: () => { calls.push("connect"); },
    disconnect: () => { calls.push("disconnect"); },
  });
  return { calls, context: { createGain: node } as unknown as BaseAudioContext };
}

describe("churnGraph", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("connects and disconnects in pairs until the duration is over, then resolves with the count", async () => {
    const { calls, context } = fakeContext();
    const done = churnGraph(context, 20, { stretchMs: 2, gapMs: 1 });
    await vi.advanceTimersByTimeAsync(60);
    const pairs = await done;
    expect(pairs).toBeGreaterThan(0);
    expect(calls.length).toBe(pairs * 2);
    expect(calls[0]).toBe("connect");
    expect(calls[calls.length - 1]).toBe("disconnect");
    const settled = calls.length;
    await vi.advanceTimersByTimeAsync(60);
    expect(calls.length).toBe(settled);
  });

  it("does nothing for a duration of zero", async () => {
    const { calls, context } = fakeContext();
    const done = churnGraph(context, 0);
    await vi.advanceTimersByTimeAsync(10);
    expect(await done).toBe(0);
    expect(calls).toEqual([]);
  });
});
