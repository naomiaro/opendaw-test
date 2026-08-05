// Arrangement timeline: bar/section grid, one lane per track, region blocks
// with tiled waveforms, and a playhead overlay. Canvas + overlay only —
// transport controls live in the page (Task 8).
import React, { useEffect, useRef } from "react";
import { Project } from "@opendaw/studio-core";
import type { AudioRegionBoxAdapter } from "@opendaw/studio-adapters";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PPQN } from "@opendaw/lib-dsp";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { audioUnitAdapterFor } from "@/lib/adapterUtils";
import { CANVAS_COLORS, CANVAS_FONT_SMALL } from "@/lib/design/consoleTheme";
import { BPM, SECTION_BARS, SECTION_PPQN } from "./arrangement";
import type { JamTrack } from "./jamSetup";
import { drawWaveform } from "./waveform";

const HEIGHT = 200;
const LANE_COUNT = 4;
const BLOCK_RADIUS = 3;

// Traces a rounded-rect path without relying on ctx.roundRect (not in every
// lib.dom.d.ts this project's tsc resolves against).
const roundedRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number, width: number, height: number, radius: number,
): void => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
};

const regionsOf = (project: Project, track: JamTrack): AudioRegionBoxAdapter[] =>
  audioUnitAdapterFor(project, track.audioUnitBox)
    .tracks.values()[0]
    .regions.adapters.values()
    .filter(r => r.isAudioRegion());

export function ArrangementPanel({ project, tracks }: {
  project: Project;
  tracks: JamTrack[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  // Full region traversal is only cheap once per box-graph change, not once
  // per rAF tick — the playhead loop below reads this cache instead of
  // calling visiblePpqn() itself every frame.
  const visiblePpqnRef = useRef(4 * SECTION_PPQN);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    // Total visible ppqn: at least 4 sections, growing to cover every region's end.
    const visiblePpqn = (): number => {
      const ends = tracksRef.current.flatMap(t => regionsOf(project, t).map(r => r.complete));
      const sections = Math.max(4, Math.ceil(Math.max(0, ...ends) / SECTION_PPQN));
      return sections * SECTION_PPQN;
    };

    const painter = new CanvasPainter(canvas, (_painter, context) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      visiblePpqnRef.current = visiblePpqn();

      context.fillStyle = CANVAS_COLORS.bg;
      context.fillRect(0, 0, width, height);

      const currentTracks = tracksRef.current;
      const laneRegions = currentTracks.map(track => regionsOf(project, track));
      const hasRegions = laneRegions.some(regions => regions.length > 0);

      if (!hasRegions) {
        context.fillStyle = CANVAS_COLORS.label;
        context.font = CANVAS_FONT_SMALL;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("Commit a combo to start the arrangement", width / 2, height / 2);
        context.textAlign = "left";
        context.textBaseline = "alphabetic";
        return;
      }

      const totalPpqn = visiblePpqnRef.current;
      const xScale = width / totalPpqn;
      const laneHeight = height / LANE_COUNT;
      const totalBars = totalPpqn / PPQN.Bar;
      const sectionCount = totalPpqn / SECTION_PPQN;

      // Bar grid (every bar) and section boundaries (every SECTION_BARS), numbered.
      context.strokeStyle = CANVAS_COLORS.gridTertiary;
      context.lineWidth = 1;
      for (let bar = 0; bar <= totalBars; bar++) {
        if (bar % SECTION_BARS === 0) continue; // drawn as a section boundary below
        const x = Math.round(bar * PPQN.Bar * xScale) + 0.5;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }

      context.strokeStyle = CANVAS_COLORS.gridSupporting;
      context.fillStyle = CANVAS_COLORS.label;
      context.font = CANVAS_FONT_SMALL;
      context.textBaseline = "top";
      for (let section = 0; section <= sectionCount; section++) {
        const x = Math.round(section * SECTION_PPQN * xScale) + 0.5;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
        if (section < sectionCount) {
          context.fillText(String(section + 1), x + 4, 2);
        }
      }

      // One lane per track, region blocks with tiled waveform + label.
      currentTracks.forEach((track, laneIndex) => {
        const laneY = laneIndex * laneHeight;
        const blockY = laneY + 2;
        const blockHeight = laneHeight - 4;

        for (const region of laneRegions[laneIndex]) {
          const regionX = region.position * xScale;
          const regionWidth = Math.max(1, region.duration * xScale);

          roundedRectPath(context, regionX, blockY, regionWidth, blockHeight, BLOCK_RADIUS);
          context.fillStyle = CANVAS_COLORS.shade;
          context.fill();
          context.strokeStyle = track.color;
          context.lineWidth = 1;
          context.stroke();

          context.save();
          roundedRectPath(context, regionX, blockY, regionWidth, blockHeight, BLOCK_RADIUS);
          context.clip();

          // Waveform tiled per loop iteration — each loopDuration-ppqn slice
          // maps to loopDuration-worth of the buffer starting at second 0.
          const loopDuration = region.loopDuration > 0 ? region.loopDuration : region.duration;
          for (let tileStart = 0; tileStart < region.duration; tileStart += loopDuration) {
            const tileDuration = Math.min(loopDuration, region.duration - tileStart);
            drawWaveform(context, track.audioBuffer, {
              x: regionX + tileStart * xScale,
              y: blockY,
              width: Math.max(1, tileDuration * xScale),
              height: blockHeight,
              color: track.color,
              startSeconds: track.contentStartSeconds,
              durationSeconds: PPQN.pulsesToSeconds(tileDuration, BPM),
            });
          }

          context.fillStyle = CANVAS_COLORS.label;
          context.font = CANVAS_FONT_SMALL;
          context.textBaseline = "top";
          context.fillText(region.label, regionX + 4, blockY + 3);
          context.restore();
        }
      });
    });

    const editingSub = project.editing.subscribe(() => painter.requestUpdate());
    painter.requestUpdate();

    const frame = AnimationFrame.add(() => {
      const playhead = playheadRef.current;
      if (playhead === null) return;
      const position = project.engine.position.getValue();
      const total = visiblePpqnRef.current;
      if (position < 0 || position > total) {
        playhead.style.display = "none";
        return;
      }
      playhead.style.display = "block";
      playhead.style.left = `${(position / total) * canvas.clientWidth}px`;
    });

    return () => {
      frame.terminate();
      editingSub.terminate();
      painter.terminate();
    };
  }, [project]);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%", height: HEIGHT, display: "block",
          boxSizing: "border-box", border: "1px solid var(--mc-line)",
        }}
      />
      <div
        ref={playheadRef}
        style={{
          position: "absolute", top: 0, bottom: 0, width: 1,
          background: CANVAS_COLORS.playhead, pointerEvents: "none",
          display: "none", boxSizing: "border-box", border: "1px solid transparent",
        }}
      />
    </div>
  );
}
