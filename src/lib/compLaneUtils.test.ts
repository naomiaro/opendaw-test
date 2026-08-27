import { describe, it, expect } from "vitest";
import {
  compSpans,
  assignRange,
  assignZoneAt,
  moveBoundary,
  splitRange,
  nudgeZone,
  snapToGrid,
  compRegionWaveformOffset,
  takeExtentPpqn,
  type CompState,
} from "./compLaneUtils";

const TOTAL = 15360; // 4 bars of 4/4 at PPQN 960/quarter

describe("compSpans", () => {
  it("maps an empty comp state to one full-length span", () => {
    const state: CompState = { boundaries: [], assignments: [2] };
    expect(compSpans(state, TOTAL)).toEqual([{ start: 0, end: TOTAL, take: 2, nudge: 0 }]);
  });

  it("maps boundaries to consecutive spans", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    expect(compSpans(state, TOTAL)).toEqual([
      { start: 0, end: 4000, take: 0, nudge: 0 },
      { start: 4000, end: 9000, take: 1, nudge: 0 },
      { start: 9000, end: TOTAL, take: 0, nudge: 0 },
    ]);
  });
});

describe("assignRange", () => {
  it("splits a single zone when swiping in the middle", () => {
    const state: CompState = { boundaries: [], assignments: [0] };
    expect(assignRange(state, 1, 4000, 9000, TOTAL)).toEqual({
      boundaries: [4000, 9000],
      assignments: [0, 1, 0],
    });
  });

  it("swipe reaching the start produces no zero-length leading zone", () => {
    const state: CompState = { boundaries: [], assignments: [0] };
    expect(assignRange(state, 1, 0, 9000, TOTAL)).toEqual({
      boundaries: [9000],
      assignments: [1, 0],
    });
  });

  it("swipe covering everything replaces the whole comp", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    expect(assignRange(state, 2, 0, TOTAL, TOTAL)).toEqual({
      boundaries: [],
      assignments: [2],
    });
  });

  it("swiping the same take over adjacent zones merges them", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    // Swipe take 0 over [3000, 10000] — swallows the middle zone entirely
    expect(assignRange(state, 0, 3000, 10000, TOTAL)).toEqual({
      boundaries: [],
      assignments: [0],
    });
  });

  it("overlapping an existing boundary splits only the overlapped parts", () => {
    const state: CompState = { boundaries: [8000], assignments: [0, 1] };
    expect(assignRange(state, 2, 6000, 10000, TOTAL)).toEqual({
      boundaries: [6000, 10000],
      assignments: [0, 2, 1],
    });
  });

  it("accepts from/to in either order", () => {
    const state: CompState = { boundaries: [], assignments: [0] };
    expect(assignRange(state, 1, 9000, 4000, TOTAL)).toEqual(
      assignRange(state, 1, 4000, 9000, TOTAL)
    );
  });

  it("clamps to [0, totalLength] and rounds to integer PPQN", () => {
    const state: CompState = { boundaries: [], assignments: [0] };
    expect(assignRange(state, 1, -50.7, TOTAL + 99, TOTAL)).toEqual({
      boundaries: [],
      assignments: [1],
    });
  });

  it("returns the state unchanged for a zero-length range", () => {
    const state: CompState = { boundaries: [4000], assignments: [0, 1] };
    expect(assignRange(state, 1, 5000, 5000.4, TOTAL)).toBe(state);
  });
});

describe("moveBoundary", () => {
  it("moves a boundary between its neighbors", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    expect(moveBoundary(state, 0, 5000, TOTAL)).toEqual({
      boundaries: [5000, 9000],
      assignments: [0, 1, 0],
    });
  });

  it("clamps to the neighboring boundaries", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 2] };
    // Dragging boundary 1 far left clamps at boundary 0 (4000) — the middle
    // zone collapses and the different-take neighbors keep their seam.
    expect(moveBoundary(state, 1, 2000, TOTAL)).toEqual({
      boundaries: [4000],
      assignments: [0, 2],
    });
  });

  it("collapsing a zone removes it and merges equal-take neighbors", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    // Drag boundary 1 down onto boundary 0 — the middle zone collapses,
    // and the two take-0 zones merge into one full-length zone.
    expect(moveBoundary(state, 1, 4000, TOTAL)).toEqual({
      boundaries: [],
      assignments: [0],
    });
  });

  it("collapsing between different-take neighbors keeps the seam", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 2] };
    expect(moveBoundary(state, 1, 4000, TOTAL)).toEqual({
      boundaries: [4000],
      assignments: [0, 2],
    });
  });

  it("is a no-op for an unchanged position or invalid index", () => {
    const state: CompState = { boundaries: [4000], assignments: [0, 1] };
    expect(moveBoundary(state, 0, 4000.2, TOTAL)).toBe(state);
    expect(moveBoundary(state, 5, 6000, TOTAL)).toBe(state);
    expect(moveBoundary(state, -1, 6000, TOTAL)).toBe(state);
  });
});

describe("assignZoneAt", () => {
  it("reassigns the zone containing the position", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    expect(assignZoneAt(state, 2, 5000, TOTAL)).toEqual({
      boundaries: [4000, 9000],
      assignments: [0, 2, 0],
    });
  });

  it("merges with a neighbor when the reassignment makes them equal", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    expect(assignZoneAt(state, 0, 5000, TOTAL)).toEqual({
      boundaries: [],
      assignments: [0],
    });
  });

  it("is a no-op when the zone already has that take", () => {
    const state: CompState = { boundaries: [4000], assignments: [0, 1] };
    expect(assignZoneAt(state, 1, 6000, TOTAL)).toBe(state);
  });

  it("is a no-op outside [0, totalLength)", () => {
    const state: CompState = { boundaries: [4000], assignments: [0, 1] };
    expect(assignZoneAt(state, 0, TOTAL + 1, TOTAL)).toBe(state);
  });
});

describe("splitRange (marquee cut)", () => {
  it("cuts a section without changing assignments", () => {
    const state: CompState = { boundaries: [], assignments: [1] };
    expect(splitRange(state, 4000, 9000, TOTAL)).toEqual({
      boundaries: [4000, 9000],
      assignments: [1, 1, 1],
    });
  });

  it("cut boundaries survive across existing seams", () => {
    const state: CompState = { boundaries: [8000], assignments: [0, 1] };
    expect(splitRange(state, 6000, 10000, TOTAL)).toEqual({
      boundaries: [6000, 8000, 10000],
      assignments: [0, 0, 1, 1],
    });
  });

  it("is a no-op for a zero-length range and for existing boundaries", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    expect(splitRange(state, 5000, 5000, TOTAL)).toBe(state);
    expect(splitRange(state, 4000, 9000, TOTAL)).toBe(state);
  });
});

describe("nudgeZone", () => {
  it("sets a zone's nudge and keeps the others at 0", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    expect(nudgeZone(state, 1, 120, -500, 4000)).toEqual({
      boundaries: [4000, 9000],
      assignments: [0, 1, 0],
      nudges: [0, 120, 0],
    });
  });

  it("accumulates and clamps to [minNudge, maxNudge]", () => {
    const state: CompState = {
      boundaries: [4000],
      assignments: [0, 1],
      nudges: [0, 100],
    };
    expect(nudgeZone(state, 1, 10000, -500, 300)).toEqual({
      boundaries: [4000],
      assignments: [0, 1],
      nudges: [0, 300],
    });
  });

  it("drops the nudges array when everything returns to 0", () => {
    const state: CompState = {
      boundaries: [4000],
      assignments: [0, 1],
      nudges: [0, 100],
    };
    expect(nudgeZone(state, 1, -100, -500, 500)).toEqual({
      boundaries: [4000],
      assignments: [0, 1],
    });
  });

  it("is a no-op for an invalid zone index or inverted limits", () => {
    const state: CompState = { boundaries: [], assignments: [0] };
    expect(nudgeZone(state, 3, 100, -500, 500)).toBe(state);
    expect(nudgeZone(state, 0, 100, 500, -500)).toBe(state);
  });
});

describe("nudge-aware merging", () => {
  it("keeps equal-take neighbors separate while their nudges differ", () => {
    const cut = splitRange({ boundaries: [], assignments: [0] }, 4000, 9000, TOTAL);
    const nudged = nudgeZone(cut, 1, 240, -500, 4000);
    // Boundary move must NOT merge the nudged middle into its neighbors.
    expect(moveBoundary(nudged, 0, 3000, TOTAL).boundaries).toEqual([3000, 9000]);
    // Clicking the zone's own lane resets the nudge — then everything merges.
    expect(assignZoneAt(nudged, 0, 5000, TOTAL)).toEqual({
      boundaries: [],
      assignments: [0],
    });
  });
});

describe("nudge preservation through swipe and cut", () => {
  it("assignRange preserves remainder nudges, resets the swiped range, and merges only equal-nudge neighbors", () => {
    const state: CompState = {
      boundaries: [4000, 9000],
      assignments: [0, 0, 0],
      nudges: [0, 240, 0],
    };
    // Swipe take 0 over [3000, 5000]: splits the first zone, truncates the
    // nudged middle zone (its 240 nudge must survive), and the fresh nudge-0
    // range merges with the leading nudge-0 zone but NOT the nudged remainder.
    expect(assignRange(state, 0, 3000, 5000, TOTAL)).toEqual({
      boundaries: [5000, 9000],
      assignments: [0, 0, 0],
      nudges: [0, 240, 0],
    });
  });

  it("splitRange keeps the same nudge on both halves of a cut zone", () => {
    const state: CompState = { boundaries: [], assignments: [1], nudges: [120] };
    expect(splitRange(state, 4000, 9000, TOTAL)).toEqual({
      boundaries: [4000, 9000],
      assignments: [1, 1, 1],
      nudges: [120, 120, 120],
    });
  });
});

describe("snapToGrid", () => {
  it("rounds to the nearest grid line", () => {
    expect(snapToGrid(1150, 960)).toBe(960);
    expect(snapToGrid(1450, 960)).toBe(1920);
  });

  it("grid 0 = off, plain rounding", () => {
    expect(snapToGrid(1150.4, 0)).toBe(1150);
  });
});

describe("compRegionWaveformOffset", () => {
  it("adds the zone start (as seconds at the bpm) to the take's buffer offset", () => {
    // 3840 pulses = 4 quarters = 2.0 s at 120 BPM
    expect(compRegionWaveformOffset(1.25, 3840, 120)).toBeCloseTo(3.25, 6);
  });

  it("returns the take's own offset at zone start 0", () => {
    expect(compRegionWaveformOffset(0.8, 0, 90)).toBeCloseTo(0.8, 6);
  });
});

describe("takeExtentPpqn", () => {
  it("converts the take duration to integer PPQN", () => {
    // 2.0 s at 120 BPM = 3840 pulses
    expect(takeExtentPpqn(2.0, 120, 15360)).toBe(3840);
  });

  it("clamps to the loop length (final takes carry an extra audio-block tail)", () => {
    expect(takeExtentPpqn(60, 120, 15360)).toBe(15360);
  });
});
