import { PPQN } from "@opendaw/lib-dsp";

/** One bar of 4/4 in pulses — the loop-recording demos lay their loop area out in these. */
export const BAR_PPQN = PPQN.Quarter * 4;

/**
 * Whether a take region is the lead-in take: the one that started before the loop area,
 * so it spans the lead-in bars as well as the loop.
 *
 * Judged on the region's position, not on its label. The SDK numbers a new recording's
 * takes after the highest "Take N" already on the audio unit, so the lead-in take of a
 * second recording on the same tape is not "Take 1".
 */
export function isLeadInTake(positionPpqn: number, leadInBars: number): boolean {
  return leadInBars > 0 && positionPpqn < leadInBars * BAR_PPQN;
}

const TAKE_LABEL = /^Take (\d+)$/;

/** The N of a "Take N" label, null for any other label */
export function takeNumberOf(label: string): number | null {
  const match = TAKE_LABEL.exec(label);
  return match === null ? null : parseInt(match[1], 10);
}

/**
 * Per tape, the highest take number among the takes the demo already lists — the
 * baseline a new recording's numbers continue from. Read off the demo's own rows, not
 * off the box graph: the SDK creates a recording's first take before the recording
 * flag reaches React, so a graph read at that moment would count it as pre-existing.
 */
export function trackedTakeBaselines(
  iterations: ReadonlyArray<{ regions: ReadonlyArray<{ inputTapeId: string; takeNumber: number }> }>
): Map<string, number> {
  const baselines = new Map<string, number>();
  for (const iteration of iterations) {
    for (const { inputTapeId, takeNumber } of iteration.regions) {
      if (takeNumber > (baselines.get(inputTapeId) ?? 0)) baselines.set(inputTapeId, takeNumber);
    }
  }
  return baselines;
}

/**
 * The row a take belongs to in the demo's take list. Each audio unit numbers its own takes
 * on from what it already holds, so two tapes recorded together can carry different
 * numbers for the same pass of the loop; the demo groups by the pass instead: the take's
 * ordinal within this recording (its number past the unit's baseline, read when the
 * recording started), placed after the rows that existed before the recording. Null for
 * a take that predates the recording.
 */
export function takeIterationNumber(takeNumber: number, baseline: number, rowsBefore: number): number | null {
  const ordinal = takeNumber - baseline;
  return ordinal > 0 ? rowsBefore + ordinal : null;
}
