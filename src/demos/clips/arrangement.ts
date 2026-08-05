// Section math for the jam-to-arrangement demo. Pure — no engine imports.
import { PPQN } from "@opendaw/lib-dsp";

export const BPM = 124; // Dark Ride
export const SECTION_BARS = 4;
export const SECTION_PPQN = SECTION_BARS * PPQN.Bar;

// While jamming the playhead free-runs; park it far past any plausible
// arrangement so committed regions on clip-less tracks never intersect it.
export const JAM_PARK_POSITION = 1000 * PPQN.Bar;

export const barSeconds = (bpm: number): number => (60 / bpm) * 4;

/** Next free 4-bar section boundary at or after every region end. Empty -> 0. */
export const nextFreeSectionStart = (regionEnds: ReadonlyArray<number>): number => {
  if (regionEnds.length === 0) return 0;
  const maxEnd = Math.max(...regionEnds);
  return Math.ceil(maxEnd / SECTION_PPQN) * SECTION_PPQN;
};
