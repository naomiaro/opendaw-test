import { describe, it, expect } from "vitest";
import {
  expectedToneLoudness,
  kWeightingDb,
  samplePeakDb,
  segmentSpans,
  synthesize,
  type ToneSegment,
} from "./loudnessSignals";

const tone = (levelDb: number, seconds: number, hz = 1000): ToneSegment => ({
  seconds,
  levelDb,
  frequency: { hz },
  phaseDeg: 0,
});
const HALF_SCALE_DB = 20 * Math.log10(0.5);
const fraction = (rateDivisor: number, phaseDeg: number, levelDb = HALF_SCALE_DB): ToneSegment => ({
  seconds: 1,
  levelDb,
  frequency: { rateDivisor },
  phaseDeg,
});

/** A sine's peak in dBFS, from its RMS over [from, to). */
function levelDb(signal: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += signal[i] * signal[i];
  return 10 * Math.log10((2 * sum) / (to - from));
}

describe("segmentSpans", () => {
  it("lays segments end to end in frames", () => {
    expect(segmentSpans([tone(-26, 20), tone(-20, 20.1), tone(-26, 20)], 48000)).toEqual([
      { startFrame: 0, endFrame: 960000 },
      { startFrame: 960000, endFrame: 1924800 },
      { startFrame: 1924800, endFrame: 2884800 },
    ]);
  });
  it("refuses a tone at or above half the sample rate", () => {
    expect(() => segmentSpans([tone(-20, 1, 24000)], 48000)).toThrow(/cannot be synthesized/);
  });
  it("refuses a segment that holds no frames", () => {
    expect(() => segmentSpans([tone(-20, 0)], 48000)).toThrow(/holds no frames/);
  });
  it("refuses a level that is not a number", () => {
    expect(() => segmentSpans([tone(Number.NaN, 1)], 48000)).toThrow(/level/);
  });
});

describe("synthesize", () => {
  it("gives each segment its level", () => {
    const signal = synthesize([tone(-36, 1), tone(-23, 1)], 48000);
    expect(signal.length).toBe(96000);
    expect(levelDb(signal, 0, 48000)).toBeCloseTo(-36, 3);
    expect(levelDb(signal, 48000, 96000)).toBeCloseTo(-23, 3);
  });
  it("keeps the phase running across a level change", () => {
    // 250 Hz at 48 kHz: 48 frames is a quarter cycle, so the second segment starts on a crest.
    const signal = synthesize([tone(0, 0.001, 250), tone(HALF_SCALE_DB, 1, 250)], 48000);
    expect(signal[48]).toBeCloseTo(0.5, 4);
  });
  it("starts a new frequency at its own phase", () => {
    const signal = synthesize([tone(0, 0.001, 250), fraction(4, 90, 0)], 48000);
    expect(signal[48]).toBeCloseTo(1, 6);
    expect(signal[49]).toBeCloseTo(0, 6);
  });
  it("tapers the start and the end", () => {
    // fs/4 at 90 degrees is 1, 0, -1, 0, …; a 10 ms taper at 48 kHz is 480 frames.
    const signal = synthesize([fraction(4, 90, 0)], 48000, 10);
    expect(signal[0]).toBeCloseTo(0, 6);
    expect(signal[240]).toBeCloseTo(0.5, 6);
    expect(signal[480]).toBeCloseTo(1, 6);
    expect(signal[47760]).toBeCloseTo(239 / 480, 6);
    expect(signal[47996]).toBeCloseTo(3 / 480, 6);
  });
});

describe("samplePeakDb", () => {
  it("gives the highest sample of the EBU true-peak tones", () => {
    expect(samplePeakDb(fraction(4, 0), 48000)).toBeCloseTo(-6.0206, 3);
    expect(samplePeakDb(fraction(4, 45), 48000)).toBeCloseTo(-9.0309, 3);
    expect(samplePeakDb(fraction(6, 60), 48000)).toBeCloseTo(-7.27, 3);
    expect(samplePeakDb(fraction(8, 67.5), 48000)).toBeCloseTo(-6.7083, 3);
  });
  it("agrees with the synthesized samples", () => {
    const signal = synthesize([fraction(4, 45)], 44100);
    let peak = 0;
    for (const value of signal) peak = Math.max(peak, Math.abs(value));
    expect(20 * Math.log10(peak)).toBeCloseTo(samplePeakDb(fraction(4, 45), 44100), 4);
  });
});

describe("kWeightingDb", () => {
  /** The response of the 48 kHz coefficients printed in ITU-R BS.1770. */
  function publishedDb(hz: number): number {
    const w = (2 * Math.PI * hz) / 48000;
    const magnitude = (b: number[], a: number[]) =>
      Math.hypot(b[0] + b[1] * Math.cos(w) + b[2] * Math.cos(2 * w), b[1] * Math.sin(w) + b[2] * Math.sin(2 * w)) /
      Math.hypot(a[0] + a[1] * Math.cos(w) + a[2] * Math.cos(2 * w), a[1] * Math.sin(w) + a[2] * Math.sin(2 * w));
    return (
      20 *
      Math.log10(
        magnitude([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]) *
          magnitude([1, -2, 1], [1, -1.99004745483398, 0.99007225036621])
      )
    );
  }
  it("reproduces the published 48 kHz filter", () => {
    for (const hz of [25, 100, 1000, 2000, 10000, 20000]) {
      expect(kWeightingDb(48000, hz)).toBeCloseTo(publishedDb(hz), 3);
    }
  });
  it("is +0.691 dB at 997 Hz, the standard's reference tone", () => {
    expect(kWeightingDb(48000, 997)).toBeCloseTo(0.691, 3);
  });
  it("cuts the low end and lifts the top", () => {
    expect(kWeightingDb(48000, 25)).toBeCloseTo(-10.393, 2);
    expect(kWeightingDb(48000, 20000)).toBeCloseTo(4.043, 2);
  });
  it("follows the sample rate", () => {
    expect(kWeightingDb(44100, 1000)).toBeCloseTo(0.7005, 3);
  });
});

describe("expectedToneLoudness", () => {
  it("is the level less 0.691 plus the weighting", () => {
    expect(expectedToneLoudness(48000, 1000, -20)).toBeCloseTo(-19.9933, 3);
  });
});
