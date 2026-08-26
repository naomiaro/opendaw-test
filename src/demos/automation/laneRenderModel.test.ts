import { describe, expect, it } from "vitest";
import { Interpolation } from "@opendaw/lib-dsp";
import { Curve } from "@opendaw/lib-std";
import { BAR, buildLaneCurve, buildRegionRender, presetGhost, WINDOW_PPQN } from "./laneRenderModel";

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

  it("holds the last pre-x0 value flat when clipping leaves no points", () => {
    // A region the overdub start-trim moved past its own last event: loopOffset
    // (3 bars) is beyond the last event (1 bar), and a single cycle intersects
    // the span — so every point maps before x0. The engine's valueAt holds the
    // last value there, so the lane draws that hold, not a bare outline.
    const r = buildRegionRender({
      start: 3 * BAR, duration: BAR,
      loopOffset: 3 * BAR, loopDuration: 4 * BAR,
      events: [
        { position: 0, value: 0.1, interpolation: Interpolation.Linear },
        { position: BAR, value: 0.7, interpolation: Interpolation.Linear },
      ],
    }, WINDOW_PPQN);
    expect(r.path).toEqual([
      { x: 3 / 8, y: 0.7 },
      { x: 4 / 8, y: 0.7 },
    ]);
  });

  it("clips mid-segment at x1 with the interpolated value and nothing beyond", () => {
    // duration is 1.5 cycles, so the second cycle's ramp is cut in half by the
    // region end: the path must stop exactly at x1 carrying the interpolated y.
    const r = buildRegionRender({
      start: 0, duration: 1.5 * BAR,
      loopOffset: 0, loopDuration: BAR,
      events: [
        { position: 0, value: 0.2, interpolation: Interpolation.Linear },
        { position: BAR, value: 1.0, interpolation: Interpolation.Linear },
      ],
    }, WINDOW_PPQN);
    const last = r.path[r.path.length - 1];
    expect(last.x).toBeCloseTo(r.x1);
    expect(last.x).toBeCloseTo(1.5 / 8);
    // Halfway along the 0.2 → 1.0 ramp of the second cycle.
    expect(last.y).toBeCloseTo(0.6);
    expect(r.path.every(p => p.x <= r.x1 + 1e-9)).toBe(true);
    // Exactly one point sits on x1 — a duplicate would draw as a stray tick.
    expect(r.path.filter(p => Math.abs(p.x - r.x1) < 1e-9)).toHaveLength(1);
  });

  it("draws the cycle-boundary step where a local==loopDuration event meets the next local 0", () => {
    // The measured take's event list: a finalize-appended event sits exactly at
    // local loopDuration, so it shares an x with the next cycle's local-0 event.
    const LOOP = 4 * BAR;
    const r = buildRegionRender({
      start: 0, duration: 2 * LOOP,
      loopOffset: 0, loopDuration: LOOP,
      events: [
        { position: 0, value: 0.10, interpolation: Interpolation.Linear },
        { position: 3837, value: 0.40, interpolation: Interpolation.Linear },
        { position: 9452, value: 0.85, interpolation: Interpolation.Linear },
        { position: LOOP, value: 0.85, interpolation: Interpolation.Linear },
      ],
    }, WINDOW_PPQN);
    const boundary = r.path.filter(p => Math.abs(p.x - LOOP / WINDOW_PPQN) < 1e-9);
    // Two points at the same x: the outgoing 0.85 and the repeat's incoming 0.10.
    expect(boundary.map(p => p.y)).toEqual([0.85, 0.10]);
    // x stays non-decreasing across the join (clipMonotone depends on it).
    expect(r.path.every((p, i) => i === 0 || p.x >= r.path[i - 1].x - 1e-9)).toBe(true);
    expect(r.path.every(p => p.x >= r.x0 - 1e-9 && p.x <= r.x1 + 1e-9)).toBe(true);
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

describe("buildLaneCurve", () => {
  it("returns nothing for a lane with no regions", () => {
    expect(buildLaneCurve([], WINDOW_PPQN)).toEqual([]);
  });

  it("holds the first region's starting value back to the window edge (gap-before-first-region)", () => {
    const segments = buildLaneCurve([
      {
        start: 2 * BAR, duration: BAR,
        events: [
          { position: 0, value: 0.3, interpolation: Interpolation.Linear },
          { position: BAR, value: 0.9, interpolation: Interpolation.Linear },
        ],
      },
    ], WINDOW_PPQN);
    expect(segments[0].solid).toBe(false);
    expect(segments[0].path).toEqual([{ x: 0, y: 0.3 }, { x: 2 / 8, y: 0.3 }]);
    expect(segments[1].solid).toBe(true);
  });

  it("holds the earlier region's outgoing value across the gap to the next region (gap-between-regions)", () => {
    const segments = buildLaneCurve([
      {
        start: 0, duration: BAR,
        events: [{ position: 0, value: 0.2, interpolation: Interpolation.None }],
      },
      {
        start: 3 * BAR, duration: BAR,
        events: [{ position: 0, value: 0.8, interpolation: Interpolation.None }],
      },
    ], WINDOW_PPQN);
    const gap = segments.find(s => !s.solid && s.path[0].x > 0)!;
    expect(gap.path).toEqual([{ x: 1 / 8, y: 0.2 }, { x: 3 / 8, y: 0.2 }]);
  });

  it("holds the last region's outgoing value to the end of the window (gap-after-last-region)", () => {
    const segments = buildLaneCurve([
      {
        start: 0, duration: BAR,
        events: [{ position: 0, value: 0.6, interpolation: Interpolation.None }],
      },
    ], WINDOW_PPQN);
    const last = segments[segments.length - 1];
    expect(last.solid).toBe(false);
    expect(last.path).toEqual([{ x: 1 / 8, y: 0.6 }, { x: 1, y: 0.6 }]);
  });

  it("produces one unbroken curve (no gap segments) when a region spans the whole window", () => {
    const segments = buildLaneCurve([
      {
        start: 0, duration: WINDOW_PPQN,
        events: [{ position: 0, value: 0.5, interpolation: Interpolation.None }],
      },
    ], WINDOW_PPQN);
    expect(segments).toHaveLength(1);
    expect(segments[0].solid).toBe(true);
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
