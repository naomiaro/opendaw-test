/**
 * The MIDI output timing audit's verdicts, pure and Node-tested. The PAGE arm is the control: it
 * must read zero (against the one pair its sends were built from) before anything the ENGINE arm
 * says can be read; the ENGINE arm is read against the live pair when every repeat of the cell sampled one. The engine arm is `on-time`
 * when it lands on the box delay, `matches-known-defect` when a band this file pins explains every
 * repeat, else `investigate`. Bands classify a raw figure from the row's own context; they never
 * net anything out. The table holds the band run B's rows pinned
 * (`debug/2026-10-23-midi-output-timing/note.md` names the envelope).
 */
import { quantumMs } from "./midiInputAlignment";
import type { OutputRepeatFigures } from "./midiOutputTiming";

export type OutputCellStatus = "bus-true" | "on-time" | "matches-known-defect" | "investigate" | "not-judged";

export interface OutputVerdict {
  status: OutputCellStatus;
  /** For `not-judged`: `bus` (the control was not true) or `no-control` (no page arm in the run). */
  detail: string;
}

/** Chrome stamps a scheduled IAC send with the time asked for: the input page measured 0.000 ms on every note. */
export const PAGE_ARM_MAX_ABS_MS = 1;

export interface OutputBandContext {
  delayInMs: number;
  jankMs: number;
  jankActive: boolean;
  sampleRate: number;
}

export interface OutputKnownDefectBand {
  id: string;
  applies(ctx: OutputBandContext): boolean;
  matches(figures: OutputRepeatFigures, ctx: OutputBandContext): boolean;
  detail: string;
}

/**
 * The main-thread-base shape, pinned on the four engine repeats of run `midiout-summary-1792790180843.json`
 * (2026-10-23, jank 80 ms every 500 ms, 44.1 kHz; `debug/2026-10-23-midi-output-timing/note.md`, run B): the
 * notes clear of the blocks sit on the delay, a note rendered inside a block is requested when the block
 * ends (late by up to the block length), and a note whose on and off both render inside one block comes out
 * off-before-on (read as one `stuck` plus one `extra`). Every bound is computed from the row's own context.
 */
const MAIN_THREAD_BASE_RUN = "1792790180843";

const MAIN_THREAD_BASE: OutputKnownDefectBand = {
  id: "midi-out-main-thread-base",
  applies: (ctx) => ctx.jankActive,
  matches: (f, ctx) => {
    const quantum = quantumMs(ctx.sampleRate);
    // The cell's reference: live where sampled, else the one pair (the inside-block median and the overall spread stay on the one pair; their ranges are wide).
    const live = f.medianErrorLiveMs !== null && f.maxAbsDevOutsideBlocksLiveMs !== null;
    const median = live ? f.medianErrorLiveMs : f.medianErrorMs;
    const outsideDev = live ? f.maxAbsDevOutsideBlocksLiveMs : f.maxAbsDevOutsideBlocksMs;
    if (median === null || outsideDev === null || f.maxAbsDevMs === null || f.medianErrorInsideBlocksMs === null || f.notesInsideBlocks === 0) return false;
    return f.missing === 0
      && f.velocityMismatches === 0
      // The inversion, and only the inversion: every stuck note inside a block, one unplaced off per stuck note.
      && f.stuck === f.extra
      && f.stuck === f.stuckInsideBlocks
      && f.stuck <= f.notesInsideBlocks
      && Math.abs(median - ctx.delayInMs) <= quantum
      // The notes clear of every block keep the idle shape (two quanta: the first-after notes read up to 3.4 ms off on run B).
      && outsideDev <= 2 * quantum
      && f.medianErrorInsideBlocksMs >= ctx.delayInMs + ctx.jankMs / 4
      && f.medianErrorInsideBlocksMs <= ctx.delayInMs + ctx.jankMs + quantum
      && f.maxAbsDevMs <= ctx.jankMs + quantum;
  },
  detail: `notes rendered inside a main-thread block are requested when the block ends (the timestamp base is the ring read); a note whose on and off both render in one block comes out off-before-on (pinned on run ${MAIN_THREAD_BASE_RUN})`,
};

export const MIDI_OUT_KNOWN_DEFECTS: readonly OutputKnownDefectBand[] = [MAIN_THREAD_BASE];

export function isClean(f: OutputRepeatFigures): boolean {
  return f.missing === 0 && f.extra === 0 && f.stuck === 0 && f.velocityMismatches === 0;
}

/** The first integrity count that is not zero, named with its repeat; null when every repeat is clean. */
function integrityFailure(repeats: readonly OutputRepeatFigures[]): string | null {
  const counts: Array<keyof OutputRepeatFigures> = ["missing", "extra", "stuck", "velocityMismatches"];
  for (const [i, f] of repeats.entries()) {
    for (const count of counts) if (f[count] !== 0) return `${count} ${f[count]} on repeat ${i + 1}`;
  }
  return null;
}

/** Which clock reference a repeat is judged on: the live pair (per-frame `getOutputTimestamp` reads) when the repeat has one, else the one pair. */
type Reference = "live pair" | "one pair";

function referenceOf(repeats: readonly OutputRepeatFigures[]): Reference {
  return repeats.every((f) => f.medianErrorLiveMs !== null && f.maxAbsDevLiveMs !== null) ? "live pair" : "one pair";
}

/** The first repeat whose median or spread lies outside the given bounds, named; null when all are inside. */
function figureFailure(repeats: readonly OutputRepeatFigures[], centreMs: number, medianToleranceMs: number, maxAbsDevMs: number, reference: Reference): string | null {
  const live = reference === "live pair";
  for (const [i, f] of repeats.entries()) {
    const median = live ? f.medianErrorLiveMs : f.medianErrorMs;
    const dev = live ? f.maxAbsDevLiveMs : f.maxAbsDevMs;
    const medianName = live ? "medianErrorLiveMs" : "medianErrorMs";
    const devName = live ? "maxAbsDevLiveMs" : "maxAbsDevMs";
    if (median === null || dev === null) return `no figures on repeat ${i + 1}`;
    if (Math.abs(median - centreMs) > medianToleranceMs) return `${medianName} ${round(median)} outside ${round(centreMs)} ± ${round(medianToleranceMs)} on repeat ${i + 1}`;
    if (dev > maxAbsDevMs) return `${devName} ${round(dev)} > ${round(maxAbsDevMs)} on repeat ${i + 1}`;
  }
  return null;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

export function classifyPageCell(repeats: readonly OutputRepeatFigures[]): OutputVerdict {
  if (repeats.length === 0) return { status: "investigate", detail: "no repeats" };
  // The page arm is the BUS check: a receipt must carry the time the page asked for, so it is read against the one pair the sends were built from.
  const failure = integrityFailure(repeats) ?? figureFailure(repeats, 0, PAGE_ARM_MAX_ABS_MS, PAGE_ARM_MAX_ABS_MS, "one pair");
  return failure === null
    ? { status: "bus-true", detail: `every repeat clean, within ${PAGE_ARM_MAX_ABS_MS} ms of the one pair` }
    : { status: "investigate", detail: failure };
}

export function classifyEngineCell(
  repeats: readonly OutputRepeatFigures[],
  control: OutputVerdict | null,
  ctx: OutputBandContext,
  bands: readonly OutputKnownDefectBand[] = MIDI_OUT_KNOWN_DEFECTS,
): OutputVerdict {
  if (control === null) return { status: "not-judged", detail: "no-control" };
  if (control.status !== "bus-true") return { status: "not-judged", detail: "bus" };
  if (repeats.length === 0) return { status: "investigate", detail: "no repeats" };
  // The engine arm stamps with Chrome's LIVE clock relation, so it is read against the live pair when every repeat sampled one
  // (the relation moved by ±3 ms, 6 ms peak to peak, within a repeat on the first runs); the one pair judges otherwise.
  const quantum = quantumMs(ctx.sampleRate);
  const reference = referenceOf(repeats);
  const failure = integrityFailure(repeats) ?? figureFailure(repeats, ctx.delayInMs, quantum / 2, quantum, reference);
  if (failure === null) return { status: "on-time", detail: `every repeat clean, on the ${ctx.delayInMs} ms delay within half a quantum (${reference})` };
  // A band may explain an integrity count too (the off-before-on inversion reads as stuck + extra), so it is tried on any failure.
  const band = bands.find((b) => b.applies(ctx) && repeats.every((f) => b.matches(f, ctx)));
  if (band !== undefined) return { status: "matches-known-defect", detail: `${band.id}: ${band.detail}` };
  return { status: "investigate", detail: failure };
}

/** The page cell's verdict when some repeats produced no figures: a failed repeat fails the cell, named by count. */
export function pageCellVerdict(figures: readonly OutputRepeatFigures[], failedRepeats: number): OutputVerdict {
  if (failedRepeats > 0) return { status: "investigate", detail: `${failedRepeats} of ${figures.length + failedRepeats} page repeats failed` };
  return classifyPageCell(figures);
}

/** The engine cell's verdict: the control is checked FIRST (a cell without a true control is never read), then failed repeats, then the figures. */
export function engineCellVerdict(
  figures: readonly OutputRepeatFigures[],
  failedRepeats: number,
  control: OutputVerdict | null,
  ctx: OutputBandContext,
  bands: readonly OutputKnownDefectBand[] = MIDI_OUT_KNOWN_DEFECTS,
): OutputVerdict {
  if (control === null) return { status: "not-judged", detail: "no-control" };
  if (control.status !== "bus-true") return { status: "not-judged", detail: "bus" };
  if (failedRepeats > 0) return { status: "investigate", detail: `${failedRepeats} of ${figures.length + failedRepeats} engine repeats failed` };
  return classifyEngineCell(figures, control, ctx, bands);
}

