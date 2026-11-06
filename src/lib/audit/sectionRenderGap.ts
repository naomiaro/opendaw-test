// What `OfflineEngineRenderer.renderSection` with `tail: false` does when the project's delay compensation
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
export type Jump = "none" | "on-boundary" | "off-boundary";

export interface RowReading {
  /** Reference hit minus section hit, for hits the output places before the boundary. Positive reads early. */
  earlyBefore: number[];
  /** The same for hits at or after it, and for every hit when the output holds no boundary. */
  earlyAfter: number[];
  jump: Jump;
  verdict: RowVerdict;
}

/** Frames lost at the first chunk boundary. A render that fits one chunk has no later step to lose them to. */
export function predictedDroppedFrames(latencyFrames: number, sectionFrames: number, passes: 1 | 2): number {
  if (sectionFrames * passes <= CHUNK_FRAMES) return 0;
  return (RENDER_QUANTUM - (latencyFrames % RENDER_QUANTUM)) % RENDER_QUANTUM;
}

/**
 * Where the first chunk boundary lands in the kept output. A second pass keeps the last section's worth
 * of frames, so a section of a chunk or more has it in the discarded first pass: null, as when the
 * render fits one chunk and has no boundary at all.
 */
export function boundaryInOutput(sectionFrames: number, passes: 1 | 2): number | null {
  const rendered = sectionFrames * passes;
  if (rendered <= CHUNK_FRAMES) return null;
  const boundary = CHUNK_FRAMES - (rendered - sectionFrames);
  return boundary > 0 ? boundary : null;
}

/** First frame over the threshold of each burst; a hit closer than `minGapFrames` belongs to the one before it. */
export function findHits(samples: Float32Array, threshold: number, minGapFrames: number): number[] {
  const hits: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (!(Math.abs(samples[i]) > threshold)) continue;
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

/** The largest move a sine of this level and frequency makes between neighbouring samples. */
export function toneStep(level: number, hz: number, sampleRate: number): number {
  return level * 2 * Math.sin((Math.PI * hz) / sampleRate);
}

/**
 * The one shift every hit shows, or null when they disagree or one is missing. It reads a no-latency
 * render as a baseline, and a real gap must not pass as one.
 */
export function uniformEarly(sliceHits: number[], sectionHits: number[]): number | null {
  if (sliceHits.length === 0 || sliceHits.length !== sectionHits.length) return null;
  const early = sliceHits[0] - sectionHits[0];
  return sliceHits.every((hit, index) => hit - sectionHits[index] === early) ? early : null;
}

// A two-pass render at 44.1 kHz of a 48 kHz source reads 1 frame early with no latency, not explained.
// More than that is not this baseline: a second defect must not pass through it as a uniform shift.
const MAX_BASELINE_FRAMES = 1;

/** The shift a no-latency two-pass render shows, or null when it cannot serve as a baseline. */
export function readBaseline(sliceHits: number[], sectionHits: number[]): number | null {
  const early = uniformEarly(sliceHits, sectionHits);
  return early !== null && Math.abs(early) <= MAX_BASELINE_FRAMES ? early : null;
}

// A tone's own largest step varies by a hair, so a jump is what stands well clear of it.
const STEP_RATIO = 2;
// One frame of slack. Every join measured so far arrives exactly on the boundary.
const BOUNDARY_TOLERANCE_FRAMES = 1;

/**
 * What a sine moves across a join that drops `dropped` frames at `boundaryFrame`. It depends on the
 * tone's phase there as well as the shift: at the same level on both sides, a join hardly moves at all.
 */
export function joinMove(level: number, hz: number, sampleRate: number, boundaryFrame: number, dropped: number): number {
  const at = (frame: number): number => level * Math.sin((2 * Math.PI * hz * frame) / sampleRate);
  return Math.abs(at(boundaryFrame + dropped) - at(boundaryFrame - 1));
}

/** Whether the largest-step reading can tell this join from the tone itself. */
export function jumpIsReadable(level: number, hz: number, sampleRate: number, boundaryFrame: number, dropped: number): boolean {
  return joinMove(level, hz, sampleRate, boundaryFrame, dropped) > toneStep(level, hz, sampleRate) * STEP_RATIO;
}

export function readRow(input: {
  /** From `boundaryInOutput`. */
  boundaryFrame: number | null;
  predicted: number;
  /** What a render of the same passes shows with no latency, which this defect cannot explain. */
  baseline?: number;
  /** False when the tone sits so that this join moves too little to read. From `jumpIsReadable`. */
  jumpReadable?: boolean;
  sliceHits: number[];
  sectionHits: number[];
  sliceStep: Step;
  sectionStep: Step;
}): RowReading {
  const { boundaryFrame, predicted, baseline = 0, jumpReadable = true, sliceHits, sectionHits, sliceStep, sectionStep } = input;
  const earlyBefore: number[] = [];
  const earlyAfter: number[] = [];
  sliceHits.forEach((hit, index) => {
    const early = hit - sectionHits[index];
    (boundaryFrame !== null && hit < boundaryFrame ? earlyBefore : earlyAfter).push(early);
  });

  const isJump = sectionStep.step > sliceStep.step * STEP_RATIO;
  const onBoundary =
    boundaryFrame !== null && Math.abs(sectionStep.frame - boundaryFrame) <= BOUNDARY_TOLERANCE_FRAMES;
  const jump: Jump = !isJump ? "none" : onBoundary ? "on-boundary" : "off-boundary";

  // With no boundary in the output nothing marks where the frames went, so there is no jump to expect.
  const expectedJump: Jump = predicted > 0 && boundaryFrame !== null && jumpReadable ? "on-boundary" : "none";
  const holds =
    sliceHits.length > 0 &&
    sliceHits.length === sectionHits.length &&
    (predicted === 0 || earlyAfter.length > 0) &&
    earlyBefore.every((early) => early === baseline) &&
    earlyAfter.every((early) => early === predicted + baseline) &&
    jump === expectedJump;
  return { earlyBefore, earlyAfter, jump, verdict: holds ? "as-predicted" : "changed" };
}

// The tone is at a known level and the reference has no join, so its step is known to this much.
const REFERENCE_STEP_TOLERANCE = 0.05;
// A section may step more than the tone, which is the finding, but not less: then it did not sound.
const SECTION_STEP_FLOOR = 0.9;

/**
 * What stops a row from meaning anything, or null. A broken render must end the run with its stage named
 * and not reach the verdict, where it would read as a finding about the SDK.
 */
export function measurementProblem(input: {
  expectedHits: number;
  expectedFrames: number;
  expectedStep: number;
  burst: { sliceHits: number[]; sectionHits: number[]; sectionFrames: number };
  tone: { sliceStep: number; sectionStep: number; sectionFrames: number };
}): string | null {
  const { expectedHits, expectedFrames, expectedStep, burst, tone } = input;
  if (burst.sliceHits.length !== expectedHits) {
    return `burst render: the reference has ${burst.sliceHits.length} of ${expectedHits} hits`;
  }
  if (burst.sectionHits.length === 0) return "burst render: renderSection has no hits";
  if (burst.sectionFrames !== expectedFrames) {
    return `burst render: renderSection returned ${burst.sectionFrames} frames, expected ${expectedFrames}`;
  }
  if (tone.sectionFrames !== expectedFrames) {
    return `tone render: renderSection returned ${tone.sectionFrames} frames, expected ${expectedFrames}`;
  }
  if (Math.abs(tone.sliceStep - expectedStep) > expectedStep * REFERENCE_STEP_TOLERANCE) {
    return `tone render: the reference's largest step is ${tone.sliceStep.toFixed(4)}, expected ${expectedStep.toFixed(4)}`;
  }
  if (tone.sectionStep < expectedStep * SECTION_STEP_FLOOR) {
    return `tone render: renderSection's largest step is ${tone.sectionStep.toFixed(4)}, expected at least ${expectedStep.toFixed(4)}`;
  }
  return null;
}
