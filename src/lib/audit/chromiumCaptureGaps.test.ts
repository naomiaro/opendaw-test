import { describe, expect, it } from "vitest";
import {
  DUPLICATE_BLOCK,
  MAX_HEAD_SEC,
  MIN_ZERO_RUN,
  START_WINDOW_SEC,
  captureVerdict,
  findDuplicateBlocks,
  findZeroRuns,
  headZerosOf,
  judgeCaptureGaps,
  recorderChunkFrames,
  sourceProblem,
} from "./chromiumCaptureGaps";

const RATE = 48000;

/** 0.5 × sin at 1 kHz and 48 kHz, `seconds` long, starting a quarter period in so no frame is an exact zero by accident. */
const tone = (seconds: number): Float32Array => {
  const frames = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < frames.length; i++) frames[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / RATE + 0.3);
  return frames;
};

/** `frames` with `insert` placed at `at`, everything after it moved on. */
const withInsert = (frames: Float32Array, at: number, insert: Float32Array): Float32Array => {
  const out = new Float32Array(frames.length + insert.length);
  out.set(frames.subarray(0, at), 0);
  out.set(insert, at);
  out.set(frames.subarray(at), at + insert.length);
  return out;
};

const judge = (frames: Float32Array) => {
  const runs = findZeroRuns(frames);
  const headZeros = headZerosOf(frames);
  const duplicates = findDuplicateBlocks(frames);
  return { runs, headZeros, duplicates, judged: judgeCaptureGaps(runs, duplicates, headZeros, frames.length / RATE, RATE) };
};

describe("capture gaps", () => {
  it("reads a clean minute of tone as CLEAN", () => {
    const { runs, headZeros, duplicates, judged } = judge(tone(60));
    expect(runs).toEqual([]);
    expect(headZeros).toBe(0);
    expect(duplicates).toEqual([]);
    expect(judged.verdict).toBe("CLEAN");
  });

  it("finds one 480-frame zero insert at 30 s and reads GAPS", () => {
    const at = 30 * RATE;
    const { runs, duplicates, judged } = judge(withInsert(tone(60), at, new Float32Array(480)));
    expect(runs).toEqual([{ start: at, length: 480 }]);
    expect(duplicates).toEqual([]);
    expect(judged).toMatchObject({ verdict: "GAPS", zeroRunCount: 1, longestRunFrames: 480, duplicateCount: 0 });
    expect(judged.startZeroRuns).toEqual([]);
  });

  it("finds a 128-frame block repeated at 45 s and reads GAPS", () => {
    const signal = tone(60);
    const at = 45 * RATE;
    const { runs, duplicates, judged } = judge(withInsert(signal, at + 128, signal.slice(at, at + 128)));
    expect(runs).toEqual([]);
    expect(duplicates).toEqual([at + 128]);
    expect(judged).toMatchObject({ verdict: "GAPS", zeroRunCount: 0, longestRunFrames: 0, duplicateCount: 1, duplicates: [at + 128] });
  });

  it("finds a repeated block that does not sit on the 128-frame grid", () => {
    const signal = tone(60);
    const at = 45 * RATE + 37;
    expect(findDuplicateBlocks(withInsert(signal, at + 128, signal.slice(at, at + 128)))).toEqual([at + 128]);
  });

  it("reports a zero head apart and reads the tone after it CLEAN", () => {
    const { runs, headZeros, duplicates, judged } = judge(withInsert(tone(60), 0, new Float32Array(2000)));
    expect(headZeros).toBe(2000);
    expect(runs).toEqual([]);
    expect(duplicates).toEqual([]);
    expect(judged.verdict).toBe("CLEAN");
  });

  it("does not count zero runs shorter than the minimum", () => {
    const runs = findZeroRuns(withInsert(tone(10), RATE, new Float32Array(99)));
    expect(runs).toEqual([]);
  });

  it("reads NOT CHECKED under 30 s of capture", () => {
    expect(judge(tone(10)).judged.verdict).toBe("NOT CHECKED");
    expect(judge(withInsert(tone(10), RATE, new Float32Array(480))).judged.verdict).toBe("NOT CHECKED");
  });

  it("reads a minute of exact zeros as NOT CHECKED no-signal, not CLEAN", () => {
    const silent = new Float32Array(60 * RATE);
    const { runs, headZeros, duplicates, judged } = judge(silent);
    expect(headZeros).toBe(silent.length);
    expect(runs).toEqual([]);
    expect(duplicates).toEqual([]);
    expect(judged.verdict).toBe("NOT CHECKED no-signal");
  });

  it("reads a head longer than 5 s as NOT CHECKED no-signal, and one just under it as CLEAN", () => {
    expect(judge(withInsert(tone(60), 0, new Float32Array(6 * RATE))).judged.verdict).toBe("NOT CHECKED no-signal");
    expect(judge(withInsert(tone(60), 0, new Float32Array(4.9 * RATE))).judged.verdict).toBe("CLEAN");
  });

  it("reads a 441-zero run 30 ms after the head as START GAPS, reported apart", () => {
    const head = 2000;
    const at = head + Math.round(0.03 * RATE);
    const signal = withInsert(withInsert(tone(60), 0, new Float32Array(head)), at, new Float32Array(441));
    const { judged } = judge(signal);
    expect(judged.verdict).toBe("START GAPS");
    expect(judged.startZeroRuns).toEqual([{ start: at, length: 441 }]);
    expect(judged.zeroRunCount).toBe(0);
  });

  it("reads a start event and a later 480-zero insert as GAPS, the start event still reported", () => {
    const head = 2000;
    const early = head + Math.round(0.03 * RATE);
    const late = 30 * RATE;
    let signal = withInsert(tone(60), late, new Float32Array(480));
    signal = withInsert(signal, early - head, new Float32Array(441));
    signal = withInsert(signal, 0, new Float32Array(head));
    const { judged } = judge(signal);
    expect(judged.verdict).toBe("GAPS");
    expect(judged.startZeroRuns).toEqual([{ start: early, length: 441 }]);
    expect(judged.zeroRuns).toEqual([{ start: late + 441 + head, length: 480 }]);
  });

  it("reads a duplicate inside the start window as START GAPS", () => {
    const signal = tone(60);
    const at = 1000;
    const { judged } = judge(withInsert(signal, at + 128, signal.slice(at, at + 128)));
    expect(judged.verdict).toBe("START GAPS");
    expect(judged.startDuplicates).toEqual([at + 128]);
    expect(judged.duplicateCount).toBe(0);
  });
});

describe("capture gaps at the boundaries", () => {
  const windowEnd = START_WINDOW_SEC * RATE;

  it("reads an insert starting exactly at the start window's end as GAPS, one frame before it as START GAPS", () => {
    expect(judge(withInsert(tone(60), windowEnd, new Float32Array(480))).judged.verdict).toBe("GAPS");
    expect(judge(withInsert(tone(60), windowEnd - 1, new Float32Array(480))).judged.verdict).toBe("START GAPS");
  });

  it("reads a head of exactly MAX_HEAD_SEC as a stream starting, not as no signal", () => {
    const frames = withInsert(tone(55), 0, new Float32Array(MAX_HEAD_SEC * RATE));
    expect(judge(frames).judged.verdict).toBe("CLEAN");
  });

  it("counts a run of exactly MIN_ZERO_RUN zeros and not one a frame shorter", () => {
    expect(judge(withInsert(tone(60), 30 * RATE, new Float32Array(MIN_ZERO_RUN))).runs).toHaveLength(1);
    expect(judge(withInsert(tone(60), 30 * RATE, new Float32Array(MIN_ZERO_RUN - 1))).runs).toEqual([]);
  });

  it("counts a zero run that runs to the end of the capture", () => {
    const frames = tone(60);
    frames.fill(0, frames.length - 480);
    const { runs, judged } = judge(frames);
    expect(runs).toEqual([{ start: frames.length - 480, length: 480 }]);
    expect(judged.verdict).toBe("GAPS");
  });

  it("reads 10 s of zeros as NOT CHECKED for its length, before no-signal", () => {
    expect(judge(new Float32Array(10 * RATE)).judged.verdict).toBe("NOT CHECKED");
  });

  it("reports a repeat longer than one block once, at its start", () => {
    const frames = tone(60);
    const at = 45 * RATE;
    // Three blocks equal to the one before them: frames at..at+3·block repeat the block before `at`.
    for (let i = 0; i < 3 * DUPLICATE_BLOCK; i++) frames[at + i] = frames[at - DUPLICATE_BLOCK + (i % DUPLICATE_BLOCK)];
    expect(findDuplicateBlocks(frames)).toEqual([at]);
  });
});

describe("sourceProblem / captureVerdict", () => {
  const healthy = { ended: false, muted: false, emptyQuanta: 0 };

  it("names a source that ended, was muted, or fed empty inputs; null for a healthy one", () => {
    expect(sourceProblem(healthy)).toBeNull();
    expect(sourceProblem({ ...healthy, ended: true })).toBe("source-ended");
    expect(sourceProblem({ ...healthy, muted: true })).toBe("source-muted");
    expect(sourceProblem({ ...healthy, emptyQuanta: 1 })).toBe("source-empty-input");
    expect(sourceProblem({ ended: true, muted: true, emptyQuanta: 3 })).toBe("source-ended");
  });

  it("reads a source problem as NOT CHECKED even when the zeros it left read GAPS", () => {
    const { judged } = judge(withInsert(tone(60), 30 * RATE, new Float32Array(48000)));
    expect(judged.verdict).toBe("GAPS");
    expect(captureVerdict(judged, null, { ...healthy, ended: true }, 60)).toBe("NOT CHECKED source-ended");
    expect(captureVerdict(judged, null, { ...healthy, emptyQuanta: 375 }, 60)).toBe("NOT CHECKED source-empty-input");
  });

  it("puts a failed step first, then the source, then the judgement", () => {
    const { judged } = judge(tone(60));
    expect(captureVerdict(judged, "capture-threw", { ...healthy, muted: true }, 60)).toBe("NOT CHECKED capture-threw");
    expect(captureVerdict(judged, null, healthy, 60)).toBe("CLEAN");
    const short = judge(tone(12)).judged;
    expect(captureVerdict(short, null, healthy, 12)).toBe("NOT CHECKED 12.0-s");
  });
});

describe("recorderChunkFrames", () => {
  it.each([48000, 44100])("is whole render quanta within one quantum of a second at %i", (rate) => {
    const frames = recorderChunkFrames(rate);
    expect(frames % 128).toBe(0);
    expect(Math.abs(frames - rate)).toBeLessThanOrEqual(64);
  });

  it("keeps 48 000 as it was", () => {
    expect(recorderChunkFrames(48000)).toBe(48000);
  });
});
