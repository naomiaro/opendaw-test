import { describe, expect, it } from "vitest";
import {
  FIRST_RUN_ON_0_0_173,
  eventsOfRun,
  exactRateInterval,
  fisherOneSided,
  harnessOf,
  modalValue,
  quantumMs,
  repeatsOf,
  sdkOf,
  type EventRow,
  type RunIdentity,
} from "./oneQuantumEvents";

const mt = (repeat: number, tape: string, netted: number | null, ffc: number | null = 0): EventRow =>
  ({ scenario: "multitrack-janked", bpm: 120, repeat, tape, medianBeatErrorMsNetted: netted, firstFrameCheckMs: ffc });

describe("quantumMs and modalValue", () => {
  it("is 128 frames at the rate", () => {
    expect(quantumMs(48000)).toBeCloseTo(2.6667, 4);
    expect(quantumMs(44100)).toBeCloseTo(2.9025, 4);
  });

  it("returns the most frequent value and null for none", () => {
    expect(modalValue([1.146, 1.146, 3.813, 1.146])).toBeCloseTo(1.15, 6);
    expect(modalValue([])).toBeNull();
  });
});

describe("eventsOfRun", () => {
  it("counts a repeat whose netted median is a quantum off the run's mode", () => {
    const rows = [mt(1, "a", 1.146), mt(1, "b", 1.146), mt(2, "a", 3.813), mt(2, "b", 3.813), mt(3, "a", 1.146), mt(3, "b", 1.146)];
    const { repeats, events } = eventsOfRun(rows, 48000);
    expect(repeats).toBe(3);
    expect(events.map((event) => event.repeat)).toEqual([2]);
  });

  it("counts a repeat whose first-frame check is a quantum off zero even with the usual netted median", () => {
    const rows = [mt(1, "a", 1.146), mt(1, "b", 1.146, -2.667), mt(2, "a", 1.146), mt(2, "b", 1.146)];
    expect(eventsOfRun(rows, 48000).events.map((event) => event.repeat)).toEqual([1]);
  });

  it("does not count the spread of loop-wrap takes at 44.1 kHz", () => {
    const rows: EventRow[] = [0.97, 1.05, 1.12, 1.18, 1.19, 1.17].map((netted, takeIndex) =>
      ({ scenario: "loop-wrap", bpm: 120, repeat: 1, takeIndex, medianBeatErrorMsNetted: netted }));
    const { repeats, events } = eventsOfRun(rows, 44100);
    expect(repeats).toBe(1);
    expect(events).toEqual([]);
  });

  it("leaves out a repeat with a row that has no netted median", () => {
    const rows = [mt(1, "a", 1.146), mt(1, "b", null), mt(2, "a", 1.146), mt(2, "b", 1.146)];
    expect(repeatsOf(rows).map((reading) => reading.repeat)).toEqual([2]);
    expect(eventsOfRun(rows, 48000).repeats).toBe(1);
  });

  it("returns nothing for a run without netted medians", () => {
    expect(eventsOfRun([mt(1, "a", null)], 48000)).toEqual({ repeats: 0, events: [], modeMs: null });
  });
});

describe("sdkOf and harnessOf", () => {
  const release: RunIdentity = { runId: 1790709786130, sdkVersion: null, stopLead: null, sdkBuildProbe: "upstream", buildFeatures: ["recordingStart"] };

  it("reads the version off the envelope when it is there", () => {
    expect(sdkOf({ ...release, sdkVersion: "0.0.172", runId: FIRST_RUN_ON_0_0_173 + 10 })).toBe("0.0.172");
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

  it("covers everything for no repeats", () => {
    expect(exactRateInterval(0, 0)).toEqual([0, 1]);
  });
});
