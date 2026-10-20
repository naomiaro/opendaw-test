/**
 * The pattern the MIDI input alignment audit sends through the loopback, in
 * absolute linear timeline pulses (unwrapped across a loop). Every note is held
 * for half its step, so no note of this pattern is held across a loop end; the
 * only note that touches a loop end is the one ON it, tagged `wrapAdjacent`.
 */
import { PPQN } from "@opendaw/lib-dsp";
import { BAR_PPQN } from "./auditExpectations";
import {
  BEAT_PPQN, COUNT_IN_NOTES, EIGHTH_BARS, PATTERN_BARS, PATTERN_LEAD_MS, PITCH_BASE, PITCH_RANGE, THIRTYSECOND_BARS, VELOCITIES,
} from "./midiInputCalibration";

export type NoteTag = "eighth" | "thirtysecond" | "countin";

export interface PatternNote {
  index: number;
  tag: NoteTag;
  pitch: number;
  /** The MIDI velocity byte. */
  velocity: number;
  /** Absolute, linear timeline pulses (unwrapped across a loop). */
  onPpqn: number;
  /** Half the note's step. */
  durationPpqn: number;
  /** `onPpqn` is a multiple of the loop end (loop from 0). */
  wrapAdjacent: boolean;
}

export function pitchForIndex(index: number): number {
  return PITCH_BASE + (index % PITCH_RANGE);
}

export function velocityForIndex(index: number): number {
  return VELOCITIES[index % VELOCITIES.length];
}

/** The first bar line at or after `nowPpqn` plus the lead. */
export function patternOriginPpqn(nowPpqn: number, bpm: number, leadMs: number = PATTERN_LEAD_MS): number {
  return Math.ceil((nowPpqn + PPQN.secondsToPulses(leadMs / 1000, bpm)) / BAR_PPQN) * BAR_PPQN;
}

export function patternEndPpqn(originPpqn: number): number {
  return originPpqn + PATTERN_BARS * BAR_PPQN;
}

export function buildPattern({ originPpqn, loopEndPpqn }: { originPpqn: number; loopEndPpqn: number | null }): PatternNote[] {
  const notes: PatternNote[] = [];
  const push = (tag: NoteTag, onPpqn: number, stepPpqn: number): void => {
    const index = notes.length;
    notes.push({
      index,
      tag,
      pitch: pitchForIndex(index),
      velocity: velocityForIndex(index),
      onPpqn,
      durationPpqn: stepPpqn / 2,
      wrapAdjacent: loopEndPpqn !== null && onPpqn > 0 && onPpqn % loopEndPpqn === 0,
    });
  };
  const eighth = BEAT_PPQN / 2;
  for (let i = 0; i < EIGHTH_BARS * 8; i++) push("eighth", originPpqn + i * eighth, eighth);
  const thirtysecond = BEAT_PPQN / 8;
  const thirtysecondStart = originPpqn + EIGHTH_BARS * BAR_PPQN;
  for (let i = 0; i < THIRTYSECOND_BARS * 32; i++) push("thirtysecond", thirtysecondStart + i * thirtysecond, thirtysecond);
  return notes;
}

export interface CountInNote {
  pitch: number;
  velocity: number;
  /** After the record request, on the performance clock. */
  offsetMs: number;
  holdMs: number;
}

/** The count-in notes for a one-bar count-in at `bpm`; pitches above the pattern's range. */
export function countInSchedule(bpm: number): CountInNote[] {
  const barMs = (4 * 60_000) / bpm;
  return COUNT_IN_NOTES.map((note, i) => ({
    pitch: PITCH_BASE + PITCH_RANGE + 1 + i,
    velocity: 100,
    offsetMs: note.atBar * barMs,
    holdMs: "holdMs" in note ? note.holdMs : note.holdBars * barMs,
  }));
}
