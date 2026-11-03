/**
 * The two judgements of the MIDI effect semantics audit and the verdict they compose into: a rendered
 * row's read notes against the rule's predicted notes (the intent, then each known-deviation subset),
 * and against the register of the last accepted run. Pure functions of figures in milliseconds; no SDK
 * import, so the table script loads this file under Node.
 */
import type { NoteFigure } from "./midiEffectSemanticsReader";
import type { DeviationName, PredictedFigure } from "./midiEffectSemanticsRules";

export interface Tolerances { onsetMs: number; cents: number; velocity: number; endMs: number; unstableJitterCents: number }

/** The audit's only copy of the tolerances; `unstableJitterCents`: a pitch track that wanders more than this over a note is a tone the reader cannot name, not a pitch. */
export const TOLERANCES: Tolerances = { onsetMs: 1, cents: 2, velocity: 0.01, endMs: 2, unstableJitterCents: 10 };

export interface Variant { deviations: ReadonlySet<DeviationName>; predicted: PredictedFigure[] }

/**
 * `list` names the list `index` counts in: `read` the row's read notes (a readable note or an extra one), `predicted` the
 * intent's predicted notes (an abutting note), `register` the registered notes. -1 on a `count` mismatch means the
 * unreadable count; on any other `count` the index means nothing.
 */
export interface Mismatch {
  list: "read" | "predicted" | "register";
  index: number;
  field: "count" | "onset" | "pitch" | "cents" | "velocity" | "end" | "extra";
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
/** Written as "not inside" so a NaN on either side exceeds: a figure that is not a number never matches. */
const exceeds = (a: number, b: number, tolerance: number): boolean => !(Math.abs(a - b) <= tolerance + SLACK);
const UNREADABLE = "unreadable";

interface Expected { onsetMs: number; endMs: number; pitch: number | null; cents: number | null; velocity: number }

type At = Pick<Mismatch, "list" | "index">;

const comparePitch = (at: At, expected: Expected, got: NoteFigure, tolerances: Tolerances): Mismatch | null => {
  if (expected.pitch === null || got.pitch === null) {
    return expected.pitch === got.pitch
      ? null
      : { ...at, field: "pitch", expected: expected.pitch ?? UNREADABLE, got: got.pitch ?? UNREADABLE };
  }
  const expectedCents = expected.pitch * 100 + (expected.cents ?? 0);
  const gotCents = got.pitch * 100 + (got.cents ?? 0);
  if (!exceeds(expectedCents, gotCents, tolerances.cents)) {return null;}
  const errorCents = Math.abs(expectedCents - gotCents);
  return Math.abs(got.pitch - expected.pitch) >= 2 || (got.pitch !== expected.pitch && errorCents >= 100)
    ? { ...at, field: "pitch", expected: expected.pitch, got: got.pitch }
    : { ...at, field: "cents", expected: expected.cents ?? 0, got: gotCents - expected.pitch * 100 };
};

const compareVelocity = (at: At, expected: Expected, got: NoteFigure, tolerances: Tolerances): Mismatch | null =>
  exceeds(expected.velocity, got.velocity, tolerances.velocity)
    ? { ...at, field: "velocity", expected: expected.velocity, got: got.velocity }
    : null;

const compareNote = (at: At, expected: Expected, got: NoteFigure, tolerances: Tolerances): Mismatch | null => {
  if (exceeds(expected.onsetMs, got.onsetMs, tolerances.onsetMs)) {
    return { ...at, field: "onset", expected: expected.onsetMs, got: got.onsetMs };
  }
  return comparePitch(at, expected, got, tolerances)
    ?? compareVelocity(at, expected, got, tolerances)
    ?? (exceeds(expected.endMs, got.endMs, tolerances.endMs)
      ? { ...at, field: "end", expected: expected.endMs, got: got.endMs }
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
  // `kept` holds the read list's own objects, so a kept note's place in `read` is found by identity
  const inRead = (note: NoteFigure): At => ({ list: "read", index: read.indexOf(note) });
  if (readable.length === 0 && kept.length > 0) {
    return result({ ...inRead(kept[0]!), field: "extra", expected: "none", got: kept[0]!.onsetMs });
  }
  if (kept.length !== readable.length) {
    return result({ list: "read", index: 0, field: "count", expected: readable.length, got: kept.length });
  }
  for (let i = 0; i < readable.length; i++) {
    const got = kept[i]!;
    const at = inRead(got);
    const unstable = got.jitterCents !== null && got.jitterCents > tolerances.unstableJitterCents;
    const onsetOff = exceeds(readable[i]!.onsetMs, got.onsetMs, tolerances.onsetMs);
    const mismatch = unstable && !onsetOff
      ? { ...at, field: "pitch" as const, expected: readable[i]!.pitch, got: `unstable, jitter ${got.jitterCents!.toFixed(1)} cents` }
      : compareNote(at, readable[i]!, got, tolerances);
    if (mismatch !== null) {return result(mismatch);}
  }
  const abutting = variant.predicted.filter(p => p.readability === "abutting");
  for (const p of abutting) {
    const at: At = { list: "predicted", index: variant.predicted.indexOf(p) };
    const got = readAt(p.onsetMs, p.endMs);
    if (got.jitterCents !== null && got.jitterCents > tolerances.unstableJitterCents) {
      return result({ ...at, field: "pitch", expected: p.pitch, got: `unstable, jitter ${got.jitterCents.toFixed(1)} cents` });
    }
    const mismatch = comparePitch(at, p, got, tolerances) ?? compareVelocity(at, p, got, tolerances);
    if (mismatch !== null) {return result(mismatch);}
  }
  return result(null);
};

/** The variant with no deviation; the caller always passes it, so a list without one is a caller's error, never a guess. */
const intentIndexOf = (variants: readonly Variant[], caller: string): number => {
  const index = variants.findIndex(v => v.deviations.size === 0);
  if (index < 0) {throw new Error(`${caller}: no intent variant`);}
  return index;
};

/** `read` must be the row's read notes in onset order (a mismatch's `read` index counts in it). Throws when `variants` is not empty and holds no intent. */
export function judgeRule(
  read: readonly NoteFigure[], variants: readonly Variant[], tolerances: Tolerances,
  readAt: (onsetMs: number, endMs: number) => NoteFigure
): RuleJudgement {
  const judgeable = (v: Variant): boolean => v.predicted.some(p => p.readability === "readable" || p.readability === "abutting");
  if (variants.length === 0) {return { kind: "none", deviations: [], readable: 0, unreadable: read.length, mismatch: null };}
  const intentIndex = intentIndexOf(variants, "judgeRule");
  if (variants.every(v => v.predicted.length > 0 && !judgeable(v))) {
    // Nothing to judge, but a read note outside every predicted span of every variant is still an extra note.
    const results = variants.map(v => judgeVariant(read, v, tolerances, readAt));
    if (results.some(r => r.mismatch === null)) {return { kind: "none", deviations: [], readable: 0, unreadable: read.length, mismatch: null };}
    const intent = results[intentIndex]!;
    return { kind: "broken", deviations: [], readable: intent.readable, unreadable: intent.unreadable, mismatch: intent.mismatch };
  }
  let intentResult: VariantResult | null = null;
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i]!;
    const result = judgeVariant(read, variant, tolerances, readAt);
    if (i === intentIndex) {intentResult = result;}
    if (result.mismatch === null) {
      const deviations = [...variant.deviations];
      return {
        kind: deviations.length === 0 ? "holds" : "deviation", deviations,
        readable: result.readable, unreadable: result.unreadable, mismatch: null
      };
    }
  }
  const first = intentResult ?? judgeVariant(read, variants[intentIndex]!, tolerances, readAt);
  return { kind: "broken", deviations: [], readable: first.readable, unreadable: first.unreadable, mismatch: first.mismatch };
}

export function compareRegister(
  figure: RegisterRow, registered: RegisterRow | undefined, tolerances: Tolerances
): { kind: RegisterJudgement; mismatch: Mismatch | null } {
  if (registered === undefined) {return { kind: "unregistered", mismatch: null };}
  const changed = (mismatch: Mismatch) => ({ kind: "changed" as const, mismatch });
  if (figure.notes.length !== registered.notes.length) {
    return changed({ list: "register", index: 0, field: "count", expected: registered.notes.length, got: figure.notes.length });
  }
  if (figure.unreadable !== registered.unreadable) {
    return changed({ list: "register", index: -1, field: "count", expected: registered.unreadable, got: figure.unreadable });
  }
  for (let i = 0; i < figure.notes.length; i++) {
    const mismatch = compareNote({ list: "register", index: i }, registered.notes[i]!, figure.notes[i]!, tolerances);
    if (mismatch !== null) {return changed(mismatch);}
  }
  return { kind: "as-registered", mismatch: null };
}

export function verdictOf(rule: RuleJudgement, register: RegisterJudgement, error: string | null): string {
  if (error !== null) {return "error";}
  if (rule.kind === "none") {
    return register === "changed" ? "changed, no rule" : register === "unregistered" ? "no rule, unregistered" : "no rule";
  }
  const body = rule.kind === "holds" ? "rule holds"
    : rule.kind === "deviation" ? `matches-known-deviation ${rule.deviations.join("+")}`
    : "rule broken";
  if (register === "unregistered") {return `${body}, unregistered`;}
  if (register === "changed") {return `changed, ${body}`;}
  return rule.kind === "holds" ? "as-registered" : `as-registered, ${body}`;
}

/**
 * The spec's `error` for a render that is silent where the rule predicts sound: `peak` is the rendered channel's largest
 * `|x|`, `variants` the intent and each known-deviation subset as judged. Null unless the peak is 0 and EVERY variant
 * predicts a readable or abutting note: a silence one variant predicts (the Arpeggio at -100 %, silent under the crate's
 * velocity matrix where the manual sounds) is a judgement, not a failed render. The message counts the intent's notes.
 * Throws when `variants` is not empty and holds no intent.
 */
export function silentRenderError(peak: number, variants: readonly Variant[]): string | null {
  const sounding = (v: Variant): number => v.predicted.filter(p => p.readability === "readable" || p.readability === "abutting").length;
  if (variants.length === 0) {return null;}
  const intent = variants[intentIndexOf(variants, "silentRenderError")]!;
  if (peak !== 0 || variants.some(v => sounding(v) === 0)) {return null;}
  const count = sounding(intent);
  return `render is silent (peak 0) where the rule predicts ${count} note${count === 1 ? "" : "s"}`;
}

const num = (value: number | string, digits: number): string => typeof value === "number" ? value.toFixed(digits) : value;

export function describeMismatch(m: Mismatch): string {
  switch (m.field) {
    case "count": return m.index === -1
      ? `unreadable ${num(m.got, 0)} expected ${num(m.expected, 0)}`
      : `count ${num(m.got, 0)} expected ${num(m.expected, 0)}`;
    case "extra": return `extra note at ${num(m.got, 1)} ms`;
    case "velocity": return `${m.list} note ${m.index} velocity ${num(m.got, 3)} expected ${num(m.expected, 3)}`;
    case "pitch": return `${m.list} note ${m.index} pitch ${num(m.got, 0)} expected ${num(m.expected, 0)}`;
    case "cents": return `${m.list} note ${m.index} cents ${num(m.got, 1)} expected ${num(m.expected, 1)}`;
    case "onset": return `${m.list} note ${m.index} onset ${num(m.got, 1)} ms expected ${num(m.expected, 1)} ms`;
    case "end": return `${m.list} note ${m.index} end ${num(m.got, 1)} ms expected ${num(m.expected, 1)} ms`;
  }
}
