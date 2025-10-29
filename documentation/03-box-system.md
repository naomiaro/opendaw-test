# The Box System

## What is the Box Graph?

OpenDAW uses a **box graph** as its data model. Everything in your DAW session - tracks, audio clips, effects, automation - is represented as a "box" with fields and connections to other boxes.

Think of it like a database where:
- **Boxes** = Records/Entities
- **Fields** = Properties
- **References** = Relationships between boxes

## Why a Box System?

Traditional approaches to DAW data:
```javascript
// ❌ Plain objects - no change tracking, no undo/redo
const track = {
  name: "Drums",
  volume: -3,
  clips: [...]
};
```

OpenDAW's box system provides:
- ✅ **Change tracking** - Know when any value changes
- ✅ **Undo/redo** - Built-in transaction system
- ✅ **Observables** - React to changes automatically
- ✅ **Referential integrity** - Relationships stay consistent
- ✅ **Serialization** - Save/load entire projects

## Box Types

### Common Box Types

| Box Type | Purpose | Examples |
|----------|---------|----------|
| `TimelineBox` | Root timeline | BPM, time signature |
| `TrackBox` | Audio/MIDI track | Track name, routing |
| `AudioUnitBox` | Audio processor | Volume, pan, effects |
| `AudioFileBox` | Audio file metadata | File name, duration |
| `AudioRegionBox` | Audio clip on timeline | Position, duration, playback mode |
| `MIDIRegionBox` | MIDI clip | Notes, CC data |

### Box Hierarchy Example

```
Project
  └─ TimelineBox (BPM, time signature)
       ├─ TrackBox (Drums)
       │    ├─ AudioUnitBox (Volume, Pan)
       │    └─ AudioRegionBox (Kick 1)
       │         └─ refers to → AudioFileBox (kick.wav)
       │
       └─ TrackBox (Bass)
            ├─ AudioUnitBox (Volume, Pan)
            └─ AudioRegionBox (Bass line)
                 └─ refers to → AudioFileBox (bass.wav)
```

## Working with Boxes

### Creating Boxes

All box modifications must happen inside a **transaction**:

```typescript
import { Project } from "@opendaw/studio-core";

// ✅ CORRECT: Inside editing.modify()
project.editing.modify(() => {
  const audioFileBox = AudioFileBox.create(
    project.boxGraph,
    uuid,
    box => {
      box.fileName.setValue("kick.wav");
      box.endInSeconds.setValue(0.5);
    }
  );
});

// ❌ WRONG: Direct modification throws error
const box = AudioFileBox.create(project.boxGraph, uuid);
box.fileName.setValue("kick.wav"); // ERROR!
```

### Reading Box Values

```typescript
// Get a value
const bpm = project.timelineBox.bpm.getValue();
console.log(bpm); // 120

// Set a value (inside transaction)
project.editing.modify(() => {
  project.timelineBox.bpm.setValue(140);
});
```

### Box Fields

Every box has typed fields:

```typescript
// String field
box.fileName.setValue("kick.wav");
const name = box.fileName.getValue();

// Number field
box.volume.setValue(-3.0);
const vol = box.volume.getValue();

// Boolean field
box.mute.setValue(true);
const isMuted = box.mute.getValue();

// Reference field (points to another box)
box.file.refer(audioFileBox);
```

## Creating a Complete Audio Clip

Here's how to create a track with an audio clip:

```typescript
import { InstrumentFactories } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox } from "@opendaw/studio-boxes";
import { AudioPlayback } from "@opendaw/studio-enums";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";

const { Quarter } = PPQN;

project.editing.modify(() => {
  // 1. Create a track (Tape instrument = audio playback track)
  const { audioUnitBox, trackBox } = project.api.createInstrument(
    InstrumentFactories.Tape
  );

  // 2. Set track properties
  audioUnitBox.volume.setValue(-3);  // -3 dB
  trackBox.label.setValue("Drums");

  // 3. Create AudioFileBox (metadata about the audio file)
  const fileUUID = UUID.generate();
  const audioFileBox = AudioFileBox.create(
    project.boxGraph,
    fileUUID,
    box => {
      box.fileName.setValue("kick.wav");
      box.endInSeconds.setValue(audioBuffer.duration);
    }
  );

  // 4. Create AudioRegionBox (the clip on the timeline)
  const clipDuration = PPQN.secondsToPulses(audioBuffer.duration, 120);

  AudioRegionBox.create(
    project.boxGraph,
    UUID.generate(),
    box => {
      box.regions.refer(trackBox.regions);  // Link to track
      box.file.refer(audioFileBox);         // Link to audio file
      box.playback.setValue(AudioPlayback.NoSync);
      box.position.setValue(0);             // Beat 1
      box.duration.setValue(clipDuration);
      box.loopOffset.setValue(0);
      box.loopDuration.setValue(clipDuration);
      box.label.setValue("Kick 1");
      box.mute.setValue(false);
    }
  );
});
```

## Understanding References

Boxes don't contain other boxes directly. Instead, they **refer** to each other:

```typescript
// Parent track has a regions field
trackBox.regions; // PointerField

// Child clip refers back to parent
audioRegionBox.regions.refer(trackBox.regions);
```

This creates a connection: "This audio region belongs to this track's region collection."

### Getting Child Boxes

To get all clips on a track:

```typescript
// ❌ WRONG: Boxes don't have .children
const clips = trackBox.regions.children; // Doesn't exist!

// ✅ CORRECT: Use pointerHub.incoming()
const clips = trackBox.regions.pointerHub
  .incoming()
  .map(({ box }) => box);

console.log(clips); // Array of AudioRegionBox
```

**Why?** The box graph is a **graph**, not a tree. Any box can point to any other box, creating complex relationships.

## Transactions and Undo/Redo

### Why Transactions?

```typescript
// Without transactions, how would OpenDAW know:
// - When did the change start?
// - When did it end?
// - What changed together?
// - How to undo it?

// With transactions, all changes are atomic:
project.editing.modify(() => {
  // These 3 changes happen together
  audioUnitBox.volume.setValue(-6);
  audioUnitBox.pan.setValue(0.5);
  trackBox.label.setValue("Updated");
}); // One undo point created here
```

### Nested Transactions

Transactions can be nested (though it's rarely needed):

```typescript
project.editing.modify(() => {
  // Outer transaction
  trackBox.label.setValue("Drums");

  project.editing.modify(() => {
    // Inner transaction (merged with outer)
    audioUnitBox.volume.setValue(-3);
  });
}); // Everything commits together
```

## Observing Changes

Subscribe to field changes:

```typescript
// Subscribe to BPM changes
const subscription = project.timelineBox.bpm.subscribe(field => {
  const newBpm = field.getValue();
  console.log("BPM changed to:", newBpm);
});

// Later: clean up
subscription.terminate();
```

### React Integration

In React, subscribe in useEffect and clean up:

```typescript
useEffect(() => {
  const subscription = project.timelineBox.bpm.subscribe(field => {
    setBpm(field.getValue());
  });

  return () => subscription.terminate();
}, [project]);
```

## Common Patterns

### Pattern 1: Create Track with Multiple Clips

```typescript
project.editing.modify(() => {
  const { audioUnitBox, trackBox } = project.api.createInstrument(
    InstrumentFactories.Tape
  );

  trackBox.label.setValue("Drums");

  // Create multiple clips
  const positions = [0, Quarter * 2, Quarter * 4];

  positions.forEach(position => {
    AudioRegionBox.create(
      project.boxGraph,
      UUID.generate(),
      box => {
        box.regions.refer(trackBox.regions);
        box.file.refer(audioFileBox);
        box.position.setValue(position);
        // ... other fields
      }
    );
  });
});
```

### Pattern 2: Modify Existing Boxes

```typescript
// Find all audio regions
const allRegions = trackBox.regions.pointerHub
  .incoming()
  .map(({ box }) => box);

// Modify them
project.editing.modify(() => {
  allRegions.forEach(region => {
    region.volume.setValue(-6); // Fade out all clips
  });
});
```

### Pattern 3: Delete Boxes

```typescript
project.editing.modify(() => {
  // Get all regions
  const regions = trackBox.regions.pointerHub.incoming();

  // Delete each one
  regions.forEach(({ box }) => {
    project.boxGraph.remove(box.uuid);
  });
});
```

## Box Graph Best Practices

### 1. Always Use Transactions

```typescript
// ✅ Good
project.editing.modify(() => {
  box.value.setValue(123);
});

// ❌ Bad - will throw error
box.value.setValue(123);
```

### 2. Store UUIDs, Not Box References

```typescript
// ✅ Good - store UUID
const trackUUID = trackBox.uuid;
// Later: retrieve box
const track = project.boxGraph.get(trackUUID);

// ❌ Bad - storing box reference (can become stale)
const trackRef = trackBox; // Don't do this in React state
```

### 3. Clean Up Subscriptions

```typescript
// ✅ Good - cleanup in useEffect
useEffect(() => {
  const sub = field.subscribe(...);
  return () => sub.terminate();
}, []);

// ❌ Bad - memory leak
useEffect(() => {
  field.subscribe(...); // Never cleaned up!
}, []);
```

### 4. Batch Related Changes

```typescript
// ✅ Good - one transaction
project.editing.modify(() => {
  box1.setValue(1);
  box2.setValue(2);
  box3.setValue(3);
}); // One undo point

// ❌ Bad - three transactions
project.editing.modify(() => box1.setValue(1));
project.editing.modify(() => box2.setValue(2));
project.editing.modify(() => box3.setValue(3));
// Three undo points - harder to undo atomically
```

## Summary

The box system provides:
- **Structured data** with change tracking
- **Transactions** for undo/redo
- **Observables** for reactive UI updates
- **References** for complex relationships

Key rules:
1. All modifications must be in `project.editing.modify()`
2. Use `pointerHub.incoming()` to get child boxes
3. Subscribe to changes and clean up subscriptions
4. Store UUIDs, not box references

## Next Steps

Continue to **Sample Management and Peaks** to learn how to load audio files and render waveforms.
