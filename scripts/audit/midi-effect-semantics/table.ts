/**
 * Register table from a MIDI effect semantics audit summary in `.verify-output/`:
 *   node scripts/audit/midi-effect-semantics/table.ts [runToken] [--accept] [--force]
 * One line per row, then the run line. Newest summary when no token is given. `--accept` writes the
 * run as the JSON register the next run is judged against (a run with a broken or errored row needs
 * `--force`).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSemanticsRegister, parseSemanticsSummary, registerDiff, registerFromSummary, SUMMARY_NAME, summaryFileName
} from "../../../src/lib/audit/midiEffectSemanticsArtifacts.ts";
import type { SemanticsRegister, SemanticsRowRecord, SemanticsSummary } from "../../../src/lib/audit/midiEffectSemanticsArtifacts.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const VERIFY_DIR = resolve(REPO_ROOT, ".verify-output");

export interface RowDeltas { onsetMs: number | null; cents: number | null; velocity: number | null }

const tidy = (value: number): number => Number(value.toFixed(6));
const maxOrNull = (values: number[]): number | null => values.length === 0 ? null : tidy(Math.max(...values));

/**
 * The largest absolute difference per figure between each readable predicted note and the read note at its
 * place in onset order. Only when the read list is as long as the predicted one does the place mean the same
 * note; otherwise nothing pairs.
 */
export function rowDeltas(row: SemanticsRowRecord): RowDeltas {
  const aligned = row.read.length === row.predicted.length;
  const onset: number[] = [];
  const cents: number[] = [];
  const velocity: number[] = [];
  row.predicted.forEach((p, i) => {
    const got = row.read[i];
    if (!aligned || p.readability !== "readable" || got === undefined) {return;}
    onset.push(Math.abs(got.onsetMs - p.onsetMs));
    velocity.push(Math.abs(got.velocity - p.velocity));
    if (got.cents !== null) {cents.push(Math.abs(got.cents - p.cents));}
  });
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

export function runLine(summary: SemanticsSummary): string {
  const count = (kind: SemanticsRowRecord["rule"]): number => summary.rows.filter(r => r.rule === kind && r.error === null).length;
  const errors = summary.rows.filter(r => r.error !== null).length;
  const { calibration } = summary;
  return `run ${summary.runToken} | sdk ${summary.sdkVersion} | ${summary.sampleRate} Hz | ${summary.bpm} bpm | `
    + `reference peak ${calibration.referencePeak} | instrument offset ${calibration.instrumentOffsetFrames} frames | `
    + `register ${summary.registerSource ?? "none"} | rows ${summary.rows.length} | `
    + `holds ${count("holds")} deviation ${count("deviation")} broken ${count("broken")} none ${count("none")} error ${errors}`;
}

export function acceptPath(rate: number, root: string = REPO_ROOT): string {
  return resolve(root, "debug/2026-11-03-midi-effect-semantics/register", `${rate}.json`);
}

/** Throws the refusal of `registerFromSummary`; otherwise writes the register and returns the diff lines printed before it. */
export function writeAccepted(
  summary: SemanticsSummary, options: { force: boolean; root?: string }
): { path: string; diffLines: string[] } {
  const next: SemanticsRegister = registerFromSummary(summary, { force: options.force, acceptedAt: new Date().toISOString() });
  const path = acceptPath(summary.sampleRate, options.root);
  const previous = existsSync(path) ? parseSemanticsRegister(JSON.parse(readFileSync(path, "utf8"))) : null;
  const diff = registerDiff(previous, next);
  const diffLines: string[] = [];
  if (options.force) {diffLines.push("FORCED");}
  if (previous === null) {diffLines.push("no previous register");}
  if (diff.added.length > 0) {diffLines.push(`added: ${diff.added.join(", ")}`);}
  if (diff.removed.length > 0) {diffLines.push(`removed: ${diff.removed.join(", ")}`);}
  if (diff.changed.length > 0) {diffLines.push(`changed: ${diff.changed.join(", ")}`);}
  if (previous !== null && diffLines.length === (options.force ? 1 : 0)) {diffLines.push("no differences");}
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return { path, diffLines };
}

function runTokens(): number[] {
  let names: string[];
  try {
    names = readdirSync(VERIFY_DIR);
  } catch {
    return [];
  }
  return names
    .map((f) => SUMMARY_NAME.exec(f)?.[1])
    .filter((id): id is string => id !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

function main(): void {
  const args = process.argv.slice(2);
  const accept = args.includes("--accept");
  const force = args.includes("--force");
  const positional = args.find(a => !a.startsWith("--"));
  const token = positional !== undefined ? Number(positional) : runTokens().at(-1);
  if (token === undefined || !Number.isFinite(token) || !existsSync(resolve(VERIFY_DIR, summaryFileName(token)))) {
    console.error(`no midisem summary${token === undefined ? "" : ` ${token}`} in ${VERIFY_DIR}`);
    process.exit(1);
  }
  const summary = parseSemanticsSummary(JSON.parse(readFileSync(resolve(VERIFY_DIR, summaryFileName(token)), "utf8")), token);
  console.log("row | verdict | figure | read / readable (unreadable) | max |Δonset| ms | max |Δcents| | max |Δvel| | render ms");
  for (const line of formatRows(summary)) {console.log(line);}
  console.log(runLine(summary));
  if (accept) {
    try {
      const { path, diffLines } = writeAccepted(summary, { force });
      for (const line of diffLines) {console.log(line);}
      console.log(path);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {main();}
