import { Project, AudioWorklets, OfflineEngineRenderer } from "@opendaw/studio-core";
import { WavFile, ppqn } from "@opendaw/lib-dsp";
import { UUID, TimeSpan, Option } from "@opendaw/lib-std";
import { Wait } from "@opendaw/lib-runtime";
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
 * Core render function.
 *
 * Renders a project copy for an exact PPQN range on one of two paths:
 *
 * - **No metronome** (default): `OfflineEngineRenderer` (the current, non-deprecated
 *   offline API) with `variant: false` — a dedicated Worker, no OfflineAudioContext.
 *   Uses `create → setPosition → play → waitForLoading → step(numSamples)` for an
 *   exact frame count. `renderer.render(config, start, end, …)` is NOT used for
 *   range exports: its worker loop stops on silence detection / maxDurationSeconds,
 *   not at endPosition (end only drives the progress bar), so it would render past
 *   the range while content continues.
 *
 * - **Metronome enabled**: the legacy OfflineAudioContext + `createEngine` path.
 *   The engine's metronome flag/gain live in engine PREFERENCES, which sync over the
 *   port's "engine-preferences" channel; `EngineWorklet` hosts that sync
 *   (`worklet.preferences`), but `OfflineEngineRenderer` never attaches the host side,
 *   so its processor keeps the schema defaults (metronome disabled) with no way to
 *   change them. Until upstream exposes preferences on the offline renderer, metronome
 *   renders must stay on the worklet path. (This path breaks if a WASM engine booted
 *   on another context first — WasmEngine.ensureReady registers the processor module
 *   only on the first context, see debug/wasm-ensure-ready-second-context.md. No
 *   export caller installs the WASM engine.)
 *
 * Both paths select the same engine export branch — undefined config takes the
 * mixdown branch (metronome bus mixed in when enabled), a stems config takes the
 * stem branch (metronome excluded). See documentation/10-export.md. Verified
 * equivalent 2026-07-15: full-song timestretch renders from both paths are
 * byte-identical (same SHA-256).
 *
 * @param exportConfiguration - undefined = mixdown path,
 *   Record<uuid, ExportStemConfiguration> = stem path.
 *   When provided, returned channels are interleaved: [stem1_L, stem1_R, stem2_L, ...].
 * @param mutateBeforeCopy/restoreAfterCopy - mutate the LIVE project (e.g. mutes),
 *   copy synchronously, restore — the copy captures the mutated state.
 * @param metronomeEnabled - selects the worklet path and enables the metronome there
 * @param metronomeGain - dB value for metronome gain (max 0)
 */
async function renderRange(
  project: Project,
  startPpqn: ppqn,
  endPpqn: ppqn,
  sampleRate: number,
  exportConfiguration?: Record<string, ExportStemConfiguration>,
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

    return metronomeEnabled
      ? await renderViaEngineWorklet(
          projectCopy, startPpqn, numSamples, numChannels, sampleRate,
          exportConfiguration, metronomeGain
        )
      : await renderViaOfflineEngineRenderer(
          projectCopy, startPpqn, numSamples, numChannels, sampleRate,
          exportConfiguration
        );
  } finally {
    projectCopy.terminate();
  }
}

/** Current offline path — OfflineEngineRenderer worker, exact frame count via step(). */
async function renderViaOfflineEngineRenderer(
  projectCopy: Project,
  startPpqn: ppqn,
  numSamples: number,
  numChannels: number,
  sampleRate: number,
  exportConfiguration?: Record<string, ExportStemConfiguration>
): Promise<Float32Array[]> {
  const renderer = await OfflineEngineRenderer.create(
    projectCopy,
    exportConfiguration ? Option.wrap({ stems: exportConfiguration }) : Option.None,
    sampleRate,
    // Pin the TS offline worker. `variant` defaults to WasmEngine.useForExports(),
    // which flips to the WASM worker once any page installs+boots the WASM engine.
    false
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
}

/** Legacy path — kept ONLY because engine preferences (metronome) are unreachable
 *  through OfflineEngineRenderer; EngineWorklet hosts the preferences sync. */
async function renderViaEngineWorklet(
  projectCopy: Project,
  startPpqn: ppqn,
  numSamples: number,
  numChannels: number,
  sampleRate: number,
  exportConfiguration: Record<string, ExportStemConfiguration> | undefined,
  metronomeGain: number
): Promise<Float32Array[]> {
  const context = new OfflineAudioContext(numChannels, numSamples, sampleRate);
  const worklets = await AudioWorklets.createFor(context);
  const engineWorklet = worklets.createEngine({
    project: projectCopy,
    exportConfiguration: exportConfiguration ? { stems: exportConfiguration } : undefined,
  });
  engineWorklet.connect(context.destination, 0);

  // Engine preferences don't travel with project.copy() — set on worklet directly
  engineWorklet.preferences.settings.metronome.enabled = true;
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

  const channels = selectedTracks.length > 0
    ? await renderRange(project, startPpqn, endPpqn, sampleRate, exportConfig, undefined, undefined, false)
    : [];

  if (selectedTracks.length > 0 && channels.length !== selectedTracks.length * 2) {
    console.warn(
      `Expected ${selectedTracks.length * 2} channels for ${selectedTracks.length} stems, ` +
      `got ${channels.length}. Some stems may be missing.`
    );
  }

  // Derive duration from rendered data — avoids re-querying the tempo map after
  // the await, where a mid-render tempo mutation could skew the result.
  // Fall back to tempo-map value when no tracks were rendered.
  const durationSeconds = channels[0] != null
    ? channels[0].length / sampleRate
    : project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
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
    // Derive metronome stem duration from its rendered data.
    const metronomeDuration = metronomeChannels[0] != null
      ? metronomeChannels[0].length / sampleRate
      : durationSeconds;
    results.push({
      label: "Metronome",
      channels: metronomeChannels,
      sampleRate,
      durationSeconds: metronomeDuration,
    });
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
    undefined, undefined, undefined,
    metronomeEnabled, metronomeGain
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
