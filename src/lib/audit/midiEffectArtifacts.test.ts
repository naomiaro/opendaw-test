import { describe, expect, it } from "vitest";
import { MIDI_EFFECT_SCHEMA_VERSION, parseMidiEffectSummary, summaryFileName } from "./midiEffectArtifacts";

describe("midiEffectArtifacts", () => {
  const row = { id: "dry", peak: 1, onsets: [1], expected: [1], deltas: [0] };
  const ok = { schemaVersion: MIDI_EFFECT_SCHEMA_VERSION, runToken: 1, rows: [row] };
  it("names the summary by run token", () => {
    expect(summaryFileName(1700000000000)).toBe("midifx-summary-1700000000000.json");
  });
  it("parses the current schema and rejects another, a missing rows array and a row without its figures", () => {
    expect(parseMidiEffectSummary(ok, 1).rows.length).toBe(1);
    expect(() => parseMidiEffectSummary({ ...ok, schemaVersion: 2 }, 1)).toThrow(/schemaVersion/);
    expect(() => parseMidiEffectSummary({ ...ok, rows: null }, 1)).toThrow(/rows/);
    expect(() => parseMidiEffectSummary({ ...ok, rows: [{ ...row, onsets: undefined }] }, 1)).toThrow(/onsets/);
  });
});
