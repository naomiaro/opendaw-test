// src/lib/beats/expectedTimes.ts
// The .ts import extensions are required: scripts/expected-beats.ts runs this
// file under Node type-stripping, which does no extension remapping for VALUE
// imports. (Type-only imports are erased and could be extension-less.)
import type { BeatMarker } from "./beatsParser.ts";
import { averageBpm, gridAnchorTicks, clipStartSeconds } from "./beatMapConversions.ts";

/** Per-scenario expected onset times (render-relative seconds, render from tick 0). */
export interface ExpectedTimes {
  readonly projectBpm: number;
  /** Locked scenarios (varispeed/timestretch): marker n at firstBeatTick + n*quarter ticks. */
  readonly gridTimes: ReadonlyArray<number>;
  /**
   * raw (region at tick 0, file from second 0) AND grid-conform (the conformed
   * map anchors render time = file time). In both, the observed onset of marker
   * n equals its raw `second` value — one list serves both scenarios.
   */
  readonly fileTimes: ReadonlyArray<number>;
  /** grid-rigid music: region at firstBeatTick under the FLAT map, file shifted by s0. */
  readonly fileTimesRigid: ReadonlyArray<number>;
  /** grid-rigid metronome clicks: every beat tick to the grid end at the flat tempo. */
  readonly rigidClickTimes: ReadonlyArray<number>;
}

export function computeExpectedTimes(
  markers: ReadonlyArray<BeatMarker>,
  quarterPpqn: number,
  beatsPerBar: number = 4
): ExpectedTimes {
  const projectBpm = Math.round(averageBpm(markers));
  const { firstBeatTick } = gridAnchorTicks(markers, quarterPpqn, beatsPerBar);
  const s0 = clipStartSeconds(markers);
  const secondsPerTick = 60 / projectBpm / quarterPpqn;

  const gridTimes = markers.map((_, n) => (firstBeatTick + n * quarterPpqn) * secondsPerTick);
  const fileTimes = markers.map((m) => m.second);
  const regionStartRigid = firstBeatTick * secondsPerTick;
  const fileTimesRigid = markers.map((m) => regionStartRigid + (m.second - s0));

  const ticksPerBar = beatsPerBar * quarterPpqn;
  const gridEnd = firstBeatTick + (markers.length - 1) * quarterPpqn + ticksPerBar;
  const rigidClickTimes: number[] = [];
  for (let tick = 0; tick <= gridEnd; tick += quarterPpqn) {
    rigidClickTimes.push(tick * secondsPerTick);
  }

  return { projectBpm, gridTimes, fileTimes, fileTimesRigid, rigidClickTimes };
}
