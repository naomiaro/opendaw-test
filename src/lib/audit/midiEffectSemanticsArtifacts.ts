/**
 * What a run of the MIDI effect semantics audit persists: one record per row and one summary per
 * run, uploaded to the dev server's `/__verify` sink as `midisem-summary-<runToken>.json`, and the
 * JSON register a person accepts (`debug/2026-11-03-midi-effect-semantics/register/<rate>.json`).
 * The table script loads this file under Node, so the reader, rules and rows modules come in as
 * types only; the one value import is the SDK-free verdict module.
 */
import type { NoteFigure } from "./midiEffectSemanticsReader";
import type { DeviationName, PredictedFigure, QuestionName } from "./midiEffectSemanticsRules";
import type { ChainStage, RowGroup, SemanticsPatternId } from "./midiEffectSemanticsRows";
import { compareRegister, TOLERANCES } from "./midiEffectSemanticsVerdict.ts";
import type { RegisterJudgement, RegisterRow, RuleJudgement } from "./midiEffectSemanticsVerdict";

/** The summary's and the register's schema. 1: the first runs. */
export const MIDI_SEMANTICS_SCHEMA_VERSION = 1;

export const SUMMARY_NAME = /^midisem-summary-(\d+)\.json$/;

export function summaryFileName(runToken: number): string {
  return `midisem-summary-${runToken}.json`;
}

export interface SemanticsRowRecord {
  id: string;
  label: string;
  group: RowGroup;
  pattern: SemanticsPatternId;
  chain: ChainStage[];
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

/** What a value is, for a message: `NaN` and `null` by name, otherwise its `typeof`. */
const kindOf = (value: unknown): string =>
  value === null ? "null" : typeof value === "number" && Number.isNaN(value) ? "NaN" : typeof value;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function requireFinite(value: unknown, where: string): void {
  if (!finite(value)) {throw new Error(`${where} is ${kindOf(value)}, not a finite number`);}
}

function requireString(value: unknown, where: string): void {
  if (typeof value !== "string") {throw new Error(`${where} is ${kindOf(value)}, not a string`);}
}

/** A `NoteFigure`: onset, end and velocity finite; pitch, cents and jitter finite or null, and null together (a note the reader gave no pitch). */
function requireNotes(notes: unknown[], where: string): void {
  notes.forEach((value, i) => {
    const at = `${where} note ${i}`;
    if (typeof value !== "object" || value === null) {throw new Error(`${at} is not an object`);}
    const note = value as Record<string, unknown>;
    for (const field of ["onsetMs", "endMs", "velocity"]) {requireFinite(note[field], `${at} ${field}`);}
    const tone = ["pitch", "cents", "jitterCents"].map((field) => {
      const figure = note[field];
      if (figure !== null && !finite(figure)) {throw new Error(`${at} ${field} is ${kindOf(figure)}, not a finite number or null`);}
      return figure === null;
    });
    if (tone.some((isNull) => isNull !== tone[0])) {throw new Error(`${at} has pitch, cents and jitterCents neither all null nor all numbers`);}
  });
}

export function parseSemanticsSummary(json: unknown, runToken: number): SemanticsSummary {
  const where = `summary ${runToken}`;
  if (typeof json !== "object" || json === null) {throw new Error(`${where}: not an object`);}
  const summary = json as Record<string, unknown>;
  if (summary.schemaVersion !== MIDI_SEMANTICS_SCHEMA_VERSION) {
    throw new Error(`${where}: schemaVersion ${String(summary.schemaVersion)}, readable: ${MIDI_SEMANTICS_SCHEMA_VERSION}`);
  }
  requireString(summary.sdkVersion, `${where}: sdkVersion`);
  requireFinite(summary.sampleRate, `${where}: sampleRate`);
  requireFinite(summary.bpm, `${where}: bpm`);
  const calibration = summary.calibration;
  if (typeof calibration !== "object" || calibration === null) {throw new Error(`${where}: calibration is not an object`);}
  for (const field of ["referencePeak", "instrumentOffsetFrames", "onsetThreshold", "attackMs", "gapMs"]) {
    requireFinite((calibration as Record<string, unknown>)[field], `${where}: calibration.${field}`);
  }
  if (!Array.isArray(summary.rows)) {throw new Error(`${where}: rows is not an array`);}
  summary.rows.forEach((row: Record<string, unknown> | null, i: number) => {
    if (typeof row !== "object" || row === null) {throw new Error(`${where}: row ${i} is not an object`);}
    requireString(row.id, `${where}: row ${i} id`);
    if (!Array.isArray(row.read)) {throw new Error(`${where}: row ${String(row.id)} read is not an array`);}
    if (typeof row.verdict !== "string") {throw new Error(`${where}: row ${String(row.id)} verdict is ${typeof row.verdict}, not a string`);}
    requireNotes(row.read, `${where}: row ${String(row.id)}`);
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

/** `acceptedRunToken` and `acceptedAt` name the latest accept: after a forced partial merge, rows it did not cover came from earlier ones. */
export interface SemanticsRegister {
  schemaVersion: typeof MIDI_SEMANTICS_SCHEMA_VERSION;
  sdkVersion: string;
  acceptedRunToken: number;
  acceptedAt: string;
  sampleRate: number;
  bpm: number;
  rows: Record<string, RegisterRow>;
}

export function parseSemanticsRegister(json: unknown): SemanticsRegister {
  if (typeof json !== "object" || json === null) {throw new Error("register: not an object");}
  const register = json as Record<string, unknown>;
  if (register.schemaVersion !== MIDI_SEMANTICS_SCHEMA_VERSION) {
    throw new Error(`register: schemaVersion ${String(register.schemaVersion)}, readable: ${MIDI_SEMANTICS_SCHEMA_VERSION}`);
  }
  requireString(register.sdkVersion, "register: sdkVersion");
  requireFinite(register.sampleRate, "register: sampleRate");
  requireFinite(register.bpm, "register: bpm");
  const rows = register.rows;
  if (typeof rows !== "object" || rows === null || Array.isArray(rows)) {throw new Error("register: rows is not an object");}
  for (const [id, row] of Object.entries(rows as Record<string, Record<string, unknown> | null>)) {
    if (typeof row !== "object" || row === null) {throw new Error(`register: row ${id} is not an object`);}
    if (!Array.isArray(row.notes)) {throw new Error(`register: row ${id} notes is not an array`);}
    if (typeof row.unreadable !== "number") {throw new Error(`register: row ${id} unreadable is ${typeof row.unreadable}, not a number`);}
    requireNotes(row.notes, `register: row ${id}`);
  }
  return register as unknown as SemanticsRegister;
}

/**
 * What the page's register fetch means. No register: a 404, or a 200 whose body is the host's HTML fallback for a missing
 * file (it starts with `<`). Anything else must be the register: another status, a content type that is not JSON, a body
 * that does not parse, or a register for another rate or bpm than the page renders throws, naming `path`, so a lost or
 * misplaced register ends the run instead of reading as an unregistered one.
 */
export function registerFromFetch(
  response: { status: number; contentType: string; body: string }, expected: { sampleRate: number; bpm: number }, path: string
): SemanticsRegister | null {
  if (response.status === 404) {return null;}
  if (response.status !== 200) {throw new Error(`${path}: HTTP ${response.status}`);}
  if (response.body.trimStart().startsWith("<")) {return null;}
  if (!response.contentType.includes("json")) {throw new Error(`${path}: content type ${response.contentType || "none"}, not JSON`);}
  let json: unknown;
  try {
    json = JSON.parse(response.body);
  } catch (cause) {
    throw new Error(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  const register = parseSemanticsRegister(json);
  if (register.sampleRate !== expected.sampleRate || register.bpm !== expected.bpm) {
    throw new Error(`${path}: a register of ${register.sampleRate} Hz and ${register.bpm} bpm, the page renders ${expected.sampleRate} Hz and ${expected.bpm} bpm`);
  }
  return register;
}

/** The row filters of a run that are not `all`, as `name=value`; empty for a full run. */
export function partialParams(summary: SemanticsSummary): string[] {
  return ([["rows", summary.rowsParam], ["device", summary.deviceParam], ["pattern", summary.patternParam]] as const)
    .filter(([, value]) => value !== "all")
    .map(([name, value]) => `${name}=${value}`);
}

/** The footing a register's figures stand on; a row is carried from one register into another only on the same one. */
const FOOTING = ["sdkVersion", "bpm", "sampleRate"] as const;

/** Each footing field on which `previous` and the run differ, as `<field> <register's> in the register, <run's> in the run`. */
function footingDifferences(previous: SemanticsRegister, summary: SemanticsSummary): string[] {
  return FOOTING
    .filter((field) => previous[field] !== summary[field])
    .map((field) => `${field} ${previous[field]} in the register, ${summary[field]} in the run`);
}

/**
 * The register a run makes. A full run replaces `previous`. A partial run (a row filter not `all`) would drop every row it
 * did not render, so it is refused without force; forced, its rows are merged into `previous`'s, the rows it did not cover
 * kept as they were. A merge is refused outright when `previous` stands on another SDK, bpm or rate: its rows would be
 * relabelled with the run's. On the same footing the merged register's `acceptedRunToken` and `acceptedAt` are the latest
 * accept's. A run with a broken or errored row is refused without force too; forced, a broken row is accepted (it was read),
 * an errored one never is (it read nothing): it keeps `previous`'s entry when `previous` stands on the same footing, and is
 * left out otherwise.
 */
export function registerFromSummary(
  summary: SemanticsSummary, options: { force: boolean; acceptedAt: string; previous?: SemanticsRegister | null }
): SemanticsRegister {
  const previous = options.previous ?? null;
  const partial = partialParams(summary);
  if (partial.length > 0 && !options.force) {
    throw new Error(`run ${summary.runToken} is partial (${partial.join(", ")}), not accepted without force: forced, it merges into the previous register`);
  }
  const refused = summary.rows.filter(row => row.error !== null || row.rule === "broken").map(row => row.id);
  if (refused.length > 0 && !options.force) {
    throw new Error(`run ${summary.runToken} has ${refused.length} row(s) in error or broken, not accepted without force: ${refused.join(", ")}`);
  }
  const differences = previous === null ? [] : footingDifferences(previous, summary);
  if (partial.length > 0 && differences.length > 0) {
    throw new Error(`run ${summary.runToken} is partial and cannot merge into a register on another footing: ${differences.join(", ")}`);
  }
  const sameFooting = previous !== null && differences.length === 0;
  const rows: SemanticsRegister["rows"] = partial.length > 0 && previous !== null ? { ...previous.rows } : {};
  for (const row of summary.rows) {
    if (row.error === null) {
      rows[row.id] = { notes: row.read, unreadable: row.unreadable };
    } else if (sameFooting && previous.rows[row.id] !== undefined) {
      rows[row.id] = previous.rows[row.id]!;
    }
  }
  return {
    schemaVersion: MIDI_SEMANTICS_SCHEMA_VERSION, sdkVersion: summary.sdkVersion, acceptedRunToken: summary.runToken,
    acceptedAt: options.acceptedAt, sampleRate: summary.sampleRate, bpm: summary.bpm, rows
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
