import { describe, expect, it } from "vitest";
import {
  auditStateAfterRun, EXPORT_REGRESSION_SCHEMA_VERSION, isMissingSink, noRegisterNotice, parseExportRegister, parseExportSummary, planAccept,
  registerCounts, staleFindings, summaryFileName, SUMMARY_NAME, wavFileName,
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
  it("refuses a read a row with no error cannot be accepted from", () => {
    const withRead = (over: Record<string, unknown>) => ({ ...summary([record({ read: { ...read(), ...over } as RenderRead })]) });
    const roundTrip = (s: unknown) => JSON.parse(JSON.stringify(s));
    expect(() => parseExportSummary(roundTrip(withRead({ channels: "2" })), 7)).toThrow(/row a read.channels is string/);
    expect(() => parseExportSummary(roundTrip(withRead({ peak: null })), 7)).toThrow(/row a read.peak is null/);
    expect(() => parseExportSummary(roundTrip(withRead({ impulseHits: 3 })), 7)).toThrow(/row a read.impulseHits is not an array/);
    expect(() => parseExportSummary(roundTrip(withRead({ impulseHits: [3, "4"] })), 7)).toThrow(/row a read.impulseHits\[1\] is string/);
  });
  it("reads an errored row with no read at all", () => {
    const errored = record({ error: "worker hung", read: null, standing: "errored", invariants: [] });
    expect(parseExportSummary(JSON.parse(JSON.stringify(summary([errored]))), 7).rows[0].error).toBe("worker hung");
  });
  it("refuses an invariant result whose holds or finding has another type", () => {
    const withInvariant = (over: Record<string, unknown>) => summary([record({
      invariants: [{ invariant: "no-jump", holds: true, detail: "", finding: null, ...over } as RowRecord["invariants"][number]]
    })]);
    expect(() => parseExportSummary(withInvariant({ holds: "true" }), 7)).toThrow(/row a invariant 0 holds is string/);
    expect(() => parseExportSummary(withInvariant({ finding: 3 }), 7)).toThrow(/row a invariant 0 finding is number/);
    expect(() => parseExportSummary(withInvariant({ invariant: null }), 7)).toThrow(/row a invariant 0 invariant is null/);
    expect(parseExportSummary(withInvariant({ finding: "loop-wrap-keeps-old-read" }), 7).rows).toHaveLength(1);
  });
  it("refuses a register entry with the same gaps", () => {
    const withEntry = (over: Record<string, unknown>) => registerAt(48000, { a: { ...entry("h"), ...over } as ExportRegister["rows"][string] });
    expect(() => parseExportRegister(withEntry({ channels: "2" }))).toThrow(/row a channels is string/);
    expect(() => parseExportRegister(withEntry({ peak: null }))).toThrow(/row a peak is null/);
    expect(() => parseExportRegister(withEntry({ impulseHits: [Infinity] }))).toThrow(/row a impulseHits\[0\] is number/);
  });
});

describe("what the page reports apart from the standing", () => {
  it("counts the register's verdicts, and leaves out an errored row, which has none", () => {
    const rows = [record({ register: "identical" }), record({ register: "identical" }), record({ register: "changed" }),
      record({ register: "unregistered" }), record({ register: null, error: "x", read: null, standing: "errored" })];
    expect(registerCounts(rows)).toEqual({ identical: 2, changed: 1, unregistered: 1 });
    expect(registerCounts([])).toEqual({ identical: 0, changed: 0, unregistered: 0 });
  });
  it("says a run with no register proves the invariants only, and says nothing beside a register or on a fill", () => {
    expect(noRegisterNotice(false, false)).toMatch(/invariants only.*not.*same bits as accepted/);
    expect(noRegisterNotice(true, false)).toBeNull();
    expect(noRegisterNotice(false, true)).toBeNull();
  });
  it("ends a run whose summary found no sink in a state of its own", () => {
    expect(auditStateAfterRun(true)).toBe("done");
    expect(auditStateAfterRun(false)).toBe("done:no-summary");
  });
  it("takes only a 404 or a 405 for a missing sink", () => {
    expect(isMissingSink("verify sink rejected JSON: HTTP 404")).toBe(true);
    expect(isMissingSink("verify sink rejected JSON: HTTP 405")).toBe(true);
    expect(isMissingSink("verify sink rejected JSON: HTTP 500")).toBe(false);
    expect(isMissingSink("summary upload: deadline after 30000 ms")).toBe(false);
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
  const [A, B, C, D] = buildRows(48000).map((r) => r.id);
  const tail = (id: string) => new RegExp(`: ${id}$`);
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
    const row = buildRows(48000).find((r) => r.id === "tail-none-start-long")!;
    expect(row.invariants).toContain("section-is-slice");
    const labelled = holding(row.id, {
      standing: "known-finding", read: read({ hash: "h" }),
      invariants: row.invariants.map((invariant) => invariant === "section-is-slice"
        ? { invariant, holds: false, detail: "", finding: "trailing-silence-trimmed" }
        : { invariant, holds: true, detail: "", finding: null })
    });
    expect(planAccept(summary([labelled]), null, new Set([row.id]), force).register.rows[row.id].hash).toBe("h");
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
        invariants: [{ invariant: "no-jump", holds: false, detail: "", finding: "trailing-silence-trimmed" }]
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
  it("refuses a row of a catalogue that has since changed, forced or not", () => {
    const row = buildRows(48000)[0];
    const short = holding(row.id, { invariants: holding(row.id).invariants.slice(1) });
    expect(row.invariants.length).toBeGreaterThan(1);
    for (const options of [opts(), force]) {
      expect(() => planAccept(summary([short]), null, new Set([row.id]), options)).toThrow(/not the catalogue's.*not even forced/);
    }
    const extra = holding(row.id, { invariants: [...holding(row.id).invariants, { invariant: "tail-absent", holds: true, detail: "", finding: null }] });
    expect(() => planAccept(summary([extra]), null, new Set([row.id]), force)).toThrow(new RegExp(`not the catalogue's.*: ${row.id}$`));
  });
  it("holds a row to the catalogue of its own rate", () => {
    // The rows carry the same ids at both rates, and not the same invariants
    const at48 = buildRows(48000);
    const at44 = buildRows(44100);
    const row = at48.find((r) => at44.find((other) => other.id === r.id)!.invariants.join() !== r.invariants.join())!;
    const own = at44.find((r) => r.id === row.id)!;
    expect(() => planAccept(summary([holding(row.id)], { sampleRate: 44100 }), null, new Set([row.id]), force))
      .toThrow(new RegExp(`not the catalogue's.*: ${row.id}$`));
    const held = holding(row.id, { invariants: own.invariants.map((invariant) => ({ invariant, holds: true, detail: "", finding: null })) });
    expect(planAccept(summary([held], { sampleRate: 44100 }), null, new Set([row.id]), force).register.rows[row.id].hash).toBe(`hash-${row.id}`);
  });
  it("refuses a row the catalogue does not hold, forced or not, partial or full", () => {
    const stray = holding(A, { id: "stray" });
    for (const over of [{}, { rowsParam: "core" }]) {
      expect(() => planAccept(summary([stray], over), null, new Set(["stray"]), force)).toThrow(/not in the catalogue.*not even forced.*: stray$/);
    }
  });
  it("refuses a changed row with no uploaded WAV, naming the rows last, and plans nothing", () => {
    const rows = [holding(A, { register: "changed" }), holding(B, { register: "changed" })];
    expect(() => planAccept(summary(rows), null, new Set([B]), force)).toThrow(new RegExp(`no uploaded WAV.*: ${A}$`));
  });
  it("needs an upload for every row whose hash is new to it, shared hash or not", () => {
    const onDisk = registerAt(48000, { [A]: entry("h1") });
    const shared = [holding(B, { read: read({ hash: "h2" }) }), holding(C, { read: read({ hash: "h2" }) })];
    expect(() => planAccept(summary(shared), null, new Set([B]), force)).toThrow(tail(C));
    expect(() => planAccept(summary(shared), null, new Set([C]), force)).toThrow(tail(B));
    const heldElsewhere = [holding(A, { read: read({ hash: "h1" }) }), holding(B, { read: read({ hash: "h1" }) })];
    expect(() => planAccept(summary(heldElsewhere), onDisk, new Set(), force)).toThrow(tail(B));
  });
  it("plans a copy only for hashes new to the library, once per hash", () => {
    const onDisk = registerAt(48000, { [A]: entry("h1") });
    const rows = [holding(A, { read: read({ hash: "h1" }), register: "identical" }),
      holding(B, { read: read({ hash: "h2" }) }), holding(C, { read: read({ hash: "h2" }) }),
      holding(D, { read: read({ hash: "h1" }) })];
    const plan = planAccept(summary(rows), onDisk, new Set([B, C, D]), force);
    expect(plan.wavsToCopy).toEqual([{ rowId: B, hash: "h2" }]);
    expect(plan.register.rows[A]).toEqual(onDisk.rows[A]);
    expect(plan.register.rows[D].wav).toBe("wav/h1.wav");
  });
  it("refuses a summary whose rate differs from the register's", () => {
    expect(() => planAccept(summary([], { sampleRate: 44100 }), registerAt(48000), new Set(), force)).toThrow(/44100.*48000/);
  });
  it("refuses a descending-UUID run outright", () => {
    expect(() => planAccept(summary([record()], { uuidOrder: "descending" }), null, new Set(["a"]), force)).toThrow(/control run/);
  });
  it("merges a partial run only when forced", () => {
    const onDisk = registerAt(48000, { [A]: entry("h1"), z: entry("hz") });
    const partial = summary([holding(A, { read: read({ hash: "h9" }) })], { rowsParam: "core" });
    expect(() => planAccept(partial, onDisk, new Set([A]), opts())).toThrow(/partial/);
    const plan = planAccept(partial, onDisk, new Set([A]), force);
    expect(Object.keys(plan.register.rows).sort()).toEqual([A, "z"].sort());
    expect(plan.register.rows[A].hash).toBe("h9");
  });
  it("refuses a partial merge into a register of another engine", () => {
    const onDisk = { ...registerAt(48000, { z: entry("hz") }), engineWasmSha256: "f".repeat(64) };
    expect(() => planAccept(summary([holding(A)], { rowsParam: "core" }), onDisk, new Set([A]), force)).toThrow(/another build/);
  });
  it("a forced full run replaces the register", () => {
    const onDisk = registerAt(48000, { z: entry("hz") });
    const plan = planAccept(summary([holding(A)]), onDisk, new Set([A]), force);
    expect(Object.keys(plan.register.rows)).toEqual([A]);
    expect(plan.register.acceptedRunToken).toBe(7);
  });
  it("refuses a full run missing catalogue rows unless forced, naming them", () => {
    const ids = buildRows(48000).map((r) => r.id);
    const whole = ids.map((id) => holding(id));
    const all = new Set(ids);
    expect(planAccept(summary(whole), null, all, opts()).register.rows[ids[0]].hash).toBe(`hash-${ids[0]}`);
    expect(() => planAccept(summary(whole.slice(1)), null, all, opts())).toThrow(new RegExp(`missing.*${ids[0]}$`));
    expect(planAccept(summary(whole.slice(1)), null, all, force).register.rows[ids[0]]).toBeUndefined();
  });
});

describe("staleFindings", () => {
  const LABEL = "trailing-silence-trimmed";
  const TRIMMED = ["tail-none-section-entire-long", "tail-none-start-long"];
  const rows = buildRows(44100).filter((r) => TRIMMED.includes(r.id));
  const held = (id: string): RowRecord => {
    const row = rows.find((r) => r.id === id)!;
    return record({
      id, invariants: row.invariants.map((invariant) => ({ invariant, holds: true, detail: "", finding: null }))
    });
  };
  const failingOn = (held: RowRecord): RowRecord =>
    ({ ...held, invariants: held.invariants.map((i) => i.invariant === "section-is-slice" ? { ...i, holds: false, finding: LABEL } : i) });
  it("reports a finding whose rows now hold as no longer reproducing", () => {
    expect(rows.length).toBe(2);
    const stale = staleFindings(summary(rows.map((r) => held(r.id)), { sampleRate: 44100 }));
    expect(stale.map((s) => s.name)).toContain(LABEL);
    expect(stale.find((s) => s.name === LABEL)!.rows.sort()).toEqual(TRIMMED);
  });
  it("does not report one whose invariant still fails, or a row that errored", () => {
    const failing = rows.map((r) => failingOn(held(r.id)));
    expect(staleFindings(summary(failing, { sampleRate: 44100 })).map((s) => s.name)).not.toContain(LABEL);
    const errored = rows.map((r) => record({ id: r.id, error: "x", read: null, standing: "errored" }));
    expect(staleFindings(summary(errored, { sampleRate: 44100 }))).toEqual([]);
  });
  it("does not report a finding at a rate where no row applies", () => {
    expect(staleFindings(summary([], { sampleRate: 48000 }))).toEqual([]);
  });
  it("does not report a finding while one of its rows still fails", () => {
    const oneFailing = rows.map((r, index) => (index > 0 ? held(r.id) : failingOn(held(r.id))));
    expect(staleFindings(summary(oneFailing, { sampleRate: 44100 })).map((s) => s.name)).not.toContain(LABEL);
  });
  it("is the schema constant", () => expect(EXPORT_REGRESSION_SCHEMA_VERSION).toBe(1));
});
