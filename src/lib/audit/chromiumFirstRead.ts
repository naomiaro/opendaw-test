/**
 * Chromium 571344687: a worklet processor constructed right after `addModule()` resolves
 * reads, in its constructor and first `process()`, a clock from about the moment module
 * loading started; the second `process()` jumps to the true frame. This file holds the
 * judgement, pure and Node-testable; the browser half is `chromiumFirstReadProbe.ts`.
 */

export const FIRST_READ_QUANTUM = 128;

/** Below this many runs a variant is not judged. */
export const FIRST_READ_MIN_SAMPLES = 3;

/** One node's clock reads, all in frames at the context rate. */
export interface FirstReadSample {
  /** `Math.round(context.currentTime * sampleRate)` on the main thread just before `new AudioWorkletNode`. */
  creationFrame: number;
  /** `currentFrame` in the processor's constructor. */
  constructorFrame: number;
  /** `currentFrame` in the processor's first three `process()` calls. */
  processFrames: [number, number, number];
}

export type FirstReadVerdict = "STALE FIRST READ" | "FIRST READ TRUE" | "NOT CHECKED";

export interface FirstReadJudgement {
  verdict: FirstReadVerdict;
  /** Runs whose constructor read lags the node's creation by more than a quantum AND whose second call jumps. */
  staleRuns: number;
  /** The most any constructor read lagged the node's creation, in quanta; 0 when none lagged. */
  largestLagQuanta: number;
  /** Each run's step from the first `process()` to the second, in quanta (1 is a true clock). */
  jumpQuanta: number[];
}

/** The issue's signature: the first read lags the node's creation, and the second call jumps. */
export function isStaleFirstRead(sample: FirstReadSample, quantum: number = FIRST_READ_QUANTUM): boolean {
  const lags = sample.constructorFrame < sample.creationFrame - quantum;
  const jumps = sample.processFrames[1] - sample.processFrames[0] > quantum;
  return lags && jumps;
}

export function judgeFirstRead(samples: FirstReadSample[], quantum: number = FIRST_READ_QUANTUM): FirstReadJudgement {
  const staleRuns = samples.filter((sample) => isStaleFirstRead(sample, quantum)).length;
  const largestLagQuanta = samples.reduce(
    (most, sample) => Math.max(most, (sample.creationFrame - sample.constructorFrame) / quantum),
    0
  );
  const jumpQuanta = samples.map((sample) => (sample.processFrames[1] - sample.processFrames[0]) / quantum);
  const verdict: FirstReadVerdict =
    samples.length < FIRST_READ_MIN_SAMPLES ? "NOT CHECKED"
    : staleRuns > 0 ? "STALE FIRST READ"
    : "FIRST READ TRUE";
  return { verdict, staleRuns, largestLagQuanta, jumpQuanta };
}
