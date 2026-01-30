# Tempo Automation

## Overview

OpenDAW supports tempo automation — changing BPM over time during playback. You can create stepped tempo changes (instant jumps) or linear ramps between tempo values.

## Key Concepts

- **Tempo events** are stored in a `ValueEventCollectionBox` on the timeline
- Each event has a **position** (in PPQN), a **value** (BPM), and an **interpolation** mode
- The engine's `VaryingTempoMap` reads these events and provides position-dependent tempo
- The metronome and all time-based processing automatically follow tempo changes

## Accessing the Tempo Track

```typescript
const adapter = project.timelineBoxAdapter;

// tempoTrackEvents is an Option — use ifSome() to access it
adapter.tempoTrackEvents.ifSome(collection => {
  // collection is a ValueEventCollectionBoxAdapter
});
```

The tempo track is bootstrapped automatically by `ProjectSkeleton` during `Project.new()`.

## Creating Tempo Events

```typescript
import { Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";

project.editing.modify(() => {
  adapter.tempoTrackEvents.ifSome(collection => {
    // Clear existing events
    collection.events.asArray().forEach(event => event.box.delete());

    // Create new events
    collection.createEvent({
      position: 0 as ppqn,        // Start position in PPQN
      index: 0,                    // Event index
      value: 120,                  // BPM
      interpolation: Interpolation.Linear,
    });

    collection.createEvent({
      position: 30720 as ppqn,     // 8 bars of 4/4 (8 × 3840)
      index: 0,
      value: 160,
      interpolation: Interpolation.Linear,
    });
  });
});
```

## Interpolation Modes

| Mode | Import | Effect |
|------|--------|--------|
| `Interpolation.None` | `@opendaw/lib-dsp` | Stepped — instant jump to new BPM |
| `Interpolation.Linear` | `@opendaw/lib-dsp` | Linear ramp between tempo values |

### Stepped Example (Discrete BPM Jumps)

```typescript
// 120 BPM for bars 1-2, then 140 BPM for bars 3-4
collection.createEvent({
  position: 0 as ppqn,
  index: 0,
  value: 120,
  interpolation: Interpolation.None,  // Step: holds 120 until next event
});

collection.createEvent({
  position: (2 * 3840) as ppqn,       // Bar 3 start
  index: 0,
  value: 140,
  interpolation: Interpolation.None,
});
```

### Linear Ramp Example (Accelerando)

```typescript
// Gradual speed up from 100 to 160 BPM over 8 bars
collection.createEvent({
  position: 0 as ppqn,
  index: 0,
  value: 100,
  interpolation: Interpolation.Linear,
});

collection.createEvent({
  position: (8 * 3840) as ppqn,
  index: 0,
  value: 160,
  interpolation: Interpolation.Linear,
});
```

## Setting Up the Timeline

After creating tempo events, configure the timeline duration and loop area:

```typescript
import { PPQN } from "@opendaw/lib-dsp";

const BAR = PPQN.fromSignature(4, 4); // 3840 PPQN per bar in 4/4
const TOTAL_PPQN = BAR * 8;           // 8 bars

project.editing.modify(() => {
  project.timelineBox.durationInPulses.setValue(TOTAL_PPQN);
  project.timelineBox.loopArea.from.setValue(0);
  project.timelineBox.loopArea.to.setValue(TOTAL_PPQN);
  project.timelineBox.loopArea.enabled.setValue(true);
});
```

## Common Patterns

### Preset-Based Tempo Patterns

Define patterns as data and apply them programmatically:

```typescript
type TempoPoint = {
  position: ppqn;
  bpm: number;
  interpolation: "step" | "linear";
};

type TempoPattern = {
  name: string;
  description: string;
  points: TempoPoint[];
};

function applyPattern(project: Project, pattern: TempoPattern): void {
  project.editing.modify(() => {
    const adapter = project.timelineBoxAdapter;

    adapter.tempoTrackEvents.ifSome(collection => {
      // Clear existing
      collection.events.asArray().forEach(event => event.box.delete());

      // Create new
      for (const point of pattern.points) {
        collection.createEvent({
          position: point.position,
          index: 0,
          value: point.bpm,
          interpolation: point.interpolation === "linear"
            ? Interpolation.Linear
            : Interpolation.None,
        });
      }
    });

    // Set timeline duration and loop
    project.timelineBox.durationInPulses.setValue(TOTAL_PPQN);
    project.timelineBox.loopArea.from.setValue(0);
    project.timelineBox.loopArea.to.setValue(TOTAL_PPQN);
    project.timelineBox.loopArea.enabled.setValue(true);
  });
}
```

### Monitoring Playhead Position

Use `AnimationFrame` to track the playhead during playback:

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

const terminable = AnimationFrame.add(() => {
  const position = project.engine.position.getValue();
  // Use position (in PPQN) to update UI
});

// Cleanup
terminable.terminate();
```

## Reference

- Demo: `src/tempo-automation-demo.tsx`
- VaryingTempoMap: `packages/studio/adapters/src/VaryingTempoMap.ts`
- ValueEventCollectionBoxAdapter: `packages/studio/adapters/src/timeline/collection/ValueEventCollectionBoxAdapter.ts`
- Research: `documentation/10-tempo-change-events-research.md`
