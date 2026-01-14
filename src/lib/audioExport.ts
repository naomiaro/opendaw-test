/**
 * Audio Export Utility for OpenDAW Demos
 *
 * Provides reusable methods to export audio from OpenDAW projects:
 * - Full mix export (all tracks mixed down)
 * - Individual stems export (separate files per track)
 * - WAV format with 32-bit float encoding
 */

import { Project, AudioOfflineRenderer, WavFile } from "@moises-ai/studio-core";
import { Errors, Option, Progress } from "@moises-ai/lib-std";
import type { ExportStemsConfiguration } from "@moises-ai/studio-adapters";

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

    // Render the project offline to AudioBuffer
    // Pass Option.None for exportConfiguration to render the full mix
    onStatus?.("Rendering audio...");

    const progressHandler: Progress.Handler = (value) => {
      onProgress?.(Math.round(value * 100));
    };

    const audioBuffer = await AudioOfflineRenderer.start(
      project,
      Option.None, // No stem configuration = full mix
      progressHandler,
      abortSignal,
      sampleRate
    );

    onStatus?.("Encoding WAV file...");

    // Convert AudioBuffer to WAV format (32-bit float)
    const wavArrayBuffer = WavFile.encodeFloats(audioBuffer);

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

    // Convert our config format to OpenDAW's ExportStemsConfiguration format
    const exportConfig: ExportStemsConfiguration = stemsConfig;

    onStatus?.("Rendering stems offline...");

    const progressHandler: Progress.Handler = (value) => {
      onProgress?.(Math.round(value * 100));
    };

    const audioBuffer = await AudioOfflineRenderer.start(
      project,
      Option.wrap(exportConfig),
      progressHandler,
      abortSignal,
      sampleRate
    );

    // AudioBuffer contains interleaved stereo pairs for each stem
    // Channel layout: [stem1_L, stem1_R, stem2_L, stem2_R, ...]
    const stems = Object.values(stemsConfig);
    const totalStems = stems.length;

    for (let i = 0; i < totalStems; i++) {
      const stem = stems[i];
      const leftChannel = audioBuffer.getChannelData(i * 2);
      const rightChannel = audioBuffer.getChannelData(i * 2 + 1);

      onStatus?.(`Encoding ${stem.fileName}.wav (${i + 1}/${totalStems})...`);

      // Create a new AudioBuffer for this stem
      const stemBuffer = new AudioBuffer({
        length: audioBuffer.length,
        numberOfChannels: 2,
        sampleRate: audioBuffer.sampleRate
      });
      stemBuffer.copyToChannel(leftChannel, 0);
      stemBuffer.copyToChannel(rightChannel, 1);

      // Encode to WAV
      const wavArrayBuffer = WavFile.encodeFloats(stemBuffer);

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
