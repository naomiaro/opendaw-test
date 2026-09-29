import { describe, it, expect } from "vitest";
import { NANO_SAMPLES, MAX_CUSTOM_SAMPLE_SECONDS, checkCustomSample } from "./nanoSamples";

const RATES = [44100, 48000];

function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]));
  return max;
}

/** Fundamental by normalized autocorrelation over a window starting at `fromSeconds`. */
function fundamentalHz(samples: Float32Array, sampleRate: number, fromSeconds: number, minHz: number, maxHz: number): number {
  const start = Math.round(fromSeconds * sampleRate);
  const window = 8192;
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.ceil(sampleRate / minHz);
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0;
    let energyA = 0;
    let energyB = 0;
    for (let i = 0; i < window; i++) {
      const a = samples[start + i];
      const b = samples[start + i + lag];
      cross += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const score = cross / Math.sqrt(energyA * energyB + 1e-12);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return sampleRate / bestLag;
}

function upwardCrossings(samples: Float32Array, from: number, to: number): number {
  let count = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 && samples[i] >= 0) count++;
  return count;
}

const cases = NANO_SAMPLES.flatMap(spec => RATES.map(rate => [spec.id, rate, spec] as const));

describe("NANO_SAMPLES", () => {
  it("has the four designed samples in gallery order", () => {
    expect(NANO_SAMPLES.map(spec => spec.id)).toEqual(["pluck", "riser", "pad", "kick"]);
  });

  it("declares the root keys the presets rely on", () => {
    const rootKeys = Object.fromEntries(NANO_SAMPLES.map(spec => [spec.id, spec.rootKey]));
    expect(rootKeys).toEqual({ pluck: 57, riser: 60, pad: 48, kick: 60 });
  });

  it.each(cases)("%s renders two channels of the declared length at %d Hz", (_id, rate, spec) => {
    const channels = spec.render(rate);
    expect(channels.length).toBe(2);
    expect(channels[0].length).toBe(Math.round(spec.seconds * rate));
    expect(channels[1].length).toBe(channels[0].length);
  });

  it.each(cases)("%s is finite and jointly peak-normalized to 0.9 at %d Hz", (_id, rate, spec) => {
    const [left, right] = spec.render(rate);
    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
    expect(Math.max(peak(left), peak(right))).toBeCloseTo(0.9, 3);
  });

  it.each(NANO_SAMPLES.map(spec => [spec.id, spec] as const))("%s renders deterministically", (_id, spec) => {
    const first = spec.render(48000);
    const second = spec.render(48000);
    expect(first[0]).toEqual(second[0]);
    expect(first[1]).toEqual(second[1]);
  });

  it.each(cases)("%s starts and ends near silence at %d Hz", (_id, rate, spec) => {
    const [left] = spec.render(rate);
    expect(Math.abs(left[0])).toBeLessThan(0.05);
    expect(Math.abs(left[left.length - 1])).toBeLessThan(0.05);
  });

  it.each(
    NANO_SAMPLES.filter(spec => spec.fundamentalHz !== null).flatMap(spec => RATES.map(rate => [spec.id, rate, spec] as const))
  )("%s has its declared fundamental at %d Hz", (_id, rate, spec) => {
    const [left] = spec.render(rate);
    const expected = spec.fundamentalHz as number;
    const measured = fundamentalHz(left, rate, 0.2, expected * 0.6, expected * 1.6);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.01);
  });

  it("declares fundamentals that match the root keys (note 69 is 440 Hz)", () => {
    for (const spec of NANO_SAMPLES) {
      if (spec.fundamentalHz === null) continue;
      const expected = 440 * Math.pow(2, (spec.rootKey - 69) / 12);
      expect(Math.abs(spec.fundamentalHz - expected) / expected).toBeLessThan(0.001);
    }
  });

  it("the riser sweeps upward", () => {
    const riser = NANO_SAMPLES.find(spec => spec.id === "riser")!;
    const [left] = riser.render(48000);
    const quarter = Math.floor(left.length / 4);
    const early = upwardCrossings(left, 0, quarter);
    const late = upwardCrossings(left, left.length - quarter, left.length);
    expect(late).toBeGreaterThan(early * 2);
  });

  it("the pluck decays: the last 200 ms is far quieter than the first 200 ms", () => {
    const pluck = NANO_SAMPLES.find(spec => spec.id === "pluck")!;
    const [left] = pluck.render(48000);
    const span = Math.round(0.2 * 48000);
    const energy = (from: number) => {
      let sum = 0;
      for (let i = from; i < from + span; i++) sum += left[i] * left[i];
      return sum;
    };
    expect(energy(left.length - span)).toBeLessThan(energy(0) * 0.05);
  });
});

describe("checkCustomSample", () => {
  it("accepts an ordinary sample", () => {
    expect(checkCustomSample(2.5, 120000)).toBeNull();
  });

  it("accepts a sample exactly at the limit", () => {
    expect(checkCustomSample(MAX_CUSTOM_SAMPLE_SECONDS, 2880000)).toBeNull();
  });

  it("refuses a sample longer than the limit and names the limit", () => {
    expect(checkCustomSample(MAX_CUSTOM_SAMPLE_SECONDS + 0.01, 2880480)).toContain("60");
  });

  it.each([
    ["zero frames", 0, 0],
    ["one frame", 1 / 48000, 1],
    ["a non-finite duration", Number.NaN, 48000],
    ["an infinite duration", Number.POSITIVE_INFINITY, 48000],
    ["a negative duration", -1, 48000],
  ])("refuses %s", (_label, seconds, frames) => {
    expect(checkCustomSample(seconds, frames)).not.toBeNull();
  });
});
