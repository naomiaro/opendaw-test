import React, { useEffect, useRef } from "react";
import type { ppqn } from "@opendaw/lib-dsp";
import { Curve } from "@opendaw/lib-std";
import { AnimationFrame } from "@opendaw/lib-dom";
import { CANVAS_COLORS, CANVAS_FONT, CANVAS_FONT_SMALL } from "@/lib/design/consoleTheme";
import { BAR, NUM_BARS, TOTAL_PPQN } from "./trackAutomationPresets";
import type { AutomationEvent } from "./trackAutomationPresets";

const CANVAS_HEIGHT = 150;

// Plot area padding — shared by the static envelope canvas and the playhead overlay
const PAD_LEFT = 48;
const PAD_RIGHT = 8;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;

// Canvas semantic aliases — bar lines sit under the drawn envelope curve (supporting tier);
// y-axis guide lines are tertiary texture below the curve. Both from CANVAS_COLORS.
const CANVAS_BG = CANVAS_COLORS.bg;
const CANVAS_BAR_LINE = CANVAS_COLORS.gridSupporting;  // --mc-line-bright (supporting grid under the envelope)
const CANVAS_GUIDE_LINE = CANVAS_COLORS.gridTertiary;  // --mc-line (tertiary y-axis guides)
const CANVAS_LABEL = CANVAS_COLORS.label;
const CANVAS_PLAYHEAD = CANVAS_COLORS.playhead;

interface AutomationCanvasProps {
  events: AutomationEvent[];
  color: string;
  yLabels: { value: number; label: string }[];
  playheadPosition: ppqn;
  /** True only for the section that is actually playing — gates the playhead overlay. */
  showPlayhead: boolean;
  /** Engine position where the 8-bar window starts — playhead is drawn relative to this. */
  playbackStart: ppqn;
}

export const AutomationCanvas: React.FC<AutomationCanvasProps> = ({
  events,
  color,
  yLabels,
  playheadPosition,
  showPlayhead,
  playbackStart
}) => {
  const envelopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const playheadCanvasRef = useRef<HTMLCanvasElement>(null);
  // Store per-frame values in refs so the AnimationFrame overlay reads live data
  // without the static envelope effect re-running every frame.
  const playheadRef = useRef(playheadPosition);
  const showPlayheadRef = useRef(showPlayhead);
  playheadRef.current = playheadPosition;
  showPlayheadRef.current = showPlayhead;

  // Static envelope rendering — re-runs only when the preset or section changes
  useEffect(() => {
    const canvas = envelopeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = CANVAS_HEIGHT;
    if (width <= 0 || height <= 0) return;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const drawWidth = width - PAD_LEFT - PAD_RIGHT;
    const drawHeight = height - PAD_TOP - PAD_BOTTOM;

    // Clear and draw background
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, width, height);

    const toX = (ppqnPos: number) => PAD_LEFT + (ppqnPos / TOTAL_PPQN) * drawWidth;
    const toY = (value: number) => PAD_TOP + drawHeight - value * drawHeight;

    // Grid lines (bar lines)
    ctx.strokeStyle = CANVAS_BAR_LINE;
    ctx.lineWidth = 1;
    for (let bar = 0; bar <= NUM_BARS; bar++) {
      const x = toX(bar * BAR);
      ctx.beginPath();
      ctx.moveTo(x, PAD_TOP);
      ctx.lineTo(x, height - PAD_BOTTOM);
      ctx.stroke();

      if (bar < NUM_BARS) {
        ctx.fillStyle = CANVAS_LABEL;
        ctx.font = CANVAS_FONT;
        ctx.textAlign = "left";
        ctx.fillText(`${bar + 1}`, x + 4, height - 4);
      }
    }

    // Y-axis labels and horizontal guide lines
    ctx.font = CANVAS_FONT_SMALL;
    ctx.textAlign = "right";
    for (const yl of yLabels) {
      const y = toY(yl.value);
      ctx.fillStyle = CANVAS_LABEL;
      ctx.fillText(yl.label, PAD_LEFT - 6, y + 4);
      // horizontal guide line
      ctx.strokeStyle = CANVAS_GUIDE_LINE;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(width - PAD_RIGHT, y);
      ctx.stroke();
    }

    // Draw automation curve
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    if (events.length > 0) {
      for (let i = 0; i < events.length; i++) {
        const evt = events[i];
        const x = toX(evt.position);
        const y = toY(evt.value);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          const prev = events[i - 1];
          const prevX = toX(prev.position);
          const prevY = toY(prev.value);

          if (prev.interpolation.type === "none") {
            // Step: horizontal then vertical
            ctx.lineTo(x, prevY);
            ctx.lineTo(x, y);
          } else if (prev.interpolation.type === "linear") {
            ctx.lineTo(x, y);
          } else if (prev.interpolation.type === "curve") {
            // Use SDK's Curve.normalizedAt for pixel-accurate rendering
            const slope = prev.interpolation.slope;
            const segments = Math.max(20, Math.round(x - prevX));
            for (let s = 1; s <= segments; s++) {
              const t = s / segments;
              const normalized = Curve.normalizedAt(t, slope);
              const val = prev.value + normalized * (evt.value - prev.value);
              ctx.lineTo(prevX + (x - prevX) * t, toY(val));
            }
          }
        }
      }

      // Extend last event value to end of timeline
      const lastEvt = events[events.length - 1];
      if (lastEvt.position < TOTAL_PPQN) {
        const lastY = toY(lastEvt.value);
        ctx.lineTo(toX(TOTAL_PPQN), lastY);
      }
    }
    ctx.stroke();

    // Dots at event points
    ctx.fillStyle = color;
    for (const evt of events) {
      ctx.beginPath();
      ctx.arc(toX(evt.position), toY(evt.value), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [events, color, yLabels]);

  // Playhead overlay — AnimationFrame-driven so the envelope canvas never repaints per frame
  useEffect(() => {
    const canvas = playheadCanvasRef.current;
    if (!canvas) return;

    const af = AnimationFrame.add(() => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      if (width === 0) return;
      const height = CANVAS_HEIGHT;

      // Only resize canvas when dimensions actually change
      const targetWidth = width * dpr;
      const targetHeight = height * dpr;
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      // Reset transform and clear (clearRect is cheap, no reflow)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Playhead is RELATIVE to playbackStart — canvas positions are 0-based
      const relativePlayhead = playheadRef.current - playbackStart;
      if (showPlayheadRef.current && relativePlayhead >= 0) {
        const px = PAD_LEFT + (relativePlayhead / TOTAL_PPQN) * (width - PAD_LEFT - PAD_RIGHT);
        ctx.strokeStyle = CANVAS_PLAYHEAD;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, PAD_TOP);
        ctx.lineTo(px, height - PAD_BOTTOM);
        ctx.stroke();
      }
    });

    return () => af.terminate();
  }, [playbackStart]);

  return (
    <div style={{ position: "relative", width: "100%", height: CANVAS_HEIGHT }}>
      <canvas
        ref={envelopeCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: CANVAS_HEIGHT,
          boxSizing: "border-box",
          borderRadius: "4px",
          border: "1px solid var(--mc-line)"
        }}
      />
      <canvas
        ref={playheadCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: CANVAS_HEIGHT,
          boxSizing: "border-box",
          // transparent border matches the envelope canvas's box model, so both
          // clientWidths agree and the playhead doesn't drift at the right edge
          border: "1px solid transparent",
          pointerEvents: "none"
        }}
      />
    </div>
  );
};
