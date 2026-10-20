import { describe, expect, it } from "vitest";
import { MIDI_AUDIT_SCHEMA_VERSION, parseMidiAuditSummary, summaryFileName } from "./midiInputArtifacts";

describe("midiInputArtifacts", () => {
  it("names the summary by run token", () => {
    expect(summaryFileName(1700000000000)).toBe("midiaudit-summary-1700000000000.json");
  });
  it("parses the readable schemas and rejects another", () => {
    const ok = { schemaVersion: MIDI_AUDIT_SCHEMA_VERSION, rows: [], cellVerdicts: [], runToken: 1 };
    expect(parseMidiAuditSummary(ok, 1).rows).toEqual([]);
    expect(parseMidiAuditSummary({ ...ok, schemaVersion: 1 }, 1).rows).toEqual([]);
    expect(() => parseMidiAuditSummary({ ...ok, schemaVersion: 99 }, 1)).toThrow(/schemaVersion/);
    expect(() => parseMidiAuditSummary({ ...ok, rows: null }, 1)).toThrow(/rows/);
  });
  it("refuses a current-schema row that lacks a count the table sums, and a count that is not a number", () => {
    const row = { missing: 0, receiptsMissing: 0, extra: 0, stuck: 0, collapsed: 0, countInNotes: 0, countInRecorded: 0 };
    const ok = { schemaVersion: MIDI_AUDIT_SCHEMA_VERSION, rows: [row], cellVerdicts: [], runToken: 1 };
    expect(parseMidiAuditSummary(ok, 1).rows.length).toBe(1);
    const { collapsed: _dropped, ...withoutCollapsed } = row;
    expect(() => parseMidiAuditSummary({ ...ok, rows: [withoutCollapsed] }, 1)).toThrow(/lacks collapsed/);
    expect(() => parseMidiAuditSummary({ ...ok, rows: [{ ...row, extra: "1" }] }, 1)).toThrow(/extra is string/);
    expect(parseMidiAuditSummary({ ...ok, schemaVersion: 1, rows: [withoutCollapsed] }, 1).rows.length).toBe(1);
  });
});
