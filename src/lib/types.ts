import { UUID } from "@opendaw/lib-std";
import { AudioUnitBox, TrackBox } from "@opendaw/studio-boxes";

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
