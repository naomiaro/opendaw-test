import { describe, expect, it } from "vitest";
import type { NoteFigure } from "./midiEffectSemanticsReader";
import type { PredictedFigure } from "./midiEffectSemanticsRules";
import {
  compareRegister, describeMismatch, judgeRule, silentRenderError, TOLERANCES, verdictColor, verdictOf,
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
      { deviations: new Set(["arpeggio-uncapped-note-off"]), predicted: [b] },
      { deviations: new Set(["arpeggio-uncapped-note-off", "arpeggio-drops-cent"]), predicted: [b] }
    ];
    const j = judgeRule(read, variants, TOLERANCES, never);
    expect(j.kind).toBe("deviation");
    expect(j.deviations).toEqual(["arpeggio-uncapped-note-off"]);
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
  it("broken carries the empty set's mismatch even when that variant is not first", () => {
    const variants: Variant[] = [
      { deviations: new Set(["arpeggio-drops-cent"]), predicted: [pred(1000, { velocity: 0.3 })] },
      intent([pred(1000, { velocity: 0.5 })])
    ];
    const j = judgeRule([note(1000)], variants, TOLERANCES, never);
    expect(j.kind).toBe("broken");
    expect(j.mismatch).toMatchObject({ field: "velocity", expected: 0.5 });
  });
  it("a neighbouring pitch under 100 cents off is a cents mismatch; two semitones off is pitch", () => {
    const near = judgeRule([note(1000, { pitch: 60, cents: 49 })], [intent([pred(1000, { pitch: 61, cents: -47 })])], TOLERANCES, never);
    expect(near.mismatch).toMatchObject({ field: "cents", expected: -47, got: -51 });
    const far = judgeRule([note(1000, { pitch: 60, cents: 0 })], [intent([pred(1000, { pitch: 62, cents: 0 })])], TOLERANCES, never);
    expect(far.mismatch).toMatchObject({ field: "pitch", expected: 62, got: 60 });
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
  it("a no-rule prediction still catches a read note outside every predicted span: broken, extra", () => {
    const predicted = [pred(1000, { readability: "overlap", endMs: 1500 }), pred(1200, { readability: "overlap", endMs: 1500 })];
    const inside = judgeRule([note(1001)], [intent(predicted)], TOLERANCES, never);
    expect(inside.kind).toBe("none");
    const j = judgeRule([note(1001), note(5000)], [intent(predicted)], TOLERANCES, never);
    expect(j.kind).toBe("broken");
    expect(j.mismatch).toMatchObject({ field: "extra", got: 5000 });
    expect(j.unreadable).toBe(1);
  });
  it("a no-rule row is none when any variant's spans cover every read note, broken when none does", () => {
    const covering: Variant[] = [
      intent([pred(1000, { readability: "too-short", endMs: 1010 })]),
      { deviations: new Set(["arpeggio-uncapped-note-off"]), predicted: [pred(1000, { readability: "too-short", endMs: 1010 }), pred(3000, { readability: "too-short", endMs: 3010 })] }
    ];
    expect(judgeRule([note(1000), note(3000)], covering, TOLERANCES, never).kind).toBe("none");
    expect(judgeRule([note(1000), note(4000)], covering, TOLERANCES, never)).toMatchObject({ kind: "broken", mismatch: { field: "extra", got: 4000 } });
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
  it("a NaN read figure breaks: a tolerance comparison against NaN is never inside it", () => {
    expect(judgeRule([note(1000, { velocity: Number.NaN })], [intent([pred(1000)])], TOLERANCES, never)).toMatchObject({ kind: "broken", mismatch: { field: "velocity" } });
    expect(judgeRule([note(Number.NaN, { endMs: 1100 })], [intent([pred(1000)])], TOLERANCES, never)).toMatchObject({ kind: "broken", mismatch: { field: "onset" } });
    expect(judgeRule([note(1000, { cents: Number.NaN })], [intent([pred(1000)])], TOLERANCES, never)).toMatchObject({ kind: "broken", mismatch: { field: "cents" } });
  });
  it("a readable-note mismatch indexes the read list, counting the notes dropped inside unreadable spans", () => {
    const predicted = [pred(1000), pred(1200, { readability: "overlap", endMs: 1500 }), pred(2000)];
    const read = [note(1000), note(1300, { pitch: 72 }), note(2000, { velocity: 0.5 })];
    const j = judgeRule(read, [intent(predicted)], TOLERANCES, never);
    expect(j.mismatch).toEqual({ list: "read", index: 2, field: "velocity", expected: 0.8, got: 0.5 });
  });
  it("a velocity off on an abutting note breaks, indexing the predicted list", () => {
    const predicted = [pred(1000), pred(1100, { readability: "abutting", endMs: 1200, pitch: 64, velocity: 0.6 })];
    const read = [note(1000, { endMs: 1100 }), note(1100)];
    const j = judgeRule(read, [intent(predicted)], TOLERANCES, () => note(1100, { pitch: 64, velocity: 0.65 }));
    expect(j.kind).toBe("broken");
    expect(j.mismatch).toEqual({ list: "predicted", index: 1, field: "velocity", expected: 0.6, got: 0.65 });
  });
  it("an unstable read note at the wrong onset is an onset mismatch, not an unstable pitch", () => {
    const j = judgeRule([note(1005, { jitterCents: 40, pitch: null, cents: null })], [intent([pred(1000)])], TOLERANCES, never);
    expect(j.kind).toBe("broken");
    expect(j.mismatch).toMatchObject({ field: "onset", expected: 1000, got: 1005 });
  });
  it("an intent with nothing readable that reports an extra note gives way to a judgeable deviation that matches", () => {
    const variants: Variant[] = [
      intent([pred(1000, { readability: "too-short", endMs: 1010 })]),
      { deviations: new Set(["arpeggio-uncapped-note-off"]), predicted: [pred(1000, { readability: "too-short", endMs: 1010 }), pred(3000)] }
    ];
    const j = judgeRule([note(1000), note(3000)], variants, TOLERANCES, never);
    expect(j.kind).toBe("deviation");
    expect(j.deviations).toEqual(["arpeggio-uncapped-note-off"]);
    // the intent alone reports the extra note
    expect(judgeRule([note(1000), note(3000)], [variants[0]!], TOLERANCES, never)).toMatchObject({ kind: "broken", mismatch: { field: "extra", got: 3000 } });
  });
  it("throws when no variant has an empty deviation set: the intent is never guessed", () => {
    const deviationOnly: Variant[] = [{ deviations: new Set(["arpeggio-drops-cent"]), predicted: [pred(1000)] }];
    expect(() => judgeRule([note(1000)], deviationOnly, TOLERANCES, never)).toThrow("judgeRule: no intent variant");
    const unjudgeable: Variant[] = [{ deviations: new Set(["arpeggio-drops-cent"]), predicted: [pred(1000, { readability: "overlap" })] }];
    expect(() => judgeRule([note(1000)], unjudgeable, TOLERANCES, never)).toThrow("judgeRule: no intent variant");
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
    expect(r.mismatch).toMatchObject({ list: "register", index: 1, field });
  });
  it("a NaN figure is changed, never as-registered", () => {
    const registered = { notes: [note(1000), note(2000)], unreadable: 1 };
    expect(compareRegister({ notes: [note(1000), note(Number.NaN)], unreadable: 1 }, registered, TOLERANCES).kind).toBe("changed");
    expect(compareRegister({ notes: [note(1000), note(2000, { velocity: Number.NaN })], unreadable: 1 }, registered, TOLERANCES).kind).toBe("changed");
  });
  it("an unreadable count that moved is a register mismatch at index -1", () => {
    expect(compareRegister(fig, { notes: fig.notes, unreadable: 0 }, TOLERANCES).mismatch).toEqual({ list: "register", index: -1, field: "count", expected: 0, got: 1 });
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
    [rule("deviation", ["arpeggio-uncapped-note-off"]), "as-registered", "as-registered, matches-known-deviation arpeggio-uncapped-note-off"],
    [rule("broken"), "as-registered", "as-registered, rule broken"],
    [rule("holds"), "changed", "changed, rule holds"],
    [rule("deviation", ["arpeggio-uncapped-note-off", "arpeggio-drops-cent"]), "changed", "changed, matches-known-deviation arpeggio-uncapped-note-off+arpeggio-drops-cent"],
    [rule("broken"), "changed", "changed, rule broken"],
    [rule("holds"), "unregistered", "rule holds, unregistered"],
    [rule("deviation", ["arpeggio-drops-cent"]), "unregistered", "matches-known-deviation arpeggio-drops-cent, unregistered"],
    [rule("broken"), "unregistered", "rule broken, unregistered"],
    [rule("none"), "as-registered", "no rule"],
    [rule("none"), "changed", "changed, no rule"],
    [rule("none"), "unregistered", "no rule, unregistered"]
  ] as const)("%j + %s", (judgement, register, expected) => {
    expect(verdictOf(judgement, register, null)).toBe(expected);
  });
  it("an error wins over everything", () => {
    expect(verdictOf(rule("holds"), "as-registered", "render threw")).toBe("error");
    expect(verdictOf(rule("none"), "unregistered", "render threw")).toBe("error");
  });
});

describe("silentRenderError", () => {
  it("a silent render where the rule predicts readable or abutting notes is an error naming the intent's count", () => {
    const predicted = [pred(1000), pred(1100, { readability: "abutting" }), pred(1200, { readability: "too-short" })];
    expect(silentRenderError(0, [intent(predicted)])).toBe("render is silent (peak 0) where the rule predicts 2 notes");
    expect(silentRenderError(0, [intent([pred(1000)])])).toBe("render is silent (peak 0) where the rule predicts 1 note");
    const bothSound: Variant[] = [intent([pred(1000)]), { deviations: new Set(["arpeggio-uncapped-note-off"]), predicted: [pred(1000), pred(2000)] }];
    expect(silentRenderError(0, bothSound)).toBe("render is silent (peak 0) where the rule predicts 1 note");
  });
  it("is null when the render sounds or the rule predicts nothing judgeable", () => {
    expect(silentRenderError(0.7, [intent([pred(1000)])])).toBeNull();
    expect(silentRenderError(0, [intent([])])).toBeNull();
    expect(silentRenderError(0, [intent([pred(1000, { readability: "overlap" })])])).toBeNull();
    expect(silentRenderError(0, [])).toBeNull();
  });
  it("throws when no variant has an empty deviation set", () => {
    expect(() => silentRenderError(0, [{ deviations: new Set(["arpeggio-drops-cent"]), predicted: [pred(1000)] }])).toThrow("silentRenderError: no intent variant");
  });
  it("is null when a known deviation predicts the silence", () => {
    const variants: Variant[] = [intent([pred(1000)]), { deviations: new Set(["arpeggio-uncapped-note-off"]), predicted: [] }];
    expect(silentRenderError(0, variants)).toBeNull();
  });
});

describe("describeMismatch", () => {
  const m = (field: Mismatch["field"], index: number, expected: number | string, got: number | string, list: Mismatch["list"] = "read"): Mismatch =>
    ({ list, index, field, expected, got });
  it("formats each field, naming the list the index counts in", () => {
    expect(describeMismatch(m("velocity", 3, 0.9, 0.812))).toBe("read note 3 velocity 0.812 expected 0.900");
    expect(describeMismatch(m("velocity", 7, 0.9, 0.812, "predicted"))).toBe("predicted note 7 velocity 0.812 expected 0.900");
    expect(describeMismatch(m("onset", 1, 1000, 1003, "register"))).toBe("register note 1 onset 1003.0 ms expected 1000.0 ms");
    expect(describeMismatch(m("extra", 0, "none", 2037.5))).toBe("extra note at 2037.5 ms");
    expect(describeMismatch(m("count", 0, 8, 7))).toBe("count 7 expected 8");
    expect(describeMismatch(m("pitch", 1, 60, 62))).toBe("read note 1 pitch 62 expected 60");
    expect(describeMismatch(m("pitch", 1, 60, "unreadable"))).toBe("read note 1 pitch unreadable expected 60");
    expect(describeMismatch(m("cents", 2, -1, 4.25))).toBe("read note 2 cents 4.3 expected -1.0");
    expect(describeMismatch(m("onset", 2, 1000, 1002.04))).toBe("read note 2 onset 1002.0 ms expected 1000.0 ms");
    expect(describeMismatch(m("end", 2, 1100, 1104))).toBe("read note 2 end 1104.0 ms expected 1100.0 ms");
  });
  it("an index of -1 on a count is the unreadable count", () => {
    expect(describeMismatch(m("count", -1, 0, 2, "register"))).toBe("unreadable 2 expected 0");
  });
});

describe("verdictColor", () => {
  it.each([
    ["as-registered", "green"],
    ["as-registered, matches-known-deviation arpeggio-uncapped-note-off", "amber"],
    ["rule holds, unregistered", "amber"],
    ["no rule, unregistered", "amber"],
    ["changed, rule holds", "amber"],
    ["as-registered, rule broken", "red"],
    ["error", "red"],
  ] as const)("%s is %s: only a row that holds as registered is green", (verdict, color) => {
    expect(verdictColor(verdict)).toBe(color);
  });
});
