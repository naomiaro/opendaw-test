import { describe, expect, it } from "vitest";
import { buildRows } from "./exportRegressionRows.ts";
import { KNOWN_FINDINGS, findingFor } from "./exportRegressionFindings.ts";

const rowOf = (pageRate: number, id: string) => buildRows(pageRate).find((r) => r.id === id)!;

describe("exportRegressionFindings", () => {
  it("matches the one early frame on impulse-on-reference too, on the 44.1 kHz page only", () => {
    const row = rowOf(44100, "core-none-section-loop-twice");
    expect(findingFor(row, "impulse-on-reference", 44100)?.name).toBe("one-frame-early-44100");
    expect(findingFor(row, "impulse-on-reference", 48000)).toBeNull();
    expect(findingFor(rowOf(44100, "core-none-section-loop-once"), "section-is-slice", 44100)).toBeNull();
  });
  it("matches the cold start on setposition rows with a Compressor only", () => {
    expect(findingFor(rowOf(48000, "position-compressor-track-setposition-on-quantum"), "samples-equal-reference", 48000)?.name)
      .toBe("setposition-cold-start");
    expect(findingFor(rowOf(48000, "position-none-setposition-on-quantum"), "samples-equal-reference", 48000)).toBeNull();
    expect(findingFor(rowOf(48000, "position-compressor-track-loop-on-copy"), "samples-equal-reference", 48000)).toBeNull();
  });
  it("matches the missing tail on the tail group's marker row only", () => {
    expect(findingFor(rowOf(48000, "tail-none-section-marker"), "section-is-slice", 48000)?.name).toBe("range-missing-tail");
    expect(findingFor(rowOf(48000, "tail-none-section-entire"), "section-is-slice", 48000)).toBeNull();
  });
  it("lists each finding with a note", () => {
    KNOWN_FINDINGS.forEach((f) => expect(f.note.length).toBeGreaterThan(0));
  });
});
