import { describe, expect, it } from "vitest";
import {
  findLag, layOutRange, measureNodeDelay, spanOf,
  NODE_TAP_QUANTUM_FRAMES, NODE_TAP_SECONDS,
  type TapChunk,
} from "./nodeTap";

const QUANTUM = NODE_TAP_QUANTUM_FRAMES;

/** What goes into the stream, as a function of the context frame: reference
 *  clicks (6 kHz, 8 ms, every 0.25 s, peak 0.5) over a quiet bed that never repeats. */
function streamInput(sampleRate: number): (frame: number) => number {
  const clickEvery = Math.round(sampleRate * 0.25);
  const clickFrames = Math.round(sampleRate * 0.008);
  const ramp = Math.round(sampleRate * 0.001);
  return (frame: number) => {
    if (frame < 0) return 0;
    // A hash of the frame: the same frame gives the same sample wherever it is asked for.
    let h = (frame + 1) * 2654435761;
    h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
    const bed = (((h >>> 0) / 0xffffffff) - 0.5) * 0.02;
    const inClick = frame % clickEvery;
    if (inClick >= clickFrames) return Math.fround(bed);
    const envelope = Math.min(1, inClick / ramp, (clickFrames - inClick) / ramp);
    return Math.fround(bed + 0.5 * envelope * Math.sin((2 * Math.PI * 6000 * inClick) / sampleRate));
  };
}

interface RecordOptions {
  /** Quanta (by index in the recording) the recorder never delivers. */
  skip?: number[];
  /** Quanta delivered twice under the stamp of the one before, the way a recorder has been seen to. */
  repeatStamp?: number[];
  quantaPerChunk?: number;
}

/** A recorder's chunks: `quanta` render quanta from `firstFrame`, each holding `source` at its own frame. */
function record(
  source: (frame: number) => number,
  firstFrame: number,
  quanta: number,
  options: RecordOptions = {}
): TapChunk[] {
  const perChunk = options.quantaPerChunk ?? 64;
  const chunks: TapChunk[] = [];
  let chunk: TapChunk | null = null;
  for (let q = 0; q < quanta; q++) {
    if (options.skip?.includes(q)) continue;
    if (chunk === null || chunk.count === perChunk) {
      chunk = { frames: new Float64Array(perChunk), samples: new Float32Array(perChunk * QUANTUM), count: 0 };
      chunks.push(chunk);
    }
    const frame = firstFrame + q * QUANTUM;
    chunk.frames[chunk.count] = options.repeatStamp?.includes(q) ? frame - QUANTUM : frame;
    for (let k = 0; k < QUANTUM; k++) chunk.samples[chunk.count * QUANTUM + k] = source(frame + k);
    chunk.count++;
  }
  return chunks;
}

const delayed = (source: (frame: number) => number, frames: number) => (frame: number) => source(frame - frames);
const tapQuanta = (sampleRate: number) => Math.ceil((sampleRate * NODE_TAP_SECONDS) / QUANTUM);

/** A tap attached at `tapFirst` to a node that delays the stream by `delayFrames`, and the reference beside it. */
function scene(sampleRate: number, delayFrames: number, tapFirst: number = 40 * QUANTUM) {
  const input = streamInput(sampleRate);
  return {
    input,
    tap: record(delayed(input, delayFrames), tapFirst, tapQuanta(sampleRate)),
    reference: record(input, 0, tapQuanta(sampleRate) + 200),
  };
}

describe("measureNodeDelay", () => {
  it.each([
    [48000, 448], [48000, 1024], [48000, 0], [44100, 561], [44100, 1003],
  ])("reads a delay of whole frames at %i Hz: %i", (sampleRate, delayFrames) => {
    const { tap, reference } = scene(sampleRate, delayFrames);
    const result = measureNodeDelay(tap, reference, sampleRate);
    expect(result.unmeasured).toBeNull();
    expect(result.delayFrames).toBe(delayFrames);
    expect(result.delayMs).toBeCloseTo((delayFrames / sampleRate) * 1000, 9);
    expect(result.windows).toHaveLength(3);
    expect(result.windows.every((w) => w.meanAbsDifference === 0)).toBe(true);
    expect(result.tapFirstFrame).toBe(40 * QUANTUM);
  });

  it("opens its windows on the signal, three different ones", () => {
    const { tap, reference } = scene(48000, 576);
    const starts = measureNodeDelay(tap, reference, 48000).windows.map((w) => w.startFrame);
    expect(new Set(starts).size).toBe(3);
    expect(starts[0]).toBeGreaterThanOrEqual(40 * QUANTUM + 0.3 * 48000 - 64);
    expect(starts[2]).toBeGreaterThanOrEqual(40 * QUANTUM + 1.5 * 48000 - 64);
  });

  it("places a quantum by its stamp when the recorder missed one before it", () => {
    const input = streamInput(48000);
    const tap = record(delayed(input, 896), 40 * QUANTUM, tapQuanta(48000), { skip: [1] });
    const result = measureNodeDelay(tap, record(input, 0, 1000), 48000);
    expect(result.delayFrames).toBe(896);
    expect(result.tapMissingQuanta).toBe(1);
  });

  it("does not read a delay through a quantum stamped like the one before it", () => {
    const input = streamInput(48000);
    const first = 40 * QUANTUM;
    const reference = record(input, 0, 1000);
    const clean = measureNodeDelay(record(delayed(input, 896), first, tapQuanta(48000)), reference, 48000);
    // The second quantum of the first window carries the stamp of the one before it:
    // that one is overwritten, and its own place stays empty.
    const inWindow = Math.floor((clean.windows[0].startFrame - first) / QUANTUM) + 1;
    const tap = record(delayed(input, 896), first, tapQuanta(48000), { repeatStamp: [inWindow] });
    const result = measureNodeDelay(tap, reference, 48000);
    expect(result.delayFrames).toBeNull();
    expect(result.unmeasured).toContain("could not be compared");
    expect(result.tapMissingQuanta).toBe(1);
  });

  it("reads the delay when the repeated stamp is outside every window", () => {
    const input = streamInput(48000);
    const tap = record(delayed(input, 896), 40 * QUANTUM, tapQuanta(48000), { repeatStamp: [20] });
    expect(measureNodeDelay(tap, record(input, 0, 1000), 48000).delayFrames).toBe(896);
  });

  it("reports a delay that moved inside the tap as not measured, with the lags", () => {
    const input = streamInput(44100);
    const first = 40 * QUANTUM;
    const stepAt = first + Math.round(0.6 * 44100);
    const moving = (frame: number) => input(frame - (frame < stepAt ? 560 : 1001));
    const result = measureNodeDelay(record(moving, first, tapQuanta(44100)), record(input, 0, 1000), 44100);
    expect(result.delayFrames).toBeNull();
    expect(result.delayMs).toBeNull();
    expect(result.unmeasured).toContain("560 / 1001 / 1001");
    expect(result.windows.map((w) => w.lagFrames)).toEqual([560, 1001, 1001]);
  });

  it("does not read a delay from a tap that is not the reference delayed", () => {
    const input = streamInput(48000);
    const quieter = (frame: number) => Math.fround(0.9 * input(frame - 448));
    const result = measureNodeDelay(record(quieter, 40 * QUANTUM, tapQuanta(48000)), record(input, 0, 1000), 48000);
    expect(result.delayFrames).toBeNull();
    expect(result.unmeasured).toContain("no exact match");
    expect(result.windows[0].lagFrames).toBe(448);
  });

  it("does not read a delay where two lags match", () => {
    // A tone that repeats every 8 frames and nothing else: every lag a multiple of 8 matches.
    const tone = (frame: number) => Math.fround(0.5 * Math.sin((2 * Math.PI * frame) / 8));
    const result = measureNodeDelay(record(delayed(tone, 448), 40 * QUANTUM, tapQuanta(48000)), record(tone, -2000 * QUANTUM, 3000), 48000);
    expect(result.delayFrames).toBeNull();
    expect(result.unmeasured).toContain("two lags match");
  });

  it("does not read a delay from a silent tap", () => {
    const input = streamInput(48000);
    const result = measureNodeDelay(record(() => 0, 40 * QUANTUM, tapQuanta(48000)), record(input, 0, 1000), 48000);
    expect(result.delayFrames).toBeNull();
    expect(result.unmeasured).toContain("no signal");
  });

  it("does not read a delay when the reference lacks the quantum the match is in", () => {
    const input = streamInput(48000);
    const tap = record(delayed(input, 448), 40 * QUANTUM, tapQuanta(48000));
    const first = measureNodeDelay(tap, record(input, 0, 1000), 48000).windows[0];
    const lost = Math.floor((first.startFrame - 448) / QUANTUM) + 1;
    const result = measureNodeDelay(tap, record(input, 0, 1000, { skip: [lost] }), 48000);
    expect(result.delayFrames).toBeNull();
  });

  it("says so when the tap recorded nothing", () => {
    const result = measureNodeDelay([], record(streamInput(48000), 0, 100), 48000);
    expect(result).toMatchObject({ delayFrames: null, unmeasured: "the tap recorded nothing", tapFirstFrame: null });
  });

  it("refuses a sample rate that is not above zero", () => {
    expect(() => measureNodeDelay([], [], 0)).toThrow(RangeError);
    expect(() => measureNodeDelay([], [], Number.NaN)).toThrow(RangeError);
  });
});

describe("layOutRange", () => {
  it("leaves a quantum nobody delivered as NaN and counts it", () => {
    const chunks = record((frame) => frame + 1, 1280, 4, { skip: [2] });
    const laid = layOutRange(chunks, 1280, 4 * QUANTUM);
    expect(laid.missingQuanta).toBe(1);
    expect(laid.samples[0]).toBe(1281);
    expect(laid.samples[QUANTUM]).toBe(1281 + QUANTUM);
    expect(Number.isNaN(laid.samples[2 * QUANTUM])).toBe(true);
    expect(laid.samples[3 * QUANTUM]).toBe(1281 + 3 * QUANTUM);
  });

  it("drops quanta outside the range", () => {
    const laid = layOutRange(record(() => 1, 0, 8), 2 * QUANTUM, 2 * QUANTUM);
    expect(laid.missingQuanta).toBe(0);
    expect(laid.samples).toHaveLength(2 * QUANTUM);
  });

  it("refuses a length that is not a whole number of frames", () => {
    expect(() => layOutRange([], 0, -1)).toThrow(RangeError);
    expect(() => layOutRange([], 0, 1.5)).toThrow(RangeError);
  });
});

describe("spanOf", () => {
  it("runs from the first stamp to the end of the last quantum, across chunks", () => {
    expect(spanOf(record(() => 0, 640, 100, { quantaPerChunk: 16 }))).toEqual({ firstFrame: 640, endFrame: 640 + 100 * QUANTUM });
  });

  it("is null without a quantum", () => {
    expect(spanOf([])).toBeNull();
  });
});

describe("findLag", () => {
  it("is null when the tap's window reaches past the tap", () => {
    const input = streamInput(48000);
    const tap = layOutRange(record(input, 0, 10), 0, 10 * QUANTUM);
    expect(findLag(tap, tap, 9 * QUANTUM, 512, 100)).toBeNull();
  });

  it("leaves out a lag whose reference window is not there", () => {
    const input = streamInput(48000);
    const reference = layOutRange(record(input, 0, 40), 0, 40 * QUANTUM);
    const tap = layOutRange(record(delayed(input, 300), 20 * QUANTUM, 10), 20 * QUANTUM, 10 * QUANTUM);
    // Lags beyond the window's own start would read the reference before frame 0.
    const match = findLag(tap, reference, 22 * QUANTUM, 512, 5000);
    expect(match?.lagFrames).toBe(300);
    expect(match?.meanAbsDifference).toBe(0);
  });
});
