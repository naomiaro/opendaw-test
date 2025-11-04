import { useEffect, useRef } from "react";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
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

  /**
   * Maximum duration in seconds for calculating region positions
   * If not provided, will use the longest audio buffer duration
   */
  maxDuration?: number;

  /**
   * Update trigger - change this value to force waveform re-render
   * Useful when regions are modified externally
   */
  updateTrigger?: any;
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
  const { channelPadding = 4, waveformColor = "#4a9eff", onAllRendered, maxDuration, updateTrigger } = options || {};

  // Read BPM from project
  const bpm = project?.timelineBox.bpm.getValue() ?? 120;

  const canvasPaintersRef = useRef<Map<string, CanvasPainter>>(new Map());
  const trackPeaksRef = useRef<Map<string, any>>(new Map());
  const visuallyRenderedTracksRef = useRef<Set<string>>(new Set());

  // Store callback in ref to avoid triggering effect on every render
  const onAllRenderedRef = useRef(onAllRendered);
  useEffect(() => {
    onAllRenderedRef.current = onAllRendered;
  }, [onAllRendered]);

  // Request painter updates when updateTrigger changes
  useEffect(() => {
    if (updateTrigger !== undefined) {
      canvasPaintersRef.current.forEach(painter => painter.requestUpdate());
    }
  }, [updateTrigger]);

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

        // Get regions for this track by reading directly from trackBox
        const regions: any[] = [];
        const pointers = track.trackBox.regions.pointerHub.incoming();
        pointers.forEach(({ box }) => {
          if (!box) return;
          regions.push({
            position: (box as any).position.getValue(),
            duration: (box as any).duration.getValue(),
            loopOffset: (box as any).loopOffset.getValue(),
            loopDuration: (box as any).loopDuration.getValue()
          });
        });

        // Skip rendering if peaks haven't changed AND canvas wasn't resized AND regions haven't changed
        const regionsKey = regions.map(r => `${r.position},${r.duration},${r.loopOffset}`).join(";");
        if (
          lastRenderedPeaks.get(uuidString) === peaks &&
          !canvasPainter.wasResized &&
          regionsKey === lastRenderedPeaks.get(`${uuidString}_regions`)
        ) {
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

        const audioBuffer = audioBuffers.get(uuidString);

        // Calculate maxDuration if not provided
        const effectiveMaxDuration =
          maxDuration || Math.max(...Array.from(audioBuffers.values()).map(buf => buf.duration), 1);

        // Use region-aware rendering if:
        // 1. We have regions for this track
        // 2. We have the audio buffer and maxDuration
        // This ensures timeline-based positioning for all tracks
        const useRegionRendering = regions.length > 0 && audioBuffer && effectiveMaxDuration > 0;

        if (useRegionRendering) {
          // Region-aware rendering: render each region at its position
          regions.forEach((region: any) => {
            // Convert region position from PPQN to seconds to pixels
            const regionStartSeconds = PPQN.pulsesToSeconds(region.position, bpm);
            const regionDurationSeconds = PPQN.pulsesToSeconds(region.duration, bpm);

            // Calculate x position as percentage of maxDuration
            const x0Percent = regionStartSeconds / effectiveMaxDuration;
            const x1Percent = (regionStartSeconds + regionDurationSeconds) / effectiveMaxDuration;

            const x0 = Math.floor(x0Percent * canvas.clientWidth);
            const x1 = Math.floor(x1Percent * canvas.clientWidth);

            // Calculate which part of the audio file this region should display
            // Use loopOffset for where to start in the audio file
            // Use the region's duration for how much to show (not loopDuration, which may differ for time-stretching)
            const loopOffsetSeconds = PPQN.pulsesToSeconds(region.loopOffset, bpm);

            // Convert to frame indices in the peaks data
            const u0 = Math.floor((loopOffsetSeconds / audioBuffer.duration) * peaks.numFrames);
            const u1 = Math.floor(
              ((loopOffsetSeconds + regionDurationSeconds) / audioBuffer.duration) * peaks.numFrames
            );

            // Render each channel with padding
            for (let channel = 0; channel < numChannels; channel++) {
              const y0 = channel * channelHeight + channelPadding / 2;
              const y1 = (channel + 1) * channelHeight - channelPadding / 2;

              PeaksPainter.renderBlocks(context, peaks, channel, {
                x0,
                x1,
                y0,
                y1,
                u0: Math.max(0, Math.min(peaks.numFrames, u0)),
                u1: Math.max(0, Math.min(peaks.numFrames, u1)),
                v0: -1,
                v1: 1
              });
            }
          });
        } else {
          // Fall back to full waveform rendering
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
        }

        lastRenderedPeaks.set(uuidString, peaks);
        lastRenderedPeaks.set(`${uuidString}_regions`, regionsKey);

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
