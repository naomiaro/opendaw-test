import { UUID } from "@opendaw/lib-std";
import { TimeBase } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import {
  AudioFileBox,
  AudioRegionBox,
  TrackBox,
  ValueEventCollectionBox,
} from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile } from "@/lib/audioUtils";
import { parseBeatsFile, type BeatMarker } from "@/lib/beats/beatsParser";
import { averageBpm } from "@/lib/beats/beatMapConversions";

const AUDIO_PATH = "/audio/Otherside.mp3";
const BEATS_PATH = "/audio/Otherside.beats";
const SAMPLE_NAME = "Otherside";

export interface WarpDemoSetup {
  project: Project;
  audioContext: AudioContext;
  audioBuffer: AudioBuffer;
  fileUuid: UUID.Bytes;
  audioFileBox: AudioFileBox;
  trackBox: TrackBox;
  region: AudioRegionBox;
  markers: BeatMarker[];
  /** round(averageBpm(markers)) — the rigid project tempo. */
  projectBpm: number;
}

/**
 * Common bootstrap for the warp triptych demos: project at the beat map's
 * average tempo, Otherside loaded onto a Tape track as a raw NoStretch /
 * Seconds-timeBase region spanning the whole file, metronome on. Each demo
 * applies its own conform strategy on top.
 */
export async function setupWarpDemo(opts: {
  localAudioBuffers: Map<string, AudioBuffer>;
  onStatusUpdate?: (status: string) => void;
}): Promise<WarpDemoSetup> {
  const { localAudioBuffers, onStatusUpdate } = opts;

  onStatusUpdate?.("Fetching beat map...");
  const beatsResponse = await fetch(BEATS_PATH);
  if (!beatsResponse.ok) {
    throw new Error(`Failed to fetch ${BEATS_PATH}: HTTP ${beatsResponse.status}`);
  }
  const markers = parseBeatsFile(await beatsResponse.text());
  const projectBpm = Math.round(averageBpm(markers));

  const { project, audioContext } = await initializeOpenDAW({
    localAudioBuffers,
    bpm: projectBpm,
    onStatusUpdate,
  });

  onStatusUpdate?.("Loading audio file...");
  const audioBuffer = await loadAudioFile(audioContext, AUDIO_PATH);
  const fileUuid = UUID.generate();
  localAudioBuffers.set(UUID.toString(fileUuid), audioBuffer);

  let audioFileBox: AudioFileBox = null as unknown as AudioFileBox;
  let trackBox: TrackBox = null as unknown as TrackBox;
  let region: AudioRegionBox = null as unknown as AudioRegionBox;
  project.editing.modify(() => {
    const created = project.api.createInstrument(InstrumentFactories.Tape);
    trackBox = created.trackBox;
    audioFileBox = AudioFileBox.create(project.boxGraph, fileUuid, (box) => {
      box.fileName.setValue(SAMPLE_NAME);
      box.endInSeconds.setValue(audioBuffer.duration);
    });
    const events = ValueEventCollectionBox.create(project.boxGraph, UUID.generate());
    region = AudioRegionBox.create(project.boxGraph, UUID.generate(), (box) => {
      box.regions.refer(trackBox.regions);
      box.file.refer(audioFileBox);
      box.events.refer(events.owners);
      box.position.setValue(0);
      box.duration.setValue(audioBuffer.duration);
      box.loopDuration.setValue(audioBuffer.duration);
      box.loopOffset.setValue(0);
      box.timeBase.setValue(TimeBase.Seconds);
      box.label.setValue(SAMPLE_NAME);
    });
  });

  // Plain setter — not a box field, must NOT be inside editing.modify().
  project.engine.preferences.settings.metronome.enabled = true;

  await project.engine.queryLoadingComplete();
  return {
    project,
    audioContext,
    audioBuffer,
    fileUuid,
    audioFileBox,
    trackBox,
    region,
    markers,
    projectBpm,
  };
}
