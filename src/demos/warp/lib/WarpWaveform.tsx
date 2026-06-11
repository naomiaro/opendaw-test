import { useEffect, useRef } from "react";
import { UUID } from "@opendaw/lib-std";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PeaksPainter } from "@opendaw/lib-fusion";
import type { Peaks } from "@opendaw/lib-fusion";
import { Project } from "@opendaw/studio-core";
import type { SampleLoaderState } from "@opendaw/studio-adapters";
import { CanvasPainter } from "@/lib/CanvasPainter";

export interface WaveformSegment {
  /** Canvas x-range, fractions 0..1. */
  x0: number;
  x1: number;
  /** Peaks frame range, fractions 0..1 of the audio file. */
  u0: number;
  u1: number;
}

interface WarpWaveformProps {
  project: Project;
  fileUuid: UUID.Bytes;
  height?: number;
  /** Waveform slices to draw — fractions, evaluated on every repaint. */
  getSegments: () => WaveformSegment[];
  /** Bar-line positions — fractions of canvas width. */
  getBarLines: () => number[];
  /** Playhead position — fraction of canvas width. Read every frame. */
  getPlayheadFrac: () => number;
  /** Bump to request a repaint (e.g. after a conform toggle). */
  repaintKey?: unknown;
}

export function WarpWaveform({
  project,
  fileUuid,
  height = 140,
  getSegments,
  getBarLines,
  getPlayheadFrac,
  repaintKey,
}: WarpWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const painterRef = useRef<CanvasPainter | null>(null);
  const peaksRef = useRef<Peaks | null>(null);
  const getSegmentsRef = useRef(getSegments);
  getSegmentsRef.current = getSegments;
  const getBarLinesRef = useRef(getBarLines);
  getBarLinesRef.current = getBarLines;
  const getPlayheadFracRef = useRef(getPlayheadFrac);
  getPlayheadFracRef.current = getPlayheadFrac;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const painter = new CanvasPainter(canvas, (_painter, ctx) => {
      const width = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, width, h);

      const peaks = peaksRef.current;
      if (peaks) {
        ctx.fillStyle = "#4a9eff";
        const channelHeight = h / peaks.numChannels;
        for (const seg of getSegmentsRef.current()) {
          if (seg.x0 >= seg.x1) continue;
          for (let channel = 0; channel < peaks.numChannels; channel++) {
            PeaksPainter.renderPixelStrips(ctx, peaks, channel, {
              x0: Math.floor(seg.x0 * width),
              x1: Math.floor(seg.x1 * width),
              y0: channel * channelHeight + 2,
              y1: (channel + 1) * channelHeight - 2,
              u0: Math.max(0, Math.min(peaks.numFrames, Math.floor(seg.u0 * peaks.numFrames))),
              u1: Math.max(0, Math.min(peaks.numFrames, Math.floor(seg.u1 * peaks.numFrames))),
              // Headroom for SDK Float16 unpack quirk (±1.0 unpacks to ±1.000122).
              v0: -1.001,
              v1: 1.001,
            });
          }
        }
      }

      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1;
      for (const frac of getBarLinesRef.current()) {
        const x = frac * width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    });
    painterRef.current = painter;

    // Peaks arrive asynchronously from the SamplePeaks worker.
    const loader = project.sampleManager.getOrCreate(fileUuid);
    // subscribed starts false so the in-callback terminates are skipped during
    // synchronous delivery (loader already "loaded" at mount — the common path
    // here): sub would be in its TDZ inside the callback, and subscribe()
    // returns Terminable.Empty in that case, so there is nothing to terminate.
    let subscribed = false;
    const sub = loader.subscribe((state: SampleLoaderState) => {
      if (state.type === "loaded") {
        const peaksOption = loader.peaks;
        if (!peaksOption.isEmpty()) {
          peaksRef.current = peaksOption.unwrap();
          painter.requestUpdate();
          if (subscribed) {
            subscribed = false;
            sub.terminate();
          }
        }
      } else if (state.type === "error") {
        console.warn("[WarpWaveform] Peaks load failed:", state.reason);
        if (subscribed) {
          subscribed = false;
          sub.terminate();
        }
      }
    });
    subscribed = true;

    // Direct-DOM playhead: no setState per frame.
    const playheadTerminable = AnimationFrame.add(() => {
      const playhead = playheadRef.current;
      if (!playhead) return;
      const frac = Math.max(0, Math.min(1, getPlayheadFracRef.current()));
      playhead.style.left = `${frac * canvas.clientWidth}px`;
    });

    return () => {
      if (subscribed) {
        subscribed = false;
        sub.terminate();
      }
      playheadTerminable.terminate();
      painter.terminate();
      painterRef.current = null;
    };
  }, [project, fileUuid]);

  useEffect(() => {
    painterRef.current?.requestUpdate();
  }, [repaintKey]);

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div
        ref={playheadRef}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: 2,
          background: "#ff5555",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
