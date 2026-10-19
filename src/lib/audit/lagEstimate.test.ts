import { describe, expect, it } from "vitest";
import { bestLag } from "./lagEstimate";

function noise(length: number, seed: number): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = state / 0xffffffff - 0.5;
  }
  return out;
}

function delayed(source: Float32Array, frames: number): Float32Array {
  const out = new Float32Array(source.length);
  for (let i = 0; i < source.length; i++) {
    const j = i - frames;
    if (j >= 0 && j < source.length) out[i] = source[j];
  }
  return out;
}

describe("bestLag", () => {
  it("reads 0 for identical material", () => {
    const a = noise(4096, 7);
    const { lag, score } = bestLag(a, a, 500);
    expect(lag).toBe(0);
    expect(score).toBeCloseTo(1, 6);
  });

  it("reads a positive lag when the candidate arrives later", () => {
    const a = noise(4096, 11);
    expect(bestLag(a, delayed(a, 240), 500).lag).toBe(240);
  });

  it("reads a negative lag when the candidate arrives earlier", () => {
    const a = noise(4096, 13);
    expect(bestLag(a, delayed(a, -37), 500).lag).toBe(-37);
  });

  it("finds a shifted impulse, not only noise", () => {
    const a = new Float32Array(2000);
    a[500] = 0.5;
    const { lag, score } = bestLag(a, delayed(a, 240), 300);
    expect(lag).toBe(240);
    expect(score).toBeCloseTo(1, 6);
  });

  it("ignores gain: a scaled copy reads lag 0 with score 1", () => {
    const a = noise(2048, 17);
    const scaled = a.map((x) => x * 0.25);
    const { lag, score } = bestLag(a, scaled, 100);
    expect(lag).toBe(0);
    expect(score).toBeCloseTo(1, 6);
  });

  it("reads lag 0 and score 0 for silence", () => {
    const a = noise(1024, 19);
    expect(bestLag(a, new Float32Array(1024), 100)).toEqual({ lag: 0, score: 0 });
  });

  it("reaches both ends of the search window", () => {
    const a = noise(4096, 29);
    expect(bestLag(a, delayed(a, 500), 500).lag).toBe(500);
    expect(bestLag(a, delayed(a, -500), 500).lag).toBe(-500);
  });

  it("does not prefer a boundary lag whose overlap is a few samples", () => {
    const a = noise(100, 23);
    expect(bestLag(a, a, 99)).toMatchObject({ lag: 0 });
    expect(bestLag(a, delayed(a, 5), 200).lag).toBe(5);
  });

  it("reads a low score when the true lag lies outside the window", () => {
    const a = noise(4096, 37);
    expect(bestLag(a, delayed(a, 501), 500).score).toBeLessThan(0.2);
  });

  it("rejects non-finite input instead of reading it as silence", () => {
    const a = noise(2000, 31);
    const broken = a.slice();
    broken[1000] = NaN;
    expect(() => bestLag(a, broken, 100)).toThrow(/non-finite sample at 1000/);
    expect(() => bestLag(a, a, NaN)).toThrow(/maxLag/);
  });

  it("rejects mismatched lengths", () => {
    expect(() => bestLag(new Float32Array(10), new Float32Array(11), 2)).toThrow(/lengths differ/);
  });
});
