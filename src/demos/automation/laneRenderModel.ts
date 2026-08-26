import { Curve } from "@opendaw/lib-std";
import { Interpolation, PPQN } from "@opendaw/lib-dsp";

export const DEMO_BPM = 122;
export const BAR = PPQN.fromSignature(4, 4); // 3840
export const LOOP_PPQN = 4 * BAR;
export const WINDOW_PPQN = 8 * BAR;

export type LanePoint = { x: number; y: number };
export type LaneEventModel = { position: number; value: number; interpolation: Interpolation };
export type LaneRegionModel = { start: number; duration: number; events: LaneEventModel[] };
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

/** One recorded value region → outline bounds + polyline, with the last value held to region end. */
export function buildRegionRender(region: LaneRegionModel, windowPpqn: number): RegionRender {
  const x0 = region.start / windowPpqn;
  const x1 = (region.start + region.duration) / windowPpqn;
  const absolute = region.events.map(evt => ({ ...evt, position: region.start + evt.position }));
  const path = eventsToPath(absolute, windowPpqn);
  if (path.length > 0) {
    const last = path[path.length - 1];
    if (last.x < x1) path.push({ x: x1, y: last.y });
  }
  return { x0, x1, path };
}

/** Preset events (absolute positions, e.g. trackAutomationPresets shapes) → dashed ghost polyline. */
export function presetGhost(events: LaneEventModel[], windowPpqn: number): LanePoint[] {
  return eventsToPath(events, windowPpqn);
}
