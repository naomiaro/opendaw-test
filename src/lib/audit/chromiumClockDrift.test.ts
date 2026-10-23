import { describe, expect, it } from "vitest";
import {
  CLOCK_DRIFT_PHASES, findSteps, judgeClockDrift, latticeFit, offsetFrames, rampFramesPerSec, STEP_MIN_FRAMES_OF_QUANTUM, summarisePhases,
  type ClockSample, type PhaseSummary,
} from "./chromiumClockDrift";

const RATE = 44100;
const QUANTUM = 128;

/** A sample series: the relation offset by `offsetFrames` (context ahead of performance) at each tick of 10 ms. */
function series(points: Array<{ t: number; offset: number; phase?: ClockSample["phase"]; visibility?: ClockSample["visibility"]; latency?: number }>): ClockSample[] {
  return points.map(({ t, offset, phase = "idle", visibility = "visible", latency = 23 }) => ({
    perfMs: t,
    performanceTime: t,
    contextTime: 10 + t / 1000 + offset / RATE,
    outputLatencyMs: latency,
    visibility,
    phase,
  }));
}

describe("offsetFrames", () => {
  it("reads the relation's movement from the first sample in frames at the context rate", () => {
    const [first, later] = series([{ t: 0, offset: 0 }, { t: 1000, offset: 128 }]);
    expect(offsetFrames(later, first, RATE)).toBeCloseTo(128, 3);
    expect(offsetFrames(first, first, RATE)).toBe(0);
    const [, back] = series([{ t: 0, offset: 0 }, { t: 1000, offset: -64 }]);
    expect(offsetFrames(back, first, RATE)).toBeCloseTo(-64, 3);
  });
});

describe("findSteps", () => {
  it("finds a change of more than half a quantum between consecutive samples, with its size and time", () => {
    expect(STEP_MIN_FRAMES_OF_QUANTUM).toBe(0.5);
    const samples = series([{ t: 0, offset: 0 }, { t: 10, offset: 2 }, { t: 20, offset: 130 }, { t: 30, offset: 131 }, { t: 40, offset: 3 }]);
    const steps = findSteps(samples, RATE);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ atMs: 20, phase: "idle" });
    expect(steps[0].frames).toBeCloseTo(128, 3);
    expect(steps[1].frames).toBeCloseTo(-128, 3);
  });

  it("does not read a slow slope as steps, and gives nothing for fewer than two samples", () => {
    const slope = series(Array.from({ length: 100 }, (_, i) => ({ t: i * 10, offset: i * 2 })));
    expect(findSteps(slope, RATE)).toEqual([]);
    expect(findSteps(series([{ t: 0, offset: 0 }]), RATE)).toEqual([]);
  });
});

describe("latticeFit", () => {
  it("counts the steps within a quarter quantum of a multiple of 128 frames", () => {
    // 90 and 64 are more than 32 frames from any multiple of 128; 130 and -120 are within it.
    expect(latticeFit([128, -256, 130, 90, 64, -120])).toEqual({ onLattice: 4, offLattice: 2 });
    expect(latticeFit([])).toEqual({ onLattice: 0, offLattice: 0 });
  });
});

describe("summarisePhases", () => {
  it("gives each phase its samples, offset range, steps, lattice count and the latencies seen", () => {
    const samples = series([
      { t: 0, offset: 0 }, { t: 10, offset: 1 },
      { t: 20, offset: 1, phase: "jank" }, { t: 30, offset: 129, phase: "jank", latency: 23 }, { t: 40, offset: 129, phase: "jank", latency: 26 },
      { t: 50, offset: 129, phase: "hidden", visibility: "hidden" },
    ]);
    const phases = summarisePhases(samples, RATE);
    expect(phases.map((p) => p.phase)).toEqual(["idle", "jank", "hidden"]);
    expect(phases[0]).toMatchObject({ samples: 2, steps: [], outputLatenciesMs: [23] });
    expect(phases[0].minOffsetFrames).toBeCloseTo(0, 3);
    expect(phases[0].maxOffsetFrames).toBeCloseTo(1, 3);
    expect(phases[1].samples).toBe(3);
    expect(phases[1].steps).toHaveLength(1);
    expect(phases[1].steps[0].frames).toBeCloseTo(128, 3);
    expect(phases[1].lattice).toEqual({ onLattice: 1, offLattice: 0 });
    expect(phases[1].outputLatenciesMs).toEqual([23, 26]);
    expect(phases[2]).toMatchObject({ samples: 1, hiddenSamples: 1 });
    // The step into the first sample of a phase belongs to the phase that sample is in.
    const across = series([{ t: 0, offset: 0, phase: "idle" }, { t: 10, offset: 128, phase: "jank" }]);
    expect(summarisePhases(across, RATE)[1].steps).toHaveLength(1);
  });
});

describe("rampFramesPerSec", () => {
  it("reads the slope between steps: a sawtooth ramping 62 frames/s and snapping back reads +62, a flat series 0, one sample null", () => {
    // 4.5 s ramps of +62 frames/s, then a −278 snap, three teeth, sampled every 10 ms.
    const points: Array<{ t: number; offset: number }> = [];
    let offset = 0;
    for (let i = 0; i < 1350; i++) {
      const t = i * 10;
      if (i > 0 && i % 450 === 0) offset -= 278;
      points.push({ t, offset });
      offset += 0.62;
    }
    const samples = series(points);
    expect(rampFramesPerSec(samples, RATE)).toBeCloseTo(62, 0);
    expect(findSteps(samples, RATE)).toHaveLength(2);
    expect(rampFramesPerSec(series([{ t: 0, offset: 0 }, { t: 1000, offset: 0 }, { t: 2000, offset: 0 }]), RATE)).toBeCloseTo(0, 6);
    expect(rampFramesPerSec(series([{ t: 0, offset: 0 }]), RATE)).toBeNull();
  });

  it("is carried per phase by the summary", () => {
    const samples = series(Array.from({ length: 200 }, (_, i) => ({ t: i * 10, offset: i * 0.5, phase: i < 100 ? "idle" : "jank" })));
    const phases = summarisePhases(samples, RATE);
    expect(phases[0].rampFramesPerSec).toBeCloseTo(50, 0);
    expect(phases[1].rampFramesPerSec).toBeCloseTo(50, 0);
  });
});

describe("judgeClockDrift", () => {
  const phase = (name: PhaseSummary["phase"], steps: number[], samples = 2000, hiddenSamples = 0): PhaseSummary => ({
    phase: name,
    samples,
    hiddenSamples,
    minOffsetFrames: Math.min(0, ...steps),
    maxOffsetFrames: Math.max(0, ...steps),
    steps: steps.map((frames, i) => ({ frames, atMs: i * 1000, phase: name })),
    lattice: latticeFit(steps),
    rampFramesPerSec: 0,
    outputLatenciesMs: [23],
  });

  const steadyRun = (): PhaseSummary[] => CLOCK_DRIFT_PHASES.map((p) => phase(p, [], 2000, p === "hidden" ? 1500 : 0));

  it("reads a run with no step in any phase as steady", () => {
    const phases = steadyRun();
    expect(judgeClockDrift(phases, { hiddenRequested: true, contextState: "running" })).toMatchObject({ verdict: "STEADY" });
  });

  it("reads a step in any phase as steps, naming the phases and the lattice reading", () => {
    const phases = [phase("idle", []), phase("jank", [128, -128]), phase("graph", []), phase("hidden", [256], 2000, 1500)];
    const judged = judgeClockDrift(phases, { hiddenRequested: true, contextState: "running" });
    expect(judged.verdict).toBe("STEPS");
    expect(judged.reason).toMatch(/jank.*hidden/);
    expect(judged.reason).toMatch(/3 of 3 on the 128-frame lattice/);
  });

  it("does not judge a context that is not running, too few samples, or a hidden phase that never went hidden", () => {
    const steady = steadyRun();
    expect(judgeClockDrift(steady, { hiddenRequested: true, contextState: "suspended" }).verdict).toBe("NOT CHECKED context-suspended");
    expect(judgeClockDrift(steady.map((p) => ({ ...p, samples: 10 })), { hiddenRequested: true, contextState: "running" }).verdict).toBe("NOT CHECKED too-few-samples");
    const neverHidden = steady.map((p) => (p.phase === "hidden" ? { ...p, hiddenSamples: 0 } : p));
    expect(judgeClockDrift(neverHidden, { hiddenRequested: true, contextState: "running" }).verdict).toBe("NOT CHECKED hidden-never-happened");
    // With the hidden phase not requested, its absence is fine.
    const noHidden = steady.filter((p) => p.phase !== "hidden");
    expect(judgeClockDrift(noHidden, { hiddenRequested: false, contextState: "running" }).verdict).toBe("STEADY");
  });

  it("names the phases that stepped in the figures", () => {
    const phases = [phase("idle", [128]), phase("jank", []), phase("graph", []), phase("hidden", [], 2000, 1500)];
    const judged = judgeClockDrift(phases, { hiddenRequested: true, contextState: "running" });
    expect(judged.steppedPhases).toEqual(["idle"]);
    expect(judged.verdict).toBe("STEPS");
  });
});

describe("the quantum", () => {
  it("is 128 frames whatever the rate, so a step size reads the same at 44.1 and 48 kHz", () => {
    expect(QUANTUM).toBe(128);
    const s48 = series([{ t: 0, offset: 0 }, { t: 10, offset: 128 }]).map((s) => ({ ...s, contextTime: 10 + s.perfMs / 1000 + (s.perfMs === 0 ? 0 : 128 / 48000) }));
    expect(findSteps(s48, 48000)[0].frames).toBeCloseTo(128, 3);
  });
});
