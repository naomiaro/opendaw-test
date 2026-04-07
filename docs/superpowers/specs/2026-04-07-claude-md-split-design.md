# Design: Split CLAUDE.md via Demo Folder Reorganization

**Date:** 2026-04-07
**Status:** Approved

## Problem

The root `CLAUDE.md` is 870 lines covering all SDK knowledge for 17 demos. This means every conversation loads all context regardless of which demo is being worked on.

## Solution

Reorganize demo TSX files into categorical folders under `src/demos/`, each with a scoped `CLAUDE.md` containing only the SDK knowledge relevant to that demo group. The root `CLAUDE.md` shrinks to ~300 lines of universal patterns.

## Decisions

- **HTML entry points stay at project root** — preserves deployed URLs (`opendaw-test.pages.dev/<demo>.html`)
- **Only TSX files move** — `src/lib/`, `src/hooks/`, `src/components/` stay in place
- **Imports use `@/` alias** — already configured in `vite.config.ts` to resolve to `./src`

## Folder Structure

```
src/demos/
  recording/          CLAUDE.md + 2 demos
    recording-api-react-demo.tsx
    loop-recording-demo.tsx
  midi/               CLAUDE.md + 1 demo
    midi-recording-demo.tsx
  playback/           CLAUDE.md + 7 demos
    looping-demo.tsx
    clip-looping-demo.tsx
    clip-fades-demo.tsx
    track-editing-demo.tsx
    timebase-demo.tsx
    mixer-groups-demo.tsx
    drum-scheduling-demo.tsx
  automation/         CLAUDE.md + 3 demos
    track-automation-demo.tsx
    tempo-automation-demo.tsx
    time-signature-demo.tsx
  effects/            CLAUDE.md + 2 demos
    effects-demo.tsx
    werkstatt-demo.tsx
  export/             CLAUDE.md + 1 demo
    export-demo.tsx
```

## Files That Change

### HTML entry points (17 files)

Each HTML file's `<script>` src updates to the new TSX path:

```html
<!-- Before -->
<script type="module" src="/src/recording-api-react-demo.tsx"></script>
<!-- After -->
<script type="module" src="/src/demos/recording/recording-api-react-demo.tsx"></script>
```

### TSX demo files (16 files moved)

Relative imports to `components/`, `hooks/`, `lib/` change to use `@/` alias:

```typescript
// Before (from src/)
import { GitHubCorner } from "./components/GitHubCorner";
import { initializeOpenDAW } from "./lib/projectSetup";

// After (from src/demos/recording/)
import { GitHubCorner } from "@/components/GitHubCorner";
import { initializeOpenDAW } from "@/lib/projectSetup";
```

### vite.config.ts

No changes — rollup input points to HTML files which haven't moved.

### tsconfig.json

No changes.

## CLAUDE.md Content Split

### Root CLAUDE.md (~300 lines) — Universal

- Project Overview
- Core APIs: `initializeOpenDAW`, `editing.modify()`, engine play/stop
- Engine State Observables, Engine Preferences
- Important Patterns: Option types, transaction rules, pointer re-routing, `monitoringMode` not in types, `UUID.Bytes` not a string, `createInstrument` destructuring
- Reactive Box Graph Subscriptions (`pointerHub`)
- React Integration Tips (CanvasPainter, AnimationFrame, subscription cleanup, monitoring peaks lifecycle)
- Build & Verification
- Adding a New Demo checklist (updated for folder structure)
- Reference Files index (updated paths)
- Safari/AudioContext compatibility
- `SoundfontService` proxy guard, `SampleService`

### src/demos/recording/CLAUDE.md

- Recording API (`startRecording`, `stopRecording` vs `stop(true)`)
- Audio Input & Capture (AudioDevices, CaptureAudio, deviceId, gainDb, requestChannels)
- Recording Preferences (takes, countInBars, olderTakeAction)
- How takes work (loop area driven, loop-wrap detection)
- Finding Recording Regions
- Accessing Live Peaks During Recording
- Recording Peaks Include Count-In Frames
- Take Waveform: Shared Buffer Gotcha
- Loop Take Buffer Layout and Offsets
- Proper Recording to Playback Flow (multi-device barrier pattern)
- `capture.armed` is not a box graph field
- Capture settings require `editing.modify()`
- Stop Button Behavior

### src/demos/midi/CLAUDE.md

- MIDI Devices & Recording (MidiDevices, softwareMIDIInput, subscribeMessageEvents)
- CaptureMidi must be explicitly armed
- MIDI channel filtering (captureMidiBox.channel)
- MIDI Recording Requires a Synth Instrument
- Available MIDI instruments list
- Cross-reference to recording/CLAUDE.md for Recording Preferences

### src/demos/playback/CLAUDE.md

- Playback APIs (setPosition, play, queryLoadingComplete)
- Timeline and Loop Area
- Clip Fades (region positioning, fillGainBuffer, fade slopes)
- Fades can share transaction with region changes
- waveformOffset vs loopOffset
- Waveform Rendering (PeaksPainter.renderPixelStrips, fillStyle requirement)
- Mixer Groups (AudioBusFactory, routing, separate transactions)
- Dark Ride Audio details
- localAudioBuffers must be passed to initializeOpenDAW
- Region sorting when positions match

### src/demos/automation/CLAUDE.md

- Time Signature Events (createEvent, iterateAll, one editing.modify per event)
- Tempo Automation Events (tempoTrackEvents, interpolation)
- Track Automation (createAutomationTrack, ValueRegionBox, region-local positions)
- Curve rendering must use Curve.normalizedAt (not bezier)
- Effects Parameter Architecture (3-layer chain, ValueMapping, dB conversion)

### src/demos/effects/CLAUDE.md

- EffectBox is a union type
- Scriptable Devices (Werkstatt, Apparat, Spielwerk)
- ScriptCompiler.compile() is required (.setValue() alone is silent)
- Werkstatt parameter access
- Werkstatt generator scripts must check transport
- Parsing Werkstatt Script Declarations
- Effect display name changes
- WavFile moved to lib-dsp

### src/demos/export/CLAUDE.md

- Offline Audio Rendering (OfflineEngineRenderer, Option.None gotcha)
- Mutate-Copy-Restore pattern
- project.copy() shares sampleManager but not preferences
- Mixdown vs stem path, metronome gain limits

## What Doesn't Change

- Deployed URLs
- Component, hook, and lib file locations
- vite.config.ts rollup input paths
- tsconfig.json
- Landing page (src/index.tsx)

## Verification

After implementation:
1. `npm run build` succeeds
2. Dev server (`npm run dev`) serves all 17 demos correctly
3. Each local CLAUDE.md contains only knowledge relevant to its demo group
4. Root CLAUDE.md contains no demo-specific knowledge that belongs in a local file
5. No duplicated content between root and local CLAUDE.md files
