import React, { useEffect, useRef } from "react";
import { Badge, Flex, Slider, Text } from "@radix-ui/themes";
import type { Project } from "@opendaw/studio-core";
import { AnimationFrame } from "@opendaw/lib-dom";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { CANVAS_COLORS } from "@/lib/design/consoleTheme";
import { BAR, buildRegionRender, LOOP_PPQN, WINDOW_PPQN } from "./laneRenderModel";
import type { LanePoint, LaneRegionModel } from "./laneRenderModel";
import type { LaneSpec } from "./liveAutomationContent";

const CANVAS_HEIGHT = 110;
const HEADER_WIDTH = 180;
const NUM_BARS = WINDOW_PPQN / BAR; // 8
const LOOP_BAR = LOOP_PPQN / BAR; // 4 — loop boundary drawn distinctly

export interface LiveAutomationLaneProps {
  project: Project;
  spec: LaneSpec;
  /** unitValue 0..1 shown on the slider (page owns the state) */
  sliderValue: number;
  onSliderChange: (unitValue: number) => void; // fires per gesture sample
  /** end of a drag (Radix onValueCommit) — lets the page release its gesture guard */
  onSliderCommit?: () => void;
  overridden: boolean; // AutomationSuspension badge
  recording: boolean; // gates REC badge + live repaint loop
  stats: { captured: number; kept: number }; // simplifier readout (kept / captured)
  ghost: LanePoint[] | null; // dashed preset overlay, null = off
}

/** #rrggbb → rgba(...) — canvas fills need an alpha channel the design tokens don't carry. */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Draw a normalized (0..1, y=0 at bottom) polyline into a width×height canvas box. */
function strokePath(ctx: CanvasRenderingContext2D, path: ReadonlyArray<LanePoint>, width: number, height: number): void {
  if (path.length === 0) return;
  ctx.beginPath();
  path.forEach((pt, i) => {
    const x = pt.x * width;
    const y = (1 - pt.y) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

export const LiveAutomationLane: React.FC<LiveAutomationLaneProps> = ({
  project,
  spec,
  sliderValue,
  onSliderChange,
  onSliderCommit,
  overridden,
  recording,
  stats,
  ghost,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<CanvasPainter | null>(null);
  // Frequently-changing props read from refs inside the paint callback so the
  // painter (and its ResizeObserver/AnimationFrame) is created only once per mount.
  const recordingRef = useRef(recording);
  const overriddenRef = useRef(overridden);
  const ghostRef = useRef(ghost);
  recordingRef.current = recording;
  overriddenRef.current = overridden;
  ghostRef.current = ghost;

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

      const alpha = overriddenRef.current ? 0.35 : 1;
      const trackOption = spec.adapter.track;
      if (trackOption.nonEmpty()) {
        const track = trackOption.unwrap();
        for (const region of track.regions.adapters.values()) {
          if (!region.isValueRegion()) continue;
          const eventsOption = region.events;
          if (eventsOption.isEmpty()) continue;
          const model: LaneRegionModel = {
            start: region.position,
            duration: region.duration,
            // A region front-trimmed by a later overdub pass carries a non-zero
            // loopOffset (RegionClipResolver's start-trim; recording itself
            // never writes one) — without these the curve is drawn shifted
            // right by that amount and runs straight out past the outline.
            loopOffset: region.loopOffset,
            loopDuration: region.loopDuration,
            events: eventsOption.unwrap().asArray().map(evt => ({
              position: evt.position,
              value: evt.value,
              interpolation: evt.interpolation,
            })),
          };
          const render = buildRegionRender(model, WINDOW_PPQN);
          const x0 = render.x0 * width;
          const x1 = render.x1 * width;

          ctx.globalAlpha = alpha;
          ctx.fillStyle = withAlpha(spec.color, 0.12);
          ctx.fillRect(x0, 0, x1 - x0, height);
          ctx.strokeStyle = spec.color;
          ctx.lineWidth = 1;
          ctx.strokeRect(x0 + 0.5, 0.5, Math.max(0, x1 - x0 - 1), Math.max(0, height - 1));

          ctx.strokeStyle = spec.color;
          ctx.lineWidth = 2;
          strokePath(ctx, render.path, width, height);
          ctx.globalAlpha = 1;
        }
      }

      const ghostPoints = ghostRef.current;
      if (ghostPoints && ghostPoints.length > 0) {
        ctx.strokeStyle = CANVAS_COLORS.structural;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        strokePath(ctx, ghostPoints, width, height);
        ctx.setLineDash([]);
      }
    });
    painterRef.current = painter;

    const editingSub = project.editing.subscribe(() => painter.requestUpdate());
    const animationFrame = AnimationFrame.add(() => {
      if (recordingRef.current) painter.requestUpdate();
    });

    return () => {
      animationFrame.terminate();
      editingSub.terminate();
      painter.terminate();
      painterRef.current = null;
    };
    // spec is stable per-lane (set up once by buildLiveAutomationContent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, spec]);

  // Structural changes (override state, ghost overlay) invalidate the debounced painter
  // without recreating it.
  useEffect(() => {
    painterRef.current?.requestUpdate();
  }, [overridden, ghost]);

  // Printed from the very unitValue the thumb is drawn at, so the two can never
  // disagree. Neither adapter getter works here: getPrintValue() reads the raw
  // field and lags behind the fader during playback, while
  // getControlledPrintValue() evaluates automation at the playhead and so
  // contradicts the thumb once the transport stops. valueMapping.y turns the
  // unitValue into the field's own units, stringMapping.x formats it.
  const printed = spec.adapter.stringMapping.x(spec.adapter.valueMapping.y(sliderValue));

  return (
    <Flex gap="3" align="stretch">
      <Flex direction="column" gap="1" style={{ width: HEADER_WIDTH, flex: "none" }}>
        <Flex justify="between" align="center">
          <Text size="2" weight="medium">
            {spec.label}
          </Text>
          <Flex gap="1" align="center">
            {recording && stats.captured > 0 && <Badge color="red">REC</Badge>}
            {overridden && <Badge color="amber">OVERRIDE</Badge>}
          </Flex>
        </Flex>
        <Slider
          min={0}
          max={1}
          step={0.001}
          value={[sliderValue]}
          aria-label={spec.label}
          onValueChange={([v]) => onSliderChange(v)}
          onValueCommit={() => onSliderCommit?.()}
          // Tie the fader to its lane's curve colour. Radix Themes paints the
          // filled range from --accent-track (a mix of --accent-8/--accent-9),
          // so all three are pinned to the exact token rather than approximated
          // with a named accent. The thumb stays Radix's white puck — it reads
          // against every lane colour. Verified: the range computes to the exact
          // spec.color rgb in the live DOM.
          style={{
            "--accent-track": spec.color,
            "--accent-indicator": spec.color,
            "--accent-8": spec.color,
            "--accent-9": spec.color,
          } as React.CSSProperties}
        />
        <Flex justify="between" align="center">
          <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>
            {printed.value}
            {printed.unit}
          </Text>
          {/* Kept outside the `recording` gate on purpose: the greedy
              collinearity pass runs on finalize, so the interesting number — how
              few events survived — only exists after a take is finalized (Stop,
              or a loop wrap). Gating this on `recording` hid the punchline. */}
          {stats.captured > 0 && (
            <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>
              {stats.kept}/{stats.captured}
            </Text>
          )}
        </Flex>
      </Flex>
      <div style={{ flex: 1, height: CANVAS_HEIGHT }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
    </Flex>
  );
};
