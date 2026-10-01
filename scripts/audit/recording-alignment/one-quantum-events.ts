/**
 * The one-quantum event over the release-build runs in `.verify-output/`: repeats and
 * events per SDK release, per harness stop and per scenario, each event with the figures
 * that show it, exact intervals for the rates, and Fisher's exact test between the groups.
 *
 *   node scripts/audit/recording-alignment/one-quantum-events.ts [--from <run id>]
 *
 * `--from` counts only runs with that id or a later one. A comparison that is to TEST
 * whether two groups differ has to leave out the runs that suggested the question.
 * `RECAUDIT_MAX_RUN=<run id>` leaves out every later run (see `artifacts.ts`), so a
 * tally quoted in the register can be printed again after more runs have landed.
 *
 * What counts as an event, which runs count as a release build, and how a run older than
 * the `sdkVersion` / `stopLead` envelope fields is assigned to a release and a harness,
 * is in `src/lib/audit/oneQuantumEvents.ts`.
 */
import { MAX_RUN, listMultitrackSummaryRunIds, loadMultitrackSummary, loadSummaries } from "./artifacts.ts";
import {
  eventsOfRun, exactRateInterval, fisherOneSided, harnessOf, quantumMs, repeatsOf, sdkOf,
  type EventRow, type HarnessStop, type RepeatReading, type RunIdentity,
} from "../../../src/lib/audit/oneQuantumEvents.ts";

const fromArgument = process.argv.indexOf("--from");
const fromRun = fromArgument >= 0 ? Number(process.argv[fromArgument + 1]) : 0;
if (!Number.isFinite(fromRun)) {
  console.error("--from takes a run id");
  process.exit(2);
}

/** The start-of-take figures a row may carry beyond what the counting reads. */
interface StartFigures {
  recordingStartContextTimeSec?: number | null;
  recordingStartPositionPpqn?: number | null;
  firstQuantumTimeSec?: number;
  regionPositionPpqn?: number;
  waveformOffsetSec?: number;
  loopbackDelayMs?: number | null;
  nodeDelayMs?: number | null;
  medianBeatErrorMsAdjusted?: number | null;
}

interface Run {
  kind: "single" | "multi";
  identity: RunIdentity;
  rate: number;
  rows: EventRow[];
}

const runs: Run[] = [];
for (const { summary } of loadSummaries()) {
  runs.push({
    kind: "single",
    identity: { runId: summary.runId, sdkVersion: summary.sdkVersion, stopLead: summary.stopLead, sdkBuildProbe: summary.sdkBuildProbe, buildFeatures: summary.buildFeatures },
    rate: summary.rate,
    rows: summary.rows,
  });
}
for (const runId of listMultitrackSummaryRunIds()) {
  const summary = loadMultitrackSummary(runId);
  runs.push({
    kind: "multi",
    identity: { runId: summary.runId, sdkVersion: summary.sdkVersion, stopLead: summary.stopLead, sdkBuildProbe: summary.sdkBuildProbe, buildFeatures: summary.buildFeatures },
    rate: summary.rate,
    rows: summary.rows,
  });
}

interface Tally { repeats: number; events: number }
const tallies = new Map<string, Tally>();
const bySdk = new Map<string, Tally>();
const byHarness = new Map<string, Tally>();
const byScenario = new Map<string, Tally>();
const bump = (map: Map<string, Tally>, key: string, repeats: number, events: number) => {
  const tally = map.get(key) ?? { repeats: 0, events: 0 };
  tally.repeats += repeats;
  tally.events += events;
  map.set(key, tally);
};
const eventLines: string[] = [];
const otherLines: string[] = [];
const describe = (reading: RepeatReading, usualMs: number, rate: number): string =>
  reading.rows.map((row) => {
    const figures = row as EventRow & StartFigures;
    const name = row.tape ?? `take ${String(row.takeIndex ?? 0)}`;
    const parts = [`netted ${(row.medianBeatErrorMsNetted as number).toFixed(3)} (usual ${usualMs.toFixed(3)})`];
    if (typeof row.firstFrameCheckMs === "number") parts.push(`first-frame check ${row.firstFrameCheckMs.toFixed(3)}`);
    if (typeof figures.nodeDelayMs === "number") parts.push(`node delay ${figures.nodeDelayMs.toFixed(3)}`);
    if (typeof figures.nodeDelayMs === "number" && typeof figures.medianBeatErrorMsAdjusted === "number") {
      parts.push(`adjusted − node delay ${(figures.medianBeatErrorMsAdjusted - figures.nodeDelayMs).toFixed(4)}`);
    }
    if (typeof figures.loopbackDelayMs === "number") parts.push(`loopback delay ${figures.loopbackDelayMs.toFixed(3)}`);
    if (typeof figures.regionPositionPpqn === "number") parts.push(`region position ${figures.regionPositionPpqn}`);
    if (typeof figures.waveformOffsetSec === "number") parts.push(`waveform offset ${(figures.waveformOffsetSec * 1000).toFixed(3)} ms`);
    if (typeof figures.recordingStartContextTimeSec === "number" && typeof figures.firstQuantumTimeSec === "number") {
      const quanta = ((figures.recordingStartContextTimeSec - figures.firstQuantumTimeSec) * rate) / 128;
      parts.push(`recording start − first quantum ${quanta.toFixed(3)} quanta`);
    }
    if (typeof figures.recordingStartPositionPpqn === "number") parts.push(`recording-start position ${figures.recordingStartPositionPpqn.toFixed(3)}`);
    return `${name}: ${parts.join(", ")}`;
  }).join("\n      ");

let skipped = 0;
let tooShort = 0;
let counted = 0;
for (const run of runs) {
  if (run.identity.runId < fromRun) continue;
  const sdk = sdkOf(run.identity);
  if (sdk === null) { skipped++; continue; }
  const { repeats, events, others, usualMs } = eventsOfRun(run.rows, run.rate);
  if (repeats === 0) continue;
  if (usualMs === null) { tooShort++; continue; }
  counted++;
  const harness: HarnessStop = harnessOf(run.identity, run.rows);
  bump(tallies, `${sdk} | ${harness} | ${run.kind} | ${run.rate}`, repeats, events.length);
  bump(bySdk, sdk, repeats, events.length);
  bump(byHarness, `${sdk} | ${harness}`, repeats, events.length);
  for (const reading of repeatsOf(run.rows)) bump(byScenario, `${sdk} | ${harness} | ${reading.scenario}`, 1, 0);
  const title = (reading: RepeatReading): string =>
    `${sdk} ${harness} ${run.kind} run ${run.identity.runId} ${reading.scenario}/${reading.bpm}/r${reading.repeat} ` +
    `(quantum ${quantumMs(run.rate).toFixed(3)} ms)\n      ${describe(reading, usualMs, run.rate)}`;
  for (const event of events) {
    bump(byScenario, `${sdk} | ${harness} | ${event.scenario}`, 0, 1);
    eventLines.push(title(event));
  }
  for (const other of others) otherLines.push(title(other));
}

const rateLine = ({ repeats, events }: Tally): string => {
  const [low, high] = exactRateInterval(events, repeats);
  return `${events} in ${repeats} (${((events / repeats) * 100).toFixed(2)} %, 95 % interval ${(low * 100).toFixed(2)}–${(high * 100).toFixed(2)} %)`;
};

console.log(
  `runs read: ${runs.length}` + (MAX_RUN === Infinity ? "" : ` (RECAUDIT_MAX_RUN=${MAX_RUN})`) +
  `, counted: ${counted}` + (fromRun > 0 ? ` (from run ${fromRun})` : "") +
  `, not release builds: ${skipped}, fewer than 3 repeats: ${tooShort}\n`
);
console.log("| SDK | harness stop | kind | rate | repeats | events |\n|---|---|---|---|---|---|");
for (const key of [...tallies.keys()].sort()) {
  const tally = tallies.get(key) as Tally;
  console.log(`| ${key.split(" | ").join(" | ")} | ${tally.repeats} | ${tally.events} |`);
}
console.log("\nPer SDK release:");
for (const key of [...bySdk.keys()].sort()) console.log(`  ${key}: ${rateLine(bySdk.get(key) as Tally)}`);
console.log("\nPer SDK release and harness stop:");
for (const key of [...byHarness.keys()].sort()) console.log(`  ${key}: ${rateLine(byHarness.get(key) as Tally)}`);

console.log("\nPer SDK release, harness stop and scenario:");
for (const key of [...byScenario.keys()].sort()) console.log(`  ${key}: ${rateLine(byScenario.get(key) as Tally)}`);

const releases = [...bySdk.keys()].sort();
const stops: HarnessStop[] = ["stop-lead", "stop-after-click"];
/** Both directions: which group holds more events is not known before the run. */
const compare = (label: string, nameA: string, a: Tally | undefined, nameB: string, b: Tally | undefined): void => {
  if (a === undefined || b === undefined) return;
  console.log(
    `Fisher, one-sided, ${label}: ${nameB} more than ${nameA} p = ${fisherOneSided(a.events, a.repeats, b.events, b.repeats).toFixed(3)}, ` +
    `${nameA} more than ${nameB} p = ${fisherOneSided(b.events, b.repeats, a.events, a.repeats).toFixed(3)}`
  );
};
console.log("");
for (let a = 0; a < releases.length; a++) {
  for (let b = a + 1; b < releases.length; b++) {
    compare("all runs", releases[a], bySdk.get(releases[a]), releases[b], bySdk.get(releases[b]));
    // The SDK question: the same harness stop on both releases
    for (const stop of stops) {
      compare(`${stop} only`, releases[a], byHarness.get(`${releases[a]} | ${stop}`), releases[b], byHarness.get(`${releases[b]} | ${stop}`));
    }
  }
}
// The harness question: the two stops on one release
for (const sdk of releases) {
  compare(`on ${sdk}`, "stop-after-click", byHarness.get(`${sdk} | stop-after-click`), "stop-lead", byHarness.get(`${sdk} | stop-lead`));
}

// Whether holding the main thread at the recording flip matters: the two multi-mic scenarios in one group
for (const key of [...byHarness.keys()].sort()) {
  compare(`${key}, by scenario`, "multitrack-start", byScenario.get(`${key} | multitrack-start`), "multitrack-janked", byScenario.get(`${key} | multitrack-janked`));
}

console.log(`\nEvents (${eventLines.length}):`);
for (const line of eventLines) console.log("  " + line);
if (otherLines.length > 0) {
  console.log(`\nRepeats off by something other than one quantum, not counted as events (${otherLines.length}):`);
  for (const line of otherLines) console.log("  " + line);
}
