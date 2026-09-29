/**
 * Position math for a slider bound to a parameter with a fixed number of
 * values (an integer parameter such as an octave or a MIDI note).
 *
 * Such a slider runs over whole-number positions 0..positions-1 instead of
 * over the unit range with a fractional step: a step like 1/6 is not exactly
 * representable, so a unit value read back from the parameter misses the
 * slider's step grid by a hair and keyboard stepping stops moving.
 */

const lastIndex = (positions: number): number =>
  Number.isFinite(positions) && positions >= 2 ? Math.round(positions) - 1 : 0;

export function stepIndexToUnit(index: number, positions: number): number {
  const last = lastIndex(positions);
  if (last === 0 || !Number.isFinite(index)) return 0;
  return Math.min(last, Math.max(0, Math.round(index))) / last;
}

export function unitToStepIndex(unit: number, positions: number): number {
  const last = lastIndex(positions);
  if (last === 0 || !Number.isFinite(unit)) return 0;
  return Math.round(Math.min(1, Math.max(0, unit)) * last);
}
