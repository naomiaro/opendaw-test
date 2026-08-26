import React, { useEffect, useRef } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { PPQN } from "@opendaw/lib-dsp";
import type { AudioRegionBoxAdapter } from "@opendaw/studio-adapters";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { CANVAS_COLORS } from "@/lib/design/consoleTheme";
import { BAR, DEMO_BPM, LOOP_PPQN, WINDOW_PPQN } from "./laneRenderModel";

const CANVAS_HEIGHT = 64;
export const HEADER_WIDTH = 180; // must match LiveAutomationLane's HEADER_WIDTH for column alignment
const NUM_BARS = WINDOW_PPQN / BAR; // 8
const LOOP_BAR = LOOP_PPQN / BAR; // 4 — loop boundary drawn distinctly
const CYCLES = WINDOW_PPQN / LOOP_PPQN; // 2 — the drum loop repeats twice across the window

export interface DrumWaveformStripProps {
  /** The drum AudioRegionBox's adapter — region-loops LOOP_PPQN of audio across WINDOW_PPQN. */
  regionAdapter: AudioRegionBoxAdapter;
}

/**
 * Reference waveform for the drum region, drawn on the same 8-bar axis as the
 * automation lanes below it. The region spans the whole window but internally
 * region-loops its first four bars (see liveAutomationContent.ts) — so this
 * strip draws that same four-bar slice of the source file TWICE rather than
 * stretching the (30 s) file across all 8 bars, matching what is heard.
 */
export const DrumWaveformStrip: React.FC<DrumWaveformStripProps> = ({ regionAdapter }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const painter = new CanvasPainter(canvas, (_painter, ctx) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      ctx.fillStyle = CANVAS_COLORS.bg;
      ctx.fillRect(0, 0, width, height);

      // Bar grid — every bar across the 8-bar window, loop boundary picked out brighter.
      ctx.lineWidth = 1;
      for (let bar = 0; bar <= NUM_BARS; bar++) {
        const x = ((bar * BAR) / WINDOW_PPQN) * width;
        ctx.strokeStyle = bar === LOOP_BAR ? CANVAS_COLORS.gridSupporting : CANVAS_COLORS.gridTertiary;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Adapter layer — synchronous Option read, never `?.`/`??` (see root CLAUDE.md).
      const peaksOption = regionAdapter.file.peaks;
      if (peaksOption.isEmpty()) return;
      const peaks = peaksOption.unwrap();

      // The region reads only the first LOOP_PPQN worth of the (30 s) source
      // file each cycle (loopOffset 0, loopDuration LOOP_PPQN) — map that to a
      // peaks-frame fraction of the whole file, then paint it once per cycle.
      const fileDurationSeconds = regionAdapter.file.endInSeconds - regionAdapter.file.startInSeconds;
      const loopSeconds = PPQN.pulsesToSeconds(LOOP_PPQN, DEMO_BPM);
      const u1Frac = fileDurationSeconds > 0 ? Math.min(1, loopSeconds / fileDurationSeconds) : 1;
      const u0 = 0;
      const u1 = Math.max(0, Math.min(peaks.numFrames, Math.floor(u1Frac * peaks.numFrames)));

      ctx.fillStyle = CANVAS_COLORS.structural;
      const channelHeight = height / peaks.numChannels;
      for (let cycle = 0; cycle < CYCLES; cycle++) {
        const x0 = Math.floor((((cycle * LOOP_PPQN) / WINDOW_PPQN)) * width);
        const x1 = Math.floor((((cycle + 1) * LOOP_PPQN) / WINDOW_PPQN) * width);
        for (let channel = 0; channel < peaks.numChannels; channel++) {
          PeaksPainter.renderPixelStrips(ctx, peaks, channel, {
            x0,
            x1,
            y0: channel * channelHeight + 2,
            y1: (channel + 1) * channelHeight - 2,
            u0,
            u1,
            // Headroom for the SDK Float16 unpack quirk (±1.0 unpacks to ±1.000122).
            v0: -1.001,
            v1: 1.001,
          });
        }
      }
    });

    // Peaks load asynchronously off the SamplePeaks worker — CanvasPainter only
    // repaints on requestUpdate(), so keep nudging it until the adapter's
    // synchronous peaks Option turns non-empty, then stop.
    const frame = AnimationFrame.add(() => {
      painter.requestUpdate();
      if (regionAdapter.file.peaks.nonEmpty()) frame.terminate();
    });

    return () => {
      frame.terminate();
      painter.terminate();
    };
  }, [regionAdapter]);

  return (
    <Flex gap="3" align="stretch">
      <Flex direction="column" justify="center" gap="1" style={{ width: HEADER_WIDTH, flex: "none" }}>
        <Text size="2" weight="medium">Drums</Text>
        <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>BassDrums30 · ×2</Text>
      </Flex>
      <div style={{ flex: 1, height: CANVAS_HEIGHT }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
    </Flex>
  );
};
