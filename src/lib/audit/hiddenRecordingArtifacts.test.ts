import { describe, expect, it } from "vitest";
import { HIDDEN_RECORDING_SCHEMA_VERSION, parseHiddenRecordingSummary, summaryFileName } from "./hiddenRecordingArtifacts";

describe("hiddenRecordingArtifacts", () => {
  const take = { appeared: true, finalized: true, finalizeMs: 100, regionDurationSec: 15.75, expectedDurationSec: 15.75, beatsMatched: 31, beatsMissing: 0, medianBeatErrorMs: 1, alignedToleranceMs: 3, verdict: "intact", detail: "" };
  const row = { driver: "hidden-safe", interrupt: "cover", hideAt: "mid", hiddenSeconds: 5, hiddenAtMs: 1, visibleAtMs: 5001, hiddenSpanMs: 5000, frameGapMaxMs: 5002, positionFrozenMs: 0, syncResumeMs: 0, take1: take, take2: take, take2Started: true, samples: [], error: null };
  const ok = { schemaVersion: HIDDEN_RECORDING_SCHEMA_VERSION, runToken: 1, rows: [row] };
  it("names the summary by run token", () => {
    expect(summaryFileName(1700000000000)).toBe("hiddenrec-summary-1700000000000.json");
  });
  it("parses the current schema and rejects another, a missing rows array and a row without its take", () => {
    expect(parseHiddenRecordingSummary(ok, 1).rows.length).toBe(1);
    expect(() => parseHiddenRecordingSummary(null, 1)).toThrow(/not an object/);
    expect(() => parseHiddenRecordingSummary({ ...ok, schemaVersion: 2 }, 1)).toThrow(/schemaVersion/);
    expect(() => parseHiddenRecordingSummary({ ...ok, rows: null }, 1)).toThrow(/rows/);
    expect(() => parseHiddenRecordingSummary({ ...ok, rows: [{ ...row, take1: undefined }] }, 1)).toThrow(/take1/);
    expect(() => parseHiddenRecordingSummary({ ...ok, rows: [{ ...row, driver: undefined }] }, 1)).toThrow(/driver/);
  });
});
