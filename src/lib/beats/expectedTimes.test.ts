// src/lib/beats/expectedTimes.test.ts
import { describe, it, expect } from "vitest";
import type { BeatMarker } from "./beatsParser";
import { computeExpectedTimes } from "./expectedTimes";

const Q = 960;

// Otherside head: pickup beatInBar 4 → firstBeatTick 2880, projectBpm from the
// full fixture below is round(averageBpm) — use a fixture engineered to 120 BPM
// so numbers stay readable: beats every 0.5 s.
const MARKERS: BeatMarker[] = [
  { second: 1.0, beatInBar: 4 },  // pickup
  { second: 1.5, beatInBar: 1 },
  { second: 2.0, beatInBar: 2 },
  { second: 2.5, beatInBar: 3 },
  { second: 3.0, beatInBar: 4 },
  { second: 3.5, beatInBar: 1 },
];
// averageBpm = 5 * 60 / 2.5 = 120 exactly; firstBeatTick = 2880 (p = 1).

describe("computeExpectedTimes", () => {
  const t = computeExpectedTimes(MARKERS, Q);

  it("gridTimes: marker n at (firstBeatTick + n*Q) ticks at the rigid tempo", () => {
    // tick 2880 at 120 BPM = 3 beats * 0.5 s = 1.5 s
    expect(t.gridTimes[0]).toBeCloseTo(1.5, 9);
    expect(t.gridTimes[1]).toBeCloseTo(2.0, 9);
    expect(t.gridTimes).toHaveLength(MARKERS.length);
  });

  it("fileTimes: raw playback = marker seconds verbatim", () => {
    expect(t.fileTimes).toEqual([1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
  });

  it("fileTimesRigid: region at firstBeatTick under the flat map, file shifted by s0", () => {
    // region start second = 1.5; marker 0 (s0) sounds there; others offset by (s - s0)
    expect(t.fileTimesRigid[0]).toBeCloseTo(1.5, 9);
    expect(t.fileTimesRigid[5]).toBeCloseTo(1.5 + 2.5, 9);
  });

  it("rigidClickTimes: every beat tick to the grid end at the flat tempo", () => {
    expect(t.rigidClickTimes[0]).toBeCloseTo(0, 9);
    expect(t.rigidClickTimes[1]).toBeCloseTo(0.5, 9);
    // gridEndTick = 2880 + 5*960 + 3840 = 11520 ticks = 12 beats → 13 click times (0..12 inclusive? exclusive end)
    expect(t.rigidClickTimes[t.rigidClickTimes.length - 1]).toBeLessThanOrEqual(12 * 0.5);
    // gridEnd = 2880 + 5*960 + 3840 = 11520 ticks = 12 beats → ticks 0..12 inclusive
    expect(t.rigidClickTimes).toHaveLength(13);
  });

  it("projectBpm is rounded averageBpm", () => {
    expect(t.projectBpm).toBe(120);
  });
});
