# Sample Management and Peaks Rendering

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
  | { type: "idle" }           // Not started
  | { type: "loading" }        // Fetching and processing
  | { type: "loaded" }         // Ready to use (peaks available)
  | { type: "error", error }   // Failed
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

    PeaksPainter.renderBlocks(context, peaks, channel, {
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
PeaksPainter.renderBlocks(context, peaks, channel, rect);
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

      PeaksPainter.renderBlocks(context, peaks, 0, {
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
PeaksPainter.renderBlocks(context, peaks, channel, {
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

## Next Steps

Continue to **Timeline Rendering** to learn how to build a complete DAW timeline UI with PPQN positioning.
