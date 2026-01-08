# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed - openDAW 0.0.56 → 0.0.59

#### Breaking Changes

- **BPM API change**: The `project.bpm` property has been removed. Use `project.timelineBox.bpm.getValue()` to read the BPM value instead.

  **Before (0.0.56):**
  ```typescript
  const bpm = project.bpm;
  ```

  **After (0.0.59):**
  ```typescript
  const bpm = project.timelineBox.bpm.getValue();
  ```

  This change affects:
  - `src/recording-api-react-demo.tsx:242`
  - `src/drum-scheduling-demo.tsx:208`

- **InstrumentFactories moved to different package**: The `InstrumentFactories` export has been moved from `@opendaw/studio-core` to `@opendaw/studio-adapters`. Note: `EffectFactories` remains in `@opendaw/studio-core`.

  **Before (0.0.56):**
  ```typescript
  import { InstrumentFactories, Project } from "@opendaw/studio-core";
  ```

  **After (0.0.59):**
  ```typescript
  import { Project } from "@opendaw/studio-core";
  import { InstrumentFactories } from "@opendaw/studio-adapters";
  ```

  This change affects:
  - `src/drum-scheduling-demo.tsx:8-10`

- **Crusher Effect Parameter Inversion (BREAKING)**: The Crusher (Lo-Fi) effect's main parameter was renamed and inverted on October 18, 2025.

  **Before (0.0.56):**
  ```typescript
  // OLD: crusher-rate (1.0 = clean, 0.0 = crushed)
  effectBox.crusherRate.setValue(0.2); // Light crushing
  ```

  **After (0.0.59):**
  ```typescript
  // NEW: crush - CONFUSING! Processor inverts value internally
  // High UI values = subtle crushing (counterintuitive!)
  effectBox.crush.setValue(0.7); // Light crushing (processor inverts to 0.3 internally)

  // How it works: processor does setCrush(1.0 - uiValue)
  // UI 0.7 → DSP 0.3 → ~4.8kHz sample rate (light lo-fi)
  // UI 0.3 → DSP 0.7 → ~900Hz sample rate (extreme crushing)
  ```

  **Additional Crusher changes:**
  - Default bit depth changed from 32 to 16 bits
  - Filter changed from Butterworth to Biquad (different sonic character)
  - Minimum cutoff frequency set to 1000Hz (Nov 19, 2025)
  - Added 20ms smoothing to prevent zipper noise
  - Boost compensation halved for better balance

  **CRITICAL - Boost Parameter:** The `boost` parameter has a **design issue** that causes volume reduction!
  ```typescript
  // The postGain compensation is applied to BOTH dry and wet signals:
  // outL[i] = (dry * (1 - mix) + wet * mix) * postGain
  //
  // With boost = 2.0 dB:
  //   postGain = dbToGain(-1.0) = 0.89x
  //   Entire output (dry + wet) reduced to 89% volume!
  //
  // RECOMMENDATION: Use boost = 0 for most presets to avoid volume loss

  effectBox.boost.setValue(0); // Recommended - no volume reduction
  effectBox.boost.setValue(1.5); // Slight volume reduction (~7%)
  effectBox.boost.setValue(3.0); // Moderate volume reduction (~16%)
  ```

  **Bit Depth Minimum:** Using fewer than 5 bits can result in near-silence, especially with heavy crushing.
  - 3-4 bits = 8-16 levels → essentially silence at low sample rates
  - 5-6 bits = 32-64 levels → extreme but audible lo-fi
  - 8-12 bits = 256-4096 levels → classic retro/lo-fi range

  **Known Issues in 0.0.59:**
  - Volume may remain lower even when effect is bypassed (requires removing effect entirely)
  - Boost parameter causes volume reduction instead of enhancement
  - Crush parameter is counter-intuitive (high values = subtle effect)

  **Impact:**
  1. Any saved Crusher presets from before October 2025 will sound inverted (heavily crushed instead of subtle, or vice versa). Preset values need to be inverted: `newValue = 1.0 - oldValue`.
  2. Boost values that were 0-1 need to be converted to dB (use 0 to avoid volume loss).
  3. Bit depth values below 5 may result in inaudible output.

  This change affects:
  - `src/lib/effectPresets.ts` - All CRUSHER_PRESETS need inversion
  - `src/hooks/useEffectChain.ts:66` - Default crush value
  - `src/hooks/useDynamicEffect.ts:75` - Default crush value

#### Non-Breaking Changes

- **Effects API - No Breaking Changes**: The effects system API remains unchanged in 0.0.59. The `project.api.insertEffect()` method and `EffectFactories` namespace work exactly as before.

  **Confirmed working pattern:**
  ```typescript
  import { Project, EffectFactories } from "@opendaw/studio-core";

  // Insert effect using the API (recommended)
  const effect = project.api.insertEffect(
    audioBox.audioEffects,
    EffectFactories.AudioNamed.Reverb
  );
  ```

- **New Effects Available**: OpenDAW 0.0.59 includes several new audio effects:
  - `EffectFactories.AudioNamed.DattorroReverb` - High-quality algorithmic reverb (NEW)
  - `EffectFactories.AudioNamed.Tidal` - Volume/Pan modulation effect (NEW)
  - `EffectFactories.AudioNamed.Fold` - Wavefolder distortion (NEW)
  - `EffectFactories.AudioNamed.Crusher` - Lo-fi bit crusher (NEW)
  - `EffectFactories.AudioNamed.Compressor` - Dynamic range compressor (NEW)

- **Effect Enhancements**:
  - Reverb effect now includes damping parameter for better control

### Changed - openDAW 0.0.59 → 0.0.87

#### Breaking Changes

- **DefaultSampleLoaderManager renamed to GlobalSampleLoaderManager**: The sample loader manager class has been renamed and its constructor signature changed to accept a `SampleProvider` directly instead of a configuration object.

  **Before (0.0.59):**
  ```typescript
  import { DefaultSampleLoaderManager } from "@opendaw/studio-core";

  const sampleManager = new DefaultSampleLoaderManager({
    fetch: async (uuid, progress) => { /* ... */ }
  });
  ```

  **After (0.0.87):**
  ```typescript
  import { GlobalSampleLoaderManager, SampleProvider } from "@opendaw/studio-core";

  const sampleProvider: SampleProvider = {
    fetch: async (uuid, progress) => { /* ... */ }
  };
  const sampleManager = new GlobalSampleLoaderManager(sampleProvider);
  ```

  This change affects:
  - `src/lib/projectSetup.ts`

- **AudioData moved from studio-adapters to lib-dsp**: The `AudioData` type has been moved to a different package.

  **Before (0.0.59):**
  ```typescript
  import { AudioData } from "@opendaw/studio-adapters";
  ```

  **After (0.0.87):**
  ```typescript
  import { AudioData } from "@opendaw/lib-dsp";
  ```

  This change affects:
  - `src/lib/projectSetup.ts`

- **OpenSampleAPI.fromAudioBuffer removed**: The convenience method for converting browser `AudioBuffer` to OpenDAW's `AudioData` has been removed. You must now manually convert using `AudioData.create()`.

  **Before (0.0.59):**
  ```typescript
  import { OpenSampleAPI } from "@opendaw/studio-core";

  const audioData = OpenSampleAPI.fromAudioBuffer(audioBuffer);
  ```

  **After (0.0.87):**
  ```typescript
  import { AudioData } from "@opendaw/lib-dsp";

  function audioBufferToAudioData(audioBuffer: AudioBuffer): AudioData {
    const { numberOfChannels, length: numberOfFrames, sampleRate } = audioBuffer;
    const audioData = AudioData.create(sampleRate, numberOfFrames, numberOfChannels);
    for (let channel = 0; channel < numberOfChannels; channel++) {
      audioData.frames[channel].set(audioBuffer.getChannelData(channel));
    }
    return audioData;
  }

  const audioData = audioBufferToAudioData(audioBuffer);
  ```

  This change affects:
  - `src/lib/projectSetup.ts`

- **OpenSampleAPI.load signature changed**: The `audioContext` parameter has been removed.

  **Before (0.0.59):**
  ```typescript
  const [audioData, metadata] = await OpenSampleAPI.get().load(uuid, audioContext, progress);
  ```

  **After (0.0.87):**
  ```typescript
  const [audioData, metadata] = await OpenSampleAPI.get().load(uuid, progress);
  ```

  This change affects:
  - `src/lib/projectSetup.ts`

- **AudioRegionBox requires mandatory `events` edge**: The `AudioRegionBox` now requires a connection to a `ValueEventCollectionBox` via the `events` edge. This is a runtime error if not provided.

  **Before (0.0.59):**
  ```typescript
  import { AudioRegionBox } from "@opendaw/studio-boxes";

  AudioRegionBox.create(boxGraph, UUID.generate(), box => {
    box.regions.refer(trackBox.regions);
    box.file.refer(audioFileBox);
  });
  ```

  **After (0.0.87):**
  ```typescript
  import { AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";

  // Create events collection box first
  const eventsCollectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());

  AudioRegionBox.create(boxGraph, UUID.generate(), box => {
    box.regions.refer(trackBox.regions);
    box.file.refer(audioFileBox);
    box.events.refer(eventsCollectionBox.owners); // NEW - required
  });
  ```

  **Error if not provided:**
  ```
  Error: Pointer {_AudioRegionBox:_PointerField (events) xxx/5 requires an edge.
  ```

  This change affects:
  - `src/drum-scheduling-demo.tsx`
  - `src/timebase-demo.tsx`
  - `src/lib/trackLoading.ts`

- **AudioPlayback enum removed**: The `AudioPlayback` enum and related `playback.setValue()` method on AudioRegionBox have been removed. Audio playback sync mode is now handled differently.

  **Before (0.0.59):**
  ```typescript
  import { AudioPlayback } from "@opendaw/studio-boxes";

  AudioRegionBox.create(boxGraph, UUID.generate(), box => {
    // ...
    box.playback.setValue(AudioPlayback.NoSync);
  });
  ```

  **After (0.0.87):**
  ```typescript
  AudioRegionBox.create(boxGraph, UUID.generate(), box => {
    // Remove the playback.setValue() call entirely
    // Sync behavior is now handled automatically or through other means
  });
  ```

  This change affects:
  - `src/drum-scheduling-demo.tsx`
  - `src/timebase-demo.tsx`
  - `src/lib/trackLoading.ts`

- **AudioOfflineRenderer.start signature changed**: The progress callback is now a required 3rd parameter, and `abortSignal` is a separate 4th parameter.

  **Before (0.0.59):**
  ```typescript
  import { AudioOfflineRenderer } from "@opendaw/studio-core";

  const audioBuffer = await AudioOfflineRenderer.start(
    project,
    exportConfig,
    sampleRate
  );
  ```

  **After (0.0.87):**
  ```typescript
  import { AudioOfflineRenderer } from "@opendaw/studio-core";
  import { Progress } from "@opendaw/lib-std";

  const progressHandler: Progress.Handler = (value) => {
    console.log(`${Math.round(value * 100)}%`);
  };

  const audioBuffer = await AudioOfflineRenderer.start(
    project,
    exportConfig,        // Option<ExportStemsConfiguration>
    progressHandler,     // Progress.Handler (value: 0.0 - 1.0)
    abortSignal,         // AbortSignal | undefined
    sampleRate           // number
  );
  ```

  **Note:** The progress value is now `0.0` to `1.0` (multiply by 100 for percentage).

  This change affects:
  - `src/lib/audioExport.ts`

- **Progress callback type changed**: Progress callbacks now use `Progress.Handler` from `@opendaw/lib-std` instead of `Procedure<unitValue>`.

  **Before (0.0.59):**
  ```typescript
  import { Procedure, unitValue } from "@opendaw/lib-std";

  const onProgress: Procedure<unitValue> = (value) => { /* ... */ };
  ```

  **After (0.0.87):**
  ```typescript
  import { Progress } from "@opendaw/lib-std";

  const progressHandler: Progress.Handler = (value) => { /* ... */ };
  ```

  This change affects:
  - `src/lib/projectSetup.ts`
  - `src/lib/audioExport.ts`

#### New Features

- **Errors.isAbort helper**: OpenDAW now provides `Errors.isAbort()` from `@opendaw/lib-std` to check if an error was caused by an AbortController abort. This is more reliable than checking for `DOMException` with name `"AbortError"`.

  ```typescript
  import { Errors } from "@opendaw/lib-std";

  try {
    await AudioOfflineRenderer.start(project, config, progress, abortSignal, sampleRate);
  } catch (error) {
    if (Errors.isAbort(error)) {
      console.log("Export was cancelled");
      return;
    }
    throw error;
  }
  ```

#### Migration Checklist

1. [ ] Update `DefaultSampleLoaderManager` → `GlobalSampleLoaderManager`
2. [ ] Update import for `AudioData` from `@opendaw/studio-adapters` → `@opendaw/lib-dsp`
3. [ ] Replace `OpenSampleAPI.fromAudioBuffer()` with manual `AudioData.create()` conversion
4. [ ] Remove `audioContext` parameter from `OpenSampleAPI.get().load()` calls
5. [ ] Add `ValueEventCollectionBox` and connect via `events.refer()` for all `AudioRegionBox` instances
6. [ ] Remove `AudioPlayback` import and `playback.setValue()` calls
7. [ ] Update `AudioOfflineRenderer.start()` calls with new parameter order
8. [ ] Update progress callbacks to use `Progress.Handler` type
9. [ ] Use `Errors.isAbort()` for abort error detection
