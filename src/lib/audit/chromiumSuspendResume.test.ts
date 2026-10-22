import { describe, expect, it } from "vitest";
import {
  CLICK_MARGIN,
  clickThreshold,
  countClicks,
  countDropouts,
  judgeSuspendResume,
  purityOf,
  tonePurityFromSpectrum,
  type TonePurity,
} from "./chromiumSuspendResume";

const tone = (purityDb: number, dropouts = 0, clicks = 0): TonePurity => ({
  fundamentalDb: -10,
  harmonicsDb: -10 - purityDb,
  dropouts,
  clicks,
});
const baseline = tone(60);
const cycles = (n: number, at: (cycle: number) => TonePurity = () => tone(59)): TonePurity[] =>
  Array.from({ length: n }, (_, i) => at(i));

/** 0.5 × sin at 440 Hz and 44.1 kHz, `length` samples. */
const sine = (length: number): Float32Array => {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100);
  return samples;
};

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

  it("reads one window with more clicks than the baseline's plus the margin as distorted", () => {
    const clicky = judgeSuspendResume(baseline, cycles(20, (i) => tone(59, 0, i === 9 ? CLICK_MARGIN + 1 : 0)), 20);
    expect(clicky.verdict).toBe("DISTORTED");
    expect(clicky.worstClicks).toBe(CLICK_MARGIN + 1);
    expect(clicky.worstClicksCycle).toBe(9);
    const withinMargin = judgeSuspendResume(baseline, cycles(20, () => tone(59, 0, CLICK_MARGIN)), 20);
    expect(withinMargin.verdict).toBe("CLEAN");
  });
});

describe("tonePurityFromSpectrum", () => {
  // 48 kHz, an FFT of 1024: bins are 46.875 Hz apart, 440 Hz is nearest bin 9.
  const flat = (db: number) => new Float32Array(512).fill(db);

  it("sums the power of every bin outside the tone's window lobe, however low each is", () => {
    const bins = flat(-200);
    bins[9] = -6;
    bins[8] = -20; // the window's main lobe: part of the tone
    bins[10] = -20;
    bins[19] = -50; // two harmonics at the same level: 3 dB above one
    bins[28] = -50;
    const purity = tonePurityFromSpectrum(bins, 48000, 1024, 2, 1);
    expect(purity.fundamentalDb).toBeCloseTo(-6, 6);
    expect(purity.harmonicsDb).toBeCloseTo(-50 + 10 * Math.log10(2), 4);
    expect(purity.dropouts).toBe(2);
    expect(purity.clicks).toBe(1);
  });

  it("hears broadband noise spread thin over every bin, each below −80 dB", () => {
    const bins = flat(-81);
    bins[9] = -6;
    const purity = tonePurityFromSpectrum(bins, 48000, 1024, 0, 0);
    // 504 bins outside the lobe (bin 0 left out) at −81 dB each: −81 + 10·log10(504).
    expect(purity.harmonicsDb).toBeCloseTo(-81 + 10 * Math.log10(504), 3);
  });
});

describe("tonePurityFromSpectrum with a lower band edge", () => {
  it("leaves out every bin below the edge, so room rumble does not count against the tone", () => {
    const bins = new Float32Array(512).fill(-200);
    bins[9] = -6;
    bins[2] = -10; // 94 Hz rumble, below a 200 Hz edge
    bins[19] = -50;
    const withEdge = tonePurityFromSpectrum(bins, 48000, 1024, 0, 0, 440, 200);
    expect(withEdge.harmonicsDb).toBeCloseTo(-50, 4);
    const without = tonePurityFromSpectrum(bins, 48000, 1024, 0, 0);
    expect(without.harmonicsDb).toBeGreaterThan(-11);
  });
});

describe("countDropouts", () => {
  it("counts the windows whose RMS falls below a tenth of the baseline's", () => {
    const samples = sine(512);
    samples.fill(0, 128, 256); // one zero-filled quantum
    samples.fill(0.001, 384, 512); // one nearly silent
    expect(countDropouts(samples, 128, 0.5 / Math.SQRT2)).toBe(2);
  });
});

describe("clicks", () => {
  const threshold = clickThreshold(sine(32768));

  it("finds no click in a clean sine against a threshold set from a clean sine", () => {
    expect(countClicks(sine(32768), threshold)).toBe(0);
  });

  it("finds three inserted clicks, and a run carrying them reads distorted", () => {
    const samples = sine(32768);
    for (const at of [5000, 15000, 25000]) samples[at] = -samples[at] + (samples[at] >= 0 ? -0.3 : 0.3);
    const clicks = countClicks(samples, threshold);
    expect(clicks).toBeGreaterThanOrEqual(3);
    const judged = judgeSuspendResume(tone(60), cycles(20, (i) => tone(60, 0, i === 3 ? clicks : 0)), 20);
    expect(judged.verdict).toBe("DISTORTED");
  });
});
