# Clip Looping (Region Tiling)

When a region's `duration` exceeds its `loopDuration`, the content repeats (tiles) automatically. This is how DAWs handle loop-based workflows — a short drum pattern can fill an entire song by tiling.

## Region Fields

Every audio region has four fields that control looping:

```
Timeline: |------------- duration (total visible length) --------------|
Content:  |-- loopDuration --|-- loopDuration --|-- loopDuration --|...|
           ^loopOffset=0      ^loop boundary     ^loop boundary
```

| Field | Type | Description |
|-------|------|-------------|
| `position` | PPQN | Where the region starts on the timeline |
| `duration` | PPQN | Total visible length on the timeline |
| `loopDuration` | PPQN | The content segment that repeats |
| `loopOffset` | PPQN | Shifts which loop cycle aligns with the region start |

When `duration > loopDuration`, the engine tiles the content automatically.

## waveformOffset — Shifting the Audio Read Position

**Critical distinction:** `loopOffset` controls loop cycle alignment on the timeline. It does NOT shift where in the audio file the engine reads from.

To read from a different point in the audio file, use `waveformOffset`:

| Field | Type | What it does |
|-------|------|-------------|
| `loopOffset` | PPQN | Controls which loop cycle maps to which timeline position |
| `waveformOffset` | seconds (field 7 on AudioRegionBox) | Shifts the audio buffer read position |

The TapeDeviceProcessor reads audio with:
```
sampleIndex = (elapsedSeconds + waveformOffset) * sampleRate
```

Where `elapsedSeconds` is the time elapsed since the start of the current loop cycle (always starts at 0 for each tile).

### Example: Skip 30 Seconds of Silence

```typescript
project.editing.modify(() => {
  // Region at timeline position 0
  regionBox.position.setValue(0);
  // 2-bar loop tiled across 8 bars
  regionBox.loopDuration.setValue(BAR * 2);
  regionBox.duration.setValue(BAR * 8);
  regionBox.loopOffset.setValue(0);
  // Skip to 30 seconds into the audio file
  regionBox.waveformOffset.setValue(30.0);
});
```

### Converting PPQN to Seconds for waveformOffset

```typescript
import { PPQN } from "@opendaw/lib-dsp";

const bpm = project.timelineBox.bpm.getValue();
const barToSkip = 24; // skip to bar 25 (0-indexed)
const ppqnOffset = PPQN.fromSignature(4, 4) * barToSkip;
const seconds = PPQN.pulsesToSeconds(ppqnOffset, bpm);
regionBox.waveformOffset.setValue(seconds);
```

## How the Engine Tiles (locateLoops)

The SDK's `LoopableRegion.locateLoops()` generator yields one `LoopCycle` per tile within the playback range:

```
offset = position - loopOffset
passIndex = floor((seekMin - offset) / loopDuration)
rawStart = offset + passIndex * loopDuration
```

Each cycle covers `loopDuration` PPQN on the timeline. The engine reads audio from `elapsedSeconds = tempoMap.intervalToSeconds(rawStart, resultStart)` within each cycle — this resets to 0 at each tile boundary, so every tile reads from the same point in the audio file (offset by `waveformOffset`).

### globalToLocal

The formula for converting a timeline position to a local position within the loop:

```
globalToLocal(region, ppqn) = mod(ppqn - region.position + region.loopOffset, region.loopDuration)
```

This is used by automation (`ValueRegionBoxAdapter.valueAt()`) and MIDI (`NoteSequencer`) to find the correct event within a looped region.

## Basic Setup

```typescript
import { PPQN } from "@opendaw/lib-dsp";

const BAR = PPQN.fromSignature(4, 4); // 3840 PPQN in 4/4

// After loading a track with loadTracksFromFiles, find the region
const boxes = project.boxGraph.boxes();
let regionBox = null;
for (const box of boxes) {
  if (box instanceof AudioRegionBox) {
    regionBox = box;
    break;
  }
}

// Set up a 2-bar loop tiled 4 times
project.editing.modify(() => {
  regionBox.loopDuration.setValue(BAR * 2);   // 2 bars repeat
  regionBox.duration.setValue(BAR * 8);       // 8 bars total (4 tiles)
  regionBox.loopOffset.setValue(0);
  regionBox.waveformOffset.setValue(0);       // read from start of file
});

// Set timeline loop area to match
project.editing.modify(() => {
  project.timelineBox.loopArea.from.setValue(0);
  project.timelineBox.loopArea.to.setValue(BAR * 8);
  project.timelineBox.loopArea.enabled.setValue(true);
});
```

## Presets Pattern

Define presets as data and apply them uniformly:

```typescript
type LoopPreset = {
  name: string;
  loopDuration: number;     // PPQN
  contentOffset: number;    // PPQN — converted to waveformOffset seconds
  duration: number;         // PPQN
};

function applyPreset(
  project: Project,
  regionBox: AudioRegionBox,
  preset: LoopPreset
): void {
  const bpm = project.timelineBox.bpm.getValue();
  const waveformOffsetSeconds = PPQN.pulsesToSeconds(preset.contentOffset, bpm);

  project.editing.modify(() => {
    regionBox.position.setValue(0);
    regionBox.loopOffset.setValue(0);
    regionBox.loopDuration.setValue(preset.loopDuration);
    regionBox.duration.setValue(preset.duration);
    regionBox.waveformOffset.setValue(waveformOffsetSeconds);
  });

  project.editing.modify(() => {
    project.timelineBox.loopArea.from.setValue(0);
    project.timelineBox.loopArea.to.setValue(preset.duration);
    project.timelineBox.loopArea.enabled.setValue(true);
  });

  project.engine.setPosition(0);
}
```

## Waveform Rendering for Tiled Regions

To visually show the tiled waveform, render each tile's peaks slice separately using `PeaksPainter.renderPixelStrips()`.

### Computing Frame Ranges

The peaks data covers the entire audio file. To render the loop slice:

```typescript
const numFrames = peaks.numFrames;
const fullAudioPpqn = regionBox.duration.getValue(); // original full duration before tiling

// Convert content offset (PPQN) to frame range
const contentOffsetPpqn = /* your PPQN offset into the audio */;
const loopDurationPpqn = regionBox.loopDuration.getValue();

const u0 = Math.floor((contentOffsetPpqn / fullAudioPpqn) * numFrames);
const u1 = u0 + Math.floor((loopDurationPpqn / fullAudioPpqn) * numFrames);
```

### Rendering Each Tile

```typescript
const tileCount = Math.ceil(duration / loopDuration);

for (let tile = 0; tile < tileCount; tile++) {
  const tileStartX = (tile * loopDuration / duration) * canvasWidth;
  const tileEndX = Math.min(((tile + 1) * loopDuration / duration) * canvasWidth, canvasWidth);

  // IMPORTANT: set fillStyle before calling renderPixelStrips
  // PeaksPainter uses the current ctx.fillStyle — it does NOT accept color parameters
  ctx.fillStyle = "#f59e0b";

  PeaksPainter.renderPixelStrips(ctx, peaks, 0, {
    x0: tileStartX,
    x1: tileEndX,
    y0: 0,
    y1: canvasHeight,
    u0: Math.max(0, Math.min(numFrames, u0)),
    u1: Math.max(0, Math.min(numFrames, u1)),
    v0: -1,
    v1: 1
  });
}
```

### Loop Boundary Lines

Draw dashed lines at tile boundaries for visual clarity:

```typescript
ctx.strokeStyle = "rgba(255, 180, 80, 0.6)";
ctx.setLineDash([4, 4]);
for (let tile = 1; tile < tileCount; tile++) {
  const x = (tile * loopDuration / duration) * canvasWidth;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, canvasHeight);
  ctx.stroke();
}
ctx.setLineDash([]);
```

### Peaks Loading Timing

`loadTracksFromFiles` calls `queryLoadingComplete()` before returning, but the SamplePeaks worker finishes ~120ms later. Use `sampleLoader.subscribe()` and wait for `state.type === "loaded"`:

```typescript
const sampleLoader = project.sampleManager.getOrCreate(track.uuid);
sampleLoader.subscribe((state) => {
  if (state.type === "loaded") {
    const peaksOpt = sampleLoader.peaks;
    if (!peaksOpt.isEmpty()) {
      const peaks = peaksOpt.unwrap();
      // peaks.numFrames, peaks.numChannels are now available
    }
  }
});
```

## Works for All Region Types

The looping mechanism is identical for:
- **Audio regions** (`AudioRegionBox`) — tiles audio waveform
- **MIDI regions** (`NoteRegionBox`) — tiles note events
- **Automation regions** (`ValueRegionBox`) — tiles automation events

All use `LoopableRegion.locateLoops()` and the same `globalToLocal` formula.

## Works with Both Timebases

Audio regions support both Musical and Seconds timebases via the `timeBase` field on `AudioRegionBox`.

```typescript
import { TimeBase } from "@opendaw/lib-dsp";
```

### Musical (default)

Values are stored in PPQN. Loop durations scale with BPM changes — a 2-bar loop stays 2 bars regardless of tempo.

```typescript
project.editing.modify(() => {
  regionBox.timeBase.setValue(TimeBase.Musical);
  regionBox.loopDuration.setValue(BAR * 2);     // 7680 PPQN
  regionBox.duration.setValue(BAR * 8);          // 30720 PPQN
});
```

### Seconds

Values are stored in seconds. Loop durations stay constant regardless of BPM — a 3.87s loop stays 3.87s even if tempo changes.

```typescript
const bpm = project.timelineBox.bpm.getValue();
const loopDurationSeconds = PPQN.pulsesToSeconds(BAR * 2, bpm); // ~3.87s at 124 BPM

project.editing.modify(() => {
  regionBox.timeBase.setValue(TimeBase.Seconds);
  regionBox.loopDuration.setValue(loopDurationSeconds); // seconds, not PPQN
  regionBox.duration.setValue(loopDurationSeconds * 4); // 4 tiles
});
```

### What's stored in each mode

| Field | Musical | Seconds |
|-------|---------|---------|
| `position` | PPQN | PPQN (always PPQN on timeline) |
| `duration` | PPQN | seconds |
| `loopDuration` | PPQN | seconds |
| `loopOffset` | PPQN | PPQN |
| `waveformOffset` | seconds (always) | seconds (always) |
| `timelineBox.loopArea.from/to` | PPQN (always) | PPQN (always) |
| `timelineBox.durationInPulses` | PPQN (always) | PPQN (always) |

**Key point:** The timeline loop area and `durationInPulses` are always in PPQN regardless of region timebase. Only `duration` and `loopDuration` on the region itself change storage units. The `AudioRegionBoxAdapter` uses `TimeBaseConverter` to convert to PPQN before any engine calculations, so tiling works identically in both modes.

### Switching at runtime

When switching an existing region between timebases, convert and re-store the values:

```typescript
// Switch from Musical to Seconds
const bpm = project.timelineBox.bpm.getValue();
const durationSeconds = PPQN.pulsesToSeconds(currentDurationPpqn, bpm);
const loopDurationSeconds = PPQN.pulsesToSeconds(currentLoopDurationPpqn, bpm);

project.editing.modify(() => {
  regionBox.timeBase.setValue(TimeBase.Seconds);
  regionBox.duration.setValue(durationSeconds);
  regionBox.loopDuration.setValue(loopDurationSeconds);
});
```

## Reference

- Demo: `src/clip-looping-demo.tsx`
- SDK loop math: `@opendaw/lib-dsp` → `events.ts` → `LoopableRegion.locateLoops()`
- SDK playback: `@opendaw/studio-core` → `TapeDeviceProcessor.ts`
- SDK adapter: `@opendaw/studio-adapters` → `AudioRegionBoxAdapter.ts`
- Region schema: `@opendaw/studio-boxes` → `AudioRegionBox.ts` (field 7: `waveform-offset`)
