/**
 * The delay of a `MediaStreamAudioSourceNode`, read on the context clock.
 *
 * A source node hands its stream on with a delay of its own, set when the node
 * starts: two nodes on the same stream, created in one task, are a render
 * quantum apart in about half the pairs. So the delay of the node a capture
 * records through can only be read by listening to THAT node. The harness
 * attaches a recorder to it (`loopbackInjection.ts`), and another to what goes
 * into the stream; both stamp every render quantum with the context's frame
 * counter. The node's delay is the lag, in whole frames, at which the two
 * recordings are equal. Nothing of the SDK's enters the figure.
 *
 * No SDK or DOM imports: everything here runs in Node.
 */

/** What one recorder posts: `count` render quanta, each stamped with the frame it was rendered at. */
export interface TapChunk {
  /** `currentFrame` of each quantum; entries from `count` on are unused. */
  frames: Float64Array;
  /** `count × quantumFrames` samples; the rest is unused. */
  samples: Float32Array;
  count: number;
}

/** A recording on the context's frame axis. A quantum that was never delivered is NaN. */
export interface LaidOutRecording {
  firstFrame: number;
  samples: Float32Array;
  /** Quanta inside the range that no chunk delivered. */
  missingQuanta: number;
}

export const NODE_TAP_QUANTUM_FRAMES = 128;
/** Where in the tap a window is looked for, in seconds from the tap's first frame. */
export const NODE_TAP_WINDOW_STARTS_SEC: readonly number[] = [0.3, 0.9, 1.5];
/** How long a tap records: past the last window start, with room for the window. */
export const NODE_TAP_SECONDS = 2;
export const NODE_TAP_WINDOW_FRAMES = 512;
/** A window opens this many frames before the first loud sample, so it holds the attack. */
export const NODE_TAP_WINDOW_LEAD_FRAMES = 64;
/** A sample this far from zero is signal: the reference clicks peak at 0.5. */
export const NODE_TAP_LOUD = 0.05;
/** The longest delay looked for. The longest measured is 23.2 ms. */
export const NODE_TAP_MAX_LAG_SEC = 0.12;
/**
 * The loopback path is a delay of whole frames and nothing else, so at the right
 * lag the two recordings are the same numbers: the mean absolute difference
 * measured there is 0, and 0.009 or more at the next best lag. A match above the
 * first or a runner-up below the second is not a delay that was read.
 */
export const NODE_TAP_EXACT_MAX = 1e-9;
export const NODE_TAP_RUNNER_UP_MIN = 1e-4;

/**
 * Lay chunks out from `firstFrame` over `lengthFrames`, each quantum at the
 * frame it was stamped with. Never by position in the chunk: a recorder can
 * miss a quantum, or deliver two with the same stamp, and everything after it
 * would sit a quantum off.
 */
export function layOutRange(
  chunks: ReadonlyArray<TapChunk>,
  firstFrame: number,
  lengthFrames: number,
  quantumFrames: number = NODE_TAP_QUANTUM_FRAMES
): LaidOutRecording {
  if (!Number.isInteger(lengthFrames) || lengthFrames < 0) {
    throw new RangeError(`length must be a whole number of frames, zero or more; got ${lengthFrames}`);
  }
  const samples = new Float32Array(lengthFrames).fill(NaN);
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.count; i++) {
      const at = chunk.frames[i] - firstFrame;
      if (at < 0 || at + quantumFrames > lengthFrames) continue;
      samples.set(chunk.samples.subarray(i * quantumFrames, (i + 1) * quantumFrames), at);
    }
  }
  let missingQuanta = 0;
  for (let at = 0; at + quantumFrames <= lengthFrames; at += quantumFrames) {
    if (Number.isNaN(samples[at])) missingQuanta++;
  }
  return { firstFrame, samples, missingQuanta };
}

/** The span the chunks cover, first stamped frame to the end of the last stamped quantum. Null without a quantum. */
export function spanOf(
  chunks: ReadonlyArray<TapChunk>,
  quantumFrames: number = NODE_TAP_QUANTUM_FRAMES
): { firstFrame: number; endFrame: number } | null {
  let first = Infinity;
  let last = -Infinity;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.count; i++) {
      if (chunk.frames[i] < first) first = chunk.frames[i];
      if (chunk.frames[i] > last) last = chunk.frames[i];
    }
  }
  return first === Infinity ? null : { firstFrame: first, endFrame: last + quantumFrames };
}

export interface LagMatch {
  lagFrames: number;
  meanAbsDifference: number;
  /** The same at the next best lag; Infinity when only one lag could be compared. */
  runnerUpMeanAbsDifference: number;
}

/**
 * The lag at which `tap` from `windowStartFrame` on equals `reference` that many
 * frames earlier. Lags from 0 to `maxLagFrames` are tried; one whose reference
 * window is not all there is left out. Null when the tap's own window is not
 * all there, or no lag could be compared.
 */
export function findLag(
  tap: LaidOutRecording,
  reference: LaidOutRecording,
  windowStartFrame: number,
  windowFrames: number,
  maxLagFrames: number
): LagMatch | null {
  const tapAt = windowStartFrame - tap.firstFrame;
  if (tapAt < 0 || tapAt + windowFrames > tap.samples.length) return null;
  for (let k = 0; k < windowFrames; k++) {
    if (Number.isNaN(tap.samples[tapAt + k])) return null;
  }
  let best = -1;
  let bestSum = Infinity;
  let runnerUp = Infinity;
  for (let lag = 0; lag <= maxLagFrames; lag++) {
    const refAt = windowStartFrame - lag - reference.firstFrame;
    if (refAt < 0 || refAt + windowFrames > reference.samples.length) continue;
    let sum = 0;
    for (let k = 0; k < windowFrames; k++) {
      sum += Math.abs(tap.samples[tapAt + k] - reference.samples[refAt + k]);
    }
    if (Number.isNaN(sum)) continue;
    if (sum < bestSum) {
      runnerUp = bestSum;
      bestSum = sum;
      best = lag;
    } else if (sum < runnerUp) {
      runnerUp = sum;
    }
  }
  if (best < 0) return null;
  return {
    lagFrames: best,
    meanAbsDifference: bestSum / windowFrames,
    runnerUpMeanAbsDifference: runnerUp / windowFrames,
  };
}

export interface NodeTapWindow {
  /** Context frame the window opens at. */
  startFrame: number;
  lagFrames: number;
  meanAbsDifference: number;
  runnerUpMeanAbsDifference: number;
}

export interface NodeDelayMeasurement {
  /** The node's delay; null when it was not read, and `unmeasured` says why. */
  delayFrames: number | null;
  delayMs: number | null;
  unmeasured: string | null;
  /** Every window that was compared, whatever came of it. */
  windows: NodeTapWindow[];
  tapFirstFrame: number | null;
  /** Quanta the tap's recorder did not deliver, inside its own span. */
  tapMissingQuanta: number;
}

function unmeasured(
  reason: string,
  windows: NodeTapWindow[] = [],
  tapFirstFrame: number | null = null,
  tapMissingQuanta: number = 0
): NodeDelayMeasurement {
  return { delayFrames: null, delayMs: null, unmeasured: reason, windows, tapFirstFrame, tapMissingQuanta };
}

/**
 * The delay of the node a tap listened to. It is read at three windows and
 * counts as read only when every window was found, every match is exact and
 * clearly better than the next, and all three give the same lag. A delay that
 * moved inside the tap is not a delay of the take: it is reported as not
 * measured, with the three lags in the reason.
 */
export function measureNodeDelay(
  tapChunks: ReadonlyArray<TapChunk>,
  referenceChunks: ReadonlyArray<TapChunk>,
  sampleRate: number,
  quantumFrames: number = NODE_TAP_QUANTUM_FRAMES
): NodeDelayMeasurement {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`sample rate must be above zero; got ${sampleRate}`);
  }
  const span = spanOf(tapChunks, quantumFrames);
  if (span === null) return unmeasured("the tap recorded nothing");
  const tap = layOutRange(tapChunks, span.firstFrame, span.endFrame - span.firstFrame, quantumFrames);
  const maxLagFrames = Math.round(sampleRate * NODE_TAP_MAX_LAG_SEC);
  const reference = layOutRange(
    referenceChunks, span.firstFrame - maxLagFrames, tap.samples.length + maxLagFrames, quantumFrames
  );
  const windows: NodeTapWindow[] = [];
  for (const startSec of NODE_TAP_WINDOW_STARTS_SEC) {
    const from = Math.round(startSec * sampleRate);
    let loud = -1;
    for (let i = from; i + NODE_TAP_WINDOW_FRAMES <= tap.samples.length; i++) {
      if (Math.abs(tap.samples[i]) > NODE_TAP_LOUD) { loud = i; break; }
    }
    if (loud < 0) {
      return unmeasured(
        `no signal in the tap from ${startSec} s on`, windows, span.firstFrame, tap.missingQuanta
      );
    }
    const startFrame = span.firstFrame + Math.max(0, loud - NODE_TAP_WINDOW_LEAD_FRAMES);
    const match = findLag(tap, reference, startFrame, NODE_TAP_WINDOW_FRAMES, maxLagFrames);
    if (match === null) {
      return unmeasured(
        `the window at frame ${startFrame} could not be compared (a quantum is missing from the tap or from the reference)`,
        windows, span.firstFrame, tap.missingQuanta
      );
    }
    windows.push({ startFrame, ...match });
  }
  const inexact = windows.find((w) => w.meanAbsDifference > NODE_TAP_EXACT_MAX);
  if (inexact !== undefined) {
    return unmeasured(
      `no exact match at frame ${inexact.startFrame}: mean difference ${inexact.meanAbsDifference.toExponential(2)} at the best lag (${inexact.lagFrames})`,
      windows, span.firstFrame, tap.missingQuanta
    );
  }
  const ambiguous = windows.find((w) => w.runnerUpMeanAbsDifference < NODE_TAP_RUNNER_UP_MIN);
  if (ambiguous !== undefined) {
    return unmeasured(
      `two lags match at frame ${ambiguous.startFrame}: the next best differs by ${ambiguous.runnerUpMeanAbsDifference.toExponential(2)}`,
      windows, span.firstFrame, tap.missingQuanta
    );
  }
  const lags = windows.map((w) => w.lagFrames);
  if (lags.some((lag) => lag !== lags[0])) {
    return unmeasured(
      `the delay moved inside the tap: ${lags.join(" / ")} frames`, windows, span.firstFrame, tap.missingQuanta
    );
  }
  return {
    delayFrames: lags[0],
    delayMs: (lags[0] / sampleRate) * 1000,
    unmeasured: null,
    windows,
    tapFirstFrame: span.firstFrame,
    tapMissingQuanta: tap.missingQuanta,
  };
}
