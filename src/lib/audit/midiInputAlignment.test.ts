import { describe, expect, it } from "vitest";
import { MIDI_TOLERANCES } from "./midiInputCalibration";
import {
  classifyMidiCell, expectedLateMedianMs, matchNotes, measureRepeat, median, MIDI_KNOWN_DEFECTS, percentile, splitCountIn,
  type RecordedNote, type SentNote,
} from "./midiInputAlignment";

const sent = (index: number, over: Partial<SentNote> = {}): SentNote => ({
  index, tag: "eighth", pitch: 36 + index, velocity: 100, onPpqn: 960 * index, durationPpqn: 240, wrapAdjacent: false,
  scheduledPerfMs: 1000 + 500 * index, receiptPerfMs: 1000.4 + 500 * index, offReceiptPerfMs: null,
  expectedPpqn: 960 * index, expectedRenderPpqn: 960 * index + 44, ...over,
});
const rec = (index: number, over: Partial<RecordedNote> = {}): RecordedNote => ({
  pitch: 36 + index, velocity: 100, absolutePpqn: 960 * index, durationPpqn: 240, takeIndex: 1, regionEndPpqn: 3840 * 4, ...over,
});

describe("matchNotes", () => {
  it("pairs each sent note with the recorded note of its pitch nearest the expectation", () => {
    const r = matchNotes([sent(0), sent(1)], [rec(1, { absolutePpqn: 965 }), rec(0, { absolutePpqn: -2 })], 120, 480);
    expect(r.matched.map((m) => [m.sent.index, m.placementErrorMs]))
      .toEqual([[0, expect.closeTo(-1.0417, 3)], [1, expect.closeTo(2.604, 3)]]);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
  });
  it("reports a sent note outside the window as missing and a stray recorded note as extra", () => {
    const r = matchNotes([sent(0)], [rec(0, { absolutePpqn: 600 }), rec(5)], 120, 480);
    expect(r.missing.map((n) => n.index)).toEqual([0]);
    expect(r.extra.map((n) => n.pitch)).toEqual([36, 41]);
  });
  it("sets a sent note without a receipt aside as receiptsMissing, never matched", () => {
    const r = matchNotes([sent(0, { receiptPerfMs: null, expectedPpqn: null, expectedRenderPpqn: null })], [rec(0)], 120, 480);
    expect(r.receiptsMissing.length).toBe(1);
    expect(r.matched).toEqual([]);
    expect(r.extra.length).toBe(1);
  });
  it("flags a velocity off by more than one, and a never-released key whose region ends at the next beat past its last write as stuck", () => {
    // RecordMidi keeps a held key's duration at the last per-frame write and rounds the region end up to the beat
    const lastWrite = 960 + 2900;
    const r = matchNotes([sent(0), sent(1)], [rec(0, { velocity: 97 }), rec(1, { durationPpqn: 2900, regionEndPpqn: Math.ceil(lastWrite / 960) * 960 })], 120, 480);
    expect(r.matched[0].velocityMismatch).toBe(true);
    expect(r.matched[0].stuck).toBe(false);
    expect(r.matched[1].stuck).toBe(true);
  });
  it("does not call a key stuck that was released long before the take ended", () => {
    const r = matchNotes([sent(0)], [rec(0, { durationPpqn: 900, regionEndPpqn: 3840 * 4 })], 120, 480);
    expect(r.matched[0].stuck).toBe(false);
  });
  it("does not call a note of its sent length stuck because a late take lets it overhang the region end", () => {
    const end = 3840 * 4;
    const r = matchNotes([sent(0, { expectedPpqn: end - 260 })], [rec(0, { absolutePpqn: end - 200, durationPpqn: 238 })], 120, 480);
    expect(r.matched.length).toBe(1);
    expect(r.matched[0].stuck).toBe(false);
  });
});

describe("measureRepeat", () => {
  it("judges matched notes minus count-in and wrap-adjacent ones", () => {
    const s = [sent(0), sent(1, { wrapAdjacent: true }), sent(2, { tag: "countin" })];
    const f = measureRepeat(matchNotes(s, [rec(0), rec(1, { absolutePpqn: 960 - 100 }), rec(2)], 120, 480));
    expect(f).toMatchObject({ notesSent: 3, notesRecorded: 3, judgedNotes: 1, wrapAdjacent: 1, countInNotes: 1, countInRecorded: 0, missing: 0, extra: 0 });
    expect(f.placementMedianMs).toBeCloseTo(0, 6);
  });
  it("reports the spread as the largest deviation from the median and the p5–p95 width", () => {
    const s = [0, 1, 2, 3, 4].map((i) => sent(i));
    const r = [0, 1, 2, 3, 4].map((i) => rec(i, { absolutePpqn: 960 * i + [0, 2, 4, 6, 40][i] }));
    const f = measureRepeat(matchNotes(s, r, 120, 480));
    expect(f.placementMedianMs).toBeCloseTo((4 / 960) * 500, 6);
    expect(f.placementMaxAbsDevMs).toBeCloseTo((36 / 960) * 500, 6);
    expect(f.loopbackDelayMedianMs).toBeCloseTo(0.4, 6);
  });
  it("gives null figures and zero judged notes when nothing matched", () => {
    const f = measureRepeat(matchNotes([sent(0)], [], 120, 480));
    expect(f).toMatchObject({ judgedNotes: 0, missing: 1, placementMedianMs: null, placementMaxAbsDevMs: null });
  });
});

describe("collapsed releases", () => {
  it("counts a note written at the recorder's minimum length while it was sent longer, and keeps it out of the duration figures", () => {
    const r = matchNotes([sent(0), sent(1)], [rec(0, { durationPpqn: 30 }), rec(1, { durationPpqn: 236 })], 120, 480);
    expect(r.matched[0].collapsed).toBe(true);
    expect(r.matched[1].collapsed).toBe(false);
    const f = measureRepeat(r);
    expect(f.collapsed).toBe(1);
    expect(f.durationErrorMaxMs).toBeCloseTo((4 / 960) * 500, 6);
  });
  it("is not a collapse when the note was sent that short", () => {
    const r = matchNotes([sent(0, { durationPpqn: 40 })], [rec(0, { durationPpqn: 30 })], 120, 480);
    expect(r.matched[0].collapsed).toBe(false);
  });
  it("counts a release written at less than half the sent length after a block, and not the clamp jitter", () => {
    const r = matchNotes([sent(0), sent(1)], [rec(0, { durationPpqn: 39 }), rec(1, { durationPpqn: 219 })], 120, 480);
    expect(r.matched[0].collapsed).toBe(true);
    expect(r.matched[1].collapsed).toBe(false);
  });
});

describe("median / percentile", () => {
  it("handles even counts and interpolates percentiles", () => {
    expect(median([3, 1, 2, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(percentile([0, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 95)).toBeCloseTo(4.8, 9);
  });
});

describe("MIDI_KNOWN_DEFECTS", () => {
  const row = (medianMs: number, spread: number, durationMax: number): ReturnType<typeof measureRepeat> => ({
    notesSent: 48, notesRecorded: 48, judgedNotes: 48, missing: 0, receiptsMissing: 0, extra: 0, stuck: 0, velocityMismatches: 0,
    placementMedianMs: medianMs, placementMaxAbsDevMs: spread, placementP5P95Ms: spread, durationErrorMedianMs: 0, durationErrorMaxMs: durationMax,
    loopbackDelayMedianMs: 0, loopbackDelayMaxMs: 0, wrapAdjacent: 0, countInNotes: 0, countInRecorded: 0, collapsed: 0,
  });
  const mac60 = { outputLatencyMs: 23, compensationLatencyMs: 0, frameIntervalMs: 16.7, sampleRate: 44100 };
  it("derives the expected median from the row's own latency, frame and quantum", () => {
    // 2 × 23 − (16.7 − 2.9) = 32.2
    expect(expectedLateMedianMs(mac60)).toBeCloseTo(32.2, 1);
    // an interface at 10 ms and a 120 Hz display at 48 kHz: 20 − (8.3 − 2.67) = 14.4
    expect(expectedLateMedianMs({ outputLatencyMs: 10, compensationLatencyMs: 0, frameIntervalMs: 8.3, sampleRate: 48000 })).toBeCloseTo(14.4, 1);
  });
  it("classifies every bring-up row of the register from its own figures, the 18.6 ms frame included", () => {
    expect(classifyMidiCell("midtimeline-start", [row(32.64, 9.72, 12.5), row(33.33, 9.72, 9.72)], MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS,
      [{ ...mac60, frameIntervalMs: 18.57 }, { ...mac60, frameIntervalMs: 17.33 }]).status).toBe("matches-known-defect");
    expect(classifyMidiCell("loop-wrap", [row(32.82, 10.42, 10.94), row(32.82, 9.38, 13.54)], MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS,
      [{ ...mac60, frameIntervalMs: 17.02 }, { ...mac60, frameIntervalMs: 16.8 }]).status).toBe("matches-known-defect");
  });
  it("moves with the device: a 120 Hz display or another output latency gets its own band, and a row without figures misses", () => {
    const hz120 = { ...mac60, frameIntervalMs: 8.33 }; // expected 2 × 23 − (8.33 − 2.9) = 40.6
    expect(classifyMidiCell("nominal-start", [row(40.5, 7, 8)], MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS, [hz120]).status).toBe("matches-known-defect");
    expect(classifyMidiCell("nominal-start", [row(32.8, 7, 8)], MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS, [hz120]).status).toBe("investigate");
    const iface = { outputLatencyMs: 10, compensationLatencyMs: 0, frameIntervalMs: 16.7, sampleRate: 48000 }; // expected 20 − 14 = 6
    expect(classifyMidiCell("nominal-start", [row(6.5, 7, 8)], MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS, [iface]).status).toBe("matches-known-defect");
    expect(classifyMidiCell("nominal-start", [row(32.8, 7, 8)], MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS, [null]).status).toBe("investigate");
  });
  it("bounds the jitter by a frame plus a quantum of the row, and a collapsed release only in janked-mid", () => {
    expect(classifyMidiCell("nominal-start", [row(32.8, 19, 8)], MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS, [mac60]).status).toBe("matches-known-defect");
    expect(classifyMidiCell("nominal-start", [row(32.8, 24, 8)], MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS, [mac60]).status).toBe("investigate");
    expect(classifyMidiCell("nominal-start", [{ ...row(33, 9.4, 8), collapsed: 1 }], MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS, [mac60]))
      .toMatchObject({ status: "investigate", detail: expect.stringContaining("collapsed 1") });
    const janked = classifyMidiCell("janked-mid", [{ ...row(33, 9.4, 8), collapsed: 1 }, row(33, 9.4, 8)], MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS, [mac60, mac60]);
    expect(janked.status).toBe("matches-known-defect");
    expect(janked.detail).toContain("release");
    expect(classifyMidiCell("janked-mid", [{ ...row(33, 9.4, 8), collapsed: 2 }], MIDI_TOLERANCES, MIDI_KNOWN_DEFECTS, [mac60]).status).toBe("investigate");
  });
});

describe("splitCountIn", () => {
  it("moves recorded notes at count-in pitches out of extra and counts them", () => {
    const r = matchNotes([sent(0)], [rec(0), rec(5, { pitch: 85 }), rec(6, { pitch: 90 })], 120, 480);
    const { match, countInRecorded } = splitCountIn(r, [85, 86]);
    expect(countInRecorded.map((n) => n.pitch)).toEqual([85]);
    expect(match.extra.map((n) => n.pitch)).toEqual([90]);
    const f = measureRepeat(match, { sent: 2, recorded: countInRecorded.length });
    expect(f.countInNotes).toBe(2);
    expect(f.countInRecorded).toBe(1);
  });
});

describe("classifyMidiCell", () => {
  const clean = (medianMs: number, spread = 1): ReturnType<typeof measureRepeat> => ({
    notesSent: 48, notesRecorded: 48, judgedNotes: 48, missing: 0, receiptsMissing: 0, extra: 0, stuck: 0, velocityMismatches: 0,
    placementMedianMs: medianMs, placementMaxAbsDevMs: spread, placementP5P95Ms: spread, durationErrorMedianMs: 0, durationErrorMaxMs: 1,
    loopbackDelayMedianMs: 0.4, loopbackDelayMaxMs: 0.9, wrapAdjacent: 0, countInNotes: 0, countInRecorded: 0, collapsed: 0,
  });
  it("is aligned only when every repeat is clean and inside every tolerance", () => {
    expect(classifyMidiCell("nominal-start", [clean(1), clean(-2)], MIDI_TOLERANCES).status).toBe("aligned");
    expect(classifyMidiCell("nominal-start", [clean(1), clean(31.4)], MIDI_TOLERANCES))
      .toMatchObject({ status: "investigate", detail: expect.stringContaining("placementMedianMs 31.4") });
    expect(classifyMidiCell("nominal-start", [clean(1, 12)], MIDI_TOLERANCES).detail).toContain("placementMaxAbsDevMs");
    expect(classifyMidiCell("nominal-start", [{ ...clean(0), missing: 1 }], MIDI_TOLERANCES).detail).toContain("missing 1");
  });
  it("lets a static band carry a fixed median range and jitter bound", () => {
    const band = [{ id: "fixed", scenario: "any" as const, medianMs: [28, 38] as [number, number], maxDevMs: 12, detail: "fixed" }];
    expect(classifyMidiCell("loop-wrap", [clean(32.8, 10.4), clean(33.3, 9.9)], MIDI_TOLERANCES, band).status).toBe("matches-known-defect");
    expect(classifyMidiCell("loop-wrap", [clean(32.8, 13), clean(33.3, 9.9)], MIDI_TOLERANCES, band).status).toBe("investigate");
  });
  it("lets a band carry the release jitter as a duration bound and misses a collapsed release", () => {
    const band = [{
      id: "midi-late-60hz", scenario: "any" as const, medianMs: [28, 38] as [number, number], maxDevMs: 12, durationErrorMs: 15,
      detail: "clamp jitter on releases too",
    }];
    expect(classifyMidiCell("nominal-start", [{ ...clean(33, 9.6), durationErrorMaxMs: 10.94 }], MIDI_TOLERANCES, band).status).toBe("matches-known-defect");
    expect(classifyMidiCell("janked-mid", [{ ...clean(33, 9.6), durationErrorMaxMs: 93.75 }], MIDI_TOLERANCES, band))
      .toMatchObject({ status: "investigate", detail: expect.stringContaining("durationErrorMaxMs 93.75") });
    expect(classifyMidiCell("nominal-start", [{ ...clean(1, 1), durationErrorMaxMs: 10 }], MIDI_TOLERANCES, band).status).toBe("investigate");
  });
  it("matches a known-defect band on the median when counts and spread are clean", () => {
    const band = [{ id: "midi-late-2x", scenario: "any" as const, medianMs: [25, 45] as [number, number], detail: "twice the output latency" }];
    expect(classifyMidiCell("nominal-start", [clean(31), clean(33)], MIDI_TOLERANCES, band).status).toBe("matches-known-defect");
    expect(classifyMidiCell("nominal-start", [clean(31), clean(50)], MIDI_TOLERANCES, band).status).toBe("investigate");
    expect(classifyMidiCell("nominal-start", [{ ...clean(31), extra: 1 }], MIDI_TOLERANCES, band).status).toBe("investigate");
  });
});
