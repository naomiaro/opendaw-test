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
