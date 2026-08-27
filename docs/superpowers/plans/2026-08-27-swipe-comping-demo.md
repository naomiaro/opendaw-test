# Quick Swipe Comping Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new demo page that loop-records real takes from the microphone onto one Tape, then lets the user swipe across take lanes to assemble a splice-region comp — Logic Pro's Quick Swipe Comping, styled in the repo's console-editorial language.

**Architecture:** One Tape audio unit; the SDK creates one take TrackBox per loop pass (all sharing one `AudioFileBox`, per-take `waveformOffset` in seconds). A comp TrackBox under the same Tape holds one `AudioRegionBox` per comp zone (`TimeBase.Seconds`, PPQN position, seconds duration, `waveformOffset` aimed at the winning take's frames). Butt splices only — the 0.0.165 engine gives every seam a transparent ~20 ms overlapping crossfade. Comp state (`{boundaries, assignments}`) persists as a `comp:`-prefixed JSON label on the first comp region so undo/redo reverts swipes atomically.

**Tech Stack:** React 18 + Radix Themes, OpenDAW SDK 0.0.170 (WASM engine), CanvasPainter/PeaksPainter waveforms, vitest for pure logic.

**Spec:** `docs/superpowers/specs/2026-08-27-swipe-comping-demo-design.md`

## Global Constraints

- All box-graph mutations inside `project.editing.modify()`; abort by THROWING, never early-return.
- `PPQN.secondsToPulses()` returns float — `Math.round()` before any Int32 field (`position`).
- Option types: `.isEmpty()` / `.unwrap()` — never `?.` / `??` / `isSome`.
- `unit.tracks.values()` for track arrays (`.adapters()` does not exist on AudioUnitTracks); `regions.adapters.values()` before filter/map (SortedSet).
- Region discovery via adapter layer only — never `boxGraph.boxes()` scans.
- Never call `editing.modify()` inside `editing.subscribe()` — guard rebuild effects with `isRebuildingRef`.
- `stopRecording()` to stop recording; `stop(true)` only after all sample loaders reach a terminal state (barrier + 30 s timeout).
- PeaksPainter calls use `v0: -1.001, v1: 1.001` and set `ctx.fillStyle` first.
- Playhead/progress overlays are direct-DOM writes inside `AnimationFrame.add()` — no per-frame setState for canvas-adjacent state.
- Design language: `docs/design/2026-06-11-mastering-console-editorial.md`; canvas colors from `CANVAS_COLORS` (`src/lib/design/consoleTheme.ts`); respect `prefers-reduced-motion` for the collapse animation.
- `npx tsc --noEmit` must add zero new `^src/` errors; `noUnusedLocals` is strict (introduce state in the commit that first reads it).
- New-demo checklist applies (HTML entry, vite input, index card, sitemap, og-image, GoatCounter, README row).
- Demo copy contains no SDK version strings? — version pins are fine in demo/debug copy, only `documentation/*.md` chapters ban them; the explainer may say "since 0.0.165" but prefer linking `debug/README.md` instead.
- The existing loop-recording and comp-lanes demos are NOT modified by this plan (retirement is a separate follow-up PR per the spec).

---

### Task 1: Branch + pure comp-zone math (TDD)

**Files:**
- Modify: `src/lib/compLaneUtils.ts` (append a "Swipe comping" section at the end)
- Create: `src/lib/compLaneUtils.test.ts`

**Interfaces:**
- Consumes: existing `CompState { boundaries: number[]; assignments: number[] }` from `compLaneUtils.ts`.
- Produces (later tasks rely on these exact names):
  - `interface CompSpan { start: number; end: number; take: number }`
  - `compSpans(state: CompState, totalLength: number): CompSpan[]`
  - `assignRange(state: CompState, takeIndex: number, from: number, to: number, totalLength: number): CompState`
  - `assignZoneAt(state: CompState, takeIndex: number, position: number, totalLength: number): CompState`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/swipe-comping-demo
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/compLaneUtils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  compSpans,
  assignRange,
  assignZoneAt,
  type CompState,
} from "./compLaneUtils";

const TOTAL = 15360; // 4 bars of 4/4 at PPQN 960/quarter

describe("compSpans", () => {
  it("maps an empty comp state to one full-length span", () => {
    const state: CompState = { boundaries: [], assignments: [2] };
    expect(compSpans(state, TOTAL)).toEqual([{ start: 0, end: TOTAL, take: 2 }]);
  });

  it("maps boundaries to consecutive spans", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    expect(compSpans(state, TOTAL)).toEqual([
      { start: 0, end: 4000, take: 0 },
      { start: 4000, end: 9000, take: 1 },
      { start: 9000, end: TOTAL, take: 0 },
    ]);
  });
});

describe("assignRange", () => {
  it("splits a single zone when swiping in the middle", () => {
    const state: CompState = { boundaries: [], assignments: [0] };
    expect(assignRange(state, 1, 4000, 9000, TOTAL)).toEqual({
      boundaries: [4000, 9000],
      assignments: [0, 1, 0],
    });
  });

  it("swipe reaching the start produces no zero-length leading zone", () => {
    const state: CompState = { boundaries: [], assignments: [0] };
    expect(assignRange(state, 1, 0, 9000, TOTAL)).toEqual({
      boundaries: [9000],
      assignments: [1, 0],
    });
  });

  it("swipe covering everything replaces the whole comp", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    expect(assignRange(state, 2, 0, TOTAL, TOTAL)).toEqual({
      boundaries: [],
      assignments: [2],
    });
  });

  it("swiping the same take over adjacent zones merges them", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    // Swipe take 0 over [3000, 10000] — swallows the middle zone entirely
    expect(assignRange(state, 0, 3000, 10000, TOTAL)).toEqual({
      boundaries: [],
      assignments: [0],
    });
  });

  it("overlapping an existing boundary splits only the overlapped parts", () => {
    const state: CompState = { boundaries: [8000], assignments: [0, 1] };
    expect(assignRange(state, 2, 6000, 10000, TOTAL)).toEqual({
      boundaries: [6000, 10000],
      assignments: [0, 2, 1],
    });
  });

  it("accepts from/to in either order", () => {
    const state: CompState = { boundaries: [], assignments: [0] };
    expect(assignRange(state, 1, 9000, 4000, TOTAL)).toEqual(
      assignRange(state, 1, 4000, 9000, TOTAL)
    );
  });

  it("clamps to [0, totalLength] and rounds to integer PPQN", () => {
    const state: CompState = { boundaries: [], assignments: [0] };
    expect(assignRange(state, 1, -50.7, TOTAL + 99, TOTAL)).toEqual({
      boundaries: [],
      assignments: [1],
    });
  });

  it("returns the state unchanged for a zero-length range", () => {
    const state: CompState = { boundaries: [4000], assignments: [0, 1] };
    expect(assignRange(state, 1, 5000, 5000.4, TOTAL)).toBe(state);
  });
});

describe("assignZoneAt", () => {
  it("reassigns the zone containing the position", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    expect(assignZoneAt(state, 2, 5000, TOTAL)).toEqual({
      boundaries: [4000, 9000],
      assignments: [0, 2, 0],
    });
  });

  it("merges with a neighbor when the reassignment makes them equal", () => {
    const state: CompState = { boundaries: [4000, 9000], assignments: [0, 1, 0] };
    expect(assignZoneAt(state, 0, 5000, TOTAL)).toEqual({
      boundaries: [],
      assignments: [0],
    });
  });

  it("is a no-op when the zone already has that take", () => {
    const state: CompState = { boundaries: [4000], assignments: [0, 1] };
    expect(assignZoneAt(state, 1, 6000, TOTAL)).toBe(state);
  });

  it("is a no-op outside [0, totalLength)", () => {
    const state: CompState = { boundaries: [4000], assignments: [0, 1] };
    expect(assignZoneAt(state, 0, TOTAL + 1, TOTAL)).toBe(state);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/compLaneUtils.test.ts`
Expected: FAIL — `compSpans`, `assignRange`, `assignZoneAt` are not exported.

- [ ] **Step 4: Implement the zone math**

Append to `src/lib/compLaneUtils.ts`:

```typescript
// ─────────────────────────────────────────────────────────────────────────
// Swipe comping (recorded takes) — pure zone math
// ─────────────────────────────────────────────────────────────────────────

export interface CompSpan {
  start: number;
  end: number;
  take: number;
}

/** Expand a CompState into consecutive [start, end) spans over [0, totalLength]. */
export function compSpans(state: CompState, totalLength: number): CompSpan[] {
  const bounds = [0, ...state.boundaries, totalLength];
  return state.assignments.map((take, i) => ({
    start: bounds[i],
    end: bounds[i + 1],
    take,
  }));
}

function spansToState(spans: CompSpan[]): CompState {
  const merged: CompSpan[] = [];
  for (const span of spans) {
    if (span.end - span.start <= 0) continue;
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.take === span.take) {
      prev.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  if (merged.length === 0) return { boundaries: [], assignments: [0] };
  return {
    boundaries: merged.slice(1).map((s) => s.start),
    assignments: merged.map((s) => s.take),
  };
}

/** Swipe: assign [from, to] to takeIndex, splitting/merging zones as needed. */
export function assignRange(
  state: CompState,
  takeIndex: number,
  from: number,
  to: number,
  totalLength: number
): CompState {
  const a = Math.max(0, Math.min(totalLength, Math.round(Math.min(from, to))));
  const b = Math.max(0, Math.min(totalLength, Math.round(Math.max(from, to))));
  if (b - a <= 0) return state;
  const spans: CompSpan[] = [];
  for (const span of compSpans(state, totalLength)) {
    if (span.end <= a || span.start >= b) {
      spans.push(span);
      continue;
    }
    if (span.start < a) spans.push({ start: span.start, end: a, take: span.take });
    if (span.end > b) spans.push({ start: b, end: span.end, take: span.take });
  }
  spans.push({ start: a, end: b, take: takeIndex });
  spans.sort((x, y) => x.start - y.start);
  return spansToState(spans);
}

/** Zone click: reassign the whole zone containing `position` to takeIndex. */
export function assignZoneAt(
  state: CompState,
  takeIndex: number,
  position: number,
  totalLength: number
): CompState {
  const spans = compSpans(state, totalLength);
  const hit = spans.find((s) => position >= s.start && position < s.end);
  if (hit === undefined || hit.take === takeIndex) return state;
  return spansToState(
    spans.map((s) => (s === hit ? { ...s, take: takeIndex } : s))
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/compLaneUtils.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/compLaneUtils.ts src/lib/compLaneUtils.test.ts
git commit -m "feat: pure comp-zone math for swipe comping (compSpans/assignRange/assignZoneAt)"
```

---

### Task 2: Comp region audio math (TDD)

**Files:**
- Modify: `src/lib/compLaneUtils.ts`
- Modify: `src/lib/compLaneUtils.test.ts`

**Interfaces:**
- Produces:
  - `compRegionWaveformOffset(takeWaveformOffsetSec: number, zoneStartPpqn: number, bpm: number): number`
  - `takeExtentPpqn(takeDurationSec: number, bpm: number, totalLength: number): number`

Background for the implementer: recorded takes are `TimeBase.Seconds` regions sharing one audio buffer. The engine reads `sampleIndex = (elapsedSeconds + waveformOffset) * sampleRate` where `elapsedSeconds` is measured from the region's timeline start. A comp region starting at zone PPQN `z` that plays take T must read the buffer at `T.waveformOffset + seconds(z)`. There is no lead-in in this demo, so every take's region position is PPQN 0 and zone PPQN values are loop-relative absolute positions.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/compLaneUtils.test.ts`:

```typescript
import { compRegionWaveformOffset, takeExtentPpqn } from "./compLaneUtils";

describe("compRegionWaveformOffset", () => {
  it("adds the zone start (as seconds at the bpm) to the take's buffer offset", () => {
    // 3840 pulses = 4 quarters = 2.0 s at 120 BPM
    expect(compRegionWaveformOffset(1.25, 3840, 120)).toBeCloseTo(3.25, 6);
  });

  it("returns the take's own offset at zone start 0", () => {
    expect(compRegionWaveformOffset(0.8, 0, 90)).toBeCloseTo(0.8, 6);
  });
});

describe("takeExtentPpqn", () => {
  it("converts the take duration to integer PPQN", () => {
    // 2.0 s at 120 BPM = 3840 pulses
    expect(takeExtentPpqn(2.0, 120, 15360)).toBe(3840);
  });

  it("clamps to the loop length (final takes carry an extra audio-block tail)", () => {
    expect(takeExtentPpqn(60, 120, 15360)).toBe(15360);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/compLaneUtils.test.ts`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement**

Append to `src/lib/compLaneUtils.ts` (the `PPQN` import already exists at the top):

```typescript
/** Buffer read offset (seconds) for a comp region starting at zoneStartPpqn
 *  playing a take whose buffer offset is takeWaveformOffsetSec. Assumes the
 *  loop starts at PPQN 0 (this demo has no lead-in). */
export function compRegionWaveformOffset(
  takeWaveformOffsetSec: number,
  zoneStartPpqn: number,
  bpm: number
): number {
  return takeWaveformOffsetSec + PPQN.pulsesToSeconds(zoneStartPpqn, bpm);
}

/** The take's recorded extent in loop-relative PPQN, clamped to the loop.
 *  A take stopped mid-pass is shorter than the loop; the final take can be
 *  up to one audio block longer. */
export function takeExtentPpqn(
  takeDurationSec: number,
  bpm: number,
  totalLength: number
): number {
  return Math.min(
    totalLength,
    Math.round(PPQN.secondsToPulses(takeDurationSec, bpm))
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/compLaneUtils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/compLaneUtils.ts src/lib/compLaneUtils.test.ts
git commit -m "feat: comp region waveformOffset + take extent math"
```

---

### Task 3: Box-graph comp engine (comp track, rebuild, derive)

**Files:**
- Modify: `src/lib/compLaneUtils.ts`

**Interfaces:**
- Consumes: `compSpans`, `compRegionWaveformOffset`, `takeExtentPpqn`, `encodeCompStateToLabel`, existing `CompState`.
- Produces:
  - `const COMP_REGION_LABEL = "Comp"`
  - `interface RecordedTakeSource { regionBox: AudioRegionBox; audioFileBox: AudioFileBox; waveformOffsetSec: number; durationSec: number }`
  - `ensureCompTrack(project: Project, audioUnitBox: AudioUnitBox): TrackBox`
  - `rebuildCompRegions(project: Project, compTrackBox: TrackBox, takes: RecordedTakeSource[], state: CompState, loopPpqn: number, bpm: number): void`
  - `deriveCompStateFromCompTrack(project: Project, compTrackBox: TrackBox): CompState | null`

No unit tests (box-graph code); verified by tsc here and by the browser task. This is exactly the pattern of the existing `rebuildSpliceRegions` (same file) generalized to recorded Seconds-timeBase takes.

- [ ] **Step 1: Add imports**

At the top of `src/lib/compLaneUtils.ts`, extend the existing imports:

```typescript
import { PPQN, Interpolation, TimeBase } from "@opendaw/lib-dsp";
// ...existing...
import { AudioUnitBoxAdapter, TrackBoxAdapter, ValueRegionBoxAdapter, TrackType } from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox, TrackBox as TrackBoxClass } from "@opendaw/studio-boxes";
import type { TrackBox, ValueRegionBox, AudioUnitBox } from "@opendaw/studio-boxes";
```

Note: `TrackBox` is currently a type-only import; creating boxes needs the value import — alias it as `TrackBoxClass` to keep the existing type usages untouched (or switch the whole import to a value import and drop the alias; either is fine as long as tsc is clean).

- [ ] **Step 2: Implement the three functions**

Append to `src/lib/compLaneUtils.ts`:

```typescript
export const COMP_REGION_LABEL = "Comp";

export interface RecordedTakeSource {
  regionBox: AudioRegionBox;
  audioFileBox: AudioFileBox;
  waveformOffsetSec: number;
  durationSec: number;
}

/** Find the Tape's comp track (regions carrying the comp-state label or
 *  "Comp"), or create a new TrackBox under the audio unit. Creation uses an
 *  UNMARKED modify so it folds into the first rebuild's undo entry. */
export function ensureCompTrack(
  project: Project,
  audioUnitBox: AudioUnitBox
): TrackBox {
  const unitAdapter = project.boxAdapters.adapterFor(
    audioUnitBox,
    AudioUnitBoxAdapter
  );
  let maxIndex = -1;
  for (const track of unitAdapter.tracks.values()) {
    const isComp = track.regions.adapters
      .values()
      .some(
        (r) =>
          r.label === COMP_REGION_LABEL || r.label.startsWith("comp:")
      );
    if (isComp) return track.box;
    maxIndex = Math.max(maxIndex, track.box.index.getValue());
  }
  return project.editing
    .modify(
      () =>
        TrackBoxClass.create(project.boxGraph, UUID.generate(), (box) => {
          box.type.setValue(TrackType.Audio);
          box.index.setValue(maxIndex + 1);
          box.tracks.refer(audioUnitBox.tracks);
          box.target.refer(audioUnitBox);
        }),
      false
    )
    .unwrap();
}

/** Rebuild the comp track from the comp state: one butt-jointed Seconds-
 *  timeBase AudioRegionBox per zone, reading the winning take's frames via
 *  waveformOffset. Mutes every take region (the comp is the audible path).
 *  One marked modify = one undo step per swipe. */
export function rebuildCompRegions(
  project: Project,
  compTrackBox: TrackBox,
  takes: RecordedTakeSource[],
  state: CompState,
  loopPpqn: number,
  bpm: number
): void {
  project.editing.modify(() => {
    const trackAdapter = project.boxAdapters.adapterFor(
      compTrackBox,
      TrackBoxAdapter
    );
    for (const region of trackAdapter.regions.adapters.values()) {
      region.box.delete();
    }
    for (const take of takes) {
      take.regionBox.mute.setValue(true);
    }

    let labelWritten = false;
    for (const span of compSpans(state, loopPpqn)) {
      const take = takes[span.take];
      if (take === undefined) {
        throw new Error(
          `rebuildCompRegions: zone references missing take ${span.take} — aborting`
        );
      }
      const zoneStart = Math.round(span.start);
      // Clamp to the take's recorded extent (short final takes).
      const zoneEnd = Math.min(
        Math.round(span.end),
        Math.max(zoneStart, takeExtentPpqn(take.durationSec, bpm, loopPpqn))
      );
      if (zoneEnd <= zoneStart) continue;

      const durationSec = PPQN.pulsesToSeconds(zoneEnd - zoneStart, bpm);
      const eventsCollectionBox = ValueEventCollectionBox.create(
        project.boxGraph,
        UUID.generate()
      );
      AudioRegionBox.create(project.boxGraph, UUID.generate(), (box) => {
        box.regions.refer(compTrackBox.regions);
        box.file.refer(take.audioFileBox);
        box.events.refer(eventsCollectionBox.owners);
        box.position.setValue(zoneStart);
        box.timeBase.setValue(TimeBase.Seconds);
        box.duration.setValue(durationSec);
        box.loopDuration.setValue(durationSec);
        box.waveformOffset.setValue(
          compRegionWaveformOffset(take.waveformOffsetSec, zoneStart, bpm)
        );
        // Comp state rides the first created region's label (undo-atomic).
        box.label.setValue(
          labelWritten ? COMP_REGION_LABEL : encodeCompStateToLabel(state)
        );
        box.mute.setValue(false);
      });
      labelWritten = true;
    }
    if (!labelWritten) {
      throw new Error(
        "rebuildCompRegions: no comp regions were created — aborting"
      );
    }
  });
}

/** Read the persisted comp state back from the comp track (after undo/redo). */
export function deriveCompStateFromCompTrack(
  project: Project,
  compTrackBox: TrackBox
): CompState | null {
  const trackAdapter = project.boxAdapters.adapterFor(
    compTrackBox,
    TrackBoxAdapter
  );
  for (const region of trackAdapter.regions.adapters.values()) {
    const label = region.label;
    if (!label.startsWith("comp:")) continue;
    try {
      const parsed = JSON.parse(label.slice("comp:".length));
      if (Array.isArray(parsed.boundaries) && Array.isArray(parsed.assignments)) {
        return parsed as CompState;
      }
    } catch (e) {
      console.error(
        "deriveCompStateFromCompTrack: bad label: " + JSON.stringify(String(e))
      );
    }
  }
  return null;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep '^src/' ; echo "exit: $?"`
Expected: no output before `exit:` (grep exits 1 on no matches — that's the pass condition).

- [ ] **Step 4: Run the full test file (regression)**

Run: `npx vitest run src/lib/compLaneUtils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/compLaneUtils.ts
git commit -m "feat: comp track ensure/rebuild/derive for recorded-take splicing"
```

---

### Task 4: SwipeCompLanes component

**Files:**
- Create: `src/demos/recording/SwipeCompLanes.tsx`

**Interfaces:**
- Consumes: `CompState`, `compSpans`, `CompSpan` from `@/lib/compLaneUtils`; `CanvasPainter` from `@/lib/CanvasPainter`; `CANVAS_COLORS` from `@/lib/design/consoleTheme`; `PeaksPainter` (`@opendaw/lib-fusion`), `AnimationFrame` (`@opendaw/lib-dom`), `PPQN` (`@opendaw/lib-dsp`).
- Produces (the demo page consumes these exact shapes):

```typescript
export interface SwipeTakeLane {
  regionBox: AudioRegionBox;          // take region (identity key)
  label: string;                      // "Take 1"…
  color: string;                      // lane accent
  sampleLoader: SampleLoader | null;
  waveformOffsetFrames: number;
  durationSec: number;
}

interface SwipeCompLanesProps {
  takes: SwipeTakeLane[];
  compState: CompState;
  loopPpqn: number;
  bpm: number;
  sampleRate: number;
  interactive: boolean;               // false while recording/finalizing
  recordingLive: boolean;             // recording view: comp bypassed, lanes grow live
  collapsed: boolean;
  onToggleCollapsed: () => void;
  auditionTake: number | null;        // index into takes, null = comp audible
  onToggleAudition: (takeIndex: number) => void;
  onSwipe: (takeIndex: number, fromPpqn: number, toPpqn: number) => void;
  onZoneClick: (takeIndex: number, positionPpqn: number) => void;
  getPositionPpqn: () => number;      // read engine position (PPQN)
  showPlayhead: boolean;
}
export const SwipeCompLanes: React.FC<SwipeCompLanesProps>;
export const LANE_COLORS: string[];
```

- [ ] **Step 1: Write the component**

Create `src/demos/recording/SwipeCompLanes.tsx`:

```tsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { Flex, Text } from "@radix-ui/themes";
import type { SampleLoader } from "@opendaw/studio-adapters";
import type { AudioRegionBox } from "@opendaw/studio-boxes";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PeaksPainter } from "@opendaw/lib-fusion";
import type { Peaks } from "@opendaw/lib-fusion";
import type { PeaksWriter } from "@opendaw/studio-core";
import { PPQN } from "@opendaw/lib-dsp";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { CANVAS_COLORS } from "@/lib/design/consoleTheme";
import { compSpans, type CompState, type CompSpan } from "@/lib/compLaneUtils";

// Console accent rotation for take lanes (from the mastering-console palette).
export const LANE_COLORS = [
  "#e8a33d", // amber
  "#5fb4c9", // cyan
  "#7fbf6a", // green
  "#df8a76", // rose
  "#ab92db", // violet
  "#7fa0d4", // slate
];

const LANE_HEIGHT = 48;
const COMP_LANE_HEIGHT = 56;
const HEADER_WIDTH = 120;
const CLICK_TOLERANCE_PX = 4;

export interface SwipeTakeLane {
  regionBox: AudioRegionBox;
  label: string;
  color: string;
  sampleLoader: SampleLoader | null;
  waveformOffsetFrames: number;
  durationSec: number;
}

interface SwipeCompLanesProps {
  takes: SwipeTakeLane[];
  compState: CompState;
  loopPpqn: number;
  bpm: number;
  sampleRate: number;
  interactive: boolean;
  recordingLive: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  auditionTake: number | null;
  onToggleAudition: (takeIndex: number) => void;
  onSwipe: (takeIndex: number, fromPpqn: number, toPpqn: number) => void;
  onZoneClick: (takeIndex: number, positionPpqn: number) => void;
  getPositionPpqn: () => number;
  showPlayhead: boolean;
}

/** Renders waveform strips for one take over the lane's x-range.
 *  All lanes map x ∈ [0, width] to loop PPQN ∈ [0, loopPpqn]. */
function paintTakeStrips(
  context: CanvasRenderingContext2D,
  peaks: Peaks | PeaksWriter,
  lane: SwipeTakeLane,
  durationSec: number, // read LIVE from the region box each paint — grows during recording
  x0: number,
  x1: number,
  width: number,
  height: number,
  loopSeconds: number,
  sampleRate: number
): void {
  // frames-per-pixel is constant across the lane; u range follows x range.
  const loopFrames = loopSeconds * sampleRate;
  const u0 = lane.waveformOffsetFrames + (x0 / width) * loopFrames;
  const laneEndFrames =
    lane.waveformOffsetFrames +
    Math.min(durationSec * sampleRate, loopFrames);
  const u1 = Math.min(
    lane.waveformOffsetFrames + (x1 / width) * loopFrames,
    laneEndFrames
  );
  if (u1 <= u0) return;
  // Shrink x1 proportionally when the take ends before the zone does.
  const effX1 =
    x0 + ((u1 - u0) / ((x1 - x0 === 0 ? 1 : x1 - x0) * (loopFrames / width))) *
      (x1 - x0) *
      (loopFrames / width);
  const numChannels = peaks.numChannels;
  const channelHeight = height / numChannels;
  for (let ch = 0; ch < numChannels; ch++) {
    PeaksPainter.renderPixelStrips(context, peaks, ch, {
      x0,
      x1: Math.min(x1, effX1),
      y0: ch * channelHeight + 1,
      y1: (ch + 1) * channelHeight - 1,
      u0,
      u1,
      v0: -1.001,
      v1: 1.001,
    });
  }
}

/** One take lane: dim base waveform + lit spans owned by this take. */
const TakeLaneCanvas: React.FC<{
  lane: SwipeTakeLane;
  spans: CompSpan[]; // spans assigned to this take, loop-relative PPQN
  loopPpqn: number;
  bpm: number;
  sampleRate: number;
}> = ({ lane, spans, loopPpqn, bpm, sampleRate }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const laneRef = useRef(lane);
  const spansRef = useRef(spans);
  const painterRef = useRef<CanvasPainter | null>(null);
  laneRef.current = lane;
  spansRef.current = spans;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const painter = new CanvasPainter(canvas, (_, context) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const l = laneRef.current;
      context.fillStyle = CANVAS_COLORS.bg;
      context.fillRect(0, 0, w, h);
      if (!l.sampleLoader) return;
      const peaksOption = l.sampleLoader.peaks;
      if (peaksOption.isEmpty()) return;
      const peaks = peaksOption.unwrap() as Peaks | PeaksWriter;
      const loopSeconds = PPQN.pulsesToSeconds(loopPpqn, bpm);
      // Live duration: the SDK updates regionBox.duration every frame while
      // recording, so the top lane grows without any React re-render.
      const liveDurationSec = l.regionBox.duration.getValue();
      // Dim base waveform across the whole lane.
      context.fillStyle = CANVAS_COLORS.structural;
      paintTakeStrips(context, peaks, l, liveDurationSec, 0, w, w, h, loopSeconds, sampleRate);
      // Lit spans owned by this take.
      for (const span of spansRef.current) {
        const xa = (span.start / loopPpqn) * w;
        const xb = (span.end / loopPpqn) * w;
        context.fillStyle = l.color + "26"; // ~15% tint
        context.fillRect(xa, 0, xb - xa, h);
        context.fillStyle = l.color;
        paintTakeStrips(context, peaks, l, liveDurationSec, xa, xb, w, h, loopSeconds, sampleRate);
      }
    });
    painterRef.current = painter;
    const animSub = AnimationFrame.add(() => painter.requestUpdate());
    return () => {
      animSub.terminate();
      painter.terminate();
      painterRef.current = null;
    };
  }, [loopPpqn, bpm, sampleRate]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: LANE_HEIGHT, display: "block" }}
    />
  );
};

/** The comp lane: assembled waveform, per-zone tint in the source take's color. */
const CompLaneCanvas: React.FC<{
  takes: SwipeTakeLane[];
  compState: CompState;
  loopPpqn: number;
  bpm: number;
  sampleRate: number;
  bypassed: boolean; // recording view: comp is muted — render in neutral color
}> = ({ takes, compState, loopPpqn, bpm, sampleRate, bypassed }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const takesRef = useRef(takes);
  const stateRef = useRef(compState);
  const bypassedRef = useRef(bypassed);
  takesRef.current = takes;
  stateRef.current = compState;
  bypassedRef.current = bypassed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const painter = new CanvasPainter(canvas, (_, context) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      context.fillStyle = CANVAS_COLORS.shade;
      context.fillRect(0, 0, w, h);
      const loopSeconds = PPQN.pulsesToSeconds(loopPpqn, bpm);
      for (const span of compSpans(stateRef.current, loopPpqn)) {
        const lane = takesRef.current[span.take];
        if (lane === undefined || !lane.sampleLoader) continue;
        const peaksOption = lane.sampleLoader.peaks;
        if (peaksOption.isEmpty()) continue;
        const peaks = peaksOption.unwrap() as Peaks | PeaksWriter;
        const xa = (span.start / loopPpqn) * w;
        const xb = (span.end / loopPpqn) * w;
        const dimmed = bypassedRef.current;
        // Bypassed (recording view): neutral color, no take tints — the comp
        // is muted while recording, and the different color says so.
        context.fillStyle = dimmed ? CANVAS_COLORS.shade : lane.color + "22";
        context.fillRect(xa, 0, xb - xa, h);
        context.fillStyle = dimmed ? CANVAS_COLORS.structural : CANVAS_COLORS.label;
        paintTakeStrips(
          context, peaks, lane, lane.regionBox.duration.getValue(),
          xa, xb, w, h, loopSeconds, sampleRate
        );
        // Seam tick at each zone start (skip x=0).
        if (span.start > 0) {
          context.fillStyle = dimmed ? CANVAS_COLORS.structural : CANVAS_COLORS.amber;
          context.beginPath();
          context.moveTo(xa - 4, 0);
          context.lineTo(xa + 4, 0);
          context.lineTo(xa, 7);
          context.closePath();
          context.fill();
        }
      }
    });
    const animSub = AnimationFrame.add(() => painter.requestUpdate());
    return () => {
      animSub.terminate();
      painter.terminate();
    };
  }, [loopPpqn, bpm, sampleRate]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: COMP_LANE_HEIGHT, display: "block" }}
    />
  );
};

interface DragState {
  takeIndex: number;
  startX: number;
  currentX: number;
  laneWidth: number;
}

export const SwipeCompLanes: React.FC<SwipeCompLanesProps> = ({
  takes,
  compState,
  loopPpqn,
  bpm,
  sampleRate,
  interactive,
  recordingLive,
  collapsed,
  onToggleCollapsed,
  auditionTake,
  onToggleAudition,
  onSwipe,
  onZoneClick,
  getPositionPpqn,
  showPlayhead,
}) => {
  const [drag, setDrag] = useState<DragState | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  // Direct-DOM playhead (loop-relative), no per-frame setState.
  useEffect(() => {
    const sub = AnimationFrame.add(() => {
      const el = playheadRef.current;
      if (!el) return;
      if (!showPlayhead || loopPpqn <= 0) {
        el.style.display = "none";
        return;
      }
      el.style.display = "block";
      const pct = ((getPositionPpqn() % loopPpqn) / loopPpqn) * 100;
      el.style.left = `${Math.min(100, Math.max(0, pct))}%`;
    });
    return () => sub.terminate();
  }, [showPlayhead, loopPpqn, getPositionPpqn]);

  const xToPpqn = useCallback(
    (x: number, width: number) =>
      Math.round((Math.min(Math.max(x, 0), width) / width) * loopPpqn),
    [loopPpqn]
  );

  const handlePointerDown = useCallback(
    (takeIndex: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      const rect = e.currentTarget.getBoundingClientRect();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({
        takeIndex,
        startX: e.clientX - rect.left,
        currentX: e.clientX - rect.left,
        laneWidth: rect.width,
      });
    },
    [interactive]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (drag === null) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setDrag({ ...drag, currentX: e.clientX - rect.left });
    },
    [drag]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (drag === null) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      setDrag(null);
      if (Math.abs(endX - drag.startX) < CLICK_TOLERANCE_PX) {
        onZoneClick(drag.takeIndex, xToPpqn(endX, rect.width));
      } else {
        onSwipe(
          drag.takeIndex,
          xToPpqn(drag.startX, rect.width),
          xToPpqn(endX, rect.width)
        );
      }
    },
    [drag, onSwipe, onZoneClick, xToPpqn]
  );

  const spans = compSpans(compState, loopPpqn);
  const lanesHeight = takes.length * (LANE_HEIGHT + 1);

  return (
    <div
      style={{
        border: "1px solid var(--mc-line)",
        borderRadius: 4,
        overflow: "hidden",
        background: "var(--mc-panel)",
      }}
    >
      {/* ── Comp lane ── */}
      <div style={{ display: "flex", borderBottom: "2px solid var(--mc-line)" }}>
        <button
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand take lanes" : "Collapse take lanes"}
          style={{
            width: HEADER_WIDTH,
            minWidth: HEADER_WIDTH,
            boxSizing: "border-box",
            padding: "6px 10px",
            background: "var(--mc-panel)",
            border: "none",
            borderRight: "1px solid var(--mc-line)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            textAlign: "left",
          }}
        >
          <span
            className="scl-disclosure"
            style={{
              fontSize: 9,
              color: "var(--mc-amber)",
              transform: collapsed ? "rotate(-90deg)" : "none",
            }}
          >
            ▼
          </span>
          <Flex direction="column">
            <Text
              size="1"
              weight="bold"
              style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
            >
              Comp
            </Text>
            <Text size="1" color="gray">
              {takes.length} take{takes.length !== 1 ? "s" : ""}
            </Text>
          </Flex>
        </button>
        <div style={{ flex: 1, position: "relative" }}>
          <CompLaneCanvas
            takes={takes}
            compState={compState}
            loopPpqn={loopPpqn}
            bpm={bpm}
            sampleRate={sampleRate}
            bypassed={recordingLive}
          />
          {(auditionTake !== null || recordingLive) && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(13, 12, 10, 0.6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <Text size="1" color="gray">
                {recordingLive
                  ? "recording — comp bypassed"
                  : `auditioning ${takes[auditionTake ?? 0]?.label ?? ""} — comp bypassed`}
              </Text>
            </div>
          )}
        </div>
      </div>

      {/* ── Take lanes (collapsible) ── */}
      <div
        className="scl-lanes"
        style={{
          maxHeight: collapsed ? 0 : lanesHeight,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {takes
          .map((lane, i) => ({ lane, i }))
          .reverse() // newest take directly under the comp lane (Logic order)
          .map(({ lane, i }) => (
          <div
            key={lane.regionBox.address.toString()}
            style={{ display: "flex", borderBottom: "1px solid var(--mc-line)" }}
          >
            <div
              style={{
                width: HEADER_WIDTH,
                minWidth: HEADER_WIDTH,
                boxSizing: "border-box",
                padding: "4px 10px",
                borderRight: "1px solid var(--mc-line)",
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flex: "none",
                  background: lane.color,
                }}
              />
              <Text
                size="1"
                color="gray"
                style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}
              >
                {lane.label}
              </Text>
              <button
                onClick={() => onToggleAudition(i)}
                disabled={!interactive}
                aria-pressed={auditionTake === i}
                aria-label={`Audition ${lane.label}`}
                title={`Audition ${lane.label} alone`}
                style={{
                  marginLeft: "auto",
                  background: "none",
                  border: "none",
                  cursor: interactive ? "pointer" : "default",
                  fontSize: 12,
                  color:
                    auditionTake === i ? "var(--mc-cyan)" : "var(--mc-faint)",
                }}
              >
                🎧
              </button>
            </div>
            <div
              onPointerDown={handlePointerDown(i)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              style={{
                flex: 1,
                position: "relative",
                touchAction: "none",
                cursor: interactive ? "crosshair" : "default",
              }}
            >
              <TakeLaneCanvas
                lane={lane}
                spans={spans.filter((s) => s.take === i)}
                loopPpqn={loopPpqn}
                bpm={bpm}
                sampleRate={sampleRate}
              />
              {drag !== null && drag.takeIndex === i && (
                <div
                  style={{
                    position: "absolute",
                    top: 1,
                    bottom: 1,
                    left: Math.min(drag.startX, drag.currentX),
                    width: Math.abs(drag.currentX - drag.startX),
                    background: lane.color + "1c",
                    border: `1.5px dashed ${lane.color}`,
                    borderRadius: 2,
                    boxSizing: "border-box",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          </div>
        ))}
        {/* Seam lines through the take-lane stack */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: HEADER_WIDTH,
            right: 0,
            pointerEvents: "none",
          }}
        >
          {compState.boundaries.map((b) => (
            <div
              key={b}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${(b / loopPpqn) * 100}%`,
                width: 1,
                background: "rgba(216, 210, 200, 0.12)",
              }}
            />
          ))}
        </div>
      </div>

      {/* ── Playhead overlay (comp + lanes) ── */}
      <div
        style={{
          position: "relative",
          height: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: HEADER_WIDTH,
            right: 0,
            bottom: 0,
            height: collapsed
              ? COMP_LANE_HEIGHT + 2
              : COMP_LANE_HEIGHT + 2 + lanesHeight,
            pointerEvents: "none",
          }}
        >
          <div
            ref={playheadRef}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: 2,
              background: CANVAS_COLORS.playhead,
              display: "none",
              zIndex: 10,
            }}
          />
        </div>
      </div>
    </div>
  );
};
```

Notes for the implementer:
- **Lane display order is reversed** (newest take at the top, directly under the comp lane — Logic's take-folder order), but `takeIndex` values passed to every callback and used for spans/colors stay CHRONOLOGICAL (index into the `takes` prop). Only the visual stacking reverses.
- **Zone click = move the swipe window** (Logic parity): a press-release under `CLICK_TOLERANCE_PX` of travel fires `onZoneClick`, and the demo's `assignZoneAt` transfers the existing zone at that position — same boundaries — to the clicked take, so the same window can be A/B'd across lanes.
- The playhead overlay wrapper sits AFTER the lanes in the DOM with `height: 0` and positions upward over the stack; if that proves fragile during browser verification, an equivalent absolutely-positioned overlay inside a `position: relative` wrapper around both lane sections is fine — keep the direct-DOM `style.left` write.
- `paintTakeStrips`'s `effX1` clamp guards a take shorter than the zone; if the math reads awkwardly, simplifying it (compute `xEnd = (takeExtent/loopPpqn)*w` and `x1 = min(x1, xEnd)`, then map u linearly) is an acceptable equivalent — behavior, not formula, is the contract.
- The `.scl-lanes` / `.scl-disclosure` transitions come from page styles in Task 5 (with `prefers-reduced-motion` disabling them).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep '^src/'`
Expected: no output. (The component is not yet imported anywhere; `noUnusedLocals` applies within the file, so remove any locals you didn't end up using.)

- [ ] **Step 3: Commit**

```bash
git add src/demos/recording/SwipeCompLanes.tsx
git commit -m "feat: SwipeCompLanes — comp lane, swipeable take lanes, collapse, audition"
```

---

### Task 5: Demo page, HTML entry, vite input

**Files:**
- Create: `src/demos/recording/swipe-comping-demo.tsx`
- Create: `swipe-comping-demo.html` (copy `loop-recording-demo.html`, then edit)
- Modify: `vite.config.ts` (rollupOptions.input)

**Interfaces:**
- Consumes: everything from Tasks 1–4; `initializeOpenDAW` (`@/lib/projectSetup`); `useAudioDevicePermission`, `useRecordingTapes` (`@/hooks/...`); `useTakeDiscovery`, `LoopSetupPanel` (`./...`); `FINALIZATION_TIMEOUT_MS` (`@/hooks/useRecordingSession`); `waitForLoadingComplete` (`@/lib/engineLoading`); `GitHubCorner` / `BackLink` / `MoisesLogo` (`@/components/...`); `CONSOLE_STYLES` (`@/lib/design/consoleTheme`).
- Produces: the page at `/swipe-comping-demo.html`.

- [ ] **Step 1: Write the demo page**

Create `src/demos/recording/swipe-comping-demo.tsx`. This mirrors `loop-recording-demo.tsx`'s init/recording skeleton (single tape, no lead-in, no takes-preferences panel) and adds the comp layer:

```tsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Terminable } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import type { SampleLoaderState, AudioRegionBoxAdapter } from "@opendaw/studio-adapters";
import { AudioUnitBoxAdapter, TrackBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox, TrackBox } from "@opendaw/studio-boxes";
import { PPQN } from "@opendaw/lib-dsp";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { getAllRegions } from "@/lib/adapterUtils";
import { waitForLoadingComplete } from "@/lib/engineLoading";
import { useEnginePreference } from "@/hooks/useEnginePreference";
import { FINALIZATION_TIMEOUT_MS } from "@/hooks/useRecordingSession";
import { useAudioDevicePermission } from "@/hooks/useAudioDevicePermission";
import { useRecordingTapes } from "@/hooks/useRecordingTapes";
import { useTakeDiscovery } from "./useTakeDiscovery";
import { LoopSetupPanel } from "./LoopSetupPanel";
import { SwipeCompLanes, LANE_COLORS, type SwipeTakeLane } from "./SwipeCompLanes";
import {
  assignRange,
  assignZoneAt,
  takeExtentPpqn,
  ensureCompTrack,
  rebuildCompRegions,
  deriveCompStateFromCompTrack,
  type CompState,
  type RecordedTakeSource,
} from "@/lib/compLaneUtils";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Text,
  Button,
  Flex,
  Card,
  Callout,
  Badge,
} from "@radix-ui/themes";

const BAR_PPQN = PPQN.Quarter * 4; // one bar in 4/4

const PAGE_STYLES = `
.scl-lanes { transition: max-height 160ms ease; }
.scl-disclosure { display: inline-block; transition: transform 160ms ease; }
@media (prefers-reduced-motion: reduce) {
  .scl-lanes, .scl-disclosure { transition: none; }
}
`;

/** A comp lane + its box-graph source, derived from one take region. */
interface CompLaneData {
  lane: SwipeTakeLane;
  source: RecordedTakeSource;
}

/** Scan the Tape's take regions in chronological order (track index, then
 *  region position). Labels are re-derived from scan order so takes from a
 *  second recording session (whose SDK take numbers restart at 1) still get
 *  unique lane labels. */
function scanCompLanes(
  project: Project,
  audioUnitBox: AudioUnitBox
): CompLaneData[] {
  const unitAdapter = project.boxAdapters.adapterFor(
    audioUnitBox,
    AudioUnitBoxAdapter
  );
  const tracks = [...unitAdapter.tracks.values()].sort(
    (a, b) => a.box.index.getValue() - b.box.index.getValue()
  );
  const lanes: CompLaneData[] = [];
  for (const track of tracks) {
    const regions = track.regions.adapters
      .values()
      .filter((r): r is AudioRegionBoxAdapter => r.isAudioRegion())
      .filter((r) => r.label.startsWith("Take "));
    for (const regionAdapter of regions) {
      const fileOpt = regionAdapter.optFile;
      if (fileOpt.isEmpty()) continue;
      const fileAdapter = fileOpt.unwrap();
      const index = lanes.length;
      const waveformOffsetSec = regionAdapter.waveformOffset.getValue();
      const sampleRate = project.sampleRate;
      lanes.push({
        lane: {
          regionBox: regionAdapter.box,
          label: `Take ${index + 1}`,
          color: LANE_COLORS[index % LANE_COLORS.length],
          sampleLoader: fileAdapter.getOrCreateLoader(),
          waveformOffsetFrames: Math.round(waveformOffsetSec * sampleRate),
          durationSec: regionAdapter.box.duration.getValue(),
        },
        source: {
          regionBox: regionAdapter.box,
          audioFileBox: fileAdapter.box,
          waveformOffsetSec,
          durationSec: regionAdapter.box.duration.getValue(),
        },
      });
    }
  }
  return lanes;
}

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [initError, setInitError] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [finalizationError, setFinalizationError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const [useCountIn, setUseCountIn] = useState(true);
  const [bpm, setBpm] = useState(120);
  const [loopLengthBars, setLoopLengthBars] = useState(4);
  const [metronomeEnabled, setMetronomeEnabled] = useEnginePreference(project, [
    "metronome",
    "enabled",
  ]);

  // Comp state
  const [compLanes, setCompLanes] = useState<CompLaneData[]>([]);
  const [compState, setCompState] = useState<CompState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [auditionTake, setAuditionTake] = useState<number | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const compTrackRef = useRef<TrackBox | null>(null);
  const compLanesRef = useRef<CompLaneData[]>([]);
  const isRebuildingRef = useRef(false);
  // Set when compState was just derived FROM the box graph (undo/redo) — the
  // graph already holds those regions, so the next rebuild must be skipped
  // (rebuilding would add a redundant undo entry and kill the redo stack).
  const skipNextRebuildRef = useRef(false);
  const tapeCreatedRef = useRef(false);
  const finalizationSubsRef = useRef<Terminable[]>([]);
  compLanesRef.current = compLanes;

  const { audioInputDevices, audioOutputDevices, hasPermission, requestPermission } =
    useAudioDevicePermission();
  void audioOutputDevices;
  const { recordingTapes, armedCount, addTape } = useRecordingTapes({
    project,
    audioInputDevices,
    maxTapes: 1,
    onError: (msg) => setUiError(`Tape setup failed: ${msg}`),
  });

  const { takeIterations, setTakeIterations, terminateDiscovery, snapshotLoaders } =
    useTakeDiscovery({
      project,
      audioContext,
      isRecording,
      recordingTapes,
      leadInBars: 0,
    });

  const loopPpqn = loopLengthBars * BAR_PPQN;
  const tapeUnitBox = recordingTapes[0]?.capture.audioUnitBox ?? null;
  const hasComp = compState !== null && compLanes.length > 0;
  const takeCount = takeIterations.length;

  // ── Init ──
  useEffect(() => {
    let mounted = true;
    const subs: Terminable[] = [];
    (async () => {
      try {
        const { project: newProject, audioContext: ctx } = await initializeOpenDAW({
          onStatusUpdate: setStatus,
        });
        if (!mounted) return;
        setAudioContext(ctx);
        setProject(newProject);
        setStatus("Ready!");

        newProject.editing.modify(() => {
          newProject.timelineBox.loopArea.from.setValue(0);
          newProject.timelineBox.loopArea.to.setValue(BAR_PPQN * 4);
          newProject.timelineBox.loopArea.enabled.setValue(true);
        });

        const settings = newProject.engine.preferences.settings;
        settings.recording.allowTakes = true;
        settings.recording.olderTakeAction = "mute-region";
        settings.recording.olderTakeScope = "all";

        subs.push(
          newProject.engine.isRecording.catchupAndSubscribe((obs) => {
            if (mounted) setIsRecording(obs.getValue());
          })
        );
        subs.push(
          newProject.engine.isPlaying.catchupAndSubscribe((obs) => {
            if (mounted) setIsPlaying(obs.getValue());
          })
        );
        subs.push(
          newProject.engine.isCountingIn.catchupAndSubscribe((obs) => {
            if (mounted) setIsCountingIn(obs.getValue());
          })
        );
        setMetronomeEnabled(true);
      } catch (error) {
        console.error("Init error: " + String(error));
        if (mounted)
          setInitError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      mounted = false;
      subs.forEach((s) => s.terminate());
      finalizationSubsRef.current.forEach((s) => s.terminate());
      finalizationSubsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-create the single tape once permission + devices are ready ──
  useEffect(() => {
    if (!project || !hasPermission || audioInputDevices.length === 0) return;
    if (tapeCreatedRef.current || recordingTapes.length > 0) return;
    tapeCreatedRef.current = true;
    addTape();
  }, [project, hasPermission, audioInputDevices, recordingTapes.length, addTape]);

  // ── Sync BPM / loop area ──
  useEffect(() => {
    if (!project) return;
    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(bpm);
    });
  }, [project, bpm]);

  useEffect(() => {
    if (!project) return;
    project.editing.modify(() => {
      project.timelineBox.loopArea.from.setValue(0);
      project.timelineBox.loopArea.to.setValue(loopPpqn);
      project.timelineBox.loopArea.enabled.setValue(true);
    });
  }, [project, loopPpqn]);

  // ── Comp initialization (runs after the finalization barrier) ──
  const initializeComp = useCallback(() => {
    if (!project || !tapeUnitBox) return;
    const lanes = scanCompLanes(project, tapeUnitBox);
    if (lanes.length === 0) return;
    const compTrack = ensureCompTrack(project, tapeUnitBox);
    compTrackRef.current = compTrack;
    // Keep an existing comp; default a new one to the LAST take (Logic's default).
    const existing = deriveCompStateFromCompTrack(project, compTrack);
    const state: CompState =
      existing ?? { boundaries: [], assignments: [lanes.length - 1] };
    // No inline rebuild here — setting state triggers the rebuild effect
    // exactly once (an inline rebuild + the effect would double-rebuild and
    // create two undo entries). The rebuild also re-unmutes a comp that was
    // muted for a "record more takes" pass.
    setCompLanes(lanes);
    setCompState({ ...state });
    setAuditionTake(null);
    setCollapsed(false);
  }, [project, tapeUnitBox]);

  // ── Undo/redo tracking + comp-state re-derivation after undo/redo ──
  useEffect(() => {
    if (!project) return undefined;
    const updateUndoRedo = () => {
      setCanUndo(project.editing.canUndo());
      setCanRedo(project.editing.canRedo());
    };
    updateUndoRedo();
    const sub = project.editing.subscribe(() => {
      updateUndoRedo();
      if (isRebuildingRef.current) return;
      const compTrack = compTrackRef.current;
      if (!compTrack || compLanesRef.current.length === 0) return;
      const derived = deriveCompStateFromCompTrack(project, compTrack);
      if (derived) {
        skipNextRebuildRef.current = true; // graph already holds this comp
        setCompState(derived);
      }
    });
    return () => sub.terminate();
  }, [project]);

  // ── Live lane rescan while recording (recording view: new takes on top) ──
  useEffect(() => {
    if (!project || !tapeUnitBox || !isRecording) return;
    setCompLanes(scanCompLanes(project, tapeUnitBox));
  }, [project, tapeUnitBox, isRecording, takeIterations]);

  // ── Rebuild comp regions when compState changes (guarded) ──
  useEffect(() => {
    if (!project || compState === null) return;
    if (isRecording || isCountingIn || isFinalizing) return; // recording view: no rebuilds
    if (skipNextRebuildRef.current) {
      skipNextRebuildRef.current = false; // state came from the graph (undo/redo)
      return;
    }
    const compTrack = compTrackRef.current;
    if (!compTrack || compLanes.length === 0) return;
    isRebuildingRef.current = true;
    try {
      rebuildCompRegions(
        project,
        compTrack,
        compLanes.map((l) => l.source),
        compState,
        loopPpqn,
        bpm
      );
    } catch (e) {
      console.error("Comp rebuild failed: " + String(e));
      setUiError(`Comp rebuild failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      isRebuildingRef.current = false;
    }
  }, [project, compState, compLanes, loopPpqn, bpm, isRecording, isCountingIn, isFinalizing]);

  // ── Recording handlers (single-tape variant of the loop demo's flow) ──
  const handleRequestPermission = useCallback(async () => {
    setUiError(null);
    try {
      await requestPermission();
    } catch (error) {
      console.error("Microphone permission denied: " + String(error));
      setUiError(
        "Microphone access was denied — recording needs an input device. " +
          "Allow microphone access in the browser's site settings and try again."
      );
    }
  }, [requestPermission]);

  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext || armedCount === 0) return;
    setUiError(null);
    setFinalizationError(null);
    setAuditionTake(null);
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      // Existing comp must not play along while recording new takes.
      // Unmarked modify: not an undo step of its own.
      const compTrack = compTrackRef.current;
      if (compTrack) {
        const adapter = project.boxAdapters.adapterFor(compTrack, TrackBoxAdapter);
        project.editing.modify(() => {
          for (const region of adapter.regions.adapters.values()) {
            region.box.mute.setValue(true);
          }
        }, false);
      }
      project.engine.setPosition(0);
      project.startRecording(useCountIn);
    } catch (error) {
      console.error("Failed to start recording: " + String(error));
      setUiError(
        `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [project, audioContext, armedCount, useCountIn]);

  const handleStopRecording = useCallback(() => {
    if (!project) return;
    terminateDiscovery();
    project.engine.stopRecording();
    setIsFinalizing(true);
    for (const sub of finalizationSubsRef.current) sub.terminate();
    finalizationSubsRef.current = [];
    const loaders = snapshotLoaders();

    const finish = () => {
      project.engine.stop(true);
      setIsFinalizing(false);
      initializeComp();
    };

    if (loaders.size > 0) {
      let finalized = 0;
      const total = loaders.size;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        if (finalized < total) {
          timedOut = true;
          setFinalizationError(
            `Finalization timed out after ${FINALIZATION_TIMEOUT_MS / 1000}s — ` +
              "engine reset; the recording may be incomplete"
          );
          for (const sub of finalizationSubsRef.current) sub.terminate();
          finalizationSubsRef.current = [];
          finish();
        }
      }, FINALIZATION_TIMEOUT_MS);
      const countTerminal = (state: SampleLoaderState) => {
        if (state.type === "error") {
          setFinalizationError(
            `Recording finalization failed: ${state.reason || "unknown"}`
          );
        }
        finalized++;
        if (finalized === total) {
          clearTimeout(timeout);
          for (const sub of finalizationSubsRef.current) sub.terminate();
          finalizationSubsRef.current = [];
          finish();
        }
      };
      for (const loader of loaders) {
        const initialState = loader.state;
        if (initialState.type === "loaded" || initialState.type === "error") {
          countTerminal(initialState);
          continue;
        }
        finalizationSubsRef.current.push(
          loader.subscribe((state) => {
            if (timedOut) return;
            if (state.type !== "loaded" && state.type !== "error") return;
            countTerminal(state);
          })
        );
      }
    } else {
      finish();
    }
  }, [project, terminateDiscovery, snapshotLoaders, initializeComp]);

  const handlePlay = useCallback(async () => {
    if (!project || !audioContext) return;
    setUiError(null);
    setAuditionTake(null);
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      await waitForLoadingComplete(project);
      project.editing.modify(() => {
        project.timelineBox.loopArea.enabled.setValue(true);
      });
      project.engine.stop(true);
      project.engine.play();
    } catch (error) {
      console.error("Failed to start playback: " + String(error));
      setUiError(
        `Failed to start playback: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [project, audioContext]);

  const handleStop = useCallback(() => {
    if (!project) return;
    project.engine.stop(true);
  }, [project]);

  const handleClearAll = useCallback(() => {
    if (!project) return;
    setAuditionTake(null);
    project.editing.modify(() => {
      for (const region of getAllRegions(project)) {
        if (
          region.label.startsWith("Take ") ||
          region.label.startsWith("comp:") ||
          region.label === "Comp"
        ) {
          region.box.delete();
        }
      }
      const compTrack = compTrackRef.current;
      if (compTrack) compTrack.delete();
    });
    compTrackRef.current = null;
    setCompLanes([]);
    setCompState(null);
    setTakeIterations([]);
  }, [project, setTakeIterations]);

  // ── Comp interaction handlers ──
  const handleSwipe = useCallback(
    (takeIndex: number, fromPpqn: number, toPpqn: number) => {
      if (compState === null) return;
      setAuditionTake(null);
      const lane = compLanes[takeIndex];
      if (!lane) return;
      // Clamp the swipe to the take's recorded extent (spec rule).
      const extent = takeExtentPpqn(lane.source.durationSec, bpm, loopPpqn);
      const next = assignRange(
        compState,
        takeIndex,
        Math.min(fromPpqn, extent),
        Math.min(toPpqn, extent),
        loopPpqn
      );
      if (next !== compState) setCompState(next);
    },
    [compState, compLanes, bpm, loopPpqn]
  );

  const handleZoneClick = useCallback(
    (takeIndex: number, positionPpqn: number) => {
      if (compState === null) return;
      setAuditionTake(null);
      const next = assignZoneAt(compState, takeIndex, positionPpqn, loopPpqn);
      if (next !== compState) setCompState(next);
    },
    [compState, loopPpqn]
  );

  // Audition: unmarked mutes — never their own undo step.
  const handleToggleAudition = useCallback(
    (takeIndex: number) => {
      if (!project) return;
      const compTrack = compTrackRef.current;
      if (!compTrack) return;
      const next = auditionTake === takeIndex ? null : takeIndex;
      const adapter = project.boxAdapters.adapterFor(compTrack, TrackBoxAdapter);
      isRebuildingRef.current = true;
      try {
        project.editing.modify(() => {
          const auditioning = next !== null;
          for (const region of adapter.regions.adapters.values()) {
            region.box.mute.setValue(auditioning);
          }
          compLanes.forEach((l, i) => {
            l.source.regionBox.mute.setValue(!(auditioning && i === next));
          });
        }, false);
      } finally {
        isRebuildingRef.current = false;
      }
      setAuditionTake(next);
    },
    [project, auditionTake, compLanes]
  );

  const handleUndo = useCallback(() => {
    project?.editing.undo();
  }, [project]);
  const handleRedo = useCallback(() => {
    project?.editing.redo();
  }, [project]);

  const getPositionPpqn = useCallback(
    () => project?.engine.position.getValue() ?? 0,
    [project]
  );

  const interactive = hasComp && !isRecording && !isCountingIn && !isFinalizing;
  const setupLocked = isRecording || isCountingIn || isFinalizing || takeCount > 0;

  return (
    <Theme
      appearance="dark"
      accentColor="amber"
      radius="large"
      style={{ background: "var(--mc-bg)" }}
    >
      <style>{CONSOLE_STYLES}</style>
      <style>{PAGE_STYLES}</style>
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">Recording — Comping · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              QUICK SWIPE COMPING
            </h1>
            <p className="mc-intro">
              Cycle-record takes on a single tape, then swipe across the take
              lanes to build a composite. Each swipe splices real regions on a
              comp track — the engine's transparent seam crossfades handle every
              joint. Undo reverts one swipe at a time.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>
                <strong>Initialization failed:</strong> {initError}
              </Callout.Text>
            </Callout.Root>
          ) : !project ? (
            <Text align="center" color="gray">
              {status}
            </Text>
          ) : (
            <>
              {!hasPermission && (
                <Card>
                  <Flex direction="column" gap="3" align="center">
                    <Text size="2" color="gray">
                      Grant microphone access to record takes.
                    </Text>
                    <Button
                      onClick={handleRequestPermission}
                      color="amber"
                      size="2"
                      variant="soft"
                    >
                      Request Microphone Permission
                    </Button>
                  </Flex>
                </Card>
              )}

              <LoopSetupPanel
                bpm={bpm}
                onBpmChange={setBpm}
                leadInBars={0}
                onLeadInBarsChange={() => {}}
                loopLengthBars={loopLengthBars}
                onLoopLengthBarsChange={setLoopLengthBars}
                useCountIn={useCountIn}
                onUseCountInChange={setUseCountIn}
                metronomeEnabled={metronomeEnabled}
                onMetronomeEnabledChange={setMetronomeEnabled}
                disabled={setupLocked}
              />

              {/* Transport */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">
                    Transport
                  </Text>
                  <Flex gap="3" wrap="wrap" justify="center" align="center">
                    <Button
                      onClick={handleStartRecording}
                      color="red"
                      size="3"
                      variant="solid"
                      disabled={
                        isRecording || isCountingIn || isFinalizing ||
                        isPlaying || armedCount === 0
                      }
                    >
                      {takeCount > 0 ? "Record More Takes" : "Record"}
                    </Button>
                    <Button
                      onClick={handlePlay}
                      disabled={
                        isRecording || isCountingIn || isFinalizing ||
                        isPlaying || !hasComp
                      }
                      color="green"
                      size="3"
                      variant="solid"
                    >
                      Play Comp
                    </Button>
                    <Button
                      onClick={isRecording ? handleStopRecording : handleStop}
                      color="gray"
                      size="3"
                      variant="solid"
                    >
                      Stop
                    </Button>
                    <Button
                      size="2"
                      variant="soft"
                      disabled={!canUndo || !interactive}
                      onClick={handleUndo}
                    >
                      ↩ Undo
                    </Button>
                    <Button
                      size="2"
                      variant="soft"
                      disabled={!canRedo || !interactive}
                      onClick={handleRedo}
                    >
                      ↪ Redo
                    </Button>
                    <Button
                      onClick={handleClearAll}
                      color="red"
                      size="1"
                      variant="ghost"
                      disabled={isRecording || isFinalizing || takeCount === 0}
                    >
                      Clear All
                    </Button>
                  </Flex>
                  <Flex justify="center" gap="3" align="center">
                    {isCountingIn && <Badge color="amber" size="2">Count-in</Badge>}
                    {isRecording && <Badge color="red" size="2">Recording</Badge>}
                    {isFinalizing && <Badge color="amber" size="2">Finalizing…</Badge>}
                    {isPlaying && !isRecording && (
                      <Badge color="green" size="2">Playing</Badge>
                    )}
                    <Badge color="gray" size="1">
                      {takeCount} take{takeCount !== 1 ? "s" : ""}
                    </Badge>
                  </Flex>
                  {finalizationError && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{finalizationError}</Callout.Text>
                    </Callout.Root>
                  )}
                  {uiError && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{uiError}</Callout.Text>
                    </Callout.Root>
                  )}
                </Flex>
              </Card>

              {/* Lanes — visible while comping AND while recording (recording view).
                  assignments: [-1] is a no-take sentinel for the first session's
                  live view: no zone lights up, the comp lane stays empty. */}
              {(compState !== null || compLanes.length > 0) && (
                <SwipeCompLanes
                  takes={compLanes.map((l) => l.lane)}
                  compState={compState ?? { boundaries: [], assignments: [-1] }}
                  loopPpqn={loopPpqn}
                  bpm={bpm}
                  sampleRate={audioContext?.sampleRate ?? 44100}
                  interactive={interactive}
                  recordingLive={isRecording || isCountingIn}
                  collapsed={collapsed}
                  onToggleCollapsed={() => setCollapsed((c) => !c)}
                  auditionTake={auditionTake}
                  onToggleAudition={handleToggleAudition}
                  onSwipe={handleSwipe}
                  onZoneClick={handleZoneClick}
                  getPositionPpqn={getPositionPpqn}
                  showPlayhead={isPlaying || isRecording}
                />
              )}
              {compLanes.length === 0 && (isRecording || isCountingIn) && (
                <Text align="center" color="gray" size="2">
                  Recording… the first take lane appears after the first loop
                  pass. Stop to start comping.
                </Text>
              )}

              {/* Explainer */}
              <Card>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold" color="gray">
                    Why the seams are silent
                  </Text>
                  <Text size="2" color="gray">
                    Every splice on the comp track is a butt joint — no crossfade
                    is scheduled anywhere. The engine plays the outgoing take a
                    fraction past the cut at falling gain while fading the
                    incoming take in over the same ~20 ms window: a true
                    overlapping crossfade, scheduled automatically at every seam.
                    Comp decisions persist in the box graph (a label on the first
                    comp region), so undo reverts a swipe and its regions
                    atomically. For longer, musical crossfades between takes,
                    volume automation remains the right tool — see the{" "}
                    <a href="/comp-lanes-demo.html">Comp Lanes demo</a>. For
                    multi-track loop recording, see the{" "}
                    <a href="/loop-recording-demo.html">Loop Recording demo</a>.
                  </Text>
                </Flex>
              </Card>
            </>
          )}
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
```

- [ ] **Step 2: Create the HTML entry**

```bash
cp loop-recording-demo.html swipe-comping-demo.html
```

Then edit `swipe-comping-demo.html`:
- `<title>` → `Quick Swipe Comping — OpenDAW SDK Demo`
- meta description → `Logic-style quick swipe comping in the browser: loop-record takes with the OpenDAW SDK, swipe across take lanes to splice a comp with transparent seam crossfades.`
- `og:title` / `twitter:title` → same title; `og:description` / `twitter:description` → same description
- `og:url` → `https://<same domain as the other demos>/swipe-comping-demo.html` (copy the domain from the file you copied)
- `og:image` / `twitter:image` → `/og-image-swipe-comping.png` (created in Task 8)
- `<script type="module" src="...">` → `/src/demos/recording/swipe-comping-demo.tsx`
- Keep the GoatCounter script block as-is.

- [ ] **Step 3: Register the vite input**

In `vite.config.ts`, add to `rollupOptions.input` (match the existing entries' style exactly, alongside `"loop-recording-demo"`):

```typescript
"swipe-comping-demo": resolve(__dirname, "swipe-comping-demo.html"),
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit 2>&1 | grep '^src/'`
Expected: no output (fix anything the two placeholder replacements or unused imports introduced — `noUnusedLocals` will flag stragglers like `void audioOutputDevices` patterns; remove unused destructures instead of voiding where possible).

Run: `npm run build`
Expected: builds; `swipe-comping-demo.html` appears in `dist/`.

- [ ] **Step 5: Commit**

```bash
git add src/demos/recording/swipe-comping-demo.tsx swipe-comping-demo.html vite.config.ts
git commit -m "feat: Quick Swipe Comping demo page — record, swipe, splice, undo"
```

---

### Task 6: Site integration (index card, sitemap, README)

**Files:**
- Modify: `src/index.tsx` (Recording & Input category, after the Loop Recording card)
- Modify: `public/sitemap.xml`
- Modify: `README.md` (demo table row + source-tree listing)

- [ ] **Step 1: Add the index card**

In `src/index.tsx`, directly after the `loop-recording-demo.html` entry:

```typescript
{
  href: "/swipe-comping-demo.html",
  title: "Quick Swipe Comping",
  blurb:
    "Loop-record takes on a single tape, then swipe across take lanes to splice a comp — Logic-style comping with transparent engine crossfades at every seam, undo per swipe.",
},
```

- [ ] **Step 2: Add the sitemap URL**

In `public/sitemap.xml`, add a `<url>` entry for `/swipe-comping-demo.html` matching the existing entries' format (copy the loop-recording entry and change the path).

- [ ] **Step 3: Add README rows**

In `README.md`: add a demo-table row for Quick Swipe Comping (mirror neighboring rows' format, link `swipe-comping-demo.html`, one-line description reusing the blurb) and add `swipe-comping-demo.tsx` + `SwipeCompLanes.tsx` to the source-tree listing under `src/demos/recording/`.

- [ ] **Step 4: Verify and commit**

Run: `npm run build`
Expected: success.

```bash
git add src/index.tsx public/sitemap.xml README.md
git commit -m "feat: list Quick Swipe Comping on index, sitemap, README"
```

---

### Task 7: Static verification sweep

**Files:** none new — this is the pre-browser quality gate.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including the new `compLaneUtils.test.ts`. (If totals look doubled, check for stale `.claude/worktrees/**` — vitest scans them.)

- [ ] **Step 2: Zero new tsc errors**

Run: `npx tsc --noEmit 2>&1 | grep '^src/' | sort`
Expected: empty. If anything appears, fix it — `src/` is tsc-clean by project rule.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success; spot-check `dist/swipe-comping-demo.html` exists.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: static verification fixes for swipe comping demo" || echo "nothing to fix"
```

---

### Task 8: Browser verification + og-image

**Files:**
- Create: `public/og-image-swipe-comping.png` (1200x630 screenshot)
- Possibly modify: any file, to fix what verification finds.

This task requires a real microphone and real (trusted) clicks — programmatic `.click()` does NOT start the AudioContext/transport. Use the repo's established browser-verification workflow (claude-in-chrome or Playwright against the HTTPS dev server; reuse a running dev server rather than spawning new ones).

- [ ] **Step 1: Start (or reuse) the dev server**

```bash
npm run dev -- --port 5180 --host 127.0.0.1
```

Browse `https://localhost:5180/swipe-comping-demo.html`.

- [ ] **Step 2: Record takes (real clicks, real mic)**

- Grant mic permission; confirm the single tape auto-creates (Record button enabled).
- REAL-click Record; let the loop wrap ≥3 times (default 4 bars @120 = 8 s/pass); REAL-click Stop.
- Expected: "Finalizing…" badge, then the lane stack appears — comp lane on top initialized to the LAST take (full-width span in the last take's color), take lanes below with waveforms, MOST RECENT take directly under the comp lane (stack reversed vs recording order).
- Watch the console for `[RecordAudio] createTakeRegion → finalizeTake` per wrap.

- [ ] **Step 3: Verify swipe → splice → audio**

- Swipe across a middle range of a different take lane. Expected: dashed preview during drag; on release the lane lights in its color, the comp lane shows the zone in that color with a seam tick, and the take-lane stack shows seam lines.
- Click Play Comp. Verify actual audio output (not just `isPlaying`): tap the destination with an AnalyserNode (monkeypatch `AudioNode.prototype.connect` per the repo recipe in CLAUDE.md, or use the fresh-receiver worklet-restart path if the connect race is lost) and confirm RMS > 0 over ~2 s while the playhead crosses the swiped zone and both neighboring zones.
- Confirm no audible click at the seam (listen, and/or compare RMS continuity across the boundary window).

- [ ] **Step 4: Verify zone click, audition, undo/redo, collapse**

- Single-click another lane inside an existing zone → whole zone reassigns.
- Undo → comp lane reverts to the previous state (derived from the label); Redo restores. One undo step per swipe (audition toggles must NOT consume undo steps).
- 🎧 on a lane → that take audible alone during Play (comp lane shows the bypass scrim); toggling off restores the comp.
- Collapse chevron → lanes slide shut, comp lane + seam ticks remain; expand restores. Swipe attempts while collapsed do nothing.
- "Record More Takes" → count-in; the lane stack STAYS VISIBLE in recording view: comp lane dims to the neutral bypassed color with the "recording — comp bypassed" scrim, each new pass appears as a new lane ON TOP with a live-growing waveform, and swipes are inert until finalization. Existing comp zones survive; comp is silent during recording.
- First recording session: lanes appear live as passes complete (recording view with an empty comp lane), newest on top.
- "Clear All" → lanes and comp disappear, Record shows "Record" again.

- [ ] **Step 5: Mobile clip check**

Per-element overflow check at a narrow viewport (`el.scrollWidth > el.clientWidth` sweep) — the lane stack must scroll or fit, and the page body must not scroll horizontally.

- [ ] **Step 6: Fix anything found; re-run steps 2–5 until clean**

Commit fixes as they land:

```bash
git add -A && git commit -m "fix: browser verification fixes for swipe comping demo"
```

- [ ] **Step 7: og-image**

Take a 1200x630 screenshot of the page with a populated comp (colorful lanes visible), save as `public/og-image-swipe-comping.png`. Confirm the HTML meta tags from Task 5 point at it.

```bash
git add public/og-image-swipe-comping.png
git commit -m "feat: og-image for swipe comping demo"
```

---

### Task 9: PR

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/swipe-comping-demo
gh pr create --title "feat: Quick Swipe Comping demo — loop-record takes, swipe to splice a comp" --body "$(cat <<'EOF'
Logic-style Quick Swipe Comping on the OpenDAW SDK: cycle-record takes on one Tape,
swipe across take lanes to splice a comp track (butt joints, transparent ~20 ms engine
seam crossfades), zone click, per-lane audition, take-folder collapse, undo per swipe
(comp state label-encoded in the box graph).

Spec: docs/superpowers/specs/2026-08-27-swipe-comping-demo-design.md
Plan: docs/superpowers/plans/2026-08-27-swipe-comping-demo.md

The spec's follow-up (retiring the Comp Lanes demo) is a separate PR after this ships.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Y9YW4EuycsqVwZuG3hdf4m
EOF
)"
```

- [ ] **Step 2: Comprehensive PR review**

Run `/pr-review-toolkit:review-pr` (applicable aspects) per repo rule; fix Critical + Important findings, push to the branch, note fixes in a PR comment. The spec + plan files are deleted in this PR only if the work completes here; otherwise they ride until the completing PR.

---

## Self-Review Notes

- **Spec coverage:** take source/recording flow (Task 5), splice engine + seams (Task 3), swipe/zone/audition/collapse interactions (Tasks 4–5), comp-state persistence + undo (Tasks 3, 5), console styling (Tasks 4–5), testing (Tasks 1, 2, 7, 8), demo checklist (Tasks 5, 6, 8), short-take clamp rule (Tasks 2, 5). The Comp Lanes retirement is explicitly out of scope (spec: separate PR).
- **Known judgment calls encoded here:** lanes derive from a box-graph scan ordered by track index (SDK take numbers restart per session — scan order keeps labels unique across "Record More Takes"); comp-track creation and audition mutes use unmarked `modify(fn, false)` so undo steps map 1:1 to swipes; `olderTakeScope: "all"` so every finished take arrives muted; recording view (lanes rescan live, comp lane bypassed-neutral, `assignments: [-1]` no-take sentinel) with rebuilds suppressed while recording; `skipNextRebuildRef` prevents the undo/redo derivation path from re-rebuilding (which would add a redundant undo entry and clear the redo stack).
- **Type consistency check:** `CompSpan`/`compSpans`/`assignRange`/`assignZoneAt` (T1) match usage in T4/T5; `RecordedTakeSource`/`rebuildCompRegions`/`ensureCompTrack`/`deriveCompStateFromCompTrack` (T3) match T5; `SwipeTakeLane`/`SwipeCompLanesProps` (T4) match T5's construction in `scanCompLanes`. `project.sampleRate` in `scanCompLanes` — if `Project` does not expose `sampleRate`, thread `audioContext.sampleRate` in as a parameter instead (T5 owns that call).
