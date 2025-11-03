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
    position: Int32Field        // Start position (PPQN)
    duration: Int32Field        // Duration (PPQN)
    loopOffset: Int32Field      // Loop start offset
    loopDuration: Int32Field    // Loop duration
    gain: Float32Field          // Volume/gain (static, not a fade)
    mute: BooleanField          // Mute state
    label: StringField          // Region name
    hue: Int32Field             // Color
}
```

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

## References

- [PPQN Fundamentals](./02-ppqn-fundamentals.md)
- [Box System](./04-box-system.md)
- [Timeline Rendering](./06-timeline-rendering.md)
