// src/lib/beats/beatMapConversions.ts
import type { BeatMarker } from "./beatsParser";

/** A warp anchor: timeline tick ↔ audio-file second. The DAW-persistable pair. */
export interface WarpAnchor {
  readonly tick: number;
  readonly second: number;
}

/** A stepped tempo event for the project tempo track. */
export interface TempoEvent {
  readonly tick: number;
  readonly bpm: number;
}

/** Instantaneous BPM per marker gap: 60 / (s[n+1] - s[n]). */
export function segmentBpms(markers: ReadonlyArray<BeatMarker>): number[] {
  const bpms: number[] = [];
  for (let n = 0; n < markers.length - 1; n++) {
    bpms.push(60 / (markers[n + 1].second - markers[n].second));
  }
  return bpms;
}

/** (N-1) beats over the total tracked span. */
export function averageBpm(markers: ReadonlyArray<BeatMarker>): number {
  const span = markers[markers.length - 1].second - markers[0].second;
  return ((markers.length - 1) * 60) / span;
}

/**
 * Beats sounding before the first downbeat, from the first row's beatInBar.
 * Precondition: markers[0].beatInBar <= beatsPerBar (the parser cannot check
 * this — it doesn't know the meter). Larger values produce a negative result.
 */
export function pickupBeats(
  markers: ReadonlyArray<BeatMarker>,
  beatsPerBar: number = 4
): number {
  return (beatsPerBar - markers[0].beatInBar + 1) % beatsPerBar;
}

/**
 * warp-markers ch08 full-bars rule: a DAW grid is always full bars, so the
 * first downbeat must land on a bar boundary; the pickup fills the end of
 * the bar before it.
 */
export function gridAnchorTicks(
  markers: ReadonlyArray<BeatMarker>,
  quarterPpqn: number,
  beatsPerBar: number = 4
): { firstBeatTick: number; firstDownbeatTick: number } {
  const p = pickupBeats(markers, beatsPerBar);
  const ticksPerBar = beatsPerBar * quarterPpqn;
  const firstDownbeatTick = Math.ceil((p * quarterPpqn) / ticksPerBar) * ticksPerBar;
  return { firstBeatTick: firstDownbeatTick - p * quarterPpqn, firstDownbeatTick };
}

/** The audio-file second of the first tracked beat (ch08's clip offset). */
export function clipStartSeconds(markers: ReadonlyArray<BeatMarker>): number {
  return markers[0].second;
}

/**
 * The full anchor list a stretch box consumes: one anchor per tracked beat
 * (beat n pinned at firstBeatTick + n*quarter), plus
 * - a tick-0 lead-in anchor when there is a pickup, placed so the lead-in
 *   plays at the first segment's tempo (clamped to second 0 when the file
 *   has less lead-in audio than the lead-in bars ask for), and
 * - an outro anchor pinning the file end, continuing the last segment's tempo
 *   so audio after the final tracked beat still plays.
 */
export function buildWarpAnchors(
  markers: ReadonlyArray<BeatMarker>,
  fileDurationSeconds: number,
  quarterPpqn: number,
  beatsPerBar: number = 4
): WarpAnchor[] {
  const { firstBeatTick } = gridAnchorTicks(markers, quarterPpqn, beatsPerBar);
  const anchors: WarpAnchor[] = markers.map((m, n) => ({
    tick: firstBeatTick + n * quarterPpqn,
    second: m.second,
  }));

  if (firstBeatTick > 0) {
    const firstSegSecondsPerBeat = markers[1].second - markers[0].second;
    const leadInSeconds = (firstBeatTick / quarterPpqn) * firstSegSecondsPerBeat;
    anchors.unshift({
      tick: 0,
      second: Math.max(0, markers[0].second - leadInSeconds),
    });
  }

  const last = anchors[anchors.length - 1];
  const remaining = fileDurationSeconds - last.second;
  if (remaining > 1e-6) {
    const lastSegSecondsPerBeat =
      markers[markers.length - 1].second - markers[markers.length - 2].second;
    anchors.push({
      tick: last.tick + Math.round((remaining / lastSegSecondsPerBeat) * quarterPpqn),
      second: fileDurationSeconds,
    });
  }
  return anchors;
}

/**
 * One stepped tempo event per beat-segment for the project tempo track.
 * The tick-0 event always carries bpms[0] — at tick 0, not firstBeatTick — so
 * any lead-in bars (and the pickup) tick at the incoming tempo. Segments n >= 1
 * fire at marker n's grid tick.
 */
export function beatsToTempoEvents(
  markers: ReadonlyArray<BeatMarker>,
  quarterPpqn: number,
  beatsPerBar: number = 4
): TempoEvent[] {
  const { firstBeatTick } = gridAnchorTicks(markers, quarterPpqn, beatsPerBar);
  const bpms = segmentBpms(markers);
  const events: TempoEvent[] = [{ tick: 0, bpm: bpms[0] }];
  for (let n = 1; n < bpms.length; n++) {
    events.push({ tick: firstBeatTick + n * quarterPpqn, bpm: bpms[n] });
  }
  return events;
}

/**
 * One stepped tempo event per bar for the project tempo track (downbeat granularity).
 * Bar BPM is derived from the actual number of tracked beats in the bar:
 *   barBpm = (downbeats[b+1].markerIndex − downbeats[b].markerIndex) × 60
 *            / (downbeats[b+1].second − downbeats[b].second)
 * Irregular bars (meter changes, tracker glitches) therefore stay aligned at
 * every downbeat without drifting off the grid.
 *
 * Downbeat markers are those with beatInBar === 1.
 *
 * Produces ~4× fewer events than beatsToTempoEvents at the cost of intra-bar
 * tempo resolution. Suitable when per-beat density causes jank in editing.modify().
 *
 * Lead-in anchoring is TWO events (when the file has a pickup):
 * 1. tick 0 — audio-start anchor: BPM = (firstBeatTick / quarterPpqn) × 60 / s0,
 *    so the span tick 0 → firstBeatTick integrates to exactly s0 seconds
 *    (s0 = markers[0].second = clipStartSeconds, where the region places the
 *    first tracked beat).
 * 2. tick firstBeatTick — pickup-span event: BPM = p × 60 / (downbeat₀.second − s0),
 *    covering the p pickup beats so the first downbeat lands exactly.
 *
 * Invariant (piecewise integration of the stepped events):
 *   ppqnToSeconds(firstBeatTick) = s0
 *   ppqnToSeconds(firstBeatTick + downbeat[b].markerIndex × quarterPpqn)
 *     = downbeat[b].second   for every downbeat b
 * With no pickup (p = 0, firstBeatTick = 0), neither lead-in event is emitted
 * and the first bar event sits at tick 0 — audio before s0 is trimmed (same
 * degenerate case as buildWarpAnchors).
 */
export function barsToTempoEvents(
  markers: ReadonlyArray<BeatMarker>,
  quarterPpqn: number,
  beatsPerBar: number = 4
): TempoEvent[] {
  const { firstBeatTick } = gridAnchorTicks(markers, quarterPpqn, beatsPerBar);
  const p = pickupBeats(markers, beatsPerBar);
  const s0 = clipStartSeconds(markers);

  // Find all downbeat markers and their index in the full marker list.
  const downbeats: Array<{ markerIndex: number; second: number }> = [];
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].beatInBar === 1) {
      downbeats.push({ markerIndex: i, second: markers[i].second });
    }
  }

  if (downbeats.length < 2) {
    // Degenerate: fall back to a single steady-tempo event.
    const bpm = averageBpm(markers);
    return [{ tick: 0, bpm }];
  }

  const events: TempoEvent[] = [];

  // 1. Audio-start anchor: tick 0 → firstBeatTick spans exactly s0 seconds,
  //    making ppqnToSeconds(firstBeatTick) === s0.
  if (firstBeatTick > 0 && s0 > 0) { // s0 > 0 guards the division; a beat at file position 0 has no lead-in to anchor
    events.push({ tick: 0, bpm: ((firstBeatTick / quarterPpqn) * 60) / s0 });
  }

  // 2. Pickup-span event: the p pickup beats between the first tracked beat
  //    and the first downbeat, so the first downbeat lands exactly.
  if (p > 0) {
    events.push({
      tick: firstBeatTick,
      bpm: (p * 60) / (downbeats[0].second - s0),
    });
  }

  // From the first downbeat onward: one event per downbeat with bar-average BPM.
  // BPM is derived from the actual number of tracked beats in this bar
  // (markerIndex delta), not from beatsPerBar — so irregular bars (meter
  // changes, tracker glitches) stay aligned at every downbeat.
  for (let b = 0; b < downbeats.length - 1; b++) {
    const actualBeats = downbeats[b + 1].markerIndex - downbeats[b].markerIndex;
    const barBpm = (actualBeats * 60) / (downbeats[b + 1].second - downbeats[b].second);
    const tick = firstBeatTick + downbeats[b].markerIndex * quarterPpqn;
    events.push({ tick, bpm: barBpm });
  }

  // Last downbeat: no "next" downbeat, repeat the previous bar's BPM using
  // the same actual-beats formula over the previous downbeat pair.
  const lastIdx = downbeats.length - 1;
  const lastTick = firstBeatTick + downbeats[lastIdx].markerIndex * quarterPpqn;
  const prevActualBeats = downbeats[lastIdx].markerIndex - downbeats[lastIdx - 1].markerIndex;
  const lastBpm =
    (prevActualBeats * 60) /
    (downbeats[lastIdx].second - downbeats[lastIdx - 1].second);
  events.push({ tick: lastTick, bpm: lastBpm });

  return events;
}

/**
 * The rigid project tempo: round(averageBpm(markers)).
 * Oracle and renderer must agree — use this instead of inline Math.round(averageBpm(...)).
 */
export function projectBpmOf(markers: ReadonlyArray<BeatMarker>): number {
  return Math.round(averageBpm(markers));
}

/**
 * Grid demo timeline end: firstBeatTick + (markers.length - 1) * quarterPpqn
 * + beatsPerBar * quarterPpqn (one bar of outro headroom).
 * Pure function — no SDK imports.
 */
export function gridEndTick(
  markers: ReadonlyArray<BeatMarker>,
  quarterPpqn: number,
  beatsPerBar: number = 4
): number {
  const { firstBeatTick } = gridAnchorTicks(markers, quarterPpqn, beatsPerBar);
  return firstBeatTick + (markers.length - 1) * quarterPpqn + beatsPerBar * quarterPpqn;
}

/**
 * Evaluate the piecewise-linear warp map at a tick (playhead → file-second
 * mapping for externally constructed anchor lists). Clamps outside the anchor
 * range.
 */
export function warpTickToSeconds(
  anchors: ReadonlyArray<WarpAnchor>,
  tick: number
): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (tick <= first.tick) return first.second;
  if (tick >= last.tick) return last.second;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (tick <= b.tick) {
      const t = (tick - a.tick) / (b.tick - a.tick);
      return a.second + t * (b.second - a.second);
    }
  }
  return last.second;
}
