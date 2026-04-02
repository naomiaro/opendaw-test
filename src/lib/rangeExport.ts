import { Project, AudioWorklets } from "@opendaw/studio-core";
import { WavFile, ppqn } from "@opendaw/lib-dsp";
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

const LOADING_TIMEOUT_MS = 30_000;

/**
 * Core render function using OfflineAudioContext.
 *
 * Uses project.copy() + OfflineAudioContext + AudioWorklets.createEngine()
 * for all export modes. This avoids OfflineEngineRenderer which has
 * liveStreamReceiver conflicts and routes Option.None through the stem path
 * (excluding metronome). See documentation/22-offline-rendering-advanced.md.
 *
 * @param exportConfiguration - undefined = mixdown path (includes metronome),
 *   ExportStemsConfiguration = stem path (excludes metronome).
 *   When provided, returned channels are interleaved: [stem1_L, stem1_R, stem2_L, ...].
 * @param prepareCopy - optional callback to mutate the project copy before rendering
 *   (e.g., muting tracks). Applied to the copy, never the live project.
 * @param metronomeEnabled - set on the worklet's preferences before rendering
 * @param metronomeGain - dB value for metronome gain (max 0)
 */
async function renderRange(
  project: Project,
  startPpqn: ppqn,
  endPpqn: ppqn,
  sampleRate: number,
  exportConfiguration?: ExportStemsConfiguration,
  prepareCopy?: (copy: Project) => void,
  metronomeEnabled: boolean = false,
  metronomeGain: number = -6
): Promise<Float32Array[]> {
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  const numChannels = exportConfiguration
    ? Object.keys(exportConfiguration).length * 2
    : 2;
  const numSamples = Math.ceil(durationSeconds * sampleRate);

  // Copy isolates box graph mutations. Shares the original's sampleManager
  // so loaded samples remain available.
  const projectCopy = project.copy();
  try {
    projectCopy.boxGraph.beginTransaction();
    projectCopy.timelineBox.loopArea.enabled.setValue(false);
    projectCopy.boxGraph.endTransaction();

    // Apply caller mutations (mutes) to the copy, not the live project
    if (prepareCopy) {
      prepareCopy(projectCopy);
    }

    const context = new OfflineAudioContext(numChannels, numSamples, sampleRate);
    const worklets = await AudioWorklets.createFor(context);
    const engineWorklet = worklets.createEngine({
      project: projectCopy,
      exportConfiguration,
    });
    engineWorklet.connect(context.destination);

    // Engine preferences don't travel with project.copy() — set on worklet directly
    engineWorklet.preferences.settings.metronome.enabled = metronomeEnabled;
    engineWorklet.preferences.settings.metronome.gain = metronomeGain;

    engineWorklet.setPosition(startPpqn);
    await engineWorklet.isReady();
    engineWorklet.play();

    const startTime = Date.now();
    while (!(await engineWorklet.queryLoadingComplete())) {
      if (Date.now() - startTime > LOADING_TIMEOUT_MS) {
        throw new Error(
          `Sample loading timed out after ${LOADING_TIMEOUT_MS / 1000}s`
        );
      }
      await Wait.timeSpan(TimeSpan.millis(100));
    }

    const audioBuffer = await context.startRendering();

    const channels: Float32Array[] = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      channels.push(audioBuffer.getChannelData(i));
    }
    return channels;
  } finally {
    projectCopy.terminate();
  }
}

/**
 * Mode 1: Export metronome only for a range.
 * Mutes all tracks on the copy, enables metronome, renders via mixdown path.
 */
export async function exportMetronomeOnly(
  options: RangeExportOptions & { tracks: TrackData[]; metronomeGain?: number }
): Promise<ExportResult> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, metronomeGain = -6 } = options;

  const channels = await renderRange(
    project, startPpqn, endPpqn, sampleRate,
    undefined,
    (copy) => {
      copy.editing.modify(() => {
        for (const track of tracks) {
          track.audioUnitBox.mute.setValue(true);
        }
      });
    },
    true, metronomeGain
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
    project, startPpqn, endPpqn, sampleRate, exportConfig, undefined, false
  );

  if (channels.length !== selectedTracks.length * 2) {
    console.warn(
      `Expected ${selectedTracks.length * 2} channels for ${selectedTracks.length} stems, ` +
      `got ${channels.length}. Some stems may be missing.`
    );
  }

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
 * Mutes all tracks except selected on the copy, enables metronome, renders via mixdown path.
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

  const channels = await renderRange(
    project, startPpqn, endPpqn, sampleRate,
    undefined,
    (copy) => {
      copy.editing.modify(() => {
        for (const track of tracks) {
          const uuid = UUID.toString(track.audioUnitBox.address.uuid);
          track.audioUnitBox.mute.setValue(uuid !== audioUnitUuid);
        }
      });
    },
    true, metronomeGain
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
  if (channels.length === 0 || channels[0].length === 0) {
    throw new Error("No audio data to create buffer from");
  }
  const buffer = new AudioBuffer({
    length: channels[0].length,
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
