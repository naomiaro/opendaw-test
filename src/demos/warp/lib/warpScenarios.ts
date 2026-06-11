import { UUID } from "@opendaw/lib-std";
import { PPQN, TimeBase, Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import {
  AudioRegionBox,
  AudioPitchStretchBox,
  AudioTimeStretchBox,
  WarpMarkerBox,
} from "@opendaw/studio-boxes";
import { TransientPlayMode } from "@opendaw/studio-enums";
import type { BeatMarker } from "@/lib/beats/beatsParser";
import {
  gridAnchorTicks,
  clipStartSeconds,
  gridEndTick as libGridEndTick,
  type WarpAnchor,
  type TempoEvent,
} from "@/lib/beats/beatMapConversions";

const QUARTER = PPQN.Quarter;

/** Everything an apply-function needs. Demos pass their setup + current stretch box. */
export interface WarpScenarioContext {
  project: Project;
  region: AudioRegionBox;
  audioBuffer: AudioBuffer;
  markers: BeatMarker[];
  projectBpm: number;
  /** Stretch box from a previous apply call; deleted inside the next transaction. */
  prevStretchBox: AudioPitchStretchBox | AudioTimeStretchBox | null;
}

/** Raw-mode timeline end: file duration in ticks at the rigid project tempo. */
export function rawEndPpqn(ctx: Pick<WarpScenarioContext, "audioBuffer" | "projectBpm">): number {
  return Math.round(PPQN.secondsToPulses(ctx.audioBuffer.duration, ctx.projectBpm));
}

/** Grid demo timeline end: last tracked beat + one bar of outro headroom. */
export function gridEndTick(markers: ReadonlyArray<BeatMarker>): number {
  return libGridEndTick(markers, QUARTER);
}

/**
 * NoStretch / Seconds timeBase / full-file durations. One transaction.
 * Returns null (no stretch box in raw mode) so callers can assign the result
 * to their stretch-box ref uniformly across all apply-functions.
 */
export function applyRaw(ctx: WarpScenarioContext): null {
  const { project, region, audioBuffer } = ctx;
  project.editing.modify(() => {
    project.timelineBox.loopArea.to.setValue(rawEndPpqn(ctx));
    region.playMode.defer();
    if (ctx.prevStretchBox) ctx.prevStretchBox.delete();
    region.timeBase.setValue(TimeBase.Seconds);
    region.duration.setValue(audioBuffer.duration);
    region.loopOffset.setValue(0);
    region.loopDuration.setValue(audioBuffer.duration);
  });
  return null;
}

/**
 * Shared body for both warp-to-grid modes: create the stretch box, pin one
 * WarpMarkerBox per anchor, swap the region's playMode (refer replaces
 * atomically; delete prev AFTER refer), flip to Musical timeBase. One
 * transaction, per the SDK's AudioContentModifier pattern.
 */
function applyWarpToGrid(
  ctx: WarpScenarioContext,
  anchors: ReadonlyArray<WarpAnchor>,
  createBox: (project: Project) => AudioPitchStretchBox | AudioTimeStretchBox
): AudioPitchStretchBox | AudioTimeStretchBox {
  const { project, region } = ctx;
  const endTick = anchors[anchors.length - 1].tick;
  // Definite assignment: editing.modify callbacks run synchronously.
  let created!: AudioPitchStretchBox | AudioTimeStretchBox;
  project.editing.modify(() => {
    project.timelineBox.loopArea.to.setValue(endTick);
    created = createBox(project);
    for (const anchor of anchors) {
      WarpMarkerBox.create(project.boxGraph, UUID.generate(), (m) => {
        m.owner.refer(created.warpMarkers);
        m.position.setValue(anchor.tick);
        m.seconds.setValue(anchor.second);
      });
    }
    region.playMode.refer(created);
    if (ctx.prevStretchBox) ctx.prevStretchBox.delete();
    region.timeBase.setValue(TimeBase.Musical);
    region.duration.setValue(endTick);
    region.loopOffset.setValue(0);
    region.loopDuration.setValue(endTick);
  });
  return created;
}

/** Varispeed: beats lock to the grid, pitch follows rate. */
export function applyVarispeed(
  ctx: WarpScenarioContext,
  anchors: ReadonlyArray<WarpAnchor>
): AudioPitchStretchBox {
  return applyWarpToGrid(ctx, anchors, (project) =>
    AudioPitchStretchBox.create(project.boxGraph, UUID.generate())
  ) as AudioPitchStretchBox;
}

/**
 * TimeStretch: beats lock, pitch preserved (rate 1.0). Caller MUST await
 * ensureTransientMarkers on the file box first — zero transients renders silence.
 */
export function applyTimeStretch(
  ctx: WarpScenarioContext,
  anchors: ReadonlyArray<WarpAnchor>,
  transientPlayMode: TransientPlayMode
): AudioTimeStretchBox {
  return applyWarpToGrid(ctx, anchors, (project) =>
    AudioTimeStretchBox.create(project.boxGraph, UUID.generate(), (b) => {
      b.transientPlayMode.setValue(transientPlayMode);
      b.playbackRate.setValue(1.0);
    })
  ) as AudioTimeStretchBox;
}

/**
 * Grid demo region placement: audio's first tracked beat sounds at
 * firstBeatTick; waveformOffset trims the file's pre-beat lead-in. One
 * transaction. Region stays NoStretch / Seconds timeBase.
 */
export function applyGridPlacement(ctx: WarpScenarioContext): void {
  const { project, region, audioBuffer, markers } = ctx;
  const { firstBeatTick } = gridAnchorTicks(markers, QUARTER);
  const s0 = clipStartSeconds(markers);
  project.editing.modify(() => {
    region.position.setValue(firstBeatTick);
    region.duration.setValue(audioBuffer.duration - s0);
    region.loopDuration.setValue(audioBuffer.duration - s0);
    region.waveformOffset.setValue(s0);
    project.timelineBox.loopArea.to.setValue(gridEndTick(markers));
  });
}

/**
 * Rewrite the tempo track with stepped events (conform = barsToTempoEvents
 * output; rigid = [{tick: 0, bpm: projectBpm}]). One transaction.
 */
export function applyGridTempoEvents(
  ctx: Pick<WarpScenarioContext, "project">,
  events: ReadonlyArray<TempoEvent>
): void {
  const { project } = ctx;
  const adapter = project.timelineBoxAdapter;
  project.editing.modify(() => {
    // ValueEventCollectionBoxAdapter is not exported from @opendaw/studio-adapters.
    const collectionOpt = adapter.tempoTrackEvents;
    if (collectionOpt.isEmpty()) {
      throw new Error("No tempo track on timeline — cannot rewrite tempo events");
    }
    const collection: any = collectionOpt.unwrap();
    collection.events.asArray().forEach((event: any) => event.box.delete());
    for (const event of events) {
      collection.createEvent({
        position: event.tick as ppqn,
        index: 0,
        value: event.bpm,
        interpolation: Interpolation.None,
      });
    }
  });
}
