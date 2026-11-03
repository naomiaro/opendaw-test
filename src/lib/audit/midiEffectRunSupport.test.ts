import { describe, expect, it } from "vitest";
import { awaitSampleLoader, RunAbort, type SampleLoaderLike, type SampleLoaderStateLike } from "./midiEffectRunSupport";

/** A loader in `initial` state; `fire` delivers a later state to its subscribers; `terminated` counts terminations. */
function fakeLoader(initial: SampleLoaderStateLike, onSubscribe?: (observer: (state: SampleLoaderStateLike) => void) => void) {
  const observers: Array<(state: SampleLoaderStateLike) => void> = [];
  const counts = { subscribed: 0, terminated: 0 };
  const loader: SampleLoaderLike = {
    state: initial,
    subscribe(observer) {
      counts.subscribed++;
      observers.push(observer);
      onSubscribe?.(observer);
      return { terminate: () => { counts.terminated++; } };
    },
  };
  return { loader, counts, fire: (state: SampleLoaderStateLike) => observers.forEach((observer) => observer(state)) };
}

describe("awaitSampleLoader", () => {
  it("resolves at once on a loaded loader without subscribing", async () => {
    const { loader, counts } = fakeLoader({ type: "loaded" });
    await expect(awaitSampleLoader(loader, 1000)).resolves.toBeUndefined();
    expect(counts.subscribed).toBe(0);
  });
  it("rejects at once with the loader's reason on an errored loader without subscribing", async () => {
    const { loader, counts } = fakeLoader({ type: "error", reason: "1200 frames or fewer" });
    await expect(awaitSampleLoader(loader, 1000)).rejects.toThrow("sample load failed: 1200 frames or fewer");
    expect(counts.subscribed).toBe(0);
  });
  it("rejects with the reason of an error that arrives after subscribing, and terminates the subscription once", async () => {
    const { loader, counts, fire } = fakeLoader({ type: "progress" });
    const waiting = awaitSampleLoader(loader, 1000);
    fire({ type: "progress" });
    fire({ type: "error", reason: "decode failed" });
    await expect(waiting).rejects.toThrow("sample load failed: decode failed");
    expect(counts.terminated).toBe(1);
  });
  it("resolves on a load that arrives after subscribing, and terminates the subscription once", async () => {
    const { loader, counts, fire } = fakeLoader({ type: "idle" });
    const waiting = awaitSampleLoader(loader, 1000);
    fire({ type: "loaded" });
    await expect(waiting).resolves.toBeUndefined();
    expect(counts.terminated).toBe(1);
  });
  it("terminates a subscription whose observer fired synchronously inside subscribe", async () => {
    const { loader, counts } = fakeLoader({ type: "idle" }, (observer) => observer({ type: "loaded" }));
    await expect(awaitSampleLoader(loader, 1000)).resolves.toBeUndefined();
    expect(counts.terminated).toBe(1);
  });
  it("rejects at the deadline when nothing arrives, and terminates the subscription", async () => {
    const { loader, counts } = fakeLoader({ type: "idle" });
    await expect(awaitSampleLoader(loader, 10)).rejects.toThrow("sample load timed out after 0.01s");
    expect(counts.terminated).toBe(1);
  });
});

describe("RunAbort", () => {
  it("is an Error named RunAbort, so a log prints its name", () => {
    const abort = new RunAbort("calibration did not run");
    expect(abort).toBeInstanceOf(Error);
    expect(abort.name).toBe("RunAbort");
    expect(String(abort)).toBe("RunAbort: calibration did not run");
  });
});
