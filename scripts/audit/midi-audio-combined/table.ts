/**
 * Register table from a combined MIDI + audio audit summary in `.verify-output/`:
 *   node scripts/audit/midi-audio-combined/table.ts [runToken]
 * One line per (scenario, state) cell, then the run line. Newest summary when no token is given.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { combinedSummaryFileName, parseCombinedSummary, type CombinedRow } from "../../../src/lib/audit/combinedArtifacts.ts";

const VERIFY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.verify-output");
const SUMMARY_NAME = /^combined-summary-(\d+)\.json$/;

function runTokens(): number[] {
  return readdirSync(VERIFY_DIR)
    .map((f) => SUMMARY_NAME.exec(f)?.[1])
    .filter((id): id is string => id !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

const token = process.argv[2] !== undefined ? Number(process.argv[2]) : runTokens().at(-1);
if (token === undefined || !Number.isFinite(token)) {
  console.error(`no combined summary in ${VERIFY_DIR}`);
  process.exit(1);
}
const summary = parseCombinedSummary(JSON.parse(readFileSync(resolve(VERIFY_DIR, combinedSummaryFileName(token)), "utf8")), token);

const ms = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : v.toFixed(2));
const max = (values: Array<number | null | undefined>): number | null => {
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  return present.length === 0 ? null : Math.max(...present);
};
const sum = (rows: CombinedRow[], key: "clicksFound" | "clicksMissing" | "clicksExtra"): number =>
  rows.filter((r) => r.status !== "error").reduce((a, r) => a + r[key], 0);

console.log("scenario | state | status | parts apart median ms (per repeat) | max dev ms | clicks found/missing/extra | midi median ms | audio median ms | mic round trip / input part / applied ms | detail");
for (const v of summary.cellVerdicts) {
  const rows = summary.rows.filter((r) => r.scenario === v.scenario && r.state === v.state);
  console.log([
    v.scenario,
    v.state,
    v.status,
    rows.map((r) => ms(r.partsApartMedianMs)).join(" / "),
    ms(max(rows.map((r) => r.partsApartMaxAbsDevMs))),
    `${sum(rows, "clicksFound")}/${sum(rows, "clicksMissing")}/${sum(rows, "clicksExtra")}`,
    rows.map((r) => ms(r.midi?.placementMedianMs)).join(" / "),
    rows.map((r) => ms(r.audioMedianMs)).join(" / "),
    `${ms(max(rows.map((r) => r.micRoundTripMs)))} / ${ms(max(rows.map((r) => r.micInputPartMs)))} / ${ms(max(rows.map((r) => r.inputLatencyAppliedMs)))}`,
    v.detail,
    ...rows.filter((r) => r.status === "error").map((r) => `r${r.repeat} error: ${r.detail ?? ""}`),
  ].join(" | "));
}
const mic = summary.micRoundTrip;
console.log(
  `run ${summary.runToken} | sdk ${summary.sdkVersion} | in "${summary.inputDevice}" out "${summary.outputDevice}" | bus ${summary.busName} | ${summary.sampleRate} Hz | `
  + `mic round trip ${mic.roundTripMs.toFixed(2)} ms (spread ${mic.roundTripSpreadMs.toFixed(2)}), input part ${mic.inputPartMs.toFixed(2)} at output latency ${mic.outputLatencyMs.toFixed(1)} | `
  + `repeats ${summary.repeatsPerCell} | rows ${summary.rows.length}`,
);
