/**
 * The pattern the MIDI output timing audit plays, in absolute timeline pulses from an origin, and
 * the main-thread blocks a `jank` cell runs against it. The note shape (pitch cycle, velocities,
 * half-step holds) is the MIDI input alignment page's; the density and length are this page's.
 */
import { BAR_PPQN } from "./auditExpectations";
import { BEAT_PPQN, EIGHTH_BARS, THIRTYSECOND_BARS } from "./midiInputCalibration";
import { pitchForIndex, velocityForIndex, type PatternNote } from "./midiInputPattern";
import type { Density } from "./midiOutputParams";

export type OutputPatternNote = PatternNote;

const EIGHTH_STEP = BEAT_PPQN / 2;
const THIRTYSECOND_STEP = BEAT_PPQN / 8;

/** `density` over `bars` bars from `originPpqn`; `both` is the input page's shape (two bars of eighths, one of 1/32) whatever `bars` says. */
export function buildOutputPattern(density: Density, bars: number, originPpqn: number): OutputPatternNote[] {
  const notes: OutputPatternNote[] = [];
  const push = (tag: PatternNote["tag"], onPpqn: number, stepPpqn: number): void => {
    const index = notes.length;
    notes.push({ index, tag, pitch: pitchForIndex(index), velocity: velocityForIndex(index), onPpqn, durationPpqn: stepPpqn / 2, wrapAdjacent: false });
  };
  const eighths = (from: number, count: number): void => {
    for (let i = 0; i < count; i++) push("eighth", from + i * EIGHTH_STEP, EIGHTH_STEP);
  };
  const thirtyseconds = (from: number, count: number): void => {
    for (let i = 0; i < count; i++) push("thirtysecond", from + i * THIRTYSECOND_STEP, THIRTYSECOND_STEP);
  };
  if (density === "8th") eighths(originPpqn, bars * 8);
  else if (density === "32nd") thirtyseconds(originPpqn, bars * 32);
  else {
    eighths(originPpqn, EIGHTH_BARS * 8);
    thirtyseconds(originPpqn + EIGHTH_BARS * BAR_PPQN, THIRTYSECOND_BARS * 32);
  }
  return notes;
}

/** The last note's onset plus its step (a note is held for half its step). */
export function patternEndPpqnOf(notes: readonly OutputPatternNote[]): number {
  const last = notes[notes.length - 1];
  return last === undefined ? 0 : last.onPpqn + 2 * last.durationPpqn;
}

export const JANK_PERIOD_MS = 500;

/** A main-thread block's span on the performance clock: planned here, overwritten with the measured span by the runner. */
export interface JankBlock {
  startPerfMs: number;
  endPerfMs: number;
}

/** Blocks of `jankMs` from `midPerfMs`, every `JANK_PERIOD_MS`, while a block would start before `endPerfMs`. */
export function jankSchedule(midPerfMs: number, endPerfMs: number, jankMs: number): JankBlock[] {
  const blocks: JankBlock[] = [];
  for (let start = midPerfMs; start < endPerfMs; start += JANK_PERIOD_MS) blocks.push({ startPerfMs: start, endPerfMs: start + jankMs });
  return blocks;
}

export type JankLabel = "clear" | "inside" | "first-after";

/** Where a note's RENDER time falls: inside a block, within one step after one, or clear of all. */
export function jankLabelFor(renderPerfMs: number, blocks: readonly JankBlock[], stepMs: number): JankLabel {
  for (const block of blocks) {
    if (renderPerfMs >= block.startPerfMs && renderPerfMs <= block.endPerfMs) return "inside";
  }
  for (const block of blocks) {
    if (renderPerfMs > block.endPerfMs && renderPerfMs <= block.endPerfMs + stepMs) return "first-after";
  }
  return "clear";
}
