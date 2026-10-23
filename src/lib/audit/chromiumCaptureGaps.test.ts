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
  sinceLastStall,
  runsNearMark,
  clockDipSeconds,
  clockRatios,
  captureDetail,
  secondsFrom,
  firstChangedSecond,
  latencyHintFrom,
  lengthsIn480s,
  lengthsIn441s,
  rmsAfterHead,
  matchInput,
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

const judge = (frames: Float32Array, stallFrames: readonly number[] = [], stallLength = 0) => {
  const runs = findZeroRuns(frames);
  const headZeros = headZerosOf(frames);
  const duplicates = findDuplicateBlocks(frames);
  return { runs, headZeros, duplicates, judged: judgeCaptureGaps(runs, duplicates, headZeros, frames.length / RATE, RATE, stallFrames, stallLength) };
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

describe("zero runs and duplicates at stall times", () => {
  const at = 20 * RATE;
  const withQuantumGap = () => withInsert(tone(60), at, new Float32Array(128));

  it("reports a 128-zero insert at a stall frame as stall-coincident, still GAPS", () => {
    const { judged } = judge(withQuantumGap(), [10 * RATE, at, 40 * RATE]);
    expect(judged.verdict).toBe("GAPS");
    expect(judged.stallZeroRuns).toEqual([{ start: at, length: 128 }]);
    expect(judged.stallDuplicates).toEqual([]);
    expect(judged.detail).toBe("1 of 1 zero runs at stall times; 0 of 0 duplicates at stall times");
  });

  it("counts an insert within one quantum of a stall, on either side", () => {
    expect(judge(withQuantumGap(), [at - 128]).judged.stallZeroRuns).toHaveLength(1);
    expect(judge(withQuantumGap(), [at + 128]).judged.stallZeroRuns).toHaveLength(1);
    expect(judge(withQuantumGap(), [at - 129]).judged.stallZeroRuns).toHaveLength(0);
  });

  it("reports the same insert 1 000 frames from every stall as not stall-coincident, still GAPS", () => {
    const { judged } = judge(withQuantumGap(), [at - 1000, at + 1000]);
    expect(judged.verdict).toBe("GAPS");
    expect(judged.zeroRunCount).toBe(1);
    expect(judged.stallZeroRuns).toEqual([]);
    expect(judged.detail).toBe("0 of 1 zero runs at stall times; 0 of 0 duplicates at stall times");
  });

  it("reports a duplicate at a stall frame as stall-coincident", () => {
    const signal = tone(60);
    const { judged } = judge(withInsert(signal, at + 128, signal.slice(at, at + 128)), [at + 128]);
    expect(judged.verdict).toBe("GAPS");
    expect(judged.stallDuplicates).toEqual([at + 128]);
  });

  it("leaves the results without stalls as they were, with no detail", () => {
    const { judged } = judge(withInsert(tone(60), 30 * RATE, new Float32Array(480)));
    expect(judged).toMatchObject({ verdict: "GAPS", zeroRunCount: 1, longestRunFrames: 480, stallZeroRuns: [], stallDuplicates: [] });
    expect(judged.detail).toBeNull();
  });
});

describe("a stall's span", () => {
  const stall = 20 * RATE;
  const length = Math.round(0.08 * RATE);
  const gapAt = (offset: number) => withInsert(tone(60), stall + offset, new Float32Array(1536));

  it("counts a run 48 ms into an 80 ms stall's catch-up, the measured place", () => {
    expect(judge(gapAt(2304), [stall], length).judged.stallZeroRuns).toHaveLength(1);
  });

  it("ends two stall lengths and one quantum after the stall frame", () => {
    expect(judge(gapAt(2 * length + 128), [stall], length).judged.stallZeroRuns).toHaveLength(1);
    expect(judge(gapAt(2 * length + 129), [stall], length).judged.stallZeroRuns).toHaveLength(0);
  });

  it("starts one quantum before the stall frame", () => {
    expect(judge(gapAt(-128), [stall], length).judged.stallZeroRuns).toHaveLength(1);
    expect(judge(gapAt(-129), [stall], length).judged.stallZeroRuns).toHaveLength(0);
  });
});

describe("sinceLastStall", () => {
  it("gives the frames since the latest stall at or before a start, null before the first", () => {
    expect(sinceLastStall(5000, [1000, 4000, 9000])).toBe(1000);
    expect(sinceLastStall(4000, [1000, 4000])).toBe(0);
    expect(sinceLastStall(500, [1000])).toBeNull();
    expect(sinceLastStall(500, [])).toBeNull();
  });
});

describe("latencyHintFrom", () => {
  it("reads seconds and the three category words; interactive without one", () => {
    expect(latencyHintFrom(null)).toBe("interactive");
    expect(latencyHintFrom("0.04")).toBe(0.04);
    expect(latencyHintFrom("balanced")).toBe("balanced");
    expect(latencyHintFrom("playback")).toBe("playback");
  });

  it("throws on anything else", () => {
    expect(() => latencyHintFrom("0")).toThrow(/latencyHint/);
    expect(() => latencyHintFrom("-1")).toThrow(/latencyHint/);
    expect(() => latencyHintFrom("fast")).toThrow(/latencyHint/);
  });
});

describe("lengthsIn480s", () => {
  it("gives each length in tens of milliseconds at 48 kHz, two decimals", () => {
    expect(lengthsIn480s([480, 1920, 128, 441])).toBe("1 4 0.27 0.92");
    expect(lengthsIn480s([])).toBe("");
  });
});

describe("rmsAfterHead", () => {
  it("is the RMS of the frames after the head, 0 for an all-zero capture", () => {
    const frames = new Float32Array([0, 0, 0.5, -0.5, 0.5, -0.5]);
    expect(rmsAfterHead(frames, 2)).toBeCloseTo(0.5, 6);
    expect(rmsAfterHead(new Float32Array(4), 4)).toBe(0);
  });
});

describe("matchInput", () => {
  const inputs = [
    { deviceId: "default", label: "Default - MacBook Pro Microphone (Built-in)" },
    { deviceId: "a", label: "MacBook Pro Microphone (Built-in)" },
    { deviceId: "b", label: "USB Audio CODEC (08bb:2902)" },
  ];

  it("picks the first input whose label holds the text, ignoring case, skipping the default alias", () => {
    expect(matchInput(inputs, "usb")?.deviceId).toBe("b");
    expect(matchInput(inputs, "macbook")?.deviceId).toBe("a");
  });

  it("gives null when none matches", () => {
    expect(matchInput(inputs, "scarlett")).toBeNull();
  });
});

describe("runsNearMark", () => {
  it("keeps the runs starting within the window either side of the mark", () => {
    const runs = [
      { start: 27 * RATE, length: 480 },
      { start: 28 * RATE, length: 480 },
      { start: 31 * RATE, length: 128 },
      { start: 32 * RATE + 1, length: 128 },
    ];
    expect(runsNearMark(runs, 30 * RATE, 2 * RATE)).toEqual([runs[1], runs[2]]);
  });
});

describe("clockRatios and clockDipSeconds", () => {
  it("gives one ratio per interval between readings", () => {
    const readings = [
      { contextSec: 0, wallSec: 0 },
      { contextSec: 1, wallSec: 1 },
      { contextSec: 1.5, wallSec: 2 },
    ];
    expect(clockRatios(readings)).toEqual([1, 0.5]);
    expect(clockRatios(readings.slice(0, 1))).toEqual([]);
  });

  it("names the seconds (from 1) whose ratio is under 0.75", () => {
    expect(clockDipSeconds([1, 0.99, 0.74, 1.01, 0.5])).toEqual([3, 5]);
    expect(clockDipSeconds([1, 0.75])).toEqual([]);
  });
});

describe("captureDetail", () => {
  it("joins the stall detail, the runs near 30 s and the clock dips; null when there is nothing to say", () => {
    expect(captureDetail(null, [], [], { markSec: 30, windowSec: 2 })).toBeNull();
    expect(captureDetail("1 of 1 zero runs at stall times; 0 of 0 duplicates at stall times", [], [], { markSec: 30, windowSec: 2 })).toBe(
      "1 of 1 zero runs at stall times; 0 of 0 duplicates at stall times",
    );
    expect(captureDetail(null, [{ start: 30 * RATE, length: 480 }], [31], { markSec: 30, windowSec: 2 })).toBe(
      "1 zero run within 2 s of the 30 s mark; clock under 0.75 in second 31",
    );
    expect(
      captureDetail(null, [{ start: 0, length: 480 }, { start: 1, length: 480 }], [], { markSec: 45, windowSec: 3 }),
    ).toBe("2 zero runs within 3 s of the 45 s mark");
  });
});

describe("secondsFrom", () => {
  it("reads whole seconds from 30 to 600; 60 without one", () => {
    expect(secondsFrom(null)).toBe(60);
    expect(secondsFrom("90")).toBe(90);
    expect(() => secondsFrom("29")).toThrow(/seconds/);
    expect(() => secondsFrom("1.5")).toThrow(/seconds/);
  });
});

describe("firstChangedSecond", () => {
  it("gives the first reading (from 0) that differs from reading 0, null when none does", () => {
    expect(firstChangedSecond(["0.005|0.028", "0.005|0.028", "0.005|0.04", "0.005|0.028"])).toBe(2);
    expect(firstChangedSecond(["a", "a", "a"])).toBeNull();
    expect(firstChangedSecond([])).toBeNull();
  });

  it("takes its baseline from a later reading when told to: outputLatency reads 0 the instant after resume()", () => {
    expect(firstChangedSecond(["0.0058|0", "0.0058|0.028", "0.0058|0.028", "0.0058|0.04"], 1)).toBe(3);
    expect(firstChangedSecond(["0.0058|0", "0.0058|0.028"], 1)).toBeNull();
  });
});

describe("lengthsIn441s", () => {
  it("gives each length in units of 441 frames (10 ms at 44.1 kHz, the register's delay step), two decimals", () => {
    expect(lengthsIn441s([441, 882, 128, 480])).toBe("1 2 0.29 1.09");
  });
});
