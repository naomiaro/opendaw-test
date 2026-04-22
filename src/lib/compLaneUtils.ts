import { PPQN, Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { UUID } from "@opendaw/lib-std";
import { AudioUnitBoxAdapter, TrackBoxAdapter, ValueRegionBoxAdapter } from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import type { TrackBox, ValueRegionBox } from "@opendaw/studio-boxes";
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

export function rebuildAutomation(
  project: Project,
  takes: TakeData[],
  boundaries: number[],
  assignments: number[],
  xfadeMs: number,
  playbackStart: number
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

      if (isActive) {
        // Fade-in ramp start (only if previous zone had a different take)
        if (!isFirst && !prevSameTake && crossfadePPQN > 0) {
          events.push({ position: Math.max(0, zoneStart - crossfadePPQN), value: VOL_SILENT, interpolation: Interpolation.Curve(0.75) });
        }
        // Full volume at zone start (skip if continuing from same take)
        if (!prevSameTake) {
          events.push({ position: zoneStart, value: VOL_0DB, interpolation: Interpolation.None });
        }
        // Fade-out ramp start (only if next zone has a different take)
        if (!isLast && !nextSameTake && crossfadePPQN > 0) {
          events.push({ position: Math.max(zoneStart, zoneEnd - crossfadePPQN), value: VOL_0DB, interpolation: Interpolation.Curve(0.25) });
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

  // Single atomic transaction: delete all old regions, then create all new ones
  project.editing.modify(() => {
    // Delete existing automation regions for all takes
    for (let t = 0; t < takes.length; t++) {
      const take = takes[t];
      const trackAdapter = project.boxAdapters.adapterFor(take.automationTrackBox, TrackBoxAdapter);
      const existingAdapters = trackAdapter.regions.adapters.values()
        .filter(r => r.isValueRegion());

      for (const adapter of existingAdapters) {
        const collectionOpt = adapter.optCollection;
        if (collectionOpt.nonEmpty()) {
          collectionOpt.unwrap().events.asArray().forEach((evt: { box: { delete(): void } }) => evt.box.delete());
        }
        adapter.box.delete();
      }
    }

    // Create new automation regions and events for all takes
    for (let t = 0; t < takes.length; t++) {
      const take = takes[t];
      const indexedEvents = perTakeEvents[t];

      const regionOpt = project.api.createTrackRegion(
        take.automationTrackBox,
        playbackStart as ppqn,
        TOTAL_PPQN as ppqn
      );
      if (regionOpt.isEmpty()) {
        console.error(`rebuildAutomation: createTrackRegion failed for take ${t}`);
        continue;
      }
      const regionBox = regionOpt.unwrap() as ValueRegionBox;
      // Encode comp state in first take's region label for undo/redo derivation
      if (t === 0) {
        regionBox.label.setValue(encodeCompStateToLabel({ boundaries, assignments }));
      }
      const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
      const collectionOpt = adapter.optCollection;
      if (collectionOpt.isEmpty()) {
        console.error(`rebuildAutomation: optCollection is empty for take ${t}`);
        continue;
      }
      const collection = collectionOpt.unwrap();

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

    // Create consecutive regions per zone
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
