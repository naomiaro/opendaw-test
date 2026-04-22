import { PPQN } from "@opendaw/lib-dsp";
import { UUID } from "@opendaw/lib-std";
import { AudioUnitBoxAdapter, TrackBoxAdapter } from "@opendaw/studio-adapters";
import { AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import type { TrackBox } from "@opendaw/studio-boxes";
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
  audioFileBox: any;
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
        return JSON.parse(label.slice(COMP_STATE_PREFIX.length));
      } catch {
        break;
      }
    }
  }

  return { boundaries: [], assignments: [0] };
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
