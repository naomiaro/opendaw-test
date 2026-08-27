import React, { useEffect, useRef, useState, useCallback } from "react";
import { Flex, Text } from "@radix-ui/themes";
import type { SampleLoader } from "@opendaw/studio-adapters";
import type { AudioRegionBox } from "@opendaw/studio-boxes";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PeaksPainter } from "@opendaw/lib-fusion";
import type { Peaks } from "@opendaw/lib-fusion";
import type { PeaksWriter } from "@opendaw/studio-core";
import { PPQN } from "@opendaw/lib-dsp";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { CANVAS_COLORS } from "@/lib/design/consoleTheme";
import { compSpans, snapToGrid, type CompState, type CompSpan } from "@/lib/compLaneUtils";

// Console accent rotation for take lanes (from the mastering-console palette).
export const LANE_COLORS = [
  "#e8a33d", // amber
  "#5fb4c9", // cyan
  "#7fbf6a", // green
  "#df8a76", // rose
  "#ab92db", // violet
  "#7fa0d4", // slate
];

const LANE_HEIGHT = 48;
const COMP_LANE_HEIGHT = 56;
const HEADER_WIDTH = 120;
const CLICK_TOLERANCE_PX = 4;
const EDGE_TOLERANCE_PX = 6;

export interface SwipeTakeLane {
  regionBox: AudioRegionBox;
  label: string;
  color: string;
  sampleLoader: SampleLoader | null;
  waveformOffsetFrames: number;
  durationSec: number;
}

interface SwipeCompLanesProps {
  takes: SwipeTakeLane[];
  compState: CompState;
  loopPpqn: number;
  bpm: number;
  sampleRate: number;
  interactive: boolean;
  recordingLive: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  auditionTake: number | null;
  onToggleAudition: (takeIndex: number) => void;
  onSwipe: (takeIndex: number, fromPpqn: number, toPpqn: number) => void;
  onZoneClick: (takeIndex: number, positionPpqn: number) => void;
  onEdgeDrag: (boundaryIndex: number, newPpqn: number) => void;
  onCut: (fromPpqn: number, toPpqn: number) => void;
  selectedZone: number | null;
  onSelectZone: (zoneIndex: number | null) => void;
  snapPpqn: number;
  getPositionPpqn: () => number;
  showPlayhead: boolean;
}

/** Renders waveform strips for one take over the lane's x-range.
 *  All lanes map x ∈ [0, width] to loop PPQN ∈ [0, loopPpqn]. */
function paintTakeStrips(
  context: CanvasRenderingContext2D,
  peaks: Peaks | PeaksWriter,
  lane: SwipeTakeLane,
  durationSec: number, // read LIVE from the region box each paint — grows during recording
  x0: number,
  x1: number,
  width: number,
  height: number,
  loopSeconds: number,
  sampleRate: number
): void {
  // frames-per-pixel is constant across the lane; u range follows x range.
  const loopFrames = loopSeconds * sampleRate;
  const takeFrames = Math.min(durationSec * sampleRate, loopFrames);
  const xEnd = (takeFrames / loopFrames) * width; // pixel where the take's audio ends
  const clampedX1 = Math.min(x1, xEnd);
  if (clampedX1 <= x0) return;
  const u0 = lane.waveformOffsetFrames + (x0 / width) * loopFrames;
  const u1 = lane.waveformOffsetFrames + (clampedX1 / width) * loopFrames;
  const numChannels = peaks.numChannels;
  const channelHeight = height / numChannels;
  for (let ch = 0; ch < numChannels; ch++) {
    PeaksPainter.renderPixelStrips(context, peaks, ch, {
      x0,
      x1: clampedX1,
      y0: ch * channelHeight + 1,
      y1: (ch + 1) * channelHeight - 1,
      u0,
      u1,
      v0: -1.001,
      v1: 1.001,
    });
  }
}

/** One take lane: dim base waveform + lit spans owned by this take. */
const TakeLaneCanvas: React.FC<{
  lane: SwipeTakeLane;
  spans: CompSpan[]; // spans assigned to this take, loop-relative PPQN
  loopPpqn: number;
  bpm: number;
  sampleRate: number;
}> = ({ lane, spans, loopPpqn, bpm, sampleRate }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const laneRef = useRef(lane);
  const spansRef = useRef(spans);
  laneRef.current = lane;
  spansRef.current = spans;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const painter = new CanvasPainter(canvas, (_, context) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const l = laneRef.current;
      context.fillStyle = CANVAS_COLORS.bg;
      context.fillRect(0, 0, w, h);
      if (!l.sampleLoader) return;
      const peaksOption = l.sampleLoader.peaks;
      if (peaksOption.isEmpty()) return;
      const peaks = peaksOption.unwrap() as Peaks | PeaksWriter;
      const loopSeconds = PPQN.pulsesToSeconds(loopPpqn, bpm);
      // Live duration: the SDK updates regionBox.duration every frame while
      // recording, so the top lane grows without any React re-render.
      const liveDurationSec = l.regionBox.duration.getValue();
      // Dim base waveform across the whole lane.
      context.fillStyle = CANVAS_COLORS.structural;
      paintTakeStrips(context, peaks, l, liveDurationSec, 0, w, w, h, loopSeconds, sampleRate);
      // Lit spans owned by this take.
      for (const span of spansRef.current) {
        const xa = (span.start / loopPpqn) * w;
        const xb = (span.end / loopPpqn) * w;
        context.fillStyle = l.color + "26"; // ~15% tint
        context.fillRect(xa, 0, xb - xa, h);
        context.fillStyle = l.color;
        paintTakeStrips(context, peaks, l, liveDurationSec, xa, xb, w, h, loopSeconds, sampleRate);
      }
    });
    const animSub = AnimationFrame.add(() => painter.requestUpdate());
    return () => {
      animSub.terminate();
      painter.terminate();
    };
  }, [loopPpqn, bpm, sampleRate]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: LANE_HEIGHT, display: "block" }}
    />
  );
};

/** The comp lane: assembled waveform, per-zone tint in the source take's color. */
const CompLaneCanvas: React.FC<{
  takes: SwipeTakeLane[];
  compState: CompState;
  loopPpqn: number;
  bpm: number;
  sampleRate: number;
  bypassed: boolean; // recording view: comp is muted — render in neutral color
}> = ({ takes, compState, loopPpqn, bpm, sampleRate, bypassed }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const takesRef = useRef(takes);
  const stateRef = useRef(compState);
  const bypassedRef = useRef(bypassed);
  takesRef.current = takes;
  stateRef.current = compState;
  bypassedRef.current = bypassed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const painter = new CanvasPainter(canvas, (_, context) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      context.fillStyle = CANVAS_COLORS.shade;
      context.fillRect(0, 0, w, h);
      const loopSeconds = PPQN.pulsesToSeconds(loopPpqn, bpm);
      for (const span of compSpans(stateRef.current, loopPpqn)) {
        const lane = takesRef.current[span.take];
        if (lane === undefined || !lane.sampleLoader) continue;
        const peaksOption = lane.sampleLoader.peaks;
        if (peaksOption.isEmpty()) continue;
        const peaks = peaksOption.unwrap() as Peaks | PeaksWriter;
        const xa = (span.start / loopPpqn) * w;
        const xb = (span.end / loopPpqn) * w;
        const dimmed = bypassedRef.current;
        // Bypassed (recording view): neutral color, no take tints — the comp
        // is muted while recording, and the different color says so.
        context.fillStyle = dimmed ? CANVAS_COLORS.shade : lane.color + "22";
        context.fillRect(xa, 0, xb - xa, h);
        context.fillStyle = dimmed ? CANVAS_COLORS.structural : CANVAS_COLORS.label;
        // A nudged section reads shifted content — shift the drawn frames the
        // same way (positive nudge = content later = read earlier frames).
        const nudgeFrames = Math.round(
          PPQN.pulsesToSeconds(span.nudge, bpm) * sampleRate
        );
        const drawLane =
          nudgeFrames !== 0
            ? { ...lane, waveformOffsetFrames: lane.waveformOffsetFrames - nudgeFrames }
            : lane;
        paintTakeStrips(
          context, peaks, drawLane, lane.regionBox.duration.getValue(),
          xa, xb, w, h, loopSeconds, sampleRate
        );
        // Seam tick at each zone start (skip x=0).
        if (span.start > 0) {
          context.fillStyle = dimmed ? CANVAS_COLORS.structural : CANVAS_COLORS.amber;
          context.beginPath();
          context.moveTo(xa - 4, 0);
          context.lineTo(xa + 4, 0);
          context.lineTo(xa, 7);
          context.closePath();
          context.fill();
        }
      }
    });
    const animSub = AnimationFrame.add(() => painter.requestUpdate());
    return () => {
      animSub.terminate();
      painter.terminate();
    };
  }, [loopPpqn, bpm, sampleRate]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: COMP_LANE_HEIGHT, display: "block" }}
    />
  );
};

interface DragState {
  mode: "swipe" | "edge";
  takeIndex: number;
  startX: number;
  currentX: number;
  boundaryIndex: number | null; // set in "edge" mode
}

export const SwipeCompLanes: React.FC<SwipeCompLanesProps> = ({
  takes,
  compState,
  loopPpqn,
  bpm,
  sampleRate,
  interactive,
  recordingLive,
  collapsed,
  onToggleCollapsed,
  auditionTake,
  onToggleAudition,
  onSwipe,
  onZoneClick,
  onEdgeDrag,
  onCut,
  selectedZone,
  onSelectZone,
  snapPpqn,
  getPositionPpqn,
  showPlayhead,
}) => {
  const [drag, setDrag] = useState<DragState | null>(null);
  // Marquee cut / section select on the comp lane.
  const [compDrag, setCompDrag] = useState<{ startX: number; currentX: number } | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  // Direct-DOM playhead (loop-relative), no per-frame setState.
  useEffect(() => {
    const sub = AnimationFrame.add(() => {
      const el = playheadRef.current;
      if (!el) return;
      if (!showPlayhead || loopPpqn <= 0) {
        el.style.display = "none";
        return;
      }
      el.style.display = "block";
      const pct = ((getPositionPpqn() % loopPpqn) / loopPpqn) * 100;
      el.style.left = `${Math.min(100, Math.max(0, pct))}%`;
    });
    return () => sub.terminate();
  }, [showPlayhead, loopPpqn, getPositionPpqn]);

  // Raw conversion for hit tests (zone click, selection).
  const xToPpqn = useCallback(
    (x: number, width: number) =>
      Math.round((Math.min(Math.max(x, 0), width) / width) * loopPpqn),
    [loopPpqn]
  );
  // Snapped conversion for range endpoints (swipe, edge drag, marquee cut).
  const xToPpqnSnapped = useCallback(
    (x: number, width: number) => snapToGrid(xToPpqn(x, width), snapPpqn),
    [xToPpqn, snapPpqn]
  );

  /** Index of the boundary within EDGE_TOLERANCE_PX of x, or null. */
  const boundaryNear = useCallback(
    (x: number, width: number): number | null => {
      for (let k = 0; k < compState.boundaries.length; k++) {
        const bx = (compState.boundaries[k] / loopPpqn) * width;
        if (Math.abs(bx - x) <= EDGE_TOLERANCE_PX) return k;
      }
      return null;
    },
    [compState.boundaries, loopPpqn]
  );

  const handlePointerDown = useCallback(
    (takeIndex: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      e.currentTarget.setPointerCapture(e.pointerId);
      const boundaryIndex = boundaryNear(x, rect.width);
      setDrag({
        mode: boundaryIndex !== null ? "edge" : "swipe",
        takeIndex,
        startX: x,
        currentX: x,
        boundaryIndex,
      });
    },
    [interactive, boundaryNear]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (drag === null) {
        // Hover feedback only — direct DOM, no re-render.
        e.currentTarget.style.cursor = !interactive
          ? "default"
          : boundaryNear(x, rect.width) !== null
            ? "ew-resize"
            : "crosshair";
        return;
      }
      setDrag({ ...drag, currentX: x });
    },
    [drag, interactive, boundaryNear]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (drag === null) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      setDrag(null);
      if (drag.mode === "edge" && drag.boundaryIndex !== null) {
        onEdgeDrag(drag.boundaryIndex, xToPpqnSnapped(endX, rect.width));
      } else if (Math.abs(endX - drag.startX) < CLICK_TOLERANCE_PX) {
        onZoneClick(drag.takeIndex, xToPpqn(endX, rect.width));
      } else {
        onSwipe(
          drag.takeIndex,
          xToPpqnSnapped(drag.startX, rect.width),
          xToPpqnSnapped(endX, rect.width)
        );
      }
    },
    [drag, onSwipe, onZoneClick, onEdgeDrag, xToPpqn, xToPpqnSnapped]
  );

  // A cancelled pointer (browser gesture interruption, e.g. a system dialog
  // or the pointer leaving the window mid-drag) never fires pointerup — drop
  // the in-progress drag instead of leaving a stale drag preview on screen.
  const handlePointerCancel = useCallback(() => {
    setDrag(null);
  }, []);

  // ── Comp-lane pointer handlers: click = select section, drag = marquee cut ──
  const handleCompPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      const rect = e.currentTarget.getBoundingClientRect();
      e.currentTarget.setPointerCapture(e.pointerId);
      const x = e.clientX - rect.left;
      setCompDrag({ startX: x, currentX: x });
    },
    [interactive]
  );

  const handleCompPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (compDrag === null) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setCompDrag({ ...compDrag, currentX: e.clientX - rect.left });
    },
    [compDrag]
  );

  const handleCompPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (compDrag === null) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      setCompDrag(null);
      if (Math.abs(endX - compDrag.startX) < CLICK_TOLERANCE_PX) {
        // Click: toggle-select the section under the pointer.
        const pos = xToPpqn(endX, rect.width);
        const spansNow = compSpans(compState, loopPpqn);
        const idx = spansNow.findIndex((s) => pos >= s.start && pos < s.end);
        onSelectZone(idx >= 0 && idx !== selectedZone ? idx : null);
      } else {
        onCut(
          xToPpqnSnapped(compDrag.startX, rect.width),
          xToPpqnSnapped(endX, rect.width)
        );
      }
    },
    [compDrag, compState, loopPpqn, selectedZone, onSelectZone, onCut, xToPpqn, xToPpqnSnapped]
  );

  // Same cancellation guard as the take lanes (see handlePointerCancel).
  const handleCompPointerCancel = useCallback(() => {
    setCompDrag(null);
  }, []);

  const spans = compSpans(compState, loopPpqn);
  const lanesHeight = takes.length * (LANE_HEIGHT + 1);

  return (
    <div
      style={{
        border: "1px solid var(--mc-line)",
        borderRadius: 4,
        overflow: "hidden",
        background: "var(--mc-panel)",
      }}
    >
      {/* ── Comp lane ── */}
      <div style={{ display: "flex", borderBottom: "2px solid var(--mc-line)" }}>
        <button
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand take lanes" : "Collapse take lanes"}
          style={{
            width: HEADER_WIDTH,
            minWidth: HEADER_WIDTH,
            boxSizing: "border-box",
            padding: "6px 10px",
            background: "var(--mc-panel)",
            border: "none",
            borderRight: "1px solid var(--mc-line)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            textAlign: "left",
          }}
        >
          <span
            className="scl-disclosure"
            style={{
              fontSize: 9,
              color: "var(--mc-amber)",
              transform: collapsed ? "rotate(-90deg)" : "none",
            }}
          >
            ▼
          </span>
          <Flex direction="column">
            <Text
              size="1"
              weight="bold"
              style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
            >
              Comp
            </Text>
            <Text size="1" color="gray">
              {takes.length} take{takes.length !== 1 ? "s" : ""}
            </Text>
          </Flex>
        </button>
        <div
          onPointerDown={handleCompPointerDown}
          onPointerMove={handleCompPointerMove}
          onPointerUp={handleCompPointerUp}
          onPointerCancel={handleCompPointerCancel}
          style={{
            flex: 1,
            position: "relative",
            touchAction: "none",
            cursor: interactive ? "text" : "default",
          }}
        >
          <CompLaneCanvas
            takes={takes}
            compState={compState}
            loopPpqn={loopPpqn}
            bpm={bpm}
            sampleRate={sampleRate}
            bypassed={recordingLive}
          />
          {/* Selected section outline */}
          {selectedZone !== null && spans[selectedZone] !== undefined && (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${(spans[selectedZone].start / loopPpqn) * 100}%`,
                width: `${((spans[selectedZone].end - spans[selectedZone].start) / loopPpqn) * 100}%`,
                border: "1.5px solid var(--mc-amber)",
                boxSizing: "border-box",
                pointerEvents: "none",
              }}
            />
          )}
          {/* Marquee-cut preview */}
          {compDrag !== null &&
            Math.abs(compDrag.currentX - compDrag.startX) >= CLICK_TOLERANCE_PX && (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: Math.min(compDrag.startX, compDrag.currentX),
                width: Math.abs(compDrag.currentX - compDrag.startX),
                background: "rgba(216, 210, 200, 0.10)",
                border: "1.5px dashed var(--mc-text)",
                boxSizing: "border-box",
                pointerEvents: "none",
              }}
            />
          )}
          {(auditionTake !== null || recordingLive) && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(13, 12, 10, 0.6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <Text size="1" color="gray">
                {recordingLive
                  ? "recording — comp bypassed"
                  : `auditioning ${takes[auditionTake ?? 0]?.label ?? ""} — comp bypassed`}
              </Text>
            </div>
          )}
        </div>
      </div>

      {/* ── Take lanes (collapsible) ── */}
      <div
        className="scl-lanes"
        style={{
          maxHeight: collapsed ? 0 : lanesHeight,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {takes
          .map((lane, i) => ({ lane, i }))
          .reverse() // newest take directly under the comp lane (Logic order)
          .map(({ lane, i }) => (
          <div
            key={lane.regionBox.address.toString()}
            style={{ display: "flex", borderBottom: "1px solid var(--mc-line)" }}
          >
            <div
              style={{
                width: HEADER_WIDTH,
                minWidth: HEADER_WIDTH,
                boxSizing: "border-box",
                padding: "4px 10px",
                borderRight: "1px solid var(--mc-line)",
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flex: "none",
                  background: lane.color,
                }}
              />
              <Text
                size="1"
                color="gray"
                style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}
              >
                {lane.label}
              </Text>
              <button
                onClick={() => onToggleAudition(i)}
                disabled={!interactive}
                aria-pressed={auditionTake === i}
                aria-label={`Audition ${lane.label}`}
                title={`Audition ${lane.label} alone`}
                style={{
                  marginLeft: "auto",
                  background: "none",
                  border: "none",
                  cursor: interactive ? "pointer" : "default",
                  fontSize: 12,
                  color:
                    auditionTake === i ? "var(--mc-cyan)" : "var(--mc-faint)",
                }}
              >
                🎧
              </button>
            </div>
            <div
              onPointerDown={handlePointerDown(i)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              style={{
                flex: 1,
                position: "relative",
                touchAction: "none",
                cursor: interactive ? "crosshair" : "default",
              }}
            >
              <TakeLaneCanvas
                lane={lane}
                spans={spans.filter((s) => s.take === i)}
                loopPpqn={loopPpqn}
                bpm={bpm}
                sampleRate={sampleRate}
              />
              {drag !== null && drag.takeIndex === i && drag.mode === "swipe" && (
                <div
                  style={{
                    position: "absolute",
                    top: 1,
                    bottom: 1,
                    left: Math.min(drag.startX, drag.currentX),
                    width: Math.abs(drag.currentX - drag.startX),
                    background: lane.color + "1c",
                    border: `1.5px dashed ${lane.color}`,
                    borderRadius: 2,
                    boxSizing: "border-box",
                    pointerEvents: "none",
                  }}
                />
              )}
              {drag !== null && drag.takeIndex === i && drag.mode === "edge" && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: drag.currentX - 1,
                    width: 2,
                    background: "rgba(216, 210, 200, 0.7)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          </div>
        ))}
        {/* Seam lines through the take-lane stack */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: HEADER_WIDTH,
            right: 0,
            pointerEvents: "none",
          }}
        >
          {compState.boundaries.map((b) => (
            <div
              key={b}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${(b / loopPpqn) * 100}%`,
                width: 1,
                background: "rgba(216, 210, 200, 0.12)",
              }}
            />
          ))}
        </div>
      </div>

      {/* ── Playhead overlay (comp + lanes) ── */}
      <div
        style={{
          position: "relative",
          height: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: HEADER_WIDTH,
            right: 0,
            bottom: 0,
            height: collapsed
              ? COMP_LANE_HEIGHT + 2
              : COMP_LANE_HEIGHT + 2 + lanesHeight,
            pointerEvents: "none",
          }}
        >
          <div
            ref={playheadRef}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: 2,
              background: CANVAS_COLORS.playhead,
              display: "none",
              zIndex: 10,
            }}
          />
        </div>
      </div>
    </div>
  );
};
