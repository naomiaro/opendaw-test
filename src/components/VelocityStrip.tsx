/**
 * The row under a piano roll: one vertical stem per note, height = velocity. A faint ghost stem
 * marks each written note, a solid stem in the velocity ramp colour each note the engine emitted.
 * Repainted only on `requestUpdate()` or a resize, through `CanvasPainter`.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { velocityColor } from "@/lib/midiEffects/velocityColor";
import { CANVAS_COLORS, CANVAS_FONT_SMALL } from "@/lib/design/consoleTheme";

export interface Stem {
  /** ppqn, region-local */
  readonly at: number;
  /** 0..1 */
  readonly velocity: number;
}

export interface VelocityStripHandle {
  requestUpdate(): void;
}

export interface VelocityStripProps {
  title: string;
  caption?: string;
  ghosts: () => readonly Stem[];
  stems: () => readonly Stem[];
  rangePpqn: number;
  height: number;
  /** pulses per beat and per bar, for the grid */
  beatPpqn?: number;
  barPpqn?: number;
}

const STEM_WIDTH = 3;
const TITLE_ROOM = 14;
const BORDER = "1px solid var(--mc-line)";

export const VelocityStrip = forwardRef<VelocityStripHandle, VelocityStripProps>(function VelocityStrip(
  { title, caption, ghosts, stems, rangePpqn, height, beatPpqn = 960, barPpqn = 3840 },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<CanvasPainter | null>(null);
  // Props the paint reads, kept current without re-creating the painter.
  const propsRef = useRef({ ghosts, stems, rangePpqn, beatPpqn, barPpqn });
  propsRef.current = { ghosts, stems, rangePpqn, beatPpqn, barPpqn };

  useImperativeHandle(ref, () => ({ requestUpdate: () => painterRef.current?.requestUpdate() }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const painter = new CanvasPainter(canvas, (_painter, context) => {
      const { ghosts, stems, rangePpqn, beatPpqn, barPpqn } = propsRef.current;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (rangePpqn <= 0 || beatPpqn <= 0 || barPpqn <= 0) return;
      const x = (ppqn: number) => (ppqn / rangePpqn) * width;
      const stemHeight = (velocity: number) => velocity * (height - TITLE_ROOM);

      context.fillStyle = CANVAS_COLORS.bg;
      context.fillRect(0, 0, width, height);
      for (let p = 0; p < rangePpqn; p += beatPpqn) {
        context.strokeStyle = p % barPpqn === 0 ? CANVAS_COLORS.gridSupporting : CANVAS_COLORS.gridTertiary;
        context.beginPath();
        context.moveTo(x(p) + 0.5, 0);
        context.lineTo(x(p) + 0.5, height);
        context.stroke();
      }

      context.fillStyle = CANVAS_COLORS.structural;
      for (const ghost of ghosts()) {
        const h = stemHeight(ghost.velocity);
        context.fillRect(x(ghost.at), height - h, STEM_WIDTH, h);
      }
      for (const stem of stems()) {
        const h = stemHeight(stem.velocity);
        context.fillStyle = velocityColor(stem.velocity);
        context.fillRect(x(stem.at) + 1, height - h, STEM_WIDTH, h);
      }

      context.fillStyle = CANVAS_COLORS.label;
      context.font = CANVAS_FONT_SMALL;
      context.textBaseline = "top";
      context.fillText(title, 4, 3);
    });
    painterRef.current = painter;
    return () => {
      painter.terminate();
      painterRef.current = null;
    };
  }, [title]);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        aria-label={title}
        style={{ display: "block", width: "100%", height, boxSizing: "border-box", border: BORDER, background: "var(--mc-bg)" }}
      />
      <div style={{ marginTop: 4, fontSize: 11, color: "var(--mc-label)" }}>
        <span>{caption}</span>
      </div>
    </div>
  );
});
