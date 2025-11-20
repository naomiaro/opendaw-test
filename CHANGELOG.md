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

- **InstrumentFactories and EffectFactories moved to different package**: The `InstrumentFactories` and `EffectFactories` exports have been moved from `@opendaw/studio-core` to `@opendaw/studio-adapters`.

  **Before (0.0.56):**
  ```typescript
  import { InstrumentFactories, EffectFactories, Project } from "@opendaw/studio-core";
  ```

  **After (0.0.59):**
  ```typescript
  import { Project } from "@opendaw/studio-core";
  import { InstrumentFactories, EffectFactories } from "@opendaw/studio-adapters";
  ```

  This change affects:
  - `src/drum-scheduling-demo.tsx:8-10`
  - `src/hooks/useEffectChain.ts:1-3`
  - `src/hooks/useDynamicEffect.ts:1-3`
