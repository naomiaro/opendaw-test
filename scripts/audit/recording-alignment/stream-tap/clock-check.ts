/**
 * Do the worklet clock and the clock the reference clicks are scheduled on agree
 * during a take?
 *
 * Reads the clicks out of each row's saved WAV and puts them on the context's clock
 * by the row's anchor: the anchor is the median of (scheduled − found), so a click
 * found at `fileTimeSec` was scheduled at `anchorT0Sec + fileTimeSec`. Against that
 * it holds the frame at which the harness's tap saw the same click go into the
 * stream: the tap's window opens 64 frames before its first loud sample, the tap is
 * stamped by a worklet's `currentFrame`, and the node's delay is taken off.
 *
 * A window that opened on the onset of a click reads the same few frames on every
 * row when the two clocks agree. A reading that is a whole number of render quanta
 * off that, or that puts the sample before its click was scheduled, is what this
 * script is for: it is printed on its own line in the summary and the script exits
 * with 1. A reading one quantum late cannot be told from a window that opened 134
 * frames into a click, so it is flagged all the same. A window that opened on the
 * metronome, part-way into a click, or where the window before it ended says nothing
 * either way.
 *
 * Run from the repo root, on a run whose rows carry node delays and whose WAVs are
 * in `.verify-output/`:
 *   node scripts/audit/recording-alignment/stream-tap/clock-check.ts <run id> [scenario]
 */
import { existsSync, readFileSync } from "node:fs";
import { bandSplit, buildReferenceSchedule, identifyReferenceClicks } from "../../../../src/lib/audit/recordingAlignment.ts";
import { detectOnsets } from "../../../../src/lib/audit/onsetDetection.ts";
import { NODE_TAP_QUANTUM_FRAMES, NODE_TAP_WINDOW_FRAMES, NODE_TAP_WINDOW_LEAD_FRAMES } from "../../../../src/lib/audit/nodeTap.ts";
import type { MultitrackAuditRow } from "../../../../src/lib/audit/recordingAuditArtifacts";

/** How long a reference click lasts (`REF_CLICK_DURATION_SEC` of the loopback). */
const CLICK_SEC = 0.008;
/** The first sample above the tap's threshold is this many frames into a click at most, at its onset. */
const ONSET_FRAMES = 16;
/** How many render quanta either way a reading is held against. */
const QUANTA_LOOKED_FOR = 4;

function readWav(path: string): { rate: number; mono: Float32Array } {
  const bytes = readFileSync(path);
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path}: not a RIFF WAVE file`);
  }
  let at = 12;
  let format = 0, channels = 0, rate = 0, bits = 0, dataAt = -1, dataLength = 0;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("ascii", at, at + 4);
    const length = bytes.readUInt32LE(at + 4);
    if (id === "fmt ") {
      format = bytes.readUInt16LE(at + 8);
      channels = bytes.readUInt16LE(at + 10);
      rate = bytes.readUInt32LE(at + 12);
      bits = bytes.readUInt16LE(at + 22);
    }
    // A size that runs past the file (a stream's placeholder, a cut-off file) ends at the file.
    if (id === "data") { dataAt = at + 8; dataLength = Math.min(length, bytes.length - dataAt); break; }
    at += 8 + length + (length % 2);
  }
  if (dataAt < 0 || channels === 0) throw new Error(`${path}: no fmt or no data chunk`);
  if (!(format === 3 && bits === 32) && !(format === 1 && (bits === 16 || bits === 32))) {
    throw new Error(`${path}: format ${format} at ${bits} bits is not read here`);
  }
  const frames = Math.floor(dataLength / (channels * (bits / 8)));
  // The first channel: the harness records one.
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const offset = dataAt + i * channels * (bits / 8);
    mono[i] = format === 3
      ? bytes.readFloatLE(offset)
      : bits === 16 ? bytes.readInt16LE(offset) / 32768 : bytes.readInt32LE(offset) / 2147483648;
  }
  return { rate, mono };
}

type Reading =
  | { kind: "onset"; frames: number }
  | { kind: "quanta-off"; frames: number; quanta: number }
  | { kind: "before-the-click"; frames: number }
  | { kind: "inside-a-click"; frames: number }
  | { kind: "metronome" }
  | { kind: "not-on-its-sample" };

/**
 * What a window's distance from the nearest scheduled click says. A sample later than
 * a click lasts, or earlier than the quanta looked for, is not that click's: it is the
 * metronome's.
 */
function read(nearest: number, rate: number): Reading {
  const earliest = -QUANTA_LOOKED_FOR * NODE_TAP_QUANTUM_FRAMES;
  const latest = Math.max(CLICK_SEC * rate, QUANTA_LOOKED_FOR * NODE_TAP_QUANTUM_FRAMES + ONSET_FRAMES);
  if (nearest < earliest || nearest > latest) return { kind: "metronome" };
  if (nearest >= 0 && nearest <= ONSET_FRAMES) return { kind: "onset", frames: nearest };
  for (let quanta = 1; quanta <= QUANTA_LOOKED_FOR; quanta++) {
    for (const sign of [1, -1]) {
      const from = nearest - sign * quanta * NODE_TAP_QUANTUM_FRAMES;
      if (from >= 0 && from <= ONSET_FRAMES) return { kind: "quanta-off", frames: nearest, quanta: sign * quanta };
    }
  }
  return nearest < 0 ? { kind: "before-the-click", frames: nearest } : { kind: "inside-a-click", frames: nearest };
}

function describe(reading: Reading): string {
  switch (reading.kind) {
    case "onset": return String(reading.frames);
    case "quanta-off": return reading.quanta > 0
      ? `${reading.frames} (+${reading.quanta} quanta OFF AN ONSET, or that far into a click)`
      : `${reading.frames} (${reading.quanta} quanta OFF AN ONSET)`;
    case "before-the-click": return `${reading.frames} (BEFORE ITS CLICK WAS SCHEDULED)`;
    case "inside-a-click": return `inside a click (${reading.frames})`;
    case "metronome": return "metronome";
    case "not-on-its-sample": return "opened where the window before ended";
  }
}

const [runId, scenario] = process.argv.slice(2);
if (runId === undefined) {
  throw new Error("usage: node scripts/audit/recording-alignment/stream-tap/clock-check.ts <run id> [scenario]");
}
const summaryPath = `.verify-output/recaudit-mt-summary-${runId}.json`;
if (!existsSync(summaryPath)) throw new Error(`${summaryPath} is not there: run from the repo root, on a run saved on this machine`);
const run = JSON.parse(readFileSync(summaryPath, "utf8")) as { rows: MultitrackAuditRow[] };

const readings: Reading[] = [];
const skipped = new Map<string, number>();
const skip = (why: string) => skipped.set(why, (skipped.get(why) ?? 0) + 1);
let rowsRead = 0;
for (const row of run.rows) {
  if (scenario !== undefined && row.scenario !== scenario) continue;
  const { nodeDelayFrames, nodeTapWindows, anchorT0Sec, wavName } = row;
  if (typeof nodeDelayFrames !== "number" || nodeTapWindows === undefined) { skip("no node delay"); continue; }
  if (typeof anchorT0Sec !== "number") { skip("no anchor"); continue; }
  if (typeof wavName !== "string") { skip("no WAV named"); continue; }
  if (!existsSync(`.verify-output/${wavName}`)) { skip("WAV not on this machine"); continue; }
  const { rate, mono } = readWav(`.verify-output/${wavName}`);
  const onsets = detectOnsets(bandSplit(mono, rate).high, rate, { refractorySec: 0.05 });
  // Only the gaps identify a click, so where the schedule starts does not matter.
  const clicks = identifyReferenceClicks(onsets, buildReferenceSchedule(0, 60, 0.25, 0.005));
  const scheduled = clicks.map((click) => Math.round((anchorT0Sec + click.fileTimeSec) * rate));
  const ofRow = nodeTapWindows.map((window, index): Reading => {
    // A window opens a lead before its first loud sample, unless that would reach into
    // the window before it: then it opens where that one ended, and where its sample
    // is cannot be said from here.
    const before = index > 0 ? nodeTapWindows[index - 1] : undefined;
    if (before !== undefined && window.startFrame === before.startFrame + NODE_TAP_WINDOW_FRAMES) {
      return { kind: "not-on-its-sample" };
    }
    const wentIn = window.startFrame + NODE_TAP_WINDOW_LEAD_FRAMES - window.lagFrames;
    let nearest = Infinity;
    for (const frame of scheduled) if (Math.abs(wentIn - frame) < Math.abs(nearest)) nearest = wentIn - frame;
    return read(nearest, rate);
  });
  readings.push(...ofRow);
  rowsRead++;
  const check = typeof row.firstFrameCheckMs === "number" ? row.firstFrameCheckMs.toFixed(2) : "—";
  const netted = typeof row.medianBeatErrorMsNetted === "number" ? row.medianBeatErrorMsNetted.toFixed(2) : "—";
  console.log(
    `${row.scenario} r${row.repeat}${row.tape}  first-frame check ${check}  netted ${netted}  clicks found ${clicks.length}` +
    `  | frames from a scheduled click to where the tap saw it go in: ${ofRow.map(describe).join(", ")}`
  );
}

const counted = (values: number[]): string => {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts.size === 0
    ? "none"
    : [...counts.entries()].sort((x, y) => x[0] - y[0]).map(([frames, count]) => `${frames} frames ×${count}`).join(", ");
};
const framesOf = (kind: "onset" | "quanta-off" | "before-the-click" | "inside-a-click"): number[] =>
  readings.flatMap((reading) => (reading.kind === kind ? [reading.frames] : []));
const off = framesOf("quanta-off");
const early = framesOf("before-the-click");
console.log(`\nrun ${runId}: ${rowsRead} rows read`);
for (const [why, count] of skipped) console.log(`  rows left out, ${why}: ${count}`);
console.log(`  windows on the onset of a click: ${counted(framesOf("onset"))}`);
console.log(`  WHOLE QUANTA OFF AN ONSET: ${counted(off)}`);
console.log(`  BEFORE THEIR CLICK WAS SCHEDULED: ${counted(early)}`);
console.log(`  part-way into a click: ${counted(framesOf("inside-a-click"))}`);
console.log(`  on the metronome: ${readings.filter((reading) => reading.kind === "metronome").length}`);
console.log(`  opened where the window before ended: ${readings.filter((reading) => reading.kind === "not-on-its-sample").length}`);
if (rowsRead === 0) {
  console.log("  nothing was checked");
  process.exitCode = 2;
} else if (off.length > 0 || early.length > 0) {
  process.exitCode = 1;
}
