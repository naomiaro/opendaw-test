import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { UUID } from "@opendaw/lib-std";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { attempt, chunkSizes, renderThenRelease, secondPass, stemsConfiguration } from "./exportRegressionPaths";

// The package index needs AudioWorkletNode, which Node has not. Nothing tested here renders.
vi.mock("@opendaw/studio-core", () => ({ EffectFactories: { AudioNamed: {} } }));

describe("renderThenRelease", () => {
  const throwing = (message: string) => (): void => {
    throw new Error(message);
  };
  const quietly = (): MockInstance => vi.spyOn(console, "error").mockImplementation(() => {});
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands the render on when everything closes", async () => {
    const release = vi.fn();
    await expect(renderThenRelease([], "row", async () => 7, release)).resolves.toBe(7);
    expect(release).toHaveBeenCalledOnce();
  });
  it("fails a good render whose cleanup failed, naming the row and what failed: a live worker can contaminate the next row", async () => {
    const error = quietly();
    const failures: string[] = [];
    await expect(renderThenRelease(failures, "row-1", async () => 7, () => attempt(failures, "copy.terminate()", throwing("still live"))))
      .rejects.toThrow("row-1: cleanup: copy.terminate() failed: Error: still live");
    expect(error).toHaveBeenCalledOnce();
  });
  it("keeps the render's own error, the same one, when the cleanup is clean", async () => {
    const own = new Error("deadline");
    const release = vi.fn();
    await expect(renderThenRelease([], "row", async () => { throw own; }, release)).rejects.toBe(own);
    expect(release).toHaveBeenCalledOnce();
  });
  it("reads both when both failed, the render's first", async () => {
    quietly();
    const failures: string[] = [];
    const render = async (): Promise<number> => { throw new Error("deadline"); };
    await expect(renderThenRelease(failures, "row", render, () => attempt(failures, "renderer.stop()", throwing("gone"))))
      .rejects.toThrow("deadline; cleanup: renderer.stop() failed: Error: gone");
  });
  it("runs the cleanup after a failed one", () => {
    quietly();
    const failures: string[] = [];
    const after = vi.fn();
    attempt(failures, "first", throwing("x"));
    attempt(failures, "second", after);
    expect(after).toHaveBeenCalledOnce();
    expect(failures).toEqual(["first failed: Error: x"]);
  });
});

describe("stemsConfiguration", () => {
  const unit = (): AudioUnitBox => ({ address: { uuid: UUID.generate() } }) as unknown as AudioUnitBox;
  const units = { source: unit(), bed: unit() };
  const sourceKey = UUID.toString(units.source.address.uuid);
  const bedKey = UUID.toString(units.bed.address.uuid);

  it("names the source's stem alone on the single-stem paths: the worker's silence check reads only the stems it is given", () => {
    for (const path of ["stems-single-step", "stems-single-start"] as const) {
      const { stems, metronome } = stemsConfiguration(units, path);
      expect(Object.keys(stems!), path).toEqual([sourceKey]);
      expect(metronome, path).toBeUndefined();
      expect(stems![sourceKey], path).toMatchObject({ includeAudioEffects: true, includeSends: false, useInstrumentOutput: false });
    }
  });

  it("names both units, the source's first, on the other stem paths", () => {
    for (const path of ["stems-fx", "stems-dry", "stems-sends", "stems-metronome", "stems-start", "stems-section-loop"] as const) {
      expect(Object.keys(stemsConfiguration(units, path).stems!), path).toEqual([sourceKey, bedKey]);
    }
  });
});

describe("secondPass", () => {
  it("keeps what follows the first pass, on every channel", () => {
    const channels = [Float32Array.from([1, 2, 3, 4]), Float32Array.from([5, 6, 7, 8])];
    expect(secondPass(channels, 2).map((channel) => [...channel])).toEqual([[3, 4], [7, 8]]);
  });

  it("hands a short render on short: the verdict reads it", () => {
    expect([...secondPass([Float32Array.from([1, 2, 3])], 2)[0]]).toEqual([3]);
  });
});

describe("chunkSizes", () => {
  it("covers the total in chunks", () => {
    expect(chunkSizes(100000, 48000)).toEqual([48000, 48000, 4000]);
    expect(chunkSizes(3000, 1000)).toEqual([1000, 1000, 1000]);
  });

  it("gives a total under one chunk a single short chunk", () => {
    expect(chunkSizes(999, 1000)).toEqual([999]);
  });

  it("has nothing to step for no frames", () => {
    expect(chunkSizes(0, 1000)).toEqual([]);
  });

  it("refuses a chunk that would never cover the total", () => {
    expect(() => chunkSizes(1000, 0)).toThrow("chunk");
    expect(() => chunkSizes(1000, -1)).toThrow("chunk");
    expect(() => chunkSizes(1000, 0.5)).toThrow("chunk");
  });

  it("refuses a total that is not a frame count", () => {
    expect(() => chunkSizes(-1, 1000)).toThrow("frames");
    expect(() => chunkSizes(1.5, 1000)).toThrow("frames");
  });
});
