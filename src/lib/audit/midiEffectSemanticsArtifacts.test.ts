import { describe, expect, it } from "vitest";
import {
  MIDI_SEMANTICS_SCHEMA_VERSION, SUMMARY_NAME, parseSemanticsRegister, parseSemanticsSummary, registerDiff,
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
  rowsParam: "", deviceParam: "", patternParam: "", registerSource: null, registerSdkVersion: null,
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
    const clean = registerFromSummary(summary([record("a", { rule: "none", unreadable: 2 }), record("b")]), { force: false, acceptedAt });
    expect(clean).toMatchObject({ schemaVersion: 1, sdkVersion: "0.0.180", acceptedRunToken: 7, acceptedAt, sampleRate: 48000, bpm: 120 });
    expect(clean.rows.a).toEqual({ notes: [note(0)], unreadable: 2 });
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
