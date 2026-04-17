# Samples, Peaks & Looping

> **Skip if:** you're familiar with OpenDAW's sample loading and region looping
> **Prerequisites:** Chapter 04 (Box System)

## Table of Contents

- [Overview](#overview)
- [The Sample Loading Pipeline](#the-sample-loading-pipeline)
- [Setting Up Sample Manager](#setting-up-sample-manager)
- [Loading Custom Audio Files](#loading-custom-audio-files)
- [Understanding Sample Loader States](#understanding-sample-loader-states)
- [Subscribing to Sample Loader](#subscribing-to-sample-loader)
- [What are Peaks?](#what-are-peaks)
- [Rendering Waveforms with PeaksPainter](#rendering-waveforms-with-peakspainter)
- [React Canvas Pattern with CanvasPainter](#react-canvas-pattern-with-canvaspainter)
- [Complete Example: Loading and Rendering](#complete-example-loading-and-rendering)
- [Performance Tips](#performance-tips)
- [Common Issues](#common-issues)
- [Summary](#summary)
- [Advanced: Clip Looping (Region Tiling)](#advanced-clip-looping-region-tiling)
  - [Region Fields](#region-fields)
  - [waveformOffset — Shifting the Audio Read Position](#waveformoffset--shifting-the-audio-read-position)
  - [How the Engine Tiles (locateLoops)](#how-the-engine-tiles-locateloops)
  - [Basic Setup](#basic-setup)
  - [Presets Pattern](#presets-pattern)
  - [Waveform Rendering for Tiled Regions](#waveform-rendering-for-tiled-regions)
  - [Works for All Region Types](#works-for-all-region-types)
  - [Works with Both Timebases](#works-with-both-timebases)
  - [Reference](#reference)

## Overview

When building a DAW UI, you need to:
1. **Load audio files** into the browser
2. **Generate peaks** (waveform data for visualization)
3. **Render waveforms** on canvas

OpenDAW's `SampleManager` handles this workflow automatically.

## The Sample Loading Pipeline

```
Audio File URL
      ↓
  fetch() / FileReader
      ↓
  ArrayBuffer
      ↓
  AudioContext.decodeAudioData()
      ↓
  AudioBuffer (decoded PCM data)
      ↓
  SampleManager processes
      ↓
  ┌────────────────┬─────────────────┐
  ↓                ↓                 ↓
Audio Playback   Peaks Data    Waveform Rendering
```

## Setting Up Sample Manager

The sample manager is configured during project initialization:

```typescript
import { DefaultSampleLoaderManager, OpenSampleAPI } from "@opendaw/studio-core";
import { UUID, Procedure, unitValue } from "@opendaw/lib-std";

const sampleManager = new DefaultSampleLoaderManager({
  fetch: async (
    uuid: UUID.Bytes,
    progress: Procedure<unitValue>
  ): Promise<[AudioData, SampleMetaData]> => {
    // Option 1: Use OpenDAW's built-in sample library
    return OpenSampleAPI.get().load(audioContext, uuid, progress);

    // Option 2: Load custom audio files (explained below)
  }
});
```

## Loading Custom Audio Files

### Step 1: Fetch and Decode Audio

```typescript
async function loadAudioFile(
  audioContext: AudioContext,
  url: string
): Promise<AudioBuffer> {
  // Fetch the audio file
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();

  // Decode to PCM audio data
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  return audioBuffer;
}
```

### Step 2: Store in Local Map

Create a map to store your audio buffers:

```typescript
// In your component/module
const localAudioBuffers = new Map<string, AudioBuffer>();

// Load audio and store it
const audioBuffer = await loadAudioFile(audioContext, "/audio/kick.wav");
const fileUUID = UUID.generate();
const uuidString = UUID.toString(fileUUID);

localAudioBuffers.set(uuidString, audioBuffer);
```

### Step 3: Custom Sample Manager

Configure the sample manager to use your local buffers:

```typescript
import { OpenSampleAPI } from "@opendaw/studio-core";

const sampleManager = new DefaultSampleLoaderManager({
  fetch: async (
    uuid: UUID.Bytes,
    progress: Procedure<unitValue>
  ): Promise<[AudioData, SampleMetaData]> => {
    const uuidString = UUID.toString(uuid);

    // Check if we have this audio locally
    const audioBuffer = localAudioBuffers.get(uuidString);

    if (audioBuffer) {
      // Convert AudioBuffer to OpenDAW's format
      const audioData = OpenSampleAPI.fromAudioBuffer(audioBuffer);

      const metadata: SampleMetaData = {
        name: uuidString,
        bpm: 120,
        duration: audioBuffer.duration,
        sample_rate: audioBuffer.sampleRate,
        origin: "import"
      };

      return [audioData, metadata];
    }

    // Fallback: use built-in samples
    return OpenSampleAPI.get().load(audioContext, uuid, progress);
  }
});
```

## Understanding Sample Loader States

The sample manager goes through several states when loading:

```typescript
type SampleLoaderState =
  | { type: "idle" }                      // Not started
  | { type: "record" }                    // Recording in progress
  | { type: "progress", progress: number }// Fetching/decoding (0-1)
  | { type: "loaded" }                    // Ready to use
  | { type: "error", reason: string }     // Failed
```

## Subscribing to Sample Loader

To know when peaks are ready:

```typescript
import { UUID } from "@opendaw/lib-std";

// Get the sample loader for a specific UUID
const fileUUID = /* ... */;
const sampleLoader = project.sampleManager.getOrCreate(fileUUID);

// Subscribe to state changes
const subscription = sampleLoader.subscribe(state => {
  console.log("Sample loader state:", state.type);

  if (state.type === "loaded") {
    // Peaks are now available!
    const peaksOption = sampleLoader.peaks;

    if (!peaksOption.isEmpty()) {
      const peaks = peaksOption.unwrap();
      console.log("Peaks ready:", peaks);
      // Now you can render the waveform
    }
  }

  if (state.type === "error") {
    console.error("Failed to load sample:", state.error);
  }
});

// Don't forget to clean up
subscription.terminate();
```

**Important:** `SampleLoader` only has `subscribe()` (future changes), NOT `catchupAndSubscribe()`. Always check `loader.state.type` before subscribing — short recordings may already be `"loaded"` by the time you subscribe. Handle both `"loaded"` and `"error"` to avoid stuck states.

### Using the Adapter Layer (Preferred)

Instead of manually resolving loaders via `sampleManager.getOrCreate(uuid)`, prefer the adapter layer:

```typescript
// Raw approach (manual UUID resolution)
const fileVertex = regionBox.file.targetVertex;
const uuid = fileVertex.unwrap().address.uuid;
const loader = project.sampleManager.getOrCreate(uuid);

// Adapter approach (preferred — resolves loader internally)
const regionAdapter: AudioRegionBoxAdapter = /* from subscription */;
const loader = regionAdapter.file.getOrCreateLoader();
const peaks = regionAdapter.file.peaks; // Option<Peaks>
```

### PeaksWriter vs Peaks

During recording, `sampleLoader.peaks` returns a **PeaksWriter** (live, growing peaks). After finalization, it returns final **Peaks** (static). Both implement the same rendering interface, but you can distinguish them:

```typescript
const peaks = sampleLoader.peaks.unwrap();
const isLive = "dataIndex" in peaks; // PeaksWriter has dataIndex

if (isLive) {
  // Live recording — total frames = dataIndex[0] * unitsEachPeak()
  const unitsToRender = peaks.dataIndex[0] * peaks.unitsEachPeak();
} else {
  // Final peaks — use numFrames
  const unitsToRender = peaks.numFrames;
}
```

## What are Peaks?

**Peaks** are pre-computed min/max values for waveform visualization. Instead of rendering millions of audio samples, you render a few thousand peak points.

### Peak Data Structure

```typescript
interface Peaks {
  numChannels: number;   // 1 = mono, 2 = stereo
  numFrames: number;     // Number of peak frames
  sampleRate: number;    // Original sample rate
  // Internal data for rendering
}
```

### Why Peaks?

```
Audio file: 44,100 samples per second × 30 seconds = 1,323,000 samples

Timeline canvas: 800 pixels wide

Problem: Can't render 1.3 million samples on 800 pixels!

Solution: Pre-compute peaks
- Divide audio into chunks (e.g., 1000 samples per chunk)
- Find min/max in each chunk
- Result: ~1323 peak frames (much more manageable!)
```

## Rendering Waveforms with PeaksPainter

OpenDAW provides `PeaksPainter` for efficient waveform rendering:

```typescript
import { PeaksPainter } from "@opendaw/lib-fusion";

// In a canvas rendering function
function renderWaveform(
  context: CanvasRenderingContext2D,
  peaks: Peaks,
  canvas: HTMLCanvasElement
) {
  // Clear canvas
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Set waveform color
  context.fillStyle = "#4a9eff";

  // Render each channel
  const numChannels = peaks.numChannels;
  const channelHeight = canvas.height / numChannels;
  const PADDING = 4; // pixels between channels

  for (let channel = 0; channel < numChannels; channel++) {
    const y0 = channel * channelHeight + PADDING / 2;
    const y1 = (channel + 1) * channelHeight - PADDING / 2;

    PeaksPainter.renderPixelStrips(context, peaks, channel, {
      x0: 0,                    // Start X (pixels)
      x1: canvas.width,         // End X (pixels)
      y0: y0,                   // Start Y (pixels)
      y1: y1,                   // End Y (pixels)
      u0: 0,                    // Start frame (peak index)
      u1: peaks.numFrames,      // End frame
      v0: -1,                   // Min amplitude (-1 = bottom)
      v1: 1                     // Max amplitude (1 = top)
    });
  }
}
```

### Understanding PeaksPainter Parameters

```typescript
PeaksPainter.renderPixelStrips(context, peaks, channel, rect);
```

**Rect parameters:**
- `x0, x1` - Horizontal pixel range (where to draw)
- `y0, y1` - Vertical pixel range (height for this channel)
- `u0, u1` - Peak frame range (which part of audio to show)
- `v0, v1` - Amplitude range (-1 to 1 for full waveform)

## React Canvas Pattern with CanvasPainter

For efficient React rendering, use the `CanvasPainter` pattern:

```typescript
import { CanvasPainter } from "./lib/CanvasPainter";
import { useEffect, useRef } from "react";

function WaveformDisplay({ fileUUID }: { fileUUID: UUID.Bytes }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<CanvasPainter | null>(null);
  const peaksRef = useRef<Peaks | null>(null);

  // Set up canvas painter
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const painter = new CanvasPainter(canvas, (_, context) => {
      const peaks = peaksRef.current;
      if (!peaks) return;

      // Render waveform
      renderWaveform(context, peaks, canvas);
    });

    painterRef.current = painter;

    return () => painter.terminate();
  }, []);

  // Subscribe to peaks
  useEffect(() => {
    const sampleLoader = project.sampleManager.getOrCreate(fileUUID);

    const subscription = sampleLoader.subscribe(state => {
      if (state.type === "loaded") {
        const peaksOption = sampleLoader.peaks;

        if (!peaksOption.isEmpty()) {
          peaksRef.current = peaksOption.unwrap();
          painterRef.current?.requestUpdate(); // Trigger re-render
        }
      }
    });

    return () => subscription.terminate();
  }, [fileUUID]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "80px" }}
    />
  );
}
```

## Complete Example: Loading and Rendering

```typescript
import { useState, useEffect, useRef } from "react";
import { UUID } from "@opendaw/lib-std";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { CanvasPainter } from "./lib/CanvasPainter";

function AudioTrack({ project, audioContext }) {
  const [peaksReady, setPeaksReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<CanvasPainter | null>(null);
  const peaksRef = useRef<Peaks | null>(null);

  // 1. Load audio file
  useEffect(() => {
    async function loadAudio() {
      // Fetch and decode
      const response = await fetch("/audio/kick.wav");
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Generate UUID and store
      const fileUUID = UUID.generate();
      const uuidString = UUID.toString(fileUUID);
      localAudioBuffers.set(uuidString, audioBuffer);

      // Create AudioFileBox in OpenDAW
      project.editing.modify(() => {
        AudioFileBox.create(project.boxGraph, fileUUID, box => {
          box.fileName.setValue("kick.wav");
          box.endInSeconds.setValue(audioBuffer.duration);
        });
      });

      // Subscribe to sample loader
      const sampleLoader = project.sampleManager.getOrCreate(fileUUID);

      sampleLoader.subscribe(state => {
        if (state.type === "loaded") {
          const peaksOption = sampleLoader.peaks;
          if (!peaksOption.isEmpty()) {
            peaksRef.current = peaksOption.unwrap();
            painterRef.current?.requestUpdate();
            setPeaksReady(true);
          }
        }
      });
    }

    loadAudio();
  }, []);

  // 2. Set up canvas painter
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const painter = new CanvasPainter(canvas, (_, context) => {
      const peaks = peaksRef.current;
      if (!peaks) {
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }

      // Render waveform
      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#4a9eff";

      PeaksPainter.renderPixelStrips(context, peaks, 0, {
        x0: 0,
        x1: canvas.width,
        y0: 0,
        y1: canvas.height,
        u0: 0,
        u1: peaks.numFrames,
        v0: -1,
        v1: 1
      });
    });

    painterRef.current = painter;

    return () => painter.terminate();
  }, []);

  return (
    <div>
      <h3>Kick Drum {peaksReady && "✓"}</h3>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "80px" }}
      />
    </div>
  );
}
```

## Performance Tips

### 1. Use CanvasPainter
Don't render directly - use the CanvasPainter pattern to avoid unnecessary redraws.

### 2. Throttle Updates
Use AnimationFrame to throttle expensive operations:

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

// Instead of subscribing directly to position
const sub = AnimationFrame.add(() => {
  setPosition(project.engine.position.getValue());
});
```

### 3. Render Only Visible Region
If showing a zoomed-in view, only render the visible peaks:

```typescript
// Only render frames 1000-2000 instead of all frames
PeaksPainter.renderPixelStrips(context, peaks, channel, {
  x0: 0,
  x1: canvas.width,
  y0: 0,
  y1: canvas.height,
  u0: 1000,          // Start frame
  u1: 2000,          // End frame
  v0: -1,
  v1: 1
});
```

## Common Issues

### Issue: Peaks Not Loading

```typescript
// ❌ Bad: Forgot to trigger sample loading
AudioFileBox.create(boxGraph, uuid, box => {
  box.fileName.setValue("file.wav");
});
// Sample manager doesn't know to load this!

// ✅ Good: Sample manager auto-loads when needed
project.sampleManager.getOrCreate(uuid);
// This triggers the load
```

### Issue: Canvas Not Updating

```typescript
// ❌ Bad: Direct render in useEffect
useEffect(() => {
  renderWaveform(context, peaks, canvas);
}, [peaks]);

// ✅ Good: Use CanvasPainter
useEffect(() => {
  peaksRef.current = peaks;
  painter.requestUpdate(); // Proper render request
}, [peaks]);
```

## Summary

Sample management workflow:
1. **Fetch audio** → AudioBuffer
2. **Store locally** → Map<UUID, AudioBuffer>
3. **Configure sample manager** → Returns AudioData + metadata
4. **Create AudioFileBox** → Links to UUID
5. **Subscribe to sample loader** → Get peaks when ready
6. **Render with PeaksPainter** → Draw waveform on canvas

Key points:
- Sample manager handles audio → peaks conversion
- Subscribe to loader state to know when peaks are ready
- Use CanvasPainter for efficient React canvas rendering
- PeaksPainter provides optimized waveform rendering

## Advanced: Clip Looping (Region Tiling)

> *Previously: 20-clip-looping.md*
> **Skip if:** you don't need looping/tiling behavior

When a region's `duration` exceeds its `loopDuration`, the content repeats (tiles) automatically. This is how DAWs handle loop-based workflows — a short drum pattern can fill an entire song by tiling.

## Region Fields

Every audio region has four fields that control looping:

```
Timeline: |------------- duration (total visible length) --------------|
Content:  |-- loopDuration --|-- loopDuration --|-- loopDuration --|...|
           ^loopOffset=0      ^loop boundary     ^loop boundary
```

| Field | Type | Description |
|-------|------|-------------|
| `position` | PPQN | Where the region starts on the timeline |
| `duration` | PPQN | Total visible length on the timeline |
| `loopDuration` | PPQN | The content segment that repeats |
| `loopOffset` | PPQN | Shifts which loop cycle aligns with the region start |

When `duration > loopDuration`, the engine tiles the content automatically.

## waveformOffset — Shifting the Audio Read Position

**Critical distinction:** `loopOffset` controls loop cycle alignment on the timeline. It does NOT shift where in the audio file the engine reads from.

To read from a different point in the audio file, use `waveformOffset`:

| Field | Type | What it does |
|-------|------|-------------|
| `loopOffset` | PPQN | Controls which loop cycle maps to which timeline position |
| `waveformOffset` | seconds (field 7 on AudioRegionBox) | Shifts the audio buffer read position |

The TapeDeviceProcessor reads audio with:
```
sampleIndex = (elapsedSeconds + waveformOffset) * sampleRate
```

Where `elapsedSeconds` is the time elapsed since the start of the current loop cycle (always starts at 0 for each tile).

### Example: Skip 30 Seconds of Silence

```typescript
project.editing.modify(() => {
  // Region at timeline position 0
  regionBox.position.setValue(0);
  // 2-bar loop tiled across 8 bars
  regionBox.loopDuration.setValue(BAR * 2);
  regionBox.duration.setValue(BAR * 8);
  regionBox.loopOffset.setValue(0);
  // Skip to 30 seconds into the audio file
  regionBox.waveformOffset.setValue(30.0);
});
```

### Converting PPQN to Seconds for waveformOffset

```typescript
import { PPQN } from "@opendaw/lib-dsp";

const bpm = project.timelineBox.bpm.getValue();
const barToSkip = 24; // skip to bar 25 (0-indexed)
const ppqnOffset = PPQN.fromSignature(4, 4) * barToSkip;
const seconds = PPQN.pulsesToSeconds(ppqnOffset, bpm);
regionBox.waveformOffset.setValue(seconds);
```

## How the Engine Tiles (locateLoops)

The SDK's `LoopableRegion.locateLoops()` generator yields one `LoopCycle` per tile within the playback range:

```
offset = position - loopOffset
passIndex = floor((seekMin - offset) / loopDuration)
rawStart = offset + passIndex * loopDuration
```

Each cycle covers `loopDuration` PPQN on the timeline. The engine reads audio from `elapsedSeconds = tempoMap.intervalToSeconds(rawStart, resultStart)` within each cycle — this resets to 0 at each tile boundary, so every tile reads from the same point in the audio file (offset by `waveformOffset`).

### globalToLocal

The formula for converting a timeline position to a local position within the loop:

```
globalToLocal(region, ppqn) = mod(ppqn - region.position + region.loopOffset, region.loopDuration)
```

This is used by automation (`ValueRegionBoxAdapter.valueAt()`) and MIDI (`NoteSequencer`) to find the correct event within a looped region.

## Basic Setup

```typescript
import { PPQN } from "@opendaw/lib-dsp";

const BAR = PPQN.fromSignature(4, 4); // 3840 PPQN in 4/4

// After loading a track with loadTracksFromFiles, find the region
const boxes = project.boxGraph.boxes();
let regionBox = null;
for (const box of boxes) {
  if (box instanceof AudioRegionBox) {
    regionBox = box;
    break;
  }
}

// Set up a 2-bar loop tiled 4 times
project.editing.modify(() => {
  regionBox.loopDuration.setValue(BAR * 2);   // 2 bars repeat
  regionBox.duration.setValue(BAR * 8);       // 8 bars total (4 tiles)
  regionBox.loopOffset.setValue(0);
  regionBox.waveformOffset.setValue(0);       // read from start of file
});

// Set timeline loop area to match
project.editing.modify(() => {
  project.timelineBox.loopArea.from.setValue(0);
  project.timelineBox.loopArea.to.setValue(BAR * 8);
  project.timelineBox.loopArea.enabled.setValue(true);
});
```

## Presets Pattern

Define presets as data and apply them uniformly:

```typescript
type LoopPreset = {
  name: string;
  loopDuration: number;     // PPQN
  contentOffset: number;    // PPQN — converted to waveformOffset seconds
  duration: number;         // PPQN
};

function applyPreset(
  project: Project,
  regionBox: AudioRegionBox,
  preset: LoopPreset
): void {
  const bpm = project.timelineBox.bpm.getValue();
  const waveformOffsetSeconds = PPQN.pulsesToSeconds(preset.contentOffset, bpm);

  project.editing.modify(() => {
    regionBox.position.setValue(0);
    regionBox.loopOffset.setValue(0);
    regionBox.loopDuration.setValue(preset.loopDuration);
    regionBox.duration.setValue(preset.duration);
    regionBox.waveformOffset.setValue(waveformOffsetSeconds);
  });

  project.editing.modify(() => {
    project.timelineBox.loopArea.from.setValue(0);
    project.timelineBox.loopArea.to.setValue(preset.duration);
    project.timelineBox.loopArea.enabled.setValue(true);
  });

  project.engine.setPosition(0);
}
```

## Waveform Rendering for Tiled Regions

To visually show the tiled waveform, render each tile's peaks slice separately using `PeaksPainter.renderPixelStrips()`.

### Computing Frame Ranges

The peaks data covers the entire audio file. To render the loop slice:

```typescript
const numFrames = peaks.numFrames;
const fullAudioPpqn = regionBox.duration.getValue(); // original full duration before tiling

// Convert content offset (PPQN) to frame range
const contentOffsetPpqn = /* your PPQN offset into the audio */;
const loopDurationPpqn = regionBox.loopDuration.getValue();

const u0 = Math.floor((contentOffsetPpqn / fullAudioPpqn) * numFrames);
const u1 = u0 + Math.floor((loopDurationPpqn / fullAudioPpqn) * numFrames);
```

### Rendering Each Tile

```typescript
const tileCount = Math.ceil(duration / loopDuration);

for (let tile = 0; tile < tileCount; tile++) {
  const tileStartX = (tile * loopDuration / duration) * canvasWidth;
  const tileEndX = Math.min(((tile + 1) * loopDuration / duration) * canvasWidth, canvasWidth);

  // IMPORTANT: set fillStyle before calling renderPixelStrips
  // PeaksPainter uses the current ctx.fillStyle — it does NOT accept color parameters
  ctx.fillStyle = "#f59e0b";

  PeaksPainter.renderPixelStrips(ctx, peaks, 0, {
    x0: tileStartX,
    x1: tileEndX,
    y0: 0,
    y1: canvasHeight,
    u0: Math.max(0, Math.min(numFrames, u0)),
    u1: Math.max(0, Math.min(numFrames, u1)),
    v0: -1,
    v1: 1
  });
}
```

### Loop Boundary Lines

Draw dashed lines at tile boundaries for visual clarity:

```typescript
ctx.strokeStyle = "rgba(255, 180, 80, 0.6)";
ctx.setLineDash([4, 4]);
for (let tile = 1; tile < tileCount; tile++) {
  const x = (tile * loopDuration / duration) * canvasWidth;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, canvasHeight);
  ctx.stroke();
}
ctx.setLineDash([]);
```

### Peaks Loading Timing

`loadTracksFromFiles` calls `queryLoadingComplete()` before returning, but the SamplePeaks worker finishes ~120ms later. Use `sampleLoader.subscribe()` and wait for `state.type === "loaded"`:

```typescript
const sampleLoader = project.sampleManager.getOrCreate(track.uuid);
sampleLoader.subscribe((state) => {
  if (state.type === "loaded") {
    const peaksOpt = sampleLoader.peaks;
    if (!peaksOpt.isEmpty()) {
      const peaks = peaksOpt.unwrap();
      // peaks.numFrames, peaks.numChannels are now available
    }
  }
});
```

## Works for All Region Types

The looping mechanism is identical for:
- **Audio regions** (`AudioRegionBox`) — tiles audio waveform
- **MIDI regions** (`NoteRegionBox`) — tiles note events
- **Automation regions** (`ValueRegionBox`) — tiles automation events

All use `LoopableRegion.locateLoops()` and the same `globalToLocal` formula.

## Works with Both Timebases

Audio regions support both Musical and Seconds timebases via the `timeBase` field on `AudioRegionBox`.

```typescript
import { TimeBase } from "@opendaw/lib-dsp";
```

### Musical (default)

Values are stored in PPQN. Loop durations scale with BPM changes — a 2-bar loop stays 2 bars regardless of tempo.

```typescript
project.editing.modify(() => {
  regionBox.timeBase.setValue(TimeBase.Musical);
  regionBox.loopDuration.setValue(BAR * 2);     // 7680 PPQN
  regionBox.duration.setValue(BAR * 8);          // 30720 PPQN
});
```

### Seconds

Values are stored in seconds. Loop durations stay constant regardless of BPM — a 3.87s loop stays 3.87s even if tempo changes.

```typescript
const bpm = project.timelineBox.bpm.getValue();
const loopDurationSeconds = PPQN.pulsesToSeconds(BAR * 2, bpm); // ~3.87s at 124 BPM

project.editing.modify(() => {
  regionBox.timeBase.setValue(TimeBase.Seconds);
  regionBox.loopDuration.setValue(loopDurationSeconds); // seconds, not PPQN
  regionBox.duration.setValue(loopDurationSeconds * 4); // 4 tiles
});
```

### What's stored in each mode

| Field | Musical | Seconds |
|-------|---------|---------|
| `position` | PPQN | PPQN (always PPQN on timeline) |
| `duration` | PPQN | seconds |
| `loopDuration` | PPQN | seconds |
| `loopOffset` | PPQN | PPQN |
| `waveformOffset` | seconds (always) | seconds (always) |
| `timelineBox.loopArea.from/to` | PPQN (always) | PPQN (always) |
| `timelineBox.durationInPulses` | PPQN (always) | PPQN (always) |

**Key point:** The timeline loop area and `durationInPulses` are always in PPQN regardless of region timebase. Only `duration` and `loopDuration` on the region itself change storage units. The `AudioRegionBoxAdapter` uses `TimeBaseConverter` to convert to PPQN before any engine calculations, so tiling works identically in both modes.

### Switching at runtime

When switching an existing region between timebases, convert and re-store the values:

```typescript
// Switch from Musical to Seconds
const bpm = project.timelineBox.bpm.getValue();
const durationSeconds = PPQN.pulsesToSeconds(currentDurationPpqn, bpm);
const loopDurationSeconds = PPQN.pulsesToSeconds(currentLoopDurationPpqn, bpm);

project.editing.modify(() => {
  regionBox.timeBase.setValue(TimeBase.Seconds);
  regionBox.duration.setValue(durationSeconds);
  regionBox.loopDuration.setValue(loopDurationSeconds);
});
```

## Reference

- Demo: `src/clip-looping-demo.tsx`
- SDK loop math: `@opendaw/lib-dsp` → `events.ts` → `LoopableRegion.locateLoops()`
- SDK playback: `@opendaw/studio-core` → `TapeDeviceProcessor.ts`
- SDK adapter: `@opendaw/studio-adapters` → `AudioRegionBoxAdapter.ts`
- Region schema: `@opendaw/studio-boxes` → `AudioRegionBox.ts` (field 7: `waveform-offset`)
