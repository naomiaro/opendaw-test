// Clip launcher grid: scene-launch header row + one row per track, each with
// CLIP_COLUMNS.length cells. Mini waveform per cell, live blink while
// "waiting" and a per-frame progress strip while "playing" — no setState in
// the frame loop, direct DOM via refs (repo rule, CLAUDE.md "AnimationFrame
// Overlays: Direct DOM, Not setState").
import React, { useEffect, useRef } from "react";
import { Project } from "@opendaw/studio-core";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PPQN } from "@opendaw/lib-dsp";
import { BPM, barSeconds } from "./arrangement";
import { CLIP_COLUMNS, type JamClip, type JamTrack } from "./jamSetup";
import type { ClipStateMap } from "./clipStates";
import { drawWaveform } from "./waveform";

const CELL_WIDTH = 132;
const CELL_HEIGHT = 56;
// .clip-cell is border-box with a 1px border + 4px padding on each side, so
// the canvas's rendered content box is CELL_WIDTH minus that 10px — draw at
// that size or the backing store (CELL_WIDTH) gets squeezed down to fit.
const CELL_CANVAS_WIDTH = CELL_WIDTH - 2 * (1 + 4);

function ClipCell({ project, track, clip, state, onLaunch }: {
  project: Project;
  track: JamTrack;
  clip: JamClip;
  state: "waiting" | "playing" | undefined;
  onLaunch: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawWaveform(ctx, track.audioBuffer, {
      x: 0, y: 0, width: canvas.width, height: canvas.height,
      color: track.color,
      startSeconds: track.contentStartSeconds,
      durationSeconds: clip.bars * barSeconds(BPM),
    });
  }, [track, clip]);

  const handleClick = () => {
    if (state === "playing") {
      project.engine.scheduleClipStop([track.trackBox.address.uuid]);
    } else {
      onLaunch();
      project.engine.scheduleClipPlay([clip.box.address.uuid]);
    }
  };

  return (
    <button
      type="button"
      className={`clip-cell${state ? ` clip-cell--${state}` : ""}`}
      style={{ "--cell-color": track.color } as React.CSSProperties}
      data-clip={clip.uuidString}
      onClick={handleClick}
      aria-label={`${track.name} ${clip.bars}-bar clip: ${
        state === "playing" ? "stop track" : "launch"}`}
    >
      <canvas ref={canvasRef} width={CELL_CANVAS_WIDTH} height={CELL_HEIGHT} />
      <span className="clip-cell__bars">{clip.bars} bar{clip.bars > 1 ? "s" : ""}</span>
      <span className="clip-cell__progress" />
    </button>
  );
}

export function ClipGrid({ project, tracks, clipStates, onLaunch }: {
  project: Project;
  tracks: JamTrack[];
  clipStates: ClipStateMap;
  onLaunch: () => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);

  // One frame loop drives every playing cell's --progress (direct DOM, no setState).
  useEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;
    const clipByUuid = new Map<string, JamClip>(
      tracks.flatMap(t => t.clips.map(c => [c.uuidString, c] as const)),
    );
    const frame = AnimationFrame.add(() => {
      const position = project.engine.position.getValue();
      grid.querySelectorAll<HTMLElement>(".clip-cell--playing").forEach(el => {
        const clip = clipByUuid.get(el.dataset.clip ?? "");
        if (clip === undefined) return;
        const loopPpqn = clip.bars * PPQN.Bar;
        const progress = ((position % loopPpqn) + loopPpqn) % loopPpqn / loopPpqn;
        el.style.setProperty("--progress", progress.toFixed(4));
      });
    });
    return () => frame.terminate();
  }, [project, tracks]);

  const launchScene = (column: number) => {
    onLaunch();
    project.engine.scheduleClipPlay(
      tracks.map(t => t.clips[column].box.address.uuid),
    );
  };

  const stopAll = () =>
    project.engine.scheduleClipStop(tracks.map(t => t.trackBox.address.uuid));

  return (
    <div className="clip-grid" ref={gridRef}>
      <div className="clip-grid__header">
        <span className="clip-grid__corner" />
        {CLIP_COLUMNS.map((bars, column) => (
          <button
            key={column}
            type="button"
            className="clip-grid__btn"
            onClick={() => launchScene(column)}
          >
            ▶ Scene {column + 1}
          </button>
        ))}
        <button
          type="button"
          className="clip-grid__btn clip-grid__btn--stop"
          onClick={stopAll}
        >
          ■ Stop clips
        </button>
      </div>
      {tracks.map(track => (
        <div key={track.name} className="clip-grid__row">
          <span className="clip-grid__name" style={{ color: track.color }}>
            {track.name}
          </span>
          {track.clips.map(clip => (
            <ClipCell
              key={clip.uuidString}
              project={project}
              track={track}
              clip={clip}
              state={clipStates.get(clip.uuidString)}
              onLaunch={onLaunch}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Injected by the page alongside CONSOLE_STYLES (src/lib/design/consoleTheme.ts).
// Button idiom mirrors the repo's console card grid (see neon-demo.tsx .ne-card):
// monospace labels, --mc-panel background, --mc-line border, no bright fills.
export const CLIP_GRID_STYLES = `
.clip-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.clip-grid__header,
.clip-grid__row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.clip-grid__corner,
.clip-grid__name {
  flex: 0 0 88px;
  min-width: 0;
}
.clip-grid__name {
  font-family: var(--mc-mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clip-grid__btn {
  font-family: var(--mc-mono);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--mc-text);
  background: var(--mc-panel);
  border: 1px solid var(--mc-line);
  border-radius: 4px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
}
.clip-grid__btn:hover { background: var(--mc-panel-hover); }
.clip-grid__btn:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: 2px; }
.clip-grid__btn--stop { margin-left: auto; border-color: var(--mc-line-bright); }
.clip-grid__btn--stop:hover { border-color: var(--mc-rose); }

.clip-cell {
  position: relative;
  box-sizing: border-box;
  flex: 0 0 ${CELL_WIDTH}px;
  width: ${CELL_WIDTH}px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  background: var(--mc-panel);
  border: 1px solid var(--mc-line);
  border-radius: 4px;
  padding: 4px;
  overflow: hidden;
  cursor: pointer;
  font: inherit;
  color: var(--mc-text);
  transition: background 160ms ease, border-color 160ms ease;
}
.clip-cell canvas {
  display: block;
  width: 100%;
  height: ${CELL_HEIGHT}px;
  border-radius: 2px;
}
.clip-cell:hover { background: var(--mc-panel-hover); }
.clip-cell:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: 2px; }
.clip-cell__bars {
  margin-top: 3px;
  font-family: var(--mc-mono);
  font-size: 10px;
  color: var(--mc-muted);
}
.clip-cell__progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  width: 0;
  background: var(--cell-color, var(--mc-amber));
}
.clip-cell--playing .clip-cell__progress {
  width: calc(var(--progress, 0) * 100%);
}
.clip-cell--playing {
  border-color: var(--cell-color, var(--mc-amber));
}
.clip-cell--waiting {
  animation: clip-cell-blink 600ms ease-in-out infinite;
}
@keyframes clip-cell-blink {
  0%, 100% { border-color: var(--mc-line); }
  50% { border-color: var(--mc-amber); }
}
@media (prefers-reduced-motion: reduce) {
  .clip-cell--waiting {
    animation: none;
    border-color: var(--mc-amber);
  }
}
`;
