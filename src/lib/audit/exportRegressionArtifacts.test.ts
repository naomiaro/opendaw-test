import { describe, expect, it } from "vitest";
import {
  EXPORT_REGRESSION_SCHEMA_VERSION, parseExportRegister, parseExportSummary, planAccept, staleFindings,
  summaryFileName, SUMMARY_NAME, wavFileName,
  type ExportRegister, type ExportSummary, type RowRecord
} from "./exportRegressionArtifacts.ts";
import { buildRows } from "./exportRegressionRows.ts";
import type { RenderRead } from "./exportRegressionReader";

const acceptedAt = "2026-11-06T00:00:00.000Z";
const read = (over: Partial<RenderRead> = {}): RenderRead => ({
  hash: "h", frames: 10, channels: 2, peak: 1, nonFinite: 0, impulseHits: [3], largestStep: { step: 0.1, frame: 2 },
  energyPastRange: null, ...over
});
const record = (over: Partial<RowRecord> = {}): RowRecord => ({
  id: "a", label: "A", group: "core", read: read(), reportedLatencyFrames: 0, invariants: [], register: "unregistered",
  shiftFrames: null, standing: "clean", wavUploaded: true, error: null, renderMs: 5, ...over
});
const summary = (rows: RowRecord[], over: Partial<ExportSummary> = {}): ExportSummary => ({
  schemaVersion: 1, runToken: 7, userAgent: "ua", sdkVersion: "0.0.182", engineWasmSha256: "e".repeat(64), sampleRate: 48000,
  uuidOrder: "ascending", rowsParam: "all", fill: false, registerSdkVersion: null, rows, ...over
});
const registerAt = (rate: number, rows: ExportRegister["rows"] = {}): ExportRegister => ({
  schemaVersion: 1, sdkVersion: "0.0.182", engineWasmSha256: "e".repeat(64), acceptedRunToken: 1, acceptedAt, sampleRate: rate, rows
});
const entry = (hash: string) => ({ hash, frames: 10, channels: 2, peak: 1, impulseHits: [3], wav: `wav/${hash}.wav` });
const opts = (force = false) => ({ force, acceptedAt });

describe("names", () => {
  it("names the summary and the WAV by token", () => {
    expect(summaryFileName(17)).toBe("exportreg-summary-17.json");
    expect(wavFileName(17, "core-x")).toBe("exportreg-17-core-x.wav");
    expect(SUMMARY_NAME.exec("exportreg-summary-17.json")?.[1]).toBe("17");
  });
});

describe("parse", () => {
  it("names a schema it cannot read", () => {
    expect(() => parseExportSummary({ schemaVersion: 99 }, 1)).toThrow(/99/);
    expect(() => parseExportRegister({ schemaVersion: 99 })).toThrow(/99/);
  });
  it("round-trips a summary and a register", () => {
    const s = summary([record()]);
    expect(parseExportSummary(JSON.parse(JSON.stringify(s)), 7).rows[0].id).toBe("a");
    const r = registerAt(48000, { a: entry("h") });
    expect(parseExportRegister(JSON.parse(JSON.stringify(r))).rows.a.hash).toBe("h");
  });
  it("refuses a row with neither error nor read", () => {
    expect(() => parseExportSummary({ ...summary([]), rows: [{ id: "a", invariants: [], standing: "clean", error: null, read: null }] }, 7)).toThrow(/no error and no read/);
  });
});

describe("planAccept", () => {
  it("refuses an errored row even when forced", () => {
    expect(() => planAccept(summary([record({ error: "worker hung", standing: "errored", read: null })]), null, new Set(), opts(true)))
      .toThrow(/errored.*a/);
  });
  it("refuses a failing invariant with no finding, and takes one with a finding", () => {
    const failing = record({ id: "a", standing: "failing" });
    expect(() => planAccept(summary([failing]), null, new Set(["a"]), opts())).toThrow(/a.*no known finding/);
    expect(() => planAccept(summary([failing]), null, new Set(["a"]), opts(true))).toThrow(/a.*no known finding/);
    const labelled = record({ id: "a", standing: "known-finding", read: read({ hash: "h" }), register: "unregistered" });
    expect(planAccept(summary([labelled]), null, new Set(["a"]), opts()).register.rows.a.hash).toBe("h");
  });
  it("refuses a changed row with no uploaded WAV, naming the rows, and plans nothing", () => {
    const rows = [record({ id: "a", register: "changed" }), record({ id: "b", register: "changed" })];
    expect(() => planAccept(summary(rows), null, new Set(["b"]), opts())).toThrow(/a/);
    try {
      planAccept(summary(rows), null, new Set(["b"]), opts());
    } catch (error) {
      expect((error as Error).message).not.toMatch(/: b$/);
    }
  });
  it("plans a copy only for hashes new to the library", () => {
    const onDisk = registerAt(48000, { a: entry("h1") });
    const rows = [record({ id: "a", read: read({ hash: "h1" }), register: "identical" }), record({ id: "b", read: read({ hash: "h2" }) })];
    const plan = planAccept(summary(rows), onDisk, new Set(["a", "b"]), opts());
    expect(plan.wavsToCopy).toEqual([{ rowId: "b", hash: "h2" }]);
    expect(plan.register.rows.a).toEqual(onDisk.rows.a);
    expect(plan.register.rows.b.wav).toBe("wav/h2.wav");
  });
  it("copies a hash two rows share once, and needs no upload for a hash the register holds", () => {
    const onDisk = registerAt(48000, { a: entry("h1") });
    const rows = [record({ id: "a", read: read({ hash: "h1" }) }), record({ id: "b", read: read({ hash: "h1" }) }),
      record({ id: "c", read: read({ hash: "h2" }) }), record({ id: "d", read: read({ hash: "h2" }) })];
    const plan = planAccept(summary(rows), onDisk, new Set(["c"]), opts());
    expect(plan.wavsToCopy).toEqual([{ rowId: "c", hash: "h2" }]);
    expect(Object.keys(plan.register.rows).sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("refuses a summary whose rate differs from the register's", () => {
    expect(() => planAccept(summary([], { sampleRate: 44100 }), registerAt(48000), new Set(), opts())).toThrow(/44100.*48000/);
  });
  it("refuses a descending-UUID run outright", () => {
    expect(() => planAccept(summary([record()], { uuidOrder: "descending" }), null, new Set(["a"]), opts(true))).toThrow(/control run/);
  });
  it("merges a partial run only when forced", () => {
    const onDisk = registerAt(48000, { a: entry("h1"), z: entry("hz") });
    const partial = summary([record({ id: "a", read: read({ hash: "h9" }) })], { rowsParam: "core" });
    expect(() => planAccept(partial, onDisk, new Set(["a"]), opts())).toThrow(/partial/);
    const plan = planAccept(partial, onDisk, new Set(["a"]), opts(true));
    expect(Object.keys(plan.register.rows).sort()).toEqual(["a", "z"]);
    expect(plan.register.rows.a.hash).toBe("h9");
  });
  it("refuses a partial merge into a register of another engine", () => {
    const onDisk = { ...registerAt(48000, { z: entry("hz") }), engineWasmSha256: "f".repeat(64) };
    expect(() => planAccept(summary([record()], { rowsParam: "core" }), onDisk, new Set(["a"]), opts(true))).toThrow(/another build/);
  });
  it("a full run replaces the register", () => {
    const onDisk = registerAt(48000, { z: entry("hz") });
    const plan = planAccept(summary([record()]), onDisk, new Set(["a"]), opts());
    expect(Object.keys(plan.register.rows)).toEqual(["a"]);
    expect(plan.register.acceptedRunToken).toBe(7);
  });
});

describe("staleFindings", () => {
  const rows = buildRows(44100).filter((r) => r.path === "section-loop-twice" && r.seconds === 4);
  const held = (id: string): RowRecord => {
    const row = rows.find((r) => r.id === id)!;
    return record({
      id, invariants: row.invariants.map((invariant) => ({ invariant, holds: true, detail: "", finding: null }))
    });
  };
  it("reports a finding whose rows now hold as no longer reproducing", () => {
    const stale = staleFindings(summary(rows.map((r) => held(r.id)), { sampleRate: 44100 }));
    expect(stale.map((s) => s.name)).toContain("one-frame-early-44100");
    expect(stale.find((s) => s.name === "one-frame-early-44100")!.rows.length).toBeGreaterThan(0);
  });
  it("does not report one whose invariant still fails, or a row that errored", () => {
    const failing = rows.map((r) => {
      const h = held(r.id);
      return { ...h, invariants: h.invariants.map((i) => i.invariant === "section-is-slice" ? { ...i, holds: false } : i) };
    });
    expect(staleFindings(summary(failing, { sampleRate: 44100 })).map((s) => s.name)).not.toContain("one-frame-early-44100");
    const errored = rows.map((r) => record({ id: r.id, error: "x", read: null, standing: "errored" }));
    expect(staleFindings(summary(errored, { sampleRate: 44100 }))).toEqual([]);
  });
  it("does not report a finding at a rate where no row applies", () => {
    expect(staleFindings(summary([], { sampleRate: 48000 }))).toEqual([]);
  });
  it("is the schema constant", () => expect(EXPORT_REGRESSION_SCHEMA_VERSION).toBe(1));
});
