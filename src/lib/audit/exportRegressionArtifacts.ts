// Plain Node must load this file: the table script reads it, so SDK and reader imports are types only.
import { buildRows, type ExportRow, type LatencyCaseId } from "./exportRegressionRows.ts";
import { KNOWN_FINDINGS } from "./exportRegressionFindings.ts";
import { rowStanding, type InvariantResult, type RegisterEntry, type RegisterVerdict } from "./exportRegressionVerdict.ts";
import type { RenderRead } from "./exportRegressionReader";

export const EXPORT_REGRESSION_SCHEMA_VERSION = 1;

export const SUMMARY_NAME = /^exportreg-summary-(\d+)\.json$/;

export const summaryFileName = (runToken: number): string => `exportreg-summary-${runToken}.json`;
export const wavFileName = (runToken: number, rowId: string): string => `exportreg-${runToken}-${rowId}.wav`;

export type RowRecord = {
  id: string;
  label: string;
  group: ExportRow["group"];
  read: RenderRead | null;
  reportedLatencyFrames: number | null;
  invariants: InvariantResult[];
  register: RegisterVerdict | null;
  shiftFrames: number | null;
  standing: ReturnType<typeof rowStanding>;
  wavUploaded: boolean;
  error: string | null;
  renderMs: number;
};

/** One figure of the live engine: it refreshes on animation frames, so a hidden page's figure may be an old one. */
export type LatencyRead = {
  latencyCase: LatencyCaseId;
  frames: number | null;
  visibility: string;
};

export type ExportSummary = {
  schemaVersion: number;
  runToken: number;
  userAgent: string;
  sdkVersion: string;
  engineWasmSha256: string;
  sampleRate: number;
  uuidOrder: "ascending" | "descending";
  rowsParam: string;
  fill: boolean;
  registerSdkVersion: string | null;
  latencyReads: LatencyRead[];
  /** The Mac's output device rate, which a page left at its default context rate runs at; null when it could not be read. */
  deviceRateHz: number | null;
  rows: RowRecord[];
};

/** `acceptedRunToken` and `acceptedAt` name the latest accept: after a forced partial merge, other rows came from earlier ones. */
export type ExportRegister = {
  schemaVersion: number;
  sdkVersion: string;
  engineWasmSha256: string;
  acceptedRunToken: number;
  acceptedAt: string;
  sampleRate: number;
  rows: Record<string, RegisterEntry>;
};

const kindOf = (value: unknown): string =>
  value === null ? "null" : typeof value === "number" && Number.isNaN(value) ? "NaN" : typeof value;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown, where: string): void => {
  if (typeof value !== "string") throw new Error(`${where} is ${kindOf(value)}, not a string`);
};
const requireFinite = (value: unknown, where: string): void => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${where} is ${kindOf(value)}, not a finite number`);
};
const requireFiniteList = (value: unknown, where: string): void => {
  if (!Array.isArray(value)) throw new Error(`${where} is not an array`);
  value.forEach((item: unknown, i: number) => requireFinite(item, `${where}[${i}]`));
};

export function parseExportSummary(json: unknown, runToken: number): ExportSummary {
  const where = `summary ${runToken}`;
  if (!isObject(json)) throw new Error(`${where}: not an object`);
  if (json.schemaVersion !== EXPORT_REGRESSION_SCHEMA_VERSION) {
    throw new Error(`${where}: schemaVersion ${String(json.schemaVersion)}, readable: ${EXPORT_REGRESSION_SCHEMA_VERSION}`);
  }
  requireString(json.sdkVersion, `${where}: sdkVersion`);
  requireString(json.engineWasmSha256, `${where}: engineWasmSha256`);
  requireString(json.rowsParam, `${where}: rowsParam`);
  requireFinite(json.sampleRate, `${where}: sampleRate`);
  if (json.uuidOrder !== "ascending" && json.uuidOrder !== "descending") {
    throw new Error(`${where}: uuidOrder is ${String(json.uuidOrder)}, not ascending or descending`);
  }
  if (json.deviceRateHz !== undefined && json.deviceRateHz !== null) requireFinite(json.deviceRateHz, `${where}: deviceRateHz`);
  if (!Array.isArray(json.rows)) throw new Error(`${where}: rows is not an array`);
  json.rows.forEach((row: unknown, i: number) => {
    if (!isObject(row)) throw new Error(`${where}: row ${i} is not an object`);
    requireString(row.id, `${where}: row ${i} id`);
    const at = `${where}: row ${String(row.id)}`;
    if (!Array.isArray(row.invariants)) throw new Error(`${at} invariants is not an array`);
    row.invariants.forEach((result: unknown, j: number) => {
      const of = `${at} invariant ${j}`;
      if (!isObject(result)) throw new Error(`${of} is not an object`);
      requireString(result.invariant, `${of} invariant`);
      if (typeof result.holds !== "boolean") throw new Error(`${of} holds is ${kindOf(result.holds)}, not a boolean`);
      if (result.finding !== null && typeof result.finding !== "string") throw new Error(`${of} finding is ${kindOf(result.finding)}, not a string or null`);
    });
    if (typeof row.standing !== "string") throw new Error(`${at} standing is ${kindOf(row.standing)}, not a string`);
    if (row.error === null || row.error === undefined) {
      if (!isObject(row.read)) throw new Error(`${at} has no error and no read`);
      requireString(row.read.hash, `${at} read.hash`);
      requireFinite(row.read.frames, `${at} read.frames`);
      requireFinite(row.read.channels, `${at} read.channels`);
      requireFinite(row.read.peak, `${at} read.peak`);
      requireFiniteList(row.read.impulseHits, `${at} read.impulseHits`);
    }
  });
  // A summary written before the field existed reads null
  return { ...json, deviceRateHz: json.deviceRateHz ?? null } as unknown as ExportSummary;
}

export function parseExportRegister(json: unknown): ExportRegister {
  if (!isObject(json)) throw new Error("register: not an object");
  if (json.schemaVersion !== EXPORT_REGRESSION_SCHEMA_VERSION) {
    throw new Error(`register: schemaVersion ${String(json.schemaVersion)}, readable: ${EXPORT_REGRESSION_SCHEMA_VERSION}`);
  }
  requireString(json.sdkVersion, "register: sdkVersion");
  requireString(json.engineWasmSha256, "register: engineWasmSha256");
  requireFinite(json.sampleRate, "register: sampleRate");
  if (!isObject(json.rows)) throw new Error("register: rows is not an object");
  for (const [id, entry] of Object.entries(json.rows)) {
    if (!isObject(entry)) throw new Error(`register: row ${id} is not an object`);
    requireString(entry.hash, `register: row ${id} hash`);
    requireString(entry.wav, `register: row ${id} wav`);
    requireFinite(entry.frames, `register: row ${id} frames`);
    requireFinite(entry.channels, `register: row ${id} channels`);
    requireFinite(entry.peak, `register: row ${id} peak`);
    requireFiniteList(entry.impulseHits, `register: row ${id} impulseHits`);
  }
  return json as unknown as ExportRegister;
}

/** What the rows read against the register, apart from their standing: an invariant holds with no register at all. */
export const registerCounts = (rows: readonly Pick<RowRecord, "register">[]): Record<RegisterVerdict, number> => {
  const count = (verdict: RegisterVerdict): number => rows.filter((row) => row.register === verdict).length;
  return { identical: count("identical"), changed: count("changed"), unregistered: count("unregistered") };
};

/** A fill is the run that makes the register, so it has nothing to say about one. */
export const noRegisterNotice = (hasRegister: boolean, fill: boolean): string | null =>
  hasRegister || fill ? null
    : "This page found no accepted register, so a run here proves the invariants only, not that a render has the same bits as accepted.";

/** `uploadSummary`'s rejection when the host has no verify sink, as the public host has not. */
export const isMissingSink = (message: string): boolean => /HTTP 40[45]\b/.test(message);

/** Not plain `done`: `table.ts` with no token would read an older run as if it were this one. */
export const auditStateAfterRun = (summaryUploaded: boolean): "done" | "done:no-summary" =>
  summaryUploaded ? "done" : "done:no-summary";

export const libraryWavPath = (hash: string): string => `wav/${hash}.wav`;

/** The rows the accept gate cannot take: judged from the invariants, never from the stored label. */
function refusedRows(rows: readonly RowRecord[]): { errored: string[]; unreadable: string[]; failing: string[] } {
  const errored: string[] = [];
  const unreadable: string[] = [];
  const failing: string[] = [];
  for (const row of rows) {
    if (row.error !== null || row.read === null) {
      errored.push(row.id);
      continue;
    }
    const standing = rowStanding(row.invariants, row.error);
    if (standing === "failing") failing.push(row.id);
    else if (standing !== row.standing) unreadable.push(row.id);
  }
  return { errored, unreadable, failing };
}

/**
 * The register a run makes, or the refusal. Refused outright, even forced: an errored row (it read nothing), a row
 * whose own invariants fail with no known finding of that invariant (accepting it would bless a defect: the stored
 * `standing` is not trusted, it is recomputed and must agree), a control run (descending UUIDs), a rate other than the
 * register's, a schema this code cannot read, a row the catalogue does not hold or holds with other invariants (a summary
 * from before the catalogue changed was not judged by this catalogue). Refused unless forced: a partial run, which then
 * merges into the register on disk, and a full run missing catalogue rows. Every row whose hash differs from its register
 * entry needs its WAV uploaded; `wavsToCopy` is each hash the register does not hold yet, once.
 */
export function planAccept(
  summary: ExportSummary, onDisk: ExportRegister | null, uploaded: ReadonlySet<string>,
  options: { force: boolean; acceptedAt: string }
): { register: ExportRegister; wavsToCopy: { rowId: string; hash: string }[] } {
  const where = `run ${summary.runToken}`;
  if (summary.schemaVersion !== EXPORT_REGRESSION_SCHEMA_VERSION) {
    throw new Error(`${where}: schemaVersion ${summary.schemaVersion}, readable: ${EXPORT_REGRESSION_SCHEMA_VERSION}`);
  }
  if (summary.uuidOrder === "descending") {
    throw new Error(`${where} is a control run (uuidOrder descending): never accepted, not even forced`);
  }
  const { errored, unreadable, failing } = refusedRows(summary.rows);
  if (errored.length > 0) throw new Error(`${where} has errored rows, never accepted, not even forced: ${errored.join(", ")}`);
  if (failing.length > 0) {
    throw new Error(`${where} has rows with a failing invariant and no known finding, never accepted, not even forced: ${failing.join(", ")}`);
  }
  if (unreadable.length > 0) {
    throw new Error(`${where} has rows whose stored standing disagrees with their invariants, never accepted, not even forced: ${unreadable.join(", ")}`);
  }
  if (onDisk !== null) {
    if (onDisk.schemaVersion !== EXPORT_REGRESSION_SCHEMA_VERSION) {
      throw new Error(`register: schemaVersion ${onDisk.schemaVersion}, readable: ${EXPORT_REGRESSION_SCHEMA_VERSION}`);
    }
    if (onDisk.sampleRate !== summary.sampleRate) {
      throw new Error(`${where} renders at ${summary.sampleRate} Hz, the register is at ${onDisk.sampleRate} Hz`);
    }
  }
  const catalogue = new Map(buildRows(summary.sampleRate).map((row) => [row.id, row]));
  const stray = summary.rows.filter((row) => !catalogue.has(row.id)).map((row) => row.id);
  if (stray.length > 0) throw new Error(`${where} has rows not in the catalogue, never accepted, not even forced: ${stray.join(", ")}`);
  const offCatalogue = summary.rows
    .filter((row) => row.invariants.map((r) => r.invariant).join() !== catalogue.get(row.id)!.invariants.join())
    .map((row) => row.id);
  if (offCatalogue.length > 0) {
    throw new Error(`${where} has rows whose invariants are not the catalogue's, never accepted, not even forced: ${offCatalogue.join(", ")}`);
  }
  const partial = summary.rowsParam !== "all";
  if (partial && !options.force) {
    throw new Error(`${where} is partial (rows=${summary.rowsParam}), not accepted without force: forced, it merges into the register on disk`);
  }
  if (partial && onDisk !== null
    && (onDisk.sdkVersion !== summary.sdkVersion || onDisk.engineWasmSha256 !== summary.engineWasmSha256)) {
    throw new Error(`${where} is partial and cannot merge into a register of another build: sdk ${onDisk.sdkVersion} / engine ${onDisk.engineWasmSha256.slice(0, 12)} in the register, sdk ${summary.sdkVersion} / engine ${summary.engineWasmSha256.slice(0, 12)} in the run`);
  }
  if (!partial && !options.force) {
    const present = new Set(summary.rows.map((r) => r.id));
    const missing = [...catalogue.keys()].filter((id) => !present.has(id));
    if (missing.length > 0) throw new Error(`${where} is a full run missing catalogue rows, not accepted without force: ${missing.join(", ")}`);
  }

  const rows: Record<string, RegisterEntry> = partial && onDisk !== null ? { ...onDisk.rows } : {};
  const held = new Set(Object.values(onDisk?.rows ?? {}).map((entry) => entry.hash));
  const wavsToCopy: { rowId: string; hash: string }[] = [];
  const queued = new Set<string>();
  const missingWav: string[] = [];
  for (const row of summary.rows) {
    const read = row.read!;
    const existing = onDisk?.rows[row.id];
    if (existing !== undefined && existing.hash === read.hash) {
      rows[row.id] = existing;
      continue;
    }
    if (!uploaded.has(row.id)) {
      missingWav.push(row.id);
      continue;
    }
    if (!held.has(read.hash) && !queued.has(read.hash)) {
      queued.add(read.hash);
      wavsToCopy.push({ rowId: row.id, hash: read.hash });
    }
    rows[row.id] = {
      hash: read.hash, frames: read.frames, channels: read.channels, peak: read.peak,
      impulseHits: read.impulseHits, wav: libraryWavPath(read.hash)
    };
  }
  if (missingWav.length > 0) {
    throw new Error(`${where}: no uploaded WAV for changed or unregistered rows, nothing accepted: ${missingWav.join(", ")}`);
  }
  return {
    register: {
      schemaVersion: EXPORT_REGRESSION_SCHEMA_VERSION, sdkVersion: summary.sdkVersion,
      engineWasmSha256: summary.engineWasmSha256, acceptedRunToken: summary.runToken,
      acceptedAt: options.acceptedAt, sampleRate: summary.sampleRate, rows
    },
    wavsToCopy
  };
}

/**
 * Known findings whose rows, in this run, all hold the finding's invariant: a fix landing. Rows that errored or
 * are absent from a partial run are ignored; a finding with no row in the catalogue is not stale.
 */
export function staleFindings(summary: ExportSummary): { name: string; rows: string[] }[] {
  const catalogue = buildRows(summary.sampleRate);
  const byId = new Map(summary.rows.map((r) => [r.id, r]));
  const stale = new Map<string, string[]>();
  const live = new Set<string>();
  for (const finding of KNOWN_FINDINGS) {
    const results = catalogue
      .filter((row) => finding.applies(row, summary.sampleRate))
      .map((row) => ({ id: row.id, record: byId.get(row.id) }))
      .filter((r) => r.record !== undefined && r.record.error === null)
      .map((r) => ({ id: r.id, result: r.record!.invariants.find((i) => i.invariant === finding.invariant) }))
      .filter((r) => r.result !== undefined);
    if (results.length === 0) continue;
    if (results.every((r) => r.result!.holds)) {
      stale.set(finding.name, [...(stale.get(finding.name) ?? []), ...results.map((r) => r.id)]);
    } else {
      live.add(finding.name);
    }
  }
  return [...stale.entries()]
    .filter(([name]) => !live.has(name))
    .map(([name, rows]) => ({ name, rows: [...new Set(rows)] }));
}
