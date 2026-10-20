import { describe, expect, it } from "vitest";
import { classifyCombinedCell, expectedPartsApartMs } from "./combinedVerdict";

const ctx = (state: "default" | "calibrated", micInputPartMs = 40.9, outputLatencyMs = 23) => ({
  outputLatencyMs, compensationLatencyMs: 0, frameIntervalMs: 16.7, sampleRate: 44100,
  state, micRoundTripMs: micInputPartMs + 23, micInputPartMs, inputLatencyAppliedMs: state === "calibrated" ? micInputPartMs : 0,
});
const midi = (over = {}) => ({
  notesSent: 48, notesRecorded: 48, judgedNotes: 48, missing: 0, receiptsMissing: 0, extra: 0, stuck: 0, velocityMismatches: 0, collapsed: 0,
  placementMedianMs: 32.8, placementMaxAbsDevMs: 9, placementP5P95Ms: 8, durationErrorMedianMs: 0, durationErrorMaxMs: 8,
  loopbackDelayMedianMs: 0, loopbackDelayMaxMs: 0, wrapAdjacent: 0, countInNotes: 0, countInRecorded: 0, ...over,
});
const combined = (apart: number, audio: number, over = {}) => ({
  clicksFound: 48, clicksMissing: 0, clicksExtra: 0, onsetsOutsideSpan: 0, audioMedianMs: audio, audioMaxAbsDevMs: 3,
  pairs: 48, partsApartMedianMs: apart, partsApartMaxAbsDevMs: 9, partsApartP5P95Ms: 8, anchorOffsetMs: audio, ...over,
});

describe("expectedPartsApartMs", () => {
  it("is the MIDI late term minus what the SDK was not told about the microphone", () => {
    expect(expectedPartsApartMs(ctx("default"))).toBeCloseTo(32.2 - 40.9, 1);
    expect(expectedPartsApartMs(ctx("calibrated"))).toBeCloseTo(32.2, 1);
  });
});

describe("classifyCombinedCell", () => {
  it("is together only within a quantum and a frame of jitter, else the band computed from the row", () => {
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(1.5, 40.9, { partsApartMaxAbsDevMs: 5 }), context: ctx("default") }]).status).toBe("together");
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(-8.6, 40.9), context: ctx("default") }]).status).toBe("matches-known-defect");
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(32.5, 0.4), context: ctx("calibrated") }]).status).toBe("matches-known-defect");
  });
  it("names a microphone path that moved after the calibration, before any band, in either state and past the band's own margin", () => {
    const v = classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(-32, 64.8), context: ctx("default") }]);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/disagrees with the calibration/);
    // 7.6 ms off the calibration: enough to break the ±5 band, so it must be the calibration that is named
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(-16, 48.5), context: ctx("default") }]).detail).toMatch(/disagrees with the calibration/);
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(25, 8), context: ctx("calibrated") }]).detail).toMatch(/disagrees with the calibration/);
  });
  it("judges the audio side against the repeat's own output latency, so a drift since the calibration cancels", () => {
    // calibrated at 23 ms (round trip 63.9, input part 40.9); the repeat reads 31 ms: the SDK subtracts 31, the audio lands at 63.9 − 31 = 32.9
    const drifted = ctx("default", 40.9, 31);
    const v = classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(expectedPartsApartMs(drifted), 32.9), context: drifted }]);
    expect(v.status).toBe("matches-known-defect");
  });
  it("fails on a lost click or a MIDI integrity count and on a missing context", () => {
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(-8.6, 40.9, { clicksMissing: 1 }), context: ctx("default") }]).detail).toContain("clicksMissing 1");
    expect(classifyCombinedCell("nominal-start", [{ midi: midi({ missing: 1 }), combined: combined(-8.6, 40.9), context: ctx("default") }]).detail).toContain("missing 1");
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(-8.6, 40.9), context: null }]).detail).toContain("no band context");
  });
});
