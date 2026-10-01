/**
 * The delay of a `MediaStreamAudioSourceNode`, read on the context clock.
 *
 * A source node hands its stream on with a delay of its own, set when the node
 * starts: two nodes on the same stream, created in one task, are a render
 * quantum apart in a third to a half of the pairs. So the delay of the node a capture
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
  /** Quanta inside the range that no chunk delivered. Counted in steps of a quantum
   *  from `firstFrame`, so it holds when `firstFrame` is a frame a quantum starts at. */
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
/** The longest delay looked for, five times the longest measured (22.8 ms). */
export const NODE_TAP_MAX_LAG_SEC = 0.12;
/**
 * The loopback path is a delay of whole frames and nothing else, so at the right
 * lag the two recordings are the same numbers: the mean absolute difference
 * measured there is 0, and 0.001 or more at the next best lag. A match whose
 * difference is above this is not a delay that was read.
 */
export const NODE_TAP_EXACT_MAX = 1e-9;
/** A next best lag that differs by less than this matches too: the delay is not read. */
export const NODE_TAP_RUNNER_UP_MIN = 1e-4;

export const NODE_TAP_PROCESSOR = "loopback-node-tap";
/**
 * The recorder behind the taps, as the text of an AudioWorklet module: it copies
 * its input, one render quantum per `process` call, and stamps each with
 * `currentFrame`. With `quanta` above zero it stops after that many; with zero
 * it runs for as long as the node lives. It posts every `chunkQuanta` quanta,
 * and what is left when it stops. A quantum without an input channel is
 * stamped and left at zero.
 */
export const NODE_TAP_PROCESSOR_SOURCE = `
class LoopbackNodeTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.quanta = options.processorOptions.quanta;
    this.chunkQuanta = options.processorOptions.chunkQuanta;
    this.done = 0;
    this.begin();
  }
  begin() {
    this.samples = new Float32Array(this.chunkQuanta * ${NODE_TAP_QUANTUM_FRAMES});
    this.frames = new Float64Array(this.chunkQuanta);
    this.count = 0;
  }
  process(inputs) {
    if (this.quanta > 0 && this.done >= this.quanta) return false;
    const input = inputs[0];
    this.frames[this.count] = currentFrame;
    if (input.length > 0) this.samples.set(input[0], this.count * ${NODE_TAP_QUANTUM_FRAMES});
    this.count++;
    this.done++;
    if (this.count === this.chunkQuanta || (this.quanta > 0 && this.done === this.quanta)) {
      this.port.postMessage(
        { frames: this.frames, samples: this.samples, count: this.count },
        [this.frames.buffer, this.samples.buffer]
      );
      this.begin();
    }
    return true;
  }
}
registerProcessor("${NODE_TAP_PROCESSOR}", LoopbackNodeTap);
`;

/** A `process` call whose `currentFrame` was not one quantum after the call before it. */
export interface ClockDiscontinuity {
  previousFrame: number;
  frame: number;
  /** True when the two calls are in different posted chunks: a chunk that never arrived looks the same. */
  betweenChunks: boolean;
}

/**
 * The calls among `chunks` whose `currentFrame` is not exactly one quantum after the
 * previous call's. `previousFrame` is the last frame of an earlier batch, null for the
 * first. A worklet's clock can stand still for a call while the main thread changes the
 * audio graph: that shows INSIDE a chunk, as a frame equal to the one before it and then
 * a step of two quanta. A step BETWEEN two chunks is either the clock or a posted chunk
 * that was lost.
 */
export function frameDiscontinuities(
  chunks: readonly TapChunk[],
  previousFrame: number | null
): { found: ClockDiscontinuity[]; lastFrame: number | null } {
  const found: ClockDiscontinuity[] = [];
  let last = previousFrame;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.count; index++) {
      const frame = chunk.frames[index];
      if (last !== null && frame !== last + NODE_TAP_QUANTUM_FRAMES) {
        found.push({ previousFrame: last, frame, betweenChunks: index === 0 });
      }
      last = frame;
    }
  }
  return { found, lastFrame: last };
}

/**
 * Put each call's stamp where the call really was. A worklet's `currentFrame` can be
 * behind for a call, never ahead: a stamp less than one quantum after the call before it
 * is moved to exactly that; a stamp at or beyond it stays (a recorder that was not called
 * for a while jumps forward). The first stamp of a recorder stays as read, so a recorder
 * whose very first call read a stale clock keeps that call one quantum early.
 * Rewrites `frames` in place; returns how many stamps it moved.
 */
export function repairFrames(
  chunks: readonly TapChunk[],
  previousFrame: number | null
): { repaired: number; lastFrame: number | null } {
  let repaired = 0;
  let last = previousFrame;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.count; index++) {
      if (last !== null && chunk.frames[index] < last + NODE_TAP_QUANTUM_FRAMES) {
        chunk.frames[index] = last + NODE_TAP_QUANTUM_FRAMES;
        repaired++;
      }
      last = chunk.frames[index];
    }
  }
  return { repaired, lastFrame: last };
}

/**
 * Lay chunks out from `firstFrame` over `lengthFrames`, each quantum at the
 * frame it is stamped with. Never by position in the chunk: a recorder can
 * miss a quantum, and everything after it would sit a quantum off. The stamps
 * are expected REPAIRED (`repairFrames`): a worklet's clock can stand still for
 * a call, and a quantum laid out by such a stamp lands on top of the one before
 * it and leaves its own place empty.
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
  /** How close the tap comes to the reference at that lag; 0 is the same numbers. */
  meanAbsDifference: number;
  /** The same at the next best lag; null when only one lag could be compared. */
  runnerUpMeanAbsDifference: number | null;
  /** Lags whose stretch of the reference is not all there, and were left out. */
  lagsNotCompared: number;
}

/**
 * The lag at which `tap` from `windowStartFrame` on comes closest to
 * `reference` that many frames earlier; `meanAbsDifference` says how close.
 * Lags from 0 to `maxLagFrames` are tried; one whose stretch of the reference
 * is not all there is left out and counted. Null when the tap's own window is
 * not all there, or no lag could be compared.
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
  let lagsNotCompared = 0;
  for (let lag = 0; lag <= maxLagFrames; lag++) {
    const refAt = windowStartFrame - lag - reference.firstFrame;
    if (refAt < 0 || refAt + windowFrames > reference.samples.length) { lagsNotCompared++; continue; }
    let sum = 0;
    for (let k = 0; k < windowFrames; k++) {
      sum += Math.abs(tap.samples[tapAt + k] - reference.samples[refAt + k]);
    }
    if (Number.isNaN(sum)) { lagsNotCompared++; continue; }
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
    runnerUpMeanAbsDifference: runnerUp === Infinity ? null : runnerUp / windowFrames,
    lagsNotCompared,
  };
}

export interface NodeTapWindow extends LagMatch {
  /** Context frame the window opens at. */
  startFrame: number;
}

interface NodeDelayBase {
  /** Every window that was compared, whatever came of it. */
  windows: NodeTapWindow[];
  tapFirstFrame: number | null;
  /** Quanta the tap's recorder did not deliver, inside its own span. */
  tapMissingQuanta: number;
  /** Quanta the reference lacks over the stretch the tap was compared with. */
  referenceMissingQuanta: number;
  /** The whole tap stays under `NODE_TAP_LOUD`: what a node the SDK has dropped gives. */
  tapSilent: boolean;
}
export interface NodeDelayRead extends NodeDelayBase {
  delayFrames: number;
  delayMs: number;
  unmeasured: null;
}
export interface NodeDelayNotRead extends NodeDelayBase {
  delayFrames: null;
  delayMs: null;
  /** Why the delay was not read. */
  unmeasured: string;
}
/** The delay of one node, read or not: never a delay together with a reason. */
export type NodeDelayMeasurement = NodeDelayRead | NodeDelayNotRead;

/** A delay that was not read, and why. */
export function notMeasured(reason: string, known: Partial<NodeDelayBase> = {}): NodeDelayNotRead {
  return {
    delayFrames: null, delayMs: null, unmeasured: reason,
    windows: known.windows ?? [],
    tapFirstFrame: known.tapFirstFrame ?? null,
    tapMissingQuanta: known.tapMissingQuanta ?? 0,
    referenceMissingQuanta: known.referenceMissingQuanta ?? 0,
    tapSilent: known.tapSilent ?? false,
  };
}

/** How far before a tap's first frame the reference is needed: the longest lag, up to whole quanta. */
export function referenceLeadFrames(sampleRate: number, quantumFrames: number = NODE_TAP_QUANTUM_FRAMES): number {
  return Math.ceil(Math.round(sampleRate * NODE_TAP_MAX_LAG_SEC) / quantumFrames) * quantumFrames;
}

/** Whether the reference has reached the end of the tap: it posts in chunks and trails it. */
export function referenceCovers(
  referenceChunks: ReadonlyArray<TapChunk>,
  tapSpan: { firstFrame: number; endFrame: number }
): boolean {
  const covered = spanOf(referenceChunks);
  return covered !== null && covered.endFrame >= tapSpan.endFrame;
}

/** The chunks of the reference a tap is compared with: those that reach into the tap's span or its lead. */
export function referenceFor(
  referenceChunks: ReadonlyArray<TapChunk>,
  tapSpan: { firstFrame: number; endFrame: number },
  sampleRate: number
): TapChunk[] {
  const from = tapSpan.firstFrame - referenceLeadFrames(sampleRate);
  return referenceChunks.filter((chunk) => {
    const own = spanOf([chunk]);
    return own !== null && own.endFrame > from && own.firstFrame < tapSpan.endFrame;
  });
}

/** Drop from the head what ends more than `keepFrames` before the newest quantum. */
export function trimReference(referenceChunks: TapChunk[], keepFrames: number): void {
  const covered = spanOf(referenceChunks);
  if (covered === null) return;
  while (referenceChunks.length > 1) {
    const own = spanOf([referenceChunks[0]]);
    if (own !== null && own.endFrame >= covered.endFrame - keepFrames) return;
    referenceChunks.shift();
  }
}

/**
 * The delay of the node a tap listened to. It is read at three windows that do
 * not overlap, and counts as read only when every window was found, every match
 * is exact and clearly better than the next, and all three give the same lag. A
 * delay that moved inside the tap is not a delay of the take: it is reported as
 * not measured, with the three lags in the reason.
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
  if (span === null) return notMeasured("the tap recorded nothing");
  const tap = layOutRange(tapChunks, span.firstFrame, span.endFrame - span.firstFrame, quantumFrames);
  const maxLagFrames = Math.round(sampleRate * NODE_TAP_MAX_LAG_SEC);
  const lead = referenceLeadFrames(sampleRate, quantumFrames);
  const reference = layOutRange(referenceChunks, span.firstFrame - lead, tap.samples.length + lead, quantumFrames);
  let tapSilent = true;
  for (let i = 0; i < tap.samples.length; i++) {
    if (Math.abs(tap.samples[i]) > NODE_TAP_LOUD) { tapSilent = false; break; }
  }
  const windows: NodeTapWindow[] = [];
  const known = (): Partial<NodeDelayBase> => ({
    windows, tapFirstFrame: span.firstFrame, tapMissingQuanta: tap.missingQuanta,
    referenceMissingQuanta: reference.missingQuanta, tapSilent,
  });
  let free = 0; // the first frame of the tap no window has used
  for (const startSec of NODE_TAP_WINDOW_STARTS_SEC) {
    const from = Math.max(Math.round(startSec * sampleRate), free);
    if (from + NODE_TAP_WINDOW_FRAMES > tap.samples.length) {
      return notMeasured(
        `the tap is ${(tap.samples.length / sampleRate).toFixed(2)} s long: no room for a window from ${startSec} s on`, known()
      );
    }
    let loud = -1;
    for (let i = from; i + NODE_TAP_WINDOW_FRAMES <= tap.samples.length; i++) {
      if (Math.abs(tap.samples[i]) > NODE_TAP_LOUD) { loud = i; break; }
    }
    if (loud < 0) return notMeasured(`no signal in the tap from ${startSec} s on`, known());
    const opensAt = Math.max(free, loud - NODE_TAP_WINDOW_LEAD_FRAMES);
    free = opensAt + NODE_TAP_WINDOW_FRAMES;
    const startFrame = span.firstFrame + opensAt;
    const match = findLag(tap, reference, startFrame, NODE_TAP_WINDOW_FRAMES, maxLagFrames);
    if (match === null) {
      return notMeasured(
        `the window at frame ${startFrame} could not be compared (a quantum is missing from the tap, or the reference has none of that stretch)`,
        known()
      );
    }
    windows.push({ startFrame, ...match });
  }
  const inexact = windows.find((w) => w.meanAbsDifference > NODE_TAP_EXACT_MAX);
  if (inexact !== undefined) {
    return notMeasured(
      inexact.lagsNotCompared > 0
        ? `no match at frame ${inexact.startFrame} among the lags that could be compared; ${inexact.lagsNotCompared} could not be, the reference has a gap there`
        : `no exact match at frame ${inexact.startFrame}: mean difference ${inexact.meanAbsDifference.toExponential(2)} at the best lag (${inexact.lagFrames})`,
      known()
    );
  }
  const alone = windows.find((w) => w.runnerUpMeanAbsDifference === null);
  if (alone !== undefined) {
    return notMeasured(`only one lag could be compared at frame ${alone.startFrame}`, known());
  }
  const ambiguous = windows.find((w) => w.runnerUpMeanAbsDifference !== null && w.runnerUpMeanAbsDifference < NODE_TAP_RUNNER_UP_MIN);
  if (ambiguous !== undefined) {
    return notMeasured(
      `two lags match at frame ${ambiguous.startFrame}: the next best differs by ${ambiguous.runnerUpMeanAbsDifference!.toExponential(2)}`,
      known()
    );
  }
  const lags = windows.map((w) => w.lagFrames);
  if (lags.some((lag) => lag !== lags[0])) {
    return notMeasured(`the delay moved inside the tap: ${lags.join(" / ")} frames`, known());
  }
  return {
    delayFrames: lags[0],
    delayMs: (lags[0] / sampleRate) * 1000,
    unmeasured: null,
    windows,
    tapFirstFrame: span.firstFrame,
    tapMissingQuanta: tap.missingQuanta,
    referenceMissingQuanta: reference.missingQuanta,
    tapSilent,
  };
}

/** What a tap on one source node brought back; `SourceNodeRecording` of `loopbackInjection.ts` is one. */
export interface TappedNode {
  deviceId: string;
  /** Why there is nothing to measure, or null. */
  failed: string | null;
  tapChunks: ReadonlyArray<TapChunk>;
  referenceChunks: ReadonlyArray<TapChunk>;
}

export interface TapeNodeDelay<T extends TappedNode> {
  /** The tap the measurement is of; null when none was singled out. */
  tap: T | null;
  measurement: NodeDelayMeasurement;
  /** Taps on this tape's device that are not silent: nodes that may be the one recording. */
  candidates: number;
}

/**
 * The delay of the source node a tape recorded through, from the taps of its
 * repeat. Every node built on the tape's device since the last repeat was
 * tapped. A node the SDK has dropped is silent, its stream's tracks being
 * stopped; the one that is not is the one recording. With more than one that
 * is not silent, which of them recorded is not known and no delay is given.
 * The same holds for two tapes on one device id. `tapsFailure` is why there are
 * no taps at all, when the call for them failed.
 */
export function nodeDelayFor<T extends TappedNode>(
  taps: ReadonlyArray<T>,
  deviceId: string,
  otherDeviceId: string,
  sampleRate: number,
  tapsFailure: string | null = null
): TapeNodeDelay<T> {
  const none = (reason: string, candidates: number = 0): TapeNodeDelay<T> =>
    ({ tap: null, measurement: notMeasured(reason), candidates });
  if (tapsFailure !== null) return none(`the taps could not be taken: ${tapsFailure}`);
  if (deviceId === otherDeviceId) return none("both tapes record from one device id");
  const own = taps.filter((tap) => tap.deviceId === deviceId);
  if (own.length === 0) {
    const tapped = [...new Set(taps.map((tap) => tap.deviceId))];
    return none(`no source node was tapped on ${deviceId} (tapped: ${tapped.length > 0 ? tapped.join(", ") : "none"})`);
  }
  const measured = own.map((tap) => {
    if (tap.failed !== null) return { tap, measurement: notMeasured(tap.failed) as NodeDelayMeasurement };
    try {
      return { tap, measurement: measureNodeDelay(tap.tapChunks, tap.referenceChunks, sampleRate) };
    } catch (error) {
      return { tap, measurement: notMeasured(`the tap could not be measured: ${String(error)}`) as NodeDelayMeasurement };
    }
  });
  const candidates = measured.filter((m) => !m.measurement.tapSilent);
  if (candidates.length > 1) {
    return none(
      `${candidates.length} source nodes on ${deviceId} carry signal: which one recorded is not known`, candidates.length
    );
  }
  const chosen = candidates.length === 1 ? candidates[0] : measured[measured.length - 1];
  return { ...chosen, candidates: candidates.length };
}
