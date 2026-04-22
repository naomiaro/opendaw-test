# Comp Lanes Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the comp-lanes demo with automation vs splice comparison, multi-file drops, PeaksPainter waveforms, and box-graph-driven undo/redo.

**Architecture:** Single demo file (`comp-lanes-demo.tsx`) with extracted helpers for comp logic. Comp state derived from box graph automation regions — no parallel React state. Two playback modes sharing the same comp boundaries.

**Tech Stack:** React, OpenDAW SDK (studio-adapters, studio-boxes, studio-core), PeaksPainter, CanvasPainter, Radix UI

---

### File Structure

| File | Responsibility |
|------|---------------|
| `src/demos/playback/comp-lanes-demo.tsx` | Main demo component (modify) |
| `src/lib/compLaneUtils.ts` | Comp logic: `rebuildAutomation`, `rebuildSpliceRegions`, `deriveCompState`, constants (create) |
| `documentation/04-box-system-and-reactivity.md` | Add undo/redo API section (modify) |

---

### Task 1: Extract comp constants and types to compLaneUtils.ts

**Files:**
- Create: `src/lib/compLaneUtils.ts`
- Modify: `src/demos/playback/comp-lanes-demo.tsx`

- [ ] **Step 1: Create compLaneUtils.ts with constants and types**

```typescript
// src/lib/compLaneUtils.ts
import { PPQN } from "@opendaw/lib-dsp";
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { TrackBox } from "@opendaw/studio-boxes";
import type { TrackData } from "./types";

export const BPM = 124;
export const BAR = PPQN.fromSignature(4, 4); // 3840
export const BEAT = BAR / 4; // 960
export const NUM_BARS = 8;
export const TOTAL_PPQN = BAR * NUM_BARS;
export const MAX_TAKES = 4;
export const STAGGER_OFFSETS = [0, BEAT, BEAT * 2, BEAT * 3];
export const TAKE_COLORS = ["#4ade80", "#f59e0b", "#ef4444", "#a78bfa"];
export const VOL_0DB = AudioUnitBoxAdapter.VolumeMapper.x(0);
export const VOL_SILENT = 0.0;

export type CompMode = "automation" | "splice";

export interface TakeData {
  trackData: TrackData;
  automationTrackBox: TrackBox;
  audioFileBox: any; // AudioFileBox reference for splice mode
  offset: number;
  color: string;
  label: string;
}

export interface CompState {
  boundaries: number[];
  assignments: number[];
}
```

- [ ] **Step 2: Update comp-lanes-demo.tsx to import from compLaneUtils**

Replace the inline constants and `TakeData` interface in `comp-lanes-demo.tsx` with imports from `compLaneUtils.ts`. Remove: `BPM`, `BAR`, `BEAT`, `NUM_BARS`, `TOTAL_PPQN`, `NUM_TAKES`, `TAKE_OFFSETS`, `TAKE_COLORS`, `TAKE_LABELS`, `VOL_0DB`, `VOL_SILENT`, `TakeData` interface.

Add import:
```typescript
import {
  BPM, BAR, BEAT, TOTAL_PPQN, MAX_TAKES, STAGGER_OFFSETS,
  TAKE_COLORS, VOL_0DB, VOL_SILENT,
  type CompMode, type TakeData, type CompState
} from "@/lib/compLaneUtils";
```

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/compLaneUtils.ts src/demos/playback/comp-lanes-demo.tsx
git commit -m "refactor: extract comp lane constants and types to compLaneUtils"
```

---

### Task 2: Batch rebuildAutomation into single transaction

**Files:**
- Modify: `src/demos/playback/comp-lanes-demo.tsx`

Currently `rebuildAutomation` uses multiple `editing.modify()` calls (one per take for delete, one per take for create). Batch into a single transaction for atomic undo.

- [ ] **Step 1: Refactor rebuildAutomation to use a single editing.modify()**

In `comp-lanes-demo.tsx`, replace the current `rebuildAutomation` callback. The key change: wrap the entire for-loop (all takes' delete + create) in one `editing.modify()`:

```typescript
const rebuildAutomation = useCallback(
  (project: Project, takes: TakeData[], boundaries: number[], assignments: number[], xfadeMs: number) => {
    const crossfadePPQN = Math.round(PPQN.secondsToPulses(xfadeMs / 1000, BPM));
    const playbackStart = playbackStartRef.current;

    project.editing.modify(() => {
      for (let t = 0; t < takes.length; t++) {
        const take = takes[t];
        const trackBox = take.automationTrackBox;

        // Delete existing automation regions
        const trackAdapter = project.boxAdapters.adapterFor(trackBox, TrackBoxAdapter);
        const existingAdapters = trackAdapter.regions.adapters.values()
          .filter(r => r.isValueRegion());
        for (const adapter of existingAdapters) {
          const collectionOpt = adapter.optCollection;
          if (collectionOpt.nonEmpty()) {
            collectionOpt.unwrap().events.asArray().forEach((evt: any) => evt.box.delete());
          }
          adapter.box.delete();
        }

        // Build events for this take
        const events: { position: number; value: number; interpolation: any }[] = [];
        const zoneBounds = [0, ...boundaries.map(b => b - playbackStart), TOTAL_PPQN];

        for (let z = 0; z < assignments.length; z++) {
          const zoneStart = zoneBounds[z];
          const zoneEnd = zoneBounds[z + 1];
          const isActive = assignments[z] === t;
          const isFirst = z === 0;
          const isLast = z === assignments.length - 1;
          const prevSameTake = !isFirst && assignments[z - 1] === t;
          const nextSameTake = !isLast && assignments[z + 1] === t;

          if (isActive) {
            if (!isFirst && !prevSameTake && crossfadePPQN > 0) {
              events.push({ position: Math.max(0, zoneStart - crossfadePPQN), value: VOL_SILENT, interpolation: Interpolation.Curve(0.75) });
            }
            if (!prevSameTake) {
              events.push({ position: zoneStart, value: VOL_0DB, interpolation: Interpolation.None });
            }
            if (!isLast && !nextSameTake && crossfadePPQN > 0) {
              events.push({ position: Math.max(zoneStart, zoneEnd - crossfadePPQN), value: VOL_0DB, interpolation: Interpolation.Curve(0.25) });
            }
            if (!isLast && !nextSameTake) {
              events.push({ position: zoneEnd, value: VOL_SILENT, interpolation: Interpolation.None });
            }
          } else {
            events.push({ position: zoneStart, value: VOL_SILENT, interpolation: Interpolation.None });
          }
        }

        // Sort and assign unique indices per position
        events.sort((a, b) => a.position - b.position);
        const indexedEvents: { position: number; index: number; value: number; interpolation: any }[] = [];
        let prevPos = -1;
        let posIndex = 0;
        for (const evt of events) {
          if (evt.position === prevPos) { posIndex++; } else { posIndex = 0; prevPos = evt.position; }
          indexedEvents.push({ ...evt, index: posIndex });
        }

        // Create automation region and write events
        const regionOpt = project.api.createTrackRegion(trackBox, playbackStart as ppqn, TOTAL_PPQN as ppqn);
        if (regionOpt.isEmpty()) continue;
        const regionBox = regionOpt.unwrap() as ValueRegionBox;
        const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
        const collectionOpt = adapter.optCollection;
        if (collectionOpt.isEmpty()) continue;
        const collection = collectionOpt.unwrap();

        for (const evt of indexedEvents) {
          collection.createEvent({
            position: evt.position as ppqn,
            index: evt.index,
            value: evt.value,
            interpolation: evt.interpolation
          });
        }
      }
    });
  },
  []
);
```

- [ ] **Step 2: Verify build passes and demo still works**

Run: `npm run build`
Then: `npm run dev` and test the demo — comp changes should work identically.

- [ ] **Step 3: Commit**

```bash
git add src/demos/playback/comp-lanes-demo.tsx
git commit -m "refactor: batch rebuildAutomation into single editing.modify() for atomic undo"
```

---

### Task 3: Implement deriveCompState and editing.subscribe()

**Files:**
- Modify: `src/lib/compLaneUtils.ts`
- Modify: `src/demos/playback/comp-lanes-demo.tsx`

- [ ] **Step 1: Add deriveCompState to compLaneUtils.ts**

```typescript
// Add to src/lib/compLaneUtils.ts
import type { Project } from "@opendaw/studio-core";
import { TrackBoxAdapter, ValueRegionBoxAdapter } from "@opendaw/studio-adapters";

export function deriveCompState(
  project: Project,
  takes: TakeData[],
  playbackStart: number
): CompState {
  if (takes.length === 0) return { boundaries: [], assignments: [0] };

  // For each take, find the positions where it's active (volume at VOL_0DB)
  const takeActiveRanges: Array<Array<{ start: number; end: number }>> = [];

  for (const take of takes) {
    const ranges: Array<{ start: number; end: number }> = [];
    const trackAdapter = project.boxAdapters.adapterFor(take.automationTrackBox, TrackBoxAdapter);
    const valueRegions = trackAdapter.regions.adapters.values().filter(r => r.isValueRegion());

    for (const region of valueRegions) {
      const collection = region.optCollection;
      if (collection.isEmpty()) continue;
      const events = collection.unwrap().events.asArray();
      if (events.length === 0) continue;

      // Walk events to find ranges where value is at or near VOL_0DB
      let rangeStart: number | null = null;
      for (const evt of events) {
        const pos = evt.position;
        const val = evt.value;
        const isLoud = Math.abs(val - VOL_0DB) < 0.01;

        if (isLoud && rangeStart === null) {
          rangeStart = pos;
        } else if (!isLoud && rangeStart !== null) {
          ranges.push({ start: rangeStart, end: pos });
          rangeStart = null;
        }
      }
      // If still in a loud range at the end, close it at TOTAL_PPQN
      if (rangeStart !== null) {
        ranges.push({ start: rangeStart, end: TOTAL_PPQN });
      }
    }

    takeActiveRanges.push(ranges);
  }

  // Collect all unique boundary positions (exclude 0 and TOTAL_PPQN)
  const boundarySet = new Set<number>();
  for (const ranges of takeActiveRanges) {
    for (const range of ranges) {
      if (range.start > 0) boundarySet.add(range.start + playbackStart);
      if (range.end < TOTAL_PPQN) boundarySet.add(range.end + playbackStart);
    }
  }
  const boundaries = [...boundarySet].sort((a, b) => a - b);

  // Determine assignment for each zone
  const zoneBounds = [0, ...boundaries.map(b => b - playbackStart), TOTAL_PPQN];
  const assignments: number[] = [];
  for (let z = 0; z < zoneBounds.length - 1; z++) {
    const zoneMid = (zoneBounds[z] + zoneBounds[z + 1]) / 2;
    let assignedTake = 0;
    for (let t = 0; t < takeActiveRanges.length; t++) {
      const isActive = takeActiveRanges[t].some(r => zoneMid >= r.start && zoneMid < r.end);
      if (isActive) { assignedTake = t; break; }
    }
    assignments.push(assignedTake);
  }

  return { boundaries, assignments };
}
```

- [ ] **Step 2: Wire up editing.subscribe() in comp-lanes-demo.tsx**

Replace the `compBoundaries` and `compAssignments` useState with state derived from the box graph. Add a `useEffect` that subscribes to `editing.subscribe()`:

```typescript
// In the App component, replace:
//   const [compBoundaries, setCompBoundaries] = useState<number[]>([]);
//   const [compAssignments, setCompAssignments] = useState<number[]>([0]);
// With:
const [compState, setCompState] = useState<CompState>({ boundaries: [], assignments: [0] });

// Add editing subscription to re-derive comp state:
useEffect(() => {
  if (!project || takes.length === 0) return;
  const subscription = project.editing.subscribe(() => {
    const derived = deriveCompState(project, takes, playbackStartRef.current);
    setCompState(derived);
  });
  return () => subscription.terminate();
}, [project, takes]);
```

Update all references from `compBoundaries` → `compState.boundaries` and `compAssignments` → `compState.assignments` throughout the component.

- [ ] **Step 3: Verify build passes**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/lib/compLaneUtils.ts src/demos/playback/comp-lanes-demo.tsx
git commit -m "feat: derive comp state from box graph via deriveCompState and editing.subscribe"
```

---

### Task 4: Add undo/redo buttons and keyboard shortcuts

**Files:**
- Modify: `src/demos/playback/comp-lanes-demo.tsx`

- [ ] **Step 1: Add undo/redo state and subscription**

```typescript
const [canUndo, setCanUndo] = useState(false);
const [canRedo, setCanRedo] = useState(false);

// In the editing.subscribe useEffect, also update undo/redo state:
useEffect(() => {
  if (!project) return;
  const updateUndoRedo = () => {
    setCanUndo(project.editing.canUndo());
    setCanRedo(project.editing.canRedo());
  };
  updateUndoRedo();
  const subscription = project.editing.subscribe(() => {
    if (takes.length > 0) {
      const derived = deriveCompState(project, takes, playbackStartRef.current);
      setCompState(derived);
    }
    updateUndoRedo();
  });
  return () => subscription.terminate();
}, [project, takes]);
```

- [ ] **Step 2: Add undo/redo handlers and keyboard listener**

```typescript
const handleUndo = useCallback(() => {
  if (!project) return;
  project.editing.undo();
}, [project]);

const handleRedo = useCallback(() => {
  if (!project) return;
  project.editing.redo();
}, [project]);

// Keyboard shortcuts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [handleUndo, handleRedo]);
```

- [ ] **Step 3: Add undo/redo buttons to transport card UI**

In the transport card, add buttons next to the crossfade control:

```tsx
<Flex gap="2" align="center">
  <Button size="1" variant="soft" disabled={!canUndo} onClick={handleUndo}>
    Undo
  </Button>
  <Button size="1" variant="soft" disabled={!canRedo} onClick={handleRedo}>
    Redo
  </Button>
</Flex>
```

- [ ] **Step 4: Verify build passes and test undo/redo**

Run: `npm run build`
Then: `npm run dev`, add boundaries, change assignments, press Cmd+Z — should undo each change.

- [ ] **Step 5: Commit**

```bash
git add src/demos/playback/comp-lanes-demo.tsx
git commit -m "feat: add undo/redo buttons and Cmd+Z keyboard shortcuts"
```

---

### Task 5: Multi-file drop support

**Files:**
- Modify: `src/demos/playback/comp-lanes-demo.tsx`
- Modify: `src/lib/compLaneUtils.ts`

- [ ] **Step 1: Add label generation helper to compLaneUtils.ts**

```typescript
export function generateTakeLabels(fileCount: number): string[] {
  if (fileCount === 1) {
    return STAGGER_OFFSETS.map((_, i) =>
      i === 0 ? "Take 1 (original)" : `Take ${i + 1} (+${i} beat${i > 1 ? "s" : ""})`
    );
  }
  // Multi-file: labels will be set from filenames by the caller
  return [];
}

export function computeTakeOffsets(fileCount: number): number[] {
  if (fileCount === 1) return STAGGER_OFFSETS;
  return new Array(Math.min(fileCount, MAX_TAKES)).fill(0);
}
```

- [ ] **Step 2: Update loadTakes to handle single vs multi-file**

Refactor `loadTakes` in the demo to accept an array of `{name: string, fileUrl: string}` configs instead of a single file. When 1 file is provided, duplicate it with stagger offsets. When 2-4 files, load each as a separate take with offset 0.

```typescript
const loadTakes = useCallback(
  async (files: Array<{ name: string; fileUrl: string }>) => {
    if (!project || !audioContext) return;

    const isSingleFile = files.length === 1;
    const offsets = computeTakeOffsets(files.length);
    const takeCount = isSingleFile ? MAX_TAKES : Math.min(files.length, MAX_TAKES);

    // Build file configs: duplicate single file or use each file
    const fileConfigs = isSingleFile
      ? Array.from({ length: takeCount }, (_, i) => ({
          name: generateTakeLabels(1)[i],
          file: files[0].fileUrl,
        }))
      : files.slice(0, MAX_TAKES).map(f => ({ name: f.name, file: f.fileUrl }));

    setStatus(`Loading ${fileConfigs.length} takes...`);
    const localAudioBuffers = localAudioBuffersRef.current;

    const loadedTracks = await loadTracksFromFiles(
      project, audioContext, fileConfigs, localAudioBuffers,
      { onProgress: (i, total, trackName) => setStatus(`Loading ${trackName} (${i}/${total})...`) }
    );

    if (loadedTracks.length < 2) {
      setStatus("Error: need at least 2 takes");
      return;
    }

    // ... rest of setup (region offsets, automation tracks, splice track)
  },
  [project, audioContext]
);
```

- [ ] **Step 3: Update file input and drop zone for multiple files**

Change `<input>` to accept `multiple`:
```tsx
<input ref={fileInputRef} type="file" accept="audio/*" multiple style={{ display: "none" }}
  onChange={(e) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, MAX_TAKES);
    const configs = files.map(f => ({ name: f.name, fileUrl: URL.createObjectURL(f) }));
    loadTakes(configs).finally(() => configs.forEach(c => URL.revokeObjectURL(c.fileUrl)));
  }}
/>
```

Update drop handler:
```typescript
const handleDrop = useCallback((e: React.DragEvent) => {
  e.preventDefault(); setIsDragOver(false);
  const fileList = Array.from(e.dataTransfer.files)
    .filter(f => f.type.startsWith("audio/"))
    .slice(0, MAX_TAKES);
  if (fileList.length === 0) return;
  const configs = fileList.map(f => ({ name: f.name, fileUrl: URL.createObjectURL(f) }));
  loadTakes(configs).finally(() => configs.forEach(c => URL.revokeObjectURL(c.fileUrl)));
}, [loadTakes]);
```

Update demo button:
```typescript
const handleLoadDemo = useCallback(async () => {
  const ext = getAudioExtension();
  await loadTakes([{ name: "Dark Ride - Vocals", fileUrl: `/audio/DarkRide/06_Vox.${ext}` }]);
}, [loadTakes]);
```

Update drop zone text:
```tsx
<Text size="6">{isDragOver ? "Drop it!" : "Drop audio file(s) here"}</Text>
<Text size="2" color="gray">Drop 1 file for staggered takes, or 2-4 files for separate performances</Text>
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/demos/playback/comp-lanes-demo.tsx src/lib/compLaneUtils.ts
git commit -m "feat: add multi-file drop support (1 file = stagger, 2-4 = separate takes)"
```

---

### Task 6: Add splice mode track and mode toggle

**Files:**
- Modify: `src/demos/playback/comp-lanes-demo.tsx`
- Modify: `src/lib/compLaneUtils.ts`

- [ ] **Step 1: Add rebuildSpliceRegions to compLaneUtils.ts**

```typescript
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { UUID } from "@opendaw/lib-std";

export function rebuildSpliceRegions(
  project: Project,
  spliceTrackBox: TrackBox,
  takes: TakeData[],
  boundaries: number[],
  assignments: number[],
  playbackStart: number,
  fullAudioPpqn: number
): void {
  project.editing.modify(() => {
    // Delete existing regions on splice track
    const trackAdapter = project.boxAdapters.adapterFor(spliceTrackBox, TrackBoxAdapter);
    for (const region of trackAdapter.regions.adapters.values()) {
      region.box.delete();
    }

    // Create consecutive regions per zone
    const zoneBounds = [playbackStart, ...boundaries, playbackStart + TOTAL_PPQN];
    for (let z = 0; z < assignments.length; z++) {
      const zoneStart = zoneBounds[z];
      const zoneEnd = zoneBounds[z + 1];
      const take = takes[assignments[z]];
      if (!take) continue;

      const eventsCollectionBox = ValueEventCollectionBox.create(project.boxGraph, UUID.generate());

      AudioRegionBox.create(project.boxGraph, UUID.generate(), box => {
        box.regions.refer(spliceTrackBox.regions);
        box.file.refer(take.audioFileBox);
        box.events.refer(eventsCollectionBox.owners);
        box.position.setValue(zoneStart);
        box.duration.setValue(zoneEnd - zoneStart);
        box.loopOffset.setValue(zoneStart + take.offset);
        box.loopDuration.setValue(fullAudioPpqn);
        box.label.setValue(take.label);
        box.mute.setValue(false);
      });
    }
  });
}
```

- [ ] **Step 2: Create splice track during loadTakes**

After creating automation tracks for each take, create the splice instrument:

```typescript
// In loadTakes, after the take loop:
let spliceAudioUnitBox: any = null;
project.editing.modify(() => {
  const result = project.api.createInstrument(InstrumentFactories.Tape);
  spliceAudioUnitBox = result.audioUnitBox;
  result.audioUnitBox.mute.setValue(true); // Start muted (automation mode is default)
});

// Store splice track reference
const spliceTrackBox = spliceAudioUnitBox.tracks.pointerHub.incoming().at(0)?.box as TrackBox;
spliceTrackRef.current = spliceTrackBox;
spliceAudioUnitRef.current = spliceAudioUnitBox;
```

Add refs:
```typescript
const spliceTrackRef = useRef<TrackBox | null>(null);
const spliceAudioUnitRef = useRef<any>(null);
```

- [ ] **Step 3: Add compMode state and mode toggle UI**

```typescript
const [compMode, setCompMode] = useState<CompMode>("automation");

const handleModeChange = useCallback((mode: string) => {
  if (!project || takes.length === 0) return;
  const newMode = mode as CompMode;

  project.editing.modify(() => {
    // Mute/unmute tracks based on mode
    for (const take of takes) {
      take.trackData.audioUnitBox.mute.setValue(newMode === "splice");
    }
    if (spliceAudioUnitRef.current) {
      spliceAudioUnitRef.current.mute.setValue(newMode === "automation");
    }
  });

  setCompMode(newMode);

  // Rebuild for the new mode
  if (newMode === "splice" && spliceTrackRef.current) {
    rebuildSpliceRegions(
      project, spliceTrackRef.current, takes,
      compState.boundaries, compState.assignments,
      playbackStartRef.current, fullAudioPpqnRef.current
    );
  }
}, [project, takes, compState]);
```

Add `SegmentedControl` to transport card:
```tsx
import { SegmentedControl } from "@radix-ui/themes";

<Flex gap="3" align="center">
  <SegmentedControl.Root value={compMode} onValueChange={handleModeChange}>
    <SegmentedControl.Item value="automation">Automation Crossfade</SegmentedControl.Item>
    <SegmentedControl.Item value="splice">Region Splice</SegmentedControl.Item>
  </SegmentedControl.Root>
</Flex>
```

- [ ] **Step 4: Show/hide crossfade slider based on mode**

```tsx
{compMode === "automation" ? (
  <label style={{ fontSize: "14px", color: "var(--gray-11)" }}>
    Crossfade:{" "}
    <input type="number" value={crossfadeMs} ... />
    {" "}ms
  </label>
) : (
  <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
    SDK manages 20ms voice crossfade
  </Text>
)}
```

- [ ] **Step 5: Update comp interaction handlers to rebuild for current mode**

In `handleLaneClick`, `setZoneTake`, and `handleCrossfadeChange`, after updating comp state, also rebuild splice regions if in splice mode:

```typescript
// After rebuildAutomation call:
if (compMode === "splice" && spliceTrackRef.current) {
  rebuildSpliceRegions(
    project, spliceTrackRef.current, takes,
    newBoundaries, newAssignments,
    playbackStartRef.current, fullAudioPpqnRef.current
  );
}
```

- [ ] **Step 6: Verify build passes and test both modes**

Run: `npm run build`
Then: `npm run dev`, test automation mode (existing behavior), toggle to splice mode, verify audio plays with region boundaries.

- [ ] **Step 7: Commit**

```bash
git add src/demos/playback/comp-lanes-demo.tsx src/lib/compLaneUtils.ts
git commit -m "feat: add splice mode with region-based comp and mode toggle"
```

---

### Task 7: Replace waveform rendering with PeaksPainter

**Files:**
- Modify: `src/demos/playback/comp-lanes-demo.tsx`

- [ ] **Step 1: Replace drawWaveform with PeaksPainter-based rendering**

Replace the current `drawWaveform` callback (which uses `AudioBuffer.getChannelData()`) with `PeaksPainter.renderPixelStrips()`:

```typescript
import { PeaksPainter } from "@opendaw/lib-fusion";
import type { Peaks } from "@opendaw/lib-fusion";

// Replace drawWaveform:
const drawWaveform = useCallback(
  (canvas: HTMLCanvasElement, takeIndex: number) => {
    if (!project || !canvas || takes.length === 0) return;
    const take = takes[takeIndex];

    // Get peaks via adapter layer
    const audioUnits = project.rootBoxAdapter.audioUnits.adapters();
    const unitAdapter = audioUnits.find(u =>
      u.box.address.uuid.every((b, i) => b === take.trackData.audioUnitBox.address.uuid[i])
    );
    if (!unitAdapter) return;
    const trackAdapters = unitAdapter.tracks.values();
    if (trackAdapters.length === 0) return;
    const regions = trackAdapters[0].regions.adapters.values().filter(r => r.isAudioRegion());
    if (regions.length === 0) return;
    const regionAdapter = regions[0];
    const peaksOpt = regionAdapter.file.peaks;
    if (peaksOpt.isEmpty()) return;
    const peaks = peaksOpt.unwrap();

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);

    // Compute frame range for this take's offset
    const playbackStart = playbackStartRef.current;
    const startPpqn = playbackStart + take.offset;
    const startFraction = PPQN.pulsesToSeconds(startPpqn, BPM) /
      PPQN.pulsesToSeconds(regionAdapter.loopDuration, BPM);
    const durationFraction = PPQN.pulsesToSeconds(TOTAL_PPQN, BPM) /
      PPQN.pulsesToSeconds(regionAdapter.loopDuration, BPM);

    const u0 = Math.floor(startFraction * peaks.numFrames);
    const u1 = Math.floor((startFraction + durationFraction) * peaks.numFrames);

    ctx.fillStyle = take.color;
    const numChannels = peaks.numChannels;
    const channelHeight = h / numChannels;

    for (let ch = 0; ch < numChannels; ch++) {
      PeaksPainter.renderPixelStrips(ctx, peaks, ch, {
        x0: 0, x1: w,
        y0: ch * channelHeight, y1: (ch + 1) * channelHeight,
        u0: Math.max(0, u0), u1: Math.min(peaks.numFrames, u1),
        v0: -1, v1: 1
      });
    }
  },
  [project, takes]
);
```

- [ ] **Step 2: Add peaks loading subscription**

After loading takes, subscribe to sample loaders for peaks readiness. Use a retry mechanism since peaks load asynchronously:

```typescript
// In loadTakes, after setting takes:
// Redraw waveforms when peaks become available
const checkPeaks = () => {
  requestAnimationFrame(() => {
    for (let i = 0; i < takeData.length; i++) {
      const canvas = canvasRefs.current.get(i);
      if (canvas) drawWaveform(canvas, i);
    }
  });
};
// Check immediately and again after a delay for async peaks
checkPeaks();
setTimeout(checkPeaks, 500);
setTimeout(checkPeaks, 1500);
```

- [ ] **Step 3: Verify build passes and waveforms render**

Run: `npm run build`
Then: `npm run dev`, verify smooth PeaksPainter waveforms appear for each take lane.

- [ ] **Step 4: Commit**

```bash
git add src/demos/playback/comp-lanes-demo.tsx
git commit -m "feat: replace raw AudioBuffer waveforms with PeaksPainter rendering"
```

---

### Task 8: Store audioFileBox reference in TakeData

**Files:**
- Modify: `src/demos/playback/comp-lanes-demo.tsx`

The splice mode needs access to each take's `AudioFileBox` to create regions that reference the correct audio. We need to capture this during `loadTakes`.

- [ ] **Step 1: Find and store audioFileBox for each take**

After loading tracks, resolve the `AudioFileBox` from each take's region adapter:

```typescript
// In loadTakes, inside the per-take loop, after adjusting region position:
const trackAdapter = project.boxAdapters.adapterFor(track.trackBox, TrackBoxAdapter);
const audioRegion = trackAdapter.regions.adapters.values().find(r => r.isAudioRegion());
const audioFileBox = audioRegion
  ? audioRegion.box.file.targetVertex.unwrap().box
  : null;

takeData.push({
  trackData: track,
  automationTrackBox,
  audioFileBox,  // Store reference for splice mode
  offset: offsets[i],
  color: TAKE_COLORS[i],
  label: labels[i]
});
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/demos/playback/comp-lanes-demo.tsx
git commit -m "feat: store audioFileBox reference in TakeData for splice mode"
```

---

### Task 9: Add VitePress undo/redo documentation

**Files:**
- Modify: `documentation/04-box-system-and-reactivity.md`

- [ ] **Step 1: Add undo/redo section after "Transactions and Undo/Redo"**

Find the existing "Transactions and Undo/Redo" section in Chapter 04 and expand it with the actual API:

```markdown
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

\`\`\`typescript
// Creates an undo point (default)
project.editing.modify(() => { region.position = newPosition; });

// No undo point — used for continuous updates (e.g., region duration growth during recording)
project.editing.modify(() => { region.duration = newDuration; }, false);
\`\`\`

#### Batching for Atomic Undo

Wrap related changes in a single `editing.modify()` so undo reverses them all at once:

\`\`\`typescript
// BAD: 3 separate undo points — user must undo 3 times
tracks.forEach(track => {
  project.editing.modify(() => updateTrackAutomation(track));
});

// GOOD: 1 undo point — all tracks revert together
project.editing.modify(() => {
  tracks.forEach(track => updateTrackAutomation(track));
});
\`\`\`

#### Observing Changes for UI Updates

`editing.subscribe()` fires after every transaction (including undo/redo). Use it to keep UI in sync:

\`\`\`typescript
useEffect(() => {
  if (!project) return;
  const subscription = project.editing.subscribe(() => {
    setCanUndo(project.editing.canUndo());
    setCanRedo(project.editing.canRedo());
    // Re-derive any UI state from the box graph here
  });
  return () => subscription.terminate();
}, [project]);
\`\`\`

#### Pattern: Deriving UI State from the Box Graph

Instead of maintaining parallel React state for data that's encoded in the box graph, derive it:

\`\`\`typescript
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
\`\`\`

This pattern makes undo/redo work natively — the box graph is the single source of truth, and the UI is a derived view. See the [Comp Lanes demo](https://opendaw-test.pages.dev/comp-lanes-demo.html) for a working example.
```

- [ ] **Step 2: Update the Table of Contents**

Add entries for the new subsections under the existing "Transactions and Undo/Redo" entry.

- [ ] **Step 3: Verify build passes (VitePress links)**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add documentation/04-box-system-and-reactivity.md
git commit -m "docs: add undo/redo API, batching, and derived state patterns to Ch 04"
```

---

### Task 10: Update description text and polish

**Files:**
- Modify: `src/demos/playback/comp-lanes-demo.tsx`

- [ ] **Step 1: Update header description**

```tsx
<Text size="4" color="gray">
  Compare two approaches to take comping: volume automation crossfades vs
  region splicing with SDK voice management. Drop one file for staggered
  takes, or multiple files for separate performances. Undo/redo with Cmd+Z.
</Text>
```

- [ ] **Step 2: Update instructions callout**

```tsx
<Callout.Root size="1" color="blue">
  <Callout.Text>
    {compMode === "automation"
      ? "Crossfades use volume automation curves between parallel tracks."
      : "Consecutive regions on a single track — SDK manages 20ms voice crossfade at boundaries."}
    {" "}Cmd+Z to undo, Cmd+Shift+Z to redo.
  </Callout.Text>
</Callout.Root>
```

- [ ] **Step 3: Update drop zone helper text**

Already covered in Task 5 step 3.

- [ ] **Step 4: Verify build passes**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/demos/playback/comp-lanes-demo.tsx
git commit -m "chore: update comp-lanes demo description and instructional text"
```

---

## Task Dependency Order

Tasks 1-2 are sequential prerequisites. Tasks 3-4 depend on 1-2. Task 5 (multi-file) and Task 6 (splice mode) can be developed in either order but both depend on 1-2. Task 7 (PeaksPainter) is independent of 3-6. Task 8 is needed by Task 6. Task 9 (docs) is independent. Task 10 is last.

Recommended order: 1 → 2 → 8 → 3 → 4 → 5 → 6 → 7 → 9 → 10
