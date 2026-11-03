import { describe, expect, it } from "vitest";
import type { NoteFigure } from "./midiEffectSemanticsReader";
import type { PredictedFigure } from "./midiEffectSemanticsRules";
import {
  compareRegister, describeMismatch, judgeRule, TOLERANCES, verdictOf,
  type Mismatch, type RuleJudgement, type Variant
} from "./midiEffectSemanticsVerdict";

const note = (onsetMs: number, over: Partial<NoteFigure> = {}): NoteFigure =>
  ({ onsetMs, endMs: onsetMs + 100, pitch: 60, cents: 0, velocity: 0.8, jitterCents: 0.1, ...over });
const pred = (onsetMs: number, over: Partial<PredictedFigure> = {}): PredictedFigure =>
  ({ onsetMs, endMs: onsetMs + 100, pitch: 60, cents: 0, velocity: 0.8, readability: "readable", ...over });
const intent = (predicted: PredictedFigure[]): Variant => ({ deviations: new Set(), predicted });
const never = (): NoteFigure => { throw new Error("readAt must not be called"); };

describe("judgeRule", () => {
  it("holds when every readable note matches within tolerance and ignores read notes inside unreadable spans", () => {
    const predicted = [pred(1000), pred(1200, { readability: "overlap", endMs: 1500 }), pred(2000)];
    const read = [note(1000.4, { endMs: 1101 }), note(1300, { pitch: 72 }), note(2000)];
    const j = judgeRule(read, [intent(predicted)], TOLERANCES, never);
    expect(j.kind).toBe("holds");
    expect(j.readable).toBe(2);
    expect(j.unreadable).toBe(1);
    expect(j.mismatch).toBeNull();
  });
  it("prefers the empty set, then the smallest deviation set that matches", () => {
    const a = pred(1000, { velocity: 0.5 });
    const b = pred(1000, { velocity: 0.8 });
    const read = [note(1000, { velocity: 0.8 })];
    const variants: Variant[] = [
      { deviations: new Set(), predicted: [a] },
      { deviations: new Set(["arpeggio-velocity-matrix"]), predicted: [b] },
      { deviations: new Set(["arpeggio-velocity-matrix", "arpeggio-drops-cent"]), predicted: [b] }
    ];
    const j = judgeRule(read, variants, TOLERANCES, never);
    expect(j.kind).toBe("deviation");
    expect(j.deviations).toEqual(["arpeggio-velocity-matrix"]);
    const empty = judgeRule([note(1000, { velocity: 0.5 })], variants, TOLERANCES, never);
    expect(empty.kind).toBe("holds");
    expect(empty.deviations).toEqual([]);
  });
  it("none of the variants matching is broken, carrying the empty set's first mismatch", () => {
    const variants: Variant[] = [
      intent([pred(1000, { velocity: 0.5 })]),
      { deviations: new Set(["arpeggio-drops-cent"]), predicted: [pred(1000, { velocity: 0.3 })] }
    ];
    const j = judgeRule([note(1000)], variants, TOLERANCES, never);
    expect(j.kind).toBe("broken");
    expect(j.mismatch).toMatchObject({ index: 0, field: "velocity", expected: 0.5, got: 0.8 });
  });
  it("a sounding render against a silent prediction is broken, naming the extra note", () => {
    const j = judgeRule([{ onsetMs: 2000, endMs: 2060, pitch: 60, cents: 0, velocity: 1, jitterCents: 0.1 }], [{ deviations: new Set(), predicted: [] }], TOLERANCES, never);
    expect(j.kind).toBe("broken");
    expect(j.mismatch?.field).toBe("extra");
    expect(j.mismatch?.got).toBe(2000);
  });
  it("a silent render against a silent prediction holds", () => {
    const j = judgeRule([], [intent([])], TOLERANCES, never);
    expect(j.kind).toBe("holds");
  });
  it("a fully unreadable prediction with sound is tracked (none), with silence is none too", () => {
    const predicted = [pred(1000, { readability: "too-short" })];
    expect(judgeRule([note(1000)], [intent(predicted)], TOLERANCES, never).kind).toBe("none");
    expect(judgeRule([], [intent(predicted)], TOLERANCES, never).kind).toBe("none");
  });
  it("a missing readable note is a count mismatch", () => {
    const j = judgeRule([note(1000)], [intent([pred(1000), pred(2000)])], TOLERANCES, never);
    expect(j.kind).toBe("broken");
    expect(j.mismatch).toMatchObject({ field: "count", expected: 2, got: 1 });
  });
  it.each([
    ["cents", { cents: 2.5 }, "cents"],
    ["velocity", { velocity: 0.811 }, "velocity"],
    ["onset", { onsetMs: 1001.2, endMs: 1101.2 }, "onset"],
    ["end", { endMs: 1102.5 }, "end"],
    ["pitch", { pitch: 61 }, "pitch"],
    ["unreadable pitch", { pitch: null, cents: null }, "pitch"]
  ] as const)("a %s out of tolerance breaks, naming the field", (_label, over, field) => {
    const j = judgeRule([note(1000, over)], [intent([pred(1000)])], TOLERANCES, never);
    expect(j.kind).toBe("broken");
    expect(j.mismatch?.field).toBe(field);
  });
  it("figures just inside every tolerance hold", () => {
    const j = judgeRule([note(1000.9, { cents: 1.9, velocity: 0.809, endMs: 1101.9 })], [intent([pred(1000)])], TOLERANCES, never);
    expect(j.kind).toBe("holds");
  });
  it("an unstable read note is dropped only inside a non-readable span; elsewhere it is judged", () => {
    const unstable = note(2000, { jitterCents: 40, pitch: null, cents: null });
    const silent = judgeRule([unstable], [intent([])], TOLERANCES, never);
    expect(silent.kind).toBe("broken");
    expect(silent.mismatch?.field).toBe("extra");
    const readable = judgeRule([unstable], [intent([pred(2000)])], TOLERANCES, never);
    expect(readable.kind).toBe("broken");
    expect(readable.mismatch?.field).toBe("pitch");
    expect(String(readable.mismatch?.got)).toContain("40");
    const covered = judgeRule([unstable], [intent([pred(1990, { readability: "overlap", endMs: 2100 })])], TOLERANCES, never);
    expect(covered.kind).toBe("none");
    expect(covered.unreadable).toBe(1);
  });
  it("abutting predicted notes are judged through readAt on pitch and velocity, never on onset; a wrong pitch there breaks", () => {
    const predicted = [pred(1000), pred(1100, { readability: "abutting", endMs: 1200, pitch: 64 })];
    const read = [note(1000, { endMs: 1100 }), note(1100)];
    const seen: Array<[number, number]> = [];
    const good = judgeRule(read, [intent(predicted)], TOLERANCES, (on, end) => { seen.push([on, end]); return note(5000, { pitch: 64, endMs: 9999 }); });
    expect(good.kind).toBe("holds");
    expect(seen).toEqual([[1100, 1200]]);
    const bad = judgeRule(read, [intent(predicted)], TOLERANCES, () => note(1100, { pitch: 65 }));
    expect(bad.kind).toBe("broken");
    expect(bad.mismatch).toMatchObject({ index: 1, field: "pitch", expected: 64, got: 65 });
    const unstable = judgeRule(read, [intent(predicted)], TOLERANCES, () => note(1100, { pitch: 64, jitterCents: 30 }));
    expect(unstable.mismatch?.field).toBe("pitch");
    expect(String(unstable.mismatch?.got)).toContain("30");
  });
});

describe("compareRegister", () => {
  const fig = { notes: [note(1000), note(2000)], unreadable: 1 };
  it("a missing register entry is unregistered", () => {
    expect(compareRegister(fig, undefined, TOLERANCES)).toEqual({ kind: "unregistered", mismatch: null });
  });
  it("equal within tolerance is as-registered", () => {
    const registered = { notes: [note(1000.5), note(1999.5, { cents: 1.5 })], unreadable: 1 };
    expect(compareRegister(fig, registered, TOLERANCES).kind).toBe("as-registered");
  });
  it("a different note count or unreadable count is changed", () => {
    const fewer = compareRegister(fig, { notes: [note(1000)], unreadable: 1 }, TOLERANCES);
    expect(fewer.kind).toBe("changed");
    expect(fewer.mismatch).toMatchObject({ field: "count", expected: 1, got: 2 });
    const unreadable = compareRegister(fig, { notes: fig.notes, unreadable: 0 }, TOLERANCES);
    expect(unreadable.kind).toBe("changed");
    expect(unreadable.mismatch).toMatchObject({ field: "count", expected: 0, got: 1 });
  });
  it.each([
    ["velocity", { velocity: 0.7 }, "velocity"],
    ["onset", { onsetMs: 2003 }, "onset"],
    ["cents", { cents: 5 }, "cents"],
    ["end", { endMs: 2110 }, "end"],
    ["pitch", { pitch: 62 }, "pitch"],
    ["null pitch against a number", { pitch: null, cents: null }, "pitch"]
  ] as const)("a %s out of tolerance is changed", (_label, over, field) => {
    const registered = { notes: [fig.notes[0]!, note(2000, over)], unreadable: 1 };
    const r = compareRegister(fig, registered, TOLERANCES);
    expect(r.kind).toBe("changed");
    expect(r.mismatch).toMatchObject({ index: 1, field });
  });
  it("a number against a registered null pitch is changed; two nulls agree", () => {
    const unreadable = { notes: [note(1000, { pitch: null, cents: null })], unreadable: 0 };
    expect(compareRegister({ notes: [note(1000)], unreadable: 0 }, unreadable, TOLERANCES).kind).toBe("changed");
    expect(compareRegister(unreadable, unreadable, TOLERANCES).kind).toBe("as-registered");
  });
});

describe("verdictOf", () => {
  const rule = (kind: RuleJudgement["kind"], deviations: RuleJudgement["deviations"] = []): RuleJudgement =>
    ({ kind, deviations, readable: 0, unreadable: 0, mismatch: null });
  it.each([
    [rule("holds"), "as-registered", "as-registered"],
    [rule("deviation", ["arpeggio-velocity-matrix"]), "as-registered", "as-registered, matches-known-deviation arpeggio-velocity-matrix"],
    [rule("broken"), "as-registered", "as-registered, rule broken"],
    [rule("holds"), "changed", "changed, rule holds"],
    [rule("deviation", ["arpeggio-velocity-matrix", "arpeggio-drops-cent"]), "changed", "changed, matches-known-deviation arpeggio-velocity-matrix+arpeggio-drops-cent"],
    [rule("broken"), "changed", "changed, rule broken"],
    [rule("holds"), "unregistered", "rule holds, unregistered"],
    [rule("deviation", ["zeitgeist-warps-note-off"]), "unregistered", "matches-known-deviation zeitgeist-warps-note-off, unregistered"],
    [rule("broken"), "unregistered", "rule broken, unregistered"],
    [rule("none"), "as-registered", "no rule"],
    [rule("none"), "changed", "no rule"]
  ] as const)("%j + %s", (judgement, register, expected) => {
    expect(verdictOf(judgement, register, null)).toBe(expected);
  });
  it("an error wins over everything", () => {
    expect(verdictOf(rule("holds"), "as-registered", "render threw")).toBe("error");
    expect(verdictOf(rule("none"), "unregistered", "render threw")).toBe("error");
  });
});

describe("describeMismatch", () => {
  const m = (field: Mismatch["field"], index: number, expected: number | string, got: number | string): Mismatch => ({ index, field, expected, got });
  it("formats each field", () => {
    expect(describeMismatch(m("velocity", 3, 0.9, 0.812))).toBe("note 3 velocity 0.812 expected 0.900");
    expect(describeMismatch(m("extra", 0, "none", 2037.5))).toBe("extra note at 2037.5 ms");
    expect(describeMismatch(m("count", 0, 8, 7))).toBe("count 7 expected 8");
    expect(describeMismatch(m("pitch", 1, 60, 62))).toBe("note 1 pitch 62 expected 60");
    expect(describeMismatch(m("pitch", 1, 60, "unreadable"))).toBe("note 1 pitch unreadable expected 60");
    expect(describeMismatch(m("cents", 2, -1, 4.25))).toBe("note 2 cents 4.3 expected -1.0");
    expect(describeMismatch(m("onset", 2, 1000, 1002.04))).toBe("note 2 onset 1002.0 ms expected 1000.0 ms");
    expect(describeMismatch(m("end", 2, 1100, 1104))).toBe("note 2 end 1104.0 ms expected 1100.0 ms");
  });
});
