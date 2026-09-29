/**
 * Marker and playhead math for the Nano waveform. Pure functions, mirroring
 * how the sampler's voice reads its region and loop:
 * - all four markers are shares of the FULL sample (0..1)
 * - start past end plays backwards
 * - the loop is ordered, clamped inside the region, and falls back to the
 *   region when nothing is left of it
 * - the crossfade is capped at half the loop span
 */

export type MarkerId = "sampleStart" | "sampleEnd" | "loopStart" | "loopEnd";
export type MarkerValues = Readonly<Record<MarkerId, number>>;

/** Below this span the engine has less than a frame to play for any realistic sample */
export const EMPTY_REGION_EPSILON = 0.001;

export const clampUnit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export function xToUnit(x: number, width: number): number {
  if (!(width > 0)) return 0;
  return clampUnit(x / width);
}

export function unitToX(unit: number, width: number): number {
  return clampUnit(unit) * width;
}

export interface RegionBounds {
  readonly lo: number;
  readonly hi: number;
  readonly reversed: boolean;
  readonly empty: boolean;
}

export function regionBounds(values: MarkerValues): RegionBounds {
  const start = clampUnit(values.sampleStart);
  const end = clampUnit(values.sampleEnd);
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return { lo, hi, reversed: end < start, empty: hi - lo < EMPTY_REGION_EPSILON };
}

export interface LoopBounds {
  readonly lo: number;
  readonly hi: number;
  /** True when the stored loop leaves nothing to play and the region is looped instead */
  readonly degenerate: boolean;
}

export function effectiveLoop(values: MarkerValues): LoopBounds {
  const region = regionBounds(values);
  const a = clampUnit(values.loopStart);
  const b = clampUnit(values.loopEnd);
  const lo = Math.max(Math.min(a, b), region.lo);
  const hi = Math.min(Math.max(a, b), region.hi);
  if (hi - lo < EMPTY_REGION_EPSILON) return { lo: region.lo, hi: region.hi, degenerate: true };
  return { lo, hi, degenerate: false };
}

/** The value a dragged marker may take: loop markers stay inside the region */
export function constrainMarker(id: MarkerId, value: number, values: MarkerValues): number {
  const unit = clampUnit(value);
  if (id === "sampleStart" || id === "sampleEnd") return unit;
  const region = regionBounds(values);
  return Math.min(region.hi, Math.max(region.lo, unit));
}

/** Width of one crossfade zone as a share of the sample */
export function fadeUnits(loopFadeSeconds: number, sampleSeconds: number, loop: LoopBounds): number {
  if (!(sampleSeconds > 0) || !(loopFadeSeconds > 0)) return 0;
  return Math.min(loopFadeSeconds / sampleSeconds, (loop.hi - loop.lo) / 2);
}

export function nudgeMarker(value: number, direction: -1 | 1, fine: boolean): number {
  return clampUnit(value + direction * (fine ? 0.001 : 0.01));
}

/** Read-head positions in source frames, terminated by -1, as shares of the sample */
export function positionsToUnits(positions: Float32Array, numberOfFrames: number): number[] {
  if (!(numberOfFrames > 1)) return [];
  const span = numberOfFrames - 1;
  const units: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    if (position === -1) break;
    if (!Number.isFinite(position)) continue;
    units.push(clampUnit(position / span));
  }
  return units;
}
