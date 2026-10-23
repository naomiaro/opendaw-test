import { describe, expect, it } from "vitest";
import { parseMidiOutputParams } from "./midiOutputParams";
import {
  cellTableLines, MIDI_OUTPUT_SCHEMA_VERSION, parseMidiOutputSummary, summaryFileName,
  type MidiOutputSummary, type OutputCellRecord, type OutputRepeatRow,
} from "./midiOutputArtifacts";

const row = (repeat: number, median: number | null, error: string | null = null): OutputRepeatRow => ({
  repeat, error, notes: [], anchor: { contextTime: 10, position: 0 }, originPpqn: 3840,
  medianErrorMs: median, maxAbsDevMs: median === null ? null : 1.2, p5p95WidthMs: median === null ? null : 2.1, lateTailMs: median === null ? null : 1.1,
  missing: 0, extra: 0, stuck: 0, velocityMismatches: 0, transportMessages: 56, notesInsideBlocks: 0, medianErrorInsideBlocksMs: null,
  heardLagMs: 0.4, outputLatencyMs: 20, compensationLatencyMs: 0, delayInMs: 10, quantumMs: 2.6667,
  frameIntervalMs: 16.67, frameGapMaxMs: 17.2, jankBlocks: [], jankMs: null,
});
const key = { bpm: 140, density: "32nd" as const, jank: "none" as const, transport: true };
const engine: OutputCellRecord = { ...key, arm: "engine", status: "on-time", detail: "every repeat clean", repeats: [row(1, 10.8), row(2, 11.1)] };
const page: OutputCellRecord = { ...key, arm: "page", status: "bus-true", detail: "every repeat clean", repeats: [row(1, 0.02), row(2, -0.01)] };
const summary: MidiOutputSummary = {
  schemaVersion: MIDI_OUTPUT_SCHEMA_VERSION, runToken: 42, sdkVersion: "0.0.177", chrome: "Google Chrome 155", date: "2026-10-23",
  sampleRate: 48000, params: parseMidiOutputParams(new URLSearchParams("")), cells: [engine, page],
};

describe("midiOutputArtifacts", () => {
  it("names the file and parses its own schema, refusing another version or token", () => {
    expect(summaryFileName(42)).toBe("midiout-summary-42.json");
    expect(parseMidiOutputSummary(JSON.parse(JSON.stringify(summary)), 42)).toEqual(summary);
    expect(() => parseMidiOutputSummary({ ...summary, schemaVersion: 2 }, 42)).toThrow(/schemaVersion/);
    expect(() => parseMidiOutputSummary(summary, 43)).toThrow(/runToken/);
    expect(() => parseMidiOutputSummary({ ...summary, cells: "none" }, 42)).toThrow(/cells/);
  });

  it("prints one line per cell with the status, the medians per repeat and the counts", () => {
    const lines = cellTableLines(summary);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/engine \| 140 \| 32nd \| none \| on \| on-time \| 10\.80 \/ 11\.10 \| 1\.20 \| 1\.10 \| — \| 0\/0\/0\/0 \| 56 \| 10 \| 16\.67/);
    expect(lines[1]).toMatch(/^page \| 140 .* bus-true \| 0\.02 \/ -0\.01/);
  });

  it("prints an error row's stage instead of figures", () => {
    const errored: OutputCellRecord = { ...engine, repeats: [row(1, null, "anchor: no fresh recordingStart within 30s")] };
    expect(cellTableLines({ ...summary, cells: [errored] })[0]).toMatch(/— \| .*r1 error: anchor: no fresh/);
  });
});
