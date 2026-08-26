import React, { useEffect, useRef } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { PPQN } from "@opendaw/lib-dsp";
import type { AudioRegionBoxAdapter } from "@opendaw/studio-adapters";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { CANVAS_COLORS, CANVAS_FONT_SMALL } from "@/lib/design/consoleTheme";
import { BAR, DEMO_BPM, HEADER_WIDTH, DRUM_CYCLE_PPQN, NUM_BARS, WINDOW_PPQN } from "./laneRenderModel";

const CANVAS_HEIGHT = 64;
// 4 — where the drum audio repeats inside the window (not a transport boundary).
const DRUM_CYCLE_BAR = DRUM_CYCLE_PPQN / BAR;
const CYCLES = WINDOW_PPQN / DRUM_CYCLE_PPQN; // 2 — the drum loop repeats twice across the window
// Backstop for the peaks-nudge loop: ~10 s at 60 fps. Peaks that have not
// arrived by then are not going to, and a 60 fps repaint for the life of the
// mount is far too expensive to leave running on the off chance.
const NUDGE_FRAME_BUDGET = 600;

export interface DrumWaveformStripProps {
  /** The drum AudioRegionBox's adapter — region-loops DRUM_CYCLE_PPQN of audio across WINDOW_PPQN. */
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

    // Terminal-state pre-check: SampleLoader has no catchupAndSubscribe, and
    // subscribe() fires synchronously for terminal states — so read `state`
    // first and never terminate the subscription from inside its own callback
    // (root CLAUDE.md, TDZ warning).
    const loader = regionAdapter.file.getOrCreateLoader();
    // "Stop waiting and say so": the loader failed, or the nudge budget below
    // ran out. Either way the strip draws a label instead of staying blank
    // forever behind a 60 fps repaint loop that can never succeed.
    const initialState = loader.state;
    let unavailable = initialState.type === "error";
    if (initialState.type === "error") {
      console.error("[DrumWaveformStrip] sample loader failed: " + String(initialState.reason));
    }

    const painter = new CanvasPainter(canvas, (_painter, ctx) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      ctx.fillStyle = CANVAS_COLORS.bg;
      ctx.fillRect(0, 0, width, height);

      // Bar grid — every bar across the 8-bar window, the drum-cycle repeat at
      // bar 4 picked out brighter (the transport loops the whole window).
      ctx.lineWidth = 1;
      for (let bar = 0; bar <= NUM_BARS; bar++) {
        const x = ((bar * BAR) / WINDOW_PPQN) * width;
        ctx.strokeStyle = bar === DRUM_CYCLE_BAR ? CANVAS_COLORS.gridSupporting : CANVAS_COLORS.gridTertiary;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Adapter layer — synchronous Option read, never `?.`/`??` (see root CLAUDE.md).
      const peaksOption = regionAdapter.file.peaks;
      if (peaksOption.isEmpty()) {
        if (unavailable) {
          ctx.fillStyle = CANVAS_COLORS.label;
          ctx.font = CANVAS_FONT_SMALL;
          ctx.textBaseline = "middle";
          ctx.fillText("waveform unavailable", 8, height / 2);
        }
        return;
      }
      const peaks = peaksOption.unwrap();

      // The region reads only the first DRUM_CYCLE_PPQN worth of the (30 s) source
      // file each cycle (loopOffset 0, loopDuration DRUM_CYCLE_PPQN) — map that to a
      // peaks-frame fraction of the whole file, then paint it once per cycle.
      const fileDurationSeconds = regionAdapter.file.endInSeconds - regionAdapter.file.startInSeconds;
      const loopSeconds = PPQN.pulsesToSeconds(DRUM_CYCLE_PPQN, DEMO_BPM);
      const u1Frac = fileDurationSeconds > 0 ? Math.min(1, loopSeconds / fileDurationSeconds) : 1;
      const u0 = 0;
      const u1 = Math.max(0, Math.min(peaks.numFrames, Math.floor(u1Frac * peaks.numFrames)));

      ctx.fillStyle = CANVAS_COLORS.structural;
      const channelHeight = height / peaks.numChannels;
      for (let cycle = 0; cycle < CYCLES; cycle++) {
        const x0 = Math.floor((((cycle * DRUM_CYCLE_PPQN) / WINDOW_PPQN)) * width);
        const x1 = Math.floor((((cycle + 1) * DRUM_CYCLE_PPQN) / WINDOW_PPQN) * width);
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

    // A loader that fails after mount has to stop the nudge loop too — without
    // this the strip stays blank AND repaints at 60 fps forever. Never
    // terminates itself from inside the callback (see the pre-check above);
    // the nudge loop below notices the flag on its next tick.
    const loaderSub = unavailable ? null : loader.subscribe(state => {
      if (state.type !== "error") return;
      console.error("[DrumWaveformStrip] sample loader failed: " + String(state.reason));
      unavailable = true;
      painter.requestUpdate();
    });

    // Peaks load asynchronously off the SamplePeaks worker — CanvasPainter only
    // repaints on requestUpdate(), so keep nudging it until the adapter's
    // synchronous peaks Option turns non-empty, then stop. Also stops on a
    // loader error, and on a frame budget so no failure mode leaves it running.
    let frames = 0;
    const frame = AnimationFrame.add(() => {
      painter.requestUpdate();
      if (regionAdapter.file.peaks.nonEmpty() || unavailable) {
        frame.terminate();
        return;
      }
      if (++frames >= NUDGE_FRAME_BUDGET) {
        console.error("[DrumWaveformStrip] peaks never arrived within the nudge budget — giving up");
        unavailable = true;
        painter.requestUpdate();
        frame.terminate();
      }
    });

    return () => {
      frame.terminate();
      loaderSub?.terminate();
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
