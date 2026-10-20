/**
 * Register table from a MIDI input alignment audit summary in `.verify-output/`:
 *   node scripts/audit/midi-input-alignment/table.ts [runToken]
 * One line per cell (median per repeat, spread, counts, frame and SDK term), then the
 * run line. Newest summary when no token is given.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMidiAuditSummary, summaryFileName, type MidiAuditRow } from "../../../src/lib/audit/midiInputArtifacts.ts";

const VERIFY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.verify-output");
const SUMMARY_NAME = /^midiaudit-summary-(\d+)\.json$/;

function runTokens(): number[] {
  return readdirSync(VERIFY_DIR)
    .map((f) => SUMMARY_NAME.exec(f)?.[1])
    .filter((id): id is string => id !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

const token = process.argv[2] !== undefined ? Number(process.argv[2]) : runTokens().at(-1);
if (token === undefined || !Number.isFinite(token)) {
  console.error(`no midiaudit summary in ${VERIFY_DIR}`);
  process.exit(1);
}
const summary = parseMidiAuditSummary(JSON.parse(readFileSync(resolve(VERIFY_DIR, summaryFileName(token)), "utf8")), token);

const ms = (v: number | null): string => (v === null ? "—" : v.toFixed(2));
const max = (values: Array<number | null>): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : Math.max(...present);
};
const sum = (rows: MidiAuditRow[], key: "missing" | "receiptsMissing" | "extra" | "stuck"): number =>
  rows.reduce((acc, r) => acc + r[key], 0);

console.log("scenario | bpm | status | median ms (per repeat) | max dev ms | missing/no-receipt/extra/stuck | frame ms | sdk term ms | detail");
for (const verdict of summary.cellVerdicts) {
  const rows = summary.rows.filter((r) => r.scenario === verdict.scenario && r.bpm === verdict.bpm);
  console.log([
    verdict.scenario,
    verdict.bpm,
    verdict.status,
    rows.map((r) => ms(r.placementMedianMs)).join(" / "),
    ms(max(rows.map((r) => r.placementMaxAbsDevMs))),
    `${sum(rows, "missing")}/${sum(rows, "receiptsMissing")}/${sum(rows, "extra")}/${sum(rows, "stuck")}`,
    ms(max(rows.map((r) => r.frameIntervalMs))),
    ms(max(rows.map((r) => r.sdkLatencyTermMs))),
    verdict.detail,
  ].join(" | "));
}
console.log(
  `run ${summary.runToken} | sdk ${summary.sdkVersion} | bus ${summary.busName} | ${summary.sampleRate} Hz | `
  + `display ${summary.displayRefreshHz === null ? "—" : summary.displayRefreshHz.toFixed(1)} Hz | repeats ${summary.repeatsPerCell} | rows ${summary.rows.length}`,
);
