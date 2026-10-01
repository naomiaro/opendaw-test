/**
 * The stop lead, the wait that places a loop-wrap repeat's stop, and the reading
 * of the lead a row persists. Together they decide whether a repeat ends before
 * the next metronome click, and whether a missed lead can be seen afterwards:
 * no verdict looks at it, it only brings back a click at the repeat boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@opendaw/studio-core";
import { BAR_PPQN } from "./auditExpectations";
import { RECORDING_AUDIT_BPMS } from "./recordingAuditCalibration";
import {
  STOP_LEAD_PPQN, STOP_ROUND_TRIP_MS, STOP_TRAIL_MS, readRecordingStart, readStopLead, stopClickPpqn,
  stopLeadMs, waitForPositionWithin,
} from "./recordingCellRunner";

const BEAT_PPQN = BAR_PPQN / 4;
const msOf = (ppqn: number, bpm: number) => (ppqn / BEAT_PPQN) * (60_000 / bpm);

describe("STOP_LEAD_PPQN", () => {
  it.each(RECORDING_AUDIT_BPMS)("clears the stop's trail at %s BPM", (bpm) => {
    expect(msOf(STOP_LEAD_PPQN, bpm)).toBeGreaterThanOrEqual(STOP_TRAIL_MS);
  });

  it.each(RECORDING_AUDIT_BPMS)("leaves loop-wrap's stop short of beat 2 at %s BPM", (bpm) => {
    // loop-wrap waits for one beat less the lead into the pass, then stops
    expect(msOf(BEAT_PPQN - STOP_LEAD_PPQN, bpm) + STOP_TRAIL_MS).toBeLessThan(msOf(BEAT_PPQN, bpm));
  });
});

describe("stopClickPpqn", () => {
  const LOOP_PPQN = 2 * BAR_PPQN;

  it("is the downbeat after the four bars for a linear repeat, with the lead or without", () => {
    expect(stopClickPpqn(false, 0, true, 4 * BAR_PPQN - STOP_LEAD_PPQN)).toBe(4 * BAR_PPQN);
    expect(stopClickPpqn(false, 2 * BAR_PPQN, false, 6 * BAR_PPQN + 20)).toBe(6 * BAR_PPQN);
  });

  it("is beat 2 of the last pass for loop-wrap with the lead", () => {
    expect(stopClickPpqn(true, 0, true, BEAT_PPQN - STOP_LEAD_PPQN)).toBe(BEAT_PPQN);
  });

  it("is the loop's downbeat for loop-wrap without the lead, on either side of the wrap", () => {
    // read after the wrap: the stop follows the click at 0 by a few milliseconds
    expect(stopClickPpqn(true, 0, false, 40)).toBe(0);
    expect(stopLeadMs(40, stopClickPpqn(true, 0, false, 40), 120)).toBeCloseTo(-20.83, 2);
    // read still from before the wrap: the same click, at the loop's end
    expect(stopClickPpqn(true, 0, false, LOOP_PPQN - 10)).toBe(LOOP_PPQN);
    expect(stopLeadMs(LOOP_PPQN - 10, stopClickPpqn(true, 0, false, LOOP_PPQN - 10), 120)).toBeCloseTo(5.21, 2);
  });
});

describe("stopLeadMs", () => {
  const CLICK = 4 * BAR_PPQN;

  it("is the time from the request to the click at the row's tempo", () => {
    expect(stopLeadMs(CLICK - STOP_LEAD_PPQN, CLICK, 120)).toBeCloseTo(250, 6);
    expect(stopLeadMs(CLICK - STOP_LEAD_PPQN, CLICK, 97.3)).toBeCloseTo(30_000 / 97.3, 6);
  });

  it("is negative for a request sent after the click's position", () => {
    expect(stopLeadMs(CLICK + BEAT_PPQN / 2, CLICK, 120)).toBeCloseTo(-250, 6);
  });
});

describe("readStopLead", () => {
  const CLICK = 4 * BAR_PPQN;
  const at = (ppqn: number) => ({ engine: { position: { getValue: () => ppqn } } }) as unknown as Project;
  afterEach(() => vi.restoreAllMocks());

  it("returns the lead and stays quiet when the request clears the round trip", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readStopLead(at(CLICK - STOP_LEAD_PPQN), CLICK, 120, "cell")).toBeCloseTo(250, 6);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns, naming the cell, when the request is too close to the click or past it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const late = readStopLead(at(CLICK - 10), CLICK, 120, "nominal-start/120/r1");
    expect(late).toBeLessThan(STOP_ROUND_TRIP_MS);
    expect(readStopLead(at(CLICK + 100), CLICK, 120, "nominal-start/120/r2")).toBeLessThan(0);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain("nominal-start/120/r1");
  });
});

describe("readRecordingStart", () => {
  const option = (value: { contextTime: number; position: number } | null) => ({
    isEmpty: () => value === null,
    unwrap: () => {
      if (value === null) throw new Error("empty");
      return value;
    },
  });

  it("returns the engine's report", () => {
    expect(readRecordingStart({ recordingStart: option({ contextTime: 12.345, position: 5.12 }) }))
      .toEqual({ contextTimeSec: 12.345, positionPpqn: 5.12 });
  });

  it("returns nulls while the engine has not reported", () => {
    expect(readRecordingStart({ recordingStart: option(null) })).toEqual({ contextTimeSec: null, positionPpqn: null });
  });

  it("returns nulls on a build whose engine has no such report", () => {
    expect(readRecordingStart({})).toEqual({ contextTimeSec: null, positionPpqn: null });
  });
});

describe("waitForPositionWithin", () => {
  const FROM = BEAT_PPQN - STOP_LEAD_PPQN;
  const BELOW = 2 * BAR_PPQN - BEAT_PPQN;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A project whose engine position is whatever `read` returns, counting the reads. */
  function projectAt(read: () => number) {
    const getValue = vi.fn(read);
    return { project: { engine: { position: { getValue } } } as unknown as Project, getValue };
  }

  async function settledAfter(promise: Promise<void>, ms: number): Promise<"resolved" | "pending"> {
    let state: "resolved" | "pending" = "pending";
    void promise.then(() => { state = "resolved"; }, () => {});
    await vi.advanceTimersByTimeAsync(ms);
    return state;
  }

  it("does not take a read from before the wrap for arrival", async () => {
    const { project } = projectAt(() => 2 * BAR_PPQN - 80); // the loop's last beat
    expect(await settledAfter(waitForPositionWithin(project, FROM, BELOW, 20_000), 500)).toBe("pending");
  });

  it("waits while the pass is still short of the window", async () => {
    const { project } = projectAt(() => FROM - 1);
    expect(await settledAfter(waitForPositionWithin(project, FROM, BELOW, 20_000), 500)).toBe("pending");
  });

  it("resolves at the lower bound and not at the upper one", async () => {
    expect(await settledAfter(waitForPositionWithin(projectAt(() => FROM).project, FROM, BELOW, 20_000), 0)).toBe("resolved");
    expect(await settledAfter(waitForPositionWithin(projectAt(() => BELOW).project, FROM, BELOW, 20_000), 500)).toBe("pending");
  });

  it("resolves once the position moves from before the wrap into the window", async () => {
    let position = 2 * BAR_PPQN - 80;
    const { project } = projectAt(() => position);
    const wait = waitForPositionWithin(project, FROM, BELOW, 20_000);
    expect(await settledAfter(wait, 200)).toBe("pending");
    position = 100; // wrapped, still short of the window
    expect(await settledAfter(wait, 200)).toBe("pending");
    position = FROM + 10;
    expect(await settledAfter(wait, 100)).toBe("resolved");
  });

  it("rejects with its own label at the deadline and stops polling", async () => {
    const { project, getValue } = projectAt(() => 0);
    const wait = waitForPositionWithin(project, FROM, BELOW, 1_000);
    const rejection = expect(wait).rejects.toThrow(`waitForPositionWithin(${FROM}, ${BELOW}) timed out after 1s`);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    const readsAtDeadline = getValue.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getValue.mock.calls.length).toBe(readsAtDeadline);
  });
});
