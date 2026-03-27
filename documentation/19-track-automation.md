# Track Automation

Track automation allows you to automate any parameter on an AudioUnit (volume, panning) or effect device (reverb wet, delay feedback, etc.) over time using automation lanes with interpolated events.

## Core Concepts

### Automation Tracks

An automation track is a `TrackBox` that targets a specific parameter field on an AudioUnit. The track contains `ValueRegionBox` regions, which hold `ValueEventCollectionBox` collections of automation events.

```
AudioUnitBox
└── tracks (TrackCollection)
    └── TrackBox (type: Value)
        └── target → parameter field (e.g., audioUnitBox.volume)
        └── regions
            └── ValueRegionBox
                └── ValueEventCollectionBox
                    └── ValueEventBox (position, value, interpolation)
```

### Automatable Parameters

Any `Float32Field<Pointers.Automation>` is automatable:

- **AudioUnitBox**: `volume`, `panning`
- **ReverbDeviceBox**: `decay`, `preDelay`, `damp`, `filter`, `wet`, `dry`
- **CompressorDeviceBox**: `threshold`, `ratio`, `attack`, `release`, `gain`
- **DelayDeviceBox**: all parameters
- All other effect device boxes follow the same pattern

## Creating Automation Tracks

```typescript
import { TrackBox, ValueRegionBox } from "@opendaw/studio-boxes";
import { ValueRegionBoxAdapter } from "@opendaw/studio-adapters";
import { Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";

// Step 1: Create the automation track (separate transaction from instrument creation)
let trackBox: TrackBox;
project.editing.modify(() => {
  trackBox = project.api.createAutomationTrack(audioUnitBox, audioUnitBox.volume);
});

// Step 2: Create a region and populate with events
project.editing.modify(() => {
  const regionOpt = project.api.createTrackRegion(trackBox, startPosition, duration);
  if (regionOpt.isEmpty()) return;

  const regionBox = regionOpt.unwrap() as ValueRegionBox;
  const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
  const collection = adapter.optCollection.unwrap();

  collection.createEvent({
    position: 0 as ppqn,       // region-local position
    index: 0,                  // ordering tiebreaker for events at the same position
    value: 0.0,                // unitValue 0..1
    interpolation: Interpolation.Linear,
  });

  collection.createEvent({
    position: duration as ppqn,
    index: 0,
    value: 1.0,
    interpolation: Interpolation.None,
  });
});
```

## Event Index (Ordering Tiebreaker)

The `index` field on automation events is an integer used to order events that share the same PPQN position. The SDK sorts events by `(position, index)`:

```typescript
ValueEvent.Comparator = (a, b) => {
  const positionDiff = a.position - b.position;
  if (positionDiff !== 0) return positionDiff;
  return a.index - b.index; // tiebreaker
};
```

This is useful for step changes where you need two values at the same moment (e.g., jump from 0.8 to 0.2 at bar 4 — event at index 0 with value 0.8, event at index 1 with value 0.2). For most automation, use `index: 0`.

## Critical: Event Positions Are Region-Local

**Automation event positions are relative to the region, NOT absolute timeline positions.**

`ValueRegionBoxAdapter.valueAt()` calls `LoopableRegion.globalToLocal()` before looking up events:

```
globalToLocal(region, ppqn) = mod(ppqn - region.position + region.loopOffset, region.loopDuration)
```

If a region is at position 61440 (bar 17) with `loopOffset=0` and `loopDuration=30720`:
- Engine at position 61440 → local position 0 (start of events)
- Engine at position 76800 → local position 15360 (mid-region)
- Engine at position 92160 → local position 30720 (end of events)

**Events at absolute positions (e.g., 61440) would be interpreted as 61440 PPQN into a 30720-length region — past the end, so automation never triggers.**

## Interpolation Types

Three interpolation modes are available, imported from `@opendaw/lib-dsp`:

```typescript
import { Interpolation } from "@opendaw/lib-dsp";

Interpolation.None           // Step/hold: value stays constant until next event
Interpolation.Linear         // Linear ramp between events
Interpolation.Curve(slope)   // Möbius-Ease curve (slope: 0.0–1.0)
```

### Möbius-Ease Curve (Curve.normalizedAt)

The curve interpolation uses an exponential formula from `@opendaw/lib-std`:

```typescript
import { Curve } from "@opendaw/lib-std";

// Curve.normalizedAt(x, slope) where x is 0..1 normalized position
// slope < 0.5 → logarithmic (steep start, flat end)
// slope = 0.5 → linear (equivalent to Interpolation.Linear)
// slope > 0.5 → exponential (flat start, steep end)
```

The actual formula:
```
normalizedAt(x, slope) = (p²) / (1 - 2p) × (((1-p)/p)^(2x) - 1)
```
where `p = clamp(slope, ε, 1-ε)`.

Reference: http://werner.yellowcouch.org/Papers/fastenv12/index.html

**This is NOT a quadratic bezier.** When rendering curves on a canvas, import and use `Curve.normalizedAt` directly to match the engine's computation:

```typescript
import { Curve } from "@opendaw/lib-std";

// Sample the curve for canvas rendering
const segments = 40;
for (let s = 1; s <= segments; s++) {
  const t = s / segments;
  const normalized = Curve.normalizedAt(t, slope);
  const value = startValue + normalized * (endValue - startValue);
  ctx.lineTo(x, toY(value));
}
```

### Common Curve Shapes

| Slope | Shape | Use Case |
|-------|-------|----------|
| 0.25 | Logarithmic (steep start, flat end) | Fade out, natural decay |
| 0.50 | Linear (becomes `Interpolation.Linear`) | Even ramps |
| 0.75 | Exponential (flat start, steep end) | Fade in, swell rise |

For a **round swell** (smooth hill shape):
- Rise: `Curve(0.75)` — slow start, accelerates to peak
- Fall: `Curve(0.25)` — fast departure from peak, decelerates

## Clearing and Replacing Automation Events

To switch presets or clear automation, delete existing regions and create new ones:

```typescript
import { ValueRegionBox } from "@opendaw/studio-boxes";
import { ValueRegionBoxAdapter } from "@opendaw/studio-adapters";

function clearAutomation(project: Project, trackBox: TrackBox): void {
  const boxes = project.boxGraph.boxes();
  const existingRegions = boxes.filter(
    (box: any) =>
      box instanceof ValueRegionBox &&
      box.regions.targetVertex.nonEmpty() &&
      box.regions.targetVertex.unwrap().box === trackBox
  );

  project.editing.modify(() => {
    for (const region of existingRegions) {
      const adapter = project.boxAdapters.adapterFor(region, ValueRegionBoxAdapter);
      const collectionOpt = adapter.optCollection;
      if (collectionOpt.nonEmpty()) {
        collectionOpt.unwrap().events.asArray().forEach((evt: any) => evt.box.delete());
      }
      region.delete();
    }
  });
}
```

## Effect Parameter Automation

To automate an effect parameter, first insert the effect, then create an automation track targeting the parameter:

```typescript
import { EffectFactories } from "@opendaw/studio-core";
import { ReverbDeviceBox } from "@opendaw/studio-boxes";

// Insert effect (EffectBox is a union type — cast directly to device box)
let reverbBox: ReverbDeviceBox;
project.editing.modify(() => {
  const effectBox = project.api.insertEffect(
    audioUnitBox.audioEffects,
    EffectFactories.Reverb
  );
  reverbBox = effectBox as ReverbDeviceBox;
});

// Create automation track for the wet parameter (separate transaction)
let wetTrackBox: TrackBox;
project.editing.modify(() => {
  wetTrackBox = project.api.createAutomationTrack(audioUnitBox, reverbBox.wet);
});
```

**Note:** `EffectBox` is a union type (`ReverbDeviceBox | CompressorDeviceBox | ...`), not a wrapper. `insertEffect()` returns the device box directly.

## Server Persistence (JSON Data Model)

When saving automation state to a server, capture these fields per automation track:

```json
{
  "automationTrack": {
    "targetParameter": "volume",
    "targetUnitId": "uuid-string",
    "enabled": true,
    "events": [
      {
        "position": 0,
        "value": 0.0,
        "index": 0,
        "interpolation": { "type": "curve", "slope": 0.75 }
      },
      {
        "position": 15360,
        "value": 1.0,
        "index": 0,
        "interpolation": { "type": "none" }
      }
    ]
  }
}
```

Event fields:
- **position** (int32): Region-local position in PPQN
- **value** (float32): Parameter value as unitValue (0.0–1.0)
- **index** (int32): Ordering tiebreaker for events at the same position (usually 0)
- **interpolation**: How to transition from this event to the next

Interpolation types in JSON:
- `{ "type": "none" }` — step/hold
- `{ "type": "linear" }` — linear ramp
- `{ "type": "curve", "slope": 0.25 }` — Möbius-Ease with slope

The SDK's native persistence uses binary serialization (`project.toArrayBuffer()` → `.odaw` format), but the JSON above represents the same data for server-side storage.

## Differences from Tempo Automation

Tempo automation uses a special accessor on the timeline:

```typescript
// Tempo: special timeline accessor, events use absolute positions
project.timelineBoxAdapter.tempoTrackEvents.ifSome(collection => {
  collection.createEvent({ position, index: 0, value: bpm, interpolation });
});

// Track automation: create track + region, events use region-local positions
const trackBox = project.api.createAutomationTrack(audioUnitBox, field);
const regionOpt = project.api.createTrackRegion(trackBox, position, duration);
// ... events at local positions within the region
```

Key differences:
- Tempo events are **absolute** timeline positions; track automation events are **region-local**
- Tempo uses `tempoTrackEvents` accessor; track automation uses `createAutomationTrack` + `createTrackRegion`
- Tempo values are BPM; track automation values are unitValue (0..1)

## Reference

- Demo: `src/track-automation-demo.tsx`
- SDK curve algorithm: `@opendaw/lib-std` → `Curve.normalizedAt`
- SDK interpolation: `@opendaw/lib-dsp` → `value.ts` → `interpolate()`
- SDK region mapping: `@opendaw/lib-dsp` → `events.ts` → `LoopableRegion.globalToLocal`
- SDK adapter: `@opendaw/studio-adapters` → `ValueRegionBoxAdapter`, `ValueEventCollectionBoxAdapter`
- Effect parameter docs: `documentation/effects-research/01-effect-types.md`
