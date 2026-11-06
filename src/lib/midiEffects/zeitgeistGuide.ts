/**
 * What the Zeitgeist's card explains on top of its controls. A groove bends time inside a repeating cell and leaves the
 * cell's boundaries where they are, so a note that starts on one does not move. On most patterns at the default Duration
 * that is every note, and the device looks broken: `stillnessOf` says so on the page, and the tries are settings where
 * the swing is plain. Cells count from position 0, not from the region's start, so positions are read absolute.
 */
import { GrooveShuffleBoxAdapter, type ZeitgeistDeviceBoxAdapter } from "@opendaw/studio-adapters";
import type { Editing } from "@opendaw/lib-std";
import { REGION_START_PPQN, type PatternId, type PatternNote } from "./patterns";

export interface ZeitgeistTry {
  readonly label: string;
  readonly pattern: PatternId;
  /** unit, the device's Amount */
  readonly amount: number;
  /** ppqn, twice the pattern's note spacing */
  readonly duration: number;
}

export const ZEITGEIST_TRIES: readonly ZeitgeistTry[] = [
  { label: "Sixteenths, 1/8", pattern: "sixteenths", amount: 0.75, duration: 480 },
  { label: "Eighths, 1/4", pattern: "eighths", amount: 0.75, duration: 960 },
  { label: "Quarters, 1/2", pattern: "quarters", amount: 0.75, duration: 1920 },
];

/** Why a pattern's notes do not swing at these settings; null when some note starts somewhere else. */
export type Stillness = "straight" | "nothing" | "ends-only";

const STRAIGHT_TOLERANCE = 1e-3;

export function stillnessOf(notes: readonly PatternNote[], amount: number, duration: number): Stillness | null {
  if (Math.abs(amount - 0.5) < STRAIGHT_TOLERANCE) return "straight";
  const onBoundary = (position: number): boolean => (REGION_START_PPQN + position) % duration === 0;
  if (!notes.every((note) => onBoundary(note.position))) return null;
  return notes.every((note) => onBoundary(note.position + note.duration)) ? "nothing" : "ends-only";
}

/** The sentence a card shows for a stillness. */
export const STILLNESS_SENTENCE: Readonly<Record<Stillness, string>> = {
  straight: "At 50 % time runs straight, so nothing moves. Raise the Amount to hear the swing.",
  nothing: "At this Duration nothing moves on this pattern: every note starts and ends on a cell boundary. Set the Duration to twice the note spacing, or try one of these.",
  "ends-only": "At this Duration every note still starts on a cell boundary, so only where the notes end shifts. Set the Duration to twice the note spacing to hear it swing.",
};

/** Above every stillness: nothing moves whatever the settings. */
export const SWITCHED_OFF_SENTENCE = "This Zeitgeist is switched off, so nothing moves. A try below switches it on.";

/** The Zeitgeist's groove when it is a shuffle, the only kind these pages offer controls for; null otherwise. */
export function zeitgeistShuffleOf(adapter: ZeitgeistDeviceBoxAdapter): GrooveShuffleBoxAdapter | null {
  const groove = adapter.groove();
  if (groove.isEmpty()) return null;
  const shuffle = groove.unwrap();
  return shuffle instanceof GrooveShuffleBoxAdapter ? shuffle : null;
}

/** One transaction, so one undo step. The caller writes the try's pattern. */
export function applyZeitgeistTry(editing: Editing, shuffle: GrooveShuffleBoxAdapter, entry: ZeitgeistTry): void {
  editing.modify(() => {
    shuffle.namedParameter.amount.setValue(entry.amount);
    shuffle.namedParameter.duration.setValue(entry.duration);
  });
}
