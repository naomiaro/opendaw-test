import React, { useCallback, useEffect, useRef } from "react";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PeaksPainter } from "@opendaw/lib-fusion";
import type { Project } from "@opendaw/studio-core";
import type { NanoDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { Callout, Text } from "@radix-ui/themes";
import { regionMessage } from "./nanoMessages";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { CANVAS_COLORS } from "@/lib/design/consoleTheme";
import { useParameterUnit, type UnitParameter } from "@/hooks/useParameterUnit";
import {
  constrainMarker, effectiveLoop, fadeUnits, markerKeyTarget, positionsToUnits,
  regionBounds, unitToX, xToUnit, type MarkerId, type MarkerValues,
} from "./nanoMarkers";

const HEIGHT = 180;
/**
 * The device broadcasts while idle too, so the next packet normally clears the overlay.
 * This covers the cases where packets stop: the engine halted, or the tab in the background.
 */
const STALE_PLAYHEAD_MS = 150;

export const WAVEFORM_STYLES = `
/* Half a marker's width on each side, so a marker at either end stays inside the frame. */
.nn-wave-frame { padding: 0 12px; }
.nn-wave { position: relative; width: 100%; height: ${HEIGHT}px; }
.nn-wave canvas {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block;
  box-sizing: border-box; border-radius: 4px;
}
.nn-wave-static { border: 1px solid var(--mc-line); }
.nn-wave-overlay { border: 1px solid transparent; pointer-events: none; }
.nn-marker {
  position: absolute; top: 0; bottom: 0; width: 24px; margin-left: -12px;
  cursor: ew-resize; touch-action: none; background: transparent; border: 0; padding: 0;
}
.nn-marker::before {
  content: ""; position: absolute; top: 0; bottom: 0; left: 11px; width: 2px;
  background: var(--nn-marker-color);
}
.nn-marker::after {
  content: attr(data-tag); position: absolute; left: 50%; transform: translateX(-50%);
  font: 600 10px var(--mc-mono); color: #0d0c0a; background: var(--nn-marker-color);
  padding: 1px 4px; border-radius: 2px; white-space: nowrap;
}
.nn-marker[data-edge="top"]::after { top: 2px; }
.nn-marker[data-edge="bottom"]::after { bottom: 2px; }
.nn-marker:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: -2px; }
.nn-ghost {
  position: absolute; top: 0; bottom: 0; width: 0; pointer-events: none;
  border-left: 1px dashed var(--mc-amber); opacity: 0.8;
}
`;

const MARKERS: ReadonlyArray<{
  id: MarkerId; label: string; tag: string; edge: "top" | "bottom"; color: string;
}> = [
  { id: "sampleStart", label: "Region start marker", tag: "S", edge: "top", color: "var(--mc-amber)" },
  { id: "sampleEnd", label: "Region end marker", tag: "E", edge: "top", color: "var(--mc-amber)" },
  { id: "loopStart", label: "Loop start marker", tag: "L▸", edge: "bottom", color: "var(--mc-cyan)" },
  { id: "loopEnd", label: "Loop end marker", tag: "◂L", edge: "bottom", color: "var(--mc-cyan)" },
];

export interface NanoWaveformProps {
  project: Pick<Project, "editing" | "liveStreamReceiver">;
  adapter: NanoDeviceBoxAdapter;
  sampleSeconds: number;
  peaksVersion: number;
  ghostParameter?: UnitParameter | null;
}

function readValues(adapter: NanoDeviceBoxAdapter): MarkerValues {
  const named = adapter.namedParameter;
  return {
    sampleStart: named.sampleStart.getUnitValue(),
    sampleEnd: named.sampleEnd.getUnitValue(),
    loopStart: named.loopStart.getUnitValue(),
    loopEnd: named.loopEnd.getUnitValue(),
  };
}

/** Frames in the sampler's current sample, or 0 while it has none loaded */
function framesOf(adapter: NanoDeviceBoxAdapter): number {
  const fileOption = adapter.file();
  if (fileOption.isEmpty()) return 0;
  const dataOption = fileOption.unwrap().data;
  return dataOption.isEmpty() ? 0 : dataOption.unwrap().numberOfFrames;
}

function drawPeaks(
  context: CanvasRenderingContext2D, adapter: NanoDeviceBoxAdapter,
  x0: number, x1: number, width: number, height: number
): void {
  const fileOption = adapter.file();
  if (fileOption.isEmpty()) return;
  const peaksOption = fileOption.unwrap().peaks;
  if (peaksOption.isEmpty()) return;
  const peaks = peaksOption.unwrap();
  if (x1 <= x0) return;
  const channelHeight = height / peaks.numChannels;
  for (let channel = 0; channel < peaks.numChannels; channel++) {
    PeaksPainter.renderPixelStrips(context, peaks, channel, {
      x0, x1,
      y0: channel * channelHeight + 1,
      y1: (channel + 1) * channelHeight - 1,
      u0: (x0 / width) * peaks.numFrames,
      u1: (x1 / width) * peaks.numFrames,
      v0: -1.001,
      v1: 1.001,
    });
  }
}

export const NanoWaveform: React.FC<NanoWaveformProps> = ({
  project, adapter, sampleSeconds, peaksVersion, ghostParameter = null,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const painterRef = useRef<CanvasPainter | null>(null);
  // Read inside the paint callback, so a new sample length does not rebuild the painter.
  const sampleSecondsRef = useRef(sampleSeconds);
  sampleSecondsRef.current = sampleSeconds;

  const named = adapter.namedParameter;
  const [sampleStart] = useParameterUnit(project, named.sampleStart);
  const [sampleEnd] = useParameterUnit(project, named.sampleEnd);
  const [loopStart] = useParameterUnit(project, named.loopStart);
  const [loopEnd] = useParameterUnit(project, named.loopEnd);
  const [loopUnit] = useParameterUnit(project, named.loop);
  const loopOn = loopUnit >= 0.5;
  const values: MarkerValues = { sampleStart, sampleEnd, loopStart, loopEnd };
  // Re-read on every render; the page re-renders this component when the sample has loaded.
  const frames = framesOf(adapter);
  const loaded = frames >= 2;
  const region = regionBounds(values, frames);
  const loop = effectiveLoop(values, frames);

  // Static layer: repaints only when something it draws has changed.
  useEffect(() => {
    const canvas = staticRef.current;
    if (!canvas) return undefined;
    const painter = new CanvasPainter(canvas, (_painter, context) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const current = readValues(adapter);
      const currentFrames = framesOf(adapter);
      const currentRegion = regionBounds(current, currentFrames);
      const regionX0 = unitToX(currentRegion.lo, width);
      const regionX1 = unitToX(currentRegion.hi, width);
      context.fillStyle = CANVAS_COLORS.bg;
      context.fillRect(0, 0, width, height);
      context.fillStyle = CANVAS_COLORS.shade;
      context.fillRect(regionX0, 0, regionX1 - regionX0, height);

      // Outside the region: dim. Inside: lit.
      context.fillStyle = CANVAS_COLORS.structural;
      drawPeaks(context, adapter, 0, regionX0, width, height);
      drawPeaks(context, adapter, regionX1, width, width, height);
      context.fillStyle = CANVAS_COLORS.amber;
      drawPeaks(context, adapter, regionX0, regionX1, width, height);

      if (adapter.namedParameter.loop.getValue() && !currentRegion.empty) {
        const currentLoop = effectiveLoop(current, currentFrames);
        const loopX0 = unitToX(currentLoop.lo, width);
        const loopX1 = unitToX(currentLoop.hi, width);
        context.globalAlpha = 0.14;
        context.fillStyle = CANVAS_COLORS.cyan;
        context.fillRect(loopX0, 0, loopX1 - loopX0, height);
        const fade = fadeUnits(adapter.namedParameter.loopFade.getValue(), sampleSecondsRef.current, currentLoop);
        const fadeWidth = fade * width;
        context.globalAlpha = 0.3;
        context.fillRect(loopX0, 0, fadeWidth, height);
        context.fillRect(loopX1 - fadeWidth, 0, fadeWidth, height);
        context.globalAlpha = 1;
      }

      // Direction arrow along the top of the region.
      if (!currentRegion.empty && regionX1 - regionX0 > 24) {
        const y = 10;
        const from = currentRegion.reversed ? regionX1 - 6 : regionX0 + 6;
        const to = currentRegion.reversed ? regionX0 + 6 : regionX1 - 6;
        const head = currentRegion.reversed ? 5 : -5;
        context.strokeStyle = CANVAS_COLORS.label;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(from, y);
        context.lineTo(to, y);
        context.lineTo(to + head, y - 4);
        context.moveTo(to, y);
        context.lineTo(to + head, y + 4);
        context.stroke();
      }
    });
    painterRef.current = painter;
    const editingSub = project.editing.subscribe(() => painter.requestUpdate());
    return () => {
      editingSub.terminate();
      painter.terminate();
      painterRef.current = null;
    };
  }, [project, adapter]);

  // Peaks arrived, or the sample changed length.
  useEffect(() => {
    painterRef.current?.requestUpdate();
  }, [peaksVersion, sampleSeconds]);

  // Playheads: drawn straight from the engine's broadcast, no React state.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    let lastPacket = 0;
    let drawn = 0;
    const clear = (): void => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      drawn = 0;
      canvas.dataset.playheads = "0";
      canvas.dataset.positions = "";
    };
    // Nothing catches a throw from a live-stream callback: it would surface about
    // fifty times a second and hold up other frame work. Contain it, log it once.
    let hasLoggedError = false;
    const sub = project.liveStreamReceiver.subscribeFloats(adapter.positionsAddress, positions => {
      try {
        lastPacket = performance.now();
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (width === 0 || height === 0) return;
        const ratio = window.devicePixelRatio || 1;
        const pixelWidth = Math.floor(width * ratio);
        const pixelHeight = Math.floor(height * ratio);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
        }
        clear();
        const fileOption = adapter.file();
        if (fileOption.isEmpty()) return;
        const dataOption = fileOption.unwrap().data;
        if (dataOption.isEmpty()) return;
        const units = positionsToUnits(positions, dataOption.unwrap().numberOfFrames);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.fillStyle = CANVAS_COLORS.playhead;
        for (const unit of units) context.fillRect(Math.round(unitToX(unit, width)), 0, 1, height);
        drawn = units.length;
        // Read by browser checks: how many heads, and where (shares of the sample).
        canvas.dataset.playheads = String(drawn);
        canvas.dataset.positions = units.map(unit => unit.toFixed(3)).join(",");
      } catch (error) {
        if (hasLoggedError) return;
        hasLoggedError = true;
        console.error("Nano demo: playhead drawing failed (logged once): " + String(error));
      }
    });
    const frame = AnimationFrame.add(() => {
      if (drawn > 0 && performance.now() - lastPacket > STALE_PLAYHEAD_MS) clear();
    });
    canvas.dataset.playheads = "0";
    return () => {
      sub.terminate();
      frame.terminate();
    };
  }, [project, adapter]);

  // Ghost marker: the modulated start, written straight to the DOM every frame.
  useEffect(() => {
    const ghost = ghostRef.current;
    if (!ghost) return undefined;
    if (ghostParameter === null) {
      ghost.style.display = "none";
      return undefined;
    }
    ghost.style.display = "block";
    const frame = AnimationFrame.add(() => {
      ghost.style.left = `${ghostParameter.getControlledUnitValue() * 100}%`;
    });
    return () => frame.terminate();
  }, [ghostParameter]);

  // One undo step per drag: the first change opens it, the rest are appended.
  const dragRef = useRef<{ id: MarkerId; pointerId: number; committed: boolean } | null>(null);

  const writeMarker = useCallback((id: MarkerId, value: number, fold: boolean) => {
    const parameter = adapter.namedParameter[id];
    const constrained = constrainMarker(id, value, readValues(adapter));
    if (Math.abs(constrained - parameter.getUnitValue()) < 1e-6) return false;
    const write = (): void => parameter.setUnitValue(constrained);
    if (fold) project.editing.append(write);
    else project.editing.modify(write);
    return true;
  }, [project, adapter]);

  // A drag belongs to the pointer that started it, and moves the marker it
  // started on, until that pointer lets go. Other pointers are ignored.
  const onPointerDown = useCallback((id: MarkerId, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const drag = dragRef.current;
    if (drag !== null && drag.pointerId !== event.pointerId) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, pointerId: event.pointerId, committed: false };
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !container || drag.pointerId !== event.pointerId) return;
    const rect = container.getBoundingClientRect();
    const changed = writeMarker(drag.id, xToUnit(event.clientX - rect.left, rect.width), drag.committed);
    if (changed) drag.committed = true;
  }, [writeMarker]);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== null && dragRef.current.pointerId === event.pointerId) dragRef.current = null;
  }, []);

  // The loop markers go away with the loop, and with them any event that would end their drag.
  useEffect(() => {
    const drag = dragRef.current;
    if (!loopOn && drag !== null && (drag.id === "loopStart" || drag.id === "loopEnd")) dragRef.current = null;
  }, [loopOn]);

  const onKeyDown = useCallback((id: MarkerId, event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = markerKeyTarget(id, event.key, event.shiftKey, readValues(adapter));
    if (target === null) return;
    event.preventDefault();
    writeMarker(id, target, false);
  }, [adapter, writeMarker]);

  // Drawing only: a loop marker stored outside the region is drawn at the
  // region's edge, where the engine puts the loop. The stored value is left
  // alone, so the Loop sliders can read differently from the markers.
  const message = regionMessage({ empty: region.empty, startIsModulated: ghostParameter !== null });
  const displayed: MarkerValues = {
    sampleStart,
    sampleEnd,
    loopStart: constrainMarker("loopStart", loopStart, values),
    loopEnd: constrainMarker("loopEnd", loopEnd, values),
  };

  return (
    <>
      <div className="nn-wave-frame">
      <div ref={containerRef} className="nn-wave">
        <canvas
          ref={staticRef}
          className="nn-wave-static"
          role="img"
          aria-label={
            `Waveform of the sample. Region ${Math.round(region.lo * 100)} to ${Math.round(region.hi * 100)} percent` +
            (region.reversed ? ", played backwards" : "") +
            (loopOn ? `. Loop ${Math.round(loop.lo * 100)} to ${Math.round(loop.hi * 100)} percent.` : ".")
          }
        />
        <canvas ref={overlayRef} className="nn-wave-overlay" aria-hidden="true" data-playheads="0" />
        <div ref={ghostRef} className="nn-ghost" aria-hidden="true" style={{ display: "none" }} />
        {MARKERS.filter(marker => loopOn || marker.edge === "top").map(marker => (
          <div
            key={marker.id}
            role="slider"
            tabIndex={0}
            className="nn-marker"
            data-marker={marker.id}
            data-tag={marker.tag}
            data-edge={marker.edge}
            aria-label={marker.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(displayed[marker.id] * 100)}
            aria-valuetext={`${(displayed[marker.id] * 100).toFixed(1)} percent`}
            style={{ left: `${displayed[marker.id] * 100}%`, "--nn-marker-color": marker.color } as React.CSSProperties}
            onPointerDown={event => onPointerDown(marker.id, event)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={event => onKeyDown(marker.id, event)}
          />
        ))}
      </div>
      </div>
      {loaded && message !== null && (
        <Callout.Root color="amber" size="1" role="status">
          <Callout.Text>{message}</Callout.Text>
        </Callout.Root>
      )}
      {loaded && loopOn && loop.degenerate && !region.empty && (
        <Text size="1" color="gray">
          The loop points leave nothing to loop inside the region, so the whole region loops.
        </Text>
      )}
    </>
  );
};
