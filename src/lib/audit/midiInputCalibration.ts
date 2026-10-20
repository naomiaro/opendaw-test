/**
 * Calibration for the MIDI input alignment audit
 * (`midi-input-alignment-audit-debug-demo.html`): scenarios, tempi, the pattern's
 * shape and the tolerances a cell is held to. Register:
 * `debug/2026-10-20-midi-input-alignment/note.md`.
 *
 * The verdict judges the RAW error against the heard beat; no latency term is
 * netted out (see the register for why). Every tolerance below states the
 * mechanism it comes from; a number without one is a fit, and fits are not
 * allowed here.
 */
import { PPQN } from "@opendaw/lib-dsp";
import { BAR_PPQN } from "./auditExpectations";

export const MIDI_AUDIT_SCENARIOS = [
  "nominal-start", "janked-start", "janked-mid", "countin-start", "midtimeline-start", "loop-wrap",
] as const;
export type MidiScenario = (typeof MIDI_AUDIT_SCENARIOS)[number];

export function isMidiScenario(value: string): value is MidiScenario {
  return (MIDI_AUDIT_SCENARIOS as readonly string[]).includes(value);
}

export const MIDI_AUDIT_BPMS = [90, 120, 140] as const;
export const MIDI_REPEATS_PER_CELL = 2;

export const BEAT_PPQN = BAR_PPQN / 4;
/** Two bars of eighth notes, then one bar of 1/32 notes (the fast-pattern shape of openDAW#356). */
export const EIGHTH_BARS = 2;
export const THIRTYSECOND_BARS = 1;
export const PATTERN_BARS = EIGHTH_BARS + THIRTYSECOND_BARS;
/** The pattern starts on the first bar line at least this long after the anchor is known. */
export const PATTERN_LEAD_MS = 300;
export const LOOP_WRAP_PPQN = 2 * BAR_PPQN;
export const MIDTIMELINE_START_PPQN = 2 * BAR_PPQN;
/** The stop request follows the pattern's end by this much; every note is released before it. */
export const STOP_AFTER_PATTERN_PPQN = BEAT_PPQN;
/** `janked-mid` blocks the main thread from the middle of the pattern's bar two. */
export const JANK_MID_OFFSET_PPQN = BAR_PPQN + BAR_PPQN / 2;

export const PITCH_BASE = 36;
/** Longer than any held step, so a pitch is never re-triggered while it is held. */
export const PITCH_RANGE = 48;
export const VELOCITIES = [100, 64, 127, 32] as const;
/**
 * `countin-start` sends three unanchored notes during the one-bar count-in, as fractions of
 * the bar after the record request: two short ones released inside the bar, and one pressed
 * at three quarters and held half a bar, so it is still down at the downbeat.
 */
export const COUNT_IN_NOTES = [
  { atBar: 0.15, holdMs: 100 },
  { atBar: 0.35, holdMs: 100 },
  { atBar: 0.75, holdBars: 0.5 },
] as const;

export interface MidiTolerances {
  placementMs: number;
  spreadMs: number;
  durationMs: number;
  matchWindowPpqn: number;
}

export const MIDI_TOLERANCES: MidiTolerances = {
  // One render quantum at 48 kHz is 2.67 ms; a pulse at 90 bpm is 0.69 ms. A median
  // past this is not placement noise.
  placementMs: 3,
  // The largest deviation from the median: the same quantum. Jitter wider than a
  // quantum is a defect, not a resolution.
  spreadMs: 3,
  // A duration is written from two stamps; each carries at most the placement error.
  durationMs: 3,
  // An eighth note. The 1/32 bar has distinct pitches, so the window never spans two
  // notes of one pitch.
  matchWindowPpqn: PPQN.Quarter / 2,
};

/** The length the recorder writes a key at before its release is known (a 1/128 note); a recorded note this short
 *  that was sent longer is a release the recorder lost. */
export const RECORDER_MIN_NOTE_PPQN = PPQN.fromSignature(1, 128);

export const MIDI_BUS_DEFAULT = "IAC";
