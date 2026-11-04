/**
 * A piano-roll lane on a canvas: notes as bars over a fixed pulse range and pitch range, repainted
 * only on `requestUpdate()` (the handle) or a resize, through `CanvasPainter`. `notes()` is read
 * inside the paint, so a caller whose notes change every frame (the emitted lane) holds them in a
 * ref and calls `requestUpdate()` from its own frame loop. With `position` given, a playhead overlay
 * div follows it per frame by writing `style.left` directly (no state per frame).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { AnimationFrame } from "@opendaw/lib-dom";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { velocityColor } from "@/lib/midiEffects/velocityColor";
import { CANVAS_COLORS, CANVAS_FONT_SMALL } from "@/lib/design/consoleTheme";

export interface LaneNote {
  readonly pitch: number;
  /** ppqn */
  readonly from: number;
  /** ppqn; null = still sounding (drawn to the playhead, or the lane's end) */
  readonly to: number | null;
  /** 0..1; shades the bar when the lane shades by velocity */
  readonly velocity?: number;
  /** outline only, no fill */
  readonly hollow?: boolean;
  /** the bar's left and right edges drawn as dashed lines over the fill */
  readonly dashedEdges?: boolean;
  /** drawn just right of the bar's left edge, inside its row */
  readonly label?: string;
}

export interface NoteLaneHandle {
  requestUpdate(): void;
}

export interface NoteLaneProps {
  title: string;
  caption?: string;
  notes: () => readonly LaneNote[];
  rangePpqn: number;
  /** inclusive */
  pitchLow: number;
  /** inclusive */
  pitchHigh: number;
  height: number;
  shadeByVelocity: boolean;
  /** read every frame; when given, the playhead overlay follows it and open bars end at it */
  position?: () => number;
  /** pulses per beat and per bar, for the grid */
  beatPpqn?: number;
  barPpqn?: number;
}

const MARK_HEIGHT = 3;
const BORDER = "1px solid var(--mc-line)";

export const NoteLane = forwardRef<NoteLaneHandle, NoteLaneProps>(function NoteLane(
  { title, caption, notes, rangePpqn, pitchLow, pitchHigh, height, shadeByVelocity, position, beatPpqn = 960, barPpqn = 3840 },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const outOfRangeRef = useRef<HTMLSpanElement>(null);
  const painterRef = useRef<CanvasPainter | null>(null);
  // Props the paint reads, kept current without re-creating the painter.
  const propsRef = useRef({ notes, rangePpqn, pitchLow, pitchHigh, shadeByVelocity, position, beatPpqn, barPpqn });
  propsRef.current = { notes, rangePpqn, pitchLow, pitchHigh, shadeByVelocity, position, beatPpqn, barPpqn };

  useImperativeHandle(ref, () => ({ requestUpdate: () => painterRef.current?.requestUpdate() }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const painter = new CanvasPainter(canvas, (_painter, context) => {
      const { notes, rangePpqn, pitchLow, pitchHigh, shadeByVelocity, position, beatPpqn, barPpqn } = propsRef.current;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (rangePpqn <= 0 || beatPpqn <= 0 || barPpqn <= 0 || pitchHigh < pitchLow) return;
      const rows = pitchHigh - pitchLow + 1;
      const rowHeight = height / rows;
      const x = (ppqn: number) => (ppqn / rangePpqn) * width;

      context.fillStyle = CANVAS_COLORS.bg;
      context.fillRect(0, 0, width, height);
      for (let p = 0; p < rangePpqn; p += beatPpqn) {
        context.strokeStyle = p % barPpqn === 0 ? CANVAS_COLORS.gridSupporting : CANVAS_COLORS.gridTertiary;
        context.beginPath();
        context.moveTo(x(p) + 0.5, 0);
        context.lineTo(x(p) + 0.5, height);
        context.stroke();
      }

      const end = position ? position() : rangePpqn;
      let outOfRange = 0;
      for (const note of notes()) {
        const to = note.to ?? Math.max(note.from, end);
        const left = x(note.from);
        const barWidth = Math.max(x(to) - left, 1);
        const fill = shadeByVelocity && note.velocity !== undefined ? velocityColor(note.velocity) : CANVAS_COLORS.amber;
        if (note.pitch < pitchLow || note.pitch > pitchHigh) {
          outOfRange++;
          context.fillStyle = fill;
          context.fillRect(left, note.pitch < pitchLow ? height - MARK_HEIGHT : 0, barWidth, MARK_HEIGHT);
          continue;
        }
        const top = (pitchHigh - note.pitch) * rowHeight;
        const barHeight = Math.max(rowHeight - 1, 1);
        if (note.hollow) {
          context.strokeStyle = CANVAS_COLORS.structural;
          context.lineWidth = 1;
          context.strokeRect(left, top, barWidth, barHeight);
        } else {
          context.fillStyle = fill;
          context.fillRect(left, top, barWidth, barHeight);
        }
        if (note.dashedEdges) {
          context.strokeStyle = CANVAS_COLORS.playhead;
          context.globalAlpha = 0.7;
          context.setLineDash([2, 2]);
          context.beginPath();
          context.moveTo(left + 0.5, top);
          context.lineTo(left + 0.5, top + barHeight);
          context.moveTo(left + barWidth - 0.5, top);
          context.lineTo(left + barWidth - 0.5, top + barHeight);
          context.stroke();
          context.setLineDash([]);
          context.globalAlpha = 1;
        }
        if (note.label) {
          context.font = CANVAS_FONT_SMALL;
          // a label wider than its bar would spill over the neighbours' bars and labels
          if (barWidth >= context.measureText(note.label).width + 4) {
            context.fillStyle = CANVAS_COLORS.label;
            context.textBaseline = "top";
            context.fillText(note.label, left + 2, top + 1);
          }
        }
      }

      context.fillStyle = CANVAS_COLORS.label;
      context.font = CANVAS_FONT_SMALL;
      context.textBaseline = "top";
      context.fillText(title, 4, 3);
      if (outOfRangeRef.current) {
        outOfRangeRef.current.textContent = outOfRange > 0 ? `${outOfRange} out of range` : "";
      }
    });
    painterRef.current = painter;
    return () => {
      painter.terminate();
      painterRef.current = null;
    };
  }, [title]);

  const hasPosition = position !== undefined;
  useEffect(() => {
    if (!hasPosition) return undefined;
    const sub = AnimationFrame.add(() => {
      const playhead = playheadRef.current;
      const canvas = canvasRef.current;
      const read = propsRef.current.position;
      if (!playhead || !canvas || !read) return;
      const fraction = Math.max(0, Math.min(1, read() / propsRef.current.rangePpqn));
      playhead.style.left = `${fraction * canvas.clientWidth}px`;
    });
    return () => sub.terminate();
  }, [hasPosition]);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        aria-label={title}
        style={{ display: "block", width: "100%", height, boxSizing: "border-box", border: BORDER, background: "var(--mc-bg)" }}
      />
      {position && (
        <div
          ref={playheadRef}
          style={{
            position: "absolute", top: 0, height, left: 0, width: 1, pointerEvents: "none",
            boxSizing: "border-box", borderLeft: `1px solid ${CANVAS_COLORS.playhead}`, opacity: 0.8,
          }}
        />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4, fontSize: 11, color: "var(--mc-label)" }}>
        <span>{caption}</span>
        <span ref={outOfRangeRef} style={{ color: "var(--mc-amber)" }} />
      </div>
    </div>
  );
});
