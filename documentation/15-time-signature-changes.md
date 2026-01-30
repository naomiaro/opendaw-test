# Time Signature Changes

## Overview

OpenDAW supports time signature changes during playback. You can place signature change events at specific PPQN positions on the timeline, and the metronome and bar/beat grid automatically adapt.

## Key Concepts

- **Signature events** are managed by `SignatureTrackAdapter`
- The **storage signature** (index -1) defines the initial time signature
- Additional events at PPQN positions change the signature from that point forward
- Bar duration in PPQN depends on the signature: `PPQN.fromSignature(nominator, denominator)`

## PPQN and Time Signatures

```typescript
import { PPQN } from "@opendaw/lib-dsp";

// PPQN.fromSignature(nom, denom) = Math.floor(3840 / denom) * nom
PPQN.fromSignature(4, 4);  // 3840 — standard bar
PPQN.fromSignature(3, 4);  // 2880 — waltz
PPQN.fromSignature(7, 8);  // 3360 — prog rock
PPQN.fromSignature(5, 4);  // 4800 — quintuple meter
PPQN.fromSignature(6, 8);  // 2880 — compound duple
```

Note that 3/4 and 6/8 have the same PPQN duration (2880) but different beat subdivisions — the metronome reflects this difference.

## Accessing the Signature Track

```typescript
const signatureTrack = project.timelineBoxAdapter.signatureTrack;
```

## Setting the Initial Time Signature

The storage signature is set on the `TimelineBox`:

```typescript
project.editing.modify(() => {
  project.timelineBox.signature.nominator.setValue(6);
  project.timelineBox.signature.denominator.setValue(8);
});
```

## Creating Signature Change Events

```typescript
import type { ppqn } from "@opendaw/lib-dsp";

// Create a signature change at a specific PPQN position
project.editing.modify(() => {
  signatureTrack.createEvent(
    7680 as ppqn,  // Position: after 2 bars of 4/4 (2 × 3840)
    3,             // Nominator: 3
    4              // Denominator: 4
  );
});
```

### Critical: One Transaction Per Event

`SignatureTrackAdapter.createEvent()` calls `iterateAll()` internally to determine the insertion index. Inside a single `editing.modify()` transaction, adapter collection notifications are deferred — the collection doesn't update until the transaction commits. This means multiple `createEvent` calls in one transaction will see stale state and produce incorrect results.

```typescript
// ❌ WRONG — events will have incorrect positions/indices
project.editing.modify(() => {
  signatureTrack.createEvent(3840 as ppqn, 7, 8);
  signatureTrack.createEvent(7680 as ppqn, 5, 4);  // Sees stale state!
});

// ✅ CORRECT — separate transactions per event
project.editing.modify(() => {
  signatureTrack.createEvent(3840 as ppqn, 7, 8);
});
project.editing.modify(() => {
  signatureTrack.createEvent(7680 as ppqn, 5, 4);
});
```

## Clearing Existing Signature Events

When switching between patterns, clear existing events before creating new ones. Delete in reverse order, each in its own transaction:

```typescript
// Get all events (slice(1) skips the storage signature at index -1)
const existingEvents = Array.from(signatureTrack.iterateAll()).slice(1);

// Delete in reverse order, each in its own transaction
for (let i = existingEvents.length - 1; i >= 0; i--) {
  project.editing.modify(() => {
    signatureTrack.adapterAt(existingEvents[i].index).ifSome(a => a.box.delete());
  });
}
```

## Iterating Signature Events

```typescript
// iterateAll() yields { index, position, nominator, denominator }
for (const event of signatureTrack.iterateAll()) {
  console.log(
    `Index: ${event.index}, Position: ${event.position}, ` +
    `Signature: ${event.nominator}/${event.denominator}`
  );
}
// Index -1 is the storage signature (initial time signature)
// Index 0+ are change events
```

## Computing Bar Layout

To calculate bar positions and durations for a sequence of signature changes:

```typescript
import { PPQN } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";

type BarInfo = {
  startPpqn: ppqn;
  durationPpqn: ppqn;
  nominator: number;
  denominator: number;
  barNumber: number;
};

function computeBars(
  initialSig: [number, number],
  changes: Array<{ atBar: number; nominator: number; denominator: number }>,
  totalBars: number
): BarInfo[] {
  const bars: BarInfo[] = [];
  let [currentNom, currentDenom] = initialSig;
  let ppqnAccum: ppqn = 0 as ppqn;
  let barNumber = 1;
  let nextChangeIdx = 0;

  for (let b = 0; b < totalBars; b++) {
    // Check if a signature change happens at this bar
    if (nextChangeIdx < changes.length && barNumber === changes[nextChangeIdx].atBar) {
      currentNom = changes[nextChangeIdx].nominator;
      currentDenom = changes[nextChangeIdx].denominator;
      nextChangeIdx++;
    }

    const dur = PPQN.fromSignature(currentNom, currentDenom);
    bars.push({
      startPpqn: ppqnAccum as ppqn,
      durationPpqn: dur as ppqn,
      nominator: currentNom,
      denominator: currentDenom,
      barNumber: barNumber++,
    });
    ppqnAccum = (ppqnAccum + dur) as ppqn;
  }

  return bars;
}
```

## Timeline Visualization

Bar widths should be proportional to their PPQN duration. This means bars with more beats (e.g., 5/4) are wider than bars with fewer beats (e.g., 3/4), keeping the quarter-note pixel width consistent:

```typescript
const totalPpqn = bars.reduce((sum, b) => sum + b.durationPpqn, 0);

// Convert PPQN position to pixel X coordinate
const toX = (ppqnPos: number) => (ppqnPos / totalPpqn) * canvasWidth;

// Bar pixel width
const barPixelWidth = toX(bar.startPpqn + bar.durationPpqn) - toX(bar.startPpqn);
```

## Common Patterns

### Preset-Based Signature Sequences

```typescript
type SignatureChange = {
  barOffset: number;   // Bars of previous signature before this change
  nominator: number;
  denominator: number;
};

// Example: Prog Rock — 4/4 → 7/8 → 5/4 → 4/4, each for 2 bars
const progRock: SignatureChange[] = [
  { barOffset: 2, nominator: 7, denominator: 8 },
  { barOffset: 2, nominator: 5, denominator: 4 },
  { barOffset: 2, nominator: 4, denominator: 4 },
];
```

### Applying a Pattern

1. Clear existing signature events (reverse order, separate transactions)
2. Set the storage signature (initial time signature)
3. Create each change event at the correct PPQN position (separate transactions)
4. Set timeline duration and loop area

See `src/time-signature-demo.tsx` for a complete implementation of this pattern.

## Reference

- Demo: `src/time-signature-demo.tsx`
- SignatureTrackAdapter: `packages/studio/adapters/src/timeline/SignatureTrackAdapter.ts`
- PPQN utilities: `packages/lib/dsp/src/ppqn.ts`
- Research: `documentation/10-tempo-change-events-research.md`
