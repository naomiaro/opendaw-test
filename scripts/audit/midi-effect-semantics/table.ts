/**
 * Register table from a MIDI effect semantics audit summary in `.verify-output/`:
 *   node scripts/audit/midi-effect-semantics/table.ts [runToken] [--accept] [--force]
 * One line per row, then the run line. Newest summary when no token is given. `--accept` writes the
 * run as the JSON register the next run is judged against (a run with a broken or errored row needs
 * `--force`; so does a partial run, one whose rows, device or pattern filter is not `all`, which is then
 * merged into the register on disk instead of replacing it).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSemanticsRegister, parseSemanticsSummary, partialParams, registerDiff, registerFromSummary, SUMMARY_NAME, summaryFileName
} from "../../../src/lib/audit/midiEffectSemanticsArtifacts.ts";
import type { SemanticsRegister, SemanticsRowRecord, SemanticsSummary } from "../../../src/lib/audit/midiEffectSemanticsArtifacts.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const VERIFY_DIR = resolve(REPO_ROOT, ".verify-output");

export interface RowDeltas { onsetMs: number | null; cents: number | null; velocity: number | null }

const tidy = (value: number): number => Number(value.toFixed(6));
const maxOrNull = (values: number[]): number | null => values.length === 0 ? null : tidy(Math.max(...values));

/**
 * The largest absolute difference per figure between the readable predicted notes, in onset order, and the
 * read notes at the same place. Only when the read list is as long as the readable list does the place mean
 * the same note; otherwise nothing pairs.
 */
export function rowDeltas(row: SemanticsRowRecord): RowDeltas {
  const readable = row.predicted.filter(p => p.readability === "readable");
  const onset: number[] = [];
  const cents: number[] = [];
  const velocity: number[] = [];
  if (row.read.length === readable.length) {
    readable.forEach((p, i) => {
      const got = row.read[i]!;
      onset.push(Math.abs(got.onsetMs - p.onsetMs));
      velocity.push(Math.abs(got.velocity - p.velocity));
      if (got.cents !== null) {cents.push(Math.abs(got.cents - p.cents));}
    });
  }
  return { onsetMs: maxOrNull(onset), cents: maxOrNull(cents), velocity: maxOrNull(velocity) };
}

const fixed = (value: number | null, digits: number): string => value === null ? "—" : value.toFixed(digits);

export function formatRows(summary: SemanticsSummary): string[] {
  return summary.rows.map((row) => {
    const deltas = rowDeltas(row);
    const questioned = row.questions.length > 0 ? ` questioned: ${row.questions.join("+")}` : "";
    const rule = row.rule === "broken" ? ` | rule: ${row.ruleSentence}` : "";
    const readable = row.predicted.filter(p => p.readability === "readable").length;
    return [
      row.id,
      row.verdict,
      `${row.figure ?? "—"}${questioned}${rule}`,
      `${row.read.length} / ${readable} (${row.unreadable})`,
      fixed(deltas.onsetMs, 2),
      fixed(deltas.cents, 1),
      fixed(deltas.velocity, 3),
      String(Math.round(row.renderMs))
    ].join(" | ");
  });
}

/** The run line; the token is the run's start in epoch ms, printed as a date too, so an operator sees which run the newest envelope is (an aborted run uploads nothing). */
export function runLine(summary: SemanticsSummary): string {
  const count = (kind: SemanticsRowRecord["rule"]): number => summary.rows.filter(r => r.rule === kind && r.error === null).length;
  const registered = (kind: SemanticsRowRecord["register"]): number => summary.rows.filter(r => r.register === kind && r.error === null).length;
  const errors = summary.rows.filter(r => r.error !== null).length;
  const { calibration } = summary;
  return `run ${summary.runToken} (${new Date(summary.runToken).toISOString()}) | sdk ${summary.sdkVersion} | ${summary.sampleRate} Hz | ${summary.bpm} bpm | `
    + `reference peak ${calibration.referencePeak} | instrument offset ${calibration.instrumentOffsetFrames} frames | `
    + `register ${summary.registerSource ?? "none"} | rows ${summary.rows.length} | `
    + `holds ${count("holds")} deviation ${count("deviation")} broken ${count("broken")} none ${count("none")} error ${errors} | `
    + `as-registered ${registered("as-registered")} changed ${registered("changed")} unregistered ${registered("unregistered")}`;
}

/** A JSON file, its path in the message when it does not parse. */
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

const FLAGS = ["--accept", "--force"] as const;

/** The token (the first argument that is not a flag) and the flags; an unknown flag throws, so a typo never runs without its flag. */
export function parseArgs(args: readonly string[]): { token: string | undefined; accept: boolean; force: boolean } {
  const unknown = args.find((arg) => arg.startsWith("--") && !(FLAGS as readonly string[]).includes(arg));
  if (unknown !== undefined) {throw new Error(`unknown flag "${unknown}"; known: ${FLAGS.join(", ")}`);}
  return { token: args.find((arg) => !arg.startsWith("--")), accept: args.includes("--accept"), force: args.includes("--force") };
}

export function acceptPath(rate: number, root: string = REPO_ROOT): string {
  return resolve(root, "debug/2026-11-03-midi-effect-semantics/register", `${rate}.json`);
}

/**
 * Throws the refusal of `registerFromSummary` (a broken or errored row, or a partial run, without force); otherwise returns
 * the register, its path and the lines to print before the write: `FORCED` and `merged into <path>` first when they apply,
 * then, forced, the errored rows (kept as registered from the register on disk, or left out), then the diff against the
 * register on disk, or `no differences`.
 */
export function planAccept(
  summary: SemanticsSummary, options: { force: boolean; root?: string }
): { path: string; next: SemanticsRegister; diffLines: string[] } {
  const path = acceptPath(summary.sampleRate, options.root);
  const previous = existsSync(path) ? parseSemanticsRegister(readJson(path)) : null;
  const next: SemanticsRegister = registerFromSummary(summary, { force: options.force, acceptedAt: new Date().toISOString(), previous });
  const diff = registerDiff(previous, next);
  const header: string[] = [];
  if (options.force) {header.push("FORCED");}
  const errored = summary.rows.filter((row) => row.error !== null).map((row) => row.id);
  const kept = errored.filter((id) => id in next.rows);
  const leftOut = errored.filter((id) => !(id in next.rows));
  if (kept.length > 0) {header.push(`errored, kept as registered: ${kept.join(", ")}`);}
  if (leftOut.length > 0) {header.push(`errored, left out: ${leftOut.join(", ")}`);}
  if (partialParams(summary).length > 0) {header.push(previous === null ? `partial run, no previous register to merge into at ${path}` : `merged into ${path}`);}
  const body: string[] = [];
  if (previous === null) {body.push("no previous register");}
  if (diff.added.length > 0) {body.push(`added: ${diff.added.join(", ")}`);}
  if (diff.removed.length > 0) {body.push(`removed: ${diff.removed.join(", ")}`);}
  if (diff.changed.length > 0) {body.push(`changed: ${diff.changed.join(", ")}`);}
  if (body.length === 0) {body.push("no differences");}
  return { path, next, diffLines: [...header, ...body] };
}

export function writeRegister(path: string, register: SemanticsRegister): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(register, null, 2)}\n`);
}

/** The summaries' tokens, oldest first; null when the verify directory does not exist. */
function runTokens(): number[] | null {
  let names: string[];
  try {
    names = readdirSync(VERIFY_DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {return null;}
    throw error;
  }
  return names
    .map((f) => SUMMARY_NAME.exec(f)?.[1])
    .filter((id): id is string => id !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

function main(): void {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const { accept, force } = parsed;
  const tokens = parsed.token === undefined ? runTokens() : [];
  if (tokens === null) {
    console.error(`no midisem summary in ${VERIFY_DIR}: the directory does not exist`);
    process.exit(1);
  }
  const token = parsed.token !== undefined ? Number(parsed.token) : tokens.at(-1);
  if (token === undefined || !Number.isFinite(token) || !existsSync(resolve(VERIFY_DIR, summaryFileName(token)))) {
    console.error(`no midisem summary${token === undefined ? "" : ` ${token}`} in ${VERIFY_DIR}`);
    process.exit(1);
  }
  const summary = parseSemanticsSummary(readJson(resolve(VERIFY_DIR, summaryFileName(token))), token);
  console.log("id | verdict | figure | read / readable (unreadable) | max |Δonset| ms | max |Δcents| | max |Δvel| | render ms");
  for (const line of formatRows(summary)) {console.log(line);}
  console.log(runLine(summary));
  if (accept) {
    try {
      const { path, next, diffLines } = planAccept(summary, { force });
      for (const line of diffLines) {console.log(line);}
      writeRegister(path, next);
      console.log(path);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {main();}
