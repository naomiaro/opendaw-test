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
  id: "a", label: "A", group: "core", read: read(), reportedLatencyFrames: 0, invariants: [{ invariant: "proves-something", holds: true, detail: "", finding: null }], register: "unregistered",
  shiftFrames: null, standing: "clean", wavUploaded: true, error: null, renderMs: 5, ...over
});
const summary = (rows: RowRecord[], over: Partial<ExportSummary> = {}): ExportSummary => ({
  schemaVersion: 1, runToken: 7, userAgent: "ua", sdkVersion: "0.0.182", engineWasmSha256: "e".repeat(64), sampleRate: 48000,
  uuidOrder: "ascending", rowsParam: "all", fill: false, registerSdkVersion: null, latencyReads: [], deviceRateHz: null, rows, ...over
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
  it("reads the device rate, and null for a summary written before the field", () => {
    const s = summary([record()], { deviceRateHz: 44100 });
    expect(parseExportSummary(JSON.parse(JSON.stringify(s)), 7).deviceRateHz).toBe(44100);
    const { deviceRateHz: _dropped, ...old } = summary([record()]);
    expect(parseExportSummary(JSON.parse(JSON.stringify(old)), 7).deviceRateHz).toBeNull();
    expect(parseExportSummary({ ...old, deviceRateHz: null }, 7).deviceRateHz).toBeNull();
  });
  it("refuses a device rate that is neither a finite number nor null", () => {
    expect(() => parseExportSummary({ ...summary([]), deviceRateHz: "44100" }, 7)).toThrow(/deviceRateHz/);
    expect(() => parseExportSummary({ ...summary([]), deviceRateHz: Infinity }, 7)).toThrow(/deviceRateHz/);
  });
  it("refuses a row with neither error nor read", () => {
    expect(() => parseExportSummary({ ...summary([]), rows: [{ id: "a", invariants: [], standing: "clean", error: null, read: null }] }, 7)).toThrow(/no error and no read/);
  });
});

const holding = (id: string, over: Partial<RowRecord> = {}): RowRecord => {
  const row = buildRows(48000).find((r) => r.id === id)!;
  return record({
    id, standing: "clean", read: read({ hash: `hash-${id}` }),
    invariants: row.invariants.map((invariant) => ({ invariant, holds: true, detail: "", finding: null })), ...over
  });
};
// ids outside the catalogue only pass as a forced full run; these tests are about the row gate
const force = opts(true);

describe("planAccept", () => {
  it("refuses an errored row even when forced, naming it last", () => {
    expect(() => planAccept(summary([record({ error: "worker hung", standing: "errored", read: null })]), null, new Set(), force))
      .toThrow(/errored.*: a$/);
  });
  it("refuses a failing invariant with no finding, forced or not, naming the row last", () => {
    const failing = record({ id: "a", standing: "failing", invariants: [{ invariant: "no-jump", holds: false, detail: "", finding: null }] });
    expect(() => planAccept(summary([failing]), null, new Set(["a"]), opts())).toThrow(/no known finding.*: a$/);
    expect(() => planAccept(summary([failing]), null, new Set(["a"]), force)).toThrow(/no known finding.*: a$/);
  });
  it("takes a known-finding row whose failed invariant names a finding of that invariant", () => {
    const labelled = record({
      id: "a", standing: "known-finding", read: read({ hash: "h" }),
      invariants: [{ invariant: "impulse-on-reference", holds: false, detail: "", finding: "loop-pass-one-frame-short" }]
    });
    expect(planAccept(summary([labelled]), null, new Set(["a"]), force).register.rows.a.hash).toBe("h");
  });
  it("reads the invariants, not the stored label", () => {
    const bad = { invariant: "no-jump" as const, holds: false, detail: "", finding: null };
    const probes: [string, RowRecord][] = [
      ["clean over a failed invariant", record({ standing: "clean", invariants: [bad] })],
      ["known-finding over an unlabelled failure", record({ standing: "known-finding", invariants: [bad] })],
      ["a standing no code writes", record({ standing: "FAILING" as never, invariants: [bad] })],
      ["clean over no invariants", record({ standing: "clean", invariants: [] })],
      ["a finding of another invariant", record({
        standing: "known-finding",
        invariants: [{ invariant: "no-jump", holds: false, detail: "", finding: "loop-pass-one-frame-short" }]
      })],
      ["a finding no entry names", record({
        standing: "known-finding",
        invariants: [{ invariant: "section-is-slice", holds: false, detail: "", finding: "invented" }]
      })]
    ];
    for (const [name, probe] of probes) {
      expect(() => planAccept(summary([probe]), null, new Set(["a"]), force), name).toThrow(/: a$/);
    }
  });
  it("refuses a changed row with no uploaded WAV, naming the rows last, and plans nothing", () => {
    const rows = [record({ id: "a", register: "changed" }), record({ id: "b", register: "changed" })];
    expect(() => planAccept(summary(rows), null, new Set(["b"]), force)).toThrow(/no uploaded WAV.*: a$/);
  });
  it("needs an upload for every row whose hash is new to it, shared hash or not", () => {
    const onDisk = registerAt(48000, { a: entry("h1") });
    const shared = [record({ id: "b", read: read({ hash: "h2" }) }), record({ id: "c", read: read({ hash: "h2" }) })];
    expect(() => planAccept(summary(shared), null, new Set(["b"]), force)).toThrow(/no uploaded WAV.*: c$/);
    expect(() => planAccept(summary(shared), null, new Set(["c"]), force)).toThrow(/no uploaded WAV.*: b$/);
    const heldElsewhere = [record({ id: "a", read: read({ hash: "h1" }) }), record({ id: "b", read: read({ hash: "h1" }) })];
    expect(() => planAccept(summary(heldElsewhere), onDisk, new Set(), force)).toThrow(/no uploaded WAV.*: b$/);
  });
  it("plans a copy only for hashes new to the library, once per hash", () => {
    const onDisk = registerAt(48000, { a: entry("h1") });
    const rows = [record({ id: "a", read: read({ hash: "h1" }), register: "identical" }),
      record({ id: "b", read: read({ hash: "h2" }) }), record({ id: "c", read: read({ hash: "h2" }) }),
      record({ id: "d", read: read({ hash: "h1" }) })];
    const plan = planAccept(summary(rows), onDisk, new Set(["b", "c", "d"]), force);
    expect(plan.wavsToCopy).toEqual([{ rowId: "b", hash: "h2" }]);
    expect(plan.register.rows.a).toEqual(onDisk.rows.a);
    expect(plan.register.rows.d.wav).toBe("wav/h1.wav");
  });
  it("refuses a summary whose rate differs from the register's", () => {
    expect(() => planAccept(summary([], { sampleRate: 44100 }), registerAt(48000), new Set(), force)).toThrow(/44100.*48000/);
  });
  it("refuses a descending-UUID run outright", () => {
    expect(() => planAccept(summary([record()], { uuidOrder: "descending" }), null, new Set(["a"]), force)).toThrow(/control run/);
  });
  it("merges a partial run only when forced", () => {
    const onDisk = registerAt(48000, { a: entry("h1"), z: entry("hz") });
    const partial = summary([record({ id: "a", read: read({ hash: "h9" }) })], { rowsParam: "core" });
    expect(() => planAccept(partial, onDisk, new Set(["a"]), opts())).toThrow(/partial/);
    const plan = planAccept(partial, onDisk, new Set(["a"]), force);
    expect(Object.keys(plan.register.rows).sort()).toEqual(["a", "z"]);
    expect(plan.register.rows.a.hash).toBe("h9");
  });
  it("refuses a partial merge into a register of another engine", () => {
    const onDisk = { ...registerAt(48000, { z: entry("hz") }), engineWasmSha256: "f".repeat(64) };
    expect(() => planAccept(summary([record()], { rowsParam: "core" }), onDisk, new Set(["a"]), force)).toThrow(/another build/);
  });
  it("a forced full run replaces the register", () => {
    const onDisk = registerAt(48000, { z: entry("hz") });
    const plan = planAccept(summary([record()]), onDisk, new Set(["a"]), force);
    expect(Object.keys(plan.register.rows)).toEqual(["a"]);
    expect(plan.register.acceptedRunToken).toBe(7);
  });
  it("refuses a full run whose rows are not the catalogue's unless forced, naming them", () => {
    const ids = buildRows(48000).map((r) => r.id);
    const whole = ids.map((id) => holding(id));
    const all = new Set(ids);
    expect(planAccept(summary(whole), null, all, opts()).register.rows[ids[0]].hash).toBe(`hash-${ids[0]}`);
    expect(() => planAccept(summary(whole.slice(1)), null, all, opts())).toThrow(new RegExp(`missing.*${ids[0]}$`));
    expect(() => planAccept(summary([...whole, holding(ids[0], { id: "stray" })]), null, new Set([...ids, "stray"]), opts()))
      .toThrow(/not in the catalogue.*: stray$/);
    expect(planAccept(summary(whole.slice(1)), null, all, force).register.rows[ids[0]]).toBeUndefined();
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
    expect(stale.map((s) => s.name)).toContain("loop-pass-one-frame-short");
    expect(stale.find((s) => s.name === "loop-pass-one-frame-short")!.rows.length).toBeGreaterThan(0);
  });
  it("does not report one whose invariant still fails, or a row that errored", () => {
    const failing = rows.map((r) => {
      const h = held(r.id);
      return { ...h, invariants: h.invariants.map((i) => i.invariant === "impulse-on-reference" ? { ...i, holds: false } : i) };
    });
    expect(staleFindings(summary(failing, { sampleRate: 44100 })).map((s) => s.name)).not.toContain("loop-pass-one-frame-short");
    const errored = rows.map((r) => record({ id: r.id, error: "x", read: null, standing: "errored" }));
    expect(staleFindings(summary(errored, { sampleRate: 44100 }))).toEqual([]);
  });
  it("does not report a finding at a rate where no row applies", () => {
    expect(staleFindings(summary([], { sampleRate: 48000 }))).toEqual([]);
  });
  it("names long-silence-ends-render once the gap rows reach their range, and not while one still stops short", () => {
    const gapRows = buildRows(48000).filter((r) => ["gap-none-start", "gap-none-section-entire", "gap-none-stem-start"].includes(r.id));
    expect(gapRows.length).toBe(3);
    const heldGap = gapRows.map((row) => record({
      id: row.id, invariants: row.invariants.map((invariant) => ({ invariant, holds: true, detail: "", finding: null }))
    }));
    expect(staleFindings(summary(heldGap, { sampleRate: 48000 })).find((s) => s.name === "long-silence-ends-render")?.rows.sort())
      .toEqual(["gap-none-section-entire", "gap-none-start", "gap-none-stem-start"]);
    const oneShort = heldGap.map((r, index) => index > 0 ? r : {
      ...r, invariants: r.invariants.map((i) => i.invariant === "section-is-slice" ? { ...i, holds: false } : i)
    });
    expect(staleFindings(summary(oneShort, { sampleRate: 48000 })).map((s) => s.name)).not.toContain("long-silence-ends-render");
  });
  it("is the schema constant", () => expect(EXPORT_REGRESSION_SCHEMA_VERSION).toBe(1));
});
