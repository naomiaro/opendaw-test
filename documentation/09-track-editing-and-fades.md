# Track Editing and Fade Functionality in OpenDAW

## Overview

This document covers the track editing capabilities available in OpenDAW, with a focus on audio region manipulation and the current status of fade functionality.

## Track Editing Capabilities

### 1. Splitting/Cutting Audio Regions

OpenDAW provides robust support for splitting audio regions at specific positions.

#### API: `RegionEditing.cut()`

**Location:** `/Users/naomiaro/Code/openDAW/packages/studio/adapters/src/timeline/RegionEditing.ts`

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

**Location:** `/Users/naomiaro/Code/openDAW/packages/app/studio/src/ui/timeline/tracks/audio-unit/regions/RegionMoveModifier.ts`

**Features:**
- Drag regions along the timeline
- Move regions between tracks
- Copy mode with **Alt** key
- Snapping to grid
- Multiple region selection support

### 3. Trimming Audio Regions

Regions can be trimmed from both the start and end points.

#### Trimming the Start (Moving In-Point)

**Location:** `/Users/naomiaro/Code/openDAW/packages/app/studio/src/ui/timeline/tracks/audio-unit/regions/RegionStartModifier.ts`

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

**Location:** `/Users/naomiaro/Code/openDAW/packages/app/studio/src/ui/timeline/tracks/audio-unit/regions/RegionDurationModifier.ts`

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
// AudioRegionBox fields
{
    position: Int32Field        // Start position on timeline (PPQN)
    duration: Int32Field        // Duration on timeline (PPQN)
    loopOffset: Int32Field      // Which part of the audio file to play (PPQN)
    loopDuration: Int32Field    // How much audio to play (PPQN)
    gain: Float32Field          // Volume/gain (static, not a fade)
    mute: BooleanField          // Mute state
    label: StringField          // Region name
    hue: Int32Field             // Color
}
```

**Important Distinction - Position vs LoopOffset:**

- **`position` and `duration`**: Define WHERE the region sits on the timeline (when it plays)
- **`loopOffset` and `loopDuration`**: Define WHICH part of the audio file is played

**Example:**
```typescript
// After splitting a region at 90 seconds:
// Left region:  position=0, duration=90s, loopOffset=0, loopDuration=90s
// Right region: position=90s, duration=140s, loopOffset=90s, loopDuration=140s

// If you move the right region to 120s:
// Right region: position=120s, duration=140s, loopOffset=90s, loopDuration=140s
// (Timeline position changed, but it still plays audio from 90-230s of the file)
```

**Critical Note About loopDuration:**

When `RegionEditing.cut()` splits a region, it correctly sets `loopOffset` but may not update `loopDuration`. The parent region's `loopDuration` is preserved, which can cause audio playback issues if modified.

**Do NOT manually modify `loopDuration` after cutting**, as OpenDAW uses the relationship between `duration` and `loopDuration` for time-stretching/pitch calculations. Changing it can result in pitch-shifted or time-stretched audio playback.

### 6. Region-Aware Waveform Visualization

When building a UI with split regions, waveforms need to be rendered based on timeline position to show gaps and splits correctly.

#### The Problem

Without region-aware rendering:
- Single-region tracks stretch their waveform across the entire canvas
- After splitting, if you continue using full-canvas rendering, the waveform appears to shift/change
- Moving regions causes waveform peaks to change incorrectly

#### The Solution: Timeline-Based Rendering

Render all tracks using timeline-based positioning from the start:

```typescript
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

1. **Always use timeline-based positioning** - Even for single-region tracks, this ensures consistency
2. **Use `loopOffset` for audio selection** - Tells you which part of the audio file to show
3. **Use `region.duration` (not `loopDuration`)** - For calculating how much audio to display
4. **Gaps appear automatically** - When regions don't fill the timeline, gaps show as black space

**Example Implementation:**

See `/Users/naomiaro/Code/opendaw-headless/src/hooks/useWaveformRendering.ts` for a complete React hook implementation that:
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

**Location:** `/Users/naomiaro/Code/openDAW/packages/lib/dawproject/src/defaults.ts` (lines 269-276)

```typescript
// Schema definitions for DAWProject file format
fadeTimeUnit: string
fadeInTime: number
fadeOutTime: number
```

**Status:** These are only defined for file format compatibility when importing/exporting DAWProject files. They are **NOT** implemented in the application itself.

#### 2. Internal Crossfade Implementation

**Location:** `/Users/naomiaro/Code/openDAW/packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts`

```typescript
// Fixed 128-sample crossfade for preventing audio glitches
const CROSSFADE_LENGTH = 128
```

**Purpose:** The Tape Device Processor has an internal crossfade mechanism to prevent audio discontinuities when the playback position jumps (e.g., during loops or when seeking).

**Usage:** Automatic - triggers when playback position changes by more than 2 samples.

**Not user-accessible:** This is an internal audio processing detail, not a user-facing fade feature.

#### 3. Automation System (Potential Workaround)

**Location:** `/Users/naomiaro/Code/openDAW/packages/app/studio/src/ui/pages/AutomationPage.tsx`

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

In `/Users/naomiaro/Code/openDAW/packages/app/studio/public/manuals/dev-log.md` (line 60):
```markdown
- "Fix loop discontinuations with fades" - TODO item
```

This appears to be a planned improvement for the internal loop crossfading, not user-facing fades.

## Complete Editing Workflow Examples

Here are practical examples for common editing operations:

### Example 1: Split a Drum Region

```typescript
import { RegionEditing } from "@opendaw/studio-adapters"

// Split at bar 8 (assuming 480 PPQN and 4/4 time)
const bar8Position = 480 * 4 * 8 // 15360 PPQN

editing.modify(() => {
    RegionEditing.cut(drumRegion, bar8Position, true)
})
```

### Example 2: Move a Vocal Region

```typescript
// Move to start at bar 4
const bar4Position = 480 * 4 * 4 // 7680 PPQN

editing.modify(() => {
    vocalRegion.box.position.setValue(bar4Position)
})
```

### Example 3: Copy and Rearrange

```typescript
// Copy a bass line to a different position
const basslineCopy = bassRegion.copyTo({
    position: 480 * 4 * 16, // Bar 16
    track: bassTrack.box.regions
})
```

### Example 4: Trim a Guitar Region

```typescript
// Trim 2 beats from the start
const trimAmount = 480 * 2 // 2 beats

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

All positions and durations in OpenDAW are expressed in **PPQN** (Pulses Per Quarter Note) units, not seconds or samples. The standard PPQN value is 480.

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

1. **Use timeline-based positioning from the start** - Don't wait until regions are split. This ensures waveforms look identical before and after splitting.

2. **Waveforms should stay in place when splitting** - The visual appearance should not change when a region is split. Both resulting regions should show exactly the same waveforms they had before the split.

3. **Peaks move with regions** - When a region is moved, its waveform peaks should move with it, because `loopOffset` stays constant and tells which audio to play.

**Common Mistake:** Using full-canvas rendering for single regions and timeline-based rendering for split regions causes visual "jumps" when splitting. Always use timeline-based rendering.

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

- **Demo:** `/Users/naomiaro/Code/opendaw-headless/src/track-editing-demo.tsx`
- **Waveform Hook:** `/Users/naomiaro/Code/opendaw-headless/src/hooks/useWaveformRendering.ts`
- **TracksContainer:** `/Users/naomiaro/Code/opendaw-headless/src/components/TracksContainer.tsx`
- **Playhead Component:** `/Users/naomiaro/Code/opendaw-headless/src/components/Playhead.tsx`

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
