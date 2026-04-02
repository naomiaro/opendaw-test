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
  mutateBeforeCopy?: () => void,
  restoreAfterCopy?: () => void,
  metronomeEnabled: boolean = false,
  metronomeGain: number = -6
): Promise<Float32Array[]> {
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  const numChannels = exportConfiguration
    ? Object.keys(exportConfiguration).length * 2
    : 2;
  const numSamples = Math.ceil(durationSeconds * sampleRate);

  if (startPpqn >= endPpqn) {
    throw new Error(
      `Invalid export range: start (${startPpqn}) must be before end (${endPpqn})`
    );
  }

  // Mutate the original project (e.g., mute tracks), copy synchronously to
  // capture the state, then restore immediately. The mute window is a single
  // synchronous JS task — no audio blocks process in between.
  // try/finally ensures restore even if project.copy() throws.
  let projectCopy: Project;
  if (mutateBeforeCopy) mutateBeforeCopy();
  try {
    projectCopy = project.copy();
  } finally {
    if (restoreAfterCopy) restoreAfterCopy();
  }

  try {
    projectCopy.editing.modify(() => {
      projectCopy.timelineBox.loopArea.enabled.setValue(false);
    });

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
 * Export a mixdown of selected tracks for a range, optionally with metronome.
 * Mutes unselected tracks on the copy, renders via mixdown path (stereo output).
 * If no tracks are selected, renders metronome only.
 */
export async function exportMixdown(
  options: RangeExportOptions & {
    tracks: TrackData[];
    selectedUuids: string[];
    includeMetronome: boolean;
    metronomeGain?: number;
  }
): Promise<ExportResult> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, selectedUuids, includeMetronome, metronomeGain = -6 } = options;

  // Save original mute states, mute unselected tracks, copy, restore
  const originalMutes = new Map<TrackData, boolean>();
  for (const track of tracks) {
    originalMutes.set(track, track.audioUnitBox.mute.getValue());
  }

  const channels = await renderRange(
    project, startPpqn, endPpqn, sampleRate,
    undefined,
    () => {
      project.editing.modify(() => {
        for (const track of tracks) {
          const uuid = UUID.toString(track.audioUnitBox.address.uuid);
          track.audioUnitBox.mute.setValue(!selectedUuids.includes(uuid));
        }
      });
    },
    () => {
      project.editing.modify(() => {
        for (const [track, wasMuted] of originalMutes) {
          track.audioUnitBox.mute.setValue(wasMuted);
        }
      });
    },
    includeMetronome, metronomeGain
  );

  const selectedNames = tracks
    .filter((t) => selectedUuids.includes(UUID.toString(t.audioUnitBox.address.uuid)))
    .map((t) => t.name);
  const parts = [...selectedNames];
  if (includeMetronome) parts.push("Metronome");
  const label = parts.length > 0 ? parts.join(" + ") : "Empty";

  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  return { label, channels, sampleRate, durationSeconds };
}

/**
 * Export clean stems for a range (selected tracks only), with optional metronome stem.
 * Track stems render via the stem export path (one stereo pair per track, no metronome).
 * If includeMetronome is true, an additional metronome-only stem is rendered via a
 * separate mixdown pass (all tracks muted, metronome enabled).
 */
export async function exportStemsRange(
  options: RangeExportOptions & {
    tracks: TrackData[];
    selectedUuids: string[];
    includeMetronome?: boolean;
    metronomeGain?: number;
  }
): Promise<ExportResult[]> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, selectedUuids, includeMetronome = false, metronomeGain = -6 } = options;

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

  const channels = selectedTracks.length > 0
    ? await renderRange(project, startPpqn, endPpqn, sampleRate, exportConfig, undefined, undefined, false)
    : [];

  if (selectedTracks.length > 0 && channels.length !== selectedTracks.length * 2) {
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

  // Render metronome as an additional stem via mixdown path (all tracks muted)
  if (includeMetronome) {
    const savedMutes = new Map<TrackData, boolean>();
    for (const track of tracks) {
      savedMutes.set(track, track.audioUnitBox.mute.getValue());
    }

    const metronomeChannels = await renderRange(
      project, startPpqn, endPpqn, sampleRate,
      undefined,
      () => {
        project.editing.modify(() => {
          for (const track of tracks) {
            track.audioUnitBox.mute.setValue(true);
          }
        });
      },
      () => {
        project.editing.modify(() => {
          for (const [track, wasMuted] of savedMutes) {
            track.audioUnitBox.mute.setValue(wasMuted);
          }
        });
      },
      true, metronomeGain
    );
    results.push({
      label: "Metronome",
      channels: metronomeChannels,
      sampleRate,
      durationSeconds,
    });
  }

  return results;
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
