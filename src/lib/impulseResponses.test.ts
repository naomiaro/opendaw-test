import { describe, it, expect } from "vitest";
import { IMPULSE_RESPONSES, renderOneShot } from "./impulseResponses";

const SAMPLE_RATE = 48000;

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]));
  return max;
}

describe("IMPULSE_RESPONSES gallery", () => {
  it("has the six designed IRs with unique ids", () => {
    expect(IMPULSE_RESPONSES.length).toBe(6);
    const ids = IMPULSE_RESPONSES.map(spec => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(IMPULSE_RESPONSES.map(spec => [spec.id, spec] as const))(
    "%s renders stereo channels of the declared duration",
    (_id, spec) => {
      const channels = spec.render(SAMPLE_RATE);
      expect(channels.length).toBe(2);
      const expectedLength = Math.round(spec.seconds * SAMPLE_RATE);
      expect(channels[0].length).toBe(expectedLength);
      expect(channels[1].length).toBe(expectedLength);
    }
  );

  it.each(IMPULSE_RESPONSES.map(spec => [spec.id, spec] as const))(
    "%s renders deterministically",
    (_id, spec) => {
      const first = spec.render(SAMPLE_RATE);
      const second = spec.render(SAMPLE_RATE);
      expect(first[0]).toEqual(second[0]);
      expect(first[1]).toEqual(second[1]);
    }
  );

  it.each(IMPULSE_RESPONSES.map(spec => [spec.id, spec] as const))(
    "%s is peak-normalized with headroom",
    (_id, spec) => {
      const channels = spec.render(SAMPLE_RATE);
      const overall = Math.max(peak(channels[0]), peak(channels[1]));
      expect(overall).toBeLessThanOrEqual(1);
      expect(overall).toBeGreaterThan(0.5);
    }
  );

  it.each(IMPULSE_RESPONSES.map(spec => [spec.id, spec] as const))(
    "%s decorrelates the stereo channels",
    (_id, spec) => {
      const [left, right] = spec.render(SAMPLE_RATE);
      let differs = false;
      for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) { differs = true; break; }
      }
      expect(differs).toBe(true);
    }
  );

  it.each(["hall", "plate", "room", "gated"])(
    "%s decays: the final 10%% carries almost no energy vs the first 10%%",
    id => {
      const spec = IMPULSE_RESPONSES.find(s => s.id === id)!;
      const [left] = spec.render(SAMPLE_RATE);
      const tenth = Math.floor(left.length / 10);
      const head = rms(left, 0, tenth);
      const tail = rms(left, left.length - tenth, left.length);
      expect(tail).toBeLessThan(head * 0.05);
    }
  );

  it("reverse swells: the end is louder than the start", () => {
    const spec = IMPULSE_RESPONSES.find(s => s.id === "reverse")!;
    const [left] = spec.render(SAMPLE_RATE);
    const tenth = Math.floor(left.length / 10);
    const head = rms(left, 0, tenth);
    // The very tail holds the swell peak; compare the last tenth before the
    // terminating fade (the fade keeps the IR from clicking at its end).
    const tail = rms(left, left.length - 2 * tenth, left.length - tenth);
    expect(tail).toBeGreaterThan(head * 2);
  });

  it("gated cuts hard: the last quarter is pure silence", () => {
    const spec = IMPULSE_RESPONSES.find(s => s.id === "gated")!;
    const [left, right] = spec.render(SAMPLE_RATE);
    const from = Math.floor(left.length * 0.75);
    for (let i = from; i < left.length; i++) {
      expect(left[i]).toBe(0);
      expect(right[i]).toBe(0);
    }
  });
});

describe("renderOneShot", () => {
  it("renders a short deterministic stereo percussive hit", () => {
    const first = renderOneShot(SAMPLE_RATE);
    const second = renderOneShot(SAMPLE_RATE);
    expect(first.length).toBe(2);
    expect(first[0].length).toBe(first[1].length);
    expect(first[0].length).toBeLessThanOrEqual(SAMPLE_RATE / 2);
    expect(first[0]).toEqual(second[0]);
  });

  it("is normalized and fully decayed at its end", () => {
    const [left] = renderOneShot(SAMPLE_RATE);
    expect(peak(left)).toBeLessThanOrEqual(1);
    expect(peak(left)).toBeGreaterThan(0.5);
    const tenth = Math.floor(left.length / 10);
    expect(rms(left, left.length - tenth, left.length)).toBeLessThan(0.01);
  });
});
