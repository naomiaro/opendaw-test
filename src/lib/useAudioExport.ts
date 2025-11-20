import { useState, useCallback } from "react";
import { Project } from "@opendaw/studio-core";
import { UUID } from "@opendaw/lib-std";
import { exportFullMix, exportStems } from "./audioExport";
import type { StemExportConfig } from "./audioExport";

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
 * Provides full mix and stems export with progress tracking
 *
 * @param project - The OpenDAW project instance
 * @param options - Export configuration options
 * @returns Export state and handlers
 *
 * @example
 * ```typescript
 * const {
 *   isExporting,
 *   exportProgress,
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
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState("");

  /**
   * Export the full mix (all tracks mixed down)
   */
  const handleExportMix = useCallback(async () => {
    if (!project) return;

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus("Starting export...");

    try {
      await exportFullMix(project, {
        fileName: mixFileName,
        sampleRate,
        onProgress: setExportProgress,
        onStatus: setExportStatus
      });
    } catch (error) {
      console.error("Export failed:", error);
      setExportStatus("Export failed!");
    } finally {
      setIsExporting(false);
    }
  }, [project, mixFileName, sampleRate]);

  /**
   * Export individual stems
   *
   * @param config - Stem export configuration
   */
  const handleExportStems = useCallback(async (config: StemConfigBuilder) => {
    if (!project) return;

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus("Starting stems export...");

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
        onProgress: setExportProgress,
        onStatus: setExportStatus
      });
    } catch (error) {
      console.error("Stems export failed:", error);
      setExportStatus("Stems export failed!");
    } finally {
      setIsExporting(false);
    }
  }, [project, sampleRate]);

  return {
    isExporting,
    exportProgress,
    exportStatus,
    handleExportMix,
    handleExportStems
  };
}
