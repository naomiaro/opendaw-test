import { describe, expect, it } from "vitest";
import {
  FIRST_RUN_ON_0_0_173,
  deviationOf,
  eventsOfRun,
  exactRateInterval,
  fisherOneSided,
  harnessOf,
  medianOf,
  quantumMs,
  repeatsOf,
  sdkOf,
  staleQuantaAtStamps,
  usualNettedMs,
  type EventRow,
  type RunIdentity,
} from "./oneQuantumEvents";

const mt = (repeat: number, tape: string, netted: number | null, ffc: number | null = 0): EventRow =>
  ({ scenario: "multitrack-janked", bpm: 120, repeat, tape, medianBeatErrorMsNetted: netted, firstFrameCheckMs: ffc });

const loopWrap = (repeat: number, netted: number[]): EventRow[] =>
  netted.map((value, takeIndex) => ({ scenario: "loop-wrap", bpm: 120, repeat, takeIndex, medianBeatErrorMsNetted: value }));

describe("quantumMs and medianOf", () => {
  it("is 128 frames at the rate", () => {
    expect(quantumMs(48000)).toBeCloseTo(2.6667, 4);
    expect(quantumMs(44100)).toBeCloseTo(2.9025, 4);
  });

  it("returns the middle value, the mean of the two middle ones, and null for none", () => {
    expect(medianOf([3.813, 1.146, 1.146])).toBe(1.146);
    expect(medianOf([1, 4, 2, 3])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });
});

describe("usualNettedMs", () => {
  it("stays on the usual value when the repeat that is off has the most rows alike", () => {
    // one event repeat of three takes, two ordinary repeats whose takes spread
    const rows = [
      ...loopWrap(1, [1.07 + 2.667, 1.12 + 2.667, 1.17 + 2.667]),
      ...loopWrap(2, [1.08, 1.13, 1.16]),
      ...loopWrap(3, [1.09, 1.14, 1.15]),
    ];
    expect(usualNettedMs(repeatsOf(rows))).toBeCloseTo(1.14, 6);
    expect(eventsOfRun(rows, 48000).events.map((event) => event.repeat)).toEqual([1]);
  });

  it("is null for two repeats: nothing says which of two different values is the usual one", () => {
    const rows = [mt(1, "a", 3.819), mt(2, "a", 1.146)];
    expect(usualNettedMs(repeatsOf(rows))).toBeNull();
    expect(eventsOfRun(rows, 48000)).toEqual({ repeats: 2, events: [], others: [], ordinary: [], usualMs: null });
  });
});

describe("deviationOf", () => {
  const reading = (rows: EventRow[]) => repeatsOf(rows)[0];

  it("is none within half a quantum, one-quantum at a quantum, other beyond", () => {
    expect(deviationOf(reading([mt(1, "a", 1.146)]), 1.146, 48000)).toBe("none");
    expect(deviationOf(reading([mt(1, "a", 2.4)]), 1.146, 48000)).toBe("none");
    expect(deviationOf(reading([mt(1, "a", 3.813)]), 1.146, 48000)).toBe("one-quantum");
    expect(deviationOf(reading([mt(1, "a", 1.146 - 2.667)]), 1.146, 48000)).toBe("one-quantum");
    expect(deviationOf(reading([mt(1, "a", 1.146 + 5.333)]), 1.146, 48000)).toBe("other");
    expect(deviationOf(reading([mt(1, "a", 11.146)]), 1.146, 48000)).toBe("other");
  });

  it("reads the quantum at the run's own rate", () => {
    // 1.40 ms is under half a quantum at 44.1 kHz (1.451) and over half at 48 kHz (1.333)
    expect(deviationOf(reading([mt(1, "a", 1.156 + 2.9025)]), 1.156, 44100)).toBe("one-quantum");
    expect(deviationOf(reading([mt(1, "a", 1.156 + 1.40)]), 1.156, 44100)).toBe("none");
    expect(deviationOf(reading([mt(1, "a", 1.156 + 1.40)]), 1.156, 48000)).toBe("other");
  });

  it("is other when one figure is a quantum off and another is off by something else", () => {
    expect(deviationOf(reading([mt(1, "a", 3.813, -2.667), mt(1, "b", 3.813, -8)]), 1.146, 48000)).toBe("other");
  });
});

describe("eventsOfRun", () => {
  it("counts a repeat whose netted median is a quantum off the run's usual value", () => {
    const rows = [mt(1, "a", 1.146), mt(1, "b", 1.146), mt(2, "a", 3.813), mt(2, "b", 3.813), mt(3, "a", 1.146), mt(3, "b", 1.146)];
    const { repeats, events, others } = eventsOfRun(rows, 48000);
    expect(repeats).toBe(3);
    expect(events.map((event) => event.repeat)).toEqual([2]);
    expect(others).toEqual([]);
  });

  it("counts a repeat whose first-frame check is a quantum off zero even with the usual netted median", () => {
    const rows = [mt(1, "a", 1.146), mt(1, "b", 1.146, -2.667), mt(2, "a", 1.146), mt(2, "b", 1.146), mt(3, "a", 1.146), mt(3, "b", 1.146)];
    expect(eventsOfRun(rows, 48000).events.map((event) => event.repeat)).toEqual([1]);
  });

  it("keeps a repeat that is off by something else out of the events", () => {
    const rows = [mt(1, "a", 1.146), mt(2, "a", 11.146), mt(3, "a", 1.146), mt(4, "a", 3.813), mt(5, "a", 1.146)];
    const { events, others } = eventsOfRun(rows, 48000);
    expect(events.map((event) => event.repeat)).toEqual([4]);
    expect(others.map((other) => other.repeat)).toEqual([2]);
  });

  it("hands back the ordinary repeats too: every counted repeat is an event, another kind, or ordinary", () => {
    const rows = [mt(1, "a", 1.146), mt(2, "a", 11.146), mt(3, "a", 1.146), mt(4, "a", 3.813), mt(5, "a", 1.146)];
    const { repeats, events, others, ordinary } = eventsOfRun(rows, 48000);
    expect(ordinary.map((reading) => reading.repeat)).toEqual([1, 3, 5]);
    expect(events.length + others.length + ordinary.length).toBe(repeats);
  });

  it("does not count the spread of loop-wrap takes at 44.1 kHz", () => {
    const rows = [1, 2, 3].flatMap((repeat) => loopWrap(repeat, [0.97, 1.05, 1.12, 1.18, 1.19, 1.17]));
    const { repeats, events, others } = eventsOfRun(rows, 44100);
    expect(repeats).toBe(3);
    expect(events).toEqual([]);
    expect(others).toEqual([]);
  });

  it("leaves out a repeat with a row that has no netted median", () => {
    const rows = [mt(1, "a", 1.146), mt(1, "b", null), mt(2, "a", 1.146), mt(2, "b", 1.146)];
    expect(repeatsOf(rows).map((reading) => reading.repeat)).toEqual([2]);
    expect(eventsOfRun(rows, 48000).repeats).toBe(1);
  });

  it("returns nothing for a run without netted medians", () => {
    expect(eventsOfRun([mt(1, "a", null)], 48000)).toEqual({ repeats: 0, events: [], others: [], ordinary: [], usualMs: null });
  });
});

describe("sdkOf and harnessOf", () => {
  const release: RunIdentity = { runId: 1790709786130, sdkVersion: null, stopLead: null, sdkBuildProbe: "upstream", buildFeatures: ["recordingStart"] };

  it("reads the version off the envelope when it is there", () => {
    expect(sdkOf({ ...release, sdkVersion: "0.0.172", runId: FIRST_RUN_ON_0_0_173 + 10 })).toBe("0.0.172");
  });

  it("leaves a branch build out even when its envelope carries a version", () => {
    const branch = { ...release, sdkVersion: "0.0.173", runId: FIRST_RUN_ON_0_0_173 + 10 };
    expect(sdkOf({ ...branch, sdkBuildProbe: "candidate" })).toBeNull();
    expect(sdkOf({ ...branch, buildFeatures: ["recordingStart", "calibrateInputLatency", "latencyProbes"] })).toBeNull();
  });

  it("dates an older release envelope by its run id", () => {
    expect(sdkOf(release)).toBe("0.0.172");
    expect(sdkOf({ ...release, runId: FIRST_RUN_ON_0_0_173 })).toBe("0.0.173");
  });

  it("leaves a branch build out of the comparison", () => {
    expect(sdkOf({ ...release, sdkBuildProbe: "candidate" })).toBeNull();
    expect(sdkOf({ ...release, buildFeatures: ["recordingStart", "latencyProbes"] })).toBeNull();
    expect(sdkOf({ ...release, buildFeatures: null })).toBeNull();
  });

  it("takes the stop from the envelope, then from the rows, then from the list of early runs", () => {
    expect(harnessOf({ ...release, stopLead: false }, [{ ...mt(1, "a", 1.1), stopLeadMs: 230 }])).toBe("stop-after-click");
    expect(harnessOf(release, [{ ...mt(1, "a", 1.1), stopLeadMs: 230 }])).toBe("stop-lead");
    expect(harnessOf({ ...release, runId: 1790872984620 }, [mt(1, "a", 1.1)])).toBe("stop-lead");
    expect(harnessOf(release, [mt(1, "a", 1.1)])).toBe("stop-after-click");
  });
});

describe("fisherOneSided", () => {
  it("gives the figure the register quotes for 1 in 416 against 2 in 168", () => {
    expect(fisherOneSided(1, 416, 2, 168)).toBeCloseTo(0.2, 2);
  });

  it("gives the chance that both of two events fall in the larger harness group", () => {
    expect(fisherOneSided(0, 60, 2, 108)).toBeCloseTo(0.412, 3);
  });

  it("is 1 when group B has no events and small when it has them all", () => {
    expect(fisherOneSided(3, 100, 0, 100)).toBe(1);
    expect(fisherOneSided(0, 400, 8, 400)).toBeLessThan(0.005);
  });
});

describe("exactRateInterval", () => {
  it("starts at zero and ends at 1 − 0.025^(1/n) for no events", () => {
    const [low, high] = exactRateInterval(0, 60);
    expect(low).toBe(0);
    expect(high).toBeCloseTo(1 - Math.pow(0.025, 1 / 60), 6);
  });

  it("brackets the observed rate", () => {
    const [low, high] = exactRateInterval(2, 168);
    expect(low).toBeGreaterThan(0.001);
    expect(low).toBeLessThan(2 / 168);
    expect(high).toBeGreaterThan(2 / 168);
    expect(high).toBeLessThan(0.05);
  });

  it("matches the exact bounds for 2 in 168 and for every repeat an event", () => {
    const [low, high] = exactRateInterval(2, 168);
    expect(low).toBeCloseTo(0.001445, 6);
    expect(high).toBeCloseTo(0.0423406, 6);
    // all 5 of 5: the lower bound is 0.025^(1/5), the upper is 1
    expect(exactRateInterval(5, 5)[0]).toBeCloseTo(Math.pow(0.025, 1 / 5), 6);
    expect(exactRateInterval(5, 5)[1]).toBe(1);
    // 1 of 5: the lower bound is 1 − 0.975^(1/5)
    expect(exactRateInterval(1, 5)[0]).toBeCloseTo(1 - Math.pow(0.975, 1 / 5), 6);
  });

  it("covers everything for no repeats", () => {
    expect(exactRateInterval(0, 0)).toEqual([0, 1]);
  });
});

describe("staleQuantaAtStamps", () => {
  const RATE = 48000;
  const Q = 128;
  /** The clock read `frame` on two calls running: the second call's quantum, whose true frame is `frame + Q`, is the stale one. */
  const stale = (frame: number, betweenChunks = false) => ({ previousFrame: frame, frame, betweenChunks });
  const sec = (frame: number) => frame / RATE;

  it("finds the stale read a recorder's first-quantum stamp equals", () => {
    expect(staleQuantaAtStamps([stale(96000)], { firstQuantumTimeSec: sec(96000) }, RATE))
      .toEqual([{ stamp: "first quantum", staleFrame: 96000, readsStaleFrame: true, quantaFromStale: 0 }]);
  });

  it("reads the engine's recording start one quantum back: it reports the END of the quantum it stamped in", () => {
    expect(staleQuantaAtStamps([stale(96000)], { recordingStartContextTimeSec: sec(96000 + Q) }, RATE))
      .toEqual([{ stamp: "recording start", staleFrame: 96000, readsStaleFrame: true, quantaFromStale: 0 }]);
  });

  it("finds a stamp taken in the quantum right AFTER the stale one: it reads two quanta more than the clock stood on", () => {
    // clock: 96000 (true), 96000 (stale, really 96128), 96256 (true): a first call there stamps 96256
    expect(staleQuantaAtStamps([stale(96000)], { firstQuantumTimeSec: sec(96000 + 2 * Q) }, RATE))
      .toEqual([{ stamp: "first quantum", staleFrame: 96000, readsStaleFrame: false, quantaFromStale: 1 }]);
  });

  it("measures from the stale quantum, two quanta either side, and no further", () => {
    const at = (stampFrame: number) =>
      staleQuantaAtStamps([stale(96000)], { firstQuantumTimeSec: sec(stampFrame) }, RATE).map((found) => found.quantaFromStale);
    expect(at(96000 - Q)).toEqual([-2]); // a true read two calls before the stale one
    expect(at(96000 + 3 * Q)).toEqual([2]);
    expect(at(96000 - 2 * Q)).toEqual([]);
    expect(at(96000 + 4 * Q)).toEqual([]);
  });

  it("does not take a step forward for a stale read: a lost chunk and the catch-up after a stale quantum look like that", () => {
    const forward = { previousFrame: 96000 - Q, frame: 96000 + Q, betweenChunks: false };
    expect(staleQuantaAtStamps([forward], { firstQuantumTimeSec: sec(96000) }, RATE)).toEqual([]);
  });

  it("takes a stale read at a chunk border too: a lost chunk cannot make the clock repeat itself", () => {
    expect(staleQuantaAtStamps([stale(96000, true)], { firstQuantumTimeSec: sec(96000) }, RATE)).toHaveLength(1);
  });

  it("has nothing to say about a row without stamps", () => {
    expect(staleQuantaAtStamps([stale(96000)], {}, RATE)).toEqual([]);
    expect(staleQuantaAtStamps([stale(96000)], { firstQuantumTimeSec: null, recordingStartContextTimeSec: null }, RATE)).toEqual([]);
  });
});
