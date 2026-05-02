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
- [Advanced: Audio Rendering Pipeline](#advanced-audio-rendering-pipeline)
  - [The Timeline Grid (PPQN-Linear)](#the-timeline-grid-ppqn-linear)
  - [Waveform Rendering (Tempo-Aware)](#waveform-rendering-tempo-aware)
  - [Peak Rendering (Pure Pixel Math)](#peak-rendering-pure-pixel-math)
  - [The Complete Pipeline](#the-complete-pipeline)

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

Read bar layout from the SDK's `signatureTrack.iterateAll()` — this works with any time signature (defaults to 4/4):

```typescript
import { PPQN } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";

const { Quarter } = PPQN;

type BarInfo = {
  startPpqn: ppqn;
  durationPpqn: ppqn;
  nominator: number;
  denominator: number;
  barNumber: number;
};

// Read bar layout from SDK state (works with any time signature)
function computeBarsFromSDK(project: Project): BarInfo[] {
  const signatureTrack = project.timelineBoxAdapter.signatureTrack;
  const totalPpqn = project.timelineBox.durationInPulses.getValue();
  const sections = Array.from(signatureTrack.iterateAll());
  const bars: BarInfo[] = [];
  let barNumber = 1;

  for (let s = 0; s < sections.length; s++) {
    const { accumulatedPpqn: sectionStart, nominator, denominator } = sections[s];
    const sectionEnd = (s + 1 < sections.length)
      ? sections[s + 1].accumulatedPpqn
      : totalPpqn;
    const barDuration = PPQN.fromSignature(nominator, denominator);

    for (let pos = sectionStart; pos < sectionEnd; pos += barDuration) {
      bars.push({
        startPpqn: pos as ppqn,
        durationPpqn: barDuration as ppqn,
        nominator, denominator,
        barNumber: barNumber++,
      });
    }
  }

  return bars;
}

// Visual dimensions
const timelineWidth = 800;   // pixels
const trackHeight = 90;      // pixels per track
```

### Step 2: Render Grid Lines

Iterate bars from the SDK, then render beat lines within each bar:

```typescript
function renderGrid(bars: BarInfo[], totalDuration: number) {
  const lines: JSX.Element[] = [];

  bars.forEach(bar => {
    const beatDuration = bar.durationPpqn / bar.nominator;

    for (let beat = 0; beat < bar.nominator; beat++) {
      const ppqnPosition = bar.startPpqn + beat * beatDuration;
      const x = (ppqnPosition / totalDuration) * timelineWidth;
      const isMeasure = beat === 0;

      lines.push(
        <line
          key={`${bar.barNumber}-${beat}`}
          x1={x}
          y1={0}
          x2={x}
          y2={numTracks * trackHeight}
          stroke={isMeasure ? "#555" : "#333"}
          strokeWidth={isMeasure ? 2 : 1}
        />
      );
    }
  });

  return lines;
}
```

### Step 3: Render Clips

```typescript
type Clip = {
  trackIndex: number;
  trackName: string;
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

  // Read bar layout from SDK (works with any time signature)
  const bars = computeBarsFromSDK(project);
  const totalDuration = project.timelineBox.durationInPulses.getValue();
  const timelineWidth = 800;
  const trackHeight = 90;

  // Subscribe to playback state (catchup to get initial value)
  useEffect(() => {
    const playingSub = project.engine.isPlaying.catchupAndSubscribe(obs => {
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
      {/* Grid lines — iterates bars from SDK, then beats within each bar */}
      {bars.flatMap(bar => {
        const beatDuration = bar.durationPpqn / bar.nominator;

        return Array.from({ length: bar.nominator }, (_, beat) => {
          const ppqnPos = bar.startPpqn + beat * beatDuration;
          const x = (ppqnPos / totalDuration) * timelineWidth;
          const isMeasure = beat === 0;

          return (
            <line
              key={`grid-${bar.barNumber}-${beat}`}
              x1={x}
              y1={0}
              x2={x}
              y2={tracks.length * trackHeight}
              stroke={isMeasure ? "#555" : "#333"}
              strokeWidth={isMeasure ? 2 : 1}
            />
          );
        });
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
function renderBarLabels(bars: BarInfo[], totalDuration: number) {
  return bars.map(bar => {
    const x = (bar.startPpqn / totalDuration) * timelineWidth;
    const width = (bar.durationPpqn / totalDuration) * timelineWidth;

    return (
      <div
        key={bar.barNumber}
        style={{
          position: "absolute",
          left: `${x}px`,
          width: `${width}px`,
          height: "32px",
          display: "flex",
          alignItems: "center",
          paddingLeft: "8px",
          backgroundColor: bar.barNumber % 2 === 1 ? "var(--gray-3)" : "var(--gray-4)",
          borderLeft: "2px solid var(--gray-6)"
        }}
      >
        <span>Bar {bar.barNumber}</span>
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
      const newDuration = Math.round(PPQN.secondsToPulses(clip.audioDuration, newBpm));
      clip.region.duration.setValue(newDuration);
      clip.region.loopDuration.setValue(newDuration);
    });
  });

  // Update visual clip durations
  const updatedClips = clipTemplates.map(template => ({
    ...template,
    duration: Math.round(PPQN.secondsToPulses(template.audioDuration, newBpm))
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
// toParts returns { bars, beats, semiquavers, ticks }
// Optional params: toParts(ppqn, nominator = 4, denominator = 4)
function ppqnToBarBeatTick(ppqn: number): string {
  const parts = PPQN.toParts(ppqn);

  return `${parts.bars + 1}:${parts.beats + 1}:${parts.semiquavers + 1}:${parts.ticks}`;
}

// Or use the built-in string formatter:
PPQN.toString(0);       // "1.1.1:0" (bar.beat.semiquaver:tick)
PPQN.toString(960);     // "1.2.1:0"
PPQN.toString(3840);    // "2.1.1:0"
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

  // Convert pixels to PPQN (round to integer — position is Int32)
  const clickedPosition = Math.round((clickX / timelineWidth) * totalDuration);

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
function TimeRuler({ bars, totalDuration, width }: RulerProps) {
  return (
    <div style={{ width, height: 30, position: "relative" }}>
      {bars.map(bar => {
        const x = (bar.startPpqn / totalDuration) * width;

        return (
          <div
            key={bar.barNumber}
            style={{
              position: "absolute",
              left: x,
              top: 0,
              height: "100%",
              borderLeft: "1px solid #666"
            }}
          >
            <span style={{ fontSize: 10 }}>{bar.barNumber}</span>
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

## Advanced: Audio Rendering Pipeline

> **Skip if:** you don't need to understand the internal render path from musical time to pixels
>
> **Prerequisites:** [Chapter 02: Timing & Tempo](./02-timing-and-tempo.md) — especially the sections on tempo integration, timebase modes, and the integration algorithm

How a DAW converts musical positions (beats, bars) into waveform pixels on screen, handling tempo changes along the way.

### The Timeline Grid (PPQN-Linear)

The grid, ruler, and beat markers use a simple **linear** mapping from ticks to pixels:

```
pixel = (tick - viewportStartTick) / ticksPerPixel
tick  = pixel * ticksPerPixel + viewportStartTick
```

This is intentionally NOT tempo-aware. Every beat is the same pixel width. Every bar is the same pixel width. The grid is uniform in musical space.

This is the correct behavior — when a musician looks at a timeline in "bars & beats" mode, they expect beat 1 of every bar to be equally spaced, regardless of whether the tempo is accelerating or decelerating.

### Waveform Rendering (Tempo-Aware)

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

### Peak Rendering (Pure Pixel Math)

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

#### Float16 Precision: What Half-Precision Buys and Costs

Floating-point numbers are stored in **scientific notation**, in binary:

```
6.5  in binary  =  1.101 × 2²
0.25 in binary  =  1.0   × 2⁻²
```

Two parts to encode: the **mantissa** (the digit part — `1.101`, `1.0`) and the **exponent** (the position part — `²`, `⁻²`). A floating-point format just allocates a fixed number of bits to each part:

```
Float32:  1 sign bit | 8 exponent bits | 23 mantissa bits   (32 bits total)
Float16:  1 sign bit | 5 exponent bits | 10 mantissa bits   (16 bits total)
```

The mantissa stores the fractional digits *after* the implicit leading 1. Float32's 23 mantissa bits give about 8 million distinct values between any two adjacent powers of 2; Float16's 10 mantissa bits give only **1024 values** in the same span.

Near 1.0, that means consecutive Float16 values are spaced about `0.000977` apart:

```
Float16 representable values around 1.0:
   ... 0.99902 → 0.99951 → 1.00000 → 1.00098 → 1.00195 ...
                              ↑
                       (mantissa bits all zero)
```

Each Float16 value represents a bucket of nearby Float32 inputs. Anything in the range `[0.99975, 1.000488)` rounds to the bit pattern that "means" 1.0.

#### The Unpack Quirk at Power-of-Two Boundaries

When a Float16 value lands exactly on a power of two — 1.0, 2.0, 0.5, and so on — all 10 mantissa bits are zero. The value is just `1.0 × 2^exponent` with no fractional digits. The Float16-to-Float32 unpack in `@opendaw/lib-std` has a special branch for this case:

```typescript
// Float16.intBitsToFloat — paraphrased
if (mantissa === 0 && exp > threshold) {
    return Float32(sign | exp_shifted | 0x3ff)
    //                                    ^^^^^
    //              fill the lower 10 mantissa bits with 1s
}
```

For `Float16(1.0)` (bit pattern `0x3c00`), this returns Float32 `1.0001219511032104` instead of `1.0` — a small bump of `1023 / 8_388_608` (the largest fractional offset that fits without changing the bit pattern's Float16 identity).

The likely intent is **conservative peak fidelity**: if the original sample was anywhere in the bucket `[0.99975, 1.000488)` that rounded to `Float16(1.0)`, returning a value slightly *above* 1.0 guarantees a peak meter never visually understates the true maximum amplitude.

#### Implication for `renderPixelStrips`

The bump matters when audio reaches **digital full-scale** — samples at exactly ±1.0. Stored as `Float16(±1.0)`, then unpacked as `±1.0001219...`, those peaks fall just outside the obvious `[-1, 1]` value range you'd pass to the renderer:

```typescript
import { PeaksPainter } from "@opendaw/lib-fusion";

PeaksPainter.renderPixelStrips(ctx, peaks, channel, {
    u0, u1, x0, x1, y0, y1,
    v0: -1, v1: 1   // ← clamps anything outside this range to canvas edges
})
```

The renderer's safety clamp pins out-of-range peaks to canvas top/bottom. Audio at full-scale renders as a **flat-top "square" waveform** — visually identical to actual hard clipping, even though the audio is in range.

**The fix is on the caller side:** widen the value range to absorb the unpack offset.

```typescript
v0: -1.001, v1: 1.001   // headroom of 0.001 absorbs ±1.0001220
```

The 0.1% widening is imperceptible in rendering — a peak at amplitude 0.95 still draws at ~95% of canvas height. Audio that *genuinely* exceeds ±1.001 still surfaces as clamping, so true over-range input is not masked by the headroom.

For reference, OpenDAW Studio uses two patterns: a hardcoded ±1.1 (10% headroom, giving visible margin around peaks) and a parameterised `-scale/+scale` driven by a dB gain knob. Either works. ±1.001 is the minimum sufficient value when you want full canvas height for the waveform without visible compression.

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

For an explanation of Musical vs Seconds timebase modes and how they interact with tempo, see [Chapter 02: Two Timebase Modes for Clips](./02-timing-and-tempo.md#two-timebase-modes-for-clips).
