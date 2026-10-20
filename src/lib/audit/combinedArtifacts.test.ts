import { describe, expect, it } from "vitest";
import { COMBINED_SCHEMA_VERSION, combinedSummaryFileName, parseCombinedSummary } from "./combinedArtifacts";

describe("combinedArtifacts", () => {
  it("names the file and validates the counts", () => {
    expect(combinedSummaryFileName(5)).toBe("combined-summary-5.json");
    const row = { clicksFound: 48, clicksMissing: 0, clicksExtra: 0, pairs: 48, onsetsOutsideSpan: 0 };
    const ok = { schemaVersion: COMBINED_SCHEMA_VERSION, rows: [row], cellVerdicts: [], runToken: 5, micRoundTrip: { roundTripMs: 87.4, inputPartMs: 64.4 } };
    expect(parseCombinedSummary(ok, 5).rows.length).toBe(1);
    expect(() => parseCombinedSummary({ ...ok, schemaVersion: 9 }, 5)).toThrow(/schemaVersion/);
    expect(() => parseCombinedSummary({ ...ok, rows: [{ ...row, pairs: undefined }] }, 5)).toThrow(/lacks pairs/);
    expect(() => parseCombinedSummary({ ...ok, micRoundTrip: undefined }, 5)).toThrow(/micRoundTrip/);
  });
});
