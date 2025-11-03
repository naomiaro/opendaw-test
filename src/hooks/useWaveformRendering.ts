import { useEffect, useRef } from "react";
import { UUID } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { CanvasPainter } from "../lib/CanvasPainter";
import type { TrackData } from "../lib/types";

export interface WaveformRenderingOptions {
  /**
   * Padding between channels in stereo waveforms (default: 4)
   */
  channelPadding?: number;

  /**
   * Color for the waveform (default: "#4a9eff")
   */
  waveformColor?: string;

  /**
   * Callback when all waveforms are rendered
   */
  onAllRendered?: () => void;
}

/**
 * Hook for managing waveform rendering across multiple tracks
 *
 * Handles:
 * - Creating CanvasPainter instances for each track
 * - Subscribing to sample loader for peak data
 * - Rendering peaks to canvas using PeaksPainter
 * - Cleanup on unmount
 *
 * @param project - OpenDAW project instance
 * @param tracks - Array of loaded tracks
 * @param canvasRefs - Map of canvas elements by track UUID
 * @param audioBuffers - Map of audio buffers by track UUID
 * @param options - Optional configuration
 *
 * @example
 * ```typescript
 * const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
 * const audioBuffers = useRef<Map<string, AudioBuffer>>(new Map());
 *
 * useWaveformRendering(project, tracks, canvasRefs.current, audioBuffers.current, {
 *   onAllRendered: () => setStatus("Ready to play!")
 * });
 * ```
 */
export function useWaveformRendering(
  project: Project | null,
  tracks: TrackData[],
  canvasRefs: Map<string, HTMLCanvasElement>,
  audioBuffers: Map<string, AudioBuffer>,
  options?: WaveformRenderingOptions
): void {
  const { channelPadding = 4, waveformColor = "#4a9eff", onAllRendered } = options || {};

  const canvasPaintersRef = useRef<Map<string, CanvasPainter>>(new Map());
  const trackPeaksRef = useRef<Map<string, any>>(new Map());
  const visuallyRenderedTracksRef = useRef<Set<string>>(new Set());

  // Store callback in ref to avoid triggering effect on every render
  const onAllRenderedRef = useRef(onAllRendered);
  useEffect(() => {
    onAllRenderedRef.current = onAllRendered;
  }, [onAllRendered]);

  // Initialize CanvasPainters for waveform rendering
  // Only depends on tracks and project - other values (canvasRefs, colors, padding, callbacks)
  // are captured in closures and don't require rebuilding painters when they change
  useEffect(() => {
    if (tracks.length === 0 || !project) return undefined;

    console.debug("[CanvasPainter] Initializing painters for", tracks.length, "tracks");

    const lastRenderedPeaks = new Map<string, any>();

    tracks.forEach(track => {
      const uuidString = UUID.toString(track.uuid);
      const canvas = canvasRefs.get(uuidString);

      if (!canvas) {
        console.debug(`[CanvasPainter] Canvas not ready for "${track.name}"`);
        return;
      }

      // Don't reinitialize if painter already exists
      if (canvasPaintersRef.current.has(uuidString)) {
        return;
      }

      console.debug(`[CanvasPainter] Creating painter for "${track.name}"`);

      // Create painter with rendering callback
      const painter = new CanvasPainter(canvas, (canvasPainter, context) => {
        const peaks = trackPeaksRef.current.get(uuidString);
        if (!peaks) {
          // Clear canvas if no peaks
          context.fillStyle = "#000";
          context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
          return;
        }

        // Skip rendering if peaks haven't changed AND canvas wasn't resized
        if (lastRenderedPeaks.get(uuidString) === peaks && !canvasPainter.wasResized) {
          return;
        }

        // Clear canvas
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

        // Set waveform color
        context.fillStyle = waveformColor;

        // Calculate channel layout with padding
        const totalHeight = canvas.clientHeight;
        const numChannels = peaks.numChannels;
        const channelHeight = totalHeight / numChannels;

        // Render each channel with padding
        for (let channel = 0; channel < numChannels; channel++) {
          const y0 = channel * channelHeight + channelPadding / 2;
          const y1 = (channel + 1) * channelHeight - channelPadding / 2;

          PeaksPainter.renderBlocks(context, peaks, channel, {
            x0: 0,
            x1: canvas.clientWidth,
            y0,
            y1,
            u0: 0,
            u1: peaks.numFrames,
            v0: -1,
            v1: 1
          });
        }

        lastRenderedPeaks.set(uuidString, peaks);

        // Track visual rendering completion
        if (!visuallyRenderedTracksRef.current.has(uuidString)) {
          visuallyRenderedTracksRef.current.add(uuidString);
          console.debug(
            `[Rendering] Visually rendered "${track.name}" (${visuallyRenderedTracksRef.current.size}/${tracks.length})`
          );

          // Check if all tracks are visually rendered
          if (visuallyRenderedTracksRef.current.size === tracks.length) {
            console.debug("[Rendering] All waveforms visually rendered!");
            onAllRenderedRef.current?.();
          }
        }
      });

      canvasPaintersRef.current.set(uuidString, painter);
    });

    return () => {
      console.debug("[CanvasPainter] Cleaning up painters");
      canvasPaintersRef.current.forEach(painter => painter.terminate());
      canvasPaintersRef.current.clear();
      visuallyRenderedTracksRef.current.clear();
    };
  }, [tracks, project]);

  // Subscribe to sample loader state changes for peaks
  useEffect(() => {
    if (!project || tracks.length === 0) return undefined;

    console.debug("[Peaks] Subscribing to sample loader state for", tracks.length, "tracks");

    const subscriptions: Array<{ terminate: () => void }> = [];

    tracks.forEach(track => {
      const uuidString = UUID.toString(track.uuid);

      // Get the sample loader and subscribe to state changes
      const sampleLoader = project.sampleManager.getOrCreate(track.uuid);

      const subscription = sampleLoader.subscribe(state => {
        console.debug(`[Peaks] Sample loader state for "${track.name}":`, state.type);

        // When state becomes "loaded", peaks are ready
        if (state.type === "loaded") {
          const peaksOption = sampleLoader.peaks;

          if (!peaksOption.isEmpty()) {
            const peaks = peaksOption.unwrap();

            console.debug(
              `[Peaks] Rendering waveform for "${track.name}": ${peaks.numFrames} frames, ${peaks.numChannels} channels`
            );

            // Store peaks and request render
            trackPeaksRef.current.set(uuidString, peaks);
            const painter = canvasPaintersRef.current.get(uuidString);
            if (painter) {
              painter.requestUpdate();
            }
          }
        }
      });

      subscriptions.push(subscription);
    });

    return () => {
      console.debug("[Peaks] Cleaning up sample loader subscriptions");
      subscriptions.forEach(sub => sub.terminate());
    };
  }, [project, tracks]);
}
