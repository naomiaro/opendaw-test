# OpenDAW SDK Changelog: 0.0.119 → 0.0.128

## Breaking Changes for SDK Consumers

1. **ProjectEnv Interface** (0.0.124): Must now provide `sampleService` and `soundfontService` implementations
2. **SampleService API** (0.0.124): Constructor no longer takes a callback; use `subscribe()` method instead
3. **SoundfontService API** (0.0.124): Constructor no longer takes a callback; use `subscribe()` method instead
4. **RecordingWorklet** (0.0.124): Requires `sampleService` property to be set before recording starts
5. **PeaksPainter** (0.0.126): New `renderPixelStrips()` method for block-based waveform rendering; `RegionRenderer` changed from function-based to namespace with static methods

## Version Details

### 0.0.120 (Mar 4, 2026)

**New Features**
- Added `isHistoryReplay` property to YSync for distinguishing history replay events from local updates. Enables proper undo/redo replay functionality by allowing history replay events (origin starting with `"[history]"`) to pass through even when marked as local.

### 0.0.121 (Mar 4, 2026)

- Version bump only

### 0.0.122 (Mar 6, 2026)

**Bug Fixes**
- **Tape Playback**: Fixed critical sample rate conversion in `TimeStretchSequencer.ts` — playback rate now correctly accounts for file sample rate vs engine sample rate when playing pitch-stretched audio
- Removed deprecated `DirectVoice` class; consolidated pitch handling into `PitchVoice`
- Fixed lookahead sample calculations for voice fade timing
- Fixed drift threshold calculations to use correct sample rates for boundary detection

### 0.0.123 (Mar 7, 2026)

**Bug Fixes**
- Fixed visual bug in Performance Stats display
- Better progress handling for offline rendering

### 0.0.124 (Mar 10, 2026)

**New Features — Recording Service Architecture**

Refactored the recording pipeline to use a service-based architecture. Recording finalization is now delegated to `SampleService` instead of handled in `RecordingWorklet`.

- Added `SampleService` and `SoundfontService` to `ProjectEnv` interface
- Services use observer pattern (`subscribe()`) instead of callback constructors
- Added `importRecording()` method to `SampleService` for direct audio data import
- Added `origin` field to `AssetService.ImportArgs` to distinguish `"import"` vs `"recording"` origins
- `CaptureAudio.prepareRecording()` now injects `sampleService` into recording worklet

**API Changes**
```typescript
// Before (0.0.119)
const sampleService = new SampleService(audioContext, onUpdate);
const soundfontService = new SoundfontService(onUpdate);

// After (0.0.124)
const sampleService = new SampleService(audioContext);
const soundfontService = new SoundfontService();
sampleService.subscribe(observer);  // observe changes
soundfontService.subscribe(observer);
```

**Technical Details**
- `RecordingWorklet` now defers peak analysis and metadata to `SampleService.importRecording()`
- Simplified finalization path: worklet passes `AudioData` to service, which handles file encoding, peak generation, and storage

### 0.0.125 (Mar 11, 2026)

**New Features**
- **MIDI Recording**: Notes played before count-in are now captured via a pending notes buffer and flushed into the first take at position 0 with minimum duration. Previously, notes triggered during count-in were lost.
- Added `overlapping(from, to, pitch)` method to `NoteEventCollectionBoxAdapter` for finding overlapping notes by pitch range

### 0.0.126 (Mar 11, 2026)

**New Features — Blocky Waveform Rendering**
- Introduced `PeaksPainter.renderPixelStrips()` for block-based waveform display
- `RegionRenderer` changed from function-based to namespace with static methods
- Added `setAudioRenderStrategy()` for configurable audio rendering strategies
- Refactored audio rendering pipeline with improved pixel-strip visualization

**Bug Fixes**
- Fixed audio editor height calculation (uses painter height instead of computed style)
- Region rendering now uses CSS pixel values for bounds (not DPR-scaled)

### 0.0.127 (Mar 12, 2026)

- Version bump only

### 0.0.128 (Mar 12, 2026)

- Version bump only

## Impact Assessment for opendaw-test

### Resolved
- **0.0.124 — SampleService**: Added `new SampleService(audioContext)` to `projectSetup.ts`. Required for recording finalization (SDK delegates to it internally).
- **0.0.124 — SoundfontService**: Skipped — constructor unconditionally fetches `api.opendaw.studio/soundfonts/list.json` (CORS error in dev). The SDK declares `soundfontService` in `ProjectEnv` but never reads it internally, so we pass `undefined`. None of the demos use soundfont instruments (MIDI demo uses Vaporisateur built-in synth).
- **0.0.124 — RecordingWorklet.sampleService**: No action needed — `CaptureAudio.prepareRecording()` injects it automatically from ProjectEnv.
- **0.0.126 — PeaksPainter**: Renamed `renderBlocks()` → `renderPixelStrips()` in 3 files (same signature). **Note:** After upgrading, clear the Vite dep cache (`rm -rf node_modules/.vite`) or the dev server will serve the old pre-bundled SDK with `renderBlocks`.
- **0.0.126 — RegionRenderer**: Not used in this project — no action needed.

### No Action Needed
- 0.0.120 (YSync — not used in headless demos)
- 0.0.122 (Tape playback sample rate fix — automatic improvement)
- 0.0.123 (Performance stats / offline rendering — not used)
- 0.0.125 (MIDI count-in fix — automatic behavior improvement)
