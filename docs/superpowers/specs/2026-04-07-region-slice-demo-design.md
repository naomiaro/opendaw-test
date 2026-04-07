# Region Slice Demo — Design Spec

## Goal

Prove that the OpenDAW SDK's region splitting + micro-fades produce seamless, click-free audio at splice points. A single-track demo where the user clicks on a waveform to cut a region, with 128-sample fades automatically applied at each cut boundary.

## Audio Source

Dark Ride vocals (`06_Vox.opus` / `06_Vox.m4a`) at 124 BPM.

## Approach

**Pure SDK Regions (Approach A):** Each slice creates real `AudioRegionBox` regions via `RegionEditing.cut()`. Fades use the SDK's `FadingAdapter` API. Playback goes through the real engine — no Web Audio workarounds.

## Interaction Model

1. **Load**: Vocals load as a single region on one track. Full waveform renders.
2. **Slice**: User clicks on the waveform to cut at that position. Only works when stopped/paused.
3. **Visual feedback**: Thin vertical markers at splice points. Region badges below the waveform show each slice's time range.
4. **Fades**: Applied automatically — 128 samples (~6 PPQN at 124 BPM/44.1kHz), linear slope (0.5). Not user-configurable.
5. **Playback**: Standard transport (play/pause/stop). User plays through splice points to hear they're seamless.
6. **No undo**: Refresh to start over.

## UI Layout

1. **Header** — title, subtitle, BackLink
2. **Instructions card** — brief how-to (click waveform to slice, play to verify)
3. **Transport card** — play/pause/stop, position display
4. **Waveform area** — single track with:
   - Timeline ruler
   - Clickable waveform (click = slice, disabled during playback)
   - Playhead overlay
   - Thin vertical markers at splice boundaries
5. **Region info** — badges below waveform showing each slice's time range
6. **Footer** — MoisesLogo

## Technical Design

### Slicing

```typescript
// Inside click handler (only when not playing):
const cutPosition = clickXToPPQN(e.clientX);

project.editing.modify(() => {
  // Find region containing the click position
  const pointers = trackBox.regions.pointerHub.incoming();
  pointers.forEach(({ box }) => {
    const regionBox = box as AudioRegionBox;
    const adapter = project.boxAdapters.adapterFor(regionBox, AudioRegionBoxAdapter);
    const start = adapter.position;
    const end = start + adapter.duration;
    if (cutPosition > start && cutPosition < end) {
      RegionEditing.cut(adapter, cutPosition, true);
    }
  });
});
```

### Fade Application

After each cut, re-apply fades to all regions in a **separate transaction** (the new region created by `cut()` needs to be committed before we can get its adapter):

```typescript
const FADE_SAMPLES = 128;
const fadePPQN = PPQN.secondsToPulses(FADE_SAMPLES / sampleRate, BPM);
const FADE_SLOPE = 0.5; // linear

// Separate transaction from the cut
project.editing.modify(() => {
  const regions = getAllRegionsSortedByPosition(trackBox);
  regions.forEach((adapter, index) => {
    // Fade-in on all except the first region
    adapter.fading.inField.setValue(index === 0 ? 0 : fadePPQN);
    adapter.fading.inSlopeField.setValue(FADE_SLOPE);
    // Fade-out on all except the last region
    adapter.fading.outField.setValue(index === regions.length - 1 ? 0 : fadePPQN);
    adapter.fading.outSlopeField.setValue(FADE_SLOPE);
  });
});
```

This "re-apply all" approach avoids needing to identify which regions are new after a cut. Using a separate transaction ensures the new region from `cut()` is fully committed and accessible via `pointerHub`.

### Waveform Click-to-PPQN Conversion

```typescript
const clickXToPPQN = (clientX: number) => {
  const rect = canvas.getBoundingClientRect();
  const fraction = (clientX - rect.left) / rect.width;
  const seconds = fraction * maxDuration;
  return PPQN.secondsToPulses(seconds, BPM);
};
```

### Splice Point Markers

Render thin vertical lines at each region boundary (except the very first and last) overlaid on the waveform canvas. These show where cuts were made.

## Files

| File | Action |
|------|--------|
| `region-slice-demo.html` | Create — HTML entry point |
| `src/demos/playback/region-slice-demo.tsx` | Create — demo component |
| `vite.config.ts` | Edit — add build entry |
| `src/index.tsx` | Edit — add card to index |

## Reused Components and Utilities

- `initializeOpenDAW` from `src/lib/projectSetup.ts`
- `loadTracksFromFiles` from `src/lib/trackLoading.ts`
- `getAudioExtension` from `src/lib/audioUtils.ts`
- `usePlaybackPosition`, `useTransportControls` hooks
- `useWaveformRendering` hook
- `TransportControls`, `TimelineRuler`, `TracksContainer`, `BackLink`, `GitHubCorner`, `MoisesLogo` components
- `TrackRow` component (or a simplified version for single-track use)

## What This Demo Does NOT Include

- No recording — audio is pre-loaded
- No undo/redo — refresh to reset
- No drag-to-move regions
- No user-configurable fade parameters
- No multi-track — single vocal track only
- No comping / take lane selection
