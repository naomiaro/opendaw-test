# Track Editing and Fade Functionality in OpenDAW

## Overview

This document covers the track editing capabilities available in OpenDAW, with a focus on audio region manipulation and the current status of fade functionality.

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
  region.box.regions.unrefer();

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
  track: targetTrack.box.regions  // Optional: different track
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
    track: targetTrack.box.regions,  // Optional: different track
    position: newPosition,            // Optional: different position
    duration: newDuration,            // Optional: different duration
    loopOffset: newLoopOffset,        // Optional: different loop offset
    loopDuration: newLoopDuration     // Optional: different loop duration
})
```

### 5. Region Properties

Each audio region has the following editable properties:

```typescript
// AudioRegionBox fields (all time values in PPQN)
{
    position: Int32Field        // Timeline start position (when to play)
    duration: Int32Field        // Timeline duration (how long on timeline)
    loopOffset: Int32Field      // Audio file offset (which audio to play)
    loopDuration: Int32Field    // Audio playback duration (how much audio)
    gain: Float32Field          // Volume/gain (static, not a fade)
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
  PeaksPainter.renderBlocks(context, peaks, channel, {
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

## Fade Functionality Status

### Current State: NOT IMPLEMENTED

After comprehensive analysis of the OpenDAW codebase, **user-facing fade functionality does not exist**. Here's what was found:

### What EXISTS (but not user-accessible):

#### 1. DAWProject Schema Support

```typescript
// Schema definitions for DAWProject file format
fadeTimeUnit: string
fadeInTime: number
fadeOutTime: number
```

**Status:** These are only defined for file format compatibility when importing/exporting DAWProject files. They are **NOT** implemented in the application itself.

#### 2. Internal Crossfade Implementation

```typescript
// Fixed 128-sample crossfade for preventing audio glitches
const CROSSFADE_LENGTH = 128
```

**Purpose:** The Tape Device Processor has an internal crossfade mechanism to prevent audio discontinuities when the playback position jumps (e.g., during loops or when seeking).

**Usage:** Automatic - triggers when playback position changes by more than 2 samples.

**Not user-accessible:** This is an internal audio processing detail, not a user-facing fade feature.

#### 3. Automation System (Potential Workaround)

OpenDAW has a comprehensive automation system with:
- Linear interpolation
- Curve interpolation with adjustable curve values
- Multiple interpolation modes

**Potential workaround:** You could manually create fade effects by automating volume/gain parameters.

**Limitation:** This requires manual automation drawing and is track-level, not per-region.

### What DOES NOT EXIST:

1. **No Clip/Region Fade Parameters**
   - Audio region fields do not include `fadeIn` or `fadeOut` properties
   - Clip playback fields only include: loop, reverse, mute, speed, quantise, trigger

2. **No Fade UI Components**
   - No fade handles on audio regions in the timeline
   - No fade curves visualized on waveforms
   - No fade controls in region context menus or properties panels

3. **No Fade Processing**
   - Audio regions do not apply fade in/out processing to their audio output
   - No crossfade functionality between adjacent regions

4. **No Fade-Related Tests or Examples**
   - No test files demonstrating fade functionality
   - No examples in the codebase showing fade usage

### Developer Note

OpenDAW's dev-log includes a TODO item: "Fix loop discontinuations with fades"

This appears to be a planned improvement for the internal loop crossfading, not user-facing fades.

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
    track: bassTrack.box.regions
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
// Set region to 75% volume (not a fade, just static gain)
editing.modify(() => {
    audioRegion.box.gain.setValue(0.75)
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

To manually consolidate a region:
```typescript
editing.modify(() => {
    audioRegion.consolidate()
})
```

## Recommendations for Implementing Fades

If fade functionality is needed in a future version, here are some architectural considerations:

### Option 1: Per-Region Fade Parameters

Add fade fields to `AudioRegionBox`:
```typescript
{
    fadeInDuration: Int32Field   // Fade in length in PPQN
    fadeOutDuration: Int32Field  // Fade out length in PPQN
    fadeInCurve: Float32Field    // Curve shape (-1 to 1)
    fadeOutCurve: Float32Field   // Curve shape (-1 to 1)
}
```

Apply fades during audio processing in the Tape Device processor.

### Option 2: Automation-Based Fades

Create dedicated fade automation lanes that are automatically managed:
- When a fade is added to a region, create automation points
- Fade handles in the UI manipulate the underlying automation
- Benefits: Uses existing automation infrastructure
- Drawbacks: More complex data model

### Option 3: Non-Destructive Fade Curves

Store fade curves as separate objects that reference regions:
```typescript
class FadeCurve {
    region: AudioRegionBox
    type: "fadeIn" | "fadeOut"
    duration: ppqn
    curve: number // -1 to 1
}
```

This keeps the region data clean while adding fade support.

## Demo Implementation

For a complete working example of region-aware waveform visualization and track editing, see:

- **Demo:** `src/track-editing-demo.tsx`
- **Waveform Hook:** `src/hooks/useWaveformRendering.ts`
- **TracksContainer:** `src/components/TracksContainer.tsx`
- **Playhead Component:** `src/components/Playhead.tsx`

The demo shows:
- Splitting regions at playhead position
- Moving individual or all regions forward/backward
- Region selection with visual feedback
- Timeline-based waveform rendering with gaps
- Correct peak visualization after splits and moves

## References

- [PPQN Fundamentals](./02-ppqn-fundamentals.md)
- [Box System](./04-box-system.md)
- [Timeline Rendering](./06-timeline-rendering.md)
