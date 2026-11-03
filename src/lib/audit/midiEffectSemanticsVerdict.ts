/**
 * The two judgements of the MIDI effect semantics audit and the verdict they compose into: a rendered
 * row's read notes against the rule's predicted notes (the intent, then each known-deviation subset),
 * and against the register of the last accepted run. Pure functions of figures in milliseconds; no SDK
 * import, so the table script loads this file under Node.
 */
import type { NoteFigure } from "./midiEffectSemanticsReader";
import type { DeviationName, PredictedFigure } from "./midiEffectSemanticsRules";

export interface Tolerances { onsetMs: number; cents: number; velocity: number; endMs: number; unstableJitterCents: number }

// The same figures are documented in midiEffectSemanticsRows.ts (kept literal: that file imports the SDK).
export const TOLERANCES: Tolerances = { onsetMs: 1, cents: 2, velocity: 0.01, endMs: 2, unstableJitterCents: 10 };

export interface Variant { deviations: ReadonlySet<DeviationName>; predicted: PredictedFigure[] }

/** `index` is the note's place in its list; -1 on a `count` mismatch means the unreadable count. */
export interface Mismatch {
  index: number;
  field: "count" | "onset" | "pitch" | "cents" | "velocity" | "end" | "extra" | "missing";
  expected: number | string;
  got: number | string;
}

export interface RuleJudgement {
  kind: "holds" | "deviation" | "broken" | "none";
  deviations: DeviationName[];
  readable: number;
  unreadable: number;
  mismatch: Mismatch | null;
}

export type RegisterJudgement = "as-registered" | "changed" | "unregistered";
export interface RegisterRow { notes: NoteFigure[]; unreadable: number }

const SLACK = 1e-9;
const exceeds = (a: number, b: number, tolerance: number): boolean => Math.abs(a - b) > tolerance + SLACK;
const UNREADABLE = "unreadable";

interface Expected { onsetMs: number; endMs: number; pitch: number | null; cents: number | null; velocity: number }

const comparePitch = (index: number, expected: Expected, got: NoteFigure, tolerances: Tolerances): Mismatch | null => {
  if (expected.pitch === null || got.pitch === null) {
    return expected.pitch === got.pitch
      ? null
      : { index, field: "pitch", expected: expected.pitch ?? UNREADABLE, got: got.pitch ?? UNREADABLE };
  }
  const expectedCents = expected.pitch * 100 + (expected.cents ?? 0);
  const gotCents = got.pitch * 100 + (got.cents ?? 0);
  if (!exceeds(expectedCents, gotCents, tolerances.cents)) {return null;}
  return got.pitch !== expected.pitch
    ? { index, field: "pitch", expected: expected.pitch, got: got.pitch }
    : { index, field: "cents", expected: expected.cents ?? 0, got: got.cents ?? 0 };
};

const compareVelocity = (index: number, expected: Expected, got: NoteFigure, tolerances: Tolerances): Mismatch | null =>
  exceeds(expected.velocity, got.velocity, tolerances.velocity)
    ? { index, field: "velocity", expected: expected.velocity, got: got.velocity }
    : null;

const compareNote = (index: number, expected: Expected, got: NoteFigure, tolerances: Tolerances): Mismatch | null => {
  if (exceeds(expected.onsetMs, got.onsetMs, tolerances.onsetMs)) {
    return { index, field: "onset", expected: expected.onsetMs, got: got.onsetMs };
  }
  return comparePitch(index, expected, got, tolerances)
    ?? compareVelocity(index, expected, got, tolerances)
    ?? (exceeds(expected.endMs, got.endMs, tolerances.endMs)
      ? { index, field: "end", expected: expected.endMs, got: got.endMs }
      : null);
};

const byOnset = <T extends { onsetMs: number }>(list: readonly T[]): T[] => [...list].sort((a, b) => a.onsetMs - b.onsetMs);

interface VariantResult { mismatch: Mismatch | null; readable: number; unreadable: number }

const judgeVariant = (
  read: readonly NoteFigure[], variant: Variant, tolerances: Tolerances,
  readAt: (onsetMs: number, endMs: number) => NoteFigure
): VariantResult => {
  const spans = variant.predicted.filter(p => p.readability !== "readable");
  const kept = byOnset(read.filter(r =>
    !spans.some(s => r.onsetMs >= s.onsetMs - tolerances.onsetMs && r.onsetMs <= s.endMs + tolerances.onsetMs)));
  const result = (mismatch: Mismatch | null): VariantResult =>
    ({ mismatch, readable: kept.length, unreadable: read.length - kept.length });
  const readable = byOnset(variant.predicted.filter(p => p.readability === "readable"));
  if (readable.length === 0 && kept.length > 0) {
    return result({ index: 0, field: "extra", expected: "none", got: kept[0]!.onsetMs });
  }
  if (kept.length !== readable.length) {
    return result({ index: 0, field: "count", expected: readable.length, got: kept.length });
  }
  for (let i = 0; i < readable.length; i++) {
    const got = kept[i]!;
    const unstable = got.jitterCents !== null && got.jitterCents > tolerances.unstableJitterCents;
    const onsetOff = exceeds(readable[i]!.onsetMs, got.onsetMs, tolerances.onsetMs);
    const mismatch = unstable && !onsetOff
      ? { index: i, field: "pitch" as const, expected: readable[i]!.pitch, got: `unstable, jitter ${got.jitterCents!.toFixed(1)} cents` }
      : compareNote(i, readable[i]!, got, tolerances);
    if (mismatch !== null) {return result(mismatch);}
  }
  const abutting = variant.predicted.filter(p => p.readability === "abutting");
  for (const p of abutting) {
    const index = variant.predicted.indexOf(p);
    const got = readAt(p.onsetMs, p.endMs);
    if (got.jitterCents !== null && got.jitterCents > tolerances.unstableJitterCents) {
      return result({ index, field: "pitch", expected: p.pitch, got: `unstable, jitter ${got.jitterCents.toFixed(1)} cents` });
    }
    const mismatch = comparePitch(index, p, got, tolerances) ?? compareVelocity(index, p, got, tolerances);
    if (mismatch !== null) {return result(mismatch);}
  }
  return result(null);
};

export function judgeRule(
  read: readonly NoteFigure[], variants: readonly Variant[], tolerances: Tolerances,
  readAt: (onsetMs: number, endMs: number) => NoteFigure
): RuleJudgement {
  const judgeable = (v: Variant): boolean => v.predicted.some(p => p.readability === "readable" || p.readability === "abutting");
  if (variants.length === 0 || variants.every(v => v.predicted.length > 0 && !judgeable(v))) {
    return { kind: "none", deviations: [], readable: 0, unreadable: read.length, mismatch: null };
  }
  let intentResult: VariantResult | null = null;
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i]!;
    const result = judgeVariant(read, variant, tolerances, readAt);
    if (i === 0) {intentResult = result;}
    if (result.mismatch === null) {
      const deviations = [...variant.deviations];
      return {
        kind: deviations.length === 0 ? "holds" : "deviation", deviations,
        readable: result.readable, unreadable: result.unreadable, mismatch: null
      };
    }
  }
  const first = intentResult!;
  return { kind: "broken", deviations: [], readable: first.readable, unreadable: first.unreadable, mismatch: first.mismatch };
}

export function compareRegister(
  figure: RegisterRow, registered: RegisterRow | undefined, tolerances: Tolerances
): { kind: RegisterJudgement; mismatch: Mismatch | null } {
  if (registered === undefined) {return { kind: "unregistered", mismatch: null };}
  const changed = (mismatch: Mismatch) => ({ kind: "changed" as const, mismatch });
  if (figure.notes.length !== registered.notes.length) {
    return changed({ index: 0, field: "count", expected: registered.notes.length, got: figure.notes.length });
  }
  if (figure.unreadable !== registered.unreadable) {
    return changed({ index: -1, field: "count", expected: registered.unreadable, got: figure.unreadable });
  }
  for (let i = 0; i < figure.notes.length; i++) {
    const mismatch = compareNote(i, registered.notes[i]!, figure.notes[i]!, tolerances);
    if (mismatch !== null) {return changed(mismatch);}
  }
  return { kind: "as-registered", mismatch: null };
}

export function verdictOf(rule: RuleJudgement, register: RegisterJudgement, error: string | null): string {
  if (error !== null) {return "error";}
  if (rule.kind === "none") {return "no rule";}
  const body = rule.kind === "holds" ? "rule holds"
    : rule.kind === "deviation" ? `matches-known-deviation ${rule.deviations.join("+")}`
    : "rule broken";
  if (register === "unregistered") {return `${body}, unregistered`;}
  if (register === "changed") {return `changed, ${body}`;}
  return rule.kind === "holds" ? "as-registered" : `as-registered, ${body}`;
}

const num = (value: number | string, digits: number): string => typeof value === "number" ? value.toFixed(digits) : value;

export function describeMismatch(m: Mismatch): string {
  switch (m.field) {
    case "count": return m.index === -1
      ? `unreadable ${num(m.got, 0)} expected ${num(m.expected, 0)}`
      : `count ${num(m.got, 0)} expected ${num(m.expected, 0)}`;
    case "extra": return `extra note at ${num(m.got, 1)} ms`;
    case "missing": return `missing note ${m.index} at ${num(m.expected, 1)} ms`;
    case "velocity": return `note ${m.index} velocity ${num(m.got, 3)} expected ${num(m.expected, 3)}`;
    case "pitch": return `note ${m.index} pitch ${num(m.got, 0)} expected ${num(m.expected, 0)}`;
    case "cents": return `note ${m.index} cents ${num(m.got, 1)} expected ${num(m.expected, 1)}`;
    case "onset": return `note ${m.index} onset ${num(m.got, 1)} ms expected ${num(m.expected, 1)} ms`;
    case "end": return `note ${m.index} end ${num(m.got, 1)} ms expected ${num(m.expected, 1)} ms`;
  }
}
