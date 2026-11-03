import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MIDI_SEMANTICS_SCHEMA_VERSION, SUMMARY_NAME, parseSemanticsRegister, partialParams, parseSemanticsSummary, registerDiff,
  registerFromSummary, roundFigure, summaryFileName, type SemanticsRowRecord, type SemanticsSummary
} from "./midiEffectSemanticsArtifacts";
import type { NoteFigure } from "./midiEffectSemanticsReader";

const note = (onsetMs: number): NoteFigure => ({ onsetMs, endMs: onsetMs + 100, pitch: 69, cents: 0, velocity: 0.5, jitterCents: 0.2 });

const record = (id: string, patch: Partial<SemanticsRowRecord> = {}): SemanticsRowRecord => ({
  id, label: id, group: "arpeggio", pattern: "held-chord", chain: [], predicted: [], ruleSentence: "", read: [note(0)],
  unreadable: 0, rule: "holds", deviations: [], questions: [], register: "unregistered", verdict: "rule holds, unregistered",
  figure: null, error: null, renderMs: 10, ...patch
});

const summary = (rows: SemanticsRowRecord[]): SemanticsSummary => ({
  schemaVersion: MIDI_SEMANTICS_SCHEMA_VERSION, runToken: 7, userAgent: "ua", sdkVersion: "0.0.180", sampleRate: 48000, bpm: 120,
  rowsParam: "all", deviceParam: "all", patternParam: "all", registerSource: null, registerSdkVersion: null,
  calibration: { referencePeak: 1, instrumentOffsetFrames: 0, onsetThreshold: 0.002, attackMs: 1, gapMs: 5 }, rows
});

const acceptedAt = "2026-11-03T00:00:00Z";

describe("midiEffectSemanticsArtifacts", () => {
  it("names the summary by run token", () => {
    expect(summaryFileName(1)).toBe("midisem-summary-1.json");
    expect(SUMMARY_NAME.exec("midisem-summary-42.json")?.[1]).toBe("42");
  });

  it("parses the current schema and rejects another, a missing rows array, a row without read or verdict", () => {
    const ok = summary([record("a")]);
    expect(parseSemanticsSummary(ok, 7).rows.length).toBe(1);
    expect(() => parseSemanticsSummary({ ...ok, schemaVersion: 2 }, 7)).toThrow(/summary 7: schemaVersion/);
    expect(() => parseSemanticsSummary({ ...ok, rows: null }, 7)).toThrow(/rows/);
    expect(() => parseSemanticsSummary({ ...ok, rows: [{ ...record("a"), read: undefined }] }, 7)).toThrow(/read/);
    expect(() => parseSemanticsSummary({ ...ok, rows: [{ ...record("a"), verdict: 3 }] }, 7)).toThrow(/verdict/);
    expect(() => parseSemanticsSummary(null, 7)).toThrow(/not an object/);
  });

  it("roundFigure rounds to the register's resolution, leaves no float tail and keeps nulls", () => {
    const rounded = roundFigure({ onsetMs: 10.04, endMs: 20.06, pitch: 69, cents: 1.26, velocity: 0.5066, jitterCents: 0.349 });
    expect(rounded).toEqual({ onsetMs: 10, endMs: 20.1, pitch: 69, cents: 1.3, velocity: 0.505, jitterCents: 0.3 });
    const tails = roundFigure({ onsetMs: 10.1000001, endMs: 0.30000000000000004 + 0.1, pitch: 60, cents: -2.7000000001, velocity: 0.7, jitterCents: 0.1 + 0.2 });
    expect(tails).toEqual({ onsetMs: 10.1, endMs: 0.4, pitch: 60, cents: -2.7, velocity: 0.7, jitterCents: 0.3 });
    expect(JSON.stringify(tails)).not.toMatch(/\.\d*(0000|9999)/);
    expect(roundFigure({ onsetMs: 1, endMs: 2, pitch: null, cents: null, velocity: 0, jitterCents: null }))
      .toEqual({ onsetMs: 1, endMs: 2, pitch: null, cents: null, velocity: 0, jitterCents: null });
  });

  it("names a null row in its own message", () => {
    expect(() => parseSemanticsSummary({ ...summary([]), rows: [null] }, 7)).toThrow("summary 7: row 0 is not an object");
    const register = registerFromSummary(summary([record("a")]), { force: false, acceptedAt });
    expect(() => parseSemanticsRegister({ ...register, rows: { x: null } })).toThrow("register: row x is not an object");
  });

  it("registerFromSummary keys figures by id and refuses a run with an error or a broken row unless forced", () => {
    const withBroken = summary([record("dry"), record("arp-vel0-held-chord", { rule: "broken" }), record("boom", { error: "threw" })]);
    expect(() => registerFromSummary(withBroken, { force: false, acceptedAt })).toThrow(/arp-vel0-held-chord/);
    expect(() => registerFromSummary(withBroken, { force: false, acceptedAt })).toThrow(/boom/);
    const forced = registerFromSummary(withBroken, { force: true, acceptedAt });
    expect(Object.keys(forced.rows)).toContain("arp-vel0-held-chord");
    expect(Object.keys(forced.rows)).not.toContain("boom");
    const clean = registerFromSummary(summary([record("a", { rule: "none", unreadable: 2 }), record("b")]), { force: false, acceptedAt });
    expect(clean).toMatchObject({ schemaVersion: 1, sdkVersion: "0.0.180", acceptedRunToken: 7, acceptedAt, sampleRate: 48000, bpm: 120 });
    expect(clean.rows.a).toEqual({ notes: [note(0)], unreadable: 2 });
  });

  it("partialParams names every row filter that is not all", () => {
    expect(partialParams(summary([]))).toEqual([]);
    expect(partialParams({ ...summary([]), rowsParam: "quick", patternParam: "melody" })).toEqual(["rows=quick", "pattern=melody"]);
    expect(partialParams({ ...summary([]), deviceParam: "pitch" })).toEqual(["device=pitch"]);
  });

  it("a partial run is refused without force; forced, its rows merge into the previous register's", () => {
    const previous = registerFromSummary(summary([record("keep"), record("redo")]), { force: false, acceptedAt });
    const partial = { ...summary([record("redo", { read: [note(5)] }), record("new")]), rowsParam: "redo,new" };
    expect(() => registerFromSummary(partial, { force: false, acceptedAt, previous })).toThrow(/partial \(rows=redo,new\), not accepted without force/);
    const merged = registerFromSummary(partial, { force: true, acceptedAt, previous });
    expect(Object.keys(merged.rows).sort()).toEqual(["keep", "new", "redo"]);
    expect(merged.rows.keep).toEqual(previous.rows.keep);
    expect(merged.rows.redo!.notes).toEqual([note(5)]);
    expect(Object.keys(registerFromSummary(partial, { force: true, acceptedAt, previous: null }).rows).sort()).toEqual(["new", "redo"]);
  });

  it("forced, an errored row is never a baseline: it keeps the previous entry, and is left out when there is none", () => {
    const previous = registerFromSummary(summary([record("dry"), record("boom", { read: [note(3)] })]), { force: false, acceptedAt });
    const errored = summary([record("dry"), record("boom", { error: "render threw", read: [] }), record("fresh", { error: "render threw", read: [] })]);
    const full = registerFromSummary(errored, { force: true, acceptedAt, previous });
    expect(full.rows.boom).toEqual(previous.rows.boom);
    expect(Object.keys(full.rows).sort()).toEqual(["boom", "dry"]);
    expect(Object.keys(registerFromSummary(errored, { force: true, acceptedAt, previous: null }).rows)).toEqual(["dry"]);
    const partial = registerFromSummary({ ...errored, rowsParam: "quick" }, { force: true, acceptedAt, previous });
    expect(partial.rows.boom).toEqual(previous.rows.boom);
    expect(partial.rows.fresh).toBeUndefined();
  });

  it("forced, an errored row keeps no entry from a register of another SDK, bpm or rate", () => {
    const previous = { ...registerFromSummary(summary([record("boom")]), { force: false, acceptedAt }), sdkVersion: "0.0.179" };
    const full = registerFromSummary(summary([record("boom", { error: "threw", read: [] })]), { force: true, acceptedAt, previous });
    expect(full.rows.boom).toBeUndefined();
  });

  it("a partial merge into a register of another SDK, bpm or rate is refused, naming the fields; on the same footing it merges and takes the latest accept", () => {
    const previous = registerFromSummary(summary([record("keep"), record("redo")]), { force: false, acceptedAt });
    const partial = { ...summary([record("redo", { read: [note(5)] })]), rowsParam: "redo", runToken: 9 };
    expect(() => registerFromSummary(partial, { force: true, acceptedAt, previous: { ...previous, sdkVersion: "0.0.179" } }))
      .toThrow(/sdkVersion 0\.0\.179 in the register, 0\.0\.180 in the run/);
    expect(() => registerFromSummary(partial, { force: true, acceptedAt, previous: { ...previous, bpm: 100, sampleRate: 44100 } }))
      .toThrow(/bpm 100 in the register, 120 in the run, sampleRate 44100 in the register, 48000 in the run/);
    const merged = registerFromSummary(partial, { force: true, acceptedAt: "2026-11-04T00:00:00Z", previous });
    expect(merged).toMatchObject({ acceptedRunToken: 9, acceptedAt: "2026-11-04T00:00:00Z", sdkVersion: "0.0.180", bpm: 120, sampleRate: 48000 });
    expect(merged.rows.keep).toEqual(previous.rows.keep);
  });

  it("parseSemanticsRegister rejects a note with a missing or non-finite figure, naming the row, the note and the field", () => {
    const register = registerFromSummary(summary([record("a", { read: [note(0), note(200)] })]), { force: false, acceptedAt });
    const withNote = (patch: Record<string, unknown>) => ({ ...register, rows: { a: { notes: [note(0), { ...note(200), ...patch }], unreadable: 0 } } });
    expect(() => parseSemanticsRegister(withNote({ onsetMs: undefined }))).toThrow("register: row a note 1 onsetMs is undefined, not a finite number");
    expect(() => parseSemanticsRegister(withNote({ endMs: "12" }))).toThrow("register: row a note 1 endMs is string, not a finite number");
    expect(() => parseSemanticsRegister(withNote({ velocity: Number.NaN }))).toThrow("register: row a note 1 velocity is NaN, not a finite number");
    expect(() => parseSemanticsRegister(withNote({ cents: "x" }))).toThrow("register: row a note 1 cents is string, not a finite number or null");
    expect(() => parseSemanticsRegister({ ...register, rows: { a: { notes: [null], unreadable: 0 } } })).toThrow("register: row a note 0 is not an object");
  });

  it("a note's pitch, cents and jitterCents are null together or numbers together", () => {
    const register = registerFromSummary(summary([record("a")]), { force: false, acceptedAt });
    const mixed = { ...register, rows: { a: { notes: [{ ...note(0), pitch: null, cents: null }], unreadable: 0 } } };
    expect(() => parseSemanticsRegister(mixed)).toThrow("register: row a note 0 has pitch, cents and jitterCents neither all null nor all numbers");
    const unread = { ...register, rows: { a: { notes: [{ ...note(0), pitch: null, cents: null, jitterCents: null }], unreadable: 0 } } };
    expect(parseSemanticsRegister(unread).rows.a!.notes[0]!.pitch).toBeNull();
  });

  it("parseSemanticsRegister rejects a register without its sdkVersion, sampleRate or bpm", () => {
    const register = registerFromSummary(summary([record("a")]), { force: false, acceptedAt });
    expect(() => parseSemanticsRegister({ ...register, sdkVersion: 1 })).toThrow("register: sdkVersion is number, not a string");
    expect(() => parseSemanticsRegister({ ...register, sampleRate: undefined })).toThrow("register: sampleRate is undefined, not a finite number");
    expect(() => parseSemanticsRegister({ ...register, bpm: Number.NaN })).toThrow("register: bpm is NaN, not a finite number");
  });

  it("parseSemanticsSummary validates the top-level figures, the calibration and every read note", () => {
    const ok = summary([record("a")]);
    expect(() => parseSemanticsSummary({ ...ok, sampleRate: "48000" }, 7)).toThrow("summary 7: sampleRate is string, not a finite number");
    expect(() => parseSemanticsSummary({ ...ok, bpm: undefined }, 7)).toThrow("summary 7: bpm is undefined, not a finite number");
    expect(() => parseSemanticsSummary({ ...ok, sdkVersion: null }, 7)).toThrow("summary 7: sdkVersion is null, not a string");
    expect(() => parseSemanticsSummary({ ...ok, calibration: null }, 7)).toThrow("summary 7: calibration is not an object");
    expect(() => parseSemanticsSummary({ ...ok, calibration: { ...ok.calibration, referencePeak: Number.NaN } }, 7))
      .toThrow("summary 7: calibration.referencePeak is NaN, not a finite number");
    expect(() => parseSemanticsSummary({ ...ok, rows: [record("a", { read: [{ ...note(0), velocity: "loud" as never }] })] }, 7))
      .toThrow("summary 7: row a note 0 velocity is string, not a finite number");
    expect(() => parseSemanticsSummary({ ...ok, rows: [{ ...record("a"), id: 4 }] }, 7)).toThrow("summary 7: row 0 id is number, not a string");
  });

  it("the checked-in registers parse", () => {
    for (const rate of [44100, 48000]) {
      const path = resolve(import.meta.dirname, `../../../debug/2026-11-03-midi-effect-semantics/register/${rate}.json`);
      const register = parseSemanticsRegister(JSON.parse(readFileSync(path, "utf8")));
      expect(register.sampleRate).toBe(rate);
      expect(Object.keys(register.rows).length).toBeGreaterThan(200);
    }
  });

  it("a full run replaces the previous register: rows it did not render are gone", () => {
    const previous = registerFromSummary(summary([record("keep"), record("gone")]), { force: false, acceptedAt });
    const full = registerFromSummary(summary([record("keep")]), { force: false, acceptedAt, previous });
    expect(Object.keys(full.rows)).toEqual(["keep"]);
  });

  it("parses a register and rejects another schema, a bad rows object, a row without notes or unreadable", () => {
    const register = registerFromSummary(summary([record("a")]), { force: false, acceptedAt });
    expect(parseSemanticsRegister(JSON.parse(JSON.stringify(register))).rows.a!.notes.length).toBe(1);
    expect(() => parseSemanticsRegister({ ...register, schemaVersion: 2 })).toThrow(/schemaVersion/);
    expect(() => parseSemanticsRegister({ ...register, rows: [] })).toThrow(/rows/);
    expect(() => parseSemanticsRegister({ ...register, rows: { a: { unreadable: 0 } } })).toThrow(/notes/);
    expect(() => parseSemanticsRegister({ ...register, rows: { a: { notes: [], unreadable: "x" } } })).toThrow(/unreadable/);
  });

  it("registerDiff reports added, removed and changed ids", () => {
    const previous = registerFromSummary(summary([record("keep"), record("gone"), record("moves")]), { force: false, acceptedAt });
    const next = registerFromSummary(summary([
      record("keep"), record("new"), record("moves", { read: [note(5)] }), 
    ]), { force: false, acceptedAt });
    expect(registerDiff(previous, next)).toEqual({ added: ["new"], removed: ["gone"], changed: ["moves"] });
    // a move inside the tolerance is not a change
    const near = registerFromSummary(summary([record("keep", { read: [note(0.5)] }), record("gone"), record("moves")]), { force: false, acceptedAt });
    expect(registerDiff(previous, near).changed).toEqual([]);
    expect(registerDiff(null, next)).toEqual({ added: ["keep", "moves", "new"], removed: [], changed: [] });
  });
});
