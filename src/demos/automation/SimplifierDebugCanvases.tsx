import React, { useEffect, useRef } from "react";
import { CANVAS_COLORS, CANVAS_FONT, CANVAS_FONT_BOLD, CANVAS_FONT_SMALL } from "@/lib/design/consoleTheme";

// Static, draw-once canvases for `automation-simplifier-debug-demo.tsx` — they render
// a completed run's measurements (no AnimationFrame loop, no live polling; see
// `resizeForDpr` callers, both only re-draw when their data props change).

function resizeForDpr(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, height: number): number {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return width;
}

// --- (A) Simplifier collapse: injected curve vs. what survives finalize ----------

export interface CurvePoint {
  x: number; // absolute ppqn
  y: number; // unitValue
}

export interface DeviationMarker {
  x: number; // absolute ppqn
  rawY: number;
  keptY: number;
  label: string;
}

export interface SimplifierCanvasProps {
  /** Every write the page injected — position (absolute ppqn) → unitValue. */
  rawCurve: ReadonlyArray<CurvePoint>;
  /** Events that survived the finalize-time thinning pass — plays as linear segments. */
  keptCurve: ReadonlyArray<CurvePoint>;
  epsilon: number;
  deviation: DeviationMarker | null;
}

const SIMPLIFIER_HEIGHT = 220;
const SIM_PAD_LEFT = 44;
const SIM_PAD_RIGHT = 16;
const SIM_PAD_TOP = 16;
const SIM_PAD_BOTTOM = 24;

export const SimplifierCanvas: React.FC<SimplifierCanvasProps> = ({ rawCurve, keptCurve, epsilon, deviation }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.clientWidth <= 0) return;
    const width = resizeForDpr(canvas, ctx, SIMPLIFIER_HEIGHT);

    ctx.fillStyle = CANVAS_COLORS.bg;
    ctx.fillRect(0, 0, width, SIMPLIFIER_HEIGHT);

    const allPoints = [...rawCurve, ...keptCurve];
    if (allPoints.length === 0) return;

    const xs = allPoints.map(p => p.x);
    const ys = allPoints.map(p => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yPad = 0.08;
    const yMin = Math.min(0, ...ys) - yPad;
    const yMax = Math.max(1, ...ys) + yPad;

    const drawWidth = width - SIM_PAD_LEFT - SIM_PAD_RIGHT;
    const drawHeight = SIMPLIFIER_HEIGHT - SIM_PAD_TOP - SIM_PAD_BOTTOM;
    const toX = (v: number) => SIM_PAD_LEFT + ((v - xMin) / (xMax - xMin || 1)) * drawWidth;
    const toY = (v: number) => SIM_PAD_TOP + drawHeight - ((v - yMin) / (yMax - yMin || 1)) * drawHeight;

    // Horizontal guides
    ctx.font = CANVAS_FONT_SMALL;
    ctx.textAlign = "right";
    for (const gy of [0, 0.25, 0.5, 0.75, 1]) {
      const y = toY(gy);
      ctx.strokeStyle = CANVAS_COLORS.gridTertiary;
      ctx.beginPath();
      ctx.moveTo(SIM_PAD_LEFT, y);
      ctx.lineTo(width - SIM_PAD_RIGHT, y);
      ctx.stroke();
      ctx.fillStyle = CANVAS_COLORS.label;
      ctx.fillText(gy.toFixed(2), SIM_PAD_LEFT - 6, y + 3);
    }

    // ε band around the kept curve — what the promised tolerance looks like at this scale
    if (keptCurve.length > 1) {
      ctx.fillStyle = CANVAS_COLORS.cyan;
      ctx.globalAlpha = 0.14;
      ctx.beginPath();
      keptCurve.forEach((p, i) => {
        const x = toX(p.x);
        const y = toY(p.y + epsilon);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      for (let i = keptCurve.length - 1; i >= 0; i--) {
        const p = keptCurve[i];
        ctx.lineTo(toX(p.x), toY(p.y - epsilon));
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Injected raw write curve — quiet reference line
    if (rawCurve.length > 1) {
      ctx.strokeStyle = CANVAS_COLORS.structural;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      rawCurve.forEach((p, i) => {
        const x = toX(p.x);
        const y = toY(p.y);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Kept curve — solid, full strength, linear segments (this is how it plays)
    if (keptCurve.length > 0) {
      ctx.strokeStyle = CANVAS_COLORS.amber;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      keptCurve.forEach((p, i) => {
        const x = toX(p.x);
        const y = toY(p.y);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = CANVAS_COLORS.amber;
      keptCurve.forEach(p => {
        ctx.beginPath();
        ctx.arc(toX(p.x), toY(p.y), 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Max-deviation marker
    if (deviation !== null) {
      const x = toX(deviation.x);
      const yRaw = toY(deviation.rawY);
      const yKept = toY(deviation.keptY);
      ctx.strokeStyle = CANVAS_COLORS.green;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, yRaw);
      ctx.lineTo(x, yKept);
      ctx.stroke();
      ctx.fillStyle = CANVAS_COLORS.green;
      [yRaw, yKept].forEach(y => {
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.font = CANVAS_FONT_BOLD;
      const alignRight = x > width * 0.6;
      ctx.textAlign = alignRight ? "right" : "left";
      ctx.fillText(deviation.label, x + (alignRight ? -8 : 8), Math.min(yRaw, yKept) - 6);
    }

    // Legend
    ctx.font = CANVAS_FONT;
    ctx.textAlign = "left";
    ctx.fillStyle = CANVAS_COLORS.structural;
    ctx.fillText("— injected (raw writes)", SIM_PAD_LEFT, SIMPLIFIER_HEIGHT - 6);
    ctx.fillStyle = CANVAS_COLORS.amber;
    ctx.fillText("— kept (plays)", SIM_PAD_LEFT + 168, SIMPLIFIER_HEIGHT - 6);
    ctx.fillStyle = CANVAS_COLORS.cyan;
    ctx.fillText("ε band", SIM_PAD_LEFT + 280, SIMPLIFIER_HEIGHT - 6);
  }, [rawCurve, keptCurve, epsilon, deviation]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: SIMPLIFIER_HEIGHT,
        display: "block",
        borderRadius: 4,
        border: "1px solid #2a2620",
      }}
    />
  );
};

// --- (B) Latch overdub front-trim: region extent before vs. after -----------------

export interface RegionExtent {
  position: number;
  duration: number;
  loopOffset: number;
}

export interface LatchTrimStripProps {
  /** Gesture region's own geometry right when the finalize-time simplifier ran. */
  before: RegionExtent;
  /** The same region's geometry at Stop, after the next pass grew over it. */
  after: RegionExtent;
  /** Value the eaten range now holds (from the sibling hold region, or this region's own tail). */
  heldValue: number | null;
  /** Timeline span to draw, in ppqn. */
  axisMax: number;
}

const STRIP_HEIGHT = 150;
const STRIP_PAD_L = 12;
const STRIP_PAD_R = 12;
const ROW_H = 26;
const ROW1_Y = 20;
const ROW2_Y = ROW1_Y + ROW_H + 22;
const LINE1_Y = ROW2_Y + ROW_H + 18;
const LINE2_Y = LINE1_Y + 16;
const LINE3_Y = LINE2_Y + 16;

function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  if (w <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  for (let sx = x - h; sx < x + w; sx += 6) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

export const LatchTrimStrip: React.FC<LatchTrimStripProps> = ({ before, after, heldValue, axisMax }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.clientWidth <= 0) return;
    const width = resizeForDpr(canvas, ctx, STRIP_HEIGHT);

    ctx.fillStyle = CANVAS_COLORS.bg;
    ctx.fillRect(0, 0, width, STRIP_HEIGHT);

    const drawWidth = width - STRIP_PAD_L - STRIP_PAD_R;
    const span = axisMax > 0 ? axisMax : 1;
    const toX = (v: number) => STRIP_PAD_L + (v / span) * drawWidth;

    // Row backgrounds — the full lane extent
    ctx.fillStyle = CANVAS_COLORS.shade;
    ctx.fillRect(STRIP_PAD_L, ROW1_Y, drawWidth, ROW_H);
    ctx.fillRect(STRIP_PAD_L, ROW2_Y, drawWidth, ROW_H);

    // Row titles
    ctx.font = CANVAS_FONT_SMALL;
    ctx.textAlign = "left";
    ctx.fillStyle = CANVAS_COLORS.label;
    ctx.fillText("GESTURE REGION AT FINALIZE", STRIP_PAD_L, ROW1_Y - 6);
    ctx.fillText("SAME REGION AT STOP", STRIP_PAD_L, ROW2_Y - 6);

    // Before bar
    const bx0 = toX(before.position);
    const bx1 = toX(before.position + before.duration);
    ctx.fillStyle = CANVAS_COLORS.amber;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(bx0, ROW1_Y, Math.max(1, bx1 - bx0), ROW_H);
    ctx.globalAlpha = 1;

    // Eaten range — what the region no longer covers, hatched into the "after" row
    const eatenFrom = Math.min(before.position, after.position);
    const eatenTo = Math.max(before.position, after.position);
    if (eatenTo > eatenFrom) {
      hatch(ctx, toX(eatenFrom), ROW2_Y, toX(eatenTo) - toX(eatenFrom), ROW_H, CANVAS_COLORS.label);
    }

    // After bar — what the region covers now
    const ax0 = toX(after.position);
    const ax1 = toX(after.position + after.duration);
    ctx.fillStyle = CANVAS_COLORS.cyan;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(ax0, ROW2_Y, Math.max(1, ax1 - ax0), ROW_H);
    ctx.globalAlpha = 1;

    // Numeric readout — the actual measured numbers
    ctx.font = CANVAS_FONT;
    ctx.textAlign = "left";
    ctx.fillStyle = CANVAS_COLORS.label;
    ctx.fillText(
      `before: pos ${before.position} · dur ${before.duration} · loopOffset ${before.loopOffset}`,
      STRIP_PAD_L,
      LINE1_Y,
    );
    ctx.fillText(
      `after: pos ${after.position} · dur ${after.duration} · loopOffset ${after.loopOffset}` +
        (eatenTo > eatenFrom ? `  (${eatenTo - eatenFrom} ppqn eaten)` : ""),
      STRIP_PAD_L,
      LINE2_Y,
    );
    if (heldValue !== null) {
      ctx.fillStyle = CANVAS_COLORS.green;
      ctx.fillText(`hatched range now holds ≈ ${heldValue.toFixed(4)} flat`, STRIP_PAD_L, LINE3_Y);
    }
  }, [before, after, heldValue, axisMax]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: STRIP_HEIGHT,
        display: "block",
        borderRadius: 4,
        border: "1px solid #2a2620",
      }}
    />
  );
};
