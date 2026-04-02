import { Project, AudioWorklets } from "@opendaw/studio-core";
import { WavFile, PPQN, ppqn } from "@opendaw/lib-dsp";
import { UUID, TimeSpan } from "@opendaw/lib-std";
import { Wait } from "@opendaw/lib-runtime";
import type { ExportStemsConfiguration } from "@opendaw/studio-adapters";
import type { TrackData } from "./types";

export interface ExportResult {
  label: string;
  channels: Float32Array[];
  sampleRate: number;
  durationSeconds: number;
}

interface RangeExportOptions {
  project: Project;
  startPpqn: ppqn;
  endPpqn: ppqn;
  sampleRate?: number;
}

/**
 * Snapshot mutable project state, run a callback, then restore.
 * Mutations are captured by project.copy() inside the action,
 * so restoration after copy is safe.
 */
async function withProjectState<T>(
  project: Project,
  mutate: () => void,
  restore: () => void,
  action: () => Promise<T>
): Promise<T> {
  mutate();
  try {
    return await action();
  } finally {
    restore();
  }
}

/**
 * Core render function using OfflineAudioContext.
 *
 * Uses project.copy() + OfflineAudioContext + AudioWorklets.createEngine()
 * for all export modes. This approach:
 * - Avoids OfflineEngineRenderer (panics with numStems===0 for mixdown,
 *   and liveStreamReceiver "Already connected" issues)
 * - Supports both mixdown (metronome included) and stem export paths
 * - Provides precise sample-count rendering for exact range bounds
 *
 * @param exportConfiguration - undefined = mixdown path (includes metronome),
 *   ExportStemsConfiguration = stem path (excludes metronome)
 * @param metronomeEnabled - set on the worklet's preferences before rendering
 * @param metronomeGain - dB value for metronome gain
 */
async function renderRange(
  project: Project,
  startPpqn: ppqn,
  endPpqn: ppqn,
  sampleRate: number,
  exportConfiguration?: ExportStemsConfiguration,
  metronomeEnabled: boolean = false,
  metronomeGain: number = -6
): Promise<Float32Array[]> {
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  const numChannels = exportConfiguration
    ? Object.keys(exportConfiguration).length * 2
    : 2;
  const numSamples = Math.ceil(durationSeconds * sampleRate);

  // Copy the project so mutations (mutes) are isolated
  const projectCopy = project.copy();

  // Disable loop area so playback doesn't wrap
  projectCopy.boxGraph.beginTransaction();
  projectCopy.timelineBox.loopArea.enabled.setValue(false);
  projectCopy.boxGraph.endTransaction();

  const context = new OfflineAudioContext(numChannels, numSamples, sampleRate);
  const worklets = await AudioWorklets.createFor(context);
  const engineWorklet = worklets.createEngine({
    project: projectCopy,
    exportConfiguration,
  });
  engineWorklet.connect(context.destination);

  // Set metronome on the worklet's preferences before play
  engineWorklet.preferences.settings.metronome.enabled = metronomeEnabled;
  engineWorklet.preferences.settings.metronome.gain = metronomeGain;

  // Set start position and play
  engineWorklet.setPosition(startPpqn);
  await engineWorklet.isReady();
  engineWorklet.play();

  // Wait for samples to load
  while (!(await engineWorklet.queryLoadingComplete())) {
    await Wait.timeSpan(TimeSpan.millis(100));
  }

  const audioBuffer = await context.startRendering();

  // Clean up
  projectCopy.terminate();

  // Extract channels
  const channels: Float32Array[] = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }
  return channels;
}

/**
 * Get all AudioUnitBox mute states, and functions to mute all / restore.
 */
function createMuteHelper(project: Project, tracks: TrackData[]) {
  const originalMutes = new Map<string, boolean>();
  for (const track of tracks) {
    originalMutes.set(
      UUID.toString(track.audioUnitBox.address.uuid),
      track.audioUnitBox.mute.getValue()
    );
  }

  return {
    muteAll() {
      project.editing.modify(() => {
        for (const track of tracks) {
          track.audioUnitBox.mute.setValue(true);
        }
      });
    },
    muteAllExcept(keepUuid: string) {
      project.editing.modify(() => {
        for (const track of tracks) {
          const uuid = UUID.toString(track.audioUnitBox.address.uuid);
          track.audioUnitBox.mute.setValue(uuid !== keepUuid);
        }
      });
    },
    restore() {
      project.editing.modify(() => {
        for (const track of tracks) {
          const uuid = UUID.toString(track.audioUnitBox.address.uuid);
          track.audioUnitBox.mute.setValue(originalMutes.get(uuid) ?? false);
        }
      });
    },
  };
}

/**
 * Mode 1: Export metronome only for a range.
 * Mutes all tracks, enables metronome, renders via mixdown path.
 */
export async function exportMetronomeOnly(
  options: RangeExportOptions & { tracks: TrackData[]; metronomeGain?: number }
): Promise<ExportResult> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, metronomeGain = -6 } = options;
  const muteHelper = createMuteHelper(project, tracks);

  const channels = await withProjectState(
    project,
    () => muteHelper.muteAll(),
    () => muteHelper.restore(),
    () => renderRange(project, startPpqn, endPpqn, sampleRate, undefined, true, metronomeGain)
  );

  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  return { label: "Metronome", channels, sampleRate, durationSeconds };
}

/**
 * Mode 2: Export clean stems for a range (selected tracks only).
 * Disables metronome, renders via stem export path.
 */
export async function exportStemsRange(
  options: RangeExportOptions & { tracks: TrackData[]; selectedUuids: string[] }
): Promise<ExportResult[]> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, selectedUuids } = options;

  // Build ExportStemsConfiguration for selected tracks only
  const selectedTracks = tracks.filter((t) =>
    selectedUuids.includes(UUID.toString(t.audioUnitBox.address.uuid))
  );
  const exportConfig: ExportStemsConfiguration = {};
  for (const track of selectedTracks) {
    const uuid = UUID.toString(track.audioUnitBox.address.uuid);
    exportConfig[uuid] = {
      includeAudioEffects: true,
      includeSends: true,
      useInstrumentOutput: true,
      fileName: track.name,
    };
  }

  const channels = await renderRange(
    project, startPpqn, endPpqn, sampleRate, exportConfig, false
  );

  // Split interleaved channels into per-stem results
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  const results: ExportResult[] = [];
  for (let i = 0; i < selectedTracks.length; i++) {
    const left = channels[i * 2];
    const right = channels[i * 2 + 1];
    if (left && right) {
      results.push({
        label: selectedTracks[i].name,
        channels: [left, right],
        sampleRate,
        durationSeconds,
      });
    }
  }
  return results;
}

/**
 * Mode 3: Export single stem + metronome for a range.
 * Mutes all tracks except selected, enables metronome, renders via mixdown path.
 */
export async function exportStemWithMetronome(
  options: RangeExportOptions & {
    tracks: TrackData[];
    audioUnitUuid: string;
    metronomeGain?: number;
  }
): Promise<ExportResult> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, audioUnitUuid, metronomeGain = -6 } =
    options;
  const muteHelper = createMuteHelper(project, tracks);

  const channels = await withProjectState(
    project,
    () => muteHelper.muteAllExcept(audioUnitUuid),
    () => muteHelper.restore(),
    () => renderRange(project, startPpqn, endPpqn, sampleRate, undefined, true, metronomeGain)
  );

  const selectedTrack = tracks.find(
    (t) => UUID.toString(t.audioUnitBox.address.uuid) === audioUnitUuid
  );
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  return {
    label: `${selectedTrack?.name ?? "Track"} + Metronome`,
    channels,
    sampleRate,
    durationSeconds,
  };
}

/**
 * Create an AudioBuffer from Float32Array channels for in-browser preview.
 */
export function channelsToAudioBuffer(
  channels: Float32Array[],
  sampleRate: number
): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  const buffer = new AudioBuffer({
    length,
    numberOfChannels: channels.length,
    sampleRate,
  });
  for (let i = 0; i < channels.length; i++) {
    buffer.copyToChannel(channels[i], i);
  }
  return buffer;
}

/**
 * Encode channels to WAV and trigger browser download.
 */
export function downloadAsWav(
  channels: Float32Array[],
  sampleRate: number,
  fileName: string
): void {
  const audioBuffer = channelsToAudioBuffer(channels, sampleRate);
  const wavArrayBuffer = WavFile.encodeFloats(audioBuffer);
  const blob = new Blob([wavArrayBuffer], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.wav`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
