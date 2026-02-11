import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox, AudioBusBox, AudioUnitBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { InstrumentFactories, AudioBusFactory } from "@opendaw/studio-adapters";
import { AudioUnitType, IconSymbol, Colors } from "@opendaw/studio-enums";
import { loadAudioFile } from "./audioUtils";
import { setLoopEndFromTracks } from "./projectSetup";
import type { TrackData, TrackFileConfig } from "./types";

/**
 * Configuration for a group bus
 */
export interface GroupConfig {
  name: string;
  color: typeof Colors.blue;
  trackNames: string[];
}

/**
 * Data returned for a created group bus
 */
export interface GroupData {
  name: string;
  audioBusBox: AudioBusBox;
  audioUnitBox: AudioUnitBox;
}

/**
 * Result of loading tracks with group routing
 */
export interface GroupedTracksResult {
  tracks: TrackData[];
  groups: GroupData[];
}

/**
 * Load audio tracks and create group buses, routing each track to its assigned group.
 *
 * Signal flow: Track -> Group Bus -> Master Output
 *
 * Group creation, track creation, and routing are done in separate editing.modify()
 * transactions. This is required because OpenDAW defers pointer hub notifications
 * within a single transaction — re-routing a track's output in the same transaction
 * that created it would not properly disconnect the default master routing.
 *
 * @param project - The OpenDAW project instance
 * @param audioContext - The AudioContext for loading audio files
 * @param files - Array of track configurations (name and file path)
 * @param audioBuffers - Map to store loaded AudioBuffer instances
 * @param groups - Array of group configurations defining bus names and track assignments
 * @param options - Optional configuration
 * @returns Promise resolving to tracks and group data
 */
export async function loadTracksWithGroups(
  project: Project,
  audioContext: AudioContext,
  files: TrackFileConfig[],
  audioBuffers: Map<string, AudioBuffer>,
  groups: GroupConfig[],
  options?: {
    defaultVolume?: number;
    autoSetLoopEnd?: boolean;
    onProgress?: (current: number, total: number, trackName: string) => void;
  }
): Promise<GroupedTracksResult> {
  const { defaultVolume = 0, autoSetLoopEnd = true, onProgress } = options || {};
  const bpm = project.timelineBox.bpm.getValue();
  const boxGraph = project.boxGraph;
  const skeleton = project.skeleton;

  // Build a lookup from track name to group config
  const trackToGroup = new Map<string, GroupConfig>();
  for (const group of groups) {
    for (const trackName of group.trackNames) {
      trackToGroup.set(trackName, group);
    }
  }

  // Step 1: Create group buses in their own transaction
  const busBoxes = new Map<string, AudioBusBox>();

  project.editing.modify(() => {
    for (const group of groups) {
      const audioBusBox = AudioBusFactory.create(
        skeleton,
        group.name,
        IconSymbol.AudioBus,
        AudioUnitType.Bus,
        group.color
      );
      busBoxes.set(group.name, audioBusBox);
      console.debug(`Created group bus "${group.name}"`);
    }
  });

  // Step 2: Extract AudioUnitBox references AFTER the transaction commits
  // (targetVertex traversal requires pointer notifications to be processed)
  const groupDataMap = new Map<string, GroupData>();

  for (const group of groups) {
    const audioBusBox = busBoxes.get(group.name)!;
    const audioUnitBox = audioBusBox.output.targetVertex
      .unwrap("No AudioUnitBox for group bus").box as AudioUnitBox;
    groupDataMap.set(group.name, { name: group.name, audioBusBox, audioUnitBox });
    console.debug(`Group "${group.name}" AudioUnitBox resolved`);
  }

  // Step 3: Load audio files and create tracks (with default master routing)
  const loadedTracks: TrackData[] = [];

  for (let i = 0; i < files.length; i++) {
    const sample = files[i];

    try {
      onProgress?.(i + 1, files.length, sample.name);

      const audioBuffer = await loadAudioFile(audioContext, sample.file);
      const fileUUID = UUID.generate();
      const uuidString = UUID.toString(fileUUID);

      audioBuffers.set(uuidString, audioBuffer);

      project.editing.modify(() => {
        const { audioUnitBox, trackBox } = project.api.createInstrument(InstrumentFactories.Tape);

        audioUnitBox.volume.setValue(defaultVolume);

        // Create audio file box
        const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
          box.fileName.setValue(sample.name);
          box.endInSeconds.setValue(audioBuffer.duration);
        });

        // Create audio region
        const clipDurationInPPQN = PPQN.secondsToPulses(audioBuffer.duration, bpm);
        const eventsCollectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());

        AudioRegionBox.create(boxGraph, UUID.generate(), box => {
          box.regions.refer(trackBox.regions);
          box.file.refer(audioFileBox);
          box.events.refer(eventsCollectionBox.owners);
          box.position.setValue(0);
          box.duration.setValue(clipDurationInPPQN);
          box.loopOffset.setValue(0);
          box.loopDuration.setValue(clipDurationInPPQN);
          box.label.setValue(sample.name);
          box.mute.setValue(false);
        });

        console.debug(`Created track "${sample.name}" (${audioBuffer.duration.toFixed(2)}s)`);

        loadedTracks.push({
          name: sample.name,
          trackBox,
          audioUnitBox,
          uuid: fileUUID
        });
      });
    } catch (error) {
      console.error(`Failed to load ${sample.name}:`, error);
    }
  }

  // Step 4: Re-route tracks to groups in a SEPARATE transaction
  // This must be separate from track creation because createInstrument() sets up
  // the default master routing — re-assigning in the same transaction may not
  // properly disconnect the old pointer connection.
  project.editing.modify(() => {
    for (const track of loadedTracks) {
      const groupConfig = trackToGroup.get(track.name);
      if (groupConfig) {
        const groupData = groupDataMap.get(groupConfig.name);
        if (groupData) {
          track.audioUnitBox.output.refer(groupData.audioBusBox.input);
          console.debug(`Routed "${track.name}" -> group "${groupConfig.name}"`);
        }
      }
    }
  });

  // Set loop end to accommodate the longest track
  if (autoSetLoopEnd) {
    setLoopEndFromTracks(project, audioBuffers, bpm);
  }

  console.debug("Tracks created with group routing, waiting for samples to load...");
  await project.engine.queryLoadingComplete();
  console.debug("Samples loaded, ready for playback");

  project.engine.setPosition(0);

  return {
    tracks: loadedTracks,
    groups: Array.from(groupDataMap.values())
  };
}
