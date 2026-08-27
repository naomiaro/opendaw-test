import { PPQN, Interpolation, TimeBase } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { UUID } from "@opendaw/lib-std";
import { AudioUnitBoxAdapter, TrackBoxAdapter, ValueRegionBoxAdapter, TrackType } from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox, TrackBox as TrackBoxClass } from "@opendaw/studio-boxes";
import type { TrackBox, ValueRegionBox, AudioUnitBox } from "@opendaw/studio-boxes";
import type { Project } from "@opendaw/studio-core";
import type { TrackData } from "./types";

export const BPM = 124;
export const BAR = PPQN.fromSignature(4, 4); // 3840
export const BEAT = BAR / 4; // 960
export const NUM_BARS = 8;
export const TOTAL_PPQN = BAR * NUM_BARS;
export const MAX_TAKES = 4;
export const STAGGER_OFFSETS = [0, BEAT, BEAT * 2, BEAT * 3];
export const TAKE_COLORS = ["#4ade80", "#f59e0b", "#ef4444", "#a78bfa"];

export function generateTakeLabels(fileCount: number, fileNames?: string[]): string[] {
  if (fileCount === 1) {
    return STAGGER_OFFSETS.map((_, i) =>
      i === 0 ? "Take 1 (original)" : `Take ${i + 1} (+${i} beat${i > 1 ? "s" : ""})`
    );
  }
  return (fileNames ?? []).slice(0, MAX_TAKES);
}

export function computeTakeOffsets(fileCount: number): number[] {
  if (fileCount === 1) return STAGGER_OFFSETS;
  return new Array(Math.min(fileCount, MAX_TAKES)).fill(0);
}
export const VOL_0DB = AudioUnitBoxAdapter.VolumeMapper.x(0);
export const VOL_SILENT = 0.0;

export type CompMode = "automation" | "splice";

export interface TakeData {
  trackData: TrackData;
  automationTrackBox: TrackBox;
  audioFileBox: AudioFileBox | null;
  offset: number;
  color: string;
  label: string;
}

export interface CompState {
  boundaries: number[];
  assignments: number[];
  /** Per-zone content shift in PPQN (positive = audio plays later). Present
   *  only when some zone is nudged — omitted when all zero. */
  nudges?: number[];
}

/**
 * Encode comp state (boundaries + assignments) as a label string on the
 * first take's automation region. This persists comp decisions in the box
 * graph so undo/redo reverts them atomically with the automation changes.
 */
const COMP_STATE_PREFIX = "comp:";

export function encodeCompStateToLabel(state: CompState): string {
  return COMP_STATE_PREFIX + JSON.stringify(state);
}

export function deriveCompState(
  project: Project,
  takes: TakeData[],
  _playbackStart: number
): CompState {
  if (takes.length === 0) return { boundaries: [], assignments: [0] };

  // Read comp state from the first take's automation region label
  const trackAdapter = project.boxAdapters.adapterFor(takes[0].automationTrackBox, TrackBoxAdapter);
  const valueRegions = trackAdapter.regions.adapters.values().filter(r => r.isValueRegion());

  for (const region of valueRegions) {
    const label = region.label;
    if (label.startsWith(COMP_STATE_PREFIX)) {
      try {
        const parsed = JSON.parse(label.slice(COMP_STATE_PREFIX.length));
        if (!Array.isArray(parsed.boundaries) || !Array.isArray(parsed.assignments)) {
          console.error("deriveCompState: parsed label has invalid shape:", JSON.stringify(parsed));
          break;
        }
        return parsed as CompState;
      } catch (e) {
        console.error("deriveCompState: failed to parse comp state from label:", JSON.stringify({ label, error: String(e) }));
        break;
      }
    }
  }

  return { boundaries: [], assignments: [0] };
}

export type CrossfadeCurve = "curve" | "linear";

export function rebuildAutomation(
  project: Project,
  takes: TakeData[],
  boundaries: number[],
  assignments: number[],
  xfadeMs: number,
  playbackStart: number,
  crossfadeCurve: CrossfadeCurve = "curve"
): void {
  const crossfadePPQN = Math.round(PPQN.secondsToPulses(xfadeMs / 1000, BPM));

  // Pre-compute events for each take outside the transaction (pure logic, no SDK calls)
  const perTakeEvents: { position: number; index: number; value: number; interpolation: Interpolation }[][] = [];
  for (let t = 0; t < takes.length; t++) {
    const events: { position: number; value: number; interpolation: Interpolation }[] = [];
    const zoneBounds = [0, ...boundaries.map(b => b - playbackStart), TOTAL_PPQN];

    for (let z = 0; z < assignments.length; z++) {
      const zoneStart = zoneBounds[z];
      const zoneEnd = zoneBounds[z + 1];
      const isActive = assignments[z] === t;
      const isFirst = z === 0;
      const isLast = z === assignments.length - 1;
      // Check if adjacent zones have the same take — skip crossfade at shared boundary
      const prevSameTake = !isFirst && assignments[z - 1] === t;
      const nextSameTake = !isLast && assignments[z + 1] === t;

      const fadeInInterpolation: Interpolation = crossfadeCurve === "linear"
        ? Interpolation.Linear
        : Interpolation.Curve(0.75);
      const fadeOutInterpolation: Interpolation = crossfadeCurve === "linear"
        ? Interpolation.Linear
        : Interpolation.Curve(0.25);

      if (isActive) {
        // Fade-in ramp start (only if previous zone had a different take)
        if (!isFirst && !prevSameTake && crossfadePPQN > 0) {
          events.push({ position: Math.max(0, zoneStart - crossfadePPQN), value: VOL_SILENT, interpolation: fadeInInterpolation });
        }
        // Full volume at zone start (skip if continuing from same take)
        if (!prevSameTake) {
          events.push({ position: zoneStart, value: VOL_0DB, interpolation: Interpolation.None });
        }
        // Fade-out ramp start (only if next zone has a different take)
        if (!isLast && !nextSameTake && crossfadePPQN > 0) {
          events.push({ position: Math.max(zoneStart, zoneEnd - crossfadePPQN), value: VOL_0DB, interpolation: fadeOutInterpolation });
        }
        // Silent at zone end (only if next zone has a different take)
        if (!isLast && !nextSameTake) {
          events.push({ position: zoneEnd, value: VOL_SILENT, interpolation: Interpolation.None });
        }
      } else {
        // Inactive: silence at zone start
        events.push({ position: zoneStart, value: VOL_SILENT, interpolation: Interpolation.None });
      }
    }

    // Sort by position, assign incrementing index per position to form unique (position, index) composite keys
    events.sort((a, b) => a.position - b.position);
    const indexedEvents: { position: number; index: number; value: number; interpolation: Interpolation }[] = [];
    let prevPos = -1;
    let posIndex = 0;
    for (const evt of events) {
      if (evt.position === prevPos) {
        posIndex++;
      } else {
        posIndex = 0;
        prevPos = evt.position;
      }
      indexedEvents.push({ ...evt, index: posIndex });
    }
    perTakeEvents.push(indexedEvents);
  }

  // Transaction 1: delete all old regions, then create all new ones.
  // 0.0.167: createTrackRegion seeds each new value region with one inherited
  // node at position 0. The seed must be cleared (indexedEvents carries its own
  // (0, 0) event and duplicate (position, index) keys panic), and the clearing
  // has to happen in a SEPARATE commit: the adapter's event collection doesn't
  // see the seed box until the creating transaction commits, so an
  // in-transaction asArray() misses it and the seed survives
  // (ValueEventCollectionBoxAdapter.createEvent de-duplicates only via
  // existing.box.isAttached(), which cannot see uncommitted boxes either).
  // A creation failure THROWS: only a throw aborts the transaction, and
  // aborting is what preserves the old regions deleted at the top of it —
  // an early return would commit the deletion with no replacement.
  const createdRegions: ValueRegionBox[] = [];
  project.editing.modify(() => {
    // Delete existing automation regions for all takes
    for (let t = 0; t < takes.length; t++) {
      const take = takes[t];
      const trackAdapter = project.boxAdapters.adapterFor(take.automationTrackBox, TrackBoxAdapter);
      const existingAdapters = trackAdapter.regions.adapters.values()
        .filter(r => r.isValueRegion());

      for (const adapter of existingAdapters) {
        // events is a mandatory dependent of the region box — box.delete() cascade-deletes it
        adapter.box.delete();
      }
    }

    // Create new automation regions for all takes
    for (let t = 0; t < takes.length; t++) {
      const take = takes[t];

      const regionOpt = project.api.createTrackRegion(
        take.automationTrackBox,
        playbackStart as ppqn,
        TOTAL_PPQN as ppqn
      );
      if (regionOpt.isEmpty()) {
        throw new Error(
          `rebuildAutomation: createTrackRegion failed for take ${t} — aborting (old automation preserved)`
        );
      }
      const regionBox = regionOpt.unwrap() as ValueRegionBox;
      // Encode comp state in first take's region label for undo/redo derivation
      if (t === 0) {
        regionBox.label.setValue(encodeCompStateToLabel({ boundaries, assignments }));
      }
      createdRegions.push(regionBox);
    }
  });

  // Transaction 2: clear the seed nodes, then write the take-mute events.
  // editing.append() commits separately (so the adapter collections now see the
  // seeds) but folds into transaction 1's undo entry — one editing.undo()
  // reverts the comp decision atomically, as the demo promises.
  project.editing.append(() => {
    for (let t = 0; t < createdRegions.length; t++) {
      const regionBox = createdRegions[t];
      const indexedEvents = perTakeEvents[t];

      const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
      const collectionOpt = adapter.optCollection;
      if (collectionOpt.isEmpty()) {
        // Tx1 already committed, so the old curve is gone; drop the seed-only
        // region rather than leave a flat curve silently un-muting take t.
        console.error(`rebuildAutomation: optCollection is empty for take ${t} — deleting its region (take plays unmuted)`);
        regionBox.delete();
        continue;
      }
      const collection = collectionOpt.unwrap();

      // Clear the 0.0.167 seed node (see above).
      collection.events.asArray().forEach((evt) => evt.box.delete());

      for (const evt of indexedEvents) {
        collection.createEvent({
          position: evt.position as ppqn,
          index: evt.index,
          value: evt.value,
          interpolation: evt.interpolation
        });
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Swipe comping (recorded takes) — pure zone math
// ─────────────────────────────────────────────────────────────────────────

export interface CompSpan {
  start: number;
  end: number;
  take: number;
  nudge: number; // content shift in PPQN (positive = audio plays later)
}

/** Expand a CompState into consecutive [start, end) spans over [0, totalLength]. */
export function compSpans(state: CompState, totalLength: number): CompSpan[] {
  const bounds = [0, ...state.boundaries, totalLength];
  return state.assignments.map((take, i) => ({
    start: bounds[i],
    end: bounds[i + 1],
    take,
    nudge: state.nudges?.[i] ?? 0,
  }));
}

/** Build a CompState from spans, omitting `nudges` when all zero. */
function spansToStateRaw(spans: CompSpan[]): CompState {
  if (spans.length === 0) return { boundaries: [], assignments: [0] };
  const nudges = spans.map((s) => s.nudge);
  return {
    boundaries: spans.slice(1).map((s) => s.start),
    assignments: spans.map((s) => s.take),
    ...(nudges.some((n) => n !== 0) ? { nudges } : {}),
  };
}

/** Merge-normalize: drop empty spans, merge neighbors with equal take AND
 *  equal nudge (a nudged section must keep its own region). */
function spansToState(spans: CompSpan[]): CompState {
  const merged: CompSpan[] = [];
  for (const span of spans) {
    if (span.end - span.start <= 0) continue;
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.take === span.take && prev.nudge === span.nudge) {
      prev.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  return spansToStateRaw(merged);
}

/** Swipe: assign [from, to] to takeIndex, splitting/merging zones as needed. */
export function assignRange(
  state: CompState,
  takeIndex: number,
  from: number,
  to: number,
  totalLength: number
): CompState {
  const a = Math.max(0, Math.min(totalLength, Math.round(Math.min(from, to))));
  const b = Math.max(0, Math.min(totalLength, Math.round(Math.max(from, to))));
  if (b - a <= 0) return state;
  const spans: CompSpan[] = [];
  for (const span of compSpans(state, totalLength)) {
    if (span.end <= a || span.start >= b) {
      spans.push(span);
      continue;
    }
    if (span.start < a) spans.push({ start: span.start, end: a, take: span.take, nudge: span.nudge });
    if (span.end > b) spans.push({ start: b, end: span.end, take: span.take, nudge: span.nudge });
  }
  spans.push({ start: a, end: b, take: takeIndex, nudge: 0 });
  spans.sort((x, y) => x.start - y.start);
  return spansToState(spans);
}

/** Edge drag: move boundary `boundaryIndex` to a new position, clamped between
 *  its neighboring boundaries. Landing exactly on a neighbor collapses the
 *  zone between them (equal-take, equal-nudge neighbors then merge). */
export function moveBoundary(
  state: CompState,
  boundaryIndex: number,
  newPosition: number,
  totalLength: number
): CompState {
  const { boundaries } = state;
  if (boundaryIndex < 0 || boundaryIndex >= boundaries.length) return state;
  const prev = boundaryIndex === 0 ? 0 : boundaries[boundaryIndex - 1];
  const next =
    boundaryIndex === boundaries.length - 1
      ? totalLength
      : boundaries[boundaryIndex + 1];
  const pos = Math.max(prev, Math.min(next, Math.round(newPosition)));
  if (pos === boundaries[boundaryIndex]) return state;
  const spans = compSpans(state, totalLength);
  // Boundary k separates span k from span k+1.
  return spansToState(
    spans.map((s, i) => {
      if (i === boundaryIndex) return { ...s, end: pos };
      if (i === boundaryIndex + 1) return { ...s, start: pos };
      return s;
    })
  );
}

/** Zone click: reassign the whole zone containing `position` to takeIndex.
 *  Also resets the zone's nudge (clicking the zone's own lane is therefore a
 *  nudge-reset gesture). */
export function assignZoneAt(
  state: CompState,
  takeIndex: number,
  position: number,
  totalLength: number
): CompState {
  const spans = compSpans(state, totalLength);
  const hit = spans.find((s) => position >= s.start && position < s.end);
  if (hit === undefined || (hit.take === takeIndex && hit.nudge === 0)) return state;
  return spansToState(
    spans.map((s) => (s === hit ? { ...s, take: takeIndex, nudge: 0 } : s))
  );
}

/** Marquee cut: insert boundaries at [from, to] without changing any
 *  assignment or nudge. Deliberately NOT merge-normalized — the cut
 *  boundaries must survive even between equal zones. */
export function splitRange(
  state: CompState,
  from: number,
  to: number,
  totalLength: number
): CompState {
  const a = Math.max(0, Math.min(totalLength, Math.round(Math.min(from, to))));
  const b = Math.max(0, Math.min(totalLength, Math.round(Math.max(from, to))));
  if (b - a <= 0) return state;
  const pieces: CompSpan[] = [];
  for (const span of compSpans(state, totalLength)) {
    const cuts = [
      span.start,
      ...[a, b].filter((c) => c > span.start && c < span.end),
      span.end,
    ];
    for (let i = 0; i < cuts.length - 1; i++) {
      pieces.push({ ...span, start: cuts[i], end: cuts[i + 1] });
    }
  }
  const kept = pieces.filter((s) => s.end > s.start);
  if (kept.length === state.assignments.length) return state; // nothing new cut
  return spansToStateRaw(kept);
}

/** Nudge: shift zone `zoneIndex`'s audio content by deltaPpqn, accumulated
 *  and clamped to [minNudge, maxNudge] (caller derives the limits from the
 *  take's recorded extent). Boundaries and assignments are untouched. */
export function nudgeZone(
  state: CompState,
  zoneIndex: number,
  deltaPpqn: number,
  minNudge: number,
  maxNudge: number
): CompState {
  if (zoneIndex < 0 || zoneIndex >= state.assignments.length) return state;
  if (minNudge > maxNudge) return state;
  const current = state.nudges?.[zoneIndex] ?? 0;
  const next = Math.max(
    minNudge,
    Math.min(maxNudge, Math.round(current + deltaPpqn))
  );
  if (next === current) return state;
  const nudges = state.assignments.map((_, i) =>
    i === zoneIndex ? next : state.nudges?.[i] ?? 0
  );
  return {
    boundaries: state.boundaries,
    assignments: state.assignments,
    ...(nudges.some((n) => n !== 0) ? { nudges } : {}),
  };
}

/** Snap a PPQN value to the grid (gridPpqn 0 = off, plain rounding). */
export function snapToGrid(ppqnValue: number, gridPpqn: number): number {
  if (gridPpqn <= 0) return Math.round(ppqnValue);
  return Math.round(ppqnValue / gridPpqn) * gridPpqn;
}

export function rebuildSpliceRegions(
  project: Project,
  spliceTrackBox: TrackBox,
  takes: TakeData[],
  boundaries: number[],
  assignments: number[],
  playbackStart: number,
  fullAudioPpqn: number
): void {
  project.editing.modify(() => {
    // Delete existing regions on splice track
    const trackAdapter = project.boxAdapters.adapterFor(spliceTrackBox, TrackBoxAdapter);
    for (const region of trackAdapter.regions.adapters.values()) {
      region.box.delete();
    }

    // Regions use exact zone boundaries (no overlap). Same-track overlaps are invalid by
    // design: project.copy() validation deletes overlapping pairs, silently breaking export
    // and offline render. Exact boundaries can click at cross-file seams — see
    // debug/splice-click-cross-file.md for the open question with the openDAW maintainer.
    const zoneBounds = [playbackStart, ...boundaries, playbackStart + TOTAL_PPQN];
    for (let z = 0; z < assignments.length; z++) {
      const zoneStart = zoneBounds[z];
      const zoneEnd = zoneBounds[z + 1];
      const take = takes[assignments[z]];
      if (!take || !take.audioFileBox) continue;

      const eventsCollectionBox = ValueEventCollectionBox.create(project.boxGraph, UUID.generate());

      AudioRegionBox.create(project.boxGraph, UUID.generate(), box => {
        box.regions.refer(spliceTrackBox.regions);
        box.file.refer(take.audioFileBox);
        box.events.refer(eventsCollectionBox.owners);
        box.position.setValue(zoneStart);
        box.duration.setValue(zoneEnd - zoneStart);
        box.loopOffset.setValue(zoneStart + take.offset);
        box.loopDuration.setValue(fullAudioPpqn);
        box.label.setValue(take.label);
        box.mute.setValue(false);
      });
    }
  });
}

/** Buffer read offset (seconds) for a comp region starting at zoneStartPpqn
 *  playing a take whose buffer offset is takeWaveformOffsetSec. Assumes the
 *  loop starts at PPQN 0 (this demo has no lead-in). */
export function compRegionWaveformOffset(
  takeWaveformOffsetSec: number,
  zoneStartPpqn: number,
  bpm: number
): number {
  return takeWaveformOffsetSec + PPQN.pulsesToSeconds(zoneStartPpqn, bpm);
}

/** The take's recorded extent in loop-relative PPQN, clamped to the loop.
 *  A take stopped mid-pass is shorter than the loop; the final take can be
 *  up to one audio block longer. */
export function takeExtentPpqn(
  takeDurationSec: number,
  bpm: number,
  totalLength: number
): number {
  return Math.min(
    totalLength,
    Math.round(PPQN.secondsToPulses(takeDurationSec, bpm))
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Box-graph comp engine (comp track, rebuild, derive)
// ─────────────────────────────────────────────────────────────────────────

export const COMP_REGION_LABEL = "Comp";

export interface RecordedTakeSource {
  regionBox: AudioRegionBox;
  audioFileBox: AudioFileBox;
  waveformOffsetSec: number;
  durationSec: number;
}

/** Find the Tape's comp track (regions carrying the comp-state label or
 *  "Comp"), or create a new TrackBox under the audio unit. Creation uses an
 *  UNMARKED modify so it folds into the first rebuild's undo entry. */
export function ensureCompTrack(
  project: Project,
  audioUnitBox: AudioUnitBox
): TrackBox {
  const unitAdapter = project.boxAdapters.adapterFor(
    audioUnitBox,
    AudioUnitBoxAdapter
  );
  let maxIndex = -1;
  for (const track of unitAdapter.tracks.values()) {
    const isComp = track.regions.adapters
      .values()
      .some(
        (r) =>
          r.label === COMP_REGION_LABEL || r.label.startsWith("comp:")
      );
    if (isComp) return track.box;
    maxIndex = Math.max(maxIndex, track.box.index.getValue());
  }
  return project.editing
    .modify(
      () =>
        TrackBoxClass.create(project.boxGraph, UUID.generate(), (box) => {
          box.type.setValue(TrackType.Audio);
          box.index.setValue(maxIndex + 1);
          box.tracks.refer(audioUnitBox.tracks);
          box.target.refer(audioUnitBox);
        }),
      false
    )
    .unwrap();
}

/** Rebuild the comp track from the comp state: one butt-jointed Seconds-
 *  timeBase AudioRegionBox per zone, reading the winning take's frames via
 *  waveformOffset (zones entirely past the take's recorded extent are
 *  dropped). Mutes every take region (the comp is the audible path).
 *  One marked modify = one undo step per swipe. */
export function rebuildCompRegions(
  project: Project,
  compTrackBox: TrackBox,
  takes: RecordedTakeSource[],
  state: CompState,
  loopPpqn: number,
  bpm: number
): void {
  project.editing.modify(() => {
    const trackAdapter = project.boxAdapters.adapterFor(
      compTrackBox,
      TrackBoxAdapter
    );
    for (const region of trackAdapter.regions.adapters.values()) {
      region.box.delete();
    }
    for (const take of takes) {
      take.regionBox.mute.setValue(true);
    }

    let labelWritten = false;
    for (const span of compSpans(state, loopPpqn)) {
      const take = takes[span.take];
      if (take === undefined) {
        throw new Error(
          `rebuildCompRegions: zone references missing take ${span.take} — aborting`
        );
      }
      const zoneStart = Math.round(span.start);
      // Clamp the nudge itself to zoneStart — after a boundary drag lowers a
      // nudged zone's start, an unclamped span.nudge could push the content
      // window's read start before the take's own audio (into the previous
      // take's tail in the shared recording buffer). The content window
      // [zoneStart-nudge, zoneEnd-nudge] must stay inside the take's audio.
      const nudge = Math.min(span.nudge, zoneStart);
      // Clamp to the take's recorded extent (short final takes). A positive
      // nudge shifts content later, freeing that much room at the tail.
      const zoneEnd = Math.min(
        Math.round(span.end),
        Math.max(
          zoneStart,
          takeExtentPpqn(take.durationSec, bpm, loopPpqn) + nudge
        )
      );
      if (zoneEnd <= zoneStart) continue;
      if (!Number.isFinite(zoneStart) || !Number.isFinite(zoneEnd)) {
        throw new Error("rebuildCompRegions: non-finite zone bounds — aborting");
      }

      const durationSec = PPQN.pulsesToSeconds(zoneEnd - zoneStart, bpm);
      const eventsCollectionBox = ValueEventCollectionBox.create(
        project.boxGraph,
        UUID.generate()
      );
      AudioRegionBox.create(project.boxGraph, UUID.generate(), (box) => {
        box.regions.refer(compTrackBox.regions);
        box.file.refer(take.audioFileBox);
        box.events.refer(eventsCollectionBox.owners);
        box.position.setValue(zoneStart);
        box.timeBase.setValue(TimeBase.Seconds);
        box.duration.setValue(durationSec);
        box.loopDuration.setValue(durationSec);
        // Nudge shifts the content read position: positive nudge = audio
        // plays later = read earlier frames.
        box.waveformOffset.setValue(
          compRegionWaveformOffset(take.waveformOffsetSec, zoneStart - nudge, bpm)
        );
        // Comp state rides the first created region's label (undo-atomic).
        box.label.setValue(
          labelWritten ? COMP_REGION_LABEL : encodeCompStateToLabel(state)
        );
        box.mute.setValue(false);
      });
      labelWritten = true;
    }
    if (!labelWritten) {
      throw new Error(
        "rebuildCompRegions: no comp regions were created — aborting"
      );
    }
  });
}

/** Validate a parsed comp-state-shaped object against every invariant the
 *  pure zone-math functions assume — boundaries/assignments length parity,
 *  strictly-increasing positive boundaries, finite numbers throughout, and
 *  (if present) a nudges array matching assignments length. Returns null
 *  (logging the specific reason) on any violation instead of a shallow
 *  "looks array-shaped" check — a corrupted or hand-edited label must never
 *  reach the zone math with NaN/negative/out-of-order values. */
function validateCompState(parsed: unknown, source: string): CompState | null {
  if (typeof parsed !== "object" || parsed === null) {
    console.error(`${source}: parsed label is not an object`);
    return null;
  }
  const { boundaries, assignments, nudges } = parsed as Record<string, unknown>;
  if (!Array.isArray(boundaries) || !boundaries.every((b) => Number.isFinite(b))) {
    console.error(`${source}: boundaries is not an array of finite numbers`);
    return null;
  }
  if (!Array.isArray(assignments) || !assignments.every((a) => Number.isFinite(a))) {
    console.error(`${source}: assignments is not an array of finite numbers`);
    return null;
  }
  if (assignments.length !== boundaries.length + 1) {
    console.error(
      `${source}: assignments.length (${assignments.length}) !== boundaries.length + 1 (${boundaries.length + 1})`
    );
    return null;
  }
  for (let i = 0; i < boundaries.length; i++) {
    if (boundaries[i] <= 0) {
      console.error(`${source}: boundary[${i}] is not > 0`);
      return null;
    }
    if (i > 0 && boundaries[i] <= boundaries[i - 1]) {
      console.error(`${source}: boundaries are not strictly increasing at index ${i}`);
      return null;
    }
  }
  if (nudges !== undefined) {
    if (!Array.isArray(nudges) || !nudges.every((n) => Number.isFinite(n))) {
      console.error(`${source}: nudges is not an array of finite numbers`);
      return null;
    }
    if (nudges.length !== assignments.length) {
      console.error(
        `${source}: nudges.length (${nudges.length}) !== assignments.length (${assignments.length})`
      );
      return null;
    }
  }
  return parsed as CompState;
}

/** Read the persisted comp state back from the comp track (after undo/redo). */
export function deriveCompStateFromCompTrack(
  project: Project,
  compTrackBox: TrackBox
): CompState | null {
  const trackAdapter = project.boxAdapters.adapterFor(
    compTrackBox,
    TrackBoxAdapter
  );
  for (const region of trackAdapter.regions.adapters.values()) {
    const label = region.label;
    if (!label.startsWith("comp:")) continue;
    try {
      const parsed = JSON.parse(label.slice("comp:".length));
      const validated = validateCompState(parsed, "deriveCompStateFromCompTrack");
      if (validated) return validated;
    } catch (e) {
      console.error(
        "deriveCompStateFromCompTrack: bad label: " + JSON.stringify(String(e))
      );
    }
  }
  return null;
}
