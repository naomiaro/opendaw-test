import { describe, it, expect } from "vitest";
import { detectOnsets, maxStepAround } from "./onsetDetection";

function clickTrain(sampleRate: number, onsetsSec: number[], length: number): Float32Array {
  const buf = new Float32Array(length);
  for (const t of onsetsSec) {
    const start = Math.round(t * sampleRate);
    for (let i = 0; i < Math.min(480, length - start); i++) {
      buf[start + i] += Math.sin((i / 480) * Math.PI) * Math.exp(-i / 160);
    }
  }
  return buf;
}

describe("detectOnsets", () => {
  it("finds synthetic clicks within 1 ms at 44100", () => {
    const truth = [0.1, 0.6, 1.11731, 2.0];
    const buf = clickTrain(44100, truth, 44100 * 3);
    const found = detectOnsets(buf, 44100);
    expect(found).toHaveLength(4);
    truth.forEach((t, i) => expect(Math.abs(found[i] - t)).toBeLessThan(0.001));
  });
  it("same buffer content at 96000 yields the same times within 1 ms", () => {
    const truth = [0.25, 0.75321, 1.5];
    const found = detectOnsets(clickTrain(96000, truth, 96000 * 2), 96000);
    truth.forEach((t, i) => expect(Math.abs(found[i] - t)).toBeLessThan(0.001));
  });
  it("refractory window merges double-triggers", () => {
    const buf = clickTrain(48000, [0.5, 0.503], 48000);
    expect(detectOnsets(buf, 48000)).toHaveLength(1);
  });
  it("silence yields no onsets", () => {
    expect(detectOnsets(new Float32Array(48000), 48000)).toHaveLength(0);
  });
  it("hopSeconds yields the same onset times at 48k vs 96k for identical physical content", () => {
    const truth = [0.2, 0.9, 1.75321];
    const hopSeconds = 64 / 44100;
    const found48k = detectOnsets(clickTrain(48000, truth, 48000 * 2), 48000, { hopSeconds });
    const found96k = detectOnsets(clickTrain(96000, truth, 96000 * 2), 96000, { hopSeconds });
    expect(found48k).toHaveLength(truth.length);
    expect(found96k).toHaveLength(truth.length);
    for (let i = 0; i < truth.length; i++) {
      expect(Math.abs(found48k[i] - found96k[i])).toBeLessThan(0.001);
    }
  });
  it("refractorySec of 0.6 detects only the primary click of a decaying-ring click train", () => {
    // Primary click + a decayed "ring" echo at +0.4s, 40% amplitude — mimics
    // Vaporisateur's ~350-400ms release ring re-triggering the detector at
    // the default 0.05s (or the old loop-wrap 0.2s) refractory window.
    const sampleRate = 48000;
    const primaries = [0.5, 4.5, 8.5];
    const buf = new Float32Array(sampleRate * 12);
    for (const t of primaries) {
      const start = Math.round(t * sampleRate);
      for (let i = 0; i < Math.min(480, buf.length - start); i++) {
        buf[start + i] += Math.sin((i / 480) * Math.PI) * Math.exp(-i / 160);
      }
      const ringStart = Math.round((t + 0.4) * sampleRate);
      for (let i = 0; i < Math.min(480, buf.length - ringStart); i++) {
        buf[ringStart + i] += 0.4 * Math.sin((i / 480) * Math.PI) * Math.exp(-i / 160);
      }
    }
    const found = detectOnsets(buf, sampleRate, { refractorySec: 0.6 });
    expect(found).toHaveLength(primaries.length);
    primaries.forEach((t, i) => expect(Math.abs(found[i] - t)).toBeLessThan(0.001));
  });
});

describe("maxStepAround", () => {
  it("flags a hard discontinuity and passes a continuous tone", () => {
    const sr = 48000;
    const buf = new Float32Array(sr);
    for (let i = 0; i < sr; i++) buf[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * 0.5;
    const smooth = maxStepAround(buf, sr, 0.5);
    for (let i = Math.floor(sr * 0.75); i < sr; i++) buf[i] = -buf[i]; // hard flip
    const hard = maxStepAround(buf, sr, 0.75);
    expect(hard).toBeGreaterThan(smooth * 5);
  });
});
