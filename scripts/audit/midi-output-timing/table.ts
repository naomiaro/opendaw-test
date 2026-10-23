/**
 * Cell table from a MIDI output timing audit summary in `.verify-output/`:
 *   node scripts/audit/midi-output-timing/table.ts [runToken]
 * One line per cell (arm, tuple, status, median per repeat, spread, counts), then the run line.
 * Newest summary when no token is given.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CELL_TABLE_HEADER, cellTableLines, parseMidiOutputSummary, summaryFileName } from "../../../src/lib/audit/midiOutputArtifacts.ts";

const VERIFY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.verify-output");
const SUMMARY_NAME = /^midiout-summary-(\d+)\.json$/;

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
  console.error(`no midiout summary in ${VERIFY_DIR}`);
  process.exit(1);
}
const summary = parseMidiOutputSummary(JSON.parse(readFileSync(resolve(VERIFY_DIR, summaryFileName(token)), "utf8")), token);
console.log(CELL_TABLE_HEADER);
for (const line of cellTableLines(summary)) console.log(line);
const p = summary.params;
console.log(
  `run ${summary.runToken} | sdk ${summary.sdkVersion} | ${summary.chrome} | ${summary.date} | ${summary.sampleRate} Hz | `
  + `arms ${p.arms.join("+")} | bpm ${p.bpms.join(",")} | density ${p.densities.join(",")} | bars ${p.bars} | repeats ${p.repeats} | `
  + `delay ${p.delayInMs} ms | jank ${p.janks.join(",")} ${p.jankMs} ms | transport ${p.transports.map((t) => (t ? "on" : "off")).join(",")} | origin bar ${p.originBar} | bus ${p.bus}`,
);
