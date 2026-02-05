import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { loadAudioFile } from "./audioUtils";
import { setLoopEndFromTracks } from "./projectSetup";
import type { TrackData, TrackFileConfig } from "./types";

/**
 * Load audio tracks from files and create them in the OpenDAW project
 *
 * @param project - The OpenDAW project instance
 * @param audioContext - The AudioContext for loading audio files
 * @param files - Array of track configurations (name and file path)
 * @param audioBuffers - Map to store loaded AudioBuffer instances
 * @param options - Optional configuration
 * @returns Promise resolving to array of loaded tracks
 *
 * @example
 * ```typescript
 * const tracks = await loadTracksFromFiles(project, audioContext, [
 *   { name: "Drums", file: "/audio/drums.ogg" },
 *   { name: "Bass", file: "/audio/bass.ogg" }
 * ], audioBuffers);
 * ```
 */
export async function loadTracksFromFiles(
  project: Project,
  audioContext: AudioContext,
  files: TrackFileConfig[],
  audioBuffers: Map<string, AudioBuffer>,
  options?: {
    /**
     * Default volume in dB for newly created tracks (default: 0)
     */
    defaultVolume?: number;
    /**
     * Whether to automatically set loop end to match longest track (default: true)
     */
    autoSetLoopEnd?: boolean;
    /**
     * Optional callback for progress updates
     */
    onProgress?: (current: number, total: number, trackName: string) => void;
  }
): Promise<TrackData[]> {
  const { defaultVolume = 0, autoSetLoopEnd = true, onProgress } = options || {};
  const bpm = project.timelineBox.bpm.getValue();
  const boxGraph = project.boxGraph;
  const loadedTracks: TrackData[] = [];

  for (let i = 0; i < files.length; i++) {
    const sample = files[i];

    try {
      onProgress?.(i + 1, files.length, sample.name);

      // Load audio file
      const audioBuffer = await loadAudioFile(audioContext, sample.file);
      const fileUUID = UUID.generate();
      const uuidString = UUID.toString(fileUUID);

      audioBuffers.set(uuidString, audioBuffer);

      project.editing.modify(() => {
        // Create track with Tape instrument
        const { audioUnitBox, trackBox } = project.api.createInstrument(InstrumentFactories.Tape);

        // Set default volume
        audioUnitBox.volume.setValue(defaultVolume);

        // Create audio file box
        const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
          box.fileName.setValue(sample.name);
          box.endInSeconds.setValue(audioBuffer.duration);
        });

        // Create audio region for the full duration of the audio
        const clipDurationInPPQN = PPQN.secondsToPulses(audioBuffer.duration, bpm);

        // Create events collection box (required for AudioRegionBox)
        const eventsCollectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());

        AudioRegionBox.create(boxGraph, UUID.generate(), box => {
          box.regions.refer(trackBox.regions);
          box.file.refer(audioFileBox);
          box.events.refer(eventsCollectionBox.owners);
          box.position.setValue(0); // Start at the beginning
          box.duration.setValue(clipDurationInPPQN);
          box.loopOffset.setValue(0);
          box.loopDuration.setValue(clipDurationInPPQN);
          box.label.setValue(sample.name);
          box.mute.setValue(false);
        });

        console.debug(`Created track "${sample.name}"`);
        console.debug(`  - Audio duration: ${audioBuffer.duration}s`);
        console.debug(`  - Duration in PPQN: ${clipDurationInPPQN}`);
        console.debug(`  - AudioFile UUID: ${uuidString}`);

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

  // Set loop end to accommodate the longest track
  if (autoSetLoopEnd) {
    setLoopEndFromTracks(project, audioBuffers, bpm);
  }

  console.debug("Tracks created, waiting for samples to load into engine...");

  // Wait for all samples to be loaded into the audio engine before returning
  // This ensures playback can start immediately without waiting
  await project.engine.queryLoadingComplete();

  console.debug("Samples loaded, ready for playback");
  console.debug(`Timeline position: ${project.engine.position.getValue()}`);
  console.debug(`BPM: ${bpm}`);

  // Make sure the timeline is at the beginning
  project.engine.setPosition(0);

  return loadedTracks;
}
