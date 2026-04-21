# Editing, Fades & Automation

> **Skip if:** you're not implementing timeline editing, fades, or parameter automation
> **Prerequisites:** Chapter 04 (Box System), Chapter 08 (Recording)

## Table of Contents

- [Track Editing Capabilities](#track-editing-capabilities)
  - [1. Splitting/Cutting Audio Regions](#1-splittingcutting-audio-regions)
  - [2. Moving Audio Regions](#2-moving-audio-regions)
  - [3. Trimming Audio Regions](#3-trimming-audio-regions)
  - [4. Copying Regions](#4-copying-regions)
  - [5. Region Properties](#5-region-properties)
  - [6. Region-Aware Waveform Visualization](#6-region-aware-waveform-visualization)
- [Complete Editing Workflow Examples](#complete-editing-workflow-examples)
- [Important Notes](#important-notes)
- [Demo Implementation](#demo-implementation)
- [Clip Fades](#clip-fades)
  - [AudioRegionBox Fading Schema](#audioregionbox-fading-schema)
  - [Setting Fades](#setting-fades)
  - [Slope Values and Curve Types](#slope-values-and-curve-types)
  - [How Fades Work Internally](#how-fades-work-internally)
  - [Critical: Fades Are Relative to Region Position](#critical-fades-are-relative-to-region-position)
  - [Region Sorting When Positions Match](#region-sorting-when-positions-match)
  - [Safari/iOS Audio Compatibility](#safariios-audio-compatibility)
- [Advanced: Track Automation](#advanced-track-automation)
  - [Core Concepts](#core-concepts)
  - [Creating Automation Tracks](#creating-automation-tracks)
  - [Event Index (Ordering Tiebreaker)](#event-index-ordering-tiebreaker)
  - [Critical: Event Positions Are Region-Local](#critical-event-positions-are-region-local)
  - [Interpolation Types](#interpolation-types)
  - [Clearing and Replacing Automation Events](#clearing-and-replacing-automation-events)
  - [Effect Parameter Automation](#effect-parameter-automation)
  - [Server Persistence (JSON Data Model)](#server-persistence-json-data-model)
  - [Differences from Tempo Automation](#differences-from-tempo-automation)
  - [Live Automation Recording (SDK 0.0.129+)](#live-automation-recording-sdk-00129)
- [Advanced: Clean Edits & Zero Crossings](#advanced-clean-edits--zero-crossings)
  - [Why Edits Click](#why-edits-click)
  - [How DAWs Handle This](#how-daws-handle-this)
  - [Volume Automation Crossfades](#volume-automation-crossfades)
  - [SDK Notes](#sdk-notes)

---

## Track Editing Capabilities

### 1. Splitting/Cutting Audio Regions

OpenDAW provides robust support for splitting audio regions at specific positions.

#### API: `RegionEditing.cut()`

**Method Signature:**
```typescript
export const cut = (
    region: AnyRegionBoxAdapter,
    cut: ppqn,              // Position where to cut (in PPQN units)
    consolidate: boolean     // Whether to consolidate after cutting
): void
```

**How It Works:**
- Cuts a region at the specified position (in PPQN - Pulses Per Quarter Note)
- Creates two regions: one from start to cut point, another from cut point to end
- For loopable regions, properly handles `loopOffset` and `loopDuration` to maintain loop integrity
- The `consolidate` parameter determines if the new region should share or copy the underlying event collection

**Example Usage:**
```typescript
import { RegionEditing } from "@opendaw/studio-adapters";

// From the OpenDAW timeline UI
editing.modify(() =>
    regionSelection.selected()
        .slice()
        .forEach(region => RegionEditing.cut(region, pointerPulse, !event.shiftKey))
)
```

**User Interaction in OpenDAW:**
- Triggered by **Cmd+Click** (Mac) or **Ctrl+Click** (Windows/Linux) on a region in the timeline
- Hold **Shift** to prevent consolidation (share the same audio data)

### 2. Moving Audio Regions

Audio regions can be moved both horizontally (along the timeline) and vertically (between tracks).

#### Programmatic Movement

The simplest way to move a region is by modifying its `position` field:

```typescript
editing.modify(() => {
    audioRegion.box.position.setValue(newPositionInPPQN)
})
```

#### Advanced Movement with RegionMoveModifier

**Features:**

##### Drag Regions Along the Timeline

Move a region to a new position on the same track:

```typescript
import { PPQN } from "@opendaw/lib-dsp";

// Move region forward by 4 beats
const moveAmount = PPQN.secondsToPulses(1, bpm); // 1 second at given BPM

editing.modify(() => {
  const currentPosition = regionBox.position.getValue();
  regionBox.position.setValue(currentPosition + moveAmount);
});
```

##### Move Regions Between Tracks

Transfer a region from one track to another:

```typescript
// Move region to a different track
editing.modify(() => {
  // Remove from current track
  region.box.regions.defer();

  // Add to target track
  region.box.regions.refer(targetTrack.box.regions);

  // Optionally adjust position
  region.box.position.setValue(newPosition);
});
```

##### Copy Mode (Alt Key)

Create a copy of a region instead of moving it:

```typescript
// Copy region to new position
const copiedRegion = originalRegion.copyTo({
  position: newPosition,
  target: targetTrack.box.regions  // Optional: different track's region collection
});

// Copy maintains all properties: loopOffset, loopDuration, gain, etc.
```

##### Snapping to Grid

Snap positions to musical grid (bars, beats, subdivisions):

```typescript
import { PPQN } from "@opendaw/lib-dsp";

// Helper function to snap to grid
function snapToGrid(position: number, gridSize: number): number {
  return Math.round(position / gridSize) * gridSize;
}

// Example: Snap to quarter note
const { Quarter } = PPQN; // Always 960
const snappedPosition = snapToGrid(dragPosition, Quarter);

editing.modify(() => {
  regionBox.position.setValue(snappedPosition);
});

// Example: Snap to bar (4 beats in 4/4 time)
const bar = Quarter * 4; // 3840 PPQN
const snappedToBar = snapToGrid(dragPosition, bar);
```

##### Multiple Region Selection

Move multiple selected regions together:

```typescript
import { PPQN } from "@opendaw/lib-dsp";

// Track which regions are selected
const selectedRegions: AudioRegionBox[] = [region1, region2, region3];

// Move all selected regions by the same delta
const delta = PPQN.secondsToPulses(2, bpm);

editing.modify(() => {
  selectedRegions.forEach(region => {
    const currentPos = region.position.getValue();
    region.position.setValue(currentPos + delta);
  });
});
```

**Complete Interactive Movement Example:**

```typescript
import { PPQN } from "@opendaw/lib-dsp";

// Example: Click and drag to move a region
const handleRegionDragStart = (region: AudioRegionBox, startX: number) => {
  const startPosition = region.position.getValue();

  const handleMouseMove = (e: MouseEvent) => {
    // Convert pixel delta to PPQN delta
    const pixelDelta = e.clientX - startX;
    const secondsDelta = (pixelDelta / canvasWidth) * maxDuration;
    const ppqnDelta = PPQN.secondsToPulses(secondsDelta, bpm);

    let newPosition = startPosition + ppqnDelta;

    // Optional: Snap to grid
    if (snapEnabled) {
      newPosition = snapToGrid(newPosition, snapGridSize);
    }

    // Clamp to prevent negative positions
    newPosition = Math.max(0, newPosition);

    project.editing.modify(() => {
      region.position.setValue(newPosition);
    });
  };

  const handleMouseUp = () => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
};
```

### 3. Trimming Audio Regions

Regions can be trimmed from both the start and end points.

#### Trimming the Start (Moving In-Point)

```typescript
// Trim start by adjusting position, duration, and loopOffset atomically
editing.modify(() => {
    const delta = trimAmount // Amount to trim in PPQN
    region.box.position.setValue(region.position + delta)
    region.box.duration.setValue(region.duration - delta)
    region.box.loopOffset.setValue((region.loopOffset + delta) % region.loopDuration)
})
```

**UI Interaction:**
- Drag the left edge of a region
- Hold **Ctrl** for aligned mode (all selected regions align)

#### Trimming the End (Moving Out-Point)

```typescript
// Trim end by adjusting duration
editing.modify(() => {
    region.box.duration.setValue(newDuration)
})
```

**UI Interaction:**
- Drag the right edge of a region

### 4. Copying Regions

Regions can be duplicated with optional parameters:

```typescript
const newRegion = audioRegion.copyTo({
    target: targetTrack.box.regions,  // Optional: different track's region collection
    position: newPosition,            // Optional: different position
    duration: newDuration,            // Optional: different duration
    loopOffset: newLoopOffset,        // Optional: different loop offset
    loopDuration: newLoopDuration     // Optional: different loop duration
})
```

### 5. Region Properties

Each audio region has the following editable properties:

```typescript
// AudioRegionBox fields
{
    position: Int32Field        // Timeline start position in PPQN (when to play)
    duration: Float32Field      // Timeline duration — PPQN in Musical timeBase, seconds in Seconds
    loopOffset: Float32Field    // Audio file offset — same unit as duration
    loopDuration: Float32Field  // Audio playback duration — same unit as duration
    gain: Float32Field          // Region gain in dB (decibel constraint)
    mute: BooleanField          // Mute state
    label: StringField          // Region name
    hue: Int32Field             // Color
}
```

**Note:** All time values are in PPQN units (960 per quarter note). Convert using `PPQN.pulsesToSeconds()` and `PPQN.secondsToPulses()` to work with seconds.

**Important Distinction - Position vs LoopOffset:**

- **`position` and `duration`**: Define WHERE the region sits on the timeline (when it plays)
  - Controls the region's placement on the timeline
  - Determines when the region starts and how long it occupies on the timeline

- **`loopOffset` and `loopDuration`**: Define WHICH part of the audio file is played
  - Controls which portion of the source audio file is used
  - Determines where in the audio file to start reading and how much to read

**Example (values shown in seconds for clarity, but stored as PPQN):**
```typescript
// Original region (before split):
// position=0s (0 PPQN), duration=230s (442560 PPQN)
// loopOffset=0s (0 PPQN), loopDuration=230s (442560 PPQN)
// → Plays the entire 230-second audio file starting at timeline position 0

// After splitting at 90 seconds (173520 PPQN):
// Left region:  position=0s, duration=90s, loopOffset=0s, loopDuration=90s
// Right region: position=90s, duration=140s, loopOffset=90s, loopDuration=140s

// If you move the right region to timeline position 120s:
// Right region: position=120s, duration=140s, loopOffset=90s, loopDuration=140s
// → Timeline position changed to 120s, but it still plays audio from 90-230s of the file
// → loopOffset stays at 90s because it defines WHICH audio plays, not WHEN
```

**Understanding loopDuration (Critical Concept):**

`loopDuration` acts as a **"coordinate system"** for mapping PPQN time to audio content. It defines the PPQN equivalent of the audio content duration and must match the actual time length of the audio being played.

**Why loopDuration Stays Constant When Cutting:**

When `RegionEditing.cut()` splits a region, `loopDuration` is intentionally **NOT** updated. Instead, only `loopOffset` and `duration` change. This works because OpenDAW's audio engine clamps the playback range based on each region's `duration`, even though both regions reference the same `loopDuration`.

**Example: Cutting a 10-second region at 5 seconds:**

Before cut:
```typescript
position: 0, duration: 9600 PPQN (10s), loopOffset: 0, loopDuration: 9600 PPQN
→ Plays audio frames 0% to 100% (full 10 seconds)
```

After cut at 4800 PPQN (5 seconds):
```typescript
// First region
position: 0, duration: 4800 PPQN (5s), loopOffset: 0, loopDuration: 9600 PPQN
→ resultEndValue = 4800 / 9600 = 0.5
→ Plays audio frames 0% to 50% (first 5 seconds) ✓

// Second region
position: 4800, duration: 4800 PPQN (5s), loopOffset: 4800, loopDuration: 9600 PPQN
→ resultStartValue = 4800 / 9600 = 0.5
→ Plays audio frames 50% to 100% (last 5 seconds) ✓
```

The `loopDuration` provides the reference length (9600 PPQN = 10 seconds), while `duration` and `loopOffset` select which portion to play.

**Why Pitch Depends on loopDuration:**

OpenDAW calculates playback speed using:
```typescript
stepSize = (audioFrameEnd - audioFrameStart) / outputBufferSize
```

Where:
- `audioFrameEnd = audioFileFrames * (resultEndValue)`
- `resultEndValue` is calculated from `loopDuration`

If you manually change `loopDuration` to a value that doesn't match the audio content's actual duration in PPQN:
- The resultStartValue/resultEndValue fractions become incorrect
- This causes the wrong stepSize calculation
- Wrong stepSize = time-stretching/pitch-shifting

**Example of incorrect loopDuration:**
```typescript
// Audio is actually 10 seconds, but you set loopDuration to 5 seconds:
loopDuration: 4800 PPQN  // Wrong! Should be 9600
→ System thinks it only has 5 seconds of audio to stretch across 10 seconds
→ stepSize becomes 0.5 (half speed)
→ Result: Audio plays at half speed = pitch down by one octave
```

**Important Rules:**

1. **When creating a region:** Set `loopDuration = PPQN.secondsToPulses(audioContentDuration, bpm)`
2. **When cutting a region:** Do NOT change `loopDuration` - it stays constant as the coordinate system
3. **When looping:** Set `duration` as a multiple of `loopDuration` (e.g., `duration = loopDuration * 2` for 2 loops)
4. **Never manually modify `loopDuration`** unless you're intentionally time-stretching/pitch-shifting

### 6. Region-Aware Waveform Visualization

When building a UI with split regions, waveforms need to be rendered based on timeline position to show gaps and splits correctly.

#### Timeline-Based Rendering

Render waveforms by specifying both the canvas position (where to draw) and the audio position (which audio to show):

```typescript
import { PPQN } from "@opendaw/lib-dsp";

// For each region in the track
regions.forEach(region => {
  // Calculate timeline position (WHERE on the canvas)
  const regionStartSeconds = PPQN.pulsesToSeconds(region.position, bpm);
  const regionDurationSeconds = PPQN.pulsesToSeconds(region.duration, bpm);

  const x0 = Math.floor((regionStartSeconds / maxDuration) * canvas.width);
  const x1 = Math.floor(((regionStartSeconds + regionDurationSeconds) / maxDuration) * canvas.width);

  // Calculate which audio to show (WHICH part of the audio file)
  const loopOffsetSeconds = PPQN.pulsesToSeconds(region.loopOffset, bpm);

  // Use region.duration (not loopDuration) to determine how much audio to show
  const u0 = Math.floor((loopOffsetSeconds / audioBuffer.duration) * peaks.numFrames);
  const u1 = Math.floor(((loopOffsetSeconds + regionDurationSeconds) / audioBuffer.duration) * peaks.numFrames);

  // Render peaks from frames u0-u1 to canvas positions x0-x1
  PeaksPainter.renderPixelStrips(context, peaks, channel, {
    x0, x1,  // Canvas pixel positions
    y0, y1,  // Vertical position
    u0, u1,  // Frame indices in peaks data
    v0: -1, v1: 1  // Amplitude range
  });
});
```

**Key Points:**

1. **Calculate canvas positions from timeline time** - Use `position` and `duration` to determine where on the canvas to draw (x0, x1)
2. **Use `loopOffset` for audio selection** - Tells you which part of the audio file to show (u0, u1 frame indices)
3. **Use `region.duration` (not `loopDuration`)** - For calculating how much audio to display
4. **Gaps appear automatically** - When regions don't fill the timeline, gaps show as black space

**Example Implementation:**

See `src/hooks/useWaveformRendering.ts` for a complete React hook implementation that:
- Subscribes to region changes
- Renders waveforms with region awareness
- Handles canvas resizing and repainting
- Shows gaps when regions are moved

#### TracksContainer Component

For building timeline-based UIs, use a container with absolute-positioned playhead overlay:

```typescript
<TracksContainer
  currentPosition={currentPosition}
  bpm={120}
  maxDuration={maxDuration}
  leftOffset={200}  // Width of track controls area
>
  <TimelineRuler maxDuration={maxDuration} />
  {tracks.map(track => <TrackRow {...track} />)}
</TracksContainer>
```

This ensures:
- Playhead aligns correctly with waveforms
- Timeline ruler matches waveform positions
- Consistent positioning across all visual elements

---

## Complete Editing Workflow Examples

Here are practical examples for common editing operations:

### Example 1: Split a Drum Region

```typescript
import { RegionEditing } from "@opendaw/studio-adapters"
import { PPQN } from "@opendaw/lib-dsp"

const { Quarter } = PPQN; // Always 960

// Split at bar 8 (4/4 time)
const bar8Position = Quarter * 4 * 8 // 30720 PPQN

editing.modify(() => {
    RegionEditing.cut(drumRegion, bar8Position, true)
})
```

### Example 2: Move a Vocal Region

```typescript
import { PPQN } from "@opendaw/lib-dsp"

const { Quarter } = PPQN; // Always 960

// Move to start at bar 4
const bar4Position = Quarter * 4 * 4 // 15360 PPQN

editing.modify(() => {
    vocalRegion.box.position.setValue(bar4Position)
})
```

### Example 3: Copy and Rearrange

```typescript
import { PPQN } from "@opendaw/lib-dsp"

const { Quarter } = PPQN; // Always 960

// Copy a bass line to a different position
const basslineCopy = bassRegion.copyTo({
    position: Quarter * 4 * 16, // Bar 16 = 61440 PPQN
    target: bassTrack.box.regions
})
```

### Example 4: Trim a Guitar Region

```typescript
import { PPQN } from "@opendaw/lib-dsp"

const { Quarter } = PPQN; // Always 960

// Trim 2 beats from the start
const trimAmount = Quarter * 2 // 2 beats = 1920 PPQN

editing.modify(() => {
    guitarRegion.box.position.setValue(guitarRegion.position + trimAmount)
    guitarRegion.box.duration.setValue(guitarRegion.duration - trimAmount)
    guitarRegion.box.loopOffset.setValue(
        (guitarRegion.loopOffset + trimAmount) % guitarRegion.loopDuration
    )
})
```

### Example 5: Adjust Region Gain

```typescript
// Set region gain to -6 dB (gain field is in dB, not a 0-1 range)
editing.modify(() => {
    audioRegion.box.gain.setValue(-6)
})
```

### Example 6: Update Region Info for Waveform Rendering

```typescript
import { RegionEditing } from "@opendaw/studio-adapters";
import { UUID } from "@opendaw/lib-std";

// Create a map of regions for each track to pass to waveform rendering
const updateRegionInfo = (project: Project) => {
  const regionMap = new Map<string, any[]>();

  tracks.forEach(track => {
    const regionList: any[] = [];
    const pointers = track.trackBox.regions.pointerHub.incoming();

    pointers.forEach(({box}) => {
      if (!box) return;
      const regionBox = box as AudioRegionBox;

      regionList.push({
        uuid: UUID.toString(regionBox.address.uuid),
        position: regionBox.position.getValue(),
        duration: regionBox.duration.getValue(),
        loopOffset: regionBox.loopOffset.getValue(),
        loopDuration: regionBox.loopDuration.getValue(),
        label: regionBox.label.getValue()
      });
    });

    regionMap.set(track.name, regionList);
  });

  return regionMap;
};

// Use this after editing operations
project.editing.modify(() => {
  RegionEditing.cut(region, cutPosition, true);
});

// Update region info to trigger waveform re-render
const regionInfo = updateRegionInfo(project);
```

---

## Important Notes

### PPQN Units

All positions and durations in OpenDAW are expressed in **PPQN** (Pulses Per Quarter Note) units, not seconds or samples. The standard PPQN value is 960 (available as `PPQN.Quarter`).

**Converting between time units:**
```typescript
import { PPQN } from "@opendaw/lib-dsp"

// Seconds to PPQN
const ppqn = PPQN.secondsToPulses(durationInSeconds, bpm)

// PPQN to seconds
const seconds = PPQN.pulsesToSeconds(ppqn, bpm)
```

### Editing Context

All modifications should be wrapped in `editing.modify(() => {...})` for proper undo/redo support:

```typescript
project.editing.modify(() => {
    // Make all your changes here
    region1.box.position.setValue(newPos1)
    region2.box.position.setValue(newPos2)
})
```

### Loopable Regions

Audio regions support looping with independent `loopOffset` and `loopDuration` parameters. When trimming regions, these must be updated to maintain proper loop behavior.

### Visual Consistency with Timeline-Based Rendering

When implementing waveform visualization:

1. **Use timeline-based positioning** - Calculate canvas positions based on the region's timeline position and duration. This ensures waveforms look identical before and after splitting.

2. **Waveforms should stay in place when splitting** - The visual appearance should not change when a region is split. Both resulting regions should show exactly the same waveforms they had before the split.

3. **Peaks move with regions** - When a region is moved, its waveform peaks should move with it, because `loopOffset` stays constant and tells which audio to play.

### Region Consolidation

When cutting regions, the `consolidate` parameter determines data sharing:
- **`consolidate: false`**: New regions share the same underlying audio data (mirrored)
- **`consolidate: true`**: New region gets an independent copy of the audio data

To manually consolidate a region, use `copyTo` with the `consolidate` flag:
```typescript
editing.modify(() => {
    audioRegion.copyTo({ consolidate: true })
})
```

### Region Transfer (Cross-Track/Cross-Project Copy)

For copying regions between tracks or projects, `@opendaw/studio-adapters` provides `TransferRegions`:

```typescript
import { TransferRegions } from "@opendaw/studio-adapters";

// Copy regions from one track to another
// TransferRegions handles the underlying box graph operations,
// including audio file references and event collections
```

For copying entire mixer channels (with effects, routing, and automation), use `TransferAudioUnits`:

```typescript
import { TransferAudioUnits } from "@opendaw/studio-adapters";

// Copy audio units between projects or duplicate within a project
```

---

## Demo Implementation

For a complete working example of region-aware waveform visualization and track editing, see:

- **Demo:** `src/demos/playback/track-editing-demo.tsx`
- **Waveform Hook:** `src/hooks/useWaveformRendering.ts`
- **TracksContainer:** `src/components/TracksContainer.tsx`
- **Playhead Component:** `src/components/Playhead.tsx`

The demo shows:
- Splitting regions at playhead position
- Moving individual or all regions forward/backward
- Region selection with visual feedback
- Timeline-based waveform rendering with gaps
- Correct peak visualization after splits and moves

---

## Clip Fades

> **Skip if:** you don't need fade-in/fade-out on regions

OpenDAW supports per-region fade-in and fade-out via the `fading` object on `AudioRegionBox`. Fades are applied as gain envelopes during audio processing — they are non-destructive and do not modify the underlying audio data.

### AudioRegionBox Fading Schema

Each `AudioRegionBox` has a `fading` object with four fields:

| Field | Type | Default | Unit | Description |
|-------|------|---------|------|-------------|
| `fading.in` | float32 | 0.0 | PPQN | Fade-in duration |
| `fading.out` | float32 | 0.0 | PPQN | Fade-out duration |
| `fading.inSlope` | float32 | 0.75 | ratio (0-1) | Fade-in curve shape |
| `fading.outSlope` | float32 | 0.25 | ratio (0-1) | Fade-out curve shape |

Source: `AudioRegionBox.ts` field 18 in `packages/studio/forge-boxes/src/schema/std/timeline/`

### Setting Fades

```typescript
import { AudioRegionBoxAdapter } from "@opendaw/studio-adapters";

project.editing.modify(() => {
  // Fade durations in PPQN (960 = 1 quarter note at any BPM)
  adapter.fading.inField.setValue(1920);       // 2 beats fade-in
  adapter.fading.outField.setValue(1920);      // 2 beats fade-out

  // Slope controls curve shape
  adapter.fading.inSlopeField.setValue(0.75);  // Exponential
  adapter.fading.outSlopeField.setValue(0.25); // Logarithmic
});
```

Fades can be set in the same `editing.modify()` transaction as region property changes (position, duration, loopOffset). No separate transaction is needed.

### FadingAdapter Convenience Methods

Beyond raw field access, the `FadingAdapter` on `AudioRegionBoxAdapter` provides convenience methods:

```typescript
const fading = adapter.fading;

// Check if any fades are active (quick guard for rendering)
if (fading.hasFading) {
  // Render fade curves on canvas
}

// Copy all fade settings to another region
fading.copyTo(targetAdapter.fading);

// Reset all fades to zero (remove fades)
fading.reset();

// Read-only shorthand for current values
const fadeInPpqn = fading.in;
const fadeOutPpqn = fading.out;
const inCurve = fading.inSlope;
const outCurve = fading.outSlope;
```

Use `.hasFading` as a rendering guard — skip fade curve drawing when false. Use `.copyTo()` for "paste fade settings" across regions. Use `.reset()` for "clear all fades" on selected regions.

### Slope Values and Curve Types

The slope parameter (0.0 to 1.0) controls the shape of the fade curve using an exponential formula:

| Slope | Curve Type | Character | Best For |
|-------|-----------|-----------|----------|
| 0.25 | Logarithmic | Slow start, fast end | Fade-outs (SDK default for `outSlope`) |
| 0.50 | Linear | Even progression | Neutral, technical fades |
| 0.75 | Exponential | Fast start, slow end | Fade-ins (SDK default for `inSlope`) |

#### Curve Formula

The curve is computed by `Curve.normalizedAt()`:

```typescript
function normalizedAt(x: number, slope: number): number {
  if (slope ≈ 0.5) return x; // Linear shortcut
  const p = clamp(slope, EPSILON, 1 - EPSILON);
  return (p² / (1 - 2p)) * (((1 - p) / p)^(2x) - 1);
}
```

This produces monotonic curves only. S-curves are not possible with a single slope parameter.

### How Fades Work Internally

#### Processing Pipeline

1. **FadingAdapter** (`packages/studio/adapters/src/timeline/region/FadingAdapter.ts`)
   - Wraps the `fading` box fields and implements `FadingEnvelope.Config`
   - Provides `inField`, `outField`, `inSlopeField`, `outSlopeField` accessors

2. **FadingEnvelope.fillGainBuffer** (`packages/lib/dsp/src/fading.ts`)
   - Called by `TapeDeviceProcessor` during audio rendering
   - Fills a gain buffer that is multiplied with the audio output
   - Computes position relative to region start: `startPpqn = cycle.resultStart - regionPosition`

3. **TapeDeviceProcessor** (`packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts`)
   - Checks `hasFading` flag on the region
   - Calls `fillGainBuffer()` to get per-sample gain values
   - Multiplies audio output by the gain buffer

#### The Gain Buffer Algorithm

```
fillGainBuffer(buffer, startPpqn, endPpqn, fadeIn, fadeOut, inSlope, outSlope, regionDuration):
  1. Fill entire buffer with 1.0 (full volume)
  2. If startPpqn >= fadeIn AND endPpqn <= (regionDuration - fadeOut):
     → Early return (entirely between fades, no processing needed)
  3. For fade-in zone (startPpqn < fadeIn):
     → Apply curve: gain = normalizedAt(position / fadeIn, inSlope)
  4. For fade-out zone (endPpqn > regionDuration - fadeOut):
     → Apply curve: gain = 1 - normalizedAt(position / fadeOut, outSlope)
```

### Critical: Fades Are Relative to Region Position

Fades are calculated relative to the **region's position**, not the timeline. This has important implications:

```
startPpqn = cycle.resultStart - regionPosition
```

If a region spans the full audio file (e.g., position=0, duration=450000 PPQN for a 4-minute file) but playback starts at bar 18 (PPQN 65280), then:

- `startPpqn = 65280 - 0 = 65280`
- With a 2-beat fade-in (`fadeIn = 1920`): `65280 >= 1920` triggers the early-return
- **Result: gain stays at 1.0, fades are never audible**

#### Solution: Trim Regions to Short Clips

To make fades audible on a specific section of audio, trim the region:

```typescript
const clipStartPPQN = PPQN.Bar * 17;  // Bar 18 (0-indexed)
const clipDurationPPQN = PPQN.Bar * 4; // 4 bars

project.editing.modify(() => {
  adapter.box.position.setValue(clipStartPPQN);      // Timeline position
  adapter.box.duration.setValue(clipDurationPPQN);    // Clip length
  adapter.box.loopOffset.setValue(clipStartPPQN);     // Read audio from bar 18
  // loopDuration can stay at full audio length — duration limits playback

  // Now fades work: startPpqn = 65280 - 65280 = 0, which IS in the fade zone
  adapter.fading.inField.setValue(1920);   // 2 beats
  adapter.fading.outField.setValue(1920);  // 2 beats
  adapter.fading.inSlopeField.setValue(0.5);
  adapter.fading.outSlopeField.setValue(0.5);
});
```

### Region Sorting When Positions Match

When multiple regions share the same timeline position (e.g., same clip trimmed for different fade types), sorting by position is non-deterministic. Use labels for stable ordering:

```typescript
// Set labels during creation
adapter.box.label.setValue("Logarithmic");

// Sort by label
const fadeTypeIndex = (label: string) =>
  FADE_TYPES.findIndex(ft => label.startsWith(ft.name));

regionAdapters.sort((a, b) =>
  fadeTypeIndex(a.box.label.getValue()) - fadeTypeIndex(b.box.label.getValue())
);
```

### Safari/iOS Audio Compatibility

Safari cannot decode Ogg Opus files via `decodeAudioData`, even though `canPlayType` returns `"maybe"`. Provide m4a (AAC) fallback files and detect the browser via user agent:

```typescript
// src/lib/audioUtils.ts
export function getAudioExtension(): string {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    || /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isSafari ? "m4a" : "opus";
}
```

iOS Safari also re-suspends AudioContext after backgrounding. Before calling `play()`:

```typescript
if (audioContext.state !== "running") {
  await audioContext.resume();
  // Wait for statechange event — iOS may not be "running" yet
  await new Promise<void>(resolve => {
    if (audioContext.state === ("running" as AudioContextState)) {
      resolve();
      return;
    }
    audioContext.addEventListener("statechange", function handler() {
      if (audioContext.state === ("running" as AudioContextState)) {
        audioContext.removeEventListener("statechange", handler);
        resolve();
      }
    });
  });
}
```

**Demo:** See `src/demos/playback/clip-fades-demo.tsx` for a complete working example that:

- Loads three copies of the same audio file
- Trims them to 4-bar clips at bar 18
- Applies different fade curves (logarithmic, linear, exponential) to each
- Lets users play individual tracks to compare fade characteristics
- Visualizes the fade curves on canvas elements

---

## Advanced: Track Automation

> **Skip if:** you don't need volume/pan/effect parameter automation

Track automation allows you to automate any parameter on an AudioUnit (volume, panning) or effect device (reverb wet, delay feedback, etc.) over time using automation lanes with interpolated events.

### Core Concepts

#### Automation Tracks

An automation track is a `TrackBox` that targets a specific parameter field on an AudioUnit. The track contains `ValueRegionBox` regions, which hold `ValueEventCollectionBox` collections of automation events.

```
AudioUnitBox
└── tracks (TrackCollection)
    └── TrackBox (type: Value)
        └── target → parameter field (e.g., audioUnitBox.volume)
        └── regions
            └── ValueRegionBox
                └── ValueEventCollectionBox
                    └── ValueEventBox (position, value, interpolation)
```

#### Automatable Parameters

Any `Float32Field<Pointers.Automation>` is automatable:

- **AudioUnitBox**: `volume`, `panning`
- **ReverbDeviceBox**: `decay`, `preDelay`, `damp`, `filter`, `wet`, `dry`
- **CompressorDeviceBox**: `threshold`, `ratio`, `attack`, `release`, `makeup`
- **DelayDeviceBox**: all parameters
- All other effect device boxes follow the same pattern

#### Value Mapping: Same UnitValue, Different dB Ranges

Automation events use **unitValue** (0.0–1.0) for all parameters. The `AutomatableParameterFieldAdapter.valueAt()` method applies the parameter's `ValueMapping` to convert the unitValue to the actual dB or parameter value before it reaches the processor. The processor never sees unitValues — it receives the mapped value (e.g., dB).

| Parameter | ValueMapping | unitValue 0.0 | unitValue 0.5 | unitValue 1.0 |
|-----------|-------------|---------------|---------------|---------------|
| Track volume | `decibel(-96, -9, +6)` | -inf | -9 dB | +6 dB |
| Reverb wet/dry | `DefaultDecibel = decibel(-72, -12, 0)` | -inf | -12 dB | 0 dB |
| Synth osc volume | `DefaultDecibel` | -inf | -12 dB | 0 dB |
| Stereo Tool volume | `decibel(-72, 0, +12)` | -inf | 0 dB | +12 dB |

The `Decibel` class formula (`value-mapping.js`): when `x <= 0.0` returns `-Infinity`; when `x >= 1.0` returns `max`; otherwise uses a Möbius transform `a - b/(x + c)` where coefficients are derived from `(min, mid, max)`.

**Key takeaway:** unitValue `0.5` on track volume = -9 dB, but unitValue `0.5` on reverb wet = -12 dB. The same automation curve produces different sonic results on different parameters.

#### Converting Between dB and UnitValue

Each `ValueMapping` provides bidirectional conversion:
- `y(unitValue)` → dB value (what the processor receives)
- `x(dbValue)` → unitValue (what automation events store)

Use the static `VolumeMapper` on `AudioUnitBoxAdapter` to convert:

```typescript
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";

// unitValue for 0 dB (unity gain) on track volume
const unity = AudioUnitBoxAdapter.VolumeMapper.x(0);  // ≈ 0.734

// What dB does unitValue 0.5 map to?
const db = AudioUnitBoxAdapter.VolumeMapper.y(0.5);   // -9 dB
```

For other parameters, create the mapping directly:

```typescript
import { ValueMapping } from "@opendaw/lib-std";

const reverbWetMapping = ValueMapping.DefaultDecibel;  // decibel(-72, -12, 0)
const wetUnity = reverbWetMapping.x(0);                // unitValue for 0 dB wet
```

This is useful for setting automation events at musically meaningful levels (e.g., fade to 0 dB instead of the mapping's maximum).

### Creating Automation Tracks

```typescript
import { TrackBox, ValueRegionBox } from "@opendaw/studio-boxes";
import { ValueRegionBoxAdapter } from "@opendaw/studio-adapters";
import { Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";

// Step 1: Create the automation track (separate transaction from instrument creation)
let trackBox: TrackBox;
project.editing.modify(() => {
  trackBox = project.api.createAutomationTrack(audioUnitBox, audioUnitBox.volume);
});

// Step 2: Create a region and populate with events
project.editing.modify(() => {
  const regionOpt = project.api.createTrackRegion(trackBox, startPosition, duration);
  if (regionOpt.isEmpty()) return;

  const regionBox = regionOpt.unwrap() as ValueRegionBox;
  const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
  const collection = adapter.optCollection.unwrap();

  collection.createEvent({
    position: 0 as ppqn,       // region-local position
    index: 0,                  // ordering tiebreaker for events at the same position
    value: 0.0,                // unitValue 0..1
    interpolation: Interpolation.Linear,
  });

  collection.createEvent({
    position: duration as ppqn,
    index: 0,
    value: 1.0,
    interpolation: Interpolation.None,
  });
});
```

### Event Index (Ordering Tiebreaker)

The `index` field on automation events is an integer used to order events that share the same PPQN position. The SDK sorts events by `(position, index)`:

```typescript
ValueEvent.Comparator = (a, b) => {
  const positionDiff = a.position - b.position;
  if (positionDiff !== 0) return positionDiff;
  return a.index - b.index; // tiebreaker
};
```

This is useful for step changes where you need two values at the same moment (e.g., jump from 0.8 to 0.2 at bar 4 — event at index 0 with value 0.8, event at index 1 with value 0.2). For most automation, use `index: 0`.

### Critical: Event Positions Are Region-Local

**Automation event positions are relative to the region, NOT absolute timeline positions.**

`ValueRegionBoxAdapter.valueAt()` calls `LoopableRegion.globalToLocal()` before looking up events:

```
globalToLocal(region, ppqn) = mod(ppqn - region.position + region.loopOffset, region.loopDuration)
```

If a region is at position 61440 (bar 17) with `loopOffset=0` and `loopDuration=30720`:
- Engine at position 61440 → local position 0 (start of events)
- Engine at position 76800 → local position 15360 (mid-region)
- Engine at position 92160 → local position 30720 (end of events)

**Events at absolute positions (e.g., 61440) would be interpreted as 61440 PPQN into a 30720-length region — past the end, so automation never triggers.**

### Interpolation Types

Three interpolation modes are available, imported from `@opendaw/lib-dsp`:

```typescript
import { Interpolation } from "@opendaw/lib-dsp";

Interpolation.None           // Step/hold: value stays constant until next event
Interpolation.Linear         // Linear ramp between events
Interpolation.Curve(slope)   // Möbius-Ease curve (slope: 0.0–1.0)
```

#### Möbius-Ease Curve (Curve.normalizedAt)

The curve interpolation uses an exponential formula from `@opendaw/lib-std`:

```typescript
import { Curve } from "@opendaw/lib-std";

// Curve.normalizedAt(x, slope) where x is 0..1 normalized position
// slope < 0.5 → flat start, steep end (exponential feel)
// slope = 0.5 → linear (equivalent to Interpolation.Linear)
// slope > 0.5 → steep start, flat end (logarithmic feel)
```

The actual formula:
```
normalizedAt(x, slope) = (p²) / (1 - 2p) × (((1-p)/p)^(2x) - 1)
```
where `p = clamp(slope, ε, 1-ε)`.

Reference: http://werner.yellowcouch.org/Papers/fastenv12/index.html

**This is NOT a quadratic bezier.** When rendering curves on a canvas, import and use `Curve.normalizedAt` directly to match the engine's computation:

```typescript
import { Curve } from "@opendaw/lib-std";

// Sample the curve for canvas rendering
const segments = 40;
for (let s = 1; s <= segments; s++) {
  const t = s / segments;
  const normalized = Curve.normalizedAt(t, slope);
  const value = startValue + normalized * (endValue - startValue);
  ctx.lineTo(x, toY(value));
}
```

#### Common Curve Shapes

| Slope | Shape | Use Case |
|-------|-------|----------|
| 0.25 | Flat start, steep end (exponential feel) | Fade in from silence |
| 0.50 | Linear (becomes `Interpolation.Linear`) | Even ramps |
| 0.75 | Steep start, flat end (logarithmic feel) | Fade out, natural decay |

For a **round swell** (smooth hill shape):
- Rise: `Curve(0.75)` — steep start, decelerates toward peak
- Fall: `Curve(0.25)` — slow departure from peak, accelerates drop

### Clearing and Replacing Automation Events

To switch presets or clear automation, delete existing regions and create new ones:

```typescript
import { ValueRegionBox } from "@opendaw/studio-boxes";
import { ValueRegionBoxAdapter } from "@opendaw/studio-adapters";

function clearAutomation(project: Project, trackBox: TrackBox): void {
  const boxes = project.boxGraph.boxes();
  const existingRegions = boxes.filter(
    (box: any) =>
      box instanceof ValueRegionBox &&
      box.regions.targetVertex.nonEmpty() &&
      box.regions.targetVertex.unwrap().box === trackBox
  );

  project.editing.modify(() => {
    for (const region of existingRegions) {
      const adapter = project.boxAdapters.adapterFor(region, ValueRegionBoxAdapter);
      const collectionOpt = adapter.optCollection;
      if (collectionOpt.nonEmpty()) {
        collectionOpt.unwrap().events.asArray().forEach((evt: any) => evt.box.delete());
      }
      region.delete();
    }
  });
}
```

### Effect Parameter Automation

To automate an effect parameter, first insert the effect, then create an automation track targeting the parameter:

```typescript
import { EffectFactories } from "@opendaw/studio-core";
import { ReverbDeviceBox } from "@opendaw/studio-boxes";

// Insert effect (EffectBox is a union type — cast directly to device box)
let reverbBox: ReverbDeviceBox;
project.editing.modify(() => {
  const effectBox = project.api.insertEffect(
    audioUnitBox.audioEffects,
    EffectFactories.Reverb
  );
  reverbBox = effectBox as ReverbDeviceBox;
});

// Create automation track for the wet parameter (separate transaction)
let wetTrackBox: TrackBox;
project.editing.modify(() => {
  wetTrackBox = project.api.createAutomationTrack(audioUnitBox, reverbBox.wet);
});
```

**Note:** `EffectBox` is a union type (`ReverbDeviceBox | CompressorDeviceBox | ...`), not a wrapper. `insertEffect()` returns the device box directly.

### Server Persistence (JSON Data Model)

When saving automation state to a server, capture these fields per automation track:

```json
{
  "automationTrack": {
    "targetParameter": "volume",
    "targetUnitId": "uuid-string",
    "enabled": true,
    "events": [
      {
        "position": 0,
        "value": 0.0,
        "index": 0,
        "interpolation": { "type": "curve", "slope": 0.75 }
      },
      {
        "position": 15360,
        "value": 1.0,
        "index": 0,
        "interpolation": { "type": "none" }
      }
    ]
  }
}
```

Event fields:
- **position** (int32): Region-local position in PPQN
- **value** (float32): Parameter value as unitValue (0.0–1.0)
- **index** (int32): Ordering tiebreaker for events at the same position (usually 0)
- **interpolation**: How to transition from this event to the next

Interpolation types in JSON:
- `{ "type": "none" }` — step/hold
- `{ "type": "linear" }` — linear ramp
- `{ "type": "curve", "slope": 0.25 }` — Möbius-Ease with slope

The SDK's native persistence uses binary serialization (`project.toArrayBuffer()` → `.odaw` format), but the JSON above represents the same data for server-side storage.

### Differences from Tempo Automation

Tempo automation uses a special accessor on the timeline:

```typescript
// Tempo: special timeline accessor, events use absolute positions
project.timelineBoxAdapter.tempoTrackEvents.ifSome(collection => {
  collection.createEvent({ position, index: 0, value: bpm, interpolation });
});

// Track automation: create track + region, events use region-local positions
const trackBox = project.api.createAutomationTrack(audioUnitBox, field);
const regionOpt = project.api.createTrackRegion(trackBox, position, duration);
// ... events at local positions within the region
```

Key differences:
- Tempo events are **absolute** timeline positions; track automation events are **region-local**
- Tempo uses `tempoTrackEvents` accessor; track automation uses `createAutomationTrack` + `createTrackRegion`
- Tempo values are BPM; track automation values are unitValue (0..1)

### Live Automation Recording (SDK 0.0.129+)

The SDK supports recording parameter changes in real-time during playback. When a user interacts with an automatable parameter (e.g., drags a volume fader) while recording, the engine captures those movements as `ValueEventBox` entries inside a `ValueRegionBox` on an automation track.

#### Automation Modes

```typescript
type AutomationMode = "read" | "touch" | "latch"
```

| Mode | Behavior |
|------|----------|
| **Read** | Parameter follows existing automation. User input ignored during recording. |
| **Touch** | User interaction overrides and records. On release, returns to automated value. |
| **Latch** | Like touch, but holds the last value after release instead of returning. |

**Current state:** Only touch mode has behavioral implementation. Latch and read have type definitions and storage (`setMode`/`getMode` on `ParameterFieldAdapters`) but `getMode()` is never called — no behavioral distinction yet. The plan documents state mode differentiation is a separate implementation step.

#### How Touch Recording Works

The recording flow uses a "touch" metaphor — the user presses (touches) a parameter control, moves it, then releases:

1. **Touch start** — `adapter.touchStart()` marks the parameter as "touched" and emits the current value
2. **Value changes** — each `setValue()` call triggers `notifyWrite()`, which `RecordAutomation` captures as events at the current timeline position
3. **Touch end** — `adapter.touchEnd()` finalizes the automation region (sets duration, adds hold event, runs simplification)

In the OpenDAW app, every automatable knob/slider is wrapped in an `AutomationControl` component that binds `pointerdown` → `touchStart()` and `pointerup` → `touchEnd()`.

#### Enabling Automation Recording

Automation recording is controlled by a recording preference (default: `true`):

```typescript
project.engine.preferences.settings.recording.automationEnabled = true;
```

When enabled, `Recording.start()` subscribes `RecordAutomation` to parameter write events. Only parameters that are "touched" (via `touchStart()`) are recorded — untouched parameter changes are ignored.

#### Programmatic API

The touch/record cycle can be driven programmatically without UI:

```typescript
// 1. Get the AutomatableParameterFieldAdapter for a parameter
//    (created by device box adapters, e.g., AudioUnitBoxAdapter for .volume)
const adapter: AutomatableParameterFieldAdapter = /* ... */;

// 2. Register tracks so RecordAutomation can find/create automation tracks
adapter.registerTracks(audioUnitTracks);

// 3. Start recording
await project.startRecording(false);

// 4. Simulate "touching" the parameter
adapter.touchStart();

// 5. Change the value over time
project.editing.modify(() => adapter.setUnitValue(0.3));
// ... time passes (AnimationFrame, setTimeout, etc.) ...
project.editing.modify(() => adapter.setUnitValue(0.7));

// 6. Release the "touch" — finalizes the automation region
adapter.touchEnd();

// 7. Stop recording
project.engine.stopRecording();
```

#### Post-Recording Simplification

After `touchEnd()`, the engine runs a Ramer-Douglas-Peucker simplifier (epsilon = 0.01) on the recorded events to remove redundant linear points. This reduces event count while preserving the automation curve shape.

#### Loop Recording

During loop recording, `RecordAutomation` handles loop-wrap detection. When the transport wraps past the loop end:
- Active recordings are finalized (duration set to loop boundary)
- New regions are created for the next loop pass
- The simplifier runs on the completed region

#### Key Types and APIs

```typescript
import { AutomationMode } from "@opendaw/studio-adapters";

// ParameterFieldAdapters (on project context)
parameterFieldAdapters.touchStart(address)      // Mark parameter as touched
parameterFieldAdapters.touchEnd(address)        // Release touch, finalize recording
parameterFieldAdapters.isTouched(address)       // Check if currently touched
parameterFieldAdapters.setMode(address, mode)   // Set automation mode (infrastructure only)
parameterFieldAdapters.getMode(address)         // Get automation mode (not yet used by engine)
parameterFieldAdapters.registerTracks(address, tracks)  // Register tracks for recording
parameterFieldAdapters.subscribeTouchEnd(observer)      // Observe touch-end events
```

#### Standalone Demo (Future)

A standalone automation recording demo could show:
- Live parameter recording during playback (volume fade via programmatic touch)
- Visualizing recorded events on a canvas after recording stops
- Comparing hand-drawn automation curves vs preset curves
- Loop recording with automation overdubs

This would complement the existing track-automation-demo which creates automation events purely through code.

**Reference:**

- Demo: `src/demos/automation/track-automation-demo.tsx`
- SDK curve algorithm: `@opendaw/lib-std` → `Curve.normalizedAt`
- SDK interpolation: `@opendaw/lib-dsp` → `value.ts` → `interpolate()`
- SDK region mapping: `@opendaw/lib-dsp` → `events.ts` → `LoopableRegion.globalToLocal`
- SDK adapter: `@opendaw/studio-adapters` → `ValueRegionBoxAdapter`, `ValueEventCollectionBoxAdapter`
- SDK automation recording: `@opendaw/studio-core` → `capture/RecordAutomation.ts`
- SDK touch management: `@opendaw/studio-adapters` → `ParameterFieldAdapters.ts`, `AutomatableParameterFieldAdapter.ts`
- Effect parameter docs: `documentation/11-effects.md`

---

## Advanced: Clean Edits & Zero Crossings

> **Skip if:** you don't need to splice audio or manage transitions between regions

### Why Edits Click

A digital audio waveform oscillates above and below zero (silence). A **zero crossing** is where the waveform passes through zero. When you cut audio, the edit point creates a boundary between two regions. If the waveform isn't at or near zero at that boundary, the abrupt amplitude jump produces a click or pop — the speaker cone is forced to jump instantaneously.

The severity depends on the audio content at the boundary:
- **Loud and sustained** (vocals, pads, strings) — clearly audible pop
- **Percussive or sparse** (drums, staccato notes, silence) — often masked naturally
- **Near a zero crossing** — minimal or no pop

### How DAWs Handle This

Professional DAWs use two complementary techniques:

1. **Snap to zero crossing** — the edit tool automatically finds the nearest zero crossing to the user's click position, so the cut lands where the waveform is already at zero
2. **Short crossfade** — a brief (~10-20ms) overlap crossfade smooths out any remaining discontinuity at the edit point

The SDK does not currently provide either mechanism automatically.

### Non-Overlapping Fades Make It Worse

Adding a fade-out and fade-in without overlap creates a V-shaped volume dip at the splice point. The signal ramps to near-zero and back, which is heard as a pop. For same-file consecutive regions where the audio samples are already continuous, no fade is needed — adding fades makes it worse. Fades only help when splicing *different* audio content where the waveforms are discontinuous.

### Volume Automation Crossfades

For seamless transitions between different audio sections (e.g., take comping), use multiple tracks with volume automation instead of splitting regions:

1. Each section is a separate instrument track with its own audio region
2. Each track has a volume automation track targeting `audioUnitBox.volume`
3. At boundaries, the outgoing track's volume ramps to -inf while the incoming track ramps to 0dB
4. `Interpolation.Curve(0.25)` for fade-out, `Interpolation.Curve(0.75)` for fade-in produces a smooth sigmoid crossfade
5. All tracks play continuously — no region splitting needed

See the [Comp Lanes demo](https://opendaw-test.pages.dev/comp-lanes-demo.html) for a working example.

### SDK Notes

#### Voice Fade Behavior

The SDK's `TapeDeviceProcessor` creates a separate voice per region with a built-in 20ms crossfade on creation and eviction. When one region ends and the next begins, this creates a brief V-shaped volume dip at the boundary. The voice fade is independent of region-level fading and is not configurable from the API.

#### Automation Events at Same Position

The SDK uses `(position, index)` as a composite key for automation events. Two events at the same PPQN with the same `index` cause a panic. When building crossfade automation, assign incrementing `index` values per position.

---

## References

- [Timing & Tempo](./02-timing-and-tempo.md)
- [Box System & Reactivity](./04-box-system-and-reactivity.md)
- [Timeline & Rendering](./06-timeline-and-rendering.md)
- [Effects](./11-effects.md)
