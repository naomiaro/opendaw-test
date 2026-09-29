/**
 * Marker and playhead math for the Nano waveform. Pure functions, mirroring
 * how the sampler's voice reads its region and loop:
 * - all four markers are shares of the FULL sample (0..1)
 * - start past end plays backwards
 * - a region holding less than one source frame plays nothing
 * - the loop is ordered, clamped inside the region, and falls back to the
 *   region when less than one source frame is left of it
 * - the crossfade is capped at half the loop span
 *
 * "Less than one frame" depends on the sample's length, so the functions that
 * decide it take the sample's frame count.
 */

export type MarkerId = "sampleStart" | "sampleEnd" | "loopStart" | "loopEnd";
export type MarkerValues = Readonly<Record<MarkerId, number>>;

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

/** True when the span between two shares of a sample holds less than one source frame */
function underOneFrame(lo: number, hi: number, numberOfFrames: number): boolean {
  if (!(numberOfFrames >= 2)) return true;
  const span = numberOfFrames - 1;
  return hi * span - lo * span < 1;
}

export function regionBounds(values: MarkerValues, numberOfFrames: number): RegionBounds {
  const start = clampUnit(values.sampleStart);
  const end = clampUnit(values.sampleEnd);
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return { lo, hi, reversed: end < start, empty: underOneFrame(lo, hi, numberOfFrames) };
}

export interface LoopBounds {
  readonly lo: number;
  readonly hi: number;
  /**
   * True when the stored loop leaves less than a frame to play and the region
   * is looped instead. For an empty region the loop is that empty region, so
   * check `RegionBounds.empty` first.
   */
  readonly degenerate: boolean;
}

export function effectiveLoop(values: MarkerValues, numberOfFrames: number): LoopBounds {
  const region = regionBounds(values, numberOfFrames);
  const a = clampUnit(values.loopStart);
  const b = clampUnit(values.loopEnd);
  const lo = Math.max(Math.min(a, b), region.lo);
  const hi = Math.min(Math.max(a, b), region.hi);
  if (underOneFrame(lo, hi, numberOfFrames)) return { lo: region.lo, hi: region.hi, degenerate: true };
  return { lo, hi, degenerate: false };
}

/** The value a dragged marker may take: loop markers stay inside the region */
export function constrainMarker(id: MarkerId, value: number, values: MarkerValues): number {
  const unit = clampUnit(value);
  if (id === "sampleStart" || id === "sampleEnd") return unit;
  const start = clampUnit(values.sampleStart);
  const end = clampUnit(values.sampleEnd);
  return Math.min(Math.max(start, end), Math.max(Math.min(start, end), unit));
}

/** Width of one crossfade zone as a share of the sample */
export function fadeUnits(loopFadeSeconds: number, sampleSeconds: number, loop: LoopBounds): number {
  if (!(sampleSeconds > 0) || !(loopFadeSeconds > 0)) return 0;
  return Math.min(loopFadeSeconds / sampleSeconds, (loop.hi - loop.lo) / 2);
}

export function nudgeMarker(value: number, direction: -1 | 1, fine: boolean): number {
  return clampUnit(value + direction * (fine ? 0.001 : 0.01));
}

/**
 * Where a key press sends a focused marker, or null for a key the marker does
 * not handle. Steps start from where the marker is DRAWN: a loop marker stored
 * outside the region is drawn at the region's edge, and stepping from the
 * stored value would leave it standing still.
 */
export function markerKeyTarget(id: MarkerId, key: string, fine: boolean, values: MarkerValues): number | null {
  const drawn = constrainMarker(id, values[id], values);
  if (key === "ArrowLeft") return constrainMarker(id, nudgeMarker(drawn, -1, fine), values);
  if (key === "ArrowRight") return constrainMarker(id, nudgeMarker(drawn, 1, fine), values);
  if (key === "Home") return constrainMarker(id, 0, values);
  if (key === "End") return constrainMarker(id, 1, values);
  return null;
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
