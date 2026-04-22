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
  - [Undo/Redo API](#undoredo-api)
- [Observing Changes](#observing-changes)
- [Common Patterns](#common-patterns)
- [Box Graph Best Practices](#box-graph-best-practices)
- [Adapter Layer](#adapter-layer)
  - [Adapter Collections](#adapter-collections)
  - [Region Visitor Pattern](#region-visitor-pattern)
  - [Clips vs Regions](#clips-vs-regions)
  - [Selection System](#selection-system)
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
| `AudioUnitBox` | Instrument channel | Volume, pan, effects, owns tracks |
| `TrackBox` | Lane within a channel | Holds regions, points back to its AudioUnit |
| `AudioFileBox` | Audio file metadata | File name, duration |
| `AudioRegionBox` | Audio clip on timeline | Position, duration, playback mode |
| `MIDIRegionBox` | MIDI clip | Notes, CC data |

### Box Hierarchy Example

An **AudioUnitBox** is the instrument channel — the "channel strip" with volume, pan, and effects. It owns one or more **TrackBoxes**, each of which holds regions. In the simplest case, `createInstrument(Tape)` creates one AudioUnitBox with one TrackBox:

```
Project
  └─ TimelineBox (BPM, time signature)
       │
       ├─ AudioUnitBox "Drums" (Volume, Pan, Effects)
       │    └─ tracks
       │         └─ TrackBox 0
       │              └─ regions
       │                   └─ AudioRegionBox (Kick 1)
       │                        └─ file → AudioFileBox (kick.wav)
       │
       └─ AudioUnitBox "Bass" (Volume, Pan, Effects)
            └─ tracks
                 └─ TrackBox 0
                      └─ regions
                           └─ AudioRegionBox (Bass line)
                                └─ file → AudioFileBox (bass.wav)
```

A single AudioUnitBox can grow to hold **multiple TrackBoxes**. The recording system does this automatically — when recording onto a Tape that already has content, it creates a new TrackBox within the same AudioUnitBox rather than overwriting existing regions (see [Recording](./08-recording.md#recording-on-tracks-with-existing-content)):

```
AudioUnitBox "Vocals" (Volume, Pan)
  └─ tracks
       ├─ TrackBox 0 ── AudioRegionBox (existing vocal take)
       └─ TrackBox 1 ── AudioRegionBox (new recording)
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

Here's how to create a Tape instrument (AudioUnitBox + TrackBox) and place an audio clip on it:

```typescript
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox } from "@opendaw/studio-boxes";
import { AudioPlayback } from "@opendaw/studio-enums";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";

const { Quarter } = PPQN;

project.editing.modify(() => {
  // 1. Create a Tape instrument — returns one AudioUnitBox (the channel)
  //    and one initial TrackBox (the lane that holds regions)
  const { audioUnitBox, trackBox } = project.api.createInstrument(
    InstrumentFactories.Tape
  );

  // 2. Set channel and track properties
  audioUnitBox.volume.setValue(-3);  // -3 dB (on the channel strip)
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
  const clipDuration = Math.round(PPQN.secondsToPulses(audioBuffer.duration, 120));

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

### Undo/Redo API

The transaction system provides built-in undo/redo. Each `editing.modify()` call creates an undo point automatically.

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `editing.undo()` | `boolean` | Undo last transaction. Returns `false` if nothing to undo or if undo failed (e.g., conflicting collaborative changes). |
| `editing.redo()` | `boolean` | Redo last undone transaction. Returns `false` if nothing to redo. |
| `editing.canUndo()` | `boolean` | Whether undo is available |
| `editing.canRedo()` | `boolean` | Whether redo is available |
| `editing.subscribe(observer)` | `Subscription` | Fires after every undo, redo, or modify — use to update UI state |

#### Skipping Undo Points

By default, `editing.modify()` creates an undo point. Pass `mark: false` to suppress this for intermediate updates that shouldn't be individually undoable:

```typescript
// Creates an undo point (default)
project.editing.modify(() => { region.position = newPosition; });

// No undo point — used for continuous updates (e.g., region duration growth during recording)
project.editing.modify(() => { region.duration = newDuration; }, false);
```

#### Batching for Atomic Undo

Wrap related changes in a single `editing.modify()` so undo reverses them all at once:

```typescript
// BAD: 3 separate undo points — user must undo 3 times
tracks.forEach(track => {
  project.editing.modify(() => updateTrackAutomation(track));
});

// GOOD: 1 undo point — all tracks revert together
project.editing.modify(() => {
  tracks.forEach(track => updateTrackAutomation(track));
});
```

#### Observing Changes for UI Updates

`editing.subscribe()` fires after every transaction (including undo/redo). Use it to keep UI in sync:

```typescript
useEffect(() => {
  if (!project) return;
  const subscription = project.editing.subscribe(() => {
    setCanUndo(project.editing.canUndo());
    setCanRedo(project.editing.canRedo());
    // Re-derive any UI state from the box graph here
  });
  return () => subscription.terminate();
}, [project]);
```

#### Pattern: Deriving UI State from the Box Graph

Instead of maintaining parallel React state for data that's encoded in the box graph, derive it:

```typescript
// Instead of keeping boundaries/assignments in React state:
const [boundaries, setBoundaries] = useState([]);

// Derive from the box graph after each change:
project.editing.subscribe(() => {
  const derived = deriveStateFromBoxGraph(project);
  setState(derived);
});

// User actions modify the box graph (undoable):
project.editing.modify(() => {
  // ... create/delete regions, update automation
});
// editing.subscribe fires → UI updates automatically
// editing.undo() fires → same callback → UI reverts
```

This pattern makes undo/redo work natively — the box graph is the single source of truth, and the UI is a derived view. See the [Comp Lanes demo](https://opendaw-test.pages.dev/comp-lanes-demo.html) for a working example.

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

### UI Framework Integration

Subscribe during initialization and clean up on teardown. Here's a React example (the pattern is similar in any framework):

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
    region.gain.setValue(-6); // -6 dB on each clip
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
    project.boxGraph.unstageBox(box);
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
const trackUUID = trackBox.address.uuid;
// Later: retrieve box (returns Option<Box>)
const trackOpt = project.boxGraph.findBox(trackUUID);
if (trackOpt.nonEmpty()) {
  const track = trackOpt.unwrap();
}

// ❌ Bad - storing box reference (can become stale)
const trackRef = trackBox; // Don't store box references in UI state
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

### Adapter Collections

Adapters organize children into typed collections. There are two collection types:

#### BoxAdapterCollection (Unordered)

Used for collections where ordering doesn't matter (e.g., aux sends, buses):

```typescript
const buses = project.rootBoxAdapter.audioBusses;

buses.adapters();   // AudioBusBoxAdapter[] — current snapshot
buses.size();       // number of buses
buses.isEmpty();    // true if no buses

const sub = buses.catchupAndSubscribe({
  onAdd: (adapter) => { /* new bus added */ },
  onRemove: (adapter) => { /* bus removed */ },
});
// Returns Terminable — clean up in useEffect
```

#### IndexedBoxAdapterCollection (Ordered)

Used for collections where order matters (e.g., tracks, effects chains):

```typescript
const effects = audioUnitAdapter.audioEffects;

effects.adapters();           // DeviceBoxAdapter[] — sorted by index
effects.getAdapterByIndex(0); // first effect in chain
effects.move(adapter, 1);     // move effect down one position

const sub = effects.catchupAndSubscribe({
  onAdd: (adapter) => { /* effect inserted */ },
  onRemove: (adapter) => { /* effect removed */ },
  onReorder: (adapter) => { /* effect chain reordered */ },
});
```

Both collection types support `catchupAndSubscribe` (fires immediately for existing items + future changes) and `subscribe` (future changes only). Always terminate the returned subscription in cleanup.

### Region Visitor Pattern

When working with regions that could be audio, MIDI, or automation, use the visitor pattern instead of type casting:

```typescript
regionAdapter.accept({
  visitAudioRegionBoxAdapter: (audio) => {
    // Typed as AudioRegionBoxAdapter
    const peaks = audio.file.peaks;
  },
  visitNoteRegionBoxAdapter: (note) => {
    // Typed as NoteRegionBoxAdapter
    const events = note.events;
  },
  visitValueRegionBoxAdapter: (value) => {
    // Typed as ValueRegionBoxAdapter
    const collection = value.optCollection;
  },
});
```

For simple boolean checks, use type guards:

```typescript
import { UnionAdapterTypes } from "@opendaw/studio-adapters";

if (UnionAdapterTypes.isRegion(adapter)) { /* any region type */ }
if (UnionAdapterTypes.isLoopableRegion(adapter)) { /* audio or note region */ }
if (adapter.isAudioRegion()) { /* AudioRegionBoxAdapter */ }
```

### Clips vs Regions

OpenDAW has two parallel concepts for content on tracks — **Clips** and **Regions**:

| Feature | Regions | Clips |
|---------|---------|-------|
| **Positioning** | Explicit `position` on the timeline | Indexed within a track (no timeline position) |
| **Looping** | `loopOffset`, `loopDuration` for tiling | Simple `duration` only |
| **Mirroring** | Not supported | Note and Value clips can share one event collection |
| **Use case** | Audio playback, recording, timeline editing | Reusable MIDI patterns, automation clips |
| **Collection** | `TrackRegions` (`onAdded`/`onRemoved`) | `TrackClips` (`IndexedBoxAdapterCollection`) |

A single `TrackBoxAdapter` has both `.regions` and `.clips` — they coexist independently.

#### ClipBoxAdapter Types

All clip adapters implement `ClipBoxAdapter<CONTENT>` with:
- `.duration` — clip length (PPQN)
- `.mute`, `.label`, `.hue` — metadata
- `.isMirrowed` — true if sharing an event collection with another clip
- `.canMirror` — whether this clip type supports mirroring
- `.optCollection` — `Option<CONTENT>` (the event collection, if any)
- `.consolidate()` — break a mirror, creating an independent copy
- `.clone(consolidate)` — duplicate the clip
- `.subscribeChange(observer)` — react to clip changes
- `.accept(visitor)` — visitor pattern (same as regions)

**Specialized clip types:**

| Type | Content | Mirroring | Notes |
|------|---------|-----------|-------|
| `AudioClipBoxAdapter` | Audio file reference | No (`optCollection` = None) | Has `.file`, `.gain`, `.playMode` |
| `NoteClipBoxAdapter` | `NoteEventCollectionBoxAdapter` | Yes | Shared MIDI patterns |
| `ValueClipBoxAdapter` | `ValueEventCollectionBoxAdapter` | Yes | Has `.valueAt(ppqn, fallback)` |

```typescript
// Visitor pattern for clips
clip.accept({
  visitAudioClipBoxAdapter: (audio) => { /* AudioClipBoxAdapter */ },
  visitNoteClipBoxAdapter: (note) => { /* NoteClipBoxAdapter */ },
  visitValueClipBoxAdapter: (value) => { /* ValueClipBoxAdapter */ },
});
```

### Selection System

OpenDAW provides a document-backed selection system via `VertexSelection`. Selections are persisted in the box graph as `SelectionBox` entries, enabling undo/redo of selection changes.

#### VertexSelection

```typescript
// Central selection manager
const selection = new VertexSelection(project.editing, project.boxGraph);

// Point to a user's selection field
selection.switch(userSelectionField);

// Select/deselect vertices
selection.select(vertex1, vertex2);
selection.deselect(vertex1);
selection.deselectAll();

// Query
selection.isEmpty();
selection.count();
selection.isSelected(vertex);
selection.selected();         // ReadonlyArray<SelectableVertex>
selection.distance(inventory); // items NOT selected from inventory

// Subscribe
const sub = selection.catchupAndSubscribe({
  onSelected: (vertex) => { /* vertex was selected */ },
  onDeselected: (vertex) => { /* vertex was deselected */ },
});
```

#### FilteredSelection

Create type-safe, filtered views over a selection:

```typescript
// Create a filtered selection that only sees audio regions
const regionSelection = selection.createFilteredSelection<AudioRegionBoxAdapter>(
  isVertexOfBox(box => box instanceof AudioRegionBox),  // filter predicate
  { fx: adapter => adapter.box, fy: box => adapterFor(box) }  // bidirectional mapping
);

regionSelection.selected();  // ReadonlyArray<AudioRegionBoxAdapter>
regionSelection.select(regionAdapter);
regionSelection.isSelected(regionAdapter);
```

`FilteredSelection` automatically stays in sync with the underlying `VertexSelection` — selecting/deselecting in either propagates correctly. The `isVertexOfBox(predicate)` utility lifts a box-level predicate to work with `SelectableVertex`.

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

**When polling is appropriate:** Canvas rendering at 60fps, where you need to repaint continuously (e.g., a growing waveform during recording). Use `AnimationFrame` for rendering, not for discovering structural changes.

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

#### Subscription Lifecycle Pattern (React Example)

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
6. **`addTakeRegionToState()`** incrementally adds the take to UI state
7. **`regionBox.mute.subscribe()`** fires when the SDK mutes older takes at loop boundaries
8. **Loop wraps** → OpenDAW creates "Take 2" region → `onAdded` fires → new take added to state
9. **User clicks Stop** → pointer hub subs terminated first, then finalization barrier runs

#### Mute Sync

When `olderTakeAction` is `"mute-region"`, the SDK sets `regionBox.mute.setValue(true)` on older takes at loop boundaries. The `regionBox.mute.subscribe()` callback fires and updates UI state — no manual re-scan needed.

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
