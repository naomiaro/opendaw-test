import { describe, expect, it } from "vitest";
import { MIDI_AUDIT_SCHEMA_VERSION, parseMidiAuditSummary, summaryFileName } from "./midiInputArtifacts";

describe("midiInputArtifacts", () => {
  it("names the summary by run token", () => {
    expect(summaryFileName(1700000000000)).toBe("midiaudit-summary-1700000000000.json");
  });
  it("parses a summary of the current schema and rejects another", () => {
    const ok = { schemaVersion: MIDI_AUDIT_SCHEMA_VERSION, rows: [], cellVerdicts: [], runToken: 1 };
    expect(parseMidiAuditSummary(ok, 1).rows).toEqual([]);
    expect(() => parseMidiAuditSummary({ ...ok, schemaVersion: 99 }, 1)).toThrow(/schemaVersion/);
    expect(() => parseMidiAuditSummary({ ...ok, rows: null }, 1)).toThrow(/rows/);
  });
});
