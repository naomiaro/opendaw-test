import { useState, useCallback, useRef } from "react";
import { Project } from "@opendaw/studio-core";
import { Errors, UUID } from "@opendaw/lib-std";
import { exportFullMix, exportStems } from "../lib/audioExport";
import type { StemExportConfig } from "../lib/audioExport";

/**
 * Configuration for building stem export settings
 */
export interface StemConfigBuilder {
  /**
   * Whether to include audio effects in the stem export
   */
  includeAudioEffects: boolean;

  /**
   * Whether to include sends in the stem export
   */
  includeSends: boolean;
}

/**
 * Custom hook for audio export functionality
 *
 * Provides full mix and stems export with status tracking
 *
 * @param project - The OpenDAW project instance
 * @param options - Export configuration options
 * @returns Export state and handlers
 *
 * @example
 * ```typescript
 * const {
 *   isExporting,
 *   exportStatus,
 *   handleExportMix,
 *   handleExportStems
 * } = useAudioExport(project, {
 *   sampleRate: 48000,
 *   mixFileName: "my-mix"
 * });
 *
 * // Export full mix
 * await handleExportMix();
 *
 * // Export stems
 * await handleExportStems({
 *   includeAudioEffects: true,
 *   includeSends: false
 * });
 * ```
 */
export function useAudioExport(
  project: Project | null,
  options: {
    /**
     * Sample rate for export (default: 48000)
     */
    sampleRate?: number;

    /**
     * Base filename for full mix export (default: "mix")
     */
    mixFileName?: string;
  } = {}
) {
  const { sampleRate = 48000, mixFileName = "mix" } = options;

  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [exportProgress, setExportProgress] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Abort the current export
   */
  const handleAbortExport = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  /**
   * Export the full mix (all tracks mixed down)
   */
  const handleExportMix = useCallback(async () => {
    if (!project) return;

    // Create new AbortController for this export
    abortControllerRef.current = new AbortController();

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus("Exporting... This may take a moment.");

    try {
      await exportFullMix(project, {
        fileName: mixFileName,
        sampleRate,
        onStatus: setExportStatus,
        onProgress: setExportProgress,
        abortSignal: abortControllerRef.current.signal
      });
    } catch (error) {
      // Don't log abort errors as failures
      if (!Errors.isAbort(error)) {
        console.error("Export failed:", error);
        setExportStatus("Export failed!");
      }
    } finally {
      setIsExporting(false);
      setExportProgress(0);
      abortControllerRef.current = null;
    }
  }, [project, mixFileName, sampleRate]);

  /**
   * Export individual stems
   *
   * @param config - Stem export configuration
   */
  const handleExportStems = useCallback(async (config: StemConfigBuilder) => {
    if (!project) return;

    // Create new AbortController for this export
    abortControllerRef.current = new AbortController();

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus("Exporting stems... This may take a moment.");

    try {
      // Build stem configuration by iterating through all audio units in the project
      // This matches OpenDAW's showExportStemsDialog approach
      const stemsConfig: Record<string, StemExportConfig> = {};

      // Get all audio units from the project
      const audioUnits = project.rootBoxAdapter.audioUnits.adapters();

      audioUnits.forEach((unit, index) => {
        // Skip the output unit
        if (unit.isOutput) return;

        const uuid = UUID.toString(unit.uuid);
        const trackName = unit.input.label.unwrap() || `Track ${index + 1}`;

        stemsConfig[uuid] = {
          includeAudioEffects: config.includeAudioEffects,
          includeSends: config.includeSends,
          fileName: trackName
        };
      });

      await exportStems(project, stemsConfig, {
        sampleRate,
        onStatus: setExportStatus,
        onProgress: setExportProgress,
        abortSignal: abortControllerRef.current.signal
      });
    } catch (error) {
      // Don't log abort errors as failures
      if (!Errors.isAbort(error)) {
        console.error("Stems export failed:", error);
        setExportStatus("Stems export failed!");
      }
    } finally {
      setIsExporting(false);
      setExportProgress(0);
      abortControllerRef.current = null;
    }
  }, [project, sampleRate]);

  return {
    isExporting,
    exportStatus,
    exportProgress,
    handleExportMix,
    handleExportStems,
    handleAbortExport
  };
}
