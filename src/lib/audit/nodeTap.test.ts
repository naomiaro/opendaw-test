import { describe, expect, it } from "vitest";
import {
  clockStalls, findLag, frameDiscontinuities, layOutRange, measureNodeDelay, repairFrames, witnessAndRepair, nodeDelayFor, notMeasured,
  referenceCovers, referenceFor, referenceLeadFrames, spanOf, trimReference,
  NODE_TAP_LOUD, NODE_TAP_MAX_LAG_SEC, NODE_TAP_PROCESSOR, NODE_TAP_PROCESSOR_SOURCE,
  NODE_TAP_QUANTUM_FRAMES, NODE_TAP_SECONDS, NODE_TAP_WINDOW_FRAMES, NODE_TAP_WINDOW_LEAD_FRAMES,
  type LaidOutRecording, type TapChunk, type TappedNode,
} from "./nodeTap";

const QUANTUM = NODE_TAP_QUANTUM_FRAMES;

/** A chunk of `frames.length` quanta stamped with the given frames; the samples do not matter. */
const stamped = (frames: number[]): TapChunk => ({
  frames: Float64Array.from(frames),
  samples: new Float32Array(frames.length * NODE_TAP_QUANTUM_FRAMES),
  count: frames.length,
});

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

  it("opens each window a lead before the first loud sample from its start on", () => {
    const first = 40 * QUANTUM;
    const { input, tap, reference } = scene(48000, 576, first);
    const heard = delayed(input, 576);
    const firstLoudFrom = (sec: number) => {
      let frame = first + Math.round(sec * 48000);
      while (Math.abs(heard(frame)) <= NODE_TAP_LOUD) frame++;
      return frame;
    };
    const starts = measureNodeDelay(tap, reference, 48000).windows.map((w) => w.startFrame);
    expect(starts).toEqual([0.3, 0.9, 1.5].map((sec) => firstLoudFrom(sec) - NODE_TAP_WINDOW_LEAD_FRAMES));
  });

  it("does not take one stretch of signal for three windows", () => {
    // One click, 1.7 s into the tap, and nothing else above the threshold.
    const first = 40 * QUANTUM;
    const clickAt = first + Math.round(1.7 * 48000);
    const input = streamInput(48000);
    const bed = (frame: number) => (frame % Math.round(48000 * 0.25) < Math.round(48000 * 0.008) ? 0 : input(frame));
    const once = (frame: number) =>
      frame >= clickAt && frame < clickAt + 384 ? Math.fround(0.5 * Math.sin((2 * Math.PI * 6000 * (frame - clickAt)) / 48000)) : bed(frame);
    const result = measureNodeDelay(record(delayed(once, 448), first, tapQuanta(48000)), record(once, 0, 1000), 48000);
    expect(result.delayFrames).toBeNull();
    expect(result.unmeasured).toBe("no signal in the tap from 0.9 s on");
    expect(result.windows.map((w) => w.lagFrames)).toEqual([448]);
  });

  it("opens windows that do not overlap", () => {
    const { tap, reference } = scene(48000, 576);
    const starts = measureNodeDelay(tap, reference, 48000).windows.map((w) => w.startFrame);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(NODE_TAP_WINDOW_FRAMES);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(NODE_TAP_WINDOW_FRAMES);
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

  it("reads the delay through such a quantum once the stamps are repaired, in the tap or in the reference", () => {
    const input = streamInput(48000);
    const first = 40 * QUANTUM;
    const clean = measureNodeDelay(record(delayed(input, 896), first, tapQuanta(48000)), record(input, 0, 1000), 48000);
    const inWindow = Math.floor((clean.windows[0].startFrame - first) / QUANTUM) + 1;
    const tap = record(delayed(input, 896), first, tapQuanta(48000), { repeatStamp: [inWindow] });
    expect(repairFrames(tap, null).repaired).toBe(1);
    const repairedTap = measureNodeDelay(tap, record(input, 0, 1000), 48000);
    expect(repairedTap.delayFrames).toBe(896);
    expect(repairedTap.tapMissingQuanta).toBe(0);
    // The same stale stamp in the reference, in the stretch the first window is matched against.
    const inReference = Math.floor((clean.windows[0].startFrame - 896) / QUANTUM) + 1;
    const stale = record(input, 0, 1000, { repeatStamp: [inReference] });
    const cleanTap = record(delayed(input, 896), first, tapQuanta(48000));
    const unrepaired = measureNodeDelay(cleanTap, stale, 48000);
    expect(unrepaired.delayFrames).toBeNull();
    expect(unrepaired.referenceMissingQuanta).toBe(clean.referenceMissingQuanta + 1);
    expect(repairFrames(stale, null).repaired).toBe(1);
    const repairedReference = measureNodeDelay(cleanTap, stale, 48000);
    expect(repairedReference.delayFrames).toBe(896);
    // The lead reaches back before the reference's first frame: the clean scene lacks those quanta too.
    expect(repairedReference.referenceMissingQuanta).toBe(clean.referenceMissingQuanta);
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
    const window = result.windows[0];
    expect(window.lagFrames).toBe(448);
    // The difference is a mean over the window, not a sum.
    let sum = 0;
    for (let k = 0; k < NODE_TAP_WINDOW_FRAMES; k++) {
      sum += Math.abs(quieter(window.startFrame + k) - input(window.startFrame + k - 448));
    }
    expect(window.meanAbsDifference).toBeCloseTo(sum / NODE_TAP_WINDOW_FRAMES, 12);
    expect(window.meanAbsDifference).toBeGreaterThan(1e-3);
    expect(window.meanAbsDifference).toBeLessThan(0.1);
  });

  it("does not read a delay from a tap one part in a million off the reference", () => {
    const input = streamInput(48000);
    const nearly = (frame: number) => Math.fround(0.999999 * input(frame - 448));
    const result = measureNodeDelay(record(nearly, 40 * QUANTUM, tapQuanta(48000)), record(input, 0, 1000), 48000);
    expect(result.delayFrames).toBeNull();
    expect(result.unmeasured).toContain("no exact match");
    expect(result.windows[0].meanAbsDifference).toBeLessThan(1e-6);
  });

  it("reports a delay that moved before the last window only", () => {
    const input = streamInput(44100);
    const first = 40 * QUANTUM;
    const stepAt = first + Math.round(1.2 * 44100);
    const moving = (frame: number) => input(frame - (frame < stepAt ? 560 : 1001));
    const result = measureNodeDelay(record(moving, first, tapQuanta(44100)), record(input, 0, 1000), 44100);
    expect(result.delayFrames).toBeNull();
    expect(result.unmeasured).toContain("560 / 560 / 1001");
  });

  it.each([48000, 44100])("reads a delay of the longest lag at %i Hz, and not one frame more", (sampleRate) => {
    const longest = Math.round(sampleRate * NODE_TAP_MAX_LAG_SEC);
    const input = streamInput(sampleRate);
    const first = 80 * QUANTUM;
    const reference = record(input, 0, tapQuanta(sampleRate) + 200);
    expect(measureNodeDelay(record(delayed(input, longest), first, tapQuanta(sampleRate)), reference, sampleRate).delayFrames).toBe(longest);
    const beyond = measureNodeDelay(record(delayed(input, longest + 1), first, tapQuanta(sampleRate)), reference, sampleRate);
    expect(beyond.delayFrames).toBeNull();
    expect(beyond.unmeasured).toContain("no exact match");
  });

  it("says a tap is too short, and keeps the windows it had", () => {
    const input = streamInput(48000);
    const reference = record(input, 0, 1000);
    const oneSecond = measureNodeDelay(record(delayed(input, 448), 40 * QUANTUM, 375), reference, 48000);
    expect(oneSecond.delayFrames).toBeNull();
    expect(oneSecond.unmeasured).toBe("the tap is 1.00 s long: no room for a window from 1.5 s on");
    expect(oneSecond.windows.map((w) => w.lagFrames)).toEqual([448, 448]);
    const oneQuantum = measureNodeDelay(record(delayed(input, 448), 40 * QUANTUM, 1), reference, 48000);
    expect(oneQuantum.unmeasured).toBe("the tap is 0.00 s long: no room for a window from 0.3 s on");
  });

  it("reads a delay from a reference that starts after the tap, when it has what the windows need", () => {
    const input = streamInput(48000);
    const first = 40 * QUANTUM;
    const tap = record(delayed(input, 448), first, tapQuanta(48000));
    const late = record(input, first + 38 * QUANTUM, 1000); // 0.1 s into the tap
    expect(measureNodeDelay(tap, late, 48000).delayFrames).toBe(448);
  });

  it("says the reference has nothing when it starts too late, or is empty", () => {
    const input = streamInput(48000);
    const first = 40 * QUANTUM;
    const tap = record(delayed(input, 448), first, tapQuanta(48000));
    const tooLate = measureNodeDelay(tap, record(input, first + 188 * QUANTUM, 1000), 48000); // 0.5 s in
    expect(tooLate.delayFrames).toBeNull();
    expect(tooLate.unmeasured).toContain("could not be compared");
    expect(measureNodeDelay(tap, [], 48000).unmeasured).toContain("could not be compared");
  });

  it("counts what the tap and the reference lack, and says whether the tap is silent", () => {
    const input = streamInput(48000);
    const first = 80 * QUANTUM; // past the lead, so the reference has all of it
    const tap = record(delayed(input, 448), first, tapQuanta(48000), { skip: [1, 2] });
    const reference = record(input, 0, 1000, { skip: [3] }); // frames 384…511, before the tap's lead
    const read = measureNodeDelay(tap, record(input, 0, 1000, { skip: [40] }), 48000); // inside the lead, outside every match
    expect(read).toMatchObject({ delayFrames: 448, tapMissingQuanta: 2, referenceMissingQuanta: 1, tapSilent: false });
    expect(measureNodeDelay(tap, reference, 48000).referenceMissingQuanta).toBe(0);
    const silent = measureNodeDelay(record(() => 0, first, tapQuanta(48000)), reference, 48000);
    expect(silent.tapSilent).toBe(true);
  });

  it("does not read a delay where two lags match", () => {
    // A tone that repeats every 8 frames and nothing else: every lag a multiple of 8 matches.
    const tone = (frame: number) => Math.fround(0.5 * Math.sin((2 * Math.PI * frame) / 8));
    const result = measureNodeDelay(record(delayed(tone, 448), 40 * QUANTUM, tapQuanta(48000)), record(tone, -2000 * QUANTUM, 3000), 48000);
    expect(result.delayFrames).toBeNull();
    expect(result.unmeasured).toContain("two lags match");
  });

  it("does not read a delay where one lag alone could be compared", () => {
    const first = 83 * QUANTUM; // 0.3 s on from here falls between two clicks
    const delay = 448;
    const plain = streamInput(48000);
    // The signal shifted so that what the first window is compared with starts on a quantum.
    const scenes = Array.from({ length: QUANTUM }, (_, shift) => {
      const input = (frame: number) => plain(frame - shift);
      const tap = record(delayed(input, delay), first, tapQuanta(48000));
      return { input, tap, whole: measureNodeDelay(tap, record(input, 0, 1000), 48000) };
    });
    const found = scenes.find((scene) => (scene.whole.windows[0].startFrame - delay) % QUANTUM === 0);
    if (found === undefined) throw new Error("no shift puts the first window on a quantum");
    const { input, tap, whole } = found;
    expect(whole.delayFrames).toBe(delay);
    const quantumOf = (frame: number) => Math.floor(frame / QUANTUM);
    const needed = new Set<number>();
    whole.windows.forEach((window, index) => {
      const from = quantumOf(window.startFrame - delay);
      // Four quanta hold the first window's match and nothing beside it; the others get one more.
      for (let q = from; q < from + (index === 0 ? 4 : 5); q++) needed.add(q);
    });
    const skip = Array.from({ length: 1000 }, (_, q) => q).filter((q) => !needed.has(q));
    const result = measureNodeDelay(tap, record(input, 0, 1000, { skip }), 48000);
    expect(result.windows[0]).toMatchObject({ lagFrames: delay, meanAbsDifference: 0, runnerUpMeanAbsDifference: null });
    expect(result.delayFrames).toBeNull();
    expect(result.unmeasured).toBe(`only one lag could be compared at frame ${whole.windows[0].startFrame}`);
  });

  it("takes a tap that stays under the threshold for silent", () => {
    const bed = (frame: number) => Math.fround(0.4 * NODE_TAP_LOUD * Math.sin(frame / 7));
    const result = measureNodeDelay(record(bed, 80 * QUANTUM, tapQuanta(48000)), record(bed, 0, 1000), 48000);
    expect(result.tapSilent).toBe(true);
    expect(result.unmeasured).toBe("no signal in the tap from 0.3 s on");
  });

  it("does not read a delay from a silent tap", () => {
    const input = streamInput(48000);
    const result = measureNodeDelay(record(() => 0, 40 * QUANTUM, tapQuanta(48000)), record(input, 0, 1000), 48000);
    expect(result.delayFrames).toBeNull();
    expect(result.unmeasured).toContain("no signal");
  });

  it("does not read a delay when the reference lacks the quantum the match is in, and says it is the reference", () => {
    const input = streamInput(48000);
    const tap = record(delayed(input, 448), 80 * QUANTUM, tapQuanta(48000));
    const first = measureNodeDelay(tap, record(input, 0, 1000), 48000).windows[0];
    const lost = Math.floor((first.startFrame - 448) / QUANTUM) + 1;
    const result = measureNodeDelay(tap, record(input, 0, 1000, { skip: [lost] }), 48000);
    expect(result.delayFrames).toBeNull();
    expect(result.unmeasured).toMatch(/^no match at frame \d+ among the lags that could be compared; \d+ could not be, the reference has a gap there$/);
    expect(result.windows[0].lagsNotCompared).toBeGreaterThan(0);
    expect(result.referenceMissingQuanta).toBe(1);
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
    const laid = layOutRange(record((frame) => frame, 0, 8), 2 * QUANTUM, 2 * QUANTUM);
    expect(laid.missingQuanta).toBe(0);
    expect(Array.from(laid.samples)).toEqual(Array.from({ length: 2 * QUANTUM }, (_, k) => 2 * QUANTUM + k));
  });

  it("reads a chunk up to its count, not to the end of its arrays", () => {
    const chunk: TapChunk = { frames: new Float64Array(4), samples: new Float32Array(4 * QUANTUM).fill(7), count: 2 };
    chunk.frames.set([0, QUANTUM, 2 * QUANTUM, 3 * QUANTUM]); // the last two are left from a chunk before
    const laid = layOutRange([chunk], 0, 4 * QUANTUM);
    expect(laid.missingQuanta).toBe(2);
    expect(laid.samples[QUANTUM]).toBe(7);
    expect(Number.isNaN(laid.samples[2 * QUANTUM])).toBe(true);
    expect(spanOf([chunk])).toEqual({ firstFrame: 0, endFrame: 2 * QUANTUM });
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

  it("leaves out a lag whose reference window is not there, and counts it", () => {
    const input = streamInput(48000);
    const reference = layOutRange(record(input, 0, 40), 0, 40 * QUANTUM);
    const tap = layOutRange(record(delayed(input, 300), 20 * QUANTUM, 10), 20 * QUANTUM, 10 * QUANTUM);
    // Lags beyond the window's own start would read the reference before frame 0.
    const match = findLag(tap, reference, 22 * QUANTUM, 512, 5000);
    expect(match?.lagFrames).toBe(300);
    expect(match?.meanAbsDifference).toBe(0);
    expect(match?.lagsNotCompared).toBe(5000 - 22 * QUANTUM);
  });

  // One-frame windows: the difference at a lag is |tap − reference[frame − lag]|.
  const single = (value: number, at: number): LaidOutRecording => {
    const samples = new Float32Array(at + 1).fill(NaN);
    samples[at] = value;
    return { firstFrame: 0, samples, missingQuanta: 0 };
  };
  const held = (values: number[]): LaidOutRecording => ({ firstFrame: 0, samples: Float32Array.from(values), missingQuanta: 0 });

  it("keeps as runner-up a lag that comes after the best", () => {
    // Frame 3 of the tap is 1; the reference read at lags 0…3 is 4, 1, 2, 3.
    const match = findLag(single(1, 3), held([3, 2, 1, 4]), 3, 1, 3);
    expect(match).toEqual({ lagFrames: 1, meanAbsDifference: 0, runnerUpMeanAbsDifference: 1, lagsNotCompared: 0 });
  });

  it("keeps as runner-up the best so far when a better lag comes", () => {
    // Read at lags 0…2: 2, 1, 6. The best before lag 1 was lag 0.
    const match = findLag(single(1, 2), held([6, 1, 2]), 2, 1, 2);
    expect(match).toEqual({ lagFrames: 1, meanAbsDifference: 0, runnerUpMeanAbsDifference: 1, lagsNotCompared: 0 });
  });

  it("has no runner-up when one lag could be compared", () => {
    const match = findLag(single(1, 2), held([NaN, 1, NaN]), 2, 1, 2);
    expect(match).toEqual({ lagFrames: 1, meanAbsDifference: 0, runnerUpMeanAbsDifference: null, lagsNotCompared: 2 });
    expect(JSON.parse(JSON.stringify(match))).toEqual(match);
  });
});

describe("the reference a tap is compared with", () => {
  const chunks = (firstQuantum: number, count: number) => record((frame) => frame, firstQuantum * QUANTUM, count, { quantaPerChunk: 4 });

  it("leads the tap by the longest lag, up to whole quanta", () => {
    expect(referenceLeadFrames(48000)).toBe(5760);
    expect(referenceLeadFrames(44100)).toBe(42 * QUANTUM);
    expect(referenceLeadFrames(44100)).toBeGreaterThanOrEqual(Math.round(44100 * NODE_TAP_MAX_LAG_SEC));
  });

  it("covers a tap once it reaches the tap's end, not before", () => {
    const tapSpan = { firstFrame: 100 * QUANTUM, endFrame: 120 * QUANTUM };
    expect(referenceCovers(chunks(0, 120), tapSpan)).toBe(true);
    expect(referenceCovers(chunks(0, 119), tapSpan)).toBe(false);
    expect(referenceCovers([], tapSpan)).toBe(false);
  });

  it("is the chunks that reach into the tap's span or its lead, and no others", () => {
    const tapSpan = { firstFrame: 100 * QUANTUM, endFrame: 120 * QUANTUM };
    const from = 100 - 45; // the lead is 45 quanta at 48 kHz
    const picked = referenceFor(chunks(0, 200), tapSpan, 48000);
    const stamps = picked.flatMap((chunk) => Array.from(chunk.frames.subarray(0, chunk.count))).map((frame) => frame / QUANTUM);
    // Chunks of four quanta: the one holding quantum 55 starts at 52, the last one needed ends at 119.
    expect(stamps[0]).toBe(Math.floor(from / 4) * 4);
    expect(stamps[stamps.length - 1]).toBe(119);
    expect(stamps).toHaveLength(120 - 52);
  });

  it("gives a delay through the chunks it picked", () => {
    const input = streamInput(48000);
    const tap = record(delayed(input, 896), 300 * QUANTUM, tapQuanta(48000));
    const all = record(input, 0, 1400);
    const picked = referenceFor(all, spanOf(tap)!, 48000);
    expect(picked.length).toBeLessThan(all.length);
    expect(measureNodeDelay(tap, picked, 48000).delayFrames).toBe(896);
  });

  it("is trimmed from the head to what it is asked to keep", () => {
    const kept = chunks(0, 40);
    trimReference(kept, 10 * QUANTUM);
    // The newest quantum ends at 40; chunks that end before quantum 30 go.
    expect(spanOf(kept)).toEqual({ firstFrame: 28 * QUANTUM, endFrame: 40 * QUANTUM });
    const short = chunks(0, 8);
    trimReference(short, 100 * QUANTUM);
    expect(short).toHaveLength(2);
  });

  it("is still trimmed when its newest chunk is empty", () => {
    const kept = chunks(0, 40);
    kept.push({ frames: new Float64Array(4), samples: new Float32Array(4 * QUANTUM), count: 0 });
    trimReference(kept, 10 * QUANTUM);
    expect(spanOf(kept)).toEqual({ firstFrame: 28 * QUANTUM, endFrame: 40 * QUANTUM });
    const empty: TapChunk[] = [];
    trimReference(empty, 10);
    expect(empty).toEqual([]);
  });
});

describe("nodeDelayFor", () => {
  const RATE = 48000;
  const input = streamInput(RATE);
  const reference = record(input, 0, tapQuanta(RATE) + 200);
  const tapOf = (deviceId: string, delayFrames: number | "silent", failed: string | null = null): TappedNode => ({
    deviceId, failed, referenceChunks: failed === null ? reference : [],
    tapChunks: failed !== null ? [] : record(delayFrames === "silent" ? () => 0 : delayed(input, delayFrames), 40 * QUANTUM, tapQuanta(RATE)),
  });

  it("reads each tape's delay from the tap on its own device", () => {
    const taps = [tapOf("mic-1", 448), tapOf("mic-2", 896)];
    const a = nodeDelayFor(taps, "mic-1", "mic-2", RATE);
    const b = nodeDelayFor(taps, "mic-2", "mic-1", RATE);
    expect(a.measurement.delayFrames).toBe(448);
    expect(a.tap).toBe(taps[0]);
    expect(a.candidates).toBe(1);
    expect(b.measurement.delayFrames).toBe(896);
    expect(b.tap).toBe(taps[1]);
  });

  it("takes the node that carries signal over one the SDK has dropped", () => {
    const taps = [tapOf("mic-1", "silent"), tapOf("mic-1", 576), tapOf("mic-2", 896)];
    const a = nodeDelayFor(taps, "mic-1", "mic-2", RATE);
    expect(a.measurement.delayFrames).toBe(576);
    expect(a.tap).toBe(taps[1]);
    expect(a.candidates).toBe(1);
    // Whichever of the two was built first.
    expect(nodeDelayFor([taps[1], taps[0]], "mic-1", "mic-2", RATE).measurement.delayFrames).toBe(576);
  });

  it("gives no delay when two nodes on the device carry signal", () => {
    const a = nodeDelayFor([tapOf("mic-1", 448), tapOf("mic-1", 576)], "mic-1", "mic-2", RATE);
    expect(a.measurement.delayFrames).toBeNull();
    expect(a.measurement.unmeasured).toBe("2 source nodes on mic-1 carry signal: which one recorded is not known");
    expect(a.tap).toBeNull();
    expect(a.candidates).toBe(2);
  });

  it("counts a tap that failed as a node that may have recorded", () => {
    const a = nodeDelayFor([tapOf("mic-1", 448), tapOf("mic-1", 0, "the tap delivered 0 of 750 quanta within 5000 ms")], "mic-1", "mic-2", RATE);
    expect(a.measurement.delayFrames).toBeNull();
    expect(a.candidates).toBe(2);
  });

  it("gives no delay to two tapes on one device id", () => {
    const a = nodeDelayFor([tapOf("mic-1", 448)], "mic-1", "mic-1", RATE);
    expect(a.measurement.unmeasured).toBe("both tapes record from one device id");
    expect(a.tap).toBeNull();
  });

  it("gives the tap's own reason when it failed", () => {
    const a = nodeDelayFor([tapOf("mic-1", 0, "the recorder's processor threw")], "mic-1", "mic-2", RATE);
    expect(a.measurement.delayFrames).toBeNull();
    expect(a.measurement.unmeasured).toBe("the recorder's processor threw");
  });

  it("says which devices were tapped when the tape's was not", () => {
    expect(nodeDelayFor([tapOf("(default)", 448)], "mic-1", "mic-2", RATE).measurement.unmeasured)
      .toBe("no source node was tapped on mic-1 (tapped: (default))");
    expect(nodeDelayFor([], "mic-1", "mic-2", RATE).measurement.unmeasured)
      .toBe("no source node was tapped on mic-1 (tapped: none)");
  });

  it("says the taps could not be taken when the call for them failed, whatever else is true", () => {
    const a = nodeDelayFor([], "mic-1", "mic-1", RATE, "Error: tapSourceNodes before prepareNodeTaps()");
    expect(a.measurement.unmeasured).toBe("the taps could not be taken: Error: tapSourceNodes before prepareNodeTaps()");
  });

  it("gives the reason of the node when every node on the device is silent", () => {
    const a = nodeDelayFor([tapOf("mic-1", "silent")], "mic-1", "mic-2", RATE);
    expect(a.measurement.unmeasured).toBe("no signal in the tap from 0.3 s on");
    expect(a.candidates).toBe(0);
  });

  it("turns a measurement that throws into a delay not read", () => {
    const a = nodeDelayFor([tapOf("mic-1", 448)], "mic-1", "mic-2", 0);
    expect(a.measurement.delayFrames).toBeNull();
    expect(a.measurement.unmeasured).toMatch(/^the tap could not be measured: RangeError: sample rate must be above zero/);
  });
});

describe("notMeasured", () => {
  it("is a delay not read, with what is known beside the reason", () => {
    expect(notMeasured("why")).toEqual({
      delayFrames: null, delayMs: null, unmeasured: "why", windows: [],
      tapFirstFrame: null, tapMissingQuanta: 0, referenceMissingQuanta: 0, tapSilent: false,
    });
    expect(notMeasured("why", { tapSilent: true, tapFirstFrame: 128 })).toMatchObject({ tapSilent: true, tapFirstFrame: 128 });
  });
});

describe("the recorder's processor", () => {
  interface Posted { frames: Float64Array; samples: Float32Array; count: number }
  /** The module's text run with stand-ins for what an AudioWorklet scope provides. */
  function load(options: { quanta: number; chunkQuanta: number }) {
    const posted: Posted[] = [];
    const clock = { currentFrame: 0 };
    let registered: { name: string; processor: new (o: unknown) => { process(inputs: Float32Array[][]): boolean } } | null = null;
    class AudioWorkletProcessor { port = { postMessage: (message: Posted) => posted.push(message) }; }
    const run = new Function(
      "AudioWorkletProcessor", "registerProcessor", "clock",
      NODE_TAP_PROCESSOR_SOURCE.replace(/currentFrame/g, "clock.currentFrame")
    );
    run(AudioWorkletProcessor, (name: string, processor: NonNullable<typeof registered>["processor"]) => { registered = { name, processor }; }, clock);
    const found = registered as { name: string; processor: new (o: unknown) => { process(inputs: Float32Array[][]): boolean } } | null;
    if (found === null) throw new Error("the module registered no processor");
    const processor = new found.processor({ processorOptions: options });
    const render = (input: Float32Array[]): boolean => {
      const alive = processor.process([input]);
      clock.currentFrame += QUANTUM;
      return alive;
    };
    return { name: found.name, posted, clock, render };
  }
  const quantum = (value: number) => [new Float32Array(QUANTUM).fill(value)];

  it("registers under the name the node is made with", () => {
    expect(load({ quanta: 1, chunkQuanta: 1 }).name).toBe(NODE_TAP_PROCESSOR);
  });

  it("stamps each quantum with the frame it is rendered at, and stops after its quanta", () => {
    const tap = load({ quanta: 5, chunkQuanta: 5 });
    tap.clock.currentFrame = 1280;
    const alive = [1, 2, 3, 4, 5, 6].map((value) => tap.render(quantum(value)));
    expect(alive).toEqual([true, true, true, true, true, false]);
    expect(tap.posted).toHaveLength(1);
    expect(tap.posted[0].count).toBe(5);
    expect(Array.from(tap.posted[0].frames)).toEqual([1280, 1408, 1536, 1664, 1792]);
    expect(tap.posted[0].samples[0]).toBe(1);
    expect(tap.posted[0].samples[4 * QUANTUM]).toBe(5);
    expect(tap.posted[0].samples).toHaveLength(5 * QUANTUM);
  });

  it("posts what is left when it stops short of a chunk", () => {
    const tap = load({ quanta: 5, chunkQuanta: 2 });
    for (let value = 1; value <= 6; value++) tap.render(quantum(value));
    expect(tap.posted.map((chunk) => chunk.count)).toEqual([2, 2, 1]);
    expect(tap.posted[2].frames[0]).toBe(4 * QUANTUM);
    expect(tap.posted[2].samples[0]).toBe(5);
  });

  it("runs on when it is given no number of quanta", () => {
    const reference = load({ quanta: 0, chunkQuanta: 3 });
    const alive = Array.from({ length: 10 }, (_, k) => reference.render(quantum(k)));
    expect(alive.every((value) => value)).toBe(true);
    expect(reference.posted.map((chunk) => chunk.count)).toEqual([3, 3, 3]);
  });

  it("stamps a quantum that has no input channel and leaves it at zero", () => {
    const tap = load({ quanta: 2, chunkQuanta: 2 });
    tap.render([]);
    tap.render(quantum(3));
    expect(Array.from(tap.posted[0].frames)).toEqual([0, QUANTUM]);
    expect(tap.posted[0].samples[0]).toBe(0);
    expect(tap.posted[0].samples[QUANTUM]).toBe(3);
  });

  it("gives chunks a delay is read from", () => {
    const input = streamInput(48000);
    const heard = delayed(input, 640);
    const fill = (source: (frame: number) => number, from: number) => [Float32Array.from({ length: QUANTUM }, (_, k) => source(from + k))];
    const tap = load({ quanta: tapQuanta(48000), chunkQuanta: tapQuanta(48000) });
    const reference = load({ quanta: 0, chunkQuanta: 64 });
    for (let frame = 0; frame < 60 * QUANTUM + tapQuanta(48000) * QUANTUM + 64 * QUANTUM; frame += QUANTUM) {
      reference.clock.currentFrame = frame;
      reference.render(fill(input, frame));
      if (frame >= 60 * QUANTUM) {
        tap.clock.currentFrame = frame;
        tap.render(fill(heard, frame));
      }
    }
    expect(measureNodeDelay(tap.posted, reference.posted, 48000).delayFrames).toBe(640);
  });
});

describe("frameDiscontinuities", () => {
  it("finds nothing in a clock that advances one quantum per call, across chunks too", () => {
    const { found, lastFrame } = frameDiscontinuities([stamped([0, 128, 256]), stamped([384, 512])], null);
    expect(found).toEqual([]);
    expect(lastFrame).toBe(512);
  });

  it("reports a clock that stood still for one call: the same frame, then two quanta on", () => {
    const { found } = frameDiscontinuities([stamped([0, 128, 128, 384])], null);
    expect(found).toEqual([
      { previousFrame: 128, frame: 128, betweenChunks: false },
      { previousFrame: 128, frame: 384, betweenChunks: false },
    ]);
  });

  it("marks a gap between two chunks as such: a chunk that never arrived looks the same", () => {
    const { found } = frameDiscontinuities([stamped([0, 128]), stamped([512, 640])], null);
    expect(found).toEqual([{ previousFrame: 128, frame: 512, betweenChunks: true }]);
  });

  it("carries the last frame over from an earlier call", () => {
    expect(frameDiscontinuities([stamped([256, 384])], 128).found).toEqual([]);
    expect(frameDiscontinuities([stamped([384, 512])], 128).found)
      .toEqual([{ previousFrame: 128, frame: 384, betweenChunks: true }]);
  });

  it("reads only the quanta a chunk says it holds", () => {
    const partial = stamped([0, 128, 999]);
    partial.count = 2;
    const { found, lastFrame } = frameDiscontinuities([partial], null);
    expect(found).toEqual([]);
    expect(lastFrame).toBe(128);
  });
});

describe("repairFrames", () => {
  it("leaves a true clock alone", () => {
    const chunk = stamped([0, 128, 256]);
    expect(repairFrames([chunk], null)).toEqual({ repaired: 0, lastFrame: 256 });
    expect([...chunk.frames]).toEqual([0, 128, 256]);
  });

  it("moves a stamp that stood still to one quantum after the call before it", () => {
    const chunk = stamped([0, 128, 128, 384]);
    expect(repairFrames([chunk], null).repaired).toBe(1);
    expect([...chunk.frames]).toEqual([0, 128, 256, 384]);
  });

  it("repairs a clock that stood still for several calls", () => {
    const chunk = stamped([0, 128, 128, 128, 512]);
    expect(repairFrames([chunk], null).repaired).toBe(2);
    expect([...chunk.frames]).toEqual([0, 128, 256, 384, 512]);
  });

  it("takes a jump forward as read: the recorder was not called in between", () => {
    const chunk = stamped([0, 128, 512, 640]);
    expect(repairFrames([chunk], null).repaired).toBe(0);
    expect([...chunk.frames]).toEqual([0, 128, 512, 640]);
  });

  it("repairs across a chunk border from the frame carried over", () => {
    const chunk = stamped([256, 512]);
    expect(repairFrames([chunk], 256)).toEqual({ repaired: 1, lastFrame: 512 });
    expect([...chunk.frames]).toEqual([384, 512]);
  });
});

describe("clockStalls", () => {
  const step = (previousFrame: number, frame: number, betweenChunks = false) => ({ previousFrame, frame, betweenChunks });

  it("is one stall of one quantum for a clock that read a frame twice", () => {
    expect(clockStalls([step(128, 128), step(128, 384)])).toEqual([{ frame: 128, quanta: 1 }]);
  });

  it("counts every further read of the same frame into the same stall", () => {
    // the clock read 128 on three calls running: two stale quanta, then it caught up
    expect(clockStalls([step(128, 128), step(128, 128, true), step(128, 512)])).toEqual([{ frame: 128, quanta: 2 }]);
  });

  it("keeps two stalls apart, and takes no forward step for one", () => {
    expect(clockStalls([step(128, 128), step(128, 384), step(640, 1024, true), step(2048, 2048), step(2048, 2304)]))
      .toEqual([{ frame: 128, quanta: 1 }, { frame: 2048, quanta: 1 }]);
    expect(clockStalls([])).toEqual([]);
  });
});

describe("witnessAndRepair", () => {
  it("witnesses the stamps as given and repairs them afterwards, each from its own last frame", () => {
    // a stall of two quanta that straddles a chunk border: true frames 0,128,256 | 384,512
    const first = stamped([0, 128, 128]);
    const second = stamped([128, 512]);
    const one = witnessAndRepair(first, { lastRawFrame: null, lastRepairedFrame: null });
    expect(one.found).toEqual([{ previousFrame: 128, frame: 128, betweenChunks: false }]);
    expect([...first.frames]).toEqual([0, 128, 256]);
    expect(one.state).toEqual({ lastRawFrame: 128, lastRepairedFrame: 256 });
    const two = witnessAndRepair(second, one.state);
    // the witness compares with the RAW last frame: the border call read 128 again
    expect(two.found).toEqual([
      { previousFrame: 128, frame: 128, betweenChunks: true },
      { previousFrame: 128, frame: 512, betweenChunks: false },
    ]);
    // the repair continues from the REPAIRED last frame
    expect([...second.frames]).toEqual([384, 512]);
    expect(two.state).toEqual({ lastRawFrame: 512, lastRepairedFrame: 512 });
    expect(two.repaired).toBe(1);
  });
});
