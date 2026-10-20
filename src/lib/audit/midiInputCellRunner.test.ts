import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { buildPattern } from "./midiInputPattern";
import { cellLabel, frameGapSummary, runMidiCellRepeat, scheduleContext, scheduleFor, sentNotesFrom, waitForRecordingStart } from "./midiInputCellRunner";

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

describe("scheduleContext", () => {
  it("gives the render context time and the performance time of a position from one anchor and pair", () => {
    const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });
    const c = scheduleContext(pattern, scheduleFor(pattern, anchor, pair, 120), anchor, pair, 120, BAR_PPQN);
    expect(c.contextSecAt(BAR_PPQN)).toBeCloseTo(14, 9);
    expect(c.perfAt(BAR_PPQN)).toBeCloseTo(9000, 6);
    expect(c.originPpqn).toBe(BAR_PPQN);
  });
});

describe("runMidiCellRepeat and the metronome preference", () => {
  it("applies the option before the body and restores the flag and the gain it found, on a throw too", async () => {
    const metronome = { enabled: true, gain: -6 };
    let seenDuringBody: { enabled: boolean; gain: number } | null = null;
    const audioContext = { get state() { seenDuringBody = { ...metronome }; return "suspended"; } } as unknown as AudioContext;
    const project = { engine: { preferences: { settings: { metronome, recording: {} } } } } as never;
    await expect(runMidiCellRepeat({
      project, audioContext, loopback: {} as never, audioUnitBox: {} as never, scenario: "nominal-start", bpm: 120, repeat: 1,
      onStage: () => undefined, token: { cancelled: false }, metronome: { enabled: false, gainDb: -120 },
    })).rejects.toThrow(/AudioContext is suspended/);
    expect(seenDuringBody).toEqual({ enabled: false, gain: -120 });
    expect(metronome).toEqual({ enabled: true, gain: -6 });
  });
});

describe("the metronome gain option", () => {
  it("refuses a non-finite gain, which would serialise as null in the persisted preferences", async () => {
    const metronome = { enabled: true, gain: -6 };
    const project = { engine: { preferences: { settings: { metronome, recording: {} } } } } as never;
    await expect(runMidiCellRepeat({
      project, audioContext: {} as never, loopback: {} as never, audioUnitBox: {} as never, scenario: "nominal-start", bpm: 120, repeat: 1,
      onStage: () => undefined, token: { cancelled: false }, metronome: { enabled: false, gainDb: Number.NEGATIVE_INFINITY },
    })).rejects.toThrow(/finite/);
    expect(metronome).toEqual({ enabled: true, gain: -6 });
  });
});

describe("the metronome restore of an abandoned repeat", () => {
  it("does not restore when the token was cancelled, so a later repeat is not flipped under it", async () => {
    const metronome = { enabled: true, gain: -6 };
    const token = { cancelled: false };
    const audioContext = { get state() { token.cancelled = true; return "suspended"; } } as unknown as AudioContext;
    const project = { engine: { preferences: { settings: { metronome, recording: {} } } } } as never;
    await expect(runMidiCellRepeat({
      project, audioContext, loopback: {} as never, audioUnitBox: {} as never, scenario: "nominal-start", bpm: 120, repeat: 1,
      onStage: () => undefined, token, metronome: { enabled: false, gainDb: -120 },
    })).rejects.toThrow();
    expect(metronome).toEqual({ enabled: false, gain: -120 }); // left to the page's own run-level restore
  });
});
