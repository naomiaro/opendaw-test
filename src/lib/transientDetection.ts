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
 * Runs in a single `editing.modify()` transaction. Removes any existing markers
 * first, then adds the given positions — so this is a true replace, not an
 * append. Calling with the same positions twice produces the same end state as
 * calling once; calling with different positions overwrites the previous set.
 *
 * Markers are stored on the *file* box (not the region), so they're shared by
 * every region that references the same audio file.
 *
 * @param positions positions in seconds, as returned by {@link detectTransients}
 *                  or any equivalent source. Pass `[]` to clear all markers.
 */
export function setTransientMarkers(
  project: Project,
  audioFileBox: AudioFileBox,
  positions: ReadonlyArray<number>
): void {
  project.editing.modify(() => {
    const existing = audioFileBox.transientMarkers.pointerHub.incoming();
    for (const pointer of existing) {
      // The `transientMarkers` field only accepts `Pointers.TransientMarkers`,
      // which only `TransientMarkerBox.owner` provides, so the cast is safe by
      // pointer-rule construction. Belt-and-braces instanceof anyway to keep the
      // helper resilient if the SDK ever widens the accepted pointer types.
      if (pointer.box instanceof TransientMarkerBox) {
        project.boxGraph.unstageBox(pointer.box);
      }
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
 * Skips detection (returns the existing positions) if the file already has at
 * least two markers, so calling it on every TimeStretch mode-switch is cheap.
 * A file with a single stale marker is re-detected — one marker is below the
 * engine's minimum and would render silence anyway.
 *
 * **Throws** if detection completes with fewer than two positions. The engine
 * renders silence for TimeStretch regions whose file has fewer than 2 transient
 * markers (`transients.length() < 2` bails before sequencing in
 * `TapeDeviceProcessor`), so a result with 0 or 1 marker is a real failure
 * rather than something the caller should silently pass through. Catch this and
 * either pick a different play-mode or set markers manually via
 * {@link setTransientMarkers}.
 *
 * @returns the positions that were written (or were already present). At least
 *          two positions; throws otherwise.
 */
export async function ensureTransientMarkers(
  project: Project,
  audioFileBox: AudioFileBox,
  buffer: AudioBuffer
): Promise<number[]> {
  const existing = audioFileBox.transientMarkers.pointerHub.incoming();
  if (existing.length >= 2) {
    const positions: number[] = [];
    for (const pointer of existing) {
      if (pointer.box instanceof TransientMarkerBox) {
        positions.push(pointer.box.position.getValue());
      }
    }
    return positions;
  }
  const positions = await detectTransients(buffer);
  if (positions.length < 2) {
    throw new Error(
      "Transient detection returned fewer than two positions. TimeStretch " +
        "needs at least two transients on the file or the engine renders " +
        "silence. The audio may be silent, featureless, or too short for " +
        "the onset detector."
    );
  }
  setTransientMarkers(project, audioFileBox, positions);
  return positions;
}
