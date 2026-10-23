import { describe, expect, it } from "vitest";
import {
  CLICK_MARGIN,
  clickThreshold,
  countClicks,
  countDropouts,
  judgeHalfRate,
  judgeSuspendResume,
  MIN_CYCLES,
  PURITY_DROP_DB,
  SIGNAL_FLOOR_RMS,
  purityOf,
  readingWord,
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
/** A baseline window's RMS well above the signal floor: the tone at 0.2. */
const BASE_RMS = 0.2 / Math.SQRT2;
const judge = (base: TonePurity, after: TonePurity[], n: number) => judgeSuspendResume(base, after, n, BASE_RMS);
/** A window the analyser read as silence: every bin −Infinity. */
const silent = (dropouts = 0): TonePurity => ({ fundamentalDb: -Infinity, harmonicsDb: -Infinity, dropouts, clicks: 0 });
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
    const judged = judge(baseline, cycles(20, (i) => (i >= 7 ? tone(40) : tone(59))), 20);
    expect(judged.verdict).toBe("DISTORTED");
    expect(judged.worstPurityDb).toBeCloseTo(40, 6);
    expect(judged.worstCycle).toBe(7);
    expect(judged.dropoutsAfter).toBe(0);
  });

  it("reads a run whose every cycle stays within 3 dB of the baseline as clean", () => {
    const judged = judge(baseline, cycles(20, (i) => tone(i % 2 === 0 ? 57 : 61)), 20);
    expect(judged.verdict).toBe("CLEAN");
    expect(judged.worstPurityDb).toBeCloseTo(57, 6);
    expect(judged.worstCycle).toBe(0);
  });

  it("needs ten cycles", () => {
    expect(MIN_CYCLES).toBe(10);
  });

  it("does not judge fewer than MIN_CYCLES cycles", () => {
    const judged = judge(baseline, cycles(MIN_CYCLES - 1, () => tone(40)), MIN_CYCLES - 1);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.notCheckedReason).toBe("too-few-cycles");
    expect(judged.worstPurityDb).toBeCloseTo(40, 6);
  });

  it("judges a run of exactly MIN_CYCLES cycles", () => {
    expect(judge(baseline, cycles(MIN_CYCLES), MIN_CYCLES).verdict).toBe("CLEAN");
  });

  it("judges a run cut short between ten and nineteen cycles on the cycles it has", () => {
    expect(judge(baseline, cycles(12), 12).verdict).toBe("CLEAN");
  });

  it("does not judge a run that names twenty cycles but holds no window", () => {
    const judged = judge(baseline, [], 20);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.notCheckedReason).toBe("too-few-cycles");
  });

  it("reads a fall of exactly PURITY_DROP_DB as clean and anything past it as distorted", () => {
    const at = purityOf(baseline) - PURITY_DROP_DB;
    expect(judge(baseline, cycles(20, () => tone(at)), 20).verdict).toBe("CLEAN");
    expect(judge(baseline, cycles(20, () => tone(at - 0.1)), 20).verdict).toBe("DISTORTED");
  });

  it("does not judge against a silent baseline: every bin −Infinity reads NOT CHECKED no-signal", () => {
    const judged = judge(silent(), cycles(20), 20);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.notCheckedReason).toBe("no-signal");
  });

  it("does not judge against a baseline whose RMS is under the signal floor", () => {
    const judged = judgeSuspendResume(baseline, cycles(20), 20, SIGNAL_FLOOR_RMS / 2);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.notCheckedReason).toBe("no-signal");
    expect(judgeSuspendResume(baseline, cycles(20), 20, SIGNAL_FLOOR_RMS).verdict).toBe("CLEAN");
  });

  it("does not judge against a baseline whose purity is not a number", () => {
    const judged = judge({ fundamentalDb: -10, harmonicsDb: -Infinity, dropouts: 0, clicks: 0 }, cycles(20), 20);
    expect(judged.verdict).toBe("NOT CHECKED");
    expect(judged.notCheckedReason).toBe("no-baseline-purity");
  });

  it("never reads silent windows after a sounding baseline as clean", () => {
    const judged = judge(baseline, cycles(20, (i) => (i >= 15 ? silent() : tone(59))), 20);
    expect(judged.verdict).toBe("DISTORTED");
    expect(judged.silentWindows).toBe(5);
    expect(judged.worstCycle).toBe(15);
  });

  it("does not let a silent first window hide a later fall: NaN then a fall reads distorted", () => {
    const judged = judge(baseline, cycles(20, (i) => (i === 0 ? silent() : i === 10 ? tone(30) : tone(59))), 20);
    expect(judged.verdict).toBe("DISTORTED");
    expect(judged.worstCycle).toBe(0);
    expect(judged.worstPurityDb).toBe(-Infinity);
  });

  it("reads dropouts in two consecutive windows as distorted, and in two apart as clean", () => {
    const together = judge(baseline, cycles(20, (i) => tone(59, i === 4 || i === 5 ? 3 : 0)), 20);
    expect(together.verdict).toBe("DISTORTED");
    expect(together.dropoutsAfter).toBe(6);
    const apart = judge(baseline, cycles(20, (i) => tone(59, i === 4 || i === 6 ? 3 : 0)), 20);
    expect(apart.verdict).toBe("CLEAN");
    expect(apart.dropoutsAfter).toBe(6);
  });

  it("reads one window with more clicks than the baseline's plus the margin as distorted", () => {
    const clicky = judge(baseline, cycles(20, (i) => tone(59, 0, i === 9 ? CLICK_MARGIN + 1 : 0)), 20);
    expect(clicky.verdict).toBe("DISTORTED");
    expect(clicky.worstClicks).toBe(CLICK_MARGIN + 1);
    expect(clicky.worstClicksCycle).toBe(9);
    const withinMargin = judge(baseline, cycles(20, () => tone(59, 0, CLICK_MARGIN)), 20);
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

  it("counts every all-zero window as a dropout, even against a baseline RMS of 0", () => {
    expect(countDropouts(new Float32Array(512), 128, 0)).toBe(4);
    const samples = sine(512);
    samples.fill(0, 256, 384);
    expect(countDropouts(samples, 128, 0)).toBe(1);
  });
});

describe("tonePurityFromSpectrum on silence", () => {
  it("reads an all −Infinity spectrum as a −Infinity fundamental and a purity that is not a number", () => {
    const purity = tonePurityFromSpectrum(new Float32Array(512).fill(-Infinity), 48000, 1024, 0, 0);
    expect(purity.fundamentalDb).toBe(-Infinity);
    expect(purity.harmonicsDb).toBe(-Infinity);
    expect(Number.isNaN(purityOf(purity))).toBe(true);
  });
});

describe("readingWord", () => {
  const clean = judge(baseline, cycles(20), 20);
  const distorted = judge(baseline, cycles(20, () => tone(30)), 20);

  it("reads a failed step as NOT CHECKED <step> however many cycles were banked", () => {
    expect(readingWord(clean, 20, "resume-14")).toBe("NOT CHECKED resume-14");
    expect(readingWord(distorted, 20, "resume-14")).toBe("NOT CHECKED resume-14");
    expect(readingWord(clean, 3, "suspend-4")).toBe("NOT CHECKED suspend-4");
  });

  it("names the cycle count and the silent baseline, else the judgement's word", () => {
    expect(readingWord(judge(baseline, cycles(5), 5), 5, null)).toBe("NOT CHECKED 5-cycles");
    expect(readingWord(judge(silent(), cycles(20), 20), 20, null)).toBe("NOT CHECKED no-signal");
    expect(readingWord(clean, 20, null)).toBe("CLEAN");
    expect(readingWord(distorted, 20, null)).toBe("DISTORTED");
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
    const judged = judge(tone(60), cycles(20, (i) => tone(60, 0, i === 3 ? clicks : 0)), 20);
    expect(judged.verdict).toBe("DISTORTED");
  });
});

describe("judgeHalfRate", () => {
  const second = (ratio: number) => ({ contextAdvanceSec: ratio, wallAdvanceSec: 1 });
  const before = { contextAdvanceSec: 2, wallAdvanceSec: 2 };

  it("reads a clock that drops to half speed and stays there as half rate, from the first slow window", () => {
    const judged = judgeHalfRate(before, [1.0, 1.0, 0.5, 0.5, 0.5].map(second));
    expect(judged.halfRate).toBe(true);
    expect(judged.firstHalfCycle).toBe(2);
    expect(judged.ratioBefore).toBeCloseTo(1, 6);
    expect(judged.ratios).toEqual([1.0, 1.0, 0.5, 0.5, 0.5]);
  });

  it("does not read a single slow window that recovers as half rate", () => {
    const judged = judgeHalfRate(before, [1.0, 0.5, 1.0, 1.0].map(second));
    expect(judged.halfRate).toBe(false);
    expect(judged.firstHalfCycle).toBeNull();
  });

  it("does not read one slow window at the very end as half rate: it must hold for two", () => {
    expect(judgeHalfRate(before, [1.0, 1.0, 0.5].map(second)).halfRate).toBe(false);
  });

  it("does not judge against a clock that was already slow before the cycles", () => {
    expect(judgeHalfRate({ contextAdvanceSec: 1.6, wallAdvanceSec: 2 }, [0.5, 0.5].map(second)).halfRate).toBe(false);
  });
});
