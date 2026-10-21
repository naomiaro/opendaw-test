import { describe, expect, it } from "vitest";
import { classifyRow, classifyTake, frameBlockedMs, MIN_HIDDEN_SPAN_MS, positionFrozenMs, syncResumeMs, type TakeFigures } from "./hiddenRecordingVerdict";

const good: TakeFigures = {
  appeared: true, finalized: true, finalizeMs: 120, regionDurationSec: 15.75, expectedDurationSec: 15.75,
  beatsMatched: 31, beatsMissing: 0, medianBeatErrorMs: 1.1, alignedToleranceMs: 3, finalizeReason: null,
};
const s = (atMs: number, positionPpqn: number, recording = true) => ({ atMs, positionPpqn, recording });

describe("positionFrozenMs / syncResumeMs / frameBlockedMs", () => {
  it("reads the longest unchanged run while recording and the resume after visible", () => {
    const samples = [s(0, 0), s(100, 480), s(200, 960), s(300, 960), s(400, 960), s(500, 960), s(600, 2880), s(700, 3360)];
    expect(positionFrozenMs(samples)).toBe(300);
    expect(syncResumeMs(samples, 450)).toBe(150);
    expect(syncResumeMs([s(0, 0), s(100, 0)], 50)).toBeNull();
    expect(positionFrozenMs([s(0, 0, false), s(100, 0, false)])).toBe(0);
    expect(frameBlockedMs({ maxGapMs: 5120 })).toBe(5120);
    expect(frameBlockedMs({ maxGapMs: null })).toBe(0);
  });
});

describe("classifyTake", () => {
  it("is intact only when everything holds, and names the first thing that does not", () => {
    expect(classifyTake(good).verdict).toBe("intact");
    expect(classifyTake({ ...good, appeared: false, finalized: false })).toEqual({ verdict: "not-finalized", detail: "no take appeared" });
    expect(classifyTake({ ...good, finalized: false }).verdict).toBe("not-finalized");
    expect(classifyTake({ ...good, finalized: false, finalizeReason: "decode failed: EncodingError" }).detail).toBe("the take's file never finished loading: decode failed: EncodingError");
    expect(classifyTake({ ...good, beatsMissing: 3 }).verdict).toBe("audio-damaged");
    expect(classifyTake({ ...good, regionDurationSec: 15.60 }).verdict).toBe("audio-damaged");
    expect(classifyTake({ ...good, regionDurationSec: 15.71 }).verdict).toBe("intact");
    expect(classifyTake({ ...good, regionDurationSec: 15.90 }).verdict).toBe("intact"); // a stop that landed late only adds
    expect(classifyTake({ ...good, medianBeatErrorMs: 4 }).verdict).toBe("audio-damaged");
  });
});

describe("classifyRow", () => {
  it("reads not-hidden for a run that never hid or blocked, or did so under the floor, and session-stuck for a second take that never started", () => {
    expect(classifyRow({ interrupt: "cover", hiddenSpanMs: null, take1: good, take2: good, take2Started: true }).take1).toBe("not-hidden");
    expect(classifyRow({ interrupt: "modal", hiddenSpanMs: null, take1: good, take2: good, take2Started: true }).take1).toBe("not-hidden");
    const flick = classifyRow({ interrupt: "modal", hiddenSpanMs: MIN_HIDDEN_SPAN_MS - 1, take1: good, take2: good, take2Started: true });
    expect(flick.take1).toBe("not-hidden");
    expect(flick.detail).toContain("999 ms");
    expect(classifyRow({ interrupt: "cover", hiddenSpanMs: MIN_HIDDEN_SPAN_MS, take1: good, take2: good, take2Started: true }).take1).toBe("intact");
    expect(classifyRow({ interrupt: "cover", hiddenSpanMs: 5000, take1: good, take2: null, take2Started: false }).take2).toBe("session-stuck");
  });
});
