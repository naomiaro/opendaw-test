import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { buildPattern } from "./midiInputPattern";
import { cellLabel, frameGapSummary, scheduleFor, sentNotesFrom, waitForRecordingStart } from "./midiInputCellRunner";

const anchor = { contextTime: 12.0, position: 0 };
const pair = { contextTime: 10.0, performanceTime: 5000 };

describe("scheduleFor", () => {
  it("places each note at the performance time its heard position is reached", () => {
    const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });
    const s = scheduleFor(pattern, anchor, pair, 120);
    expect(s[0].onPerfMs).toBeCloseTo(5000 + 2000 + 2000, 6); // anchor is 2 s after the pair; bar one at 120 is 2 s later
    expect(s[0].offPerfMs - s[0].onPerfMs).toBeCloseTo(125, 6); // half an eighth at 120 bpm
    expect(s[1].onPerfMs - s[0].onPerfMs).toBeCloseTo(250, 6);
    expect(s[0]).toMatchObject({ pitch: 36, velocity: 100 });
  });
});

describe("sentNotesFrom", () => {
  it("derives the heard expectation from the receipt stamp and nulls it without one", () => {
    const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null }).slice(0, 2);
    const scheduled = scheduleFor(pattern, anchor, pair, 120);
    const sent = sentNotesFrom(
      pattern, scheduled,
      [{ onPerfMs: scheduled[0].onPerfMs + 0.5, offPerfMs: null }, { onPerfMs: null, offPerfMs: null }],
      anchor, pair, 120, 0.023,
    );
    expect(sent[0].expectedPpqn).toBeCloseTo(BAR_PPQN + 0.96, 2); // 0.5 ms at 120 bpm = 0.96 pulses
    expect(sent[0].expectedRenderPpqn).toBeCloseTo(BAR_PPQN + 0.96 + 44.16, 1);
    expect(sent[0].scheduledPerfMs).toBe(scheduled[0].onPerfMs);
    expect(sent[1].expectedPpqn).toBeNull();
    expect(sent[1].receiptPerfMs).toBeNull();
    expect(cellLabel("loop-wrap", 90, 2)).toBe("loop-wrap/90/r2");
  });
});

describe("frameGapSummary", () => {
  it("gives the median and the largest gap between frame stamps", () => {
    const { frames, medianMs, maxGapMs } = frameGapSummary([0, 16.7, 33.4, 50.1, 2050, 2066.7]);
    expect(frames).toBe(6);
    expect(medianMs).toBeCloseTo(16.7, 6);
    expect(maxGapMs).toBeCloseTo(1999.9, 6);
  });
  it("is null with fewer than two stamps", () => {
    expect(frameGapSummary([5])).toEqual({ frames: 1, medianMs: null, maxGapMs: null });
  });
});

describe("waitForRecordingStart", () => {
  const fakeEngine = (initial: { contextTime: number; position: number } | null) => {
    let value = initial;
    const observers = new Set<() => void>();
    const option = {
      isEmpty: () => value === null,
      unwrap: () => value as { contextTime: number; position: number },
      catchupAndSubscribe: (observer: () => void) => {
        observers.add(observer);
        observer();
        return { terminate: () => observers.delete(observer) };
      },
    };
    return {
      project: { engine: { recordingStart: option } } as never,
      report: (next: { contextTime: number; position: number }) => { value = next; observers.forEach((o) => o()); },
      listeners: () => observers.size,
    };
  };
  it("skips the previous repeat's anchor and resolves on the first fresh one, then lets go of the subscription", async () => {
    const engine = fakeEngine({ contextTime: 10, position: 0 });
    const pending = waitForRecordingStart(engine.project, 12, 1000);
    engine.report({ contextTime: 11, position: 0 });
    engine.report({ contextTime: 12.4, position: 5.57 });
    await expect(pending).resolves.toEqual({ contextTime: 12.4, position: 5.57 });
    expect(engine.listeners()).toBe(0);
  });
  it("rejects at the deadline and lets go of the subscription", async () => {
    const engine = fakeEngine(null);
    await expect(waitForRecordingStart(engine.project, 12, 20)).rejects.toThrow(/no fresh recordingStart/);
    expect(engine.listeners()).toBe(0);
  });
});
