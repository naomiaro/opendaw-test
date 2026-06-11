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
  barsToTempoEvents,
  clipStartSeconds,
  warpTickToSeconds,
  projectBpmOf,
  gridEndTick,
  type TempoEvent,
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

describe("barsToTempoEvents", () => {
  // Two full bars after a 1-beat pickup. Pickup at 1.26 s; downbeats at 1.8 s
  // and 3.8 s (bar of 2.0 s → 120 BPM); steady 0.5 s beats after the first bar.
  const PICKUP_2BARS: BeatMarker[] = [
    { second: 1.26, beatInBar: 4 },
    { second: 1.8, beatInBar: 1 },
    { second: 2.3, beatInBar: 2 },
    { second: 2.8, beatInBar: 3 },
    { second: 3.3, beatInBar: 4 },
    { second: 3.8, beatInBar: 1 },
    { second: 4.3, beatInBar: 2 },
    { second: 4.8, beatInBar: 3 },
    { second: 5.3, beatInBar: 4 },
  ];

  // No pickup: file starts on a downbeat at 0.5 s; one full 2.0 s bar → 120 BPM.
  const NO_PICKUP: BeatMarker[] = [
    { second: 0.5, beatInBar: 1 },
    { second: 1.0, beatInBar: 2 },
    { second: 1.5, beatInBar: 3 },
    { second: 2.0, beatInBar: 4 },
    { second: 2.5, beatInBar: 1 },
  ];

  /** Piecewise integration of stepped tempo events: seconds elapsed at `tick`. */
  function integrate(events: ReadonlyArray<TempoEvent>, tick: number): number {
    let seconds = 0;
    for (let i = 0; i < events.length; i++) {
      const from = events[i].tick;
      const to = i + 1 < events.length ? Math.min(events[i + 1].tick, tick) : tick;
      if (to <= from) break;
      seconds += ((to - from) / 960) * (60 / events[i].bpm);
      if (to === tick) break;
    }
    return seconds;
  }

  it("emits audio-start anchor + pickup-span event + per-downbeat bar events", () => {
    const events = barsToTempoEvents(PICKUP_2BARS, Q);
    // firstBeatTick = 2880, firstDownbeatTick = 3840.
    // Event 0: tick 0 anchor — 3 beats over s0 = 1.26 s → 142.857 BPM.
    expect(events[0].tick).toBe(0);
    expect(events[0].bpm).toBeCloseTo((2880 / Q) * 60 / 1.26, 3); // ≈ 142.857
    // Event 1: pickup span — 1 beat over 1.8 − 1.26 = 0.54 s → 111.111 BPM.
    expect(events[1].tick).toBe(2880);
    expect(events[1].bpm).toBeCloseTo(60 / 0.54, 3); // ≈ 111.111
    // Event 2: first bar — 4 beats over 3.8 − 1.8 = 2.0 s → 120 BPM.
    expect(events[2].tick).toBe(3840);
    expect(events[2].bpm).toBeCloseTo(120, 6);
    // Final event: last downbeat (markerIndex 5) repeating the last bar's BPM.
    const last = events[events.length - 1];
    expect(last.tick).toBe(2880 + 5 * Q); // 7680
    expect(last.bpm).toBeCloseTo(120, 6);
  });

  it("satisfies the alignment invariant by piecewise integration", () => {
    const events = barsToTempoEvents(PICKUP_2BARS, Q);
    // ppqnToSeconds(firstBeatTick) = s0
    expect(integrate(events, 2880)).toBeCloseTo(1.26, 9);
    // ppqnToSeconds(firstDownbeatTick) = first downbeat second
    expect(integrate(events, 3840)).toBeCloseTo(1.8, 9);
    // ppqnToSeconds(second downbeat tick) = 1.8 + 2.0 = 3.8
    expect(integrate(events, 7680)).toBeCloseTo(3.8, 9);
  });

  it("emits no lead-in events when the file starts on a downbeat", () => {
    const events = barsToTempoEvents(NO_PICKUP, Q);
    expect(events[0].tick).toBe(0);
    expect(events[0].bpm).toBeCloseTo(120, 6); // first bar: 4 beats over 2.0 s
    // Only the bar event at tick 0 and the repeat-last-bar event at tick 3840.
    expect(events).toHaveLength(2);
    expect(events[1].tick).toBe(4 * Q);
    expect(events[1].bpm).toBeCloseTo(120, 6);
  });

  it("falls back to a single averageBpm event with fewer than 2 downbeats", () => {
    const events = barsToTempoEvents(PICKUP, Q);
    expect(events).toHaveLength(1);
    expect(events[0].tick).toBe(0);
    expect(events[0].bpm).toBeCloseTo(averageBpm(PICKUP), 9);
  });

  // Irregular-bar fixture: bars of 4 then 3 then 4 beats at 0.5 s/beat.
  // beatInBar: 1,2,3,4, 1,2,3, 1,2,3,4
  // seconds:   0.0,0.5,1.0,1.5, 2.0,2.5,3.0, 3.5,4.0,4.5,5.0
  // No pickup (first beatInBar === 1 → firstBeatTick 0).
  // Downbeats at markerIndex 0 (0.0s), 4 (2.0s), 7 (3.5s).
  // Expected BPMs: bar0→4: 4*60/2.0=120; bar4→7: 3*60/1.5=120 (happens to be 120).
  // Expected ticks: {0, bpm120}, {4*960=3840, bpm120}, {7*960=6720, bpm120 (repeat)}.
  // The key correctness invariant: integrate(3840)=2.0s, integrate(6720)=3.5s.
  // Old code uses beatsPerBar=4 for bar BPM even for 3-beat bars →
  //   bar at index 4: bpm = 4*60/1.5 ≈ 160 (WRONG), causing misalignment.
  const IRREGULAR: BeatMarker[] = [
    { second: 0.0, beatInBar: 1 },
    { second: 0.5, beatInBar: 2 },
    { second: 1.0, beatInBar: 3 },
    { second: 1.5, beatInBar: 4 },
    { second: 2.0, beatInBar: 1 },
    { second: 2.5, beatInBar: 2 },
    { second: 3.0, beatInBar: 3 },
    { second: 3.5, beatInBar: 1 },
    { second: 4.0, beatInBar: 2 },
    { second: 4.5, beatInBar: 3 },
    { second: 5.0, beatInBar: 4 },
  ];

  it("derives bar BPM from actual beats per bar for irregular bars", () => {
    const events = barsToTempoEvents(IRREGULAR, Q);
    // Downbeats: indices 0, 4, 7 → ticks 0, 3840, 6720.
    // Event 0 (no pickup → no lead-in anchor): first bar event at tick 0.
    expect(events[0].tick).toBe(0);
    expect(events[0].bpm).toBeCloseTo(120, 6); // 4 beats / 2.0 s
    // Event 1: 3-beat bar. Correct: 3*60/1.5=120. Old code: 4*60/1.5≈160 (WRONG).
    expect(events[1].tick).toBe(4 * Q); // 3840
    expect(events[1].bpm).toBeCloseTo(120, 6); // 3 beats / 1.5 s
    // Final event: last downbeat repeating previous bar's BPM.
    expect(events[2].tick).toBe(7 * Q); // 6720
    expect(events[2].bpm).toBeCloseTo(120, 6); // repeat: 3*60/1.5=120
  });

  it("satisfies the alignment invariant for irregular bars", () => {
    const events = barsToTempoEvents(IRREGULAR, Q);
    // ppqnToSeconds(3840) should equal 2.0 (start of 3-beat bar).
    expect(integrate(events, 3840)).toBeCloseTo(2.0, 9);
    // ppqnToSeconds(6720) should equal 3.5 (last downbeat).
    expect(integrate(events, 6720)).toBeCloseTo(3.5, 9);
  });
});

describe("clipStartSeconds", () => {
  it("is the first marker's second", () => {
    expect(clipStartSeconds(PICKUP)).toBe(1.26);
  });
});

describe("projectBpmOf", () => {
  it("returns round(averageBpm) — CH07 fixture ≈ 109", () => {
    expect(projectBpmOf(CH07)).toBe(109);
  });
  it("returns 120 for a uniform-120-BPM fixture", () => {
    // NO_PICKUP: 4 beats over 2.0 s → averageBpm = 4*60/2.0 = 120.
    const NO_PICKUP: BeatMarker[] = [
      { second: 0.5, beatInBar: 1 },
      { second: 1.0, beatInBar: 2 },
      { second: 1.5, beatInBar: 3 },
      { second: 2.0, beatInBar: 4 },
      { second: 2.5, beatInBar: 1 },
    ];
    expect(projectBpmOf(NO_PICKUP)).toBe(120);
  });
});

describe("gridEndTick", () => {
  it("is firstBeatTick + (N-1)*quarter + beatsPerBar*quarter", () => {
    // CH07: no pickup → firstBeatTick 0; 3 markers → (3-1)*960 + 4*960 = 5760.
    expect(gridEndTick(CH07, Q)).toBe(5760);
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
