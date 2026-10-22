import { describe, expect, it } from "vitest";
import {
  countDropouts,
  judgeSuspendResume,
  purityOf,
  tonePurityFromSpectrum,
  type TonePurity,
} from "./chromiumSuspendResume";

const tone = (purityDb: number, dropouts = 0): TonePurity => ({ fundamentalDb: -10, harmonicsDb: -10 - purityDb, dropouts });
const baseline = tone(60);
const cycles = (n: number, at: (cycle: number) => TonePurity = () => tone(59)): TonePurity[] =>
  Array.from({ length: n }, (_, i) => at(i));

describe("purityOf", () => {
  it("is the fundamental's level over the rest of the spectrum's", () => {
    expect(purityOf(baseline)).toBeCloseTo(60, 6);
  });
});

describe("judgeSuspendResume", () => {
  it("reads a run whose purity falls 20 dB after cycle 7 as distorted, naming the cycle", () => {
    const judged = judgeSuspendResume(baseline, cycles(20, (i) => (i >= 7 ? tone(40) : tone(59))), 20);
    expect(judged.verdict).toBe("DISTORTED");
    expect(judged.worstPurityDb).toBeCloseTo(40, 6);
    expect(judged.worstCycle).toBe(7);
    expect(judged.dropoutsAfter).toBe(0);
  });

  it("reads a run whose every cycle stays within 3 dB of the baseline as clean", () => {
    const judged = judgeSuspendResume(baseline, cycles(20, (i) => tone(i % 2 === 0 ? 57 : 61)), 20);
    expect(judged.verdict).toBe("CLEAN");
    expect(judged.worstPurityDb).toBeCloseTo(57, 6);
    expect(judged.worstCycle).toBe(0);
  });

  it("does not judge fewer than ten cycles", () => {
    const judged = judgeSuspendResume(baseline, cycles(5, () => tone(40)), 5);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.worstPurityDb).toBeCloseTo(40, 6);
  });

  it("judges a run cut short between ten and nineteen cycles on the cycles it has", () => {
    expect(judgeSuspendResume(baseline, cycles(12), 12).verdict).toBe("CLEAN");
  });

  it("reads a 12 dB fall as clean and anything past it as distorted", () => {
    expect(judgeSuspendResume(baseline, cycles(20, () => tone(48)), 20).verdict).toBe("CLEAN");
    expect(judgeSuspendResume(baseline, cycles(20, () => tone(47.9)), 20).verdict).toBe("DISTORTED");
  });

  it("reads dropouts in two consecutive windows as distorted, and in two apart as clean", () => {
    const together = judgeSuspendResume(baseline, cycles(20, (i) => tone(59, i === 4 || i === 5 ? 3 : 0)), 20);
    expect(together.verdict).toBe("DISTORTED");
    expect(together.dropoutsAfter).toBe(6);
    const apart = judgeSuspendResume(baseline, cycles(20, (i) => tone(59, i === 4 || i === 6 ? 3 : 0)), 20);
    expect(apart.verdict).toBe("CLEAN");
    expect(apart.dropoutsAfter).toBe(6);
  });
});

describe("tonePurityFromSpectrum", () => {
  // 48 kHz, an FFT of 1024: bins are 46.875 Hz apart, 440 Hz is nearest bin 9.
  const flat = (db: number) => new Float32Array(512).fill(db);

  it("reads the tone's bin as the fundamental and a spectrum clean down to the floor as the floor", () => {
    const bins = flat(-120);
    bins[9] = -6;
    const purity = tonePurityFromSpectrum(bins, 48000, 1024, 0);
    expect(purity.fundamentalDb).toBeCloseTo(-6, 6);
    expect(purity.harmonicsDb).toBe(-80);
    expect(purity.dropouts).toBe(0);
  });

  it("sums the power of every other bin above the floor, the tone's window lobe left out", () => {
    const bins = flat(-120);
    bins[9] = -6;
    bins[8] = -20; // the window's main lobe: part of the tone
    bins[10] = -20;
    bins[19] = -50; // two harmonics at the same level: 3 dB above one
    bins[28] = -50;
    const purity = tonePurityFromSpectrum(bins, 48000, 1024, 2);
    expect(purity.harmonicsDb).toBeCloseTo(-50 + 10 * Math.log10(2), 4);
    expect(purity.dropouts).toBe(2);
  });
});

describe("countDropouts", () => {
  it("counts the windows whose RMS falls below a tenth of the baseline's", () => {
    const samples = new Float32Array(512);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    samples.fill(0, 128, 256); // one zero-filled quantum
    samples.fill(0.001, 384, 512); // one nearly silent
    expect(countDropouts(samples, 128, 0.5 / Math.SQRT2)).toBe(2);
  });
});
