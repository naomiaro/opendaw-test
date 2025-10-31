# OpenDAW Audio Effects - Architecture Overview

## Overview

OpenDAW provides a comprehensive audio effects system with both **MIDI Effects** and **Audio Effects**. The system is built on a flexible architecture using a **Box Graph** pattern for data representation and **Adapter Pattern** for providing reactive UI bindings.

## Available Effect Types

### Audio Effects (Process and transform audio signals)

1. **Compressor** - Dynamic range reduction
   - Reduces signal level above threshold
   - Configurable attack, release, ratio, knee
   - Optional lookahead and makeup gain

2. **Delay** - Echo/time-based effects
   - Adjustable delay time with note-based fractions
   - Feedback control for repeating echoes
   - Stereo cross-feedback capability

3. **Reverb** - Spatial/space simulation
   - Room size, damping, pre-delay controls
   - Simulates acoustic reflections
   - Essential for spatial effects

4. **Revamp** - Parametric EQ
   - High-pass filter with variable order
   - Low and high shelves
   - Three bell curves for mid-range shaping
   - Low-pass filter with variable order

5. **Crusher** - Bit reduction/distortion
   - Bit depth reduction
   - Crush amount and boost controls
   - Creates digital artifacts and gritty tones

6. **Fold** - Waveshaping/saturation
   - Drive control for input signal
   - Oversampling for quality
   - Volume compensation

7. **Stereo Tool** - Stereo manipulation
   - Volume, panning, stereo width
   - Phase inversion per channel
   - Stereo mixing algorithm selection

8. **Modular** - Custom audio effect designer
   - Visual modular environment
   - Connect modules together
   - Create custom signal processors

### MIDI Effects (Process and transform MIDI note data)

1. **Arpeggio** - Rhythmic note sequence generation
2. **Pitch** - MIDI note pitch shifting
3. **Velocity** - MIDI velocity manipulation
4. **Zeitgeist** - Time/groove distortion

## Architecture Overview

### Data Model - Box-based Storage

Effects are defined using the **Box Graph** pattern:

- **Effect Box** - Data container for effect parameters
  - Located in: `@opendaw/studio-boxes`
  - Examples: `CompressorDeviceBox`, `DelayDeviceBox`
  - Contains Fields for parameters (float32, int32, boolean, objects)

- **Effect Factory** - Creates effect instances
  - Located in: `@opendaw/studio-core` (EffectFactories.ts)
  - Defines default properties (name, icon, description)
  - Handles effect instantiation and initialization

### Adapter Pattern - Reactive Bindings

Effects use the Adapter pattern to provide reactive properties:

- **Device Adapter** - Wraps effect boxes with observable properties
  - Located in: `@opendaw/studio-adapters`
  - Provides `namedParameter` property with typed parameter objects
  - Each parameter includes ValueMapping and StringMapping for conversion
  - Exposes state fields: enabled, minimized, label, index

- **Parameter Adapter** - Individual parameter wrappers
  - Converts between different value ranges (linear, exponential, unipolar, bipolar)
  - Provides string representations (dB, %, Hz, etc.)
  - Supports automation and MIDI learning

### UI Rendering

- **Device Editors** - React components for effect UI
  - Located in: `@opendaw/app/studio/src/ui/devices/audio-effects/`
  - Examples: `CompressorDeviceEditor.tsx`, `DelayDeviceEditor.tsx`
  - Use `ControlBuilder` to create parameter controls
  - Include meters for real-time parameter visualization

### Integration - Effect Chain Processing

- **InsertReturnAudioChain** - Audio effect chain processor
  - Located in: `@opendaw/studio-core-processors`
  - Manages ordering of effects in a chain
  - Handles audio routing through effects
  - Subscribes to effect enable/disable state
  - Invalidates wiring when effects are added/removed

- **DeviceChain** - Abstract interface for effect chains
- **AudioEffectDeviceProcessor** - Runtime processor for individual effects
- **DeviceProcessorFactory** - Creates runtime processors from boxes

## Key Concepts

### Observable Pattern

All state changes use the Observable pattern for reactivity:

```typescript
// Subscribe to changes
const subscription = effectParameter.subscribe((value) => {
  console.log("Value changed to:", value);
});

// Get current value
const currentValue = effectParameter.getValue();

// Modify within transaction
project.editing.modify(() => {
  effectParameter.setValue(newValue);
});
```

### Parameter Wrapping

Each effect parameter is wrapped with:
- **ValueMapping** - Converts between storage and display ranges
  - `linear(min, max)` - Linear scaling
  - `exponential(min, max)` - Exponential scaling for frequency/time
  - `unipolar()` - 0 to 1 range
  - `bipolar()` - -1 to 1 range
  - `DefaultDecibel` - Decibel scaling

- **StringMapping** - Converts values to display strings
  - `decible` - "dB" suffix
  - `percent()` - "%" suffix
  - `numeric({unit, fractionDigits})` - Formatted numbers
  - Custom mapping for indexed values

### Device Host Pattern

Effects are contained within a Device Host, which can be:
- **AudioUnitBox** - Instrument with effects chain
- **AudioBusBox** - Master or auxiliary bus with effects

Each effect has a `host` pointer field that references its container.

## File Organization

```
openDAW/
├── packages/studio/forge-boxes/src/schema/devices/audio-effects/
│   ├── CompressorDeviceBox.ts
│   ├── DelayDeviceBox.ts
│   ├── ReverbDeviceBox.ts
│   ├── RevampDeviceBox.ts
│   ├── CrusherDeviceBox.ts
│   ├── FoldDeviceBox.ts
│   └── StereoToolDeviceBox.ts
├── packages/studio/core/src/
│   ├── EffectFactory.ts (interface)
│   ├── EffectFactories.ts (implementations)
│   ├── EffectBox.ts (type union)
│   └── EffectParameterDefaults.ts
├── packages/studio/adapters/src/devices/audio-effects/
│   ├── CompressorDeviceBoxAdapter.ts
│   ├── DelayDeviceBoxAdapter.ts
│   ├── ReverbDeviceBoxAdapter.ts
│   └── (other adapters)
├── packages/studio/core-processors/src/devices/audio-effects/
│   ├── CompressorDeviceProcessor.ts
│   ├── DelayDeviceProcessor.ts
│   ├── ReverbDeviceProcessor.ts
│   └── (other processors)
└── packages/app/studio/src/ui/devices/audio-effects/
    ├── CompressorDeviceEditor.tsx
    ├── DelayDeviceEditor.tsx
    ├── ReverbDeviceEditor.tsx
    └── (other editors)
```

## Flow Diagram

```
User creates effect via UI
         ↓
EffectFactory.create() instantiated
         ↓
Effect Box created in BoxGraph
         ↓
Box Adapter wraps box with reactive properties
         ↓
Device Editor renders parameter controls
         ↓
User adjusts parameters in editing.modify() transaction
         ↓
Observable updates propagate changes
         ↓
DSP Processor updates in audio thread
         ↓
Audio processed through effect chain
         ↓
Output generated
```

## Integration Points

1. **Track Integration** - Effects are added to tracks via AudioUnitBox
2. **Master Integration** - Master effects via AudioBusBox for main output
3. **Automation** - Effects support parameter automation via Value Tracks
4. **MIDI Learning** - Effects support MIDI CC mapping
5. **Presets** - Full state serializable via Box Graph

## Performance Considerations

- Effects are processed in order within the InsertReturnAudioChain
- Disabled effects are automatically bypassed (not wired into chain)
- Effect state synchronization uses subscription-based updates
- Real-time processors run in audio thread with proper synchronization
