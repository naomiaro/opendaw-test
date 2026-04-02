import { Project, OfflineEngineRenderer } from "@opendaw/studio-core";
import { WavFile, PPQN, ppqn } from "@opendaw/lib-dsp";
import { Option, UUID } from "@opendaw/lib-std";
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
 * The callback receives the project with mutated state — the renderer
 * serializes the project on creation, so restoration is safe after that.
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
 * Core render function: create renderer, set position, step exact samples.
 */
async function renderRange(
  project: Project,
  exportConfig: Option<ExportStemsConfiguration>,
  startPpqn: ppqn,
  endPpqn: ppqn,
  sampleRate: number
): Promise<Float32Array[]> {
  const renderer = await OfflineEngineRenderer.create(project, exportConfig, sampleRate);
  try {
    await renderer.waitForLoading();
    renderer.setPosition(startPpqn);
    renderer.play();
    const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
    const numSamples = Math.ceil(durationSeconds * sampleRate);
    const channels = await renderer.step(numSamples);
    return channels;
  } finally {
    renderer.terminate();
  }
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
 * Save and restore metronome state.
 */
function createMetronomeHelper(project: Project) {
  const settings = project.engine.preferences.settings;
  const wasEnabled = settings.metronome.enabled;
  const previousGain = settings.metronome.gain;

  return {
    enable(gain?: number) {
      settings.metronome.enabled = true;
      if (gain !== undefined) settings.metronome.gain = gain;
    },
    disable() {
      settings.metronome.enabled = false;
    },
    restore() {
      settings.metronome.enabled = wasEnabled;
      settings.metronome.gain = previousGain;
    },
  };
}

/**
 * Mode 1: Export metronome only for a range.
 * Mutes all tracks, enables metronome, renders via Option.None (mixdown path).
 */
export async function exportMetronomeOnly(
  options: RangeExportOptions & { tracks: TrackData[]; metronomeGain?: number }
): Promise<ExportResult> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, metronomeGain } = options;
  const muteHelper = createMuteHelper(project, tracks);
  const metronomeHelper = createMetronomeHelper(project);

  const channels = await withProjectState(
    project,
    () => {
      muteHelper.muteAll();
      metronomeHelper.enable(metronomeGain);
    },
    () => {
      muteHelper.restore();
      metronomeHelper.restore();
    },
    () => renderRange(project, Option.None, startPpqn, endPpqn, sampleRate)
  );

  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  return { label: "Metronome", channels, sampleRate, durationSeconds };
}

/**
 * Mode 2: Export clean stems for a range (selected tracks only).
 * Disables metronome, renders via ExportStemsConfiguration.
 */
export async function exportStemsRange(
  options: RangeExportOptions & { tracks: TrackData[]; selectedUuids: string[] }
): Promise<ExportResult[]> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, selectedUuids } = options;
  const metronomeHelper = createMetronomeHelper(project);

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

  const channels = await withProjectState(
    project,
    () => metronomeHelper.disable(),
    () => metronomeHelper.restore(),
    () => renderRange(project, Option.wrap(exportConfig), startPpqn, endPpqn, sampleRate)
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
 * Mutes all tracks except selected, enables metronome, renders via Option.None.
 */
export async function exportStemWithMetronome(
  options: RangeExportOptions & {
    tracks: TrackData[];
    audioUnitUuid: string;
    metronomeGain?: number;
  }
): Promise<ExportResult> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, audioUnitUuid, metronomeGain } =
    options;
  const muteHelper = createMuteHelper(project, tracks);
  const metronomeHelper = createMetronomeHelper(project);

  const channels = await withProjectState(
    project,
    () => {
      muteHelper.muteAllExcept(audioUnitUuid);
      metronomeHelper.enable(metronomeGain);
    },
    () => {
      muteHelper.restore();
      metronomeHelper.restore();
    },
    () => renderRange(project, Option.None, startPpqn, endPpqn, sampleRate)
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
