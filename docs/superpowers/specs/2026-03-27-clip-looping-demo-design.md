# Clip Looping Demo — Design Spec

## Overview

A focused, single-track demo showing how OpenDAW's region looping works: when a region's `duration` exceeds its `loopDuration`, the content tiles (repeats) automatically. Uses the Dark Ride Drums stem at 124 BPM.

## Core Concept

Every region has four fields that control looping:

```
Timeline: |------- duration (total visible length) --------|
Content:  |-- loopDuration --|-- loopDuration --|-- loopD..|
           ^loopOffset        ^loop boundary     ^loop boundary
```

- `position` — where the region starts on the timeline
- `duration` — total length on the timeline (extends to tile)
- `loopDuration` — the content segment that repeats
- `loopOffset` — where in the source audio the loop content starts

When `duration > loopDuration`, the engine calls `LoopableRegion.locateLoops()` to yield each repetition during playback. The renderer draws vertical separator lines at each loop boundary.

## File Structure

| File | Purpose |
|------|---------|
| `clip-looping-demo.html` | HTML entry point with meta tags |
| `src/clip-looping-demo.tsx` | Main demo component |
| `vite.config.ts` | Add build entry |
| `src/index.tsx` | Add card to homepage |

## Tech Stack

- React + Radix UI Theme (dark, accent color)
- OpenDAW SDK: `loadTracksFromFiles`, `AudioRegionBoxAdapter`, `PeaksPainter`
- Shared components: `GitHubCorner`, `BackLink`, `MoisesLogo`, `TransportControls`
- Shared hooks: `usePlaybackPosition`, `useTransportControls`

## Audio Source

- **Drums stem**: `public/audio/DarkRide/02_Drums.{opus,m4a}` at 124 BPM
- Loaded via `loadTracksFromFiles` with `localAudioBuffers` map
- Full stem is ~235 seconds (~117 bars at 124 BPM)

## Initialization Flow

1. `initializeOpenDAW({ localAudioBuffers, bpm: 124 })`
2. `loadTracksFromFiles(project, audioContext, [{ name: "Drums", file }], localAudioBuffers)`
3. Get the `AudioRegionBox` from the loaded track
4. Apply the default preset (2-Bar Loop) by modifying `loopDuration` and `duration`
5. Set timeline loop area to match `duration` with looping enabled

## Presets

| Preset | loopDuration | loopOffset | duration | Description |
|--------|-------------|------------|----------|-------------|
| 2-Bar Loop | 2 bars (7680) | 0 | 8 bars (30720) | Classic 2-bar drum loop tiled 4x |
| 1-Bar Loop | 1 bar (3840) | 0 | 8 bars (30720) | Tight 1-bar pattern tiled 8x |
| Half-Bar Loop | 2 beats (1920) | 0 | 4 bars (15360) | Rapid half-bar repeat |
| Offset Start | 2 bars (7680) | 2 bars (7680) | 8 bars (30720) | Loop from bar 3 of the audio |
| Long Loop | 4 bars (15360) | 0 | 16 bars (61440) | 4-bar phrase tiled 4x |
| Full (No Loop) | full audio length | 0 | full audio length | Reset — plays the full stem once |

PPQN reference at 4/4: 1 bar = 3840 PPQN (`PPQN.fromSignature(4, 4)`).

## Interactive Controls

### Sliders

| Control | Range | Step | Default | Display Format |
|---------|-------|------|---------|----------------|
| Loop Duration | 1 beat (960) to 8 bars (30720) | 960 (1 beat) | 2 bars (7680) | "X bars Y beats" |
| Loop Offset | 0 to full audio PPQN | 960 (1 beat) | 0 | "X bars Y beats" |
| Region Duration | 1 bar (3840) to 16 bars (61440) | 3840 (1 bar) | 8 bars (30720) | "X bars" |

### Applying Changes

All three sliders modify the region in a single `editing.modify()` transaction:
```typescript
project.editing.modify(() => {
  regionBox.loopDuration.setValue(loopDuration);
  regionBox.loopOffset.setValue(loopOffset);
  regionBox.duration.setValue(duration);
});
```

Also update the timeline loop area to match the new duration so transport loops cleanly.

## Waveform Canvas

### Rendering

A custom canvas component renders the looped waveform:

1. **Compute tiles**: For each repetition within `duration`, calculate:
   - `tileStart = i * loopDuration` (region-local position)
   - Source audio frame range: `u0 = (loopOffset / totalAudioPPQN) * numFrames`, `u1 = u0 + (loopDuration / totalAudioPPQN) * numFrames`
2. **Render each tile** using `PeaksPainter.renderPixelStrips()` into the appropriate pixel range on the canvas
3. **Loop boundary lines**: Vertical dashed lines at each tile boundary
4. **First tile highlight**: Slightly different background color for the first tile vs repeated tiles
5. **Playhead**: White vertical line during playback, positioned via `usePlaybackPosition`

### Canvas Layout

```
[Bar 1   |Bar 2   ‖Bar 3   |Bar 4   ‖Bar 5   |Bar 6   ‖Bar 7   |Bar 8   ]
[████████|████████‖████████|████████‖████████|████████‖████████|████████]
 ^tile 1          ^tile 2          ^tile 3          ^tile 4
                  ‖ = loop boundary (dashed line)
```

Bar grid lines are thin gray. Loop boundaries are brighter dashed lines. Waveform color matches other demos.

### Sizing

- Height: 120px
- Width: 100% of container
- DPR-aware (canvas.width = clientWidth * devicePixelRatio)

## Info Panel

A card below the canvas showing:
- **Loop Duration**: X bars Y beats (PPQN value)
- **Loop Offset**: X bars Y beats (PPQN value)
- **Region Duration**: X bars (PPQN value)
- **Tiles**: N repetitions (computed as `Math.ceil(duration / loopDuration)`)
- **Source audio**: total duration in bars

## Transport

- Play / Stop buttons via `useTransportControls`
- Metronome toggle (enabled by default, gain -6 dB)
- Position display showing current bar/beat

## Layout

Follows existing demo pattern (see `src/looping-demo.tsx` for reference):
```
GitHubCorner
BackLink
Heading + description
Callout (educational explanation)
Card: Preset buttons
Card: Waveform canvas with playhead
Card: Sliders (loopDuration, loopOffset, duration) + info panel
Card: Transport controls + metronome toggle
Card: API Reference (code snippet showing the four fields)
MoisesLogo
```

## API Reference Code Block

```typescript
// Region looping: when duration > loopDuration, content tiles automatically
project.editing.modify(() => {
  // Set what content repeats (e.g., 2 bars of drums)
  regionBox.loopDuration.setValue(PPQN.fromSignature(4, 4) * 2); // 7680 PPQN

  // Set where in the source audio the loop starts
  regionBox.loopOffset.setValue(0);

  // Set total region length (e.g., 8 bars = 4 repetitions)
  regionBox.duration.setValue(PPQN.fromSignature(4, 4) * 8); // 30720 PPQN
});

// The engine uses LoopableRegion.locateLoops() to yield each tile during playback
// The renderer draws vertical separators at each loop boundary
```

## Out of Scope

- Drag handles on the canvas (future enhancement)
- Multi-track looping
- Seconds timebase (stays in musical time — the feature supports both but musical is more intuitive for drum loops)
- MIDI or automation region looping (same mechanic but audio-focused for this demo)
- Recording new loops
