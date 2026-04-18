# Box System & Reactivity

> **Skip if:** you understand OpenDAW's box graph and pointerHub subscriptions
> **Prerequisites:** Chapter 03 (AnimationFrame)

## Table of Contents
- [What is the Box Graph?](#what-is-the-box-graph)
- [Why a Box System?](#why-a-box-system)
- [Box Types](#box-types)
- [Working with Boxes](#working-with-boxes)
- [Creating a Complete Audio Clip](#creating-a-complete-audio-clip)
- [Understanding References](#understanding-references)
- [Transactions and Undo/Redo](#transactions-and-undoredo)
- [Observing Changes](#observing-changes)
- [Common Patterns](#common-patterns)
- [Box Graph Best Practices](#box-graph-best-practices)
- [Adapter Layer](#adapter-layer)
- [Advanced: Reactive Subscriptions & Lifecycle](#advanced-reactive-subscriptions--lifecycle)
  - [Overview: Polling vs Reactive](#overview-polling-vs-reactive)
  - [PointerHub API Reference](#pointerhub-api-reference)
  - [Scalar Field Subscriptions](#scalar-field-subscriptions)
  - [The Reactive Subscription Chain](#the-reactive-subscription-chain)
  - [Subscription Cleanup](#subscription-cleanup)
  - [Case Study: Loop Recording Takes](#case-study-loop-recording-takes)
  - [Common Pitfalls](#common-pitfalls)

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
import { InstrumentFactories } from "@opendaw/studio-adapters";
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

## Adapter Layer

For UI code, prefer the **adapter layer** (`@opendaw/studio-adapters`) over raw box access. Adapters wrap boxes with typed interfaces, convenience methods, and automatic sampleLoader resolution:

```typescript
// Raw box access (low-level)
const regions = trackBox.regions.pointerHub.incoming().map(({ box }) => box);

// Adapter access (preferred for UI)
const audioUnits = project.rootBoxAdapter.audioUnits.adapters();
const tracks = audioUnits[0].tracks.values();
const regions = tracks[0].regions.adapters;
```

See the [Advanced: Reactive Subscriptions & Lifecycle](#advanced-reactive-subscriptions--lifecycle) section below for details on the adapter layer's `catchupAndSubscribe` API.

## Next Steps

- Continue to **[Samples, Peaks & Looping](./05-samples-peaks-and-looping.md)** to learn how to load audio files and render waveforms.
- See the [Advanced: Reactive Subscriptions & Lifecycle](#advanced-reactive-subscriptions--lifecycle) section below for advanced reactive patterns using `pointerHub.catchupAndSubscribe()`, nested subscription chains, and the typed adapter layer.

---

## Advanced: Reactive Subscriptions & Lifecycle

> **Skip if:** you only need basic box reads, not live reactive updates

OpenDAW's box graph provides a reactive subscription system for responding to structural and value changes. Instead of polling the box graph every frame, you subscribe to changes and receive callbacks when boxes are added, removed, or modified.

This section covers the `pointerHub` API for collection subscriptions, scalar field subscriptions, the nested subscription chain pattern, and cleanup best practices.

### Overview: Polling vs Reactive

#### Polling (avoid when possible)

```typescript
// Scans the entire box graph every frame — wasteful
const sub = AnimationFrame.add(() => {
  const allBoxes = project.boxGraph.boxes();
  for (const box of allBoxes) {
    if (box.name === "AudioRegionBox") {
      // process...
    }
  }
});
```

**When polling is appropriate:** Rendering waveform peaks at 60fps, where you need to read continuously-changing values (like `peaks.dataIndex`) every frame. Use `AnimationFrame` for rendering, not for discovering structural changes.

#### Reactive (preferred)

```typescript
// Notified only when a region is actually added — efficient
const sub = trackBox.regions.pointerHub.catchupAndSubscribe({
  onAdded: (pointer) => {
    const regionBox = pointer.box as AudioRegionBox;
    // handle new region...
  },
  onRemoved: (pointer) => {
    // handle removed region...
  },
});
```

### PointerHub API Reference

Every pointer field in the box graph has a `pointerHub` property that manages incoming references. When other boxes point to a collection (e.g., `trackBox.regions`), the `pointerHub` tracks those references.

#### Import

```typescript
// PointerHub is accessed via pointer fields — no direct import needed.
// The types come from @opendaw/lib-box:
import type { PointerField } from "@opendaw/lib-box";
// Or use 'any' for the pointer parameter in demos.
```

#### PointerListener Interface

```typescript
interface PointerListener {
  onAdded(pointer: PointerField): void;
  onRemoved(pointer: PointerField): void;
}
```

The listener receives `PointerField` objects. Access the actual box via `pointer.box`:

```typescript
{
  onAdded: (pointer) => {
    const box = pointer.box;        // The box that was added
    const uuid = box.address.uuid;  // Its UUID
  },
  onRemoved: (pointer) => {
    const box = pointer.box;        // The box that was removed
  },
}
```

#### subscribe()

```typescript
pointerHub.subscribe(listener: PointerListener, ...filter: PointerTypes[]): Subscription
```

Subscribes to **future** pointer changes only. Does NOT fire for existing pointers.

Use when you only care about changes after the subscription point (e.g., subscribing to mute changes where the initial state is already known).

#### catchupAndSubscribe()

```typescript
pointerHub.catchupAndSubscribe(listener: PointerListener, ...filter: PointerTypes[]): Subscription
```

Subscribes to changes AND immediately calls `onAdded` for all **existing** pointers. This is the recommended method for most use cases — it ensures you don't miss any data that was created before the subscription.

```typescript
// Fires onAdded immediately for all existing regions, then for future ones
const sub = trackBox.regions.pointerHub.catchupAndSubscribe({
  onAdded: (pointer) => {
    // Called for EACH existing region right now,
    // AND for any region added later
  },
  onRemoved: (pointer) => {
    // Called when a region is removed later
  },
});
```

#### Query Methods (Snapshot Reads)

These return current state at call time — they are NOT reactive:

```typescript
// Get all incoming pointers as an array
const pointers = trackBox.regions.pointerHub.incoming();
// Returns ReadonlyArray<PointerField>

// Filter by pointer type
const filtered = trackBox.regions.pointerHub.filter(pointerType);

// Collection checks
trackBox.regions.pointerHub.isEmpty();   // true if no pointers
trackBox.regions.pointerHub.nonEmpty();  // true if any pointers
trackBox.regions.pointerHub.size();      // number of pointers
trackBox.regions.pointerHub.contains(pointer); // check specific pointer
```

Use `incoming()` for one-time reads (e.g., iterating all tracks when muting). Use `catchupAndSubscribe()` when you need to stay in sync with changes.

### Scalar Field Subscriptions

Box fields (boolean, number, string) also support subscriptions for value changes.

#### subscribe()

```typescript
field.subscribe(observer: (field) => void): Subscription
```

Fires when the field value changes (via a transaction). Does NOT fire for the current value.

```typescript
// Only fires when mute changes in the future
const sub = regionBox.mute.subscribe((obs) => {
  const isMuted = obs.getValue();
  console.log("Mute changed to:", isMuted);
});
```

#### catchupAndSubscribe()

```typescript
field.catchupAndSubscribe(observer: (field) => void): Subscription
```

Fires immediately with the current value, then on every change.

```typescript
// Fires right now with current BPM, then on every change
const sub = project.timelineBox.bpm.catchupAndSubscribe((obs) => {
  const bpm = obs.getValue();
  updateUI(bpm);
});
```

#### Observer Callback

The observer receives the field itself (not the raw value). Call `.getValue()` to read:

```typescript
regionBox.mute.subscribe((obs) => {
  const value = obs.getValue(); // boolean
});

project.timelineBox.bpm.catchupAndSubscribe((obs) => {
  const value = obs.getValue(); // number
});
```

#### When to Use Which

| Method | Fires for current value? | Use case |
|--------|-------------------------|----------|
| `subscribe()` | No | Initial state already known (e.g., mute sync after take creation) |
| `catchupAndSubscribe()` | Yes | Need to initialize + stay in sync (e.g., BPM display, engine state) |

### The Reactive Subscription Chain

The most powerful pattern is **nesting subscriptions** to react to multi-level structural changes. When OpenDAW creates a track under an instrument, you detect it. When a region is created on that track, you detect it. When that region's mute state changes, you detect it.

#### Pattern: AudioUnit → Tracks → Regions

```typescript
const subs: Terminable[] = [];

// Level 1: Subscribe to tracks being added to an instrument
const trackSub = audioUnitBox.tracks.pointerHub.catchupAndSubscribe({
  onAdded: (pointer) => {
    const trackBox = pointer.box;

    // Level 2: Subscribe to regions being added to this track
    const regionSub = trackBox.regions.pointerHub.catchupAndSubscribe({
      onAdded: (regionPointer) => {
        const regionBox = regionPointer.box as AudioRegionBox;

        // Process the new region
        const label = regionBox.label.getValue();
        console.log("New region:", label);

        // Level 3: Subscribe to mute changes on this region
        const muteSub = regionBox.mute.subscribe((obs) => {
          console.log("Mute changed:", obs.getValue());
        });
        subs.push(muteSub);
      },
      onRemoved: () => {},
    });
    subs.push(regionSub);
  },
  onRemoved: () => {},
});
subs.push(trackSub);
```

#### Collecting Subscriptions

All subscriptions should be collected in an array for bulk cleanup:

```typescript
const subs: Terminable[] = [];

// Add each subscription as it's created
subs.push(trackSub);
subs.push(regionSub);
subs.push(muteSub);

// Later, terminate all at once
for (const sub of subs) {
  sub.terminate();
}
subs.length = 0;
```

#### Why catchupAndSubscribe at Every Level?

Using `catchupAndSubscribe` (not `subscribe`) ensures you discover data that was created **before** your subscription. This is critical when:

- Recording has already created tracks/regions before your useEffect runs
- A transaction creates both a track and a region atomically — the track's `onAdded` fires, and inside it, `catchupAndSubscribe` on `regions.pointerHub` immediately discovers the region

### Subscription Cleanup

#### The Subscription/Terminable Interface

All subscriptions return a `Subscription` (also known as `Terminable`):

```typescript
interface Subscription {
  terminate(): void;
}
```

#### Cleanup Ordering

When tearing down nested subscriptions, terminate outer subscriptions first. This prevents inner callbacks from firing during teardown:

```typescript
// 1. Terminate pointer hub subs (stops new onAdded/onRemoved callbacks)
for (const sub of pointerHubSubs) {
  sub.terminate();
}

// 2. Then do other cleanup (finalization, engine reset, etc.)
project.engine.stop(true);
```

#### React useEffect Pattern

```typescript
useEffect(() => {
  if (!project || !isRecording) return;

  const subs: Terminable[] = [];

  // Set up subscriptions...
  const trackSub = audioUnitBox.tracks.pointerHub.catchupAndSubscribe({
    onAdded: (pointer) => {
      // ... nest more subscriptions, push to subs
    },
    onRemoved: () => {},
  });
  subs.push(trackSub);

  // Cleanup: terminate all on unmount or dep change
  return () => {
    for (const sub of subs) {
      sub.terminate();
    }
  };
}, [project, isRecording]);
```

#### Ref-Based Cleanup (for imperative handlers)

When subscriptions need to be terminated from a button handler (not a useEffect cleanup):

```typescript
const subsRef = useRef<Terminable[]>([]);

// In useEffect: store subs
subsRef.current = subs;

// In handler: terminate
const handleStop = () => {
  for (const sub of subsRef.current) {
    sub.terminate();
  }
  subsRef.current = [];
};
```

### Case Study: Loop Recording Takes

The loop recording demo (`src/loop-recording-demo.tsx`) uses reactive subscriptions to discover take regions as OpenDAW creates them during recording.

#### The Flow

1. **User clicks Record** → `project.startRecording(useCountIn)` begins recording
2. **`isRecording` becomes true** → the subscription useEffect fires
3. **For each armed track's `audioUnitBox`**: subscribe to `tracks.pointerHub.catchupAndSubscribe()`
4. **OpenDAW creates a track and "Take 1" region**: `onAdded` fires for the track, then `catchupAndSubscribe` on `regions.pointerHub` immediately discovers the region
5. **`buildTakeRegion()`** extracts take number, mute state, sampleLoader, and waveform offsets from the regionBox
6. **`addTakeRegionToState()`** incrementally adds the take to React state
7. **`regionBox.mute.subscribe()`** fires when the SDK mutes older takes at loop boundaries
8. **Loop wraps** → OpenDAW creates "Take 2" region → `onAdded` fires → new take added to state
9. **User clicks Stop** → pointer hub subs terminated first, then finalization barrier runs

#### Mute Sync

When `olderTakeAction` is `"mute-region"`, the SDK sets `regionBox.mute.setValue(true)` on older takes at loop boundaries. The `regionBox.mute.subscribe()` callback fires and updates React state — no manual re-scan needed.

When the user clicks the Mute button in the UI, `editing.modify()` sets the mute value, and the same `subscribe()` callback updates state reactively.

#### Stop Recording: Why Order Matters

```typescript
// 1. Terminate pointer hub subs FIRST
// Without this, late onAdded callbacks could fire during engine teardown,
// trying to build TakeRegion objects from half-finalized data.
for (const sub of pointerHubSubsRef.current) {
  sub.terminate();
}

// 2. Then stop recording
project.engine.stopRecording();

// 3. Wait for finalization, then reset
// ... counting barrier pattern ...
```

#### What Still Uses AnimationFrame

`TakeWaveformCanvas` in `TakeTimeline.tsx` still uses `AnimationFrame.add()` — but only for **rendering peaks**. It reads `regionBox.duration.getValue()` live from the box graph each frame to show waveform growth during recording. This is the correct use of AnimationFrame: continuous visual updates, not structural discovery.

### Common Pitfalls

#### Option Types Are Always Truthy

```typescript
// WRONG — Option.None is truthy
const vertex = regionBox.file.targetVertex;
if (!vertex) { ... } // Never triggers!

// CORRECT
if (vertex.isEmpty()) { return; }
const box = vertex.unwrap();
```

#### catchupAndSubscribe Fires Immediately

```typescript
const sub = trackBox.regions.pointerHub.catchupAndSubscribe({
  onAdded: (pointer) => {
    // This fires IMMEDIATELY for every existing region
    // AND for future additions
  },
  onRemoved: () => {},
});
// By the time we reach here, onAdded has already been called
// for all existing regions
```

#### Always Terminate Subscriptions

```typescript
// WRONG — memory leak, callbacks continue after unmount
useEffect(() => {
  trackBox.regions.pointerHub.catchupAndSubscribe({ ... });
}, []);

// CORRECT
useEffect(() => {
  const sub = trackBox.regions.pointerHub.catchupAndSubscribe({ ... });
  return () => sub.terminate();
}, []);
```

#### incoming() Is a Snapshot, Not Reactive

```typescript
// This only reads current state — won't update when new regions are added
const regions = trackBox.regions.pointerHub.incoming();

// Use catchupAndSubscribe() if you need to stay in sync
```

#### Pointer Callback Receives PointerField, Not the Box

```typescript
// The callback parameter is a PointerField, not a box
onAdded: (pointer) => {
  // Access the box via .box
  const box = pointer.box;
  // NOT: const box = pointer; // PointerField, not the box!
}
```

#### Nested Subscriptions Must Be Cleaned Up

When nesting `catchupAndSubscribe` calls, each inner subscription must be tracked and terminated:

```typescript
const subs: Terminable[] = [];

const outerSub = pointerHub.catchupAndSubscribe({
  onAdded: (pointer) => {
    const innerSub = pointer.box.regions.pointerHub.catchupAndSubscribe({
      // ...
    });
    subs.push(innerSub); // Don't forget!
  },
  onRemoved: () => {},
});
subs.push(outerSub);
```

### Adapter Layer (Preferred for UI)

The SDK provides a typed **adapter layer** (`@opendaw/studio-adapters`) that wraps the raw `pointerHub` API with typed interfaces, automatic sampleLoader resolution, and proper listener patterns. Prefer adapters over raw `pointerHub` when building UI or discovering regions.

#### Access Path

```typescript
// Adapters are available on the project
const audioUnits = project.rootBoxAdapter.audioUnits.adapters();
// → ReadonlyArray<AudioUnitBoxAdapter>

// Each AudioUnitBoxAdapter provides typed tracks
audioUnitAdapter.tracks.catchupAndSubscribe({
  onAdd: (trackAdapter: TrackBoxAdapter) => { ... },
  onRemove: (trackAdapter: TrackBoxAdapter) => { ... },
  onReorder: (trackAdapter: TrackBoxAdapter) => { ... },
});
// → TrackBoxAdapter has .regions, .label, etc.

// Each TrackBoxAdapter provides typed regions
trackAdapter.regions.catchupAndSubscribe({
  onAdded: (regionAdapter: AnyRegionBoxAdapter) => {
    if (regionAdapter.isAudioRegion()) {
      // AudioRegionBoxAdapter — typed access to label, file, peaks, etc.
      const peaks = regionAdapter.file.peaks; // Option<Peaks>
      const loader = regionAdapter.file.getOrCreateLoader(); // SampleLoader
    }
  },
  onRemoved: (regionAdapter: AnyRegionBoxAdapter) => { ... },
});
```

#### Key Differences from Raw PointerHub

| Feature | Raw `pointerHub` | Adapter Layer |
|---------|-------------------|---------------|
| Type safety | `pointer.box` is untyped — needs `as any` casts | Fully typed (`TrackBoxAdapter`, `AudioRegionBoxAdapter`) |
| SampleLoader | Manual `sampleManager.getOrCreate(uuid)` | `fileAdapter.getOrCreateLoader()` |
| Peaks access | Manual `sampleLoader.peaks` | `fileAdapter.peaks` (resolves loader internally) |
| Listener names | `onAdded` / `onRemoved` on pointerHub | `onAdd` / `onRemove` / `onReorder` on tracks; `onAdded` / `onRemoved` on regions |
| Region type checking | Duck typing (`box.name === "AudioRegionBox"`) | `regionAdapter.isAudioRegion()` |

#### When to Use Which

- **Adapter layer**: UI rendering, region discovery, peaks display — anywhere you need typed access to adapters and their convenience methods
- **Raw pointerHub**: Low-level box graph operations, custom subscription patterns, or when adapters aren't available for the box type

#### Important: Listener Interface Differences

The adapter listener interfaces differ between collection types:

```typescript
// AudioUnitTracks — uses onAdd/onRemove/onReorder
audioUnitAdapter.tracks.catchupAndSubscribe({
  onAdd: (adapter) => { ... },
  onRemove: (adapter) => { ... },
  onReorder: (adapter) => { ... },  // required
});

// TrackRegions — uses onAdded/onRemoved (no onReorder)
trackAdapter.regions.catchupAndSubscribe({
  onAdded: (adapter) => { ... },
  onRemoved: (adapter) => { ... },
});
```

### Summary

| API | Fires for existing? | Use case |
|-----|---------------------|----------|
| `pointerHub.subscribe()` | No | Future structural changes only |
| `pointerHub.catchupAndSubscribe()` | Yes | Discover existing + future (recommended) |
| `pointerHub.incoming()` | N/A (snapshot) | One-time read of current state |
| `field.subscribe()` | No | Future value changes only |
| `field.catchupAndSubscribe()` | Yes | Initialize + sync value changes |
| `adapter.tracks.catchupAndSubscribe()` | Yes | Typed track discovery (preferred for UI) |
| `adapter.regions.catchupAndSubscribe()` | Yes | Typed region discovery (preferred for UI) |

**Key rules:**
1. Use `catchupAndSubscribe` as the default — it catches existing data
2. Prefer the adapter layer over raw `pointerHub` for UI code
3. Collect all subscriptions for bulk cleanup
4. Terminate outer subscriptions before inner cleanup
5. Use `AnimationFrame` only for rendering, not for structural discovery
6. Always check Option types with `.isEmpty()` / `.nonEmpty()`, never with `!value`
