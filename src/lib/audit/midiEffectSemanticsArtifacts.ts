/**
 * What a run of the MIDI effect semantics audit persists: one record per row and one summary per
 * run, uploaded to the dev server's `/__verify` sink as `midisem-summary-<runToken>.json`, and the
 * JSON register a person accepts (`debug/2026-11-03-midi-effect-semantics/register/<rate>.json`).
 * The table script loads this file under Node, so the reader, rules and rows modules come in as
 * types only; the one value import is the SDK-free verdict module.
 */
import type { NoteFigure } from "./midiEffectSemanticsReader";
import type { DeviationName, DeviceSetting, PredictedFigure, QuestionName } from "./midiEffectSemanticsRules";
import type { RowGroup } from "./midiEffectSemanticsRows";
import { compareRegister, TOLERANCES } from "./midiEffectSemanticsVerdict.ts";
import type { RegisterJudgement, RuleJudgement } from "./midiEffectSemanticsVerdict";

/** 1: the first runs. */
export const MIDI_SEMANTICS_SCHEMA_VERSION = 1;

export const SUMMARY_NAME = /^midisem-summary-(\d+)\.json$/;

export function summaryFileName(runToken: number): string {
  return `midisem-summary-${runToken}.json`;
}

export interface SemanticsRowRecord {
  id: string;
  label: string;
  group: RowGroup;
  pattern: string;
  chain: { setting: DeviceSetting; enabled: boolean }[];
  predicted: PredictedFigure[];
  ruleSentence: string;
  read: NoteFigure[];
  unreadable: number;
  rule: RuleJudgement["kind"];
  deviations: DeviationName[];
  questions: QuestionName[];
  register: RegisterJudgement;
  verdict: string;
  /** The mismatch figure or the error message; null when the row holds as registered. */
  figure: string | null;
  error: string | null;
  renderMs: number;
}

export interface SemanticsSummary {
  schemaVersion: number;
  runToken: number;
  userAgent: string;
  sdkVersion: string;
  sampleRate: number;
  bpm: number;
  rowsParam: string;
  deviceParam: string;
  patternParam: string;
  registerSource: string | null;
  registerSdkVersion: string | null;
  calibration: { referencePeak: number; instrumentOffsetFrames: number; onsetThreshold: number; attackMs: number; gapMs: number };
  rows: SemanticsRowRecord[];
}

export function parseSemanticsSummary(json: unknown, runToken: number): SemanticsSummary {
  if (typeof json !== "object" || json === null) {throw new Error(`summary ${runToken}: not an object`);}
  const summary = json as Record<string, unknown>;
  if (summary.schemaVersion !== MIDI_SEMANTICS_SCHEMA_VERSION) {
    throw new Error(`summary ${runToken}: schemaVersion ${String(summary.schemaVersion)}, readable: ${MIDI_SEMANTICS_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(summary.rows)) {throw new Error(`summary ${runToken}: rows is not an array`);}
  summary.rows.forEach((row: Record<string, unknown> | null, i: number) => {
    if (typeof row !== "object" || row === null) {throw new Error(`summary ${runToken}: row ${i} is not an object`);}
    if (!Array.isArray(row.read)) {throw new Error(`summary ${runToken}: row ${i} read is not an array`);}
    if (typeof row.verdict !== "string") {throw new Error(`summary ${runToken}: row ${i} verdict is ${typeof row.verdict}, not a string`);}
  });
  return summary as unknown as SemanticsSummary;
}

const tenth = (value: number): number => Number(value.toFixed(1));
const tenthOrNull = (value: number | null): number | null => value === null ? null : tenth(value);
const halfPercent = (value: number): number => Number((Math.round(value / 0.005) * 0.005).toFixed(3));

/** The register's resolution: onset and end 0.1 ms, cents 0.1, velocity 0.005. */
export function roundFigure(note: NoteFigure): NoteFigure {
  return {
    onsetMs: tenth(note.onsetMs),
    endMs: tenth(note.endMs),
    pitch: note.pitch,
    cents: tenthOrNull(note.cents),
    velocity: halfPercent(note.velocity),
    jitterCents: tenthOrNull(note.jitterCents)
  };
}

export interface SemanticsRegister {
  schemaVersion: 1;
  sdkVersion: string;
  acceptedRunToken: number;
  acceptedAt: string;
  sampleRate: number;
  bpm: number;
  rows: Record<string, { notes: NoteFigure[]; unreadable: number }>;
}

export function parseSemanticsRegister(json: unknown): SemanticsRegister {
  if (typeof json !== "object" || json === null) {throw new Error("register: not an object");}
  const register = json as Record<string, unknown>;
  if (register.schemaVersion !== 1) {throw new Error(`register: schemaVersion ${String(register.schemaVersion)}, readable: 1`);}
  const rows = register.rows;
  if (typeof rows !== "object" || rows === null || Array.isArray(rows)) {throw new Error("register: rows is not an object");}
  for (const [id, row] of Object.entries(rows as Record<string, Record<string, unknown> | null>)) {
    if (typeof row !== "object" || row === null) {throw new Error(`register: row ${id} is not an object`);}
    if (!Array.isArray(row.notes)) {throw new Error(`register: row ${id} notes is not an array`);}
    if (typeof row.unreadable !== "number") {throw new Error(`register: row ${id} unreadable is ${typeof row.unreadable}, not a number`);}
  }
  return register as unknown as SemanticsRegister;
}

/** The row filters of a run that are not `all`, as `name=value`; empty for a full run. */
export function partialParams(summary: SemanticsSummary): string[] {
  return ([["rows", summary.rowsParam], ["device", summary.deviceParam], ["pattern", summary.patternParam]] as const)
    .filter(([, value]) => value !== "all")
    .map(([name, value]) => `${name}=${value}`);
}

/**
 * The register a run makes. A full run replaces `previous`. A partial run (a row filter not `all`) would drop every row it
 * did not render, so it is refused without force; forced, its rows are merged into `previous`'s, the rows it did not cover
 * kept as they were. A run with a broken or errored row is refused without force too.
 */
export function registerFromSummary(
  summary: SemanticsSummary, options: { force: boolean; acceptedAt: string; previous?: SemanticsRegister | null }
): SemanticsRegister {
  const partial = partialParams(summary);
  if (partial.length > 0 && !options.force) {
    throw new Error(`run ${summary.runToken} is partial (${partial.join(", ")}), not accepted without force: forced, it merges into the previous register`);
  }
  const refused = summary.rows.filter(row => row.error !== null || row.rule === "broken").map(row => row.id);
  if (refused.length > 0 && !options.force) {
    throw new Error(`run ${summary.runToken} has ${refused.length} row(s) in error or broken, not accepted without force: ${refused.join(", ")}`);
  }
  const rows: SemanticsRegister["rows"] = partial.length > 0 && options.previous ? { ...options.previous.rows } : {};
  for (const row of summary.rows) {rows[row.id] = { notes: row.read, unreadable: row.unreadable };}
  return {
    schemaVersion: 1, sdkVersion: summary.sdkVersion, acceptedRunToken: summary.runToken, acceptedAt: options.acceptedAt,
    sampleRate: summary.sampleRate, bpm: summary.bpm, rows
  };
}

export function registerDiff(
  previous: SemanticsRegister | null, next: SemanticsRegister
): { added: string[]; removed: string[]; changed: string[] } {
  const nextIds = Object.keys(next.rows);
  if (previous === null) {return { added: [...nextIds].sort(), removed: [], changed: [] };}
  const previousIds = Object.keys(previous.rows);
  return {
    added: nextIds.filter(id => !(id in previous.rows)).sort(),
    removed: previousIds.filter(id => !(id in next.rows)).sort(),
    changed: nextIds.filter(id => id in previous.rows
      && compareRegister(next.rows[id]!, previous.rows[id], TOLERANCES).kind === "changed").sort()
  };
}
