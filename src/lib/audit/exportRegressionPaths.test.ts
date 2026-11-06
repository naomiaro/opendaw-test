import { describe, expect, it, vi } from "vitest";
import { chunkSizes, secondPass } from "./exportRegressionPaths";

// The package index needs AudioWorkletNode, which Node has not. Nothing tested here renders.
vi.mock("@opendaw/studio-core", () => ({ EffectFactories: { AudioNamed: {} } }));

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
