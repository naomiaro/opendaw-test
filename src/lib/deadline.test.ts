import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withDeadline } from "./deadline";

describe("withDeadline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the underlying value when it settles before the deadline", async () => {
    const result = withDeadline(Promise.resolve("value"), 1000, "test op");
    await expect(result).resolves.toBe("value");
  });

  it("rejects with a message naming the label when the deadline elapses first", async () => {
    const never = new Promise<never>(() => {});
    const result = withDeadline(never, 1000, "test op");
    const assertion = expect(result).rejects.toThrow(/test op/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("propagates an underlying rejection instead of masking it with a timeout", async () => {
    const result = withDeadline(Promise.reject(new Error("boom")), 1000, "test op");
    await expect(result).rejects.toThrow("boom");
  });
});
