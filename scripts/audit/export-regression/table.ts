/**
 * Register table from an export regression summary in `.verify-output/`:
 *   node scripts/audit/export-regression/table.ts [runToken] [--accept] [--force] [--library <path>] [--diff <rowId>]
 * One line per row, then the run line. Newest summary when no token is given. `--accept` writes the accepted hash
 * register and copies the accepted WAVs into the local library clone (`--library`, `$EXPORT_WAV_LIBRARY`, else
 * `../opendaw-export-wavs`); it is a person's read of this table, never an automatic step.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseExportRegister, parseExportSummary, planAccept, staleFindings, SUMMARY_NAME, summaryFileName, wavFileName
} from "../../../src/lib/audit/exportRegressionArtifacts.ts";
import type { ExportRegister, ExportSummary, RowRecord } from "../../../src/lib/audit/exportRegressionArtifacts.ts";
import { diffRenders } from "../../../src/lib/audit/exportRegressionDiff.ts";
import { decodeFloatWav, encodeFloatWav } from "../../../src/lib/audit/exportRegressionWav.ts";

// The tests point the script at a scratch tree; a person never sets this
const REPO_ROOT = process.env.EXPORT_REGRESSION_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const verifyDir = (root: string = REPO_ROOT): string => resolve(root, ".verify-output");

const FLAGS = ["--accept", "--force"] as const;
const VALUE_FLAGS = ["--library", "--diff"] as const;

const defaultLibrary = (env: NodeJS.ProcessEnv, root: string): string | null => {
  if (env.EXPORT_WAV_LIBRARY !== undefined && env.EXPORT_WAV_LIBRARY !== "") return resolve(env.EXPORT_WAV_LIBRARY);
  const sibling = resolve(root, "../opendaw-export-wavs");
  return existsSync(sibling) ? sibling : null;
};

/** The token (the first bare argument), the flags and their values; an unknown flag or a missing value throws. */
export function parseArgs(
  args: readonly string[], env: NodeJS.ProcessEnv = process.env, root: string = REPO_ROOT
): { token?: string; accept: boolean; force: boolean; diff?: string; library: string | null } {
  let token: string | undefined;
  let diff: string | undefined;
  let library: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--diff") diff = value;
      else library = resolve(value);
    } else if (arg.startsWith("--")) {
      if (!(FLAGS as readonly string[]).includes(arg)) {
        throw new Error(`unknown flag "${arg}"; known: ${[...FLAGS, ...VALUE_FLAGS].join(", ")}`);
      }
    } else if (token === undefined) {
      token = arg;
    }
  }
  return {
    token, accept: args.includes("--accept"), force: args.includes("--force"), diff,
    library: library ?? defaultLibrary(env, root)
  };
}

export function acceptPath(rate: number, root: string = REPO_ROOT): string {
  return resolve(root, "debug/2026-11-06-export-regression/register", `${rate}.json`);
}

/** Same layout as `sha256OfSamples` in the reader: the channels' float32 bytes, one after the other. */
export function hashSamples(channels: readonly Float32Array[]): string {
  const hash = createHash("sha256");
  for (const channel of channels) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
  return hash.digest("hex");
}

export function formatRows(summary: ExportSummary): string[] {
  return summary.rows.map((row) => {
    const failed = row.invariants.filter((i) => !i.holds)
      .map((i) => i.finding === null ? i.invariant : `${i.invariant} (${i.finding})`);
    const shift = row.shiftFrames === null ? "" : ` shift ${row.shiftFrames}`;
    return [
      row.id,
      row.standing,
      `${row.register ?? "-"}${shift}`,
      row.read === null ? "-" : row.read.hash.slice(0, 10),
      row.read === null ? "-" : String(row.read.frames),
      row.reportedLatencyFrames === null ? "-" : String(row.reportedLatencyFrames),
      row.error !== null ? `error: ${row.error}` : failed.length > 0 ? failed.join(", ") : "-"
    ].join(" | ");
  });
}

export function runLine(summary: ExportSummary): string {
  const count = (standing: RowRecord["standing"]): number => summary.rows.filter((r) => r.standing === standing).length;
  return `run ${summary.runToken} (${new Date(summary.runToken).toISOString()}) | sdk ${summary.sdkVersion} | `
    + `engine ${summary.engineWasmSha256.slice(0, 12)} | ${summary.sampleRate} Hz | uuids ${summary.uuidOrder} | `
    + `register ${summary.registerSdkVersion ?? "none"} | rows ${summary.rows.length} (${summary.rowsParam}) | `
    + `clean ${count("clean")}, known finding ${count("known-finding")}, failing ${count("failing")}, errored ${count("errored")}`;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

const readRegister = (rate: number, root: string): ExportRegister | null => {
  const path = acceptPath(rate, root);
  return existsSync(path) ? parseExportRegister(readJson(path)) : null;
};

function runTokens(root: string): number[] | null {
  let names: string[];
  try {
    names = readdirSync(verifyDir(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return names.map((f) => SUMMARY_NAME.exec(f)?.[1]).filter((id): id is string => id !== undefined)
    .map(Number).sort((a, b) => a - b);
}

function loadSummary(tokenArg: string | undefined, root: string): ExportSummary {
  const tokens = tokenArg === undefined ? runTokens(root) : [];
  if (tokens === null) throw new Error(`no exportreg summary in ${verifyDir(root)}: the directory does not exist`);
  const token = tokenArg !== undefined ? Number(tokenArg) : tokens.at(-1);
  if (token === undefined || !Number.isFinite(token) || !existsSync(resolve(verifyDir(root), summaryFileName(token)))) {
    throw new Error(`no exportreg summary${token === undefined ? "" : ` ${token}`} in ${verifyDir(root)}`);
  }
  return parseExportSummary(readJson(resolve(verifyDir(root), summaryFileName(token))), token);
}

const uploadedRows = (summary: ExportSummary, root: string): Set<string> =>
  new Set(summary.rows.map((r) => r.id).filter((id) => existsSync(resolve(verifyDir(root), wavFileName(summary.runToken, id)))));

const decodeFile = (path: string) => {
  const bytes = readFileSync(path);
  return decodeFloatWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
};

/** What a changed row moved by against the accepted render, or why that cannot be said. */
function changeLine(
  row: RowRecord, summary: ExportSummary, register: ExportRegister | null, library: string | null, root: string
): string {
  const entry = register?.rows[row.id];
  if (entry === undefined) return `${row.id}: no accepted entry`;
  if (library === null) return `${row.id}: no library, the page reports ${row.shiftFrames === null ? "no shift" : `shift ${row.shiftFrames} frames`}`;
  const acceptedPath = resolve(library, entry.wav);
  const nextPath = resolve(verifyDir(root), wavFileName(summary.runToken, row.id));
  if (!existsSync(acceptedPath)) return `${row.id}: library lacks ${entry.wav}`;
  if (!existsSync(nextPath)) return `${row.id}: this run uploaded no WAV`;
  const diff = diffRenders(decodeFile(acceptedPath).channels, decodeFile(nextPath).channels);
  const db = diff.largestDifferenceDb === null ? "-" : `${diff.largestDifferenceDb.toFixed(1)} dB`;
  const shift = diff.shiftFrames === null ? "no shift read" : `shift ${diff.shiftFrames} frames`;
  return `${row.id}: ${diff.kind}, first differing frame ${diff.firstDifferingFrame ?? "-"}, largest ${db}, ${shift}, frames ${diff.acceptedFrames} -> ${diff.nextFrames}`;
}

/**
 * Plans, then verifies every WAV against its row's hash, then copies, then writes the register: the register is
 * the last write, so a refusal or a bad WAV leaves register and library as they were.
 */
export function runAccept(
  summary: ExportSummary, options: { force: boolean; library: string | null; root?: string; acceptedAt?: string }
): string[] {
  const root = options.root ?? REPO_ROOT;
  const path = acceptPath(summary.sampleRate, root);
  const onDisk = readRegister(summary.sampleRate, root);
  const { register, wavsToCopy } = planAccept(summary, onDisk, uploadedRows(summary, root), {
    force: options.force, acceptedAt: options.acceptedAt ?? new Date().toISOString()
  });
  if (wavsToCopy.length > 0 && options.library === null) {
    throw new Error(`${wavsToCopy.length} WAV(s) to copy and no library: pass --library <path> or set $EXPORT_WAV_LIBRARY`);
  }
  const staged = wavsToCopy.map(({ rowId, hash }) => {
    const source = resolve(verifyDir(root), wavFileName(summary.runToken, rowId));
    const got = hashSamples(decodeFile(source).channels);
    if (got !== hash) throw new Error(`${source}: samples hash ${got}, the row ${rowId} read ${hash}; nothing written`);
    return { source, target: resolve(options.library!, register.rows[rowId].wav) };
  });
  for (const { source, target } of staged) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(register, null, 2)}\n`);
  const lines: string[] = [];
  if (options.force) lines.push("FORCED");
  const added = Object.keys(register.rows).filter((id) => onDisk?.rows[id] === undefined);
  const changed = Object.keys(register.rows).filter((id) => onDisk?.rows[id] !== undefined && onDisk.rows[id].hash !== register.rows[id].hash);
  if (onDisk === null) lines.push("no previous register");
  if (added.length > 0) lines.push(`added: ${added.join(", ")}`);
  if (changed.length > 0) lines.push(`changed: ${changed.join(", ")}`);
  if (added.length === 0 && changed.length === 0) lines.push("no differences");
  lines.push(`register ${path}`, `${staged.length} WAV(s) copied`);
  if (staged.length > 0) {
    lines.push(`commit in the library: git -C ${options.library} add wav && git -C ${options.library} commit -m "export regression run ${summary.runToken}"`);
  }
  return lines;
}

function diffRow(summary: ExportSummary, rowId: string, library: string | null, root: string): string[] {
  const row = summary.rows.find((r) => r.id === rowId);
  if (row === undefined) throw new Error(`run ${summary.runToken} has no row ${rowId}`);
  const register = readRegister(summary.sampleRate, root);
  const lines = [changeLine(row, summary, register, library, root)];
  const entry = register?.rows[rowId];
  const nextPath = resolve(verifyDir(root), wavFileName(summary.runToken, rowId));
  if (library !== null && entry !== undefined && existsSync(resolve(library, entry.wav)) && existsSync(nextPath)) {
    const accepted = resolve(verifyDir(root), `exportreg-diff-${rowId}-accepted.wav`);
    const next = resolve(verifyDir(root), `exportreg-diff-${rowId}-new.wav`);
    const a = decodeFile(resolve(library, entry.wav));
    const n = decodeFile(nextPath);
    writeFileSync(accepted, new Uint8Array(encodeFloatWav(a.channels, a.sampleRate)));
    writeFileSync(next, new Uint8Array(encodeFloatWav(n.channels, n.sampleRate)));
    lines.push(accepted, next);
  }
  return lines;
}

function main(): void {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    const summary = loadSummary(parsed.token, REPO_ROOT);
    if (parsed.diff !== undefined) {
      for (const line of diffRow(summary, parsed.diff, parsed.library, REPO_ROOT)) console.log(line);
      return;
    }
    console.log("id | standing | register | hash | frames | latency | failing invariants");
    for (const line of formatRows(summary)) console.log(line);
    console.log(runLine(summary));
    const register = readRegister(summary.sampleRate, REPO_ROOT);
    for (const row of summary.rows) {
      if (row.register === "changed") console.log(changeLine(row, summary, register, parsed.library, REPO_ROOT));
    }
    for (const stale of staleFindings(summary)) {
      console.log(`no longer reproducing: ${stale.name} (${stale.rows.join(", ")}): a fix may have landed`);
    }
    if (parsed.accept) {
      for (const line of runAccept(summary, { force: parsed.force, library: parsed.library })) console.log(line);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
