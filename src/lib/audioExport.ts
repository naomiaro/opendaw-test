/**
 * Audio Export Utility for OpenDAW Demos
 *
 * Provides reusable methods to export audio from OpenDAW projects:
 * - Full mix export (all tracks mixed down)
 * - Individual stems export (separate files per track)
 * - WAV format with 32-bit float encoding
 *
 * Renders via `OfflineEngineRenderer.start` — the WASM offline worker, the only
 * engine (the deprecated `AudioOfflineRenderer` was removed upstream along with
 * the TypeScript engine). `start` renders [0, lastRegionAction()]. It connects
 * the source's `liveStreamReceiver` (held by the live engine) and does NOT copy
 * internally, so we render from a `project.copy()` — same pattern as
 * `src/lib/rangeExport.ts`, which also covers range-bounded renders.
 */

import { Project, OfflineEngineRenderer } from "@opendaw/studio-core";
import { WavFile } from "@opendaw/lib-dsp";
import type { AudioData } from "@opendaw/lib-dsp";
import { DefaultObservableValue, Errors, Option } from "@opendaw/lib-std";
import type { ExportConfiguration } from "@opendaw/studio-adapters";

export interface ExportOptions {
  /**
   * Sample rate for export (default: 48000)
   */
  sampleRate?: number;

  /**
   * Filename for the exported file (without extension)
   */
  fileName?: string;

  /**
   * Callback for progress updates (0-100)
   */
  onProgress?: (progress: number) => void;

  /**
   * Callback for status messages
   */
  onStatus?: (status: string) => void;

  /**
   * AbortSignal to cancel the export
   */
  abortSignal?: AbortSignal;
}

export interface StemExportConfig {
  /**
   * Include audio effects on this stem
   */
  includeAudioEffects: boolean;

  /**
   * Include sends/aux effects on this stem
   */
  includeSends: boolean;

  /**
   * Output filename for this stem (without extension)
   */
  fileName: string;
}

/**
 * Render the full project through `OfflineEngineRenderer.start`, forwarding
 * worker progress (unit 0-1) to the 0-100 callback the demos expect.
 */
async function renderProject(
  project: Project,
  optConfig: Option<ExportConfiguration>,
  sampleRate: number,
  onProgress?: (progress: number) => void,
  abortSignal?: AbortSignal
): Promise<AudioData> {
  const progress = new DefaultObservableValue(0);
  const progressSub = progress.subscribe((obs) => {
    onProgress?.(Math.round(obs.getValue() * 100));
  });
  // The renderer connects the source's liveStreamReceiver — the live engine already
  // holds it ("Already connected"), so always render from a copy.
  const projectCopy = project.copy();
  try {
    return await OfflineEngineRenderer.start(
      projectCopy,
      optConfig,
      progress,
      abortSignal,
      sampleRate
    );
  } finally {
    progressSub.terminate();
    projectCopy.terminate();
  }
}

/**
 * Export the full mix (all tracks mixed down to a single stereo file)
 *
 * @param project - The OpenDAW project to export
 * @param options - Export options
 * @returns Promise that resolves when export is complete
 *
 * @example
 * ```typescript
 * await exportFullMix(project, {
 *   fileName: "my-mix",
 *   onProgress: (p) => console.log(`${p}%`),
 *   onStatus: (s) => setStatus(s)
 * });
 * ```
 */
export async function exportFullMix(
  project: Project,
  options: ExportOptions = {}
): Promise<void> {
  const {
    sampleRate = 48000,
    fileName = "mix",
    onProgress,
    onStatus,
    abortSignal
  } = options;

  try {
    onStatus?.("Preparing offline render...");

    // Render the project offline to AudioData
    // Pass Option.None for exportConfiguration to render the full mix
    onStatus?.("Rendering audio...");

    const audioData = await renderProject(
      project,
      Option.None, // No stem configuration = full mix
      sampleRate,
      onProgress,
      abortSignal
    );

    onStatus?.("Encoding WAV file...");

    // Convert AudioData to WAV format (32-bit float)
    const wavArrayBuffer = WavFile.encodeFloats(audioData);

    onStatus?.("Preparing download...");

    // Trigger browser download
    downloadArrayBuffer(wavArrayBuffer, `${fileName}.wav`, "audio/wav");

    onStatus?.("Export complete!");
  } catch (error) {
    // Check if this was an abort
    if (Errors.isAbort(error)) {
      onStatus?.("Export cancelled");
      return;
    }
    console.error("Export failed:", error);
    onStatus?.(`Export failed: ${error}`);
    throw error;
  }
}

/**
 * Export individual stems (separate WAV files for each track)
 *
 * @param project - The OpenDAW project to export
 * @param stemsConfig - Configuration for each stem (keyed by track UUID)
 * @param options - Export options
 * @returns Promise that resolves when all stems are exported
 *
 * @example
 * ```typescript
 * await exportStems(project, {
 *   [drumsUUID]: {
 *     includeAudioEffects: true,
 *     includeSends: false,
 *     fileName: "drums"
 *   },
 *   [bassUUID]: {
 *     includeAudioEffects: true,
 *     includeSends: false,
 *     fileName: "bass"
 *   }
 * });
 * ```
 */
export async function exportStems(
  project: Project,
  stemsConfig: Record<string, StemExportConfig>,
  options: ExportOptions = {}
): Promise<void> {
  const {
    sampleRate = 48000,
    onProgress,
    onStatus,
    abortSignal
  } = options;

  try {
    const stemCount = Object.keys(stemsConfig).length;
    if (stemCount === 0) {
      throw new Error("No stems configured for export");
    }

    onStatus?.(`Preparing to export ${stemCount} stems...`);

    // Wrap our flat stem map into SDK ExportConfiguration shape ({stems: ...}).
    // useInstrumentOutput must stay false: true wires the instrument output
    // straight to the bus, silently bypassing effects, sends, AND the channel
    // strip (openDAW's own export dialog omits the flag for the same reason).
    const exportConfig: ExportConfiguration = {
      stems: Object.fromEntries(
        Object.entries(stemsConfig).map(([uuid, stem]) => [
          uuid,
          { ...stem, useInstrumentOutput: false }
        ])
      )
    };

    onStatus?.("Rendering stems offline...");

    const audioData = await renderProject(
      project,
      Option.wrap(exportConfig),
      sampleRate,
      onProgress,
      abortSignal
    );

    // AudioData contains interleaved stereo pairs for each stem
    // Channel layout: [stem1_L, stem1_R, stem2_L, stem2_R, ...]
    const stems = Object.values(stemsConfig);
    const totalStems = stems.length;

    for (let i = 0; i < totalStems; i++) {
      const stem = stems[i];
      const leftChannelIndex = i * 2;
      const rightChannelIndex = i * 2 + 1;

      if (rightChannelIndex >= audioData.numberOfChannels) {
        throw new Error(
          `Insufficient channels for stem "${stem.fileName}": ` +
          `expected channel ${rightChannelIndex} but render only has ${audioData.numberOfChannels} channels`
        );
      }

      onStatus?.(`Encoding ${stem.fileName}.wav (${i + 1}/${totalStems})...`);

      // Encode this stem's stereo pair to WAV
      const wavArrayBuffer = WavFile.encodeFloats({
        sampleRate: audioData.sampleRate,
        numberOfFrames: audioData.numberOfFrames,
        numberOfChannels: 2,
        frames: [audioData.frames[leftChannelIndex], audioData.frames[rightChannelIndex]]
      });

      // Download
      downloadArrayBuffer(wavArrayBuffer, `${stem.fileName}.wav`, "audio/wav");
    }

    onStatus?.(`Successfully exported ${totalStems} stems!`);
  } catch (error) {
    // Check if this was an abort
    if (Errors.isAbort(error)) {
      onStatus?.("Export cancelled");
      return;
    }
    console.error("Stems export failed:", error);
    onStatus?.(`Export failed: ${error}`);
    throw error;
  }
}

/**
 * Trigger a browser download of an ArrayBuffer
 *
 * @param arrayBuffer - The data to download
 * @param fileName - Name of the file
 * @param mimeType - MIME type of the file
 */
function downloadArrayBuffer(
  arrayBuffer: ArrayBuffer,
  fileName: string,
  mimeType: string
): void {
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Sanitize a filename to remove invalid characters
 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "_");
}
