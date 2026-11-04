/**
 * The MIDI effects demos' patterns: four two-bar phrases at 120 bpm, each written for the devices
 * it serves (the MIDI pages under `src/demos/midi/`; the audits and the Nano play-modes page read them too).
 * `writePattern` replaces a region's notes the way the placement audit does: the old boxes go in
 * one transaction, the new ones come in an `append` folded into the same undo step.
 */
import { PPQN, type ppqn } from "@opendaw/lib-dsp";
import type { NoteEventBox, NoteRegionBox } from "@opendaw/studio-boxes";
import type { Project } from "@opendaw/studio-core";

export const PATTERN_BPM = 120;
export const BAR_PPQN = PPQN.fromSignature(4, 4);
export const PATTERN_PPQN = 2 * BAR_PPQN;
/** Where the note region starts: bar 1, so nothing sounds in bar 0 and the render's start is clear of every onset. */
export const REGION_START_PPQN: ppqn = BAR_PPQN;

export type PatternId = "chords" | "sixteenths" | "melody" | "bass";

export interface PatternNote {
  /** region-local pulses */
  readonly position: ppqn;
  readonly duration: ppqn;
  readonly pitch: number;
  readonly velocity: number;
}

export interface Pattern {
  readonly id: PatternId;
  readonly label: string;
  readonly blurb: string;
  readonly notes: readonly PatternNote[];
}

const { Quarter, SemiQuaver } = PPQN;
const HALF_BAR = BAR_PPQN / 2;
const EIGHTH = Quarter / 2;
const THIRTY_SECOND = SemiQuaver / 2;

/** Am, F, C, G as triads around C3, one per half bar, each held its half bar. */
const CHORD_TRIADS: readonly (readonly number[])[] = [
  [57, 60, 64],
  [53, 57, 60],
  [60, 64, 67],
  [55, 59, 62],
];

const chords: readonly PatternNote[] = CHORD_TRIADS.flatMap((triad, index) =>
  triad.map((pitch) => ({ position: index * HALF_BAR, duration: HALF_BAR, pitch, velocity: 0.8 }))
);

const sixteenths: readonly PatternNote[] = Array.from({ length: 32 }, (_, k) => ({
  position: k * SemiQuaver,
  duration: THIRTY_SECOND,
  pitch: 60,
  velocity: k % 2 === 0 ? 1 : 0.6,
}));

/** One bar of eighths in C major within an octave, velocities rising 0.4 to 1.0, repeated. */
const MELODY_BAR: readonly number[] = [60, 64, 67, 69, 67, 64, 62, 71];
const melody: readonly PatternNote[] = [0, 1].flatMap((bar) =>
  MELODY_BAR.map((pitch, k) => ({
    position: bar * BAR_PPQN + k * EIGHTH,
    duration: EIGHTH,
    pitch,
    velocity: 0.4 + (0.6 * k) / 7,
  }))
);

/** Quarter-note roots in the C1 octave (A1, F1, C1, G1): the chord roots an octave down, C two so it stays in the octave. */
const BASS_ROOTS: readonly number[] = [45, 41, 36, 43];
const bass: readonly PatternNote[] = Array.from({ length: 8 }, (_, k) => ({
  position: k * Quarter,
  duration: Quarter,
  pitch: BASS_ROOTS[Math.floor(k / 2)],
  velocity: 0.9,
}));

export const PATTERNS: readonly Pattern[] = [
  {
    id: "chords",
    label: "Chords",
    blurb: "Four held triads, one per half bar. The stack an Arpeggio walks; the chord starts sit on the groove grid.",
    notes: chords,
  },
  {
    id: "sixteenths",
    label: "Sixteenths",
    blurb: "Straight sixteenths on one pitch, velocities alternating loud and soft. Zeitgeist moves the off-beats; a Velocity magnet flattens the alternation.",
    notes: sixteenths,
  },
  {
    id: "melody",
    label: "Melody",
    blurb: "A one-bar phrase of eighths, repeated, velocities ramping up. A Pitch shift is obvious on a tune; Velocity's random and offset show on the ramp.",
    notes: melody,
  },
  {
    id: "bass",
    label: "Bass",
    blurb: "Quarter-note roots down in the C1 octave. Pitch octaves, and an Arpeggio with three or more octaves, have room to climb.",
    notes: bass,
  },
];

/** The pattern with every note shortened to `ratio` of its length, so the reader hears the gap between notes. */
export function withGaps(pattern: Pattern, ratio: number): Pattern {
  return {
    id: pattern.id,
    label: pattern.label,
    blurb: pattern.blurb,
    notes: pattern.notes.map((note) => ({ ...note, duration: Math.round(note.duration * ratio) })),
  };
}

export function patternById(id: PatternId): Pattern {
  const pattern = PATTERNS.find((p) => p.id === id);
  if (pattern === undefined) throw new Error(`unknown pattern "${id}"`);
  return pattern;
}

/**
 * Replace the region's notes with `pattern`. The held boxes (the previous call's return) are deleted in one
 * transaction; the new boxes are created in an `append`, so the switch is one undo step and the new notes
 * are not read back through a collection that has not seen them yet.
 */
export function writePattern(
  project: Pick<Project, "editing" | "api">,
  regionBox: NoteRegionBox,
  held: readonly NoteEventBox[],
  pattern: Pick<Pattern, "notes">
): NoteEventBox[] {
  project.editing.modify(() => {
    for (const box of held) if (box.isAttached()) box.delete();
  });
  return project.editing
    .append(() =>
      pattern.notes.map((note) =>
        project.api.createNoteEvent({
          owner: regionBox,
          position: note.position,
          duration: note.duration,
          pitch: note.pitch,
          velocity: note.velocity,
        })
      )
    )
    .unwrap("createNoteEvent");
}
