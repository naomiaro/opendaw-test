import { UUID } from "@opendaw/lib-std";
import { AudioUnitBox, TrackBox } from "@opendaw/studio-boxes";

// Re-export SDK types commonly used across the codebase
export type {
  AudioUnitBox,
  TrackBox,
  AudioRegionBox,
  ReverbDeviceBox,
  CompressorDeviceBox,
  DelayDeviceBox,
  CrusherDeviceBox,
  StereoToolDeviceBox,
  RevampDeviceBox,
  FoldDeviceBox,
  DattorroReverbDeviceBox,
  TidalDeviceBox,
  MaximizerDeviceBox,
  AudioBusBox,
} from "@opendaw/studio-boxes";

export type { Peaks, SamplePeaks } from "@opendaw/lib-fusion";
export type { PeaksWriter } from "@opendaw/studio-core";

/**
 * Union of all effect types available in the OpenDAW effects system.
 */
export type EffectType =
  | "Reverb"
  | "DattorroReverb"
  | "Compressor"
  | "Delay"
  | "Crusher"
  | "StereoWidth"
  | "EQ"
  | "Fold"
  | "Tidal"
  | "Maximizer";

/**
 * Snapshot of an AudioRegionBox's position/loop fields.
 * Used for waveform rendering calculations without SDK coupling.
 */
export interface RegionView {
  position: number;
  duration: number;
  loopOffset: number;
  loopDuration: number;
}

/**
 * Shared type representing a loaded audio track in OpenDAW
 */
export type TrackData = {
  name: string;
  trackBox: TrackBox;
  audioUnitBox: AudioUnitBox;
  uuid: UUID.Bytes;
};

/**
 * Configuration for loading audio tracks
 */
export interface TrackFileConfig {
  name: string;
  file: string;
}

/**
 * Union type for peaks data - either final (SamplePeaks) or live recording (PeaksWriter)
 */
export type PeaksData = import("@opendaw/lib-fusion").Peaks;
