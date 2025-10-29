# Timeline Rendering with PPQN

## Overview

A DAW timeline shows:
- **Grid lines** for bars and beats
- **Audio/MIDI clips** at musical positions
- **Playhead** showing current position
- **Track lanes** separating different instruments

All of this uses PPQN for positioning.

## Timeline Coordinate System

```
PPQN (Musical Time)          Pixels (Screen Space)
─────────────────────        ──────────────────────
0                            0
│                            │
Quarter (960)                x pixels (depends on zoom)
│                            │
Quarter * 2 (1920)          2x pixels
│                            │
Quarter * 4 (3840)          4x pixels (one bar)
```

**Conversion formula:**
```typescript
pixels = (ppqnPosition / totalPPQNDuration) * timelineWidthInPixels
```

## Building a Basic Timeline

### Step 1: Define Timeline Dimensions

```typescript
import { PPQN } from "@opendaw/lib-dsp";
const { Quarter } = PPQN;

// Timeline configuration
const BARS = 4;
const BEATS_PER_BAR = 4;
const TOTAL_BEATS = BARS * BEATS_PER_BAR;  // 16 beats
const totalDuration = BARS * BEATS_PER_BAR * Quarter;  // 15,360 PPQN

// Visual dimensions
const timelineWidth = 800;   // pixels
const trackHeight = 90;      // pixels per track
const numTracks = 4;
```

### Step 2: Render Grid Lines

```typescript
function renderGrid() {
  // Beat lines
  for (let beat = 0; beat <= TOTAL_BEATS; beat++) {
    const ppqnPosition = beat * Quarter;
    const x = (ppqnPosition / totalDuration) * timelineWidth;

    // Is this a measure line (every 4 beats)?
    const isMeasure = beat % BEATS_PER_BAR === 0;

    return (
      <line
        key={beat}
        x1={x}
        y1={0}
        x2={x}
        y2={numTracks * trackHeight}
        stroke={isMeasure ? "#555" : "#333"}
        strokeWidth={isMeasure ? 2 : 1}
      />
    );
  }
}
```

### Step 3: Render Clips

```typescript
type Clip = {
  trackIndex: number;
  position: number;    // in PPQN
  duration: number;    // in PPQN
  color: string;
  label: string;
};

function renderClip(clip: Clip) {
  // Convert PPQN to pixels
  const x = (clip.position / totalDuration) * timelineWidth;
  const width = (clip.duration / totalDuration) * timelineWidth;

  // Calculate vertical position
  const y = clip.trackIndex * trackHeight;

  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={trackHeight - 10}  // padding
      fill={clip.color}
      rx={3}  // rounded corners
    />
  );
}
```

### Step 4: Render Playhead

```typescript
function renderPlayhead(currentPosition: number, isPlaying: boolean) {
  if (!isPlaying) return null;

  const x = (currentPosition / totalDuration) * timelineWidth;

  return (
    <line
      x1={x}
      y1={0}
      x2={x}
      y2={numTracks * trackHeight}
      stroke="#fff"
      strokeWidth={2}
    />
  );
}
```

## Complete Timeline Component

```typescript
import React, { useState, useEffect } from "react";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";

const { Quarter } = PPQN;

interface TimelineProps {
  project: Project;
  clips: Clip[];
  tracks: string[];
}

function Timeline({ project, clips, tracks }: TimelineProps) {
  const [currentPosition, setCurrentPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const BARS = 4;
  const BEATS_PER_BAR = 4;
  const TOTAL_BEATS = BARS * BEATS_PER_BAR;
  const totalDuration = BARS * BEATS_PER_BAR * Quarter;
  const timelineWidth = 800;
  const trackHeight = 90;

  // Subscribe to playback state
  useEffect(() => {
    const playingSub = project.engine.isPlaying.subscribe(obs => {
      setIsPlaying(obs.getValue());
    });

    return () => playingSub.terminate();
  }, [project]);

  // Subscribe to position (throttled with AnimationFrame)
  useEffect(() => {
    const positionSub = AnimationFrame.add(() => {
      setCurrentPosition(project.engine.position.getValue());
    });

    return () => positionSub.terminate();
  }, [project]);

  return (
    <svg
      width={timelineWidth}
      height={tracks.length * trackHeight}
      style={{ background: "#1a1a1a" }}
    >
      {/* Grid lines */}
      {Array.from({ length: TOTAL_BEATS + 1 }, (_, beat) => {
        const x = (beat * Quarter / totalDuration) * timelineWidth;
        const isMeasure = beat % BEATS_PER_BAR === 0;

        return (
          <line
            key={`grid-${beat}`}
            x1={x}
            y1={0}
            x2={x}
            y2={tracks.length * trackHeight}
            stroke={isMeasure ? "#555" : "#333"}
            strokeWidth={isMeasure ? 2 : 1}
          />
        );
      })}

      {/* Track separators */}
      {tracks.map((_, i) => (
        <line
          key={`track-${i}`}
          x1={0}
          y1={(i + 1) * trackHeight}
          x2={timelineWidth}
          y2={(i + 1) * trackHeight}
          stroke="#333"
          strokeWidth={1}
        />
      ))}

      {/* Track labels */}
      {tracks.map((track, i) => (
        <text
          key={`label-${i}`}
          x={8}
          y={i * trackHeight + 20}
          fill="#fff"
          fontSize="14"
          fontWeight="bold"
        >
          {track}
        </text>
      ))}

      {/* Clips */}
      {clips.map((clip, i) => {
        const x = (clip.position / totalDuration) * timelineWidth;
        const width = Math.max(4, (clip.duration / totalDuration) * timelineWidth);
        const y = tracks.indexOf(clip.trackName) * trackHeight + 25;
        const height = trackHeight - 30;

        return (
          <rect
            key={`clip-${i}`}
            x={x}
            y={y}
            width={width}
            height={height}
            fill={clip.color}
            rx={3}
            opacity={0.8}
          />
        );
      })}

      {/* Playhead */}
      {isPlaying && (
        <line
          x1={(currentPosition / totalDuration) * timelineWidth}
          y1={0}
          x2={(currentPosition / totalDuration) * timelineWidth}
          y2={tracks.length * trackHeight}
          stroke="#fff"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
```

## Advanced Features

### Bar/Beat Labels

Show bar numbers below the timeline:

```typescript
function renderBarLabels() {
  return Array.from({ length: BARS }, (_, barIndex) => {
    const x = (barIndex * BEATS_PER_BAR * Quarter / totalDuration) * timelineWidth;
    const width = (BEATS_PER_BAR * Quarter / totalDuration) * timelineWidth;

    return (
      <div
        key={barIndex}
        style={{
          position: "absolute",
          left: `${x}px`,
          width: `${width}px`,
          height: "32px",
          display: "flex",
          alignItems: "center",
          paddingLeft: "8px",
          backgroundColor: barIndex % 2 === 0 ? "var(--gray-3)" : "var(--gray-4)",
          borderLeft: "2px solid var(--gray-6)"
        }}
      >
        <span>Bar {barIndex + 1}</span>
      </div>
    );
  });
}
```

### Clip Highlighting

Light up clips when they're playing:

```typescript
function renderClip(clip: Clip, currentPosition: number, isPlaying: boolean) {
  const x = (clip.position / totalDuration) * timelineWidth;
  const width = (clip.duration / totalDuration) * timelineWidth;
  const y = tracks.indexOf(clip.trackName) * trackHeight + 25;
  const height = trackHeight - 30;

  // Check if playhead is inside this clip
  const isActive = isPlaying &&
    currentPosition >= clip.position &&
    currentPosition < clip.position + clip.duration;

  return (
    <g key={`clip-${clip.id}`}>
      {/* Glow effect when active */}
      {isActive && (
        <rect
          x={x - 2}
          y={y - 2}
          width={width + 4}
          height={height + 4}
          fill={clip.color}
          rx={5}
          opacity={0.4}
          filter="url(#glow)"
        />
      )}

      {/* Main clip */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={clip.color}
        rx={3}
        opacity={isActive ? 1.0 : 0.8}
      />
    </g>
  );
}

// Add glow filter definition
<defs>
  <filter id="glow">
    <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
    <feMerge>
      <feMergeNode in="coloredBlur"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
</defs>
```

### Zoom and Scroll

To implement zoom/scroll, adjust the PPQN range:

```typescript
interface ViewportState {
  startPPQN: number;   // Start of visible area
  endPPQN: number;     // End of visible area
}

function renderWithViewport(viewport: ViewportState) {
  const visibleDuration = viewport.endPPQN - viewport.startPPQN;

  // Convert clip position to pixels relative to viewport
  const x = ((clip.position - viewport.startPPQN) / visibleDuration) * timelineWidth;
  const width = (clip.duration / visibleDuration) * timelineWidth;

  // Only render if visible
  const isVisible =
    clip.position + clip.duration > viewport.startPPQN &&
    clip.position < viewport.endPPQN;

  if (!isVisible) return null;

  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={clip.color}
    />
  );
}
```

## Handling BPM Changes

When BPM changes, only clip **durations** need updating - not positions!

```typescript
function handleBpmChange(newBpm: number) {
  project.editing.modify(() => {
    // Update timeline BPM
    project.timelineBox.bpm.setValue(newBpm);

    // Recalculate clip durations (NoSync mode)
    clips.forEach(clip => {
      const newDuration = PPQN.secondsToPulses(clip.audioDuration, newBpm);
      clip.region.duration.setValue(newDuration);
      clip.region.loopDuration.setValue(newDuration);
    });
  });

  // Update visual clip durations
  const updatedClips = clipTemplates.map(template => ({
    ...template,
    duration: PPQN.secondsToPulses(template.audioDuration, newBpm)
  }));

  setClips(updatedClips);
}
```

**Why?**
- **Positions** are musical (beat 1, beat 2) - never change
- **Durations** are temporal (0.5 seconds of audio) - must recalculate in PPQN

## Time Display Utilities

### PPQN to Bar:Beat:Tick

```typescript
function ppqnToBarBeatTick(ppqn: number): string {
  const parts = PPQN.toParts(ppqn);

  return `${parts.bars + 1}:${parts.beats + 1}:${parts.ticks}`;
}

// Examples:
ppqnToBarBeatTick(0);       // "1:1:0" (bar 1, beat 1)
ppqnToBarBeatTick(960);     // "1:2:0" (bar 1, beat 2)
ppqnToBarBeatTick(3840);    // "2:1:0" (bar 2, beat 1)
```

### PPQN to Seconds

```typescript
function ppqnToSeconds(ppqn: number, bpm: number): number {
  return PPQN.pulsesToSeconds(ppqn, bpm);
}

// At 120 BPM:
ppqnToSeconds(960, 120);   // 0.5 seconds
ppqnToSeconds(1920, 120);  // 1.0 second
```

## Click and Drag Interactions

### Seeking on Timeline Click

```typescript
function handleTimelineClick(event: React.MouseEvent<SVGSVGElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const clickX = event.clientX - rect.left;

  // Convert pixels to PPQN
  const clickedPosition = (clickX / timelineWidth) * totalDuration;

  // Seek to position
  project.engine.setPosition(clickedPosition);
}
```

### Dragging Clips

```typescript
function handleClipDrag(clip: Clip, deltaX: number) {
  // Convert pixel delta to PPQN
  const deltaPPQN = (deltaX / timelineWidth) * totalDuration;

  // Snap to grid (optional)
  const snapUnit = Quarter / 4; // Snap to 16th notes
  const newPosition = Math.round((clip.position + deltaPPQN) / snapUnit) * snapUnit;

  // Update clip position
  project.editing.modify(() => {
    clip.region.position.setValue(newPosition);
  });
}
```

## Performance Optimization

### 1. Virtual Rendering

Only render visible clips:

```typescript
const visibleClips = clips.filter(clip => {
  const clipEnd = clip.position + clip.duration;
  return clipEnd > viewport.start && clip.position < viewport.end;
});
```

### 2. Throttle Position Updates

Use AnimationFrame to limit updates to 60fps:

```typescript
const positionSub = AnimationFrame.add(() => {
  setCurrentPosition(project.engine.position.getValue());
});
```

### 3. Memoize Calculations

Cache expensive conversions:

```typescript
const clipRects = useMemo(() => {
  return clips.map(clip => ({
    x: (clip.position / totalDuration) * timelineWidth,
    width: (clip.duration / totalDuration) * timelineWidth,
    y: tracks.indexOf(clip.trackName) * trackHeight,
    height: trackHeight - 30
  }));
}, [clips, totalDuration, timelineWidth, trackHeight]);
```

## Common Patterns

### Pattern 1: Ruler with Time Markers

```typescript
function TimeRuler({ totalDuration, width }: RulerProps) {
  const numBeats = Math.floor(totalDuration / Quarter);

  return (
    <div style={{ width, height: 30, position: "relative" }}>
      {Array.from({ length: numBeats + 1 }, (_, beat) => {
        const x = (beat * Quarter / totalDuration) * width;

        return (
          <div
            key={beat}
            style={{
              position: "absolute",
              left: x,
              top: 0,
              height: "100%",
              borderLeft: "1px solid #666"
            }}
          >
            <span style={{ fontSize: 10 }}>{beat + 1}</span>
          </div>
        );
      })}
    </div>
  );
}
```

### Pattern 2: Minimap Overview

```typescript
function TimelineMinimap({ clips, currentPosition }: MinimapProps) {
  const minimapWidth = 200;
  const minimapHeight = 40;

  return (
    <svg width={minimapWidth} height={minimapHeight}>
      {/* All clips (tiny) */}
      {clips.map(clip => {
        const x = (clip.position / totalDuration) * minimapWidth;
        const width = (clip.duration / totalDuration) * minimapWidth;

        return (
          <rect
            key={clip.id}
            x={x}
            y={5}
            width={Math.max(1, width)}
            height={minimapHeight - 10}
            fill={clip.color}
            opacity={0.6}
          />
        );
      })}

      {/* Playhead indicator */}
      <line
        x1={(currentPosition / totalDuration) * minimapWidth}
        y1={0}
        x2={(currentPosition / totalDuration) * minimapWidth}
        y2={minimapHeight}
        stroke="red"
        strokeWidth={2}
      />
    </svg>
  );
}
```

## Summary

Timeline rendering with PPQN:
1. **Define dimensions** - bars, beats, tracks, pixels
2. **Convert PPQN → pixels** - `(ppqn / totalDuration) * width`
3. **Render grid** - beat and bar lines
4. **Render clips** - positioned and sized by PPQN
5. **Render playhead** - current position indicator
6. **Handle interactions** - clicks, drags, seeking
7. **Optimize** - virtual rendering, throttling, memoization

Key formula:
```typescript
pixels = (ppqnPosition / totalPPQNDuration) * timelineWidthInPixels
```

Remember:
- Clip **positions** are musical (don't change with BPM)
- Clip **durations** are temporal (recalculate when BPM changes)
- Use AnimationFrame for smooth position updates

## Next Steps

Continue to **Putting It All Together** for a complete working example combining all concepts.
