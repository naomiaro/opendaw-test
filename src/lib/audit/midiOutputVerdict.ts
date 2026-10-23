/**
 * The MIDI output timing audit's verdicts, pure and Node-tested. The PAGE arm is the control: it
 * must read zero (against the one pair its sends were built from) before anything the ENGINE arm
 * says can be read; the ENGINE arm is read against the live pair when the repeat sampled one. The engine arm is `on-time`
 * when it lands on the box delay, `matches-known-defect` when a band this file pins explains every
 * repeat, else `investigate`. Bands classify a raw figure from the row's own context; they never
 * net anything out. The table ships EMPTY and is filled from the first run's rows
 * (`debug/2026-10-23-midi-output-timing/note.md` says which).
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

export const MIDI_OUT_KNOWN_DEFECTS: readonly OutputKnownDefectBand[] = [];

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
  // The engine arm stamps with Chrome's LIVE clock relation, so it is read against the live pair when the repeat sampled one
  // (the relation moved by up to 3 ms within a repeat on the first runs); the one pair judges only when nothing was sampled.
  const quantum = quantumMs(ctx.sampleRate);
  const reference = referenceOf(repeats);
  const failure = integrityFailure(repeats) ?? figureFailure(repeats, ctx.delayInMs, quantum / 2, quantum, reference);
  if (failure === null) return { status: "on-time", detail: `every repeat clean, on the ${ctx.delayInMs} ms delay within half a quantum (${reference})` };
  const band = bands.find((b) => b.applies(ctx) && repeats.every((f) => b.matches(f, ctx)));
  if (band !== undefined) return { status: "matches-known-defect", detail: `${band.id}: ${band.detail}` };
  return { status: "investigate", detail: failure };
}
