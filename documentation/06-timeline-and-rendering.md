# Timeline & Rendering

> **Skip if:** you're familiar with PPQN-to-pixel conversion and audio rendering pipelines
> **Prerequisites:** Chapter 05 (Samples & Peaks)

## Table of Contents

- [Overview](#overview)
- [Timeline Coordinate System](#timeline-coordinate-system)
- [Building a Basic Timeline](#building-a-basic-timeline)
  - [Step 1: Define Timeline Dimensions](#step-1-define-timeline-dimensions)
  - [Step 2: Render Grid Lines](#step-2-render-grid-lines)
  - [Step 3: Render Clips](#step-3-render-clips)
  - [Step 4: Render Playhead](#step-4-render-playhead)
- [Complete Timeline Component](#complete-timeline-component)
- [Advanced Features](#advanced-features)
  - [Bar/Beat Labels](#barbeat-labels)
  - [Clip Highlighting](#clip-highlighting)
  - [Zoom and Scroll](#zoom-and-scroll)
- [Handling BPM Changes](#handling-bpm-changes)
- [Time Display Utilities](#time-display-utilities)
  - [PPQN to Bar:Beat:Tick](#ppqn-to-barbeatick)
  - [PPQN to Seconds](#ppqn-to-seconds)
- [Click and Drag Interactions](#click-and-drag-interactions)
  - [Seeking on Timeline Click](#seeking-on-timeline-click)
  - [Dragging Clips](#dragging-clips)
- [Performance Optimization](#performance-optimization)
- [Common Patterns](#common-patterns)
  - [Pattern 1: Ruler with Time Markers](#pattern-1-ruler-with-time-markers)
  - [Pattern 2: Minimap Overview](#pattern-2-minimap-overview)
- [Summary](#summary)
- [Advanced: Audio Rendering Pipeline](#advanced-audio-rendering-pipeline)
  - [The Two Coordinate Systems](#the-two-coordinate-systems)
  - [Constants](#constants)
  - [Layer 1: Core Conversions (Constant Tempo)](#layer-1-core-conversions-constant-tempo)
  - [Layer 2: Tempo Integration (Variable Tempo)](#layer-2-tempo-integration-variable-tempo)
  - [Layer 3: The Timeline Grid (PPQN-Linear)](#layer-3-the-timeline-grid-ppqn-linear)
  - [Layer 4: Waveform Rendering (Tempo-Aware)](#layer-4-waveform-rendering-tempo-aware)
  - [Layer 5: Peak Rendering (Pure Pixel Math)](#layer-5-peak-rendering-pure-pixel-math)
  - [The Complete Pipeline](#the-complete-pipeline)
  - [Two Timebase Modes for Clips](#two-timebase-modes-for-clips)

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

## Advanced: Audio Rendering Pipeline

> **Skip if:** you don't need to understand the internal render path from musical time to pixels

How a DAW converts musical positions (beats, bars) into waveform pixels on screen, handling tempo changes along the way.

### The Two Coordinate Systems

A DAW timeline has two fundamentally different ways to measure position:

**Musical time (PPQN ticks)** — measures position in beats. A quarter note is always 960 ticks (at PPQN=960), regardless of tempo. Bar 5, beat 3 is always the same tick number. The grid lines in a DAW are evenly spaced in this space.

**Real time (seconds/samples)** — measures position in wall-clock time. One second is always one second. Audio samples live in this space (48,000 samples = 1 second at 48kHz).

At a constant tempo, these two systems are proportional — converting between them is just multiplication. But when tempo changes, the relationship becomes non-linear, and the math gets interesting.

### Constants

```
PPQN (Quarter) = 960          Ticks per quarter note
Bar            = 3840          Ticks per bar (4/4 time: 4 x 960)
SemiQuaver     = 240           Ticks per sixteenth note (960 / 4)
TempoChangeGrid = 80           Integration resolution (~1/12 beat)
RenderQuantum  = 128           Audio worklet block size (samples)
```

**Why 960 PPQN?** 960 = 2^6 x 3 x 5. This gives clean integer division for common subdivisions: triplets (960/3 = 320), sixteenths (960/4 = 240), thirty-seconds (960/8 = 120). No floating-point needed for standard musical divisions.

### Layer 1: Core Conversions (Constant Tempo)

At a single tempo, converting between ticks and seconds is a simple ratio:

```
seconds = ticks x 60 / (PPQN x BPM)
ticks   = seconds x BPM x PPQN / 60
```

For example, at 120 BPM:
- 1 quarter note = 960 ticks = 960 x 60 / (960 x 120) = **0.5 seconds**
- 1 bar (4/4) = 3840 ticks = 3840 x 60 / (960 x 120) = **2.0 seconds**
- 3 seconds of audio = 3 x 120 x 960 / 60 = **5760 ticks**

To get samples, multiply seconds by the sample rate:

```
samples = ticks x 60 x sampleRate / (PPQN x BPM)
```

At 120 BPM and 48kHz: 960 ticks = 0.5 seconds = 24,000 samples.

### Layer 2: Tempo Integration (Variable Tempo)

When tempo changes mid-timeline, the simple ratio breaks. A section at 120 BPM has different seconds-per-tick than a section at 60 BPM. Converting a tick position to seconds requires **integrating** over the tempo curve — summing up the time contribution of each small segment at its local tempo.

For an intuitive explanation of why integration is needed, see [Chapter 02: Why "integration across the ramp"?](./02-timing-and-tempo.md#why-integration-across-the-ramp)

#### The Integration Algorithm

The `VaryingTempoMap` converts ticks to seconds by stepping through `TempoChangeGrid`-sized intervals (80 ticks each, approximately 10ms at typical tempos):

```
function ppqnToSeconds(targetTick):
    accumulatedSeconds = 0
    currentTick = 0

    while currentTick < targetTick:
        // Get tempo at this position
        bpm = tempoMap.getTempoAt(currentTick)

        // Step to next grid boundary (or target, whichever is closer)
        nextGrid = ceil(currentTick / 80) * 80
        segmentEnd = min(nextGrid, targetTick)
        segmentTicks = segmentEnd - currentTick

        // Convert this segment's ticks to seconds at local tempo
        segmentSeconds = segmentTicks * 60 / (960 * bpm)

        accumulatedSeconds += segmentSeconds
        currentTick = segmentEnd

    return accumulatedSeconds
```

Each step assumes constant tempo within the 80-tick window. This is a **Riemann sum** — approximating the integral of `1/tempo` over the tick range. The 80-tick grid (~10ms) provides sufficient resolution for smooth tempo automation curves.

#### Caching for Performance

The integration runs from tick 0 every time, which would be slow for positions deep in the timeline. A **cache** stores pre-computed (tick, seconds, bpm) entries at tempo event boundaries. Binary search finds the nearest cached entry, then integration continues from there.

#### The Inverse: Seconds to Ticks

Going the other direction (seconds to ticks) uses the same stepping approach, but accumulates ticks instead of seconds. When a step would overshoot the target seconds, it interpolates linearly within that segment:

```
function secondsToTicks(targetSeconds):
    accumulatedSeconds = 0
    accumulatedTicks = 0

    while accumulatedSeconds < targetSeconds:
        bpm = tempoMap.getTempoAt(accumulatedTicks)
        segmentTicks = 80  // TempoChangeGrid
        segmentSeconds = segmentTicks * 60 / (960 * bpm)

        if accumulatedSeconds + segmentSeconds >= targetSeconds:
            // Overshoot — interpolate within this segment
            remainingSeconds = targetSeconds - accumulatedSeconds
            accumulatedTicks += remainingSeconds * bpm * 960 / 60
            break

        accumulatedSeconds += segmentSeconds
        accumulatedTicks += segmentTicks

    return accumulatedTicks
```

### Layer 3: The Timeline Grid (PPQN-Linear)

The grid, ruler, and beat markers use a simple **linear** mapping from ticks to pixels:

```
pixel = (tick - viewportStartTick) / ticksPerPixel
tick  = pixel * ticksPerPixel + viewportStartTick
```

This is intentionally NOT tempo-aware. Every beat is the same pixel width. Every bar is the same pixel width. The grid is uniform in musical space.

This is the correct behavior — when a musician looks at a timeline in "bars & beats" mode, they expect beat 1 of every bar to be equally spaced, regardless of whether the tempo is accelerating or decelerating.

### Layer 4: Waveform Rendering (Tempo-Aware)

This is where it gets interesting. The waveform renderer needs to show audio content aligned to the tick-linear grid. At a constant tempo, this is trivial — the audio's sample positions map linearly to tick positions. But at tempo changes, the same number of audio samples maps to different pixel widths depending on the local tempo.

#### The Rendering Loop

The `AudioRenderer` iterates the clip's PPQN range in steps, computing the audio sample range for each step:

```
function renderAudioClip(clip, tempoMap, viewport):
    // Step size: at least 1 pixel wide, aligned to TempoChangeGrid
    minStep = viewport.ticksPerPixel * devicePixelRatio
    stepSize = max(80, ceil(minStep / 80) * 80)

    // Starting audio time
    regionStartSeconds = tempoMap.ppqnToSeconds(clip.startTick)
    currentTick = clip.startTick
    currentAudioTime = waveformOffset  // where playback starts in the audio file

    while currentTick < clip.endTick:
        nextTick = currentTick + stepSize

        // KEY: Duration depends on LOCAL TEMPO
        localBPM = tempoMap.getTempoAt(currentTick)
        stepSeconds = stepSize * 60 / (960 * localBPM)
        nextAudioTime = currentAudioTime + stepSeconds

        // Convert to pixel coordinates (linear in tick space)
        x0 = tickToPixel(currentTick)
        x1 = tickToPixel(nextTick)

        // Convert to audio sample coordinates
        u0 = currentAudioTime * sampleRate
        u1 = nextAudioTime * sampleRate

        // Render this segment's peaks
        renderPixelStrips(canvas, peaks, { x0, x1, u0, u1, ... })

        currentTick = nextTick
        currentAudioTime = nextAudioTime
```

**The critical insight:** Each step maps a fixed PPQN width (uniform pixels) to a variable audio time (depends on local tempo). When tempo is fast, more audio samples fit into the same pixel width. When tempo is slow, fewer samples fit.

#### What This Looks Like

At a tempo change from 120 BPM to 60 BPM:

```
                    Tempo change here
                          |
    120 BPM               |        60 BPM
    |----|----|----|----|----|----|----|----| Grid (uniform)
    |████████████████████|████|████|████|████| Waveform

    <-- same audio per beat --> <-- 2x audio per beat -->
```

Before the tempo change, each beat-width shows 0.5 seconds of audio. After, each beat-width shows 1.0 seconds of audio (because at 60 BPM, a beat IS 1 second). The waveform appears "compressed" after the tempo change — more audio content packed into the same visual beat width.

### Layer 5: Peak Rendering (Pure Pixel Math)

The lowest level — `renderPixelStrips` — knows nothing about tempo, ticks, or music. It receives a pre-computed **layout**:

```
Layout:
    x0, x1 — screen pixel range (horizontal)
    y0, y1 — screen pixel range (vertical)
    u0, u1 — audio sample range
    v0, v1 — audio value range (-1.0 to +1.0)
```

Its job: for each pixel column from x0 to x1, find the min/max audio values in the corresponding sample range and draw a vertical line.

#### The Peak Aggregation Math

Audio data is pre-processed into a multi-resolution peak cache. Each "stage" stores min/max pairs at increasing compression ratios (1x, 2x, 4x, 8x... samples per peak entry).

For a given zoom level, the renderer:

1. **Selects the appropriate stage** — the coarsest one where each peak entry covers fewer samples than one pixel width

2. **Computes peaks per pixel:**
   ```
   samplesPerPixel = (u1 - u0) / (x1 - x0)
   peaksPerPixel = samplesPerPixel / stage.samplesPerPeak
   ```

3. **For each pixel column**, aggregates all peak entries that fall within that pixel's sample range:
   ```
   for each pixel x from x0 to x1:
       peakStart = currentIndex
       peakEnd = currentIndex + peaksPerPixel

       min = MIN of all peak.min values in [peakStart, peakEnd]
       max = MAX of all peak.max values in [peakStart, peakEnd]

       yMin = map(min, valueRange, pixelRange)
       yMax = map(max, valueRange, pixelRange)

       fillRect(x, yMin, 1, yMax - yMin)
   ```

4. **Min/max swap trick**: After drawing each pixel, the previous max becomes the new min seed and vice versa. This ensures visual continuity between adjacent pixels — if the waveform crosses zero between two pixels, the connecting line is still drawn.

#### Peak Data Format

Peaks are stored as packed Int32 values, each containing two Float16 numbers (min and max):

```
bits[0:15]  = Float16(min value)   // Lower 16 bits
bits[16:31] = Float16(max value)   // Upper 16 bits
```

This halves memory usage compared to storing two Float32 values per peak entry, which matters for long audio files at high resolution.

### The Complete Pipeline

Putting it all together, here's how a pixel on screen traces back to audio data:

```
User sees: pixel at x=500 on screen

Timeline viewport:
    tickAtPixel = 500 * ticksPerPixel + viewportStart
    = 500 * 24 + 0 = tick 12000

Tempo integration (if needed):
    secondsAtTick = tempoMap.ppqnToSeconds(12000)
    = integral of (60 / PPQN / BPM) from 0 to 12000
    = 6.25 seconds (at 120 BPM constant)

Audio renderer (per tempo segment):
    audioTimeAtTick = secondsAtTick - regionStart + waveformOffset
    sampleAtTick = audioTimeAtTick * 48000

Peak renderer:
    peakIndex = sampleAtTick / stage.samplesPerPeak
    min, max = peaks[peakIndex]
    yMin = map(min, [-1, 1], [0, height])
    yMax = map(max, [-1, 1], [0, height])

    Draw vertical line from yMin to yMax at x=500
```

### Two Timebase Modes for Clips

Audio clips can operate in two modes:

#### Musical Timebase

Position and duration stored in PPQN ticks. The clip stays at the same bar/beat position regardless of tempo. When tempo changes, the clip's real-time duration changes (faster tempo = shorter real time), but its musical position is fixed.

Use case: drum loops, synth patterns, anything composed to fit specific bars.

#### Seconds Timebase

Position stored in PPQN (for grid alignment), but duration stored in seconds. When tempo changes, the clip's PPQN duration is **recomputed** by integrating over the tempo curve at the clip's position. The same 4-second clip takes fewer beats at high tempo and more beats at low tempo.

Use case: sound effects, dialogue, field recordings — audio with a fixed real-time duration that shouldn't stretch with tempo.

#### Conversion Between Timebases

The conversion is **position-dependent** when tempo varies:

```
// Seconds timebase: convert duration to PPQN at a specific position
function durationToPPQN(durationSeconds, positionTick):
    startSeconds = tempoMap.ppqnToSeconds(positionTick)
    endSeconds = startSeconds + durationSeconds
    endTick = tempoMap.secondsToPPQN(endSeconds)
    return endTick - positionTick
```

At 120 BPM: 4 seconds = 7680 ticks (8 beats).
At 60 BPM: 4 seconds = 3840 ticks (4 beats).
At a tempo ramp from 120 to 60 BPM: 4 seconds = somewhere between 3840 and 7680 ticks, determined by integration.
