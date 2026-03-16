# Reactive Loop Recording Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AnimationFrame polling with reactive pointerHub subscriptions for take discovery in the loop recording demo, and write documentation for the box subscription lifecycle.

**Architecture:** The loop recording demo currently polls the entire box graph every frame to find take regions. We replace this with a reactive subscription chain: `audioUnitBox.tracks.pointerHub` → `trackBox.regions.pointerHub` → `regionBox.mute.subscribe()`. AnimationFrame is kept only for waveform peak rendering in `TakeWaveformCanvas`.

**Tech Stack:** React, TypeScript, OpenDAW SDK (`@opendaw/lib-box` PointerHub API, `@opendaw/studio-boxes`, `@opendaw/studio-core`)

**Spec:** `docs/superpowers/specs/2026-03-16-reactive-loop-recording-design.md`

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `src/loop-recording-demo.tsx` | Main demo component | Modify: replace polling with reactive subscriptions |
| `src/components/TakeTimeline.tsx` | Take timeline + waveform canvases | No changes needed |
| `documentation/18-box-subscriptions-lifecycle.md` | New doc: reactive subscription patterns | Create |
| `documentation/04-box-system.md` | Existing box system intro doc | Modify: add forward reference |

---

## Chunk 1: Refactor loop-recording-demo.tsx to reactive subscriptions

### Task 1: Remove polling infrastructure

**Files:**
- Modify: `src/loop-recording-demo.tsx`

- [ ] **Step 1: Remove `lastTakeFingerprintRef`**

In `src/loop-recording-demo.tsx`, remove line 113:
```typescript
// DELETE this line:
const lastTakeFingerprintRef = useRef("");
```

- [ ] **Step 2: Remove the `scanAndGroupTakes` callback**

Remove the entire `scanAndGroupTakes` useCallback (lines 225-318). This is the polling function that iterates all boxes every frame.

- [ ] **Step 3: Remove the AnimationFrame scanning useEffect**

Remove the useEffect that runs `scanAndGroupTakes` during recording (lines 320-330):
```typescript
// DELETE this entire useEffect:
useEffect(() => {
  if (!project || !isRecording) return;
  const sub = AnimationFrame.add(() => {
    scanAndGroupTakes();
  });
  return () => sub.terminate();
}, [project, isRecording, scanAndGroupTakes]);
```

- [ ] **Step 4: Remove `scanAndGroupTakes` calls from handlers**

Remove the `scanAndGroupTakes()` call from:
- `handleStopRecording` (lines 492 and 507 and 515) — all three calls
- `handleToggleTakeMute` (line 552) — and remove `scanAndGroupTakes` from the useCallback deps
- `handleClearTakes` (line 568) — remove `lastTakeFingerprintRef.current = "";`

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds (with warnings about unused imports possibly, but no errors about missing `scanAndGroupTakes`). Takes will no longer appear in the UI during recording — that's expected, we haven't added the reactive path yet.

- [ ] **Step 6: Commit**

```bash
git add src/loop-recording-demo.tsx
git commit -m "refactor: remove polling-based take scanning from loop recording demo"
```

### Task 2: Add reactive pointerHub subscription for take discovery

**Files:**
- Modify: `src/loop-recording-demo.tsx`

- [ ] **Step 1: Add a ref to hold pointer hub subscriptions**

Add after the `finalizationSubsRef` declaration (around line 111):

```typescript
// Pointer hub subscriptions for reactive take discovery
const pointerHubSubsRef = useRef<Terminable[]>([]);
```

- [ ] **Step 2: Add helper function to build a TakeRegion from a regionBox**

Add a helper inside the component (after the refs, before the useEffects) that extracts a `TakeRegion` from a regionBox. This encapsulates the logic previously inside `scanAndGroupTakes`:

```typescript
const buildTakeRegion = useCallback(
  (regionBox: AudioRegionBox): TakeRegion | null => {
    if (!audioContext) return null;

    const label = regionBox.label.getValue();
    if (!label.startsWith("Take ")) return null;

    const takeNumber = parseInt(label.replace("Take ", ""), 10);
    const isMuted = regionBox.mute.getValue();
    const sampleRate = audioContext.sampleRate;
    const waveformOffsetSec = regionBox.waveformOffset.getValue();
    const waveformOffsetFrames = Math.round(waveformOffsetSec * sampleRate);
    const durationSec = regionBox.duration.getValue();
    const durationFrames = Math.round(durationSec * sampleRate);

    // Resolve sample loader
    let loader: SampleLoader | null = null;
    const fileVertex = regionBox.file.targetVertex;
    if (!fileVertex.isEmpty()) {
      loader = project!.sampleManager.getOrCreate(
        fileVertex.unwrap().address.uuid
      );
    }

    // Match region to input track via pointer chain
    let inputTrackId = "";
    const trackVertex = regionBox.regions.targetVertex;
    if (!trackVertex.isEmpty()) {
      const trackBox = trackVertex.unwrap().box;
      const audioUnitVertex = (trackBox as any).tracks?.targetVertex;
      if (audioUnitVertex && !audioUnitVertex.isEmpty()) {
        inputTrackId = UUID.toString(
          audioUnitVertex.unwrap().box.address.uuid
        );
      }
    }

    // Fallback for single track
    if (!inputTrackId && recordingTracks.length === 1) {
      inputTrackId = recordingTracks[0].id;
    }

    return {
      regionBox,
      inputTrackId,
      takeNumber,
      isMuted,
      sampleLoader: loader,
      waveformOffsetFrames,
      durationFrames,
    };
  },
  [project, audioContext, recordingTracks]
);
```

- [ ] **Step 3: Add helper to insert a TakeRegion into takeIterations state**

```typescript
const addTakeRegionToState = useCallback(
  (region: TakeRegion) => {
    setTakeIterations((prev) => {
      const existing = prev.find((t) => t.takeNumber === region.takeNumber);
      if (existing) {
        // Add region to existing take (multi-track: same take, different track)
        const updatedRegions = [...existing.regions, region];
        return prev.map((t) =>
          t.takeNumber === region.takeNumber
            ? {
                ...t,
                regions: updatedRegions,
                isMuted: updatedRegions.every((r) => r.isMuted),
              }
            : t
        );
      }
      // New take iteration
      const newIteration: TakeIteration = {
        takeNumber: region.takeNumber,
        isLeadIn: region.takeNumber === 1 && leadInBars > 0,
        regions: [region],
        isMuted: region.isMuted,
      };
      return [...prev, newIteration].sort(
        (a, b) => a.takeNumber - b.takeNumber
      );
    });
  },
  [leadInBars]
);
```

- [ ] **Step 4: Add helper to update mute state in takeIterations**

```typescript
const updateTakeMuteInState = useCallback(
  (regionBox: AudioRegionBox, isMuted: boolean) => {
    setTakeIterations((prev) =>
      prev.map((t) => {
        const regionIndex = t.regions.findIndex((r) => r.regionBox === regionBox);
        if (regionIndex === -1) return t;
        const updatedRegions = t.regions.map((r) =>
          r.regionBox === regionBox ? { ...r, isMuted } : r
        );
        return {
          ...t,
          regions: updatedRegions,
          isMuted: updatedRegions.every((r) => r.isMuted),
        };
      })
    );
  },
  []
);
```

- [ ] **Step 5: Add the reactive subscription useEffect**

This is the core change. Add a useEffect that sets up pointer hub subscriptions when recording starts:

```typescript
// Reactive take discovery via pointerHub subscriptions
useEffect(() => {
  if (!project || !isRecording || recordingTracks.length === 0) return;

  const subs: Terminable[] = [];

  for (const track of recordingTracks) {
    const trackSub = track.audioUnitBox.tracks.pointerHub.catchupAndSubscribe({
      onAdded: (pointer) => {
        const trackBox = pointer.box;
        const regionSub = (trackBox as any).regions.pointerHub.catchupAndSubscribe({
          onAdded: (regionPointer: any) => {
            const regionBox = regionPointer.box as AudioRegionBox;
            const takeRegion = buildTakeRegion(regionBox);
            if (!takeRegion) return;

            addTakeRegionToState(takeRegion);

            // Subscribe to mute changes for reactive UI updates
            const muteSub = regionBox.mute.subscribe((obs: any) => {
              updateTakeMuteInState(regionBox, obs.getValue());
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
  }

  pointerHubSubsRef.current = subs;

  return () => {
    for (const sub of subs) {
      sub.terminate();
    }
    pointerHubSubsRef.current = [];
  };
}, [project, isRecording, recordingTracks, buildTakeRegion, addTakeRegionToState, updateTakeMuteInState]);
```

- [ ] **Step 6: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds. Takes should now appear reactively during recording.

- [ ] **Step 7: Commit**

```bash
git add src/loop-recording-demo.tsx
git commit -m "feat: add reactive pointerHub subscriptions for take discovery"
```

### Task 3: Update stop recording to terminate pointer hub subs first

**Files:**
- Modify: `src/loop-recording-demo.tsx`

- [ ] **Step 1: Update `handleStopRecording`**

The stop handler must terminate pointer hub subscriptions before engine cleanup. Update it to:

1. Terminate pointer hub subs first (prevents phantom takes)
2. Collect sampleLoaders from current `takeIterations` state (instead of scanning box graph)
3. Run finalization barrier as before

Replace the `handleStopRecording` callback with:

```typescript
const handleStopRecording = useCallback(() => {
  if (!project) return;

  // 1. Terminate pointer hub subs first to prevent phantom takes
  for (const sub of pointerHubSubsRef.current) {
    sub.terminate();
  }
  pointerHubSubsRef.current = [];

  // 2. Stop recording (NOT stop(true) which kills the audio graph)
  project.engine.stopRecording();

  // 3. Cleanup old finalization subscriptions
  for (const sub of finalizationSubsRef.current) {
    sub.terminate();
  }
  finalizationSubsRef.current = [];

  // 4. Collect unique sampleLoaders from current take state
  const loaders = new Set<SampleLoader>();
  for (const take of takeIterations) {
    for (const region of take.regions) {
      if (region.sampleLoader) {
        loaders.add(region.sampleLoader);
      }
    }
  }

  if (loaders.size > 0) {
    let finalized = 0;
    const total = loaders.size;
    let timedOut = false;

    const timeout = window.setTimeout(() => {
      if (finalized < total) {
        timedOut = true;
        console.warn(`Finalization timed out (${finalized}/${total} loaded)`);
        for (const sub of finalizationSubsRef.current) sub.terminate();
        finalizationSubsRef.current = [];
        project.engine.stop(true);
      }
    }, 10_000);

    for (const loader of loaders) {
      const sub = loader.subscribe((state) => {
        if (timedOut) return;
        if (state.type === "loaded") {
          sub.terminate();
          finalizationSubsRef.current =
            finalizationSubsRef.current.filter((s) => s !== sub);
          finalized++;
          if (finalized === total) {
            clearTimeout(timeout);
            project.engine.stop(true);
          }
        }
      });
      finalizationSubsRef.current.push(sub);
    }
  } else {
    project.engine.stop(true);
  }
}, [project, takeIterations]);
```

- [ ] **Step 2: Simplify `handleToggleTakeMute`**

Remove the `scanAndGroupTakes()` call. The `regionBox.mute.subscribe()` callback from the pointerHub subscription will update state reactively:

```typescript
const handleToggleTakeMute = useCallback(
  (takeNumber: number) => {
    if (!project) return;

    const take = takeIterations.find((t) => t.takeNumber === takeNumber);
    if (!take) return;

    project.editing.modify(() => {
      for (const region of take.regions) {
        const currentMute = region.regionBox.mute.getValue();
        region.regionBox.mute.setValue(!currentMute);
      }
    });
  },
  [project, takeIterations]
);
```

- [ ] **Step 3: Simplify `handleClearTakes`**

Remove `lastTakeFingerprintRef.current = ""` (ref was already deleted):

```typescript
const handleClearTakes = useCallback(() => {
  if (!project) return;
  project.editing.modify(() => {
    for (const box of project.boxGraph.boxes()) {
      if (box.name !== "AudioRegionBox") continue;
      const regionBox = box as AudioRegionBox;
      if (regionBox.label.getValue().startsWith("Take ")) {
        regionBox.delete();
      }
    }
  });
  setTakeIterations([]);
}, [project]);
```

- [ ] **Step 4: Clean up unused imports**

Remove `useCallback` import if no longer needed (it is still needed). Check that `AnimationFrame` import from `@opendaw/lib-dom` is still needed — it's used in the init useEffect for position tracking, so keep it. The `useRef` import is still needed for `finalizationSubsRef` and `pointerHubSubsRef`.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/loop-recording-demo.tsx
git commit -m "refactor: update stop/mute/clear handlers for reactive take management"
```

---

## Chunk 2: Documentation

### Task 4: Write box subscription lifecycle documentation

**Files:**
- Create: `documentation/18-box-subscriptions-lifecycle.md`

- [ ] **Step 1: Write the documentation**

Create `documentation/18-box-subscriptions-lifecycle.md` with these sections:

1. **Overview** — Why reactive subscriptions vs polling. When to use `catchupAndSubscribe` vs `subscribe` vs `incoming()`.
2. **PointerHub API Reference** — Complete API with signatures and descriptions:
   - `subscribe(listener, ...filter): Subscription` — future changes only
   - `catchupAndSubscribe(listener, ...filter): Subscription` — existing + future
   - `incoming(): ReadonlyArray<PointerField>` — snapshot read
   - `filter()`, `size()`, `isEmpty()`, `nonEmpty()`, `contains()`
   - `PointerListener` interface: `{ onAdded(pointer: PointerField), onRemoved(pointer: PointerField) }`
   - Accessing the box: `pointer.box` gives you the actual box (e.g., `TrackBox`, `AudioRegionBox`)
3. **Scalar Field Subscriptions** — `field.subscribe(observer)` and `field.catchupAndSubscribe(observer)`. Observer receives the field itself; call `.getValue()` to read.
4. **The Reactive Subscription Chain** — Pattern for nested collections with full code example showing audioUnit → tracks → regions.
5. **Subscription Cleanup** — `Subscription.terminate()`, cleanup ordering, React useEffect patterns, the array-collection pattern for bulk cleanup.
6. **Case Study: Loop Recording Takes** — Walkthrough of the loop recording demo's reactive flow. How take regions are discovered, mute sync, stop recording ordering.
7. **Common Pitfalls** — Option types are truthy, catchupAndSubscribe fires immediately, always terminate, `incoming()` is a snapshot not reactive.

The documentation should use code examples from the loop recording demo and reference the OpenDAW SDK types from `@opendaw/lib-box`.

- [ ] **Step 2: Verify the doc renders correctly**

Read through the file to check markdown formatting, code block syntax, and section flow.

- [ ] **Step 3: Commit**

```bash
git add documentation/18-box-subscriptions-lifecycle.md
git commit -m "docs: add box subscription lifecycle documentation"
```

### Task 5: Audit and update `04-box-system.md`

**Files:**
- Modify: `documentation/04-box-system.md`

- [ ] **Step 1: Read current content**

Read `documentation/04-box-system.md` and verify:
- Transaction examples are accurate
- `pointerHub.incoming()` usage is correctly documented
- Field types and `setValue`/`getValue` patterns are correct
- The "Observing Changes" section correctly shows `subscribe` and `catchupAndSubscribe`

- [ ] **Step 2: Add forward reference to new doc**

Update the "Next Steps" section at the bottom to include a reference to the new reactive subscriptions doc. Change:

```markdown
## Next Steps

Continue to **Sample Management and Peaks** to learn how to load audio files and render waveforms.
```

To:

```markdown
## Next Steps

- Continue to **[Sample Management and Peaks](./05-sample-management-and-peaks.md)** to learn how to load audio files and render waveforms.
- See **[Box Subscriptions & Reactive Lifecycle](./18-box-subscriptions-lifecycle.md)** for advanced reactive patterns using `pointerHub.catchupAndSubscribe()` and nested subscription chains.
```

- [ ] **Step 3: Fix any inaccuracies found in audit**

If any code examples or descriptions are outdated, fix them.

- [ ] **Step 4: Commit**

```bash
git add documentation/04-box-system.md
git commit -m "docs: audit box system doc and add forward reference to subscription lifecycle"
```

### Task 6: Final verification

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Review all changes**

Run: `git diff main --stat`
Verify only the expected files were changed:
- `src/loop-recording-demo.tsx` — modified
- `documentation/18-box-subscriptions-lifecycle.md` — new
- `documentation/04-box-system.md` — modified
- `docs/superpowers/specs/...` — new (spec doc)
- `docs/superpowers/plans/...` — new (this plan)
