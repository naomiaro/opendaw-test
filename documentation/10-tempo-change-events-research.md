# Tempo Change Events and Time Signature Support in OpenDAW

## Research Summary

This document analyzes OpenDAW's current architecture for tempo/BPM and time signature handling, and explores the feasibility of implementing tempo change events and multiple time signatures during playback.

**Date:** 2025-11-13
**Source:** OpenDAW codebase analysis

---

## Current State: Fixed Tempo Architecture

### 1. BPM is Currently Fixed (Single Global Value)

OpenDAW currently uses a single, global BPM value that applies to the entire project.

**Key Evidence:**

**TimelineBox** (`packages/studio/boxes/src/TimelineBox.ts:88-90`):
```typescript
bpm: Float32Field  // Single field with default value of 120
```

**ConstantTempoMap** (`packages/lib/dsp/src/tempo.ts:53-91`):
```typescript
export class ConstantTempoMap extends Observable<TempoMap> implements TempoMap {
    constructor(readonly observable: Observable<bpm>) { ... }

    getTempoAt(_position: ppqn): bpm {
        return this.observable.getValue()  // Same BPM regardless of position
    }
}
```

**Engine Processor** (`packages/studio/core-processors/src/EngineProcessor.ts:144`):
```typescript
this.#tempoMap = new ConstantTempoMap(timelineBox.bpm)
```

The engine creates a `ConstantTempoMap` from a single observable BPM value.

### 2. Time Signature is Fixed Per Project

**TimelineBox Signature** (`packages/studio/boxes/src/Signature.ts:33-39`):
```typescript
signature: ObjectField<SignatureFields>  // Single signature for entire project
```

**Schema Definition** (`packages/studio/forge-boxes/src/schema/std/timeline/TimelineBox.ts:12-18`):
```typescript
10: {
    type: "object", name: "signature", class: {
        name: "Signature",
        fields: {
            1: {type: "int32", name: "nominator", value: 4},
            2: {type: "int32", name: "denominator", value: 4}
        }
    }
}
```

Default: 4/4 time signature with no support for time signature changes during playback.

---

## Timeline and Scheduling Architecture

### 3. Block-Based Rendering with Constant BPM

**How Audio Processing Works:**

Audio is processed in 128-sample blocks (called RenderQuantum). Each block contains timing information:

**Block Structure** (`packages/studio/core-processors/src/processing.ts:23-35`):
```typescript
export type Block = {
    p0: ppqn,        // Start position in PPQN
    p1: ppqn,        // End position in PPQN
    s0: int,         // Start sample index
    s1: int,         // End sample index
    bpm: number,     // Tempo for this block
    flags: int       // Including tempoChanged flag
}
```

**BlockRenderer** (`packages/studio/core-processors/src/BlockRenderer.ts:44-218`):
- Reads BPM once per render cycle: `const bpm = timelineBox.bpm.getValue()` (line 48)
- Monitors for tempo changes: `this.#context.timelineBoxAdapter.box.bpm.subscribe(() => this.#tempoChanged = true)` (line 26)
- Sets a `tempoChanged` flag in `BlockFlags` when BPM changes (line 9 in processing.ts)

**Current limitation:** All blocks in a render cycle get the same BPM value.

### 4. PPQN (Pulses Per Quarter Note) System

**Resolution:** 960 PPQN (3×5×2^6) - provides high musical timing resolution

**Conversion Utilities** (`packages/lib/dsp/src/ppqn.ts`):
```typescript
export namespace PPQN {
    secondsToPulses(seconds: number, bpm: number): ppqn
    pulsesToSeconds(pulses: ppqn, bpm: number): seconds
    samplesToPulses(samples: number, bpm: number, sampleRate: number): ppqn
    pulsesToSamples(pulses: ppqn, bpm: number, sampleRate: number): samples
}
```

**Current limitation:** All conversions assume a single BPM value for the entire calculation.

---

## Existing Infrastructure That Could Support Tempo Changes

### 5. TempoMap Interface Design

The `TempoMap` interface is **already designed to support variable tempo**!

**TempoMap Interface** (`packages/lib/dsp/src/tempo.ts:8-47`):
```typescript
export interface TempoMap extends Observable<TempoMap> {
    /**
     * Get tempo at a specific position (supports variable tempo!)
     */
    getTempoAt(position: ppqn): bpm

    /**
     * Point conversions
     */
    positionToSeconds(position: ppqn): seconds
    positionToPPQN(time: seconds): ppqn

    /**
     * Interval conversions - integrates over the tempo curve
     */
    intervalToSeconds(fromPPQN: ppqn, toPPQN: ppqn): seconds
    intervalToPPQN(fromSeconds: seconds, toSeconds: seconds): ppqn
}
```

**Key Observations:**
- `getTempoAt(position)` - position-dependent tempo query
- `intervalToSeconds()` - comment mentions "integrates over the tempo curve"
- The interface anticipates variable tempo maps
- Only `ConstantTempoMap` is currently implemented

### 6. Value Event/Automation System

OpenDAW has a complete automation system that could serve as a template for tempo automation.

**ValueRegionBox** (`packages/studio/boxes/src/ValueRegionBox.ts`):
```typescript
export type ValueRegionBoxFields = {
    events: PointerField<Pointers.ValueEventCollection>
    position: Int32Field
    duration: Int32Field
    loopOffset: Int32Field
    loopDuration: Int32Field
}
```

**ValueEvent** (`packages/studio/adapters/src/timeline/event/ValueEventBoxAdapter.ts`):
```typescript
export interface ValueEvent {
    position: ppqn
    value: unitValue  // 0-1 normalized value
    interpolation: Interpolation  // hold, linear, cubic, etc.
}

export enum Interpolation {
    Hold = "hold",
    Linear = "linear",
    Cubic = "cubic"
}
```

**Current Use:** Parameter automation for synth/effect parameters
**Potential Use:** Could be adapted for tempo automation with BPM values

### 7. Markers System

**MarkerBox** (`packages/studio/boxes/src/MarkerBox.ts`):
```typescript
export type MarkerBoxFields = {
    position: Int32Field
    plays: BooleanField
    label: StringField
    hue: Int32Field
}
```

**Current Use:** Navigation points and loop markers
**Potential Extension:** Could add tempo/time signature fields to markers

---

## DAW Project Import/Export

### 8. DAW Project Format Support

OpenDAW imports/exports the DAW Project format, which **does support tempo automation**.

**Current Implementation** (`packages/lib/dawproject/src/defaults.ts:184-190`):
```typescript
export class TransportSchema {
    @Xml.Element("Tempo", RealParameterSchema)
    readonly tempo?: RealParameterSchema  // Single value only

    @Xml.Element("TimeSignature", TimeSignatureParameterSchema)
    readonly timeSignature?: TimeSignatureParameterSchema  // Single value only
}
```

**Import Logic** (`packages/studio/core/src/dawproject/DawProjectImporter.ts:85-89`):
```typescript
const readTransport = ({tempo, timeSignature}: TransportSchema, {bpm, signature}: TimelineBox) => {
    ifDefined(tempo?.value, value => bpm.setValue(value))
    ifDefined(timeSignature?.numerator, value => nominator.setValue(value))
    ifDefined(timeSignature?.denominator, value => denominator.setValue(value))
}
```

**DAW Project DOES Support Tempo Automation** (`packages/lib/dawproject/src/defaults.ts:445`):
```typescript
export class PointsSchema extends TimelineSchema {
    @Xml.Element("Target", AutomationTargetSchema)
    readonly target?: AutomationTargetSchema

    @Xml.ElementRef(PointSchema)
    readonly points?: ReadonlyArray<PointSchema>

    @Xml.Attribute("unit")
    readonly unit?: Unit  // Could be Unit.BPM
}
```

**Import Status** (`packages/studio/core/src/dawproject/DawProjectImporter.ts:342-345`):
```typescript
} else if (isInstanceOf(timeline, PointsSchema)) {
    // TODO How to get the actual parameter?
    // console.debug(timeline.target?.parameter)
}
```

**Status:** Tempo automation import is **NOT YET IMPLEMENTED** (marked as TODO).

---

## Components Already Supporting Variable Tempo

### 9. Metronome Implementation

**Metronome** (`packages/studio/core-processors/src/Metronome.ts`):
```typescript
blocks.forEach(block => {
    const {p0, p1, bpm, s0, s1, flags} = block
    // Calculates click positions based on time signature and BPM
    // Already reads BPM per block!
})
```

**Already supports per-block BPM changes** - would automatically handle tempo automation.

### 10. MIDI Transport Clock

**MIDITransportClock** (`packages/studio/core-processors/src/MIDITransportClock.ts`):
```typescript
blocks.forEach(({p0, p1, s0, bpm, flags}) => {
    // Sends MIDI clock messages at 24 PPQN
    // Reads BPM from each block
})
```

**Already reads BPM per block** - would automatically support tempo changes.

### 11. Time Base System

**Audio regions support two time bases:**

**TimeBase Enum** (`packages/lib/dsp/src/time-base.ts`):
```typescript
export enum TimeBase {
    Musical = "musical",  // PPQN - stretches with tempo
    Seconds = "seconds",  // Absolute time - fixed duration
}
```

**Region Implementation** (`packages/studio/adapters/src/timeline/region/AudioRegionBoxAdapter.ts:79-84`):
```typescript
this.#box.timeBase.catchupAndSubscribe(owner => {
    this.#tempoSubscription.terminate()
    if (asEnumValue(owner.getValue(), TimeBase) === TimeBase.Seconds) {
        // Subscribe to tempo map changes!
        this.#tempoSubscription = context.tempoMap.subscribe(() => this.#dispatchChange())
    }
})
```

**Regions already subscribe to tempo map changes!** When tempo changes, seconds-based regions would automatically recalculate their positions.

---

## Implementation Plan

### What Would Need to Be Implemented

#### Phase 1: Core Tempo Map Implementation

**1. Create Variable TempoMap Class**

Location: `packages/lib/dsp/src/tempo.ts`

```typescript
export class VariableTempoMap extends Observable<TempoMap> implements TempoMap {
    private tempoEvents: Array<{position: ppqn, tempo: bpm, interpolation: Interpolation}>

    constructor(events: TempoEvent[]) {
        // Store sorted tempo events
    }

    getTempoAt(position: ppqn): bpm {
        // Find tempo at position
        // Apply interpolation between events
    }

    intervalToSeconds(fromPPQN: ppqn, toPPQN: ppqn): seconds {
        // Integrate tempo curve between positions
        // Handle different interpolation modes
    }

    intervalToPPQN(fromSeconds: seconds, toSeconds: seconds): ppqn {
        // Inverse integration
    }
}
```

**Implementation Notes:**
- Store tempo events sorted by position
- Support interpolation: hold (stepped), linear, cubic
- Implement numerical integration for `intervalToSeconds()`
- Use binary search for efficient tempo lookup

**2. Add Tempo Event Storage**

Create new boxes (similar to ValueEventBox):

**TempoEventBox** (new file: `packages/studio/boxes/src/TempoEventBox.ts`):
```typescript
export type TempoEventBoxFields = {
    position: Int32Field     // PPQN position
    tempo: Float32Field      // BPM value
    interpolation: Int32Field // Interpolation type
}
```

**TempoTrackBox** or extend TimelineBox:
```typescript
export type TimelineBoxFields = {
    // ... existing fields
    tempoEvents: PointerField<Pointers.TempoEventCollection>  // New field
}
```

**3. Update BlockRenderer**

Location: `packages/studio/core-processors/src/BlockRenderer.ts`

```typescript
#renderBlocks(timelineBox: TimelineBox, tempoMap: TempoMap, ...): Block[] {
    // Instead of single BPM:
    // const bpm = timelineBox.bpm.getValue()

    // Query tempo map per block:
    const blocks: Block[] = []
    let currentPosition = startPPQN

    while (currentPosition < endPPQN) {
        const bpm = tempoMap.getTempoAt(currentPosition)
        const nextTempoChange = tempoMap.getNextTempoChangeAfter(currentPosition)

        // Split block at tempo change boundaries
        const blockEnd = Math.min(
            currentPosition + blockSizePPQN,
            nextTempoChange,
            endPPQN
        )

        blocks.push({
            p0: currentPosition,
            p1: blockEnd,
            bpm,
            // ... other fields
        })

        currentPosition = blockEnd
    }

    return blocks
}
```

**Key Changes:**
- Query tempo at block start position
- Split blocks at tempo change boundaries
- Each block gets accurate BPM for its time range

#### Phase 2: UI and Editing

**4. Tempo Track UI**

Create components:
- `TempoLane` - timeline lane showing tempo curve
- `TempoEventEditor` - add/remove/move tempo events
- `TempoCurveVisualizer` - graph showing tempo over time
- Tempo automation drawing tools (pencil, line, curve)

**5. Time Signature Events**

Create similar structure to tempo events:

**TimeSignatureEventBox**:
```typescript
export type TimeSignatureEventBoxFields = {
    position: Int32Field
    nominator: Int32Field    // e.g., 3 for 3/4
    denominator: Int32Field  // e.g., 4 for 3/4
}
```

Update bar/beat calculations to account for signature changes.

#### Phase 3: Import/Export

**6. DAW Project Tempo Automation**

Implement tempo import in `DawProjectImporter.ts`:

```typescript
} else if (isInstanceOf(timeline, PointsSchema)) {
    if (timeline.unit === Unit.BPM && timeline.target?.parameter === "tempo") {
        // Import tempo points
        timeline.points?.forEach(point => {
            createTempoEvent({
                position: PPQN.secondsToPulses(point.time, defaultBPM),
                tempo: point.value,
                interpolation: mapInterpolation(point.interpolation)
            })
        })
    }
}
```

**7. Export tempo events to DAW Project format**

Add tempo track to project export.

---

## Infrastructure Already in Place ✓

The following components are **already designed** to support tempo changes:

- ✓ **TempoMap interface** - designed for variable tempo
- ✓ **Block-based rendering** - includes per-block BPM field
- ✓ **Tempo change detection** - `tempoChanged` flag in BlockFlags
- ✓ **Value event/automation system** - template for tempo events
- ✓ **Audio regions** - already subscribe to tempo map changes
- ✓ **Metronome** - reads BPM per block
- ✓ **MIDI clock** - reads BPM per block
- ✓ **DAW Project format** - supports tempo automation (PointsSchema)
- ✓ **Time-base system** - musical vs. absolute time handling

---

## Current Limitations ✗

- ✗ Only `ConstantTempoMap` is implemented
- ✗ No tempo event storage (boxes/adapters)
- ✗ No tempo track UI
- ✗ DAW Project tempo automation import not implemented
- ✗ No time signature change events
- ✗ Single global time signature only
- ✗ PPQN conversion utilities assume constant BPM

---

## Complexity Assessment

### Low Complexity (Good Foundation Exists):
- Block-based system already has per-block BPM
- TempoMap interface already designed
- Metronome and MIDI clock already read per-block BPM
- Regions already subscribe to tempo changes

### Medium Complexity (Needs Implementation):
- Variable TempoMap class with interpolation
- Tempo event storage (boxes/adapters)
- BlockRenderer tempo-aware splitting
- DAW Project import/export

### High Complexity (UI/UX Work):
- Tempo track UI and editing tools
- Tempo curve visualization
- Time signature change UI
- Ensuring all PPQN conversions handle variable tempo

---

## Recommended Implementation Approach

### Phase 1: Core (Minimal Working Implementation)
1. Implement `VariableTempoMap` class with linear interpolation
2. Create `TempoEventBox` and collection
3. Update BlockRenderer to query tempo map and split blocks
4. Test with hardcoded tempo events

### Phase 2: Storage and Import
1. Add tempo events to TimelineBox
2. Implement DAW Project tempo automation import
3. Create tempo event adapters
4. Add serialization/deserialization

### Phase 3: UI
1. Create basic tempo track lane
2. Add tempo event markers (drag to move, click to edit)
3. Implement tempo curve visualization
4. Add editing tools (add/remove events, draw curves)

### Phase 4: Advanced Features
1. Cubic interpolation for smooth tempo curves
2. Time signature change events
3. Tempo tap feature
4. Tempo automation recording
5. Export to DAW Project format

---

## Conclusion

**OpenDAW has excellent architectural groundwork for tempo automation.** The `TempoMap` interface, block-based processing with per-block BPM, and existing value event/automation system provide a solid foundation.

**Key Insight:** Much of the infrastructure is already in place and designed to handle variable tempo. The main work needed is:
1. Implementing the `VariableTempoMap` class
2. Creating tempo event storage
3. Building the UI for tempo editing

The block-based rendering system is already prepared for per-block BPM values, and components like the metronome and MIDI clock already read BPM per block. This means tempo automation could be implemented without major architectural changes.

---

## References

### Key Files Analyzed:

**Tempo/BPM:**
- `/packages/lib/dsp/src/tempo.ts` - TempoMap interface and ConstantTempoMap
- `/packages/studio/boxes/src/TimelineBox.ts` - Timeline BPM field
- `/packages/studio/core-processors/src/EngineProcessor.ts` - Tempo map usage

**Block Rendering:**
- `/packages/studio/core-processors/src/BlockRenderer.ts` - Block-based processing
- `/packages/studio/core-processors/src/processing.ts` - Block structure

**Automation System:**
- `/packages/studio/boxes/src/ValueRegionBox.ts` - Value automation
- `/packages/studio/boxes/src/ValueEventBox.ts` - Automation events
- `/packages/studio/adapters/src/timeline/event/ValueEventBoxAdapter.ts` - Event adapters

**Time System:**
- `/packages/lib/dsp/src/ppqn.ts` - PPQN conversions
- `/packages/lib/dsp/src/time-base.ts` - Musical vs. seconds time base

**Components:**
- `/packages/studio/core-processors/src/Metronome.ts` - Metronome implementation
- `/packages/studio/core-processors/src/MIDITransportClock.ts` - MIDI clock

**Import/Export:**
- `/packages/lib/dawproject/src/defaults.ts` - DAW Project schemas
- `/packages/studio/core/src/dawproject/DawProjectImporter.ts` - Import implementation

---

**Last Updated:** 2025-11-04
**Author:** Research conducted by Claude analyzing OpenDAW codebase
