import { UUID } from "@opendaw/lib-std";
import { AudioData } from "@opendaw/lib-dsp";
import { Project, Workers } from "@opendaw/studio-core";
import { AudioFileBox, TransientMarkerBox } from "@opendaw/studio-boxes";

/**
 * Convert a browser AudioBuffer into OpenDAW's AudioData (SharedArrayBuffer-backed).
 *
 * AudioData is what the SDK's DSP layer consumes — workers, processors, transient
 * detection, peak generation all take AudioData, not AudioBuffer. The conversion
 * is a per-channel copy; cost is O(frames * channels).
 */
export function audioBufferToAudioData(buffer: AudioBuffer): AudioData {
  const { numberOfChannels, length: numberOfFrames, sampleRate } = buffer;
  const audioData = AudioData.create(sampleRate, numberOfFrames, numberOfChannels);
  for (let channel = 0; channel < numberOfChannels; channel++) {
    audioData.frames[channel].set(buffer.getChannelData(channel));
  }
  return audioData;
}

/**
 * Detect transients in an AudioBuffer using OpenDAW's worker-based onset detector.
 *
 * Format-agnostic: the input is whatever you can produce from `decodeAudioData`
 * (MP3, WAV, OGG, FLAC, M4A — anything the browser supports).
 *
 * @returns positions in seconds where the engine can splice without clicks.
 *          Empty array for silent/featureless audio is normal.
 */
export async function detectTransients(buffer: AudioBuffer): Promise<number[]> {
  const audioData = audioBufferToAudioData(buffer);
  return Workers.Transients.detect(audioData);
}

/**
 * Replace the transient markers on an AudioFileBox with the given positions.
 *
 * Runs in a single `editing.modify()` transaction. Removes existing markers first,
 * then adds new ones — so this is idempotent: calling it twice with the same
 * positions produces the same result as calling it once.
 *
 * Markers are stored on the *file* box (not the region), so they're shared by
 * every region that references the same audio file.
 *
 * @param positions positions in seconds, as returned by {@link detectTransients}
 *                  or any equivalent source.
 */
export function setTransientMarkers(
  project: Project,
  audioFileBox: AudioFileBox,
  positions: ReadonlyArray<number>
): void {
  project.editing.modify(() => {
    const existing = audioFileBox.transientMarkers.pointerHub.incoming();
    for (const pointer of existing) {
      project.boxGraph.unstageBox(pointer.box);
    }
    for (const seconds of positions) {
      TransientMarkerBox.create(project.boxGraph, UUID.generate(), (m) => {
        m.owner.refer(audioFileBox.transientMarkers);
        m.position.setValue(seconds);
      });
    }
  });
}

/**
 * Full pipeline: detect transients in an AudioBuffer and write them to a file box.
 *
 * This is the convenience function for "any file → ready for TimeStretch" — wrap
 * it in your API endpoint and you get format-agnostic transient analysis for
 * any uploaded audio.
 *
 * Skips detection (returns the existing positions) if the file already has
 * markers, so calling it on every TimeStretch mode-switch is cheap.
 *
 * @returns the positions that were written (or were already present).
 */
export async function ensureTransientMarkers(
  project: Project,
  audioFileBox: AudioFileBox,
  buffer: AudioBuffer
): Promise<number[]> {
  const existing = audioFileBox.transientMarkers.pointerHub.incoming();
  if (existing.length > 0) {
    return existing.map((p) => (p.box as TransientMarkerBox).position.getValue());
  }
  const positions = await detectTransients(buffer);
  setTransientMarkers(project, audioFileBox, positions);
  return positions;
}
