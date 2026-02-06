# Clip Fades in OpenDAW

## Overview

OpenDAW supports per-region fade-in and fade-out via the `fading` object on `AudioRegionBox`. Fades are applied as gain envelopes during audio processing — they are non-destructive and do not modify the underlying audio data.

**Note:** This supersedes the "Fade Functionality Status" section in `09-track-editing-and-fades.md`, which incorrectly states fades are not implemented.

## AudioRegionBox Fading Schema

Each `AudioRegionBox` has a `fading` object with four fields:

| Field | Type | Default | Unit | Description |
|-------|------|---------|------|-------------|
| `fading.in` | float32 | 0.0 | PPQN | Fade-in duration |
| `fading.out` | float32 | 0.0 | PPQN | Fade-out duration |
| `fading.inSlope` | float32 | 0.75 | ratio (0-1) | Fade-in curve shape |
| `fading.outSlope` | float32 | 0.25 | ratio (0-1) | Fade-out curve shape |

Source: `AudioRegionBox.ts` field 18 in `packages/studio/forge-boxes/src/schema/std/timeline/`

## Setting Fades

```typescript
import { AudioRegionBoxAdapter } from "@opendaw/studio-adapters";

project.editing.modify(() => {
  // Fade durations in PPQN (960 = 1 quarter note at any BPM)
  adapter.fading.inField.setValue(1920);       // 2 beats fade-in
  adapter.fading.outField.setValue(1920);      // 2 beats fade-out

  // Slope controls curve shape
  adapter.fading.inSlopeField.setValue(0.75);  // Exponential
  adapter.fading.outSlopeField.setValue(0.25); // Logarithmic
});
```

Fades can be set in the same `editing.modify()` transaction as region property changes (position, duration, loopOffset). No separate transaction is needed.

## Slope Values and Curve Types

The slope parameter (0.0 to 1.0) controls the shape of the fade curve using an exponential formula:

| Slope | Curve Type | Character | Best For |
|-------|-----------|-----------|----------|
| 0.25 | Logarithmic | Slow start, fast end | Fade-outs (SDK default for `outSlope`) |
| 0.50 | Linear | Even progression | Neutral, technical fades |
| 0.75 | Exponential | Fast start, slow end | Fade-ins (SDK default for `inSlope`) |

### Curve Formula

The curve is computed by `Curve.normalizedAt()`:

```typescript
function normalizedAt(x: number, slope: number): number {
  if (slope ≈ 0.5) return x; // Linear shortcut
  const p = clamp(slope, EPSILON, 1 - EPSILON);
  return (p² / (1 - 2p)) * (((1 - p) / p)^(2x) - 1);
}
```

This produces monotonic curves only. S-curves are not possible with a single slope parameter.

## How Fades Work Internally

### Processing Pipeline

1. **FadingAdapter** (`packages/studio/adapters/src/timeline/region/FadingAdapter.ts`)
   - Wraps the `fading` box fields and implements `FadingEnvelope.Config`
   - Provides `inField`, `outField`, `inSlopeField`, `outSlopeField` accessors

2. **FadingEnvelope.fillGainBuffer** (`packages/lib/dsp/src/fading.ts`)
   - Called by `TapeDeviceProcessor` during audio rendering
   - Fills a gain buffer that is multiplied with the audio output
   - Computes position relative to region start: `startPpqn = cycle.resultStart - regionPosition`

3. **TapeDeviceProcessor** (`packages/studio/core-processors/src/devices/instruments/TapeDeviceProcessor.ts`)
   - Checks `hasFading` flag on the region
   - Calls `fillGainBuffer()` to get per-sample gain values
   - Multiplies audio output by the gain buffer

### The Gain Buffer Algorithm

```
fillGainBuffer(buffer, startPpqn, endPpqn, fadeIn, fadeOut, inSlope, outSlope, regionDuration):
  1. Fill entire buffer with 1.0 (full volume)
  2. If startPpqn >= fadeIn AND endPpqn <= (regionDuration - fadeOut):
     → Early return (entirely between fades, no processing needed)
  3. For fade-in zone (startPpqn < fadeIn):
     → Apply curve: gain = normalizedAt(position / fadeIn, inSlope)
  4. For fade-out zone (endPpqn > regionDuration - fadeOut):
     → Apply curve: gain = 1 - normalizedAt(position / fadeOut, outSlope)
```

## Critical: Fades Are Relative to Region Position

Fades are calculated relative to the **region's position**, not the timeline. This has important implications:

```
startPpqn = cycle.resultStart - regionPosition
```

If a region spans the full audio file (e.g., position=0, duration=450000 PPQN for a 4-minute file) but playback starts at bar 18 (PPQN 65280), then:

- `startPpqn = 65280 - 0 = 65280`
- With a 2-beat fade-in (`fadeIn = 1920`): `65280 >= 1920` triggers the early-return
- **Result: gain stays at 1.0, fades are never audible**

### Solution: Trim Regions to Short Clips

To make fades audible on a specific section of audio, trim the region:

```typescript
const clipStartPPQN = PPQN.Bar * 17;  // Bar 18 (0-indexed)
const clipDurationPPQN = PPQN.Bar * 4; // 4 bars

project.editing.modify(() => {
  adapter.box.position.setValue(clipStartPPQN);      // Timeline position
  adapter.box.duration.setValue(clipDurationPPQN);    // Clip length
  adapter.box.loopOffset.setValue(clipStartPPQN);     // Read audio from bar 18
  // loopDuration can stay at full audio length — duration limits playback

  // Now fades work: startPpqn = 65280 - 65280 = 0, which IS in the fade zone
  adapter.fading.inField.setValue(1920);   // 2 beats
  adapter.fading.outField.setValue(1920);  // 2 beats
  adapter.fading.inSlopeField.setValue(0.5);
  adapter.fading.outSlopeField.setValue(0.5);
});
```

## Region Sorting When Positions Match

When multiple regions share the same timeline position (e.g., same clip trimmed for different fade types), sorting by position is non-deterministic. Use labels for stable ordering:

```typescript
// Set labels during creation
adapter.box.label.setValue("Logarithmic");

// Sort by label
const fadeTypeIndex = (label: string) =>
  FADE_TYPES.findIndex(ft => label.startsWith(ft.name));

regionAdapters.sort((a, b) =>
  fadeTypeIndex(a.box.label.getValue()) - fadeTypeIndex(b.box.label.getValue())
);
```

## Safari/iOS Audio Compatibility

Safari cannot decode Ogg Opus files via `decodeAudioData`, even though `canPlayType` returns `"maybe"`. Provide m4a (AAC) fallback files and detect the browser via user agent:

```typescript
// src/lib/audioUtils.ts
export function getAudioExtension(): string {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    || /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isSafari ? "m4a" : "opus";
}
```

iOS Safari also re-suspends AudioContext after backgrounding. Before calling `play()`:

```typescript
if (audioContext.state !== "running") {
  await audioContext.resume();
  // Wait for statechange event — iOS may not be "running" yet
  await new Promise<void>(resolve => {
    if (audioContext.state === ("running" as AudioContextState)) {
      resolve();
      return;
    }
    audioContext.addEventListener("statechange", function handler() {
      if (audioContext.state === ("running" as AudioContextState)) {
        audioContext.removeEventListener("statechange", handler);
        resolve();
      }
    });
  });
}
```

## Demo

See `src/clip-fades-demo.tsx` for a complete working example that:

- Loads three copies of the same audio file
- Trims them to 4-bar clips at bar 18
- Applies different fade curves (logarithmic, linear, exponential) to each
- Lets users play individual tracks to compare fade characteristics
- Visualizes the fade curves on canvas elements

## References

- [PPQN Fundamentals](./02-ppqn-fundamentals.md)
- [Track Editing and Region Properties](./09-track-editing-and-fades.md)
- [Box System](./04-box-system.md)
