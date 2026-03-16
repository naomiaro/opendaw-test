# Box Subscriptions & Reactive Lifecycle

OpenDAW's box graph provides a reactive subscription system for responding to structural and value changes. Instead of polling the box graph every frame, you subscribe to changes and receive callbacks when boxes are added, removed, or modified.

This guide covers the `pointerHub` API for collection subscriptions, scalar field subscriptions, the nested subscription chain pattern, and cleanup best practices.

## Table of Contents
- [Overview: Polling vs Reactive](#overview-polling-vs-reactive)
- [PointerHub API Reference](#pointerhub-api-reference)
- [Scalar Field Subscriptions](#scalar-field-subscriptions)
- [The Reactive Subscription Chain](#the-reactive-subscription-chain)
- [Subscription Cleanup](#subscription-cleanup)
- [Case Study: Loop Recording Takes](#case-study-loop-recording-takes)
- [Common Pitfalls](#common-pitfalls)

## Overview: Polling vs Reactive

### Polling (avoid when possible)

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

### Reactive (preferred)

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

## PointerHub API Reference

Every pointer field in the box graph has a `pointerHub` property that manages incoming references. When other boxes point to a collection (e.g., `trackBox.regions`), the `pointerHub` tracks those references.

### Import

```typescript
// PointerHub is accessed via pointer fields — no direct import needed.
// The types come from @opendaw/lib-box:
import type { PointerField } from "@opendaw/lib-box";
// Or use 'any' for the pointer parameter in demos.
```

### PointerListener Interface

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

### subscribe()

```typescript
pointerHub.subscribe(listener: PointerListener, ...filter: PointerTypes[]): Subscription
```

Subscribes to **future** pointer changes only. Does NOT fire for existing pointers.

Use when you only care about changes after the subscription point (e.g., subscribing to mute changes where the initial state is already known).

### catchupAndSubscribe()

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

### Query Methods (Snapshot Reads)

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

## Scalar Field Subscriptions

Box fields (boolean, number, string) also support subscriptions for value changes.

### subscribe()

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

### catchupAndSubscribe()

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

### Observer Callback

The observer receives the field itself (not the raw value). Call `.getValue()` to read:

```typescript
regionBox.mute.subscribe((obs) => {
  const value = obs.getValue(); // boolean
});

project.timelineBox.bpm.catchupAndSubscribe((obs) => {
  const value = obs.getValue(); // number
});
```

### When to Use Which

| Method | Fires for current value? | Use case |
|--------|-------------------------|----------|
| `subscribe()` | No | Initial state already known (e.g., mute sync after take creation) |
| `catchupAndSubscribe()` | Yes | Need to initialize + stay in sync (e.g., BPM display, engine state) |

## The Reactive Subscription Chain

The most powerful pattern is **nesting subscriptions** to react to multi-level structural changes. When OpenDAW creates a track under an instrument, you detect it. When a region is created on that track, you detect it. When that region's mute state changes, you detect it.

### Pattern: AudioUnit → Tracks → Regions

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

### Collecting Subscriptions

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

### Why catchupAndSubscribe at Every Level?

Using `catchupAndSubscribe` (not `subscribe`) ensures you discover data that was created **before** your subscription. This is critical when:

- Recording has already created tracks/regions before your useEffect runs
- A transaction creates both a track and a region atomically — the track's `onAdded` fires, and inside it, `catchupAndSubscribe` on `regions.pointerHub` immediately discovers the region

## Subscription Cleanup

### The Subscription/Terminable Interface

All subscriptions return a `Subscription` (also known as `Terminable`):

```typescript
interface Subscription {
  terminate(): void;
}
```

### Cleanup Ordering

When tearing down nested subscriptions, terminate outer subscriptions first. This prevents inner callbacks from firing during teardown:

```typescript
// 1. Terminate pointer hub subs (stops new onAdded/onRemoved callbacks)
for (const sub of pointerHubSubs) {
  sub.terminate();
}

// 2. Then do other cleanup (finalization, engine reset, etc.)
project.engine.stop(true);
```

### React useEffect Pattern

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

### Ref-Based Cleanup (for imperative handlers)

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

## Case Study: Loop Recording Takes

The loop recording demo (`src/loop-recording-demo.tsx`) uses reactive subscriptions to discover take regions as OpenDAW creates them during recording.

### The Flow

1. **User clicks Record** → `project.startRecording(useCountIn)` begins recording
2. **`isRecording` becomes true** → the subscription useEffect fires
3. **For each armed track's `audioUnitBox`**: subscribe to `tracks.pointerHub.catchupAndSubscribe()`
4. **OpenDAW creates a track and "Take 1" region**: `onAdded` fires for the track, then `catchupAndSubscribe` on `regions.pointerHub` immediately discovers the region
5. **`buildTakeRegion()`** extracts take number, mute state, sampleLoader, and waveform offsets from the regionBox
6. **`addTakeRegionToState()`** incrementally adds the take to React state
7. **`regionBox.mute.subscribe()`** fires when the SDK mutes older takes at loop boundaries
8. **Loop wraps** → OpenDAW creates "Take 2" region → `onAdded` fires → new take added to state
9. **User clicks Stop** → pointer hub subs terminated first, then finalization barrier runs

### Mute Sync

When `olderTakeAction` is `"mute-region"`, the SDK sets `regionBox.mute.setValue(true)` on older takes at loop boundaries. The `regionBox.mute.subscribe()` callback fires and updates React state — no manual re-scan needed.

When the user clicks the Mute button in the UI, `editing.modify()` sets the mute value, and the same `subscribe()` callback updates state reactively.

### Stop Recording: Why Order Matters

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

### What Still Uses AnimationFrame

`TakeWaveformCanvas` in `TakeTimeline.tsx` still uses `AnimationFrame.add()` — but only for **rendering peaks**. It reads `regionBox.duration.getValue()` live from the box graph each frame to show waveform growth during recording. This is the correct use of AnimationFrame: continuous visual updates, not structural discovery.

## Common Pitfalls

### Option Types Are Always Truthy

```typescript
// WRONG — Option.None is truthy
const vertex = regionBox.file.targetVertex;
if (!vertex) { ... } // Never triggers!

// CORRECT
if (vertex.isEmpty()) { return; }
const box = vertex.unwrap();
```

### catchupAndSubscribe Fires Immediately

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

### Always Terminate Subscriptions

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

### incoming() Is a Snapshot, Not Reactive

```typescript
// This only reads current state — won't update when new regions are added
const regions = trackBox.regions.pointerHub.incoming();

// Use catchupAndSubscribe() if you need to stay in sync
```

### Pointer Callback Receives PointerField, Not the Box

```typescript
// The callback parameter is a PointerField, not a box
onAdded: (pointer) => {
  // Access the box via .box
  const box = pointer.box;
  // NOT: const box = pointer; // PointerField, not the box!
}
```

### Nested Subscriptions Must Be Cleaned Up

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

## Summary

| API | Fires for existing? | Use case |
|-----|---------------------|----------|
| `pointerHub.subscribe()` | No | Future structural changes only |
| `pointerHub.catchupAndSubscribe()` | Yes | Discover existing + future (recommended) |
| `pointerHub.incoming()` | N/A (snapshot) | One-time read of current state |
| `field.subscribe()` | No | Future value changes only |
| `field.catchupAndSubscribe()` | Yes | Initialize + sync value changes |

**Key rules:**
1. Use `catchupAndSubscribe` as the default — it catches existing data
2. Collect all subscriptions for bulk cleanup
3. Terminate outer subscriptions before inner cleanup
4. Use `AnimationFrame` only for rendering, not for structural discovery
5. Always check Option types with `.isEmpty()` / `.nonEmpty()`, never with `!value`
