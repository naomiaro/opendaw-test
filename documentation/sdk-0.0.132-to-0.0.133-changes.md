# OpenDAW SDK Changelog: 0.0.132 → 0.0.133

## Breaking Changes for SDK Consumers

1. **`Strings.nonEmpty()` signature change**: Now returns a type guard (`str is string`) instead of the string or fallback. Use `Strings.fallback(str, "default")` for the old behavior. Also now trims whitespace — a string of only spaces triggers the fallback.

2. **`Editing.undo()` / `Editing.redo()` return `boolean`**: Returns `false` when the operation fails (e.g., conflicting changes in collaborative sessions). Previously returned `void`.

3. **`TransactionListener.onEndTransaction` signature changed**: Now receives `onEndTransaction(rolledBack: boolean)`. Any code implementing `TransactionListener` must accept the new parameter.

4. **`Engine.registerMonitoringSource` gained 4th parameter**: Now requires `destinationNode: AudioNode` as the fourth argument. The monitoring system was refactored into a new `MonitoringRouter` class with the engine worklet now outputting 2 channels (main audio + monitoring).

5. **`BoxEditing.disable()` removed**: Previously used internally for live-room collaboration. If you were calling `project.editing.disable()`, this will fail.

6. **`project.stopRecording()` no longer calls `editing.mark()`**: The undo boundary is now set automatically inside `RecordAudio` after finalization completes.

## New Features

### Vocoder Audio Effect
A full analysis/synthesis vocoder has been added as a new audio effect device.

- Up to 16 bandpass filter bands (configurable: 8, 12, or 16) using biquad bandpass filters
- 5 modulator modes: `noise-white`, `noise-pink`, `noise-brown`, `self` (multi-band gate), `external` (sidechain)
- Envelope follower with independent attack/release (exponential one-pole)
- Equal-power dry/wet mix crossfade with automatic gain compensation

**Automatable parameters:**
- `carrierMinFreq` / `carrierMaxFreq` (20-20000 Hz, exponential)
- `modulatorMinFreq` / `modulatorMaxFreq` (20-20000 Hz, exponential)
- `qMin` / `qMax` (1.0-60.0, exponential)
- `envAttack` (0.1-100 ms) / `envRelease` (1-1000 ms)
- `gain` (-20 to +20 dB) / `mix` (0-100%)
- `sideChain` pointer field for external modulation source

**Spectrum analysis:** Two broadcast addresses (`0xFFE` modulator, `0xFFF` carrier) for real-time UI spectrum visualization, with lazy activation only when subscribers exist.

```typescript
import { EffectFactories } from "@opendaw/studio-core";
project.api.addEffect(audioUnitBoxAdapter, EffectFactories.Vocoder);
```

New icons: `IconSymbol.Vocoder` and `IconSymbol.Charts`.

### CaptureAudio Monitor Controls
`CaptureAudio` now has a dedicated monitoring signal chain with independent volume, pan, mute, and output device routing:

```typescript
const capture: CaptureAudio = ...;

capture.monitorVolumeDb = -6.0;            // independent monitor volume (dB)
capture.monitorPan = 0.0;                  // stereo panning (-1.0 to 1.0)
capture.monitorMuted = true;               // mute toggle
await capture.setMonitorOutputDevice(      // route to specific output device
  Option.wrap("device-id-string")
);
```

Direct monitoring now taps from `sourceNode` (before recording gain), allowing independent control of recording level vs monitoring level. Chain: `sourceNode → monitorGainNode → monitorPanNode → destination`.

### Audio WAV and MIDI Export API
New export methods on `ProjectApi`:

```typescript
// Export MIDI notes to .mid file (triggers save dialog)
await project.api.exportMIDI(noteEventCollectionBoxAdapter, "my-notes.mid");

// Export audio region/clip to .wav file (triggers save dialog)
await project.api.exportAudio(audioRegionBoxAdapter, "my-audio.wav");
```

Backed by new `NoteMidiExport` and `AudioWavExport` namespaces from `@opendaw/studio-core`.

### BoxGraph Transaction Rollback
`BoxGraph` now supports full transaction rollback:

- `boxGraph.abortTransaction()` — reverts all changes since `beginTransaction()`
- `endTransaction()` auto-validates edge constraints and rolls back on failure
- `editing.modify()` catches exceptions and aborts cleanly instead of leaving the graph inconsistent
- Undo/redo are now resilient to collaboration conflicts — failed steps are auto-reversed with a notification

### Engine Preferences: Debug DSP Load Measurement
```typescript
const settings = project.engine.preferences.settings;
settings.debug.dspLoadMeasurement = true; // default: false
```

When disabled (default), the render loop skips all timing overhead.

### `Bytes` Namespace (lib-std)
`Bytes.toString(numBytes)` — formats byte counts as human-readable strings (e.g., `1500` → `"1.5kB"`). Uses SI units (1000-based).

## Bug Fixes

1. **Recording: zero-duration takes deleted**: When a loop take has zero or negative duration (timing edge cases), the region is now deleted rather than finalized. A new take is only started if the previous was successfully finalized.

2. **SampleService: descriptive decode error**: Now rejects with `new Error("Could not decode audio file")` instead of an empty `Promise.reject()`.

3. **AssetService: import failure no longer crashes**: `importFile()` is now wrapped in `tryCatch()`. On failure, a user-facing notification is shown and the loop continues to the next file.

4. **Soundfont loading: graceful error handling**: `DefaultSoundfontLoader` and `SoundfontService` now catch unhandled promise rejections during fetch/loading, setting state to error instead of crashing.

5. **AudioOfflineRenderer: explicit output index**: Now connects `engineWorklet` to destination with output index `0` (necessary since the worklet now has 2 outputs).

6. **Preferences partial schema migration**: When the full Zod schema fails to parse stored preferences, each section is now parsed independently and merged with defaults, instead of discarding all user preferences.

7. **`wavefold` determinism**: Changed `Math.round()` to `Math.floor(x + 0.5)` to avoid "round half to even" (banker's rounding) non-determinism at exact 0.5 boundaries.

8. **AnimationFrame scheduling**: `requestAnimationFrame` is now called at the start of the callback (before executing tasks) with a 16ms minimum interval throttle to prevent frame drops on high-refresh displays.

9. **Dragging focus fix**: Drag targets now receive focus (with `preventScroll: true`), fixing keyboard shortcut handling during drag operations.

10. **Route matching trailing slash**: `RouteMatcher` now strips trailing slashes before matching.

11. **UUID.toString performance**: Hex lookup table is now created once at module load instead of every call.

12. **Audio bus side-chain**: `AudioBusProcessor` now registers its output buffer in the `audioOutputBufferRegistry`, enabling other processors (like the Vocoder) to resolve it as a sidechain source.

13. **YSync resilience**: Transaction errors are caught and rolled back instead of crashing via `panic()`. Missing boxes/vertices now throw (triggering rollback) instead of being silently ignored.

## Performance Optimizations

### Dattorro Reverb DSP
- Delay line storage restructured from tuple arrays to separate typed arrays with power-of-2 sizing for bitwise masking instead of modulo
- Inner per-sample loop hoists all 12 delay buffer references into local variables with inlined cubic interpolation
- All method calls eliminated from the hot loop in favor of direct array access

### Fold Device Processor
- Wavefold math inlined, eliminating import call overhead
- Two-branch processing: interpolating path (per-sample `moveAndGet()`) vs steady-state path (reads gain/amount once)

### Maximizer Device Processor
- Headroom gain computation cached in `#headroomGain`, only recomputed when threshold changes

### Werkstatt and Apparat Scriptable Devices
- Pending update tracking via `#pendingUpdate` field instead of per-block code string re-parsing during silence
- Werkstatt: `UserIO` object allocated once and reused instead of per-block creation

### Spielwerk MIDI Effect Processor
- Persistent `#events` array and `#userBlock` object instead of per-block allocation
- Direct index-based iteration instead of iterator wrapper

### Tape Device Processor
- `#visitedUuids` changed from `Set<string>` (per-block) to persistent `Array<UUID.Bytes>` with `UUID.equals()` lookup, eliminating UUID string serialization

### BlockRenderer Marker Track
- Direct index-based marker access via `floorLastIndex()` + `optAt()` instead of iterator allocation

### DSP Load Measurement
- High-resolution clock measurement now gated behind `debug.dspLoadMeasurement` preference (default: `false`), eliminating timing overhead from the render loop by default

## Internal Changes

### MonitoringRouter (new class)
Extracted from `EngineWorklet`. Manages up to `MAX_MONITORING_CHANNELS = 8` monitoring channels. Routes source audio into the engine worklet's input for effects processing, then splits processed output (worklet output 1) back to each source's destination node.

### Schema
- `RootBox.users` pointer field changed from `mandatory: true` to `mandatory: false` (allows projects without user data)
- `VocoderDeviceBox` added to `EffectBox` union type with all parameter fields

### BoxGraph Internals
- `GraphEdges` tracks `#affected` UUIDs during transactions for targeted validation instead of full-graph scans
- `editing.modify()` wraps entire transaction in `tryCatch()` — on failure, aborts transaction and re-throws
- `SyncSource` discards accumulated updates when `rolledBack` is true

### Marked Internal
- `OpenSampleAPI` and `OpenSoundfontAPI` now have `/** @internal */` JSDoc tags

## Migration Guide

### Strings.nonEmpty() → Strings.fallback()
```typescript
// Before (0.0.132)
const name = Strings.nonEmpty(maybeStr, "default");

// After (0.0.133)
const name = Strings.fallback(maybeStr, "default");

// New type guard usage
if (Strings.nonEmpty(maybeStr)) {
  // maybeStr is narrowed to string
}
```

### Editing.undo() / redo() return value
```typescript
// Before (0.0.132)
project.editing.undo(); // void

// After (0.0.133)
const success = project.editing.undo(); // boolean
if (!success) {
  console.warn("Undo failed — conflicting changes");
}
```

## Source Code References

- VocoderDsp: `packages/studio/core-processors/src/devices/audio-effects/VocoderDsp.ts`
- VocoderDeviceProcessor: `packages/studio/core-processors/src/devices/audio-effects/VocoderDeviceProcessor.ts`
- VocoderDeviceBox: `packages/studio/forge-boxes/src/schema/devices/audio-effects/VocoderDeviceBox.ts`
- VocoderDeviceBoxAdapter: `packages/studio/adapters/src/devices/audio-effects/VocoderDeviceBoxAdapter.ts`
- MonitoringRouter: `packages/studio/core/src/MonitoringRouter.ts`
- CaptureAudio: `packages/studio/core/src/capture/CaptureAudio.ts`
- AudioWavExport: `packages/studio/core/src/project/AudioWavExport.ts`
- NoteMidiExport: `packages/studio/core/src/project/NoteMidiExport.ts`
- ProjectApi: `packages/studio/core/src/project/ProjectApi.ts`
- BoxGraph: `packages/lib/box/src/BoxGraph.ts`
- DattorroReverb: `packages/studio/core-processors/src/devices/audio-effects/DattorroReverbDsp.ts`
- EngineProcessor: `packages/studio/core-processors/src/EngineProcessor.ts`
