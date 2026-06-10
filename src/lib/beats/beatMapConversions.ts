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
 * One stepped tempo event per segment for the project tempo track.
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
 * Evaluate the piecewise-linear warp map at a tick (for playhead → file-second
 * mapping in the demos). Clamps outside the anchor range.
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
