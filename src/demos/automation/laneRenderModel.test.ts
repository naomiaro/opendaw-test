import { describe, expect, it } from "vitest";
import { Interpolation } from "@opendaw/lib-dsp";
import { Curve } from "@opendaw/lib-std";
import { BAR, buildRegionRender, presetGhost, WINDOW_PPQN } from "./laneRenderModel";

describe("buildRegionRender", () => {
  it("normalizes region bounds to the window", () => {
    const r = buildRegionRender({ start: BAR, duration: BAR, events: [] }, WINDOW_PPQN);
    expect(r.x0).toBeCloseTo(1 / 8);
    expect(r.x1).toBeCloseTo(2 / 8);
    expect(r.path).toEqual([]);
  });

  it("renders a step (interpolation none) as horizontal-then-vertical", () => {
    const r = buildRegionRender({
      start: 0, duration: BAR,
      events: [
        { position: 0, value: 0.2, interpolation: Interpolation.None },
        { position: BAR / 2, value: 0.8, interpolation: Interpolation.None },
      ],
    }, WINDOW_PPQN);
    // start point, corner at next event x with previous y, jump up, hold to region end
    expect(r.path).toEqual([
      { x: 0, y: 0.2 },
      { x: 1 / 16, y: 0.2 },
      { x: 1 / 16, y: 0.8 },
      { x: 1 / 8, y: 0.8 },
    ]);
  });

  it("renders linear interpolation as a straight segment and holds the last value", () => {
    const r = buildRegionRender({
      start: 0, duration: BAR,
      events: [
        { position: 0, value: 0, interpolation: Interpolation.Linear },
        { position: BAR / 2, value: 1, interpolation: Interpolation.Linear },
      ],
    }, WINDOW_PPQN);
    expect(r.path[0]).toEqual({ x: 0, y: 0 });
    expect(r.path[1]).toEqual({ x: 1 / 16, y: 1 });
    // hold from last event to region end
    expect(r.path[r.path.length - 1]).toEqual({ x: 1 / 8, y: 1 });
  });

  it("places events by loopOffset, not by region start (loop-wrap take)", () => {
    // Shape measured off a real loop-recorded take: the region occupies the tail
    // of the 4-bar loop but its events are still region-local to the loop start.
    const r = buildRegionRender({
      start: 2 * BAR, duration: 2 * BAR,
      loopOffset: 2 * BAR, loopDuration: 4 * BAR,
      events: [
        { position: 0, value: 0, interpolation: Interpolation.Linear },
        { position: 4 * BAR, value: 1, interpolation: Interpolation.Linear },
      ],
    }, WINDOW_PPQN);
    expect(r.x0).toBeCloseTo(2 / 8);
    expect(r.x1).toBeCloseTo(4 / 8);
    // local 0 lives at global (start - loopOffset) = 0, so the visible slice is
    // the second half of the ramp: y goes 0.5 → 1 across the region, and NOTHING
    // is drawn outside the outline.
    expect(r.path[0].x).toBeCloseTo(2 / 8);
    expect(r.path[0].y).toBeCloseTo(0.5);
    const last = r.path[r.path.length - 1];
    expect(last.x).toBeCloseTo(4 / 8);
    expect(last.y).toBeCloseTo(1);
    expect(r.path.every(p => p.x >= r.x0 - 1e-9 && p.x <= r.x1 + 1e-9)).toBe(true);
  });

  it("repeats events every loopDuration across a longer region", () => {
    const r = buildRegionRender({
      start: 0, duration: 2 * BAR,
      loopOffset: 0, loopDuration: BAR,
      events: [
        { position: 0, value: 0.25, interpolation: Interpolation.None },
        { position: BAR / 2, value: 0.75, interpolation: Interpolation.None },
      ],
    }, WINDOW_PPQN);
    // Second cycle repeats the same step half a bar into bar 2 (x = 3/16).
    expect(r.path.some(p => Math.abs(p.x - 3 / 16) < 1e-9 && Math.abs(p.y - 0.75) < 1e-9)).toBe(true);
    expect(r.path.every(p => p.x <= 2 / 8 + 1e-9)).toBe(true);
  });

  it("samples curve interpolation through Curve.normalizedAt", () => {
    const slope = 0.25;
    const r = buildRegionRender({
      start: 0, duration: BAR,
      events: [
        { position: 0, value: 0, interpolation: Interpolation.Curve(slope) },
        { position: BAR, value: 1, interpolation: Interpolation.None },
      ],
    }, WINDOW_PPQN);
    // 24 samples per curve segment: midpoint sample matches the SDK curve
    const mid = r.path.find(p => Math.abs(p.x - 1 / 16) < 1e-9)!;
    expect(mid.y).toBeCloseTo(Curve.normalizedAt(0.5, slope));
  });
});

describe("presetGhost", () => {
  it("maps absolute-position events to normalized points", () => {
    const pts = presetGhost([
      { position: 0, value: 0, interpolation: Interpolation.Linear },
      { position: 4 * BAR, value: 1, interpolation: Interpolation.None },
    ], WINDOW_PPQN);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 0.5, y: 1 });
  });
});
