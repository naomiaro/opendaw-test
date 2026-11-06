import { describe, expect, it } from "vitest";
import { buildRows } from "./exportRegressionRows.ts";
import { KNOWN_FINDINGS, findingFor } from "./exportRegressionFindings.ts";

const rowOf = (pageRate: number, id: string) => buildRows(pageRate).find((r) => r.id === id)!;

const none = { earlyFrames: null, firstDifferingFrame: null, lastDifferingFrame: null, largestDifference: null };
const early = (frames: number) => ({ ...none, earlyFrames: frames });
const named = (name: string) => KNOWN_FINDINGS.find((f) => f.name === name)!;

describe("exportRegressionFindings", () => {
  it("matches the one early frame on impulse-on-reference too, on the 44.1 kHz page only", () => {
    const row = rowOf(44100, "core-none-section-loop-twice");
    expect(findingFor(row, "impulse-on-reference", 44100, early(1))?.name).toBe("one-frame-early-44100");
    expect(findingFor(row, "samples-equal-warm-pass", 44100, early(1))?.name).toBe("one-frame-early-44100");
    expect(findingFor(row, "samples-equal-warm-pass", 48000, early(1))).toBeNull();
    expect(findingFor(row, "section-is-slice", 44100, early(1))).toBeNull();
    expect(findingFor(row, "impulse-on-reference", 48000, early(1))).toBeNull();
    expect(findingFor(rowOf(44100, "core-none-section-loop-once"), "section-is-slice", 44100, early(1))).toBeNull();
  });
  it("needs the measured shift to be exactly one frame", () => {
    const row = rowOf(44100, "core-none-section-loop-twice");
    for (const evidence of [early(37), early(0), early(-1), none]) {
      expect(findingFor(row, "impulse-on-reference", 44100, evidence)).toBeNull();
    }
  });
  it("applies the cold start to setposition rows with a Compressor only, and matches no measurement yet", () => {
    const cold = named("setposition-cold-start");
    expect(cold.applies(rowOf(48000, "position-compressor-track-setposition-on-quantum"), 48000)).toBe(true);
    expect(cold.applies(rowOf(48000, "position-none-setposition-on-quantum"), 48000)).toBe(false);
    expect(cold.applies(rowOf(48000, "position-compressor-track-loop-on-copy"), 48000)).toBe(false);
    expect(findingFor(rowOf(48000, "position-compressor-track-setposition-on-quantum"), "samples-equal-reference", 48000, early(1))).toBeNull();
  });
  it("applies the missing tail to the tail group's marker row only, and matches no measurement yet", () => {
    const tail = named("range-missing-tail");
    expect(tail.applies(rowOf(48000, "tail-none-section-marker"), 48000)).toBe(true);
    expect(tail.applies(rowOf(48000, "tail-none-section-entire"), 48000)).toBe(false);
    expect(findingFor(rowOf(48000, "tail-none-section-marker"), "section-is-slice", 48000, early(1))).toBeNull();
  });
  it("lists each finding with a note", () => {
    KNOWN_FINDINGS.forEach((f) => expect(f.note.length).toBeGreaterThan(0));
  });
});
