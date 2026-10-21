/**
 * What each stock MIDI effect is expected to do to a note's position, as pure functions of
 * the device's documented rule. The MIDI effect placement audit judges a rendered onset
 * against these; the rule, never the dry render, is the expectation for a device that is
 * meant to move notes. Register: `debug/2026-10-21-midi-effect-placement/note.md`.
 */
import { PPQN } from "@opendaw/lib-dsp";

/** The arpeggiator steps on the absolute grid `k × rate`; a note whose start is at or before a
 *  grid line is in the stack at that line, one that ends on a grid line is not. */
export function arpeggioSteps(holdFrom: number, holdTo: number, ratePpqn: number): number[] {
  const steps: number[] = [];
  for (let k = Math.ceil(holdFrom / ratePpqn); k * ratePpqn < holdTo; k++) steps.push(k * ratePpqn);
  return steps;
}

/** The echo script's rule: the original, then `repeats − 1` copies `delay` apart. */
export function echoCopies(position: number, delayPpqn: number, repeats: number): number[] {
  return Array.from({ length: repeats }, (_, i) => position + i * delayPpqn);
}

/** Each position through the groove the Zeitgeist device points at, as an integer pulse. */
export function zeitgeistWarped(positions: readonly number[], groove: { warp(position: number): number }): number[] {
  return positions.map((position) => Math.round(groove.warp(position)));
}

/** The frame a pulse position lands on at a constant tempo, plus what the instrument adds. */
export function expectedFrames(positions: readonly number[], bpm: number, rate: number, instrumentOffsetFrames: number): number[] {
  return positions.map((position) => Math.round(PPQN.pulsesToSeconds(position, bpm) * rate) + instrumentOffsetFrames);
}

/** What the instrument itself adds between a note's position and its first audible frame, read off the dry row. */
export function instrumentOffsetFrames(dryFirstOnset: number, firstPositionPpqn: number, bpm: number, rate: number): number {
  return dryFirstOnset - Math.round(PPQN.pulsesToSeconds(firstPositionPpqn, bpm) * rate);
}
