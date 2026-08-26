import { Curve } from "@opendaw/lib-std";
import { Interpolation } from "@opendaw/lib-dsp";
import { BAR, NUM_BARS, TOTAL_PPQN } from "./trackAutomationPresets";

export { BAR, NUM_BARS };
export const DEMO_BPM = 122;
/**
 * How much of the drum file the audio region replays per pass — the AUDIO
 * cycle, not the transport loop. The transport loop is the whole window
 * (`WINDOW_PPQN`), so the drums repeat once inside every transport pass.
 */
export const DRUM_CYCLE_PPQN = 4 * BAR;
/**
 * The arrangement window this page draws — the presets' 8-bar `TOTAL_PPQN`
 * under the demo's own vocabulary (every lane maps ppqn onto `[0, 1]` by it).
 */
export const WINDOW_PPQN = TOTAL_PPQN;
/**
 * Width of the lane header column (label + fader + readout). Single-sourced
 * here because three separate things have to agree on it: the automation
 * lanes, the waveform strip above them, and the page's playhead overlay, which
 * is offset by this plus the flex gap between header and canvas.
 */
export const HEADER_WIDTH = 180;

export type LanePoint = { x: number; y: number };
export type LaneEventModel = { position: number; value: number; interpolation: Interpolation };
export type LaneRegionModel = {
  start: number;
  duration: number;
  events: LaneEventModel[];
  /**
   * LoopableRegion fields. The SDK reads a region's events through
   * `globalToLocal = mod(global - position + loopOffset, loopDuration)`, so
   * region-local position p is heard at `position - loopOffset + p` and repeats
   * every `loopDuration`. `RecordAutomation` itself always leaves loopOffset 0
   * (it only ever writes `loopDuration = duration`) — a NON-ZERO loopOffset
   * comes from `RegionClipResolver`'s start-trim, when a later overdub pass
   * grows over an older region and front-trims it. Ignoring these fields shifts
   * the whole curve right by loopOffset. Omitted = a plain non-looping region
   * (offset 0, one cycle over `duration`).
   */
  loopOffset?: number;
  loopDuration?: number;
};
export type RegionRender = { x0: number; x1: number; path: LanePoint[] };

const CURVE_SAMPLES = 24;

/** Append the path for one segment [a → b] (positions already normalized to x). */
function appendSegment(path: LanePoint[], a: LanePoint & { interpolation: Interpolation },
                       b: LanePoint): void {
  if (a.interpolation.type === "none") {
    path.push({ x: b.x, y: a.y }, { x: b.x, y: b.y });
  } else if (a.interpolation.type === "linear") {
    path.push({ x: b.x, y: b.y });
  } else {
    const slope = a.interpolation.slope;
    for (let s = 1; s <= CURVE_SAMPLES; s++) {
      const t = s / CURVE_SAMPLES;
      const y = a.y + Curve.normalizedAt(t, slope) * (b.y - a.y);
      path.push({ x: a.x + (b.x - a.x) * t, y });
    }
  }
}

/** Events at ABSOLUTE ppqn positions → normalized polyline (no hold extension). */
function eventsToPath(events: ReadonlyArray<{ position: number; value: number; interpolation: Interpolation }>,
                      windowPpqn: number): LanePoint[] {
  const path: LanePoint[] = [];
  events.forEach((evt, i) => {
    const pt = { x: evt.position / windowPpqn, y: evt.value };
    if (i === 0) {
      path.push(pt);
    } else {
      const prev = events[i - 1];
      appendSegment(path, { x: prev.position / windowPpqn, y: prev.value, interpolation: prev.interpolation }, pt);
    }
  });
  return path;
}

/**
 * Clip a polyline whose x is non-decreasing (true of every path this module
 * builds) to [x0, x1], interpolating y at the two boundary crossings.
 */
function clipMonotone(path: ReadonlyArray<LanePoint>, x0: number, x1: number): LanePoint[] {
  const yAt = (a: LanePoint, b: LanePoint, x: number): number =>
    b.x === a.x ? b.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  const out: LanePoint[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (p.x < x0) {
      const next = path[i + 1];
      if (next !== undefined && next.x > x0) out.push({ x: x0, y: yAt(p, next, x0) });
    } else if (p.x > x1) {
      const prev = path[i - 1];
      if (prev !== undefined && prev.x < x1) out.push({ x: x1, y: yAt(prev, p, x1) });
      break;
    } else {
      out.push(p);
    }
  }
  return out;
}

/** One recorded value region → outline bounds + polyline, with the last value held to region end. */
export function buildRegionRender(region: LaneRegionModel, windowPpqn: number): RegionRender {
  const { start, duration, events } = region;
  const loopOffset = region.loopOffset ?? 0;
  const declaredLoop = region.loopDuration ?? duration;
  const loopDuration = declaredLoop > 0 ? declaredLoop : duration;
  const x0 = start / windowPpqn;
  const x1 = (start + duration) / windowPpqn;

  // Global position of region-local 0 for loop cycle 0, then the cycles that
  // actually intersect the region's span on the timeline.
  const base = start - loopOffset;
  const path: LanePoint[] = [];
  if (events.length > 0 && duration > 0 && loopDuration > 0) {
    const firstCycle = Math.floor(loopOffset / loopDuration);
    const lastCycle = Math.ceil((start + duration - base) / loopDuration) - 1;
    for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
      const cycleStart = base + cycle * loopDuration;
      const absolute = events.map(evt => ({ ...evt, position: cycleStart + evt.position }));
      const cyclePath = eventsToPath(absolute, windowPpqn);
      if (cyclePath.length === 0) continue;
      // Hold the previous cycle's outgoing value up to this cycle's first point
      // so repeats read as a step, not a slope across the wrap.
      const previous = path[path.length - 1];
      if (previous !== undefined && previous.x < cyclePath[0].x) {
        path.push({ x: cyclePath[0].x, y: previous.y });
      }
      path.push(...cyclePath);
    }
  }

  const clipped = clipMonotone(path, x0, x1);
  if (clipped.length === 0) {
    // Every point landed before x0 with no crossing — reachable for a region
    // the overdub start-trim moved past its own last event (loopOffset then
    // exceeds the last event position, and only one cycle intersects the span).
    // The engine holds the last value in that case (`valueAt` reads the
    // preceding event), so draw the hold rather than an empty outline.
    const lastBefore = path.length > 0 ? path[path.length - 1] : undefined;
    if (lastBefore !== undefined && lastBefore.x <= x0) {
      return { x0, x1, path: [{ x: x0, y: lastBefore.y }, { x: x1, y: lastBefore.y }] };
    }
    return { x0, x1, path: [] };
  }
  const last = clipped[clipped.length - 1];
  if (last.x < x1) clipped.push({ x: x1, y: last.y });
  return { x0, x1, path: clipped };
}

/** Preset events (absolute positions, e.g. trackAutomationPresets shapes) → dashed ghost polyline. */
export function presetGhost(events: LaneEventModel[], windowPpqn: number): LanePoint[] {
  return eventsToPath(events, windowPpqn);
}
