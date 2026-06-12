// noinspection PointlessArithmeticExpressionJS

import { useCallback, useEffect, useRef } from "react";
import type { Terminable } from "@opendaw/lib-std";
import type { Project } from "@opendaw/studio-core";
import type { SampleLoader } from "@opendaw/studio-adapters";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Peaks, PeaksPainter } from "@opendaw/lib-fusion";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { CANVAS_COLORS } from "@/lib/design/consoleTheme";
import type { RecordingState } from "@/hooks/useRecordingSession";
import type { RecordingTape } from "@/components/RecordingTapeCard";
import type { PeaksWriter } from "@opendaw/studio-core";

const CHANNEL_PADDING = 4;

/** Per-tape peaks monitoring state stored in a ref */
interface TapePeaksState {
  sampleLoader: SampleLoader | null;
  peaks: Peaks | PeaksWriter | null;
  waveformOffsetFrames: number;
}

interface UseTapePeaksOptions {
  project: Project | null;
  audioContext: AudioContext | null;
  recordingTapes: RecordingTape[];
  sessionState: RecordingState;
  registerLoader: (loader: SampleLoader) => void;
}

export interface UseTapePeaksResult {
  /** Canvas ref callback for a given tape index */
  getCanvasRef: (tapeIndex: number) => (el: HTMLCanvasElement | null) => void;
  /** Clear per-tape peaks state and terminate painters (call before a new recording) */
  resetPeaks: () => void;
}

/**
 * Per-tape live waveform monitoring: discovers recording regions via adapter
 * layer subscriptions, resolves their SampleLoaders, and renders peaks to
 * per-tape canvases via CanvasPainter + AnimationFrame.
 */
export function useTapePeaks({
  project,
  audioContext,
  recordingTapes,
  sessionState,
  registerLoader,
}: UseTapePeaksOptions): UseTapePeaksResult {
  // Keep ref in sync to avoid tearing down pointerHub subscriptions on tape changes
  const recordingTapesRef = useRef(recordingTapes);
  recordingTapesRef.current = recordingTapes;

  // Per-tape canvas refs — keyed by tape index
  const canvasRefsMap = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const canvasPaintersMap = useRef<Map<number, CanvasPainter>>(new Map());

  // Per-tape peaks state — keyed by tape index
  const tapePeaksRef = useRef<Map<number, TapePeaksState>>(new Map());

  // Memoized per-index ref callbacks — a fresh closure per render would make
  // React detach/reattach the ref each render, tearing down the painter.
  const canvasRefCallbacksMap = useRef<
    Map<number, (el: HTMLCanvasElement | null) => void>
  >(new Map());

  // Canvas ref callback for a given tape index — one stable callback per index
  const getCanvasRef = useCallback((tapeIndex: number) => {
    const existing = canvasRefCallbacksMap.current.get(tapeIndex);
    if (existing) return existing;

    const callback = (el: HTMLCanvasElement | null) => {
      if (el) {
        canvasRefsMap.current.set(tapeIndex, el);
      } else {
        // Cleanup painter when canvas unmounts
        const painter = canvasPaintersMap.current.get(tapeIndex);
        if (painter) {
          painter.terminate();
          canvasPaintersMap.current.delete(tapeIndex);
        }
        canvasRefsMap.current.delete(tapeIndex);
      }
    };
    canvasRefCallbacksMap.current.set(tapeIndex, callback);
    return callback;
  }, []);

  // Initialize CanvasPainter for a specific tape canvas
  const ensureCanvasPainter = useCallback((tapeIndex: number) => {
    const canvas = canvasRefsMap.current.get(tapeIndex);
    if (!canvas || canvasPaintersMap.current.has(tapeIndex)) return;

    const painter = new CanvasPainter(canvas, (_, context) => {
      const tapeState = tapePeaksRef.current.get(tapeIndex);
      const peaks = tapeState?.peaks;

      if (!peaks) {
        context.fillStyle = CANVAS_COLORS.bg;
        context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        return;
      }

      const isPeaksWriter = "dataIndex" in peaks;

      context.fillStyle = CANVAS_COLORS.bg;
      context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      context.fillStyle = CANVAS_COLORS.amber;

      const totalHeight = canvas.clientHeight;
      const numChannels = peaks.numChannels;
      const channelHeight = totalHeight / numChannels;
      const waveformOffsetFrames = tapeState?.waveformOffsetFrames ?? 0;

      for (let channel = 0; channel < numChannels; channel++) {
        const y0 = channel * channelHeight + CHANNEL_PADDING / 2;
        const y1 = (channel + 1) * channelHeight - CHANNEL_PADDING / 2;

        const unitsToRender = isPeaksWriter
          ? peaks.dataIndex[0] * peaks.unitsEachPeak()
          : peaks.numFrames;

        PeaksPainter.renderPixelStrips(context, peaks, channel, {
          x0: 0,
          x1: canvas.clientWidth,
          y0,
          y1,
          u0: waveformOffsetFrames,
          u1: unitsToRender,
          // Slight headroom absorbs the SDK Float16 unpack quirk: stored
          // peaks at exactly ±1.0 unpack to ±1.0001219511032104, which
          // would otherwise clamp and produce flat-top "square" waveforms.
          v0: -1.001,
          v1: 1.001
        });
      }
    });

    canvasPaintersMap.current.set(tapeIndex, painter);
  }, []);

  // Discover recording regions via adapter layer subscriptions.
  // Uses AudioUnitBoxAdapter.tracks.catchupAndSubscribe → TrackRegions.catchupAndSubscribe
  // for typed, reactive region discovery. Re-subscribes when tapes change.
  // Peaks rendering is done by CanvasPainter (via AnimationFrame internally).
  useEffect(() => {
    if (!project || !audioContext || recordingTapes.length === 0) return;

    const subs: Terminable[] = [];
    const allAudioUnits = project.rootBoxAdapter.audioUnits.adapters();

    for (let i = 0; i < recordingTapes.length; i++) {
      const tape = recordingTapes[i];
      const audioUnitAdapter = allAudioUnits.find(
        (au) => au.box === tape.capture.audioUnitBox
      );
      if (!audioUnitAdapter) continue;

      const tracksSub = audioUnitAdapter.tracks.catchupAndSubscribe({
        onAdd: (trackAdapter) => {
          const regionsSub = trackAdapter.regions.catchupAndSubscribe({
            onAdded: (regionAdapter) => {
              if (!regionAdapter.isAudioRegion()) return;
              if (!regionAdapter.label.startsWith("Take ")) return;

              if (!tapePeaksRef.current.has(i)) {
                tapePeaksRef.current.set(i, {
                  sampleLoader: null,
                  peaks: null,
                  waveformOffsetFrames: 0
                });
              }
              const tapeState = tapePeaksRef.current.get(i)!;
              if (tapeState.sampleLoader) return;

              const waveformOffsetSec = regionAdapter.waveformOffset.getValue();
              if (waveformOffsetSec > 0) {
                tapeState.waveformOffsetFrames = Math.round(waveformOffsetSec * audioContext.sampleRate);
              }

              // Adapter resolves sampleLoader internally via file → getOrCreateLoader()
              const fileAdapter = regionAdapter.file;
              const loader = fileAdapter.getOrCreateLoader();
              tapeState.sampleLoader = loader;
              registerLoader(loader);
            },
            onRemoved: () => {},
          });
          subs.push(regionsSub);
        },
        onRemove: () => {},
        onReorder: () => {},
      });
      subs.push(tracksSub);
    }

    // AnimationFrame for continuous peaks rendering — no session-state guard.
    // Runs every frame; when no sampleLoaders exist it's a no-op. This avoids
    // React batching issues where a state-derived gate stays false across
    // recording cycles.
    const animationFrameTerminable = AnimationFrame.add(() => {
      const tapes = recordingTapesRef.current;
      for (let i = 0; i < tapes.length; i++) {
        ensureCanvasPainter(i);

        const tapeState = tapePeaksRef.current.get(i);
        if (!tapeState?.sampleLoader) continue;

        const peaksOption = tapeState.sampleLoader.peaks;
        if (peaksOption && !peaksOption.isEmpty()) {
          tapeState.peaks = peaksOption.unwrap();
          canvasPaintersMap.current.get(i)?.requestUpdate();
        }
      }
    });

    return () => {
      animationFrameTerminable.terminate();
      for (const sub of subs) {
        sub.terminate();
      }
    };
  }, [project, audioContext, recordingTapes, ensureCanvasPainter, registerLoader]);

  // Debug: log per-tape recorded frame counts when finalization completes.
  // Compares RecordingWorklet outputs across tapes to surface any drift.
  const prevSessionStateRef = useRef<RecordingState>(sessionState);
  useEffect(() => {
    if (prevSessionStateRef.current === "finalizing" && sessionState === "ready") {
      const tapes = recordingTapesRef.current;
      const summary = tapes.map((tape, i) => {
        const loader = tapePeaksRef.current.get(i)?.sampleLoader ?? null;
        const dataOpt = loader?.data;
        const data = dataOpt && !dataOpt.isEmpty() ? dataOpt.unwrap() : null;
        const peaksOpt = loader?.peaks;
        const peaks = peaksOpt && !peaksOpt.isEmpty() ? peaksOpt.unwrap() : null;

        // Scan peak data for out-of-range values (>1.0 or <-1.0). PeaksWriter
        // packs min/max as Float16 (range ±65504), so >1.0 values are stored
        // faithfully, but PeaksPainter.renderPixelStrips clamps to the visible
        // [v0, v1] range, producing flat-top "square" waveforms.
        const ranges = peaks
          ? Array.from({ length: peaks.numChannels }, (_, ch) => {
              const channelData = peaks.data[ch];
              let absMin = 0;
              let absMax = 0;
              let overRangeCount = 0;
              const stage = peaks.stages[0];
              const peakCount = stage ? stage.numPeaks : channelData.length;
              for (let p = 0; p < peakCount; p++) {
                const bits = channelData[p];
                const lo = Peaks.unpack(bits, 0);
                const hi = Peaks.unpack(bits, 1);
                if (lo < absMin) absMin = lo;
                if (hi > absMax) absMax = hi;
                if (lo < -1 || hi > 1) overRangeCount++;
              }
              return {
                channel: ch,
                min: absMin,
                max: absMax,
                peakAmplitude: Math.max(Math.abs(absMin), Math.abs(absMax)),
                overRangePeakCount: overRangeCount,
                totalPeaks: peakCount,
                overRangeFraction: peakCount > 0 ? overRangeCount / peakCount : 0,
              };
            })
          : [];

        return {
          tape: i + 1,
          tapeId: tape.id,
          loaderState: loader?.state.type ?? "no-loader",
          dataFrames: data?.numberOfFrames ?? null,
          peakNumFrames: peaks?.numFrames ?? null,
          sampleRate: data?.sampleRate ?? null,
          numChannels: data?.numberOfChannels ?? null,
          ranges,
        };
      });

      const frames = summary
        .map((s) => s.dataFrames)
        .filter((n): n is number => n !== null);
      const minFrames = frames.length > 0 ? Math.min(...frames) : null;
      const maxFrames = frames.length > 0 ? Math.max(...frames) : null;
      const driftFrames =
        minFrames !== null && maxFrames !== null ? maxFrames - minFrames : null;
      const sampleRate = summary[0]?.sampleRate ?? null;
      const driftSeconds =
        driftFrames !== null && sampleRate !== null
          ? driftFrames / sampleRate
          : null;

      console.debug(
        "[recording-finalized] " +
          JSON.stringify({ tapes: summary, driftFrames, driftSeconds })
      );
    }
    prevSessionStateRef.current = sessionState;
  }, [sessionState]);

  // Reset peaks state for all tapes and cleanup old painters
  const resetPeaks = useCallback(() => {
    tapePeaksRef.current.clear();
    for (const [, painter] of canvasPaintersMap.current) {
      painter.terminate();
    }
    canvasPaintersMap.current.clear();
  }, []);

  return { getCanvasRef, resetPeaks };
}
