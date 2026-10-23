/**
 * Candidate Chromium issue (no tracker yet): the context ↔ performance relation that
 * `AudioContext.getOutputTimestamp()` reports moves in steps of whole render quanta during a
 * session while `outputLatency` stays put. Seen first on the MIDI output timing audit (up to two
 * quanta peak to peak within a 10 s repeat, 44.1 kHz, Chrome 155). This file holds the judgement,
 * pure and Node-testable; the browser half is `chromiumClockDriftProbe.ts`.
 */

export const CLOCK_DRIFT_PHASES = ["idle", "jank", "graph", "hidden"] as const;
export type ClockDriftPhase = (typeof CLOCK_DRIFT_PHASES)[number];

/** One read of the pair, on a worker tick. */
export interface ClockSample {
  perfMs: number;
  contextTime: number;
  performanceTime: number;
  outputLatencyMs: number;
  visibility: "visible" | "hidden";
  phase: ClockDriftPhase;
}

export const RENDER_QUANTUM_FRAMES = 128;
/** A change between consecutive samples counts as a step from this fraction of a quantum. */
export const STEP_MIN_FRAMES_OF_QUANTUM = 0.5;
/** A step size within this fraction of a quantum of a multiple of 128 frames is "on the lattice". */
const LATTICE_TOLERANCE_OF_QUANTUM = 0.25;

/** How far the relation has moved since `first`, in frames: positive when the same performance time maps later on the context clock. */
export function offsetFrames(sample: Pick<ClockSample, "contextTime" | "performanceTime">, first: Pick<ClockSample, "contextTime" | "performanceTime">, sampleRate: number): number {
  return ((sample.contextTime - sample.performanceTime / 1000) - (first.contextTime - first.performanceTime / 1000)) * sampleRate;
}

export interface ClockStep {
  /** Signed, in frames at the context rate. */
  frames: number;
  /** The performance time of the sample the step was read on. */
  atMs: number;
  phase: ClockDriftPhase;
}

/** Every change of more than half a quantum between consecutive samples; a slow slope never steps. */
export function findSteps(samples: readonly ClockSample[], sampleRate: number): ClockStep[] {
  if (samples.length < 2) return [];
  const first = samples[0];
  const steps: ClockStep[] = [];
  let previous = offsetFrames(first, first, sampleRate);
  for (let i = 1; i < samples.length; i++) {
    const current = offsetFrames(samples[i], first, sampleRate);
    const delta = current - previous;
    if (Math.abs(delta) > STEP_MIN_FRAMES_OF_QUANTUM * RENDER_QUANTUM_FRAMES) steps.push({ frames: delta, atMs: samples[i].perfMs, phase: samples[i].phase });
    previous = current;
  }
  return steps;
}

export interface LatticeFit {
  onLattice: number;
  offLattice: number;
}

export function latticeFit(stepFrames: readonly number[]): LatticeFit {
  const tolerance = LATTICE_TOLERANCE_OF_QUANTUM * RENDER_QUANTUM_FRAMES;
  let onLattice = 0;
  for (const frames of stepFrames) {
    const nearest = Math.round(frames / RENDER_QUANTUM_FRAMES) * RENDER_QUANTUM_FRAMES;
    if (nearest !== 0 && Math.abs(frames - nearest) <= tolerance) onLattice++;
  }
  return { onLattice, offLattice: stepFrames.length - onLattice };
}

/**
 * The slope of the relation BETWEEN steps, in frames per second: the median of the per-sample slopes with the
 * step samples left out, so a sawtooth reads its ramp and a flat series 0. Null with fewer than two samples.
 */
export function rampFramesPerSec(samples: readonly ClockSample[], sampleRate: number): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const stepThreshold = STEP_MIN_FRAMES_OF_QUANTUM * RENDER_QUANTUM_FRAMES;
  const slopes: number[] = [];
  let previousOffset = offsetFrames(first, first, sampleRate);
  for (let i = 1; i < samples.length; i++) {
    const offset = offsetFrames(samples[i], first, sampleRate);
    const dt = (samples[i].perfMs - samples[i - 1].perfMs) / 1000;
    const delta = offset - previousOffset;
    previousOffset = offset;
    if (dt <= 0 || Math.abs(delta) > stepThreshold) continue;
    slopes.push(delta / dt);
  }
  if (slopes.length === 0) return null;
  const sorted = [...slopes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface PhaseSummary {
  phase: ClockDriftPhase;
  samples: number;
  hiddenSamples: number;
  minOffsetFrames: number;
  maxOffsetFrames: number;
  steps: ClockStep[];
  lattice: LatticeFit;
  /** The ramp between steps, frames per second; null with fewer than two samples. */
  rampFramesPerSec: number | null;
  /** Distinct values, in the order first seen. */
  outputLatenciesMs: number[];
}

/** One summary per phase present, in the order the phases ran; offsets are from the run's FIRST sample, so phases compare. */
export function summarisePhases(samples: readonly ClockSample[], sampleRate: number): PhaseSummary[] {
  if (samples.length === 0) return [];
  const first = samples[0];
  const allSteps = findSteps(samples, sampleRate);
  const order: ClockDriftPhase[] = [];
  const byPhase = new Map<ClockDriftPhase, ClockSample[]>();
  for (const sample of samples) {
    if (!byPhase.has(sample.phase)) {
      byPhase.set(sample.phase, []);
      order.push(sample.phase);
    }
    byPhase.get(sample.phase)?.push(sample);
  }
  return order.map((phase) => {
    const own = byPhase.get(phase) ?? [];
    const offsets = own.map((s) => offsetFrames(s, first, sampleRate));
    const steps = allSteps.filter((s) => s.phase === phase);
    const latencies: number[] = [];
    for (const s of own) if (!latencies.includes(s.outputLatencyMs)) latencies.push(s.outputLatencyMs);
    return {
      phase,
      samples: own.length,
      hiddenSamples: own.filter((s) => s.visibility === "hidden").length,
      minOffsetFrames: Math.min(...offsets),
      maxOffsetFrames: Math.max(...offsets),
      steps,
      lattice: latticeFit(steps.map((s) => s.frames)),
      rampFramesPerSec: rampFramesPerSec(own, sampleRate),
      outputLatenciesMs: latencies,
    };
  });
}

export type ClockDriftVerdict = "STEPS" | "STEADY" | `NOT CHECKED ${string}`;

export interface ClockDriftJudgement {
  verdict: ClockDriftVerdict;
  steppedPhases: ClockDriftPhase[];
  totalSteps: number;
  lattice: LatticeFit;
  /** The reading in words, or why the run was not judged. */
  reason: string;
}

/** Fewer samples than this in any phase means the ticker did not run (a hidden page with a throttled worker, a page that never returned). */
export const MIN_SAMPLES_PER_PHASE = 50;

export function judgeClockDrift(
  phases: readonly PhaseSummary[],
  context: { hiddenRequested: boolean; contextState: string },
): ClockDriftJudgement {
  const steppedPhases = phases.filter((p) => p.steps.length > 0).map((p) => p.phase);
  const allSteps = phases.flatMap((p) => p.steps.map((s) => s.frames));
  const lattice = latticeFit(allSteps);
  const notChecked = (reason: string): ClockDriftJudgement => ({ verdict: `NOT CHECKED ${reason}`, steppedPhases, totalSteps: allSteps.length, lattice, reason });
  if (context.contextState !== "running") return notChecked(`context-${context.contextState}`);
  if (phases.length === 0 || phases.some((p) => p.samples < MIN_SAMPLES_PER_PHASE)) return notChecked("too-few-samples");
  if (context.hiddenRequested) {
    const hidden = phases.find((p) => p.phase === "hidden");
    if (hidden === undefined || hidden.hiddenSamples === 0) return notChecked("hidden-never-happened");
  }
  if (allSteps.length === 0) {
    return { verdict: "STEADY", steppedPhases, totalSteps: 0, lattice, reason: `no step over half a quantum in ${phases.map((p) => p.phase).join(", ")}` };
  }
  const sizes = allSteps.map((f) => Math.round(f)).join(", ");
  return {
    verdict: "STEPS",
    steppedPhases,
    totalSteps: allSteps.length,
    lattice,
    reason: `${allSteps.length} step(s) in ${steppedPhases.join(", ")}: ${sizes} frames; ${lattice.onLattice} of ${allSteps.length} on the 128-frame lattice`,
  };
}
