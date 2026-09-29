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
 * row when the two clocks agree. One that opened on the metronome, or part-way into
 * a click, says nothing either way and is printed as such.
 *
 * Run from the repo root, on a run whose rows carry node delays and whose WAVs are
 * in `.verify-output/`:
 *   node scripts/audit/recording-alignment/stream-tap/clock-check.ts <run id> [scenario]
 */
import { readFileSync } from "node:fs";
import { bandSplit, buildReferenceSchedule, identifyReferenceClicks } from "../../../../src/lib/audit/recordingAlignment.ts";
import { detectOnsets } from "../../../../src/lib/audit/onsetDetection.ts";
import { NODE_TAP_WINDOW_LEAD_FRAMES } from "../../../../src/lib/audit/nodeTap.ts";
import type { MultitrackAuditRow } from "../../../../src/lib/audit/recordingAuditArtifacts";

/** A click lasts 8 ms; a first loud sample further than this from every click is the metronome's. */
const NEAR_A_CLICK_SEC = 0.04;
/** The first sample above the tap's threshold is this many frames into a click at most, at its onset. */
const ONSET_FRAMES = 16;

function readWav(path: string): { rate: number; mono: Float32Array } {
  const bytes = readFileSync(path);
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
    if (id === "data") { dataAt = at + 8; dataLength = length; break; }
    at += 8 + length + (length % 2);
  }
  if (dataAt < 0 || channels === 0) throw new Error(`${path}: not a WAV this script reads`);
  if (!(format === 3 && bits === 32) && !(format === 1 && (bits === 16 || bits === 32))) {
    throw new Error(`${path}: format ${format} at ${bits} bits is not read here`);
  }
  const frames = Math.floor(dataLength / (channels * (bits / 8)));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const offset = dataAt + i * channels * (bits / 8);
    mono[i] = format === 3
      ? bytes.readFloatLE(offset)
      : bits === 16 ? bytes.readInt16LE(offset) / 32768 : bytes.readInt32LE(offset) / 2147483648;
  }
  return { rate, mono };
}

const [runId, scenario] = process.argv.slice(2);
if (runId === undefined) {
  throw new Error("usage: node scripts/audit/recording-alignment/stream-tap/clock-check.ts <run id> [scenario]");
}
const run = JSON.parse(readFileSync(`.verify-output/recaudit-mt-summary-${runId}.json`, "utf8")) as { rows: MultitrackAuditRow[] };
const tally = { onset: new Map<number, number>(), insideAClick: 0, metronome: 0, rows: 0 };
for (const row of run.rows) {
  if (scenario !== undefined && row.scenario !== scenario) continue;
  const { nodeDelayFrames, nodeTapWindows, anchorT0Sec, wavName } = row;
  if (typeof nodeDelayFrames !== "number" || nodeTapWindows === undefined) continue;
  if (typeof anchorT0Sec !== "number" || typeof wavName !== "string") continue;
  const { rate, mono } = readWav(`.verify-output/${wavName}`);
  const onsets = detectOnsets(bandSplit(mono, rate).high, rate, { refractorySec: 0.05 });
  // Only the gaps identify a click, so where the schedule starts does not matter.
  const clicks = identifyReferenceClicks(onsets, buildReferenceSchedule(0, 60, 0.25, 0.005));
  const scheduled = clicks.map((click) => Math.round((anchorT0Sec + click.fileTimeSec) * rate));
  const read = nodeTapWindows.map((window) => {
    const wentIn = window.startFrame + NODE_TAP_WINDOW_LEAD_FRAMES - window.lagFrames;
    let nearest = Infinity;
    for (const frame of scheduled) if (Math.abs(wentIn - frame) < Math.abs(nearest)) nearest = wentIn - frame;
    if (Math.abs(nearest) > NEAR_A_CLICK_SEC * rate) { tally.metronome++; return "metronome"; }
    if (nearest < 0 || nearest > ONSET_FRAMES) { tally.insideAClick++; return `inside a click (${nearest})`; }
    tally.onset.set(nearest, (tally.onset.get(nearest) ?? 0) + 1);
    return String(nearest);
  });
  tally.rows++;
  const check = typeof row.firstFrameCheckMs === "number" ? row.firstFrameCheckMs.toFixed(2) : "—";
  const netted = typeof row.medianBeatErrorMsNetted === "number" ? row.medianBeatErrorMsNetted.toFixed(2) : "—";
  console.log(
    `${row.scenario} r${row.repeat}${row.tape}  first-frame check ${check}  netted ${netted}  clicks found ${clicks.length}` +
    `  | frames from a scheduled click to where the tap saw it go in: ${read.join(", ")}`
  );
}
const onsets = [...tally.onset.entries()].sort((x, y) => x[0] - y[0]).map(([frames, count]) => `${frames} frames ×${count}`);
console.log(
  `\nrun ${runId}: ${tally.rows} rows; windows on the onset of a click: ${onsets.length > 0 ? onsets.join(", ") : "none"};` +
  ` part-way into a click ${tally.insideAClick}; on the metronome ${tally.metronome}`
);
