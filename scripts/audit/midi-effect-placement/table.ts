/**
 * Register table from a MIDI effect placement audit summary in `.verify-output/`:
 *   node scripts/audit/midi-effect-placement/table.ts [runToken]
 * One line per row, then the run line. Newest summary when no token is given.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMidiEffectSummary, summaryFileName } from "../../../src/lib/audit/midiEffectArtifacts.ts";

const VERIFY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.verify-output");
const SUMMARY_NAME = /^midifx-summary-(\d+)\.json$/;

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

const token = process.argv[2] !== undefined ? Number(process.argv[2]) : runTokens().at(-1);
if (token === undefined || !Number.isFinite(token)) {
  console.error(`no midifx summary in ${VERIFY_DIR}`);
  process.exit(1);
}
const summary = parseMidiEffectSummary(JSON.parse(readFileSync(resolve(VERIFY_DIR, summaryFileName(token)), "utf8")), token);
const { sampleRate } = summary;
const ms = (frames: number): string => ((frames / sampleRate) * 1000).toFixed(2);

console.log("row | status | figure | lag frames / score | onsets found / expected | max |delta| frames (ms)");
for (const row of summary.rows) {
  const maxDelta = row.deltas.length === 0 ? null : row.deltas.reduce((m, d) => (Math.abs(d) > Math.abs(m) ? d : m), 0);
  console.log([
    row.id,
    row.status,
    row.figure ?? "—",
    row.lag === null || row.score === null ? "—" : `${row.lag} / ${row.score.toFixed(3)}`,
    `${row.onsets.length} / ${row.expectedCount}`,
    maxDelta === null ? "—" : `${maxDelta} (${ms(maxDelta)})`,
  ].join(" | "));
}
console.log(
  `run ${summary.runToken} | sdk ${summary.sdkVersion} | ${sampleRate} Hz | ${summary.bpm} bpm | `
  + `instrument offset ${summary.instrumentOffsetFrames} frames (${ms(summary.instrumentOffsetFrames)} ms) | device ${summary.deviceParam} | rows ${summary.rows.length}`,
);
