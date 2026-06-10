// src/lib/beats/beatMapConversions.test.ts
import { describe, it, expect } from "vitest";
import type { BeatMarker } from "./beatsParser";
import {
  segmentBpms,
  averageBpm,
  pickupBeats,
  gridAnchorTicks,
  buildWarpAnchors,
  beatsToTempoEvents,
  clipStartSeconds,
  warpTickToSeconds,
} from "./beatMapConversions";

const Q = 960; // PPQN.Quarter

// warp-markers ch07 worked example: beats at 0.5, 1.1, 1.6 s
// → segments of 0.6 s (100 BPM) and 0.5 s (120 BPM). No pickup.
const CH07: BeatMarker[] = [
  { second: 0.5, beatInBar: 1 },
  { second: 1.1, beatInBar: 2 },
  { second: 1.6, beatInBar: 3 },
];

// Otherside head: first row beatInBar 4 → one pickup beat in 4/4.
const PICKUP: BeatMarker[] = [
  { second: 1.26, beatInBar: 4 },
  { second: 1.8, beatInBar: 1 },
  { second: 2.32, beatInBar: 2 },
];

describe("segmentBpms", () => {
  it("derives per-gap BPM (ch07 worked numbers)", () => {
    const bpms = segmentBpms(CH07);
    expect(bpms[0]).toBeCloseTo(100, 6);
    expect(bpms[1]).toBeCloseTo(120, 6);
  });
});

describe("averageBpm", () => {
  it("is (N-1) beats over the total span", () => {
    expect(averageBpm(CH07)).toBeCloseTo((2 * 60) / 1.1, 6); // ≈ 109.09
  });
});

describe("pickupBeats", () => {
  it("is 0 when the file starts on a downbeat", () => {
    expect(pickupBeats(CH07)).toBe(0);
  });
  it("is 1 when the first row is beat 4 of 4", () => {
    expect(pickupBeats(PICKUP)).toBe(1);
  });
});

describe("gridAnchorTicks (ch08 full-bars rule)", () => {
  it("degenerates to tick 0 with no pickup", () => {
    expect(gridAnchorTicks(CH07, Q)).toEqual({ firstBeatTick: 0, firstDownbeatTick: 0 });
  });
  it("bar-aligns the first downbeat with a pickup", () => {
    // p=1: firstDownbeatTick = ceil(960/3840)*3840 = 3840; firstBeatTick = 3840-960 = 2880
    expect(gridAnchorTicks(PICKUP, Q)).toEqual({ firstBeatTick: 2880, firstDownbeatTick: 3840 });
  });
});

describe("buildWarpAnchors", () => {
  it("pins beat n at firstBeatTick + n*quarter and extends to file end at the last segment tempo", () => {
    const anchors = buildWarpAnchors(CH07, 2.0, Q);
    // No pickup → no lead-in anchor (audio before 0.5 s is trimmed, ch08 degenerate case).
    // Outro: 0.4 s remaining at 0.5 s/beat → 768 extra ticks.
    expect(anchors).toEqual([
      { tick: 0, second: 0.5 },
      { tick: 960, second: 1.1 },
      { tick: 1920, second: 1.6 },
      { tick: 2688, second: 2.0 },
    ]);
  });

  it("prepends a tick-0 lead-in anchor when there is a pickup", () => {
    const anchors = buildWarpAnchors(PICKUP, 3.0, Q);
    // Lead-in would be 3 beats at the first segment's 0.54 s/beat = 1.62 s,
    // but only 1.26 s of audio exists before the first beat → clamp to second 0.
    expect(anchors[0]).toEqual({ tick: 0, second: 0 });
    expect(anchors[1]).toEqual({ tick: 2880, second: 1.26 });
    expect(anchors[2]).toEqual({ tick: 3840, second: 1.8 });
    expect(anchors[3]).toEqual({ tick: 4800, second: 2.32 });
    // Outro: 0.68 s remaining at 0.52 s/beat → round(0.68/0.52*960) = 1255 ticks.
    expect(anchors[4]).toEqual({ tick: 4800 + 1255, second: 3.0 });
  });

  it("emits integer ticks only (Int32 box field)", () => {
    for (const a of buildWarpAnchors(PICKUP, 3.0, Q)) {
      expect(Number.isInteger(a.tick)).toBe(true);
    }
  });
});

describe("beatsToTempoEvents", () => {
  it("emits one stepped event per segment, anchored per the grid", () => {
    // toEqual fails: 60/0.6 is 99.99999999999999 in IEEE — use per-field toBeCloseTo
    const events = beatsToTempoEvents(CH07, Q);
    expect(events).toHaveLength(2);
    expect(events[0].tick).toBe(0);
    expect(events[0].bpm).toBeCloseTo(100, 6);
    expect(events[1].tick).toBe(960);
    expect(events[1].bpm).toBeCloseTo(120, 6);
  });

  it("covers the lead-in bars with the first segment tempo when there is a pickup", () => {
    const events = beatsToTempoEvents(PICKUP, Q);
    expect(events[0].tick).toBe(0);
    expect(events[0].bpm).toBeCloseTo(60 / 0.54, 6); // ≈ 111.11, lead-in + segment 0
    expect(events[1].tick).toBe(3840); // tempo changes at marker 1 (the downbeat)
    expect(events[1].bpm).toBeCloseTo(60 / 0.52, 6); // ≈ 115.38
    expect(events).toHaveLength(2);
  });
});

describe("clipStartSeconds", () => {
  it("is the first marker's second", () => {
    expect(clipStartSeconds(PICKUP)).toBe(1.26);
  });
});

describe("warpTickToSeconds", () => {
  const anchors = buildWarpAnchors(CH07, 2.0, Q);
  it("hits every anchor exactly", () => {
    for (const a of anchors) {
      expect(warpTickToSeconds(anchors, a.tick)).toBeCloseTo(a.second, 9);
    }
  });
  it("interpolates linearly between anchors", () => {
    expect(warpTickToSeconds(anchors, 480)).toBeCloseTo(0.8, 9); // mid segment 0
  });
  it("clamps outside the anchor range", () => {
    expect(warpTickToSeconds(anchors, -100)).toBeCloseTo(0.5, 9);
    expect(warpTickToSeconds(anchors, 99999)).toBeCloseTo(2.0, 9);
  });
});
