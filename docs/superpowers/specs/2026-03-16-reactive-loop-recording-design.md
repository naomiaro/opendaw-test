# Reactive Loop Recording & Box Subscription Documentation

**Date:** 2026-03-16
**Status:** Approved
**Scope:** Update loop recording demo to use reactive box graph subscriptions; write new documentation for box subscription lifecycle

## Problem

The current `loop-recording-demo.tsx` discovers takes by **polling** — an `AnimationFrame` loop runs every frame during recording, calling `scanAndGroupTakes()` which iterates ALL boxes in the graph looking for `AudioRegionBox` instances with "Take N" labels. A structural fingerprint string is compared each frame to skip unnecessary `setState` calls.

This approach:
- Scans the entire box graph every frame (~60 times/second) during recording
- Doesn't match the reactive pattern used in the production Studio app (`studio-v2-monorepo`)
- Misses the `pointerHub` subscription API that OpenDAW provides for exactly this purpose
- Makes the demo a poor reference for integrators who want to build reactive UIs on the box graph

Additionally, the `documentation/` folder covers basic box system concepts (fields, transactions, `subscribe()`) but doesn't document the `pointerHub` reactive subscription chain or subscription lifecycle management patterns.

## Solution

### 1. Replace polling with reactive `pointerHub` subscriptions

Use `audioUnitBox.tracks.pointerHub.catchupAndSubscribe()` → `trackBox.regions.pointerHub.catchupAndSubscribe()` → `regionBox.mute.subscribe()` to discover takes via callbacks instead of polling.

### 2. Write standalone documentation for box subscription lifecycle

Create `documentation/18-box-subscriptions-lifecycle.md` covering the `pointerHub` API, reactive subscription chains, cleanup patterns, and a case study from the loop recording demo.

### 3. Audit `04-box-system.md`

Ensure existing content is accurate and add a forward reference to the new doc.

## Design

### Part 1: Reactive Take Discovery in `loop-recording-demo.tsx`

#### What Gets Removed

- `scanAndGroupTakes` callback — the entire function that polls the box graph
- The `AnimationFrame.add()` useEffect that calls `scanAndGroupTakes` during recording
- `lastTakeFingerprintRef` — no more structural fingerprinting needed
- All calls to `scanAndGroupTakes()` from `handleStopRecording`, `handleToggleTakeMute`, `handleClearTakes`

#### What Gets Added

A new `useEffect` that sets up pointer hub subscriptions when recording starts. The effect:

1. Triggers on `isRecording` becoming true
2. For each recording track's `audioUnitBox`, subscribes to `tracks.pointerHub.catchupAndSubscribe()`
3. Inside the track callback, subscribes to `trackBox.regions.pointerHub.catchupAndSubscribe()`
4. Inside the region callback:
   - Validates the region label starts with "Take "
   - Parses take number from "Take N" label
   - Resolves `sampleLoader` from `regionBox.file.targetVertex`
   - Matches region to input track via `regionBox.regions.targetVertex` → `TrackBox` → `AudioUnitBox`
   - Builds a `TakeRegion` object and adds it to React state
   - Subscribes to `regionBox.mute.subscribe()` for mute state sync
5. All subscriptions are collected in an array
6. On cleanup (recording stops or unmount), all subscriptions are terminated

#### Subscription Chain

```
recording starts
  → for each armed audioUnitBox:
    → audioUnitBox.tracks.pointerHub.catchupAndSubscribe({
        onAdded: ({box: trackBox}) => {
          → trackBox.regions.pointerHub.catchupAndSubscribe({
              onAdded: ({box: regionBox}) => {
                → parse "Take N" from regionBox.label.getValue()
                → resolve sampleLoader from regionBox.file.targetVertex
                → match to input track via pointer chain
                → add TakeRegion to React state
                → regionBox.mute.subscribe(obs => {
                    → update mute state in React state
                  })
              }
            })
        }
      })
```

#### State Management Changes

- `takeIterations` state is built incrementally via callbacks instead of being rebuilt from scratch each frame
- Mute toggles update state via the `regionBox.mute.subscribe()` callback — no manual `scanAndGroupTakes()` call needed after `handleToggleTakeMute`
- `handleClearTakes` still directly clears state (deletes boxes, resets `takeIterations` to `[]`)

#### What Stays the Same

- `TakeTimeline.tsx` and `TakeWaveformCanvas` — unchanged. They already use `AnimationFrame` only for peak rendering, reading `regionBox.duration.getValue()` live from the box graph each frame.
- `handleStartRecording` — same flow (configure loop area, start recording)
- `handleStopRecording` — same finalization barrier pattern, but now also terminates pointer hub subs first
- `handlePlay`, `handleStop` — unchanged
- `RecordingTrackCard`, `RecordingPreferences`, `BpmControl` — unchanged

### Part 2: Stop Recording Flow

The stop flow must terminate pointer hub subscriptions before engine cleanup to prevent phantom takes:

1. Terminate all pointer hub subscriptions (prevents late `onAdded` from creating ghost takes)
2. Collect all unique `SampleLoader` instances from current take regions
3. Call `engine.stopRecording()` (NOT `stop(true)`)
4. Wait for all sampleLoaders to emit `"loaded"` (counting barrier with timeout)
5. Call `engine.stop(true)` to reset

### Part 3: Documentation — `documentation/18-box-subscriptions-lifecycle.md`

#### Sections

1. **Overview** — Why reactive subscriptions vs polling; when to use each
2. **PointerHub API Reference**
   - `subscribe(listener, ...filter)` — future changes only
   - `catchupAndSubscribe(listener, ...filter)` — existing + future (recommended)
   - `incoming()` — snapshot read of current pointers
   - `filter()`, `size()`, `isEmpty()`, `nonEmpty()`, `contains()`
   - `PointerListener` interface: `{ onAdded(pointer), onRemoved(pointer) }`
   - The `pointer` parameter: accessing `.box` to get the actual box
3. **Scalar Field Subscriptions**
   - `field.subscribe(observer)` — fires on changes
   - `field.catchupAndSubscribe(observer)` — fires immediately + on changes
   - Observer callback: receives the field itself, call `.getValue()` to read
4. **The Reactive Subscription Chain Pattern**
   - Nesting `catchupAndSubscribe` for multi-level collections
   - Example: audioUnit → tracks → regions
   - Collecting subscriptions for bulk cleanup
5. **Subscription Cleanup**
   - `Subscription.terminate()` / `Terminable.terminate()`
   - Cleanup ordering (terminate outer before inner to prevent cascading callbacks)
   - React `useEffect` cleanup patterns
   - Common leak patterns to avoid
6. **Case Study: Loop Recording Takes**
   - Full walkthrough of the reactive take discovery flow
   - How mute sync works via `regionBox.mute.subscribe()`
   - Stop recording: why subscription termination order matters
7. **Common Pitfalls**
   - Option types are always truthy — use `.isEmpty()` / `.nonEmpty()`
   - `catchupAndSubscribe` fires immediately for existing data
   - Always terminate subscriptions in useEffect cleanup
   - `pointerHub.incoming()` is a snapshot, not reactive
   - Pointer callback receives `PointerField`, not the box directly

### Part 4: Audit `04-box-system.md`

- Verify existing content is accurate (transactions, fields, references, `pointerHub.incoming()`)
- Add a "Next Steps" forward reference to `18-box-subscriptions-lifecycle.md` for reactive patterns
- No structural changes to the existing doc

## Files Changed

| File | Change |
|------|--------|
| `src/loop-recording-demo.tsx` | Replace polling with reactive pointerHub subscriptions |
| `src/components/TakeTimeline.tsx` | No changes (already uses AnimationFrame only for peaks) |
| `documentation/18-box-subscriptions-lifecycle.md` | New doc: box subscription lifecycle |
| `documentation/04-box-system.md` | Minor audit + forward reference |

## Testing

- Build passes (`npm run build`)
- Manual testing: record loop takes, verify takes appear reactively in timeline
- Manual testing: mute toggle updates UI without polling
- Manual testing: stop recording finalizes correctly
- Manual testing: clear takes works
