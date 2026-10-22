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
