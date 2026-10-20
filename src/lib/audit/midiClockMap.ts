/**
 * Clocks of the MIDI input alignment audit.
 *
 * A Web MIDI stamp is on the performance clock. `AudioContext.getOutputTimestamp()`
 * pairs a performance time with the context time of the audio LEAVING the device at
 * that moment, so a stamp mapped through the pair is on the heard clock. The engine's
 * recording anchor (`engine.recordingStart`) pairs a context time with a position;
 * the processor reports the post-render state position with the quantum END time
 * ("the state position is post-render: report the quantum end"), so position and
 * time belong to the same instant. With a fixed bpm the position is linear from there.
 */
import { PPQN } from "@opendaw/lib-dsp";

/** `AudioContext.getOutputTimestamp()`. */
export interface OutputStampPair {
  contextTime: number;
  performanceTime: number;
}

/** `engine.recordingStart.unwrap()`. */
export interface RecordingAnchor {
  contextTime: number;
  position: number;
}

export function heardContextSecAt(pair: OutputStampPair, perfMs: number): number {
  return pair.contextTime + (perfMs - pair.performanceTime) / 1000;
}

export function perfMsAtHeardContextSec(pair: OutputStampPair, ctxSec: number): number {
  return pair.performanceTime + (ctxSec - pair.contextTime) * 1000;
}

export function positionAtContextSec(anchor: RecordingAnchor, bpm: number, ctxSec: number): number {
  return anchor.position + PPQN.secondsToPulses(ctxSec - anchor.contextTime, bpm);
}

export function contextSecAtPosition(anchor: RecordingAnchor, bpm: number, ppqn: number): number {
  return anchor.contextTime + PPQN.pulsesToSeconds(ppqn - anchor.position, bpm);
}

export function pulsesToMs(ppqn: number, bpm: number): number {
  return (ppqn / PPQN.Quarter) * (60_000 / bpm);
}

/** An anchor reported for THIS repeat's record request, not one left from the repeat before. */
export function isFreshAnchor(anchor: RecordingAnchor, recordRequestContextTime: number): boolean {
  return anchor.contextTime >= recordRequestContextTime;
}

/** The rendered position at the moment a heard position reaches the listener. */
export function renderPpqnFromHeard(heardPpqn: number, outputLatencySec: number, bpm: number): number {
  return heardPpqn + PPQN.secondsToPulses(outputLatencySec, bpm);
}
