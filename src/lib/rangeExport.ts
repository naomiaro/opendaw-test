import { Project, OfflineEngineRenderer } from "@opendaw/studio-core";
import { WavFile, ppqn } from "@opendaw/lib-dsp";
import { UUID, Option } from "@opendaw/lib-std";
import { ExportConfiguration } from "@opendaw/studio-adapters";
import type { ExportStemConfiguration } from "@opendaw/studio-adapters";
import type { TrackData } from "./types";
import { withDeadline } from "./deadline";

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
// Offline renders run faster than realtime but are still real compute (the Dark Ride
// full song is ~235 s of audio). This ceiling only exists so a wedged worker fails
// loudly instead of hanging the export forever — sized generously (~realtime+) so a
// legitimate full-song render on a slow machine never false-trips it.
const RENDER_TIMEOUT_MS = 300_000;

/**
 * Core render function — `OfflineEngineRenderer` (the current, non-deprecated offline
 * API) for every export mode. A dedicated Worker, no OfflineAudioContext.
 *
 * Uses `create → setPosition → play → waitForLoading → step(numSamples)` for an
 * exact frame count. `renderer.render(config, start, end, …)` is NOT used for
 * range exports: its worker loop stops on silence detection / maxDurationSeconds,
 * not at endPosition (end only drives the progress bar), so it would render past
 * the range while content continues.
 *
 * **Metronome** (openDAW#316): expressed in the export configuration —
 * `{metronome: {includeInMixdown: true}}` mixes the click into a mixdown;
 * `{stems, metronome: {stem: {fileName}}}` appends a click stem AFTER the unit stems
 * (`countStems` counts the extra pair). `settings` overrides gain/beatSubDivision/
 * monophonic (schema defaults otherwise); enabled is implied by presence.
 * Every render runs the WASM offline worker (`variant: true`) — the only engine in
 * this repo; the worker is registered by initializeOpenDAW's installWasmEngine().
 *
 * @param exportConfiguration - undefined = plain stereo mixdown; otherwise a full
 *   `ExportConfiguration` (stems and/or metronome). With stems, returned channels are
 *   interleaved [stem1_L, stem1_R, stem2_L, ...] with the metronome pair LAST.
 * @param mutateBeforeCopy/restoreAfterCopy - mutate the LIVE project (e.g. mutes),
 *   copy synchronously, restore — the copy captures the mutated state.
 */
async function renderRange(
  project: Project,
  startPpqn: ppqn,
  endPpqn: ppqn,
  sampleRate: number,
  exportConfiguration?: ExportConfiguration,
  mutateBeforeCopy?: () => void,
  restoreAfterCopy?: () => void
): Promise<Float32Array[]> {
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  const optConfig: Option<ExportConfiguration> = exportConfiguration
    ? Option.wrap(exportConfiguration)
    : Option.None;
  const numChannels = ExportConfiguration.countStems(optConfig) * 2;
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

    const renderer = await OfflineEngineRenderer.create(
      projectCopy,
      optConfig,
      sampleRate,
      true
    );
    try {
      renderer.setPosition(startPpqn);
      await withDeadline(
        (async () => {
          await renderer.play(); // starts transport + one queryLoadingComplete round-trip
          await renderer.waitForLoading();
        })(),
        LOADING_TIMEOUT_MS,
        "Offline render: sample loading"
      );
      const channels = await withDeadline(
        renderer.step(numSamples),
        RENDER_TIMEOUT_MS,
        "Offline render: step"
      );
      if (channels.length !== numChannels || channels[0]?.length !== numSamples) {
        throw new Error(
          `Offline render returned ${channels.length} channel(s) of ` +
            `${channels[0]?.length ?? 0} frames, expected ${numChannels}×${numSamples}`
        );
      }
      return channels;
    } finally {
      // Cleanup must not mask an in-flight error or skip terminate().
      try { renderer.stop(); } catch (e) { console.error("renderer.stop() failed: " + String(e)); }
      try { renderer.terminate(); } catch (e) { console.error("renderer.terminate() failed: " + String(e)); }
    }
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
    includeMetronome
      ? { metronome: { includeInMixdown: true, settings: { gain: metronomeGain } } }
      : undefined,
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
    }
  );

  const selectedNames = tracks
    .filter((t) => selectedUuids.includes(UUID.toString(t.audioUnitBox.address.uuid)))
    .map((t) => t.name);
  const parts = [...selectedNames];
  if (includeMetronome) parts.push("Metronome");
  const label = parts.length > 0 ? parts.join(" + ") : "Empty";

  // Derive duration from rendered data — avoids re-querying the tempo map after
  // the await, where a mid-render tempo mutation could skew the result.
  const durationSeconds = channels[0] != null ? channels[0].length / sampleRate : 0;
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
  const exportConfig: Record<string, ExportStemConfiguration> = {};
  for (const track of selectedTracks) {
    const uuid = UUID.toString(track.audioUnitBox.address.uuid);
    exportConfig[uuid] = {
      includeAudioEffects: true,
      includeSends: true,
      // false routes through the channel strip so effects, aux sends, and the
      // strip's volume/pan all reach the render. `useInstrumentOutput: true`
      // wires the raw instrument output to the bus and returns early
      // (core@0.0.152 AudioDeviceChain), bypassing all three.
      useInstrumentOutput: false,
      fileName: track.name,
    };
  }

  if (selectedTracks.length === 0 && !includeMetronome) return [];

  // One render for everything: unit stems in `stems` key order, and — when requested —
  // the metronome as its own stem pair appended LAST (SDK 0.0.160 ExportConfiguration
  // semantics; a metronome-ONLY export is `{stems: {}, metronome: {stem}}`).
  const channels = await renderRange(project, startPpqn, endPpqn, sampleRate, {
    stems: exportConfig,
    ...(includeMetronome
      ? { metronome: { stem: { fileName: "Metronome" }, settings: { gain: metronomeGain } } }
      : {}),
  });

  const expectedPairs = selectedTracks.length + (includeMetronome ? 1 : 0);
  if (channels.length !== expectedPairs * 2) {
    console.warn(
      `Expected ${expectedPairs * 2} channels for ${expectedPairs} stems, ` +
      `got ${channels.length}. Some stems may be missing.`
    );
  }

  // Derive duration from rendered data — avoids re-querying the tempo map after
  // the await, where a mid-render tempo mutation could skew the result.
  const durationSeconds = channels[0] != null
    ? channels[0].length / sampleRate
    : project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  const stemLabels = [
    ...selectedTracks.map((t) => t.name),
    ...(includeMetronome ? ["Metronome"] : []),
  ];
  const results: ExportResult[] = [];
  for (let i = 0; i < stemLabels.length; i++) {
    const left = channels[i * 2];
    const right = channels[i * 2 + 1];
    if (left && right) {
      results.push({
        label: stemLabels[i],
        channels: [left, right],
        sampleRate,
        durationSeconds,
      });
    }
  }

  return results;
}

/**
 * Render a plain mixdown of the live project for a tick range — no track
 * muting, optional metronome. Used by the audio-verify harness.
 *
 * metronomeGain defaults to 0 dB (not this file's usual -6): the verify
 * harness needs full-level clicks for onset detection.
 */
export async function renderMixdownRange(options: {
  project: Project;
  startPpqn: ppqn;
  endPpqn: ppqn;
  sampleRate?: number;
  metronomeEnabled?: boolean;
  metronomeGain?: number;
}): Promise<ExportResult> {
  const {
    project, startPpqn, endPpqn,
    sampleRate = 48000, metronomeEnabled = false, metronomeGain = 0,
  } = options;
  const channels = await renderRange(
    project, startPpqn, endPpqn, sampleRate,
    metronomeEnabled
      ? { metronome: { includeInMixdown: true, settings: { gain: metronomeGain } } }
      : undefined
  );
  // Derive duration from rendered data — avoids re-querying the tempo map after
  // the await, where a mid-render tempo mutation could skew the result.
  const durationSeconds = channels[0] != null ? channels[0].length / sampleRate : 0;
  return {
    label: "Mixdown",
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
