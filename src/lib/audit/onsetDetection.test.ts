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
