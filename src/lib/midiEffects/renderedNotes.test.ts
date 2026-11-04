import { describe, expect, it } from "vitest";
import { markReadability, type RuleContext, type RuleNote } from "@/lib/audit/midiEffectSemanticsRules";
import type { NoteFigure } from "@/lib/audit/midiEffectSemanticsReader";
import { ARPEGGIO_BASE, NANO_ATTACK_SECONDS, NANO_RELEASE_SECONDS, renderRange } from "@/lib/audit/midiEffectSemanticsRows";
import { READER_DEFAULTS } from "@/lib/audit/midiEffectSemanticsReader";
import { PATTERN_BPM, REGION_START_PPQN, patternById, withGaps } from "./patterns";
import {
  MATCH_MS, msToRegionPpqn, predictChain, predictedMs, renderedRows, type ChainSetting, type MarkOptions, type Prediction,
} from "./renderedNotes";

const bpm = PATTERN_BPM;
const context: RuleContext = { range: renderRange(PATTERN_BPM), computeVelocity: (_p, v) => v, warp: (p) => p };
const mark: MarkOptions = {
  attackMs: NANO_ATTACK_SECONDS * 1000,
  releaseMs: NANO_RELEASE_SECONDS * 1000,
  gapMs: READER_DEFAULTS.gapMs,
  minCycles: READER_DEFAULTS.minCycles,
  minVelocity: 0.01,
};
const melody = patternById("melody");
/** At 120 bpm a pulse is 0.5208 ms and the region starts at 2000 ms. */
const REGION_MS = 2000;

const fig = (onsetMs: number, endMs: number, pitch: number | null, velocity: number, cents: number | null = pitch === null ? null : 0): NoteFigure =>
  ({ onsetMs, endMs, pitch, cents, velocity, jitterCents: pitch === null ? null : 0.1 });
const note = (position: number, duration: number, pitch: number, velocity = 0.8): RuleNote =>
  ({ position: REGION_START_PPQN + position, duration, pitch, cent: 0, velocity });
const predict = (notes: RuleNote[], silenced: RuleNote[] = []): Prediction => ({ predicted: markReadability(notes, bpm, mark), silenced });
const noRead = (): NoteFigure => { throw new Error("readAt must not be called"); };

describe("time conversions", () => {
  it("msToRegionPpqn nets the region start; predictedMs gives absolute ms", () => {
    expect(msToRegionPpqn(REGION_MS, bpm)).toBeCloseTo(0, 9);
    expect(msToRegionPpqn(REGION_MS + 500, bpm)).toBeCloseTo(960, 9);
    expect(predictedMs(note(0, 960, 60), bpm)).toEqual({ onsetMs: 2000, endMs: 2500 });
  });
});

describe("predictChain", () => {
  it("the rule silences an Arpeggio at −100 %: nothing predicted, every silenced note at velocity 0", () => {
    const chain: ChainSetting[] = [{ setting: { device: "arpeggio", settings: { ...ARPEGGIO_BASE, velocity: -1 } }, enabled: true }];
    const { silenced, predicted } = predictChain(chain, context, patternById("melody"), PATTERN_BPM, mark);
    expect(predicted).toEqual([]); // silent at −100 % (the manual since openDAW#524)
    expect(silenced.length).toBeGreaterThan(0);
    expect(silenced.every((n) => n.velocity === 0)).toBe(true);
  });

  it("applies the known deviation of an enabled device: a Pitch's cents before an Arpeggio read 0 on every step", () => {
    const chain: ChainSetting[] = [
      { setting: { device: "pitch", settings: { semiTones: 0, cents: 12.5, octaves: 0 } }, enabled: true },
      { setting: { device: "arpeggio", settings: { ...ARPEGGIO_BASE } }, enabled: true },
    ];
    const { predicted } = predictChain(chain, context, patternById("chords"), PATTERN_BPM, mark);
    expect(predicted.length).toBeGreaterThan(0);
    expect(predicted.every((n) => n.cent === 0)).toBe(true);
    // the same Pitch after the Arpeggio keeps its cents
    const swapped = predictChain([chain[1], chain[0]], context, patternById("chords"), PATTERN_BPM, mark);
    expect(swapped.predicted.every((n) => n.cent === 12.5)).toBe(true);
  });

  it("a step outlasts its held note by the rule: the gate sets the length, not the held note's end", () => {
    // a 100-pulse note under a 1/16 grid at gate 0.5: the step plays the gate's 120
    const pattern = { ...melody, notes: [{ position: 0, duration: 100, pitch: 60, velocity: 1 }] };
    const chain: ChainSetting[] = [{ setting: { device: "arpeggio", settings: { ...ARPEGGIO_BASE } }, enabled: true }];
    const { predicted } = predictChain(chain, context, pattern, bpm, mark);
    expect(predicted.map((n) => [n.position, n.duration])).toEqual([[REGION_START_PPQN, 120]]);
  });

  it("skips a disabled device", () => {
    const chain: ChainSetting[] = [{ setting: { device: "pitch", settings: { semiTones: 12, cents: 0, octaves: 0 } }, enabled: false }];
    const { predicted } = predictChain(chain, context, withGaps(patternById("melody"), 0.9), PATTERN_BPM, mark);
    expect(predicted.map((n) => n.pitch)).toEqual(patternById("melody").notes.map((n) => n.pitch));
    expect(predicted.map((n) => n.position)).toEqual(melody.notes.map((n) => n.position + REGION_START_PPQN));
  });

  it("an enabled device does apply", () => {
    const chain: ChainSetting[] = [{ setting: { device: "pitch", settings: { semiTones: 12, cents: 0, octaves: 0 } }, enabled: true }];
    const { predicted } = predictChain(chain, context, withGaps(melody, 0.9), bpm, mark);
    expect(predicted.map((n) => n.pitch)).toEqual(melody.notes.map((n) => n.pitch + 12));
    expect(predicted.every((n) => n.readability === "readable")).toBe(true);
  });

  it("marks the Chords pattern polyphonic without an Arpeggio", () => {
    const { predicted, silenced } = predictChain([], context, patternById("chords"), bpm, mark);
    expect(predicted).toHaveLength(12);
    expect(predicted.every((n) => n.readability === "polyphonic")).toBe(true);
    expect(silenced).toEqual([]);
  });
});

describe("renderedRows", () => {
  it("a matched readable note takes the read onset, end, pitch and velocity and gets a stem", () => {
    const prediction = predict([note(0, 480, 60, 0.8)]);
    expect(prediction.predicted[0].readability).toBe("readable");
    const rows = renderedRows([fig(REGION_MS + 1, REGION_MS + 240, 61, 0.7, 0.4)], prediction, melody, bpm, noRead);
    expect(rows.notes).toEqual([{ pitch: 61, from: msToRegionPpqn(2001, bpm), to: msToRegionPpqn(2240, bpm), velocity: 0.7 }]);
    expect(rows.notes[0].from).toBeCloseTo(1.92, 2); // the read onset, not the predicted 0
    expect(rows.stems).toEqual([{ at: msToRegionPpqn(2001, bpm), velocity: 0.7 }]);
    expect(rows.unreadable).toEqual([]);
    expect(rows.sentence).toBeNull();
  });

  it("takes the nearest read figure within MATCH_MS, the other one stays an extra", () => {
    // pitchless figures: a matched one sits on the predicted note's row, an extra one on row 0
    const prediction = predict([note(0, 480, 60)]);
    const rows = renderedRows([fig(REGION_MS + 8, 2240, null, 0.3), fig(REGION_MS - 2, 2230, null, 0.6)], prediction, melody, bpm, noRead);
    expect(rows.notes).toEqual([
      { pitch: 60, from: msToRegionPpqn(1998, bpm), to: msToRegionPpqn(2230, bpm), velocity: 0.6, hollow: true, label: "no pitch" },
      { pitch: 0, from: msToRegionPpqn(2008, bpm), to: msToRegionPpqn(2240, bpm), velocity: 0.3, hollow: true, label: "no pitch" },
    ]);
    expect(rows.stems.map((s) => s.velocity)).toEqual([0.6, 0.3]);
    expect(MATCH_MS).toBe(10);
  });

  it("labels cents of 2 or more and not below", () => {
    const prediction = predict([note(0, 400, 60), note(960, 400, 62), note(1920, 400, 64), note(2880, 400, 65)]);
    const at = (pulses: number): number => REGION_MS + pulses * 500 / 960;
    const rows = renderedRows([
      fig(at(0), at(400), 60, 1, 25),
      fig(at(960), at(1360), 62, 1, 1.5),
      fig(at(1920), at(2320), 64, 1, -3.4),
      fig(at(2880), at(3280), 65, 1, 2),
    ], prediction, melody, bpm, noRead);
    expect(rows.notes.map((n) => n.label)).toEqual(["+25¢", undefined, "−3¢", "+2¢"]);
  });

  it("a matched figure with no pitch is hollow, labelled no pitch, on the predicted row", () => {
    const rows = renderedRows([fig(REGION_MS, 2200, null, 0.5)], predict([note(0, 480, 67)]), melody, bpm, noRead);
    expect(rows.notes).toEqual([{ pitch: 67, from: 0, to: msToRegionPpqn(2200, bpm), velocity: 0.5, hollow: true, label: "no pitch" }]);
    expect(rows.stems).toEqual([{ at: 0, velocity: 0.5 }]);
  });

  it("drops a read blob inside a polyphonic span and writes the sentence", () => {
    const prediction = predictChain([], context, patternById("chords"), bpm, mark);
    // one blob for the first chord (null pitch), and a note after the region's end, outside every span
    const read = [fig(REGION_MS + 0.5, 2990, null, 0.9), fig(6100, 6200, 69, 0.4)];
    const rows = renderedRows(read, prediction, patternById("chords"), bpm, noRead);
    expect(rows.unreadable).toEqual([{ from: 0, to: 7680, reason: "polyphonic" }]); // four half-bar triads, touching, one span
    expect(rows.sentence).toBe("The reader reads one voice at a time: the notes in the shaded spans overlap. Use a one-voice pattern, or an Arpeggio with a gate under 100 %.");
    expect(rows.notes).toEqual([{ pitch: 69, from: msToRegionPpqn(6100, bpm), to: msToRegionPpqn(6200, bpm), velocity: 0.4 }]);
    expect(rows.stems).toEqual([{ at: msToRegionPpqn(6100, bpm), velocity: 0.4 }]);
  });

  it("a blob inside a polyphonic span is dropped before a neighbouring readable note can take it", () => {
    // a triad ending at 250 ms, a readable note at 260.4 ms; the blob's onset (251 ms) is inside the span's tolerance and 9.4 ms from the note
    const prediction = predict([note(0, 480, 60), note(0, 480, 64), note(0, 480, 67), note(500, 400, 72)]);
    expect(prediction.predicted.map((n) => n.readability)).toEqual(["polyphonic", "polyphonic", "polyphonic", "readable"]);
    const rows = renderedRows([fig(REGION_MS + 251, 2400, 72, 0.9)], prediction, melody, bpm, noRead);
    expect(rows.notes).toEqual([{ pitch: 72, from: 500, to: 900, hollow: true, label: "silent" }]);
    expect(rows.stems).toEqual([]);
  });

  it("merges unreadable spans only when they touch, and names an overlap", () => {
    // two same-pitch notes overlapping, then a gap, then two different pitches stacked
    const prediction = predict([note(0, 480, 60), note(240, 480, 60), note(1920, 480, 60), note(1920, 480, 64)]);
    const rows = renderedRows([], prediction, melody, bpm, noRead);
    expect(rows.unreadable).toEqual([{ from: 0, to: 720, reason: "overlap" }, { from: 1920, to: 2400, reason: "polyphonic" }]);
  });

  it("draws an abutting note dashed at the predicted span with the readAt figure's pitch and velocity, hollow when it has no pitch", () => {
    const prediction = predict([note(0, 480, 60), note(480, 480, 62)]);
    expect(prediction.predicted.map((n) => n.readability)).toEqual(["abutting", "abutting"]);
    const calls: Array<[number, number]> = [];
    const readAt = (onsetMs: number, endMs: number): NoteFigure => {
      calls.push([onsetMs, endMs]);
      return onsetMs === 2000 ? fig(onsetMs + 3, endMs - 3, 61, 0.55, 30) : fig(onsetMs, endMs, null, 0.45);
    };
    // the reader's merged blob for the legato pair is the abutting notes' own, not an extra
    const rows = renderedRows([fig(REGION_MS, 2500, 61, 0.5)], prediction, melody, bpm, readAt);
    expect(calls).toEqual([[2000, 2250], [2250, 2500]]);
    expect(rows.notes).toEqual([
      { pitch: 61, from: 0, to: 480, velocity: 0.55, dashedEdges: true, label: "+30¢" },
      // a figure without a pitch measures nothing to draw: hollow, the predicted pitch only places the row, no velocity, no stem
      { pitch: 62, from: 480, to: 960, hollow: true, dashedEdges: true, label: "no pitch" },
    ]);
    expect(rows.stems).toEqual([{ at: 0, velocity: 0.55 }]);
    expect(rows.unreadable).toEqual([]);
    expect(rows.sentence).toBeNull();
  });

  it("draws too-short and too-quiet notes hollow with their reason and no stem", () => {
    const prediction = predict([note(0, 20, 60), note(960, 480, 64, 0.005)]);
    expect(prediction.predicted.map((n) => n.readability)).toEqual(["too-short", "too-quiet"]);
    // the figure the reader made of the short note is that note's, not an extra
    const rows = renderedRows([fig(REGION_MS, 2010, null, 0.8)], prediction, melody, bpm, noRead);
    expect(rows.notes).toEqual([
      { pitch: 60, from: 0, to: 20, hollow: true, label: "too short" },
      { pitch: 64, from: 960, to: 1440, hollow: true, label: "too quiet" },
    ]);
    expect(rows.stems).toEqual([]);
  });

  it("a figure inside a too-short note's span is absorbed before a readable neighbour 3.1 ms away can match it", () => {
    // too short: 0..20 pulses (2000..2010.4 ms); readable from 26 pulses (2013.5 ms), 3.1 ms after, past the reader's gap
    const prediction = predict([note(0, 20, 60), note(26, 480, 64)]);
    expect(prediction.predicted.map((n) => n.readability)).toEqual(["too-short", "readable"]);
    const rows = renderedRows([fig(REGION_MS + 10, 2012, 60, 0.8)], prediction, melody, bpm, noRead);
    expect(rows.notes).toEqual([
      { pitch: 60, from: 0, to: 20, hollow: true, label: "too short" },
      { pitch: 64, from: 26, to: 506, hollow: true, label: "silent" },
    ]);
    expect(rows.stems).toEqual([]);
  });

  it("draws a silenced note hollow with the label silent and no stem", () => {
    const chain: ChainSetting[] = [{ setting: { device: "arpeggio", settings: { ...ARPEGGIO_BASE, velocity: -1 } }, enabled: true }];
    const prediction = predictChain(chain, context, melody, bpm, mark);
    const rows = renderedRows([], prediction, melody, bpm, noRead);
    expect(rows.notes).toHaveLength(prediction.silenced.length);
    expect(rows.notes.every((n) => n.hollow === true && n.label === "silent" && n.dashedEdges !== true)).toBe(true);
    expect(rows.notes[0]).toEqual({ pitch: 60, from: 0, to: 120, hollow: true, label: "silent" });
    expect(rows.stems).toEqual([]);
  });

  it("keeps an unmatched read note outside every span, hollow with no pitch when the pitch is null", () => {
    const rows = renderedRows([fig(3000, 3200, 64, 0.6), fig(2100, 2300, null, 0.5)], { predicted: [], silenced: [] }, melody, bpm, noRead);
    expect(rows.notes).toEqual([
      { pitch: 0, from: msToRegionPpqn(2100, bpm), to: msToRegionPpqn(2300, bpm), velocity: 0.5, hollow: true, label: "no pitch" },
      { pitch: 64, from: msToRegionPpqn(3000, bpm), to: msToRegionPpqn(3200, bpm), velocity: 0.6 },
    ]);
    expect(rows.stems).toEqual([{ at: msToRegionPpqn(2100, bpm), velocity: 0.5 }, { at: msToRegionPpqn(3000, bpm), velocity: 0.6 }]);
    expect(rows.sentence).toBeNull();
  });

  it("a readable predicted note with no read counterpart is hollow and labelled silent", () => {
    const rows = renderedRows([fig(REGION_MS + MATCH_MS + 1, 2200, 60, 0.7)], predict([note(0, 480, 60)]), melody, bpm, noRead);
    expect(rows.notes).toEqual([
      { pitch: 60, from: 0, to: 480, hollow: true, label: "silent" },
      { pitch: 60, from: msToRegionPpqn(2011, bpm), to: msToRegionPpqn(2200, bpm), velocity: 0.7 },
    ]);
    expect(rows.stems).toEqual([{ at: msToRegionPpqn(2011, bpm), velocity: 0.7 }]);
  });

  it("empty prediction and empty read give no notes, no stems and no sentence", () => {
    const rows = renderedRows([], { predicted: [], silenced: [] }, melody, bpm, noRead);
    expect(rows.notes).toEqual([]);
    expect(rows.stems).toEqual([]);
    expect(rows.unreadable).toEqual([]);
    expect(rows.sentence).toBeNull();
  });

  it("one ghost per written note at the written velocity", () => {
    const rows = renderedRows([], { predicted: [], silenced: [] }, melody, bpm, noRead);
    expect(rows.ghosts).toEqual(melody.notes.map((n) => ({ at: n.position, velocity: n.velocity })));
    expect(rows.ghosts).toHaveLength(16);
  });
});

describe("renderedRows with figures that are not numbers", () => {
  it("a NaN velocity draws hollow, labelled unreadable, with no stem; a NaN cents gets no label", () => {
    const prediction = predict([note(0, 480, 61), note(960, 480, 64)]);
    const read = [fig(REGION_MS + 1, REGION_MS + 240, 61, Number.NaN), fig(REGION_MS + 501, REGION_MS + 740, 64, 0.6, Number.NaN)];
    const rows = renderedRows(read, prediction, melody, bpm, noRead);
    expect(rows.notes).toEqual([
      { pitch: 61, from: msToRegionPpqn(REGION_MS + 1, bpm), to: msToRegionPpqn(REGION_MS + 240, bpm), hollow: true, label: "unreadable" },
      { pitch: 64, from: msToRegionPpqn(REGION_MS + 501, bpm), to: msToRegionPpqn(REGION_MS + 740, bpm), velocity: 0.6 },
    ]);
    expect(rows.stems).toEqual([{ at: msToRegionPpqn(REGION_MS + 501, bpm), velocity: 0.6 }]);
  });

  it("an abutting note whose velocity reads NaN is hollow and dashed, unreadable, with no stem", () => {
    // two touching quarters: abutting, read at the predicted span
    const prediction = predict([note(0, 480, 61), note(480, 480, 62)]);
    expect(prediction.predicted.every((n) => n.readability === "abutting")).toBe(true);
    const readAt = (onsetMs: number, endMs: number): NoteFigure => fig(onsetMs, endMs, 61, Number.NaN, Number.POSITIVE_INFINITY);
    const rows = renderedRows([], prediction, melody, bpm, readAt);
    expect(rows.notes).toEqual([
      { pitch: 61, from: 0, to: 480, hollow: true, label: "unreadable", dashedEdges: true },
      { pitch: 62, from: 480, to: 960, hollow: true, label: "unreadable", dashedEdges: true },
    ]);
    expect(rows.stems).toEqual([]);
  });
});

