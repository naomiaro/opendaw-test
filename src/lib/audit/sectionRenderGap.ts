// What `OfflineEngineRenderer.renderSection` does to a section when the project's delay compensation
// is not a whole number of render quanta. Rendering in chunks loses the first chunk's remainder: the
// chunk is a whole number of quanta (375), the worker first drops the settled latency from the start
// of the output, so the chunk ends part way through a quantum, and `step` discards the rest of it.
// Everything rendered after that comes out early by the frames discarded.

export const RENDER_QUANTUM = 128;
export const CHUNK_FRAMES = RENDER_QUANTUM * 375;

export interface Step {
  step: number;
  frame: number;
}

export type RowVerdict = "as-predicted" | "changed";

export interface RowReading {
  /** Slice hit minus section hit, for hits before the first chunk boundary. Positive reads early. */
  earlyBefore: number[];
  /** The same for hits after it. */
  earlyAfter: number[];
  stepAtBoundary: boolean;
  verdict: RowVerdict;
}

/** Frames lost at the first chunk boundary. A render that fits one chunk has no later step to lose them to. */
export function predictedDroppedFrames(latencyFrames: number, sectionFrames: number, passes: 1 | 2): number {
  if (sectionFrames * passes <= CHUNK_FRAMES) return 0;
  return (RENDER_QUANTUM - (latencyFrames % RENDER_QUANTUM)) % RENDER_QUANTUM;
}

/** First frame over the threshold of each burst; a hit closer than `minGapFrames` belongs to the one before it. */
export function findHits(samples: Float32Array, threshold: number, minGapFrames: number): number[] {
  const hits: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) <= threshold) continue;
    if (i - last >= minGapFrames) hits.push(i);
    last = i;
  }
  return hits;
}

/** The largest move between neighbouring samples in [from, to), and the frame it arrives on. */
export function largestStep(samples: Float32Array, from: number, to: number): Step {
  let step = 0;
  let frame = -1;
  const end = Math.min(to, samples.length);
  for (let i = Math.max(1, from); i < end; i++) {
    const move = Math.abs(samples[i] - samples[i - 1]);
    if (move > step) {
      step = move;
      frame = i;
    }
  }
  return { step, frame };
}

// A tone's own largest step varies by a hair; a discontinuity is several times it.
const STEP_RATIO = 2;
// The first frame of the jump can land one away, depending on which sample holds the largest move.
const BOUNDARY_TOLERANCE_FRAMES = 1;

/**
 * The one shift every hit shows, or null when they disagree or one is missing. It reads a no-latency
 * render as a baseline, and a real gap must not pass as one.
 */
export function uniformEarly(sliceHits: number[], sectionHits: number[]): number | null {
  if (sliceHits.length === 0 || sliceHits.length !== sectionHits.length) return null;
  const early = sliceHits[0] - sectionHits[0];
  return sliceHits.every((hit, index) => hit - sectionHits[index] === early) ? early : null;
}

export function readRow(input: {
  boundaryFrame: number;
  predicted: number;
  passes: 1 | 2;
  /** What a render of the same passes shows with no latency, which this defect cannot explain. */
  baseline?: number;
  sliceHits: number[];
  sectionHits: number[];
  sliceStep: Step;
  sectionStep: Step;
}): RowReading {
  const { boundaryFrame, predicted, passes, baseline = 0, sliceHits, sectionHits, sliceStep, sectionStep } = input;
  const earlyBefore: number[] = [];
  const earlyAfter: number[] = [];
  sliceHits.forEach((hit, index) => {
    const early = hit - sectionHits[index];
    (hit < boundaryFrame ? earlyBefore : earlyAfter).push(early);
  });
  const stepAtBoundary =
    sectionStep.step > sliceStep.step * STEP_RATIO &&
    Math.abs(sectionStep.frame - boundaryFrame) <= BOUNDARY_TOLERANCE_FRAMES;

  // A second pass keeps only frames rendered after the boundary: every kept hit is early and the
  // jump lies in the discarded first pass.
  const expectedBefore = (passes === 2 ? predicted : 0) + baseline;
  const expectedAfter = predicted + baseline;
  const expectedJump = passes === 1 && predicted > 0;
  const holds =
    sliceHits.length === sectionHits.length &&
    earlyBefore.every((early) => early === expectedBefore) &&
    earlyAfter.every((early) => early === expectedAfter) &&
    stepAtBoundary === expectedJump;
  return { earlyBefore, earlyAfter, stepAtBoundary, verdict: holds ? "as-predicted" : "changed" };
}
