import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptPath, formatRows, planAccept, rowDeltas, runLine, writeRegister } from "./table.ts";
import type { SemanticsRowRecord, SemanticsSummary } from "../../../src/lib/audit/midiEffectSemanticsArtifacts.ts";

const fig = (onsetMs: number, cents: number | null, velocity: number) => ({ onsetMs, endMs: onsetMs + 50, pitch: 60, cents, velocity, jitterCents: null });
const pred = (onsetMs: number, readability: "readable" | "abutting") => ({ onsetMs, endMs: onsetMs + 50, pitch: 60, cents: 0, velocity: 1, readability });

function row(over: Partial<SemanticsRowRecord>): SemanticsRowRecord {
  return {
    id: "a", label: "A", group: "dry", pattern: "p", chain: [], predicted: [pred(100, "readable"), pred(200, "readable")],
    ruleSentence: "the rule", read: [fig(100.5, 1, 0.98), fig(199, -3, 1)], unreadable: 0, rule: "holds", deviations: [], questions: [],
    register: "as-registered", verdict: "as-registered", figure: null, error: null, renderMs: 120, ...over
  } as SemanticsRowRecord;
}

function summary(rows: SemanticsRowRecord[]): SemanticsSummary {
  return {
    schemaVersion: 1, runToken: 7, userAgent: "ua", sdkVersion: "0.0.180", sampleRate: 48000, bpm: 120, rowsParam: "all", deviceParam: "all",
    patternParam: "all", registerSource: null, registerSdkVersion: null,
    calibration: { referencePeak: 0.5, instrumentOffsetFrames: 12, onsetThreshold: 0.1, attackMs: 1, gapMs: 2 }, rows
  };
}

describe("rowDeltas", () => {
  it("pairs readable predicted notes with read notes in order", () => {
    expect(rowDeltas(row({}))).toEqual({ onsetMs: 1, cents: 3, velocity: 0.02 });
  });
  it("skips predicted notes that are not readable", () => {
    const r = row({ predicted: [pred(100, "abutting"), pred(200, "readable")], read: [fig(200.25, 0, 1)] });
    expect(rowDeltas(r).onsetMs).toBeCloseTo(0.25);
  });
  it("with an abutting note present and read count equal to the readable count, deltas are numbers", () => {
    const r = row({ predicted: [pred(100, "readable"), pred(150, "abutting"), pred(200, "readable")], read: [fig(100.5, 0, 1), fig(199, 0, 1)] });
    expect(rowDeltas(r)).toEqual({ onsetMs: 1, cents: 0, velocity: 0 });
  });
  it("pairs nothing when the read list is not as long as the readable list", () => {
    expect(rowDeltas(row({ read: [fig(100, 0, 1)] }))).toEqual({ onsetMs: null, cents: null, velocity: null });
  });
  it("is null throughout when nothing pairs", () => {
    expect(rowDeltas(row({ read: [] }))).toEqual({ onsetMs: null, cents: null, velocity: null });
  });
  it("leaves cents null when the read note has none", () => {
    expect(rowDeltas(row({ read: [fig(100, null, 1), fig(200, null, 1)] })).cents).toBeNull();
  });
});

describe("formatRows", () => {
  it("prints one line per row", () => {
    const lines = formatRows(summary([
      row({}),
      row({ id: "b", rule: "broken", verdict: "broken", figure: "note 1 onset 5.0 ms expected 4.0 ms", questions: ["x" as never, "y" as never], unreadable: 1, read: [], renderMs: 90 })
    ]));
    expect(lines).toEqual([
      "a | as-registered | — | 2 / 2 (0) | 1.00 | 3.0 | 0.020 | 120",
      "b | broken | note 1 onset 5.0 ms expected 4.0 ms questioned: x+y | rule: the rule | 0 / 2 (1) | — | — | — | 90"
    ]);
  });
});

describe("runLine", () => {
  it("counts the rule classes and the register classes", () => {
    const line = runLine(summary([
      row({}), row({ rule: "deviation", register: "changed" }), row({ rule: "deviation", register: "unregistered" }), row({ rule: "broken", register: "changed" }),
      row({ rule: "none", register: "unregistered" }), row({ error: "boom", register: "unregistered" })
    ]));
    expect(line).toBe("run 7 | sdk 0.0.180 | 48000 Hz | 120 bpm | reference peak 0.5 | instrument offset 12 frames | register none | rows 6 | "
      + "holds 1 deviation 2 broken 1 none 1 error 1 | as-registered 1 changed 2 unregistered 2");
  });
});

describe("acceptPath", () => {
  it("ends in register/<rate>.json", () => {
    expect(acceptPath(48000)).toMatch(/debug\/2026-11-03-midi-effect-semantics\/register\/48000\.json$/);
  });
});

describe("planAccept", () => {
  it("plans the register, reports no previous, then the diff against the written one", () => {
    const root = mkdtempSync(join(tmpdir(), "semreg-"));
    const first = planAccept(summary([row({})]), { force: false, root });
    expect(first.diffLines).toEqual(["no previous register", "added: a"]);
    expect(existsSync(first.path)).toBe(false);
    writeRegister(first.path, first.next);
    expect(JSON.parse(readFileSync(first.path, "utf8")).rows.a.notes).toHaveLength(2);
    expect(planAccept(summary([row({ id: "c" })]), { force: false, root }).diffLines).toEqual(["added: c", "removed: a"]);
  });
  it("stamps acceptedAt as an ISO time, prints changed: for a moved row and no differences for a repeat", () => {
    const root = mkdtempSync(join(tmpdir(), "semreg-"));
    const first = planAccept(summary([row({}), row({ id: "b" })]), { force: false, root });
    expect(first.next.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    writeRegister(first.path, first.next);
    expect(planAccept(summary([row({}), row({ id: "b" })]), { force: false, root }).diffLines).toEqual(["no differences"]);
    expect(planAccept(summary([row({}), row({ id: "b", read: [fig(110, 1, 0.98), fig(199, -3, 1)] })]), { force: false, root }).diffLines).toEqual(["changed: b"]);
  });
  it("refuses a partial run without force and writes nothing; forced, merges into the previous register and says so", () => {
    const root = mkdtempSync(join(tmpdir(), "semreg-"));
    const full = planAccept(summary([row({}), row({ id: "b" })]), { force: false, root });
    writeRegister(full.path, full.next);
    const before = readFileSync(full.path, "utf8");
    const partial = { ...summary([row({ id: "b", read: [fig(110, 1, 0.98), fig(199, -3, 1)] })]), rowsParam: "quick" };
    expect(() => planAccept(partial, { force: false, root })).toThrow(/partial \(rows=quick\)/);
    expect(readFileSync(full.path, "utf8")).toBe(before);
    const forced = planAccept(partial, { force: true, root });
    expect(Object.keys(forced.next.rows).sort()).toEqual(["a", "b"]);
    expect(forced.diffLines).toEqual(["FORCED", `merged into ${full.path}`, "changed: b"]);
  });
  it("a full run replaces the register: a row it did not render is removed", () => {
    const root = mkdtempSync(join(tmpdir(), "semreg-"));
    const full = planAccept(summary([row({}), row({ id: "b" })]), { force: false, root });
    writeRegister(full.path, full.next);
    const next = planAccept(summary([row({})]), { force: false, root });
    expect(Object.keys(next.next.rows)).toEqual(["a"]);
    expect(next.diffLines).toEqual(["removed: b"]);
  });
  it("refuses a broken row without force and writes nothing, FORCED with force", () => {
    const root = mkdtempSync(join(tmpdir(), "semreg-"));
    const s = summary([row({ rule: "broken" })]);
    expect(() => planAccept(s, { force: false, root })).toThrow(/not accepted without force: a/);
    expect(existsSync(acceptPath(48000, root))).toBe(false);
    expect(planAccept(s, { force: true, root }).diffLines[0]).toBe("FORCED");
  });
});
