# Recording and Live Peaks

This guide covers how to access and render live waveform peaks during recording using OpenDAW's public APIs.

## Table of Contents
- [Recording API Overview](#recording-api-overview)
- [Accessing Recording Peaks](#accessing-recording-peaks)
  - [Production Pattern (Timeline UI)](#production-pattern-timeline-ui)
  - [Demo Pattern (Standalone Recording)](#demo-pattern-standalone-recording)
- [Smooth 60fps Rendering](#smooth-60fps-rendering)
- [Complete Example](#complete-example)

## Recording API Overview

OpenDAW's `Recording.start()` API automatically handles:
- Creating Tape instrument and arming tracks
- Managing MediaStream lifecycle
- Creating AudioRegionBox and AudioFileBox
- Setting up RecordingWorklet with PeaksWriter for live peak generation

**Important**: The AudioFileBox and RecordingWorklet share the same UUID (RecordAudio.ts:48), which links the box graph to the sample manager.

## Accessing Recording Peaks

### Production Pattern (Timeline UI)

**This is OpenDAW's approach** - iterate through regions during rendering and check loader state.

**Source**: `packages/app/studio/src/ui/timeline/tracks/audio-unit/regions/RegionRenderer.ts:119-120`

```typescript
import { AnimationFrame } from "@opendaw/lib-fusion";

// During timeline rendering, iterate through audio regions
function renderAudioRegion(region: AudioRegionBoxAdapter) {
  // Check if this region is currently recording by examining loader state
  const loader = region.file.getOrCreateLoader();
  const isRecording = loader.state.type === "record";

  if (isRecording) {
    // Access live peaks from the SampleLoader
    const peaksOption = loader.peaks;
    if (peaksOption && !peaksOption.isEmpty()) {
      const peaks = peaksOption.unwrap();

      // Check if this is PeaksWriter (live recording) or final Peaks
      const isPeaksWriter = "dataIndex" in peaks;

      if (isPeaksWriter) {
        // Render progressive waveform using dataIndex for smooth updates
        const unitsToRender = peaks.dataIndex[0] * peaks.unitsEachPeak();
        // ... render using PeaksPainter
      }
    }
  }
}

// Set up AnimationFrame to trigger re-renders
useEffect(() => {
  const terminable = AnimationFrame.add(() => {
    // Your rendering logic here
    canvasPainter.requestUpdate();
  });

  return () => terminable.terminate();
}, []);
```

**Key Implementation Details**:

```typescript
// AudioFileBoxAdapter provides the getOrCreateLoader() method
// Source: packages/studio/adapters/src/audio/AudioFileBoxAdapter.ts:27-29
class AudioFileBoxAdapter {
  getOrCreateLoader(): SampleLoader {
    // Uses the public SampleLoaderManager API
    return this.#context.sampleManager.getOrCreate(this.#box.address.uuid);
  }
}

// AudioRegionBoxAdapter exposes the file adapter
// Source: packages/studio/adapters/src/timeline/region/AudioRegionBoxAdapter.ts:52-58
this.#box.file.catchupAndSubscribe((pointerField) => {
  this.#fileAdapter = pointerField.targetVertex.map(vertex =>
    this.#context.boxAdapters.adapterFor(vertex.box, AudioFileBoxAdapter)
  );
});
```

**When to use this pattern:**
- Building a full timeline UI with region rendering
- Already iterating through regions for other purposes
- Want to show recording indicators on the timeline
- Need to handle multiple simultaneous recordings

### Demo Pattern (Standalone Recording)

**This pattern** is simpler for standalone recording demos where you don't have a full timeline renderer.

**Source**: `src/recording-api-react-demo.tsx:182-229`

```typescript
import { AnimationFrame } from "@opendaw/lib-fusion";

// Monitor for recording peaks using label search
useEffect(() => {
  if (!project || !isRecording) return undefined;

  let animationFrameTerminable: any = null;
  let sampleLoader: any = null;

  animationFrameTerminable = AnimationFrame.add(() => {
    // Find the recording region (OpenDAW sets label to "Recording" in RecordAudio.ts:54)
    if (!sampleLoader) {
      const boxes = project.boxGraph.boxes();
      const recordingRegion = boxes.find((box: any) => {
        return box.label?.getValue?.() === "Recording";
      });

      if (recordingRegion && (recordingRegion as any).file) {
        // Get AudioFileBox from the region's file pointer
        // PointerField.targetVertex returns the Box itself (Box extends Vertex)
        const fileVertexOption = (recordingRegion as any).file.targetVertex;

        if (fileVertexOption && !fileVertexOption.isEmpty()) {
          const audioFileBox = fileVertexOption.unwrap();

          // Use public API to get SampleLoader
          // Box stores UUID in address.uuid property
          if (audioFileBox && (audioFileBox as any).address?.uuid) {
            const uuid = (audioFileBox as any).address.uuid;
            sampleLoader = project.sampleManager.getOrCreate(uuid);
          }
        }
      }
    }

    // Monitor the sample loader for peak updates
    if (sampleLoader) {
      const peaksOption = sampleLoader.peaks;

      if (peaksOption && !peaksOption.isEmpty()) {
        const peaks = peaksOption.unwrap();
        const isPeaksWriter = "dataIndex" in peaks;

        if (isPeaksWriter) {
          // Live recording - update peaks every frame
          currentPeaksRef.current = peaks;
          canvasPainterRef.current?.requestUpdate();
        } else {
          // Recording finished - final peaks available
          currentPeaksRef.current = peaks;
          canvasPainterRef.current?.requestUpdate();
          setHasPeaks(true);

          // Stop monitoring
          if (animationFrameTerminable) {
            animationFrameTerminable.terminate();
            animationFrameTerminable = null;
          }
        }
      }
    }
  });

  return () => {
    if (animationFrameTerminable) {
      animationFrameTerminable.terminate();
    }
  };
}, [project, isRecording]);
```

**When to use this pattern:**
- Simple recording demos or prototypes
- Don't have a full timeline renderer yet
- Only need to track a single active recording
- Want a quick way to test recording functionality

## Smooth 60fps Rendering

The key to smooth live waveform rendering is using `dataIndex` from PeaksWriter instead of `numFrames`.

```typescript
// In your CanvasPainter paint function
const isPeaksWriter = "dataIndex" in peaks;

if (isPeaksWriter) {
  // Use dataIndex for smooth progressive rendering at 60fps
  const unitsToRender = peaks.dataIndex[0] * peaks.unitsEachPeak();

  PeaksPainter.renderBlocks(context, peaks, channel, {
    x0: 0,
    x1: canvas.clientWidth,
    y0,
    y1,
    u0: 0,
    u1: unitsToRender,  // Only render written data
    v0: -1,
    v1: 1
  });
} else {
  // Final peaks - render all frames
  PeaksPainter.renderBlocks(context, peaks, channel, {
    x0: 0,
    x1: canvas.clientWidth,
    y0,
    y1,
    u0: 0,
    u1: peaks.numFrames,  // Render complete waveform
    v0: -1,
    v1: 1
  });
}
```

**Why this works:**
- `peaks.numFrames` jumps in 0.5-second chunks (24000 frames), causing choppy rendering
- `peaks.dataIndex[0]` updates every frame, tracking the exact number of peaks written
- `peaks.unitsEachPeak()` converts peak count to audio frame units
- Result: Smooth progressive waveform at 60fps during recording

**Source**: `src/recording-api-react-demo.tsx:93-111`

## Complete Example

Here's a complete example using the production pattern:

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { AnimationFrame, CanvasPainter, PeaksPainter } from "@opendaw/lib-fusion";
import { AudioRegionBoxAdapter } from "@opendaw/studio-adapters";

function TimelineRegionRenderer({ regions, project }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasPainterRef = useRef<CanvasPainter | null>(null);

  // Track which regions are currently recording
  const [recordingRegions, setRecordingRegions] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!canvasRef.current) return;

    // Initialize CanvasPainter
    const canvasPainter = new CanvasPainter(canvasRef.current, (context, canvas) => {
      context.clearRect(0, 0, canvas.width, canvas.height);

      // Render each region
      regions.forEach((region: AudioRegionBoxAdapter) => {
        const loader = region.file.getOrCreateLoader();
        const isRecording = loader.state.type === "record";

        // Update recording state
        const regionId = region.box.address.uuid.toString();
        setRecordingRegions(prev => {
          const next = new Set(prev);
          if (isRecording) {
            next.add(regionId);
          } else {
            next.delete(regionId);
          }
          return next;
        });

        // Render region waveform
        const peaksOption = loader.peaks;
        if (peaksOption && !peaksOption.isEmpty()) {
          const peaks = peaksOption.unwrap();
          const isPeaksWriter = "dataIndex" in peaks;

          // Calculate render range
          const unitsToRender = isPeaksWriter
            ? peaks.dataIndex[0] * peaks.unitsEachPeak()
            : peaks.numFrames;

          // Render waveform
          PeaksPainter.renderBlocks(context, peaks, 0, {
            x0: region.xPosition,
            x1: region.xPosition + region.width,
            y0: region.yPosition,
            y1: region.yPosition + region.height,
            u0: 0,
            u1: unitsToRender,
            v0: -1,
            v1: 1
          });

          // Visual indicator for recording
          if (isRecording) {
            context.fillStyle = "rgba(255, 0, 0, 0.2)";
            context.fillRect(
              region.xPosition,
              region.yPosition,
              region.width,
              region.height
            );
          }
        }
      });
    });

    canvasPainterRef.current = canvasPainter;

    // Set up AnimationFrame for smooth updates
    const animationTerminable = AnimationFrame.add(() => {
      canvasPainter.requestUpdate();
    });

    return () => {
      animationTerminable.terminate();
      canvasPainter.terminate();
    };
  }, [regions]);

  return (
    <div>
      <canvas ref={canvasRef} width={800} height={600} />
      {recordingRegions.size > 0 && (
        <div style={{ color: 'red' }}>
          Recording {recordingRegions.size} region(s)...
        </div>
      )}
    </div>
  );
}
```

## Summary

### Production Pattern (OpenDAW's Approach)
✅ **Use when**: Building a full timeline UI
✅ **Advantages**: Handles multiple recordings, integrates with existing region rendering
✅ **How**: Iterate regions, check `loader.state.type === "record"`

### Demo Pattern (Label Search)
✅ **Use when**: Building standalone recording demos
✅ **Advantages**: Simple, direct, good for prototypes
✅ **How**: Search for region with label "Recording", access its loader

### Both Patterns Use Public APIs
- `BoxGraph.boxes()` - Get all boxes in the graph
- `PointerField.targetVertex` - Follow pointer references
- `SampleLoaderManager.getOrCreate(uuid)` - Get SampleLoader for a UUID
- `SampleLoader.peaks` - Access live or final peaks
- `AudioFileBoxAdapter.getOrCreateLoader()` - Convenience wrapper

**Next Steps**: See [Timeline Rendering](./06-timeline-rendering.md) for more details on rendering waveforms in a timeline context.
