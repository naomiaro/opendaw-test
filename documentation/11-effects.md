# Effects

> **Skip if:** you're not implementing audio effects
> **Prerequisites:** Chapter 07 (Building a Complete App)

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Available Effect Types](#available-effect-types)
- [Creating and Adding Effects](#creating-and-adding-effects)
- [Track Integration](#track-integration)
- [Master Bus Integration](#master-bus-integration)
- [UI Controls](#ui-controls)
- [Code Examples](#code-examples)
- [Built-in Effect Reference](#built-in-effect-reference)
  - [Werkstatt](#werkstatt)
  - [Spielwerk](#spielwerk)
  - [Tone3000](#tone3000)

---

## Architecture Overview

OpenDAW provides a comprehensive audio effects system with both **MIDI Effects** and **Audio Effects**. The system is built on a flexible architecture using a **Box Graph** pattern for data representation and **Adapter Pattern** for providing reactive UI bindings.

### Available Effect Types

#### Audio Effects (Process and transform audio signals)

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

8. **Dattorro Reverb** - High-quality algorithmic reverb
   - Based on Jon Dattorro's plate reverb algorithm
   - Modulation for lush, animated tails
   - Extensive diffusion controls

9. **Tidal** - LFO modulator/tremolo
   - Variable waveform shape (sine to square)
   - Stereo phase offset for auto-pan
   - Wide rate range for tremolo effects

10. **Maximizer** - Brick-wall limiter
    - True peak limiting
    - Lookahead mode for transparency
    - Essential for mastering chains

11. **Modular** - Custom audio effect designer
   - Visual modular environment
   - Connect modules together
   - Create custom signal processors

12. **Werkstatt** - Scriptable audio effect (SDK 0.0.129+)
    - User-written JavaScript DSP code
    - Uses `// @param` and `// @sample` comment declarations for parameters
    - Custom audio signal processing

#### MIDI Effects (Process and transform MIDI note data)

1. **Arpeggio** - Rhythmic note sequence generation
2. **Pitch** - MIDI note pitch shifting
3. **Velocity** - MIDI velocity manipulation
4. **Zeitgeist** - Time/groove distortion
5. **Spielwerk** - Scriptable MIDI effect (SDK 0.0.129+)
   - User-written JavaScript MIDI processing
   - Uses `// @param` comment declarations for parameters

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

### Key Concepts

#### Observable Pattern

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

#### Parameter Wrapping

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

#### Device Host Pattern

Effects are contained within a Device Host, which can be:
- **AudioUnitBox** - Instrument with effects chain
- **AudioBusBox** - Master or auxiliary bus with effects

Each effect has a `host` pointer field that references its container.

### File Organization

```
openDAW/
├── packages/studio/forge-boxes/src/schema/devices/audio-effects/
│   ├── CompressorDeviceBox.ts
│   ├── DelayDeviceBox.ts
│   ├── ReverbDeviceBox.ts
│   ├── DattorroReverbDeviceBox.ts
│   ├── RevampDeviceBox.ts
│   ├── CrusherDeviceBox.ts
│   ├── FoldDeviceBox.ts
│   ├── StereoToolDeviceBox.ts
│   ├── TidalDeviceBox.ts
│   └── MaximizerDeviceBox.ts
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

### Flow Diagram

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

### Integration Points

1. **Track Integration** - Effects are added to tracks via AudioUnitBox
2. **Master Integration** - Master effects via AudioBusBox for main output
3. **Automation** - Effects support parameter automation via Value Tracks
4. **MIDI Learning** - Effects support MIDI CC mapping
5. **Presets** - Full state serializable via Box Graph

### Performance Considerations

- Effects are processed in order within the InsertReturnAudioChain
- Disabled effects are automatically bypassed (not wired into chain)
- Effect state synchronization uses subscription-based updates
- Real-time processors run in audio thread with proper synchronization

---

## Available Effect Types

### Compressor

**Purpose:** Reduces the dynamic range of audio by attenuating signals above a threshold.

**Factory Reference:** `EffectFactories.AudioNamed.Compressor`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| lookahead | boolean | - | false | - | yes | Enable lookahead mode for pre-processing |
| automakeup | boolean | - | true | - | yes | Automatically adjust makeup gain |
| autoattack | boolean | - | false | - | yes | Automatically adjust attack time |
| autorelease | boolean | - | false | - | yes | Automatically adjust release time |
| inputgain | float32 | -30.0 to 30.0 | 0.0 | dB | yes | Input signal level adjustment |
| threshold | float32 | -60.0 to 0.0 | -10.0 | dB | yes | Level above which compression applies |
| ratio | float32 | 1.0 to 24.0 | 2.0 | ratio | yes | Compression ratio (1:1 to infinity:1) |
| knee | float32 | 0.0 to 24.0 | 0.0 | dB | yes | Soft knee width |
| attack | float32 | 0.0 to 100.0 | 0.0 | ms | yes | Time to reach compression |
| release | float32 | 5.0 to 1500.0 | 5.0 | ms | yes | Time to release compression |
| makeup | float32 | -40.0 to 40.0 | 0.0 | dB | yes | Makeup gain to compensate for reduction |
| mix | float32 | 0.0 to 1.0 | 1.0 | % | yes | Dry/Wet mix percentage |
| side-chain | pointer | - | (none) | - | - | External side-chain input (Pointers.SideChain) |

**Side-chain:** When connected, the compressor uses the side-chain signal for level detection instead of the input. The main input is still what gets compressed. Connect via `compressorBox.sideChain.refer(otherAudioOutput)`.

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/CompressorDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/CompressorDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/CompressorDeviceEditor.tsx`

**Features:**
- Visual compression curve display
- Real-time metering (input, output, gain reduction)
- Toggle buttons for automatic parameter adjustment
- External side-chain input
- Based on CTAG DRC algorithm

---

### Delay

**Purpose:** Creates echoing effects by repeating the input signal at specific time intervals. Features a two-stage architecture: per-channel pre-delay, followed by a shared ping-pong delay line with feedback.

**Factory Reference:** `EffectFactories.AudioNamed.Delay`

**Main Delay Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| delayMusical | float32 | 0 to 20 | 13 | index | yes | Delay time as index into Fractions array (see table below) |
| delayMillis | float32 | 0.0 to 1000.0 | 0.0 | ms | yes | Free-running delay time added to synced time |
| feedback | float32 | 0.0 to 1.0 | 0.5 | % | yes | Amount of output fed back to input |
| cross | float32 | 0.0 to 1.0 | 1.0 | % | yes | Cross-channel feedback (0=independent L/R, 1=full ping-pong) |
| filter | float32 | -1.0 to 1.0 | 0.0 | % | yes | Filter on feedback loop (negative=low-pass, positive=high-pass, 0=bypass) |
| dry | float32 | -60.0 to 0.0 | 0.0 | dB | yes | Dry signal level |
| wet | float32 | -60.0 to 0.0 | -6.0 | dB | yes | Wet signal level |

**Per-Channel Pre-Delay Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| preSyncTimeLeft | float32 | 0 to 20 | 8 | index | yes | Left pre-delay synced time (Fractions index, default 8 = 1/16 note) |
| preMillisTimeLeft | float32 | 0.0 to 1000.0 | 0.0 | ms | yes | Left pre-delay free-running time added to synced |
| preSyncTimeRight | float32 | 0 to 20 | 0 | index | yes | Right pre-delay synced time (default 0 = Off) |
| preMillisTimeRight | float32 | 0.0 to 1000.0 | 0.0 | ms | yes | Right pre-delay free-running time added to synced |

**LFO Modulation Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| lfoSpeed | float32 | 0.1 to 5.0 | 0.1 | Hz | yes | LFO rate (exponential mapping) |
| lfoDepth | float32 | 0.0 to 50.0 | 0.0 | ms | yes | LFO modulation depth (power-4 mapping, 0=no modulation) |

The LFO is a triangle wave that modulates the delay line read position, creating chorus/vibrato effects on the delayed signal.

**Architecture:** The total delay per channel is: `preDelay(synced + millis) → main delay line(synced + millis)`. Pre-delays are independent per channel, enabling asymmetric stereo delays. The main delay line processes both channels with shared feedback/cross settings.

**Safety:** The feedback loop includes a built-in soft limiter (50ms attack, 250ms release) and each iteration is multiplied by 0.96 (~-0.35dB) to prevent runaway feedback.

**Delay Fractions Array (21 entries, indices 0-20):**

| Index | Fraction | Index | Fraction | Index | Fraction |
|-------|----------|-------|----------|-------|----------|
| 0 | Off | 7 | 3/64 | 14 | 1/4 |
| 1 | 1/128 | 8 | 1/16 | 15 | 5/16 |
| 2 | 1/96 | 9 | 1/12 | 16 | 1/3 |
| 3 | 1/64 | 10 | 3/32 | 17 | 3/8 |
| 4 | 1/48 | 11 | 1/8 | 18 | 7/16 |
| 5 | 1/32 | 12 | 1/6 | 19 | 1/2 |
| 6 | 1/24 | 13 | 3/16 | 20 | 1/1 |

**Important:** This is a different array from Tidal's `RateFractions` (17 entries, largest-to-smallest). The Delay Fractions go smallest-to-largest and include "Off" at index 0. Box default 13 = 3/16 (dotted eighth).

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/DelayDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/DelayDeviceBoxAdapter.ts`
- Processor: `/openDAW/packages/studio/core-processors/src/devices/audio-effects/DelayDeviceDsp.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/DelayDeviceEditor.tsx`

---

### Gate

**Purpose:** Attenuates signals below a threshold to reduce noise. Supports external side-chain input and inverse (ducking) mode.

**Factory Reference:** `EffectFactories.AudioNamed.Gate`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| threshold | float32 | -60.0 to 0.0 | -6.0 | dB | yes | Level above which the gate opens |
| return | float32 | 0.0 to 24.0 | 0.0 | dB | yes | Hysteresis — gate closes at `threshold - return` dB |
| attack | float32 | 0.0 to 50.0 | 1.0 | ms | yes | Time for gate to fully open |
| hold | float32 | 0.0 to 500.0 | 50.0 | ms | yes | Time gate stays open after signal drops below threshold |
| release | float32 | 1.0 to 2000.0 | 100.0 | ms | yes | Time for gate to fully close |
| floor | float32 | -72.0 to 0.0 | -72.0 | dB | yes | Minimum gain when gate is closed (-72dB ≈ silence, 0dB = no attenuation) |
| inverse | boolean | - | false | - | yes | Invert gate: pass signal BELOW threshold, attenuate above (ducking mode) |
| side-chain | pointer | - | (none) | - | - | External side-chain input (Pointers.SideChain) |

**Adapter Value Mappings:**

| Parameter | Mapping | Notes |
|-----------|---------|-------|
| threshold | `linear(-80, 0)` | Adapter range wider than box constraint |
| return | `linear(0, 24)` | |
| attack | `linear(0, 50)` | |
| hold | `linear(0, 500)` | |
| release | `linear(1, 2000)` | |
| floor | `decibel(-72, -12, 0)` | 3-point: unitValue 0.0=-inf, 0.5=-12dB, 1.0=0dB |

**How Gating Works:**
1. Level detection uses peak-hold with exponential decay (10ms time constant) on the side-chain signal (or input if no side-chain)
2. Gate opens when level >= threshold
3. Hold phase keeps gate open for `hold` ms after signal drops
4. Gate closes when level < `threshold - return` (hysteresis prevents chattering)
5. Envelope smoothing: attack/release are first-order IIR filters
6. Output gain = `floor + (1 - floor) * envelope`

**Inverse Mode:** Swaps open/closed logic — passes signal when level is BELOW threshold, attenuates when ABOVE. Useful for ducking (e.g., duck music when voice is present).

**Side-Chain:** When connected, uses the external signal for level detection while gating the main input.

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/GateDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/GateDeviceBoxAdapter.ts`
- Processor: `/openDAW/packages/studio/core-processors/src/devices/audio-effects/GateDeviceProcessor.ts`

---

### Reverb (Free Reverb)

**Purpose:** Simulates acoustic spaces by creating reflections and decay. Display name changed from "Cheap Reverb" to "Free Reverb" in SDK 0.0.129.

**Factory Reference:** `EffectFactories.AudioNamed.Reverb`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| decay | float32 | 0.0 to 1.0 | 0.5 | % | yes | Room size / reverb decay time |
| preDelay | float32 | 0.001 to 0.5 | 0.0 | s | yes | Time before first reflection |
| damp | float32 | 0.0 to 1.0 | 0.5 | % | yes | Damping of high frequencies |
| filter | float32 | -1.0 to 1.0 | 0.0 | % | yes | Additional filtering |
| dry | float32 | -60.0 to 6.0 | 0.0 | dB | yes | Dry signal level |
| wet | float32 | -60.0 to 6.0 | -3.0 | dB | yes | Wet signal level |

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/ReverbDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/ReverbDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/ReverbDeviceEditor.tsx`

---

### Revamp (Parametric EQ)

**Purpose:** Shapes frequency balance with multiple filter types and curves.

**Factory Reference:** `EffectFactories.AudioNamed.Revamp`

**Filter Sections:**

#### High-Pass Filter
- **enabled** (boolean)
- **frequency** (float32): 0.0 to ∞
- **order** (int32): 1-4 (filter steepness)
- **q** (float32): Resonance

#### Low Shelf
- **enabled** (boolean)
- **frequency** (float32): Low shelf center frequency
- **gain** (float32): Boost/cut amount

#### Low Bell (Peaking EQ)
- **enabled** (boolean)
- **frequency** (float32): Center frequency
- **gain** (float32): Boost/cut amount
- **q** (float32): Bandwidth

#### Mid Bell (Peaking EQ)
- **enabled** (boolean)
- **frequency** (float32): Center frequency
- **gain** (float32): Boost/cut amount
- **q** (float32): Bandwidth

#### High Bell (Peaking EQ)
- **enabled** (boolean)
- **frequency** (float32): Center frequency
- **gain** (float32): Boost/cut amount
- **q** (float32): Bandwidth

#### High Shelf
- **enabled** (boolean)
- **frequency** (float32): High shelf center frequency
- **gain** (float32): Boost/cut amount

#### Low-Pass Filter
- **enabled** (boolean)
- **frequency** (float32): 0.0 to ∞
- **order** (int32): 1-4 (filter steepness)
- **q** (float32): Resonance

#### Global
- ~~**gain** (float32): Output level adjustment (-18 to 18 dB)~~ — removed (deprecated in schema)

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/RevampDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/RevampDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/RevampDeviceEditor.tsx`

---

### Crusher

**Purpose:** Reduces bit depth and resolution for degradation/distortion effects.

**Factory Reference:** `EffectFactories.AudioNamed.Crusher`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| crush | float32 | 0.0 to 1.0 | 0.0 | unipolar | yes | Sample rate reduction (0=clean, 1=max crush) |
| bits | int32 | 1 to 16 | 16 | bits | yes | Target bit depth for reduction |
| boost | float32 | 0.0 to 24.0 | 0.0 | dB | yes | Pre-emphasis gain before quantization |
| mix | float32 | 0.0 to 1.0 | 1.0 | % | yes | Dry/Wet mix (adapter uses exponential mapping) |

**Important — Crush inversion:** The processor inverts the crush value internally (`setCrush(1.0 - value)`) before applying exponential mapping to compute the crushed sample rate: `exponential(20, 20000, invertedValue)`. This means small box values produce subtle effects and large values produce extreme crushing:

| Box value | Effective crushed SR | Character |
|-----------|---------------------|-----------|
| 0.0 | 20,000 Hz | Clean (no crushing) |
| 0.05 | ~14,000 Hz | Very subtle warmth |
| 0.15 | ~8,000 Hz | Retro, lo-fi character |
| 0.25 | ~3,500 Hz | AM radio / telephone |
| 0.35 | ~2,000 Hz | Heavy lo-fi |
| 0.55 | ~500 Hz | Glitchy artifacts |
| 0.65 | ~200 Hz | Extreme destruction |
| 1.0 | 20 Hz | Inaudible |

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/CrusherDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/CrusherDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/CrusherDeviceEditor.tsx`

---

### Fold

**Purpose:** Waveshaping effect that folds signals back into audio range when overdriven.

**Factory Reference:** `EffectFactories.AudioNamed.Fold`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| drive | float32 | 0.0 to 30.0 | 0.0 | dB | yes | Input drive amount |
| overSampling | int32 | - | 0 | - | **no** | Oversampling factor for quality (not automatable) |
| volume | float32 | -18.0 to 0.0 | 0.0 | dB | yes | Output volume compensation |

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/FoldDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/FoldDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/FoldDeviceEditor.tsx`

---

### Waveshaper

**Purpose:** Applies nonlinear waveshaping distortion with selectable transfer functions.

**Factory Reference:** `EffectFactories.AudioNamed.Waveshaper`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| equation | string | see table | "hardclip" | - | no | Waveshaping transfer function (set via dropdown, not automatable) |
| inputGain | float32 | 0.0 to 40.0 | 0.0 | dB | yes | Drive — boosts signal BEFORE waveshaping |
| outputGain | float32 | -24.0 to 24.0 | 0.0 | dB | yes | Level compensation AFTER waveshaping |
| mix | float32 | 0.0 to 1.0 | 1.0 | % | yes | Dry/Wet mix |

**Signal chain:** Input → inputGain (drive) → waveshaping equation → outputGain × wet + input × dry

**Available Equations:**

| Equation | Formula | Character |
|----------|---------|-----------|
| `"hardclip"` | `clamp(x, -1, 1)` | Harsh digital clipping |
| `"cubicSoft"` | `(3x - x³) × 0.5` (clamped) | Warm soft clipping, odd harmonics |
| `"tanh"` | `tanh(x)` | Classic smooth saturation |
| `"sigmoid"` | `sign(x) × (1 - e^(-|x|))` | Exponential saturation |
| `"arctan"` | `(2/π) × atan(x)` | Gentlest symmetric saturation |
| `"asymmetric"` | Piecewise: soft sat (x≥0), linear (-⅔≤x<0), cubic (-1≤x<-⅔), clip (x<-1) | Tube-like, even harmonics from asymmetry |

**Input-gain vs Output-gain:** Input-gain controls distortion amount (0-40dB boost only, drives signal harder into the waveshaper). Output-gain compensates for volume changes after shaping (-24 to +24dB). Output-gain scales only the wet (shaped) signal in the mix.

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/WaveshaperDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/WaveshaperDeviceBoxAdapter.ts`
- Processor: `/openDAW/packages/studio/core-processors/src/devices/audio-effects/WaveshaperDeviceProcessor.ts`

---

### Stereo Tool

**Purpose:** Manipulates stereo imaging, panning, and phase relationships.

**Factory Reference:** `EffectFactories.AudioNamed.StereoTool`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| volume | float32 | -72.0 to 12.0 | (default) | dB | yes | Master volume level (decibel mapping) |
| panning | float32 | -1.0 to 1.0 | 0.0 | bipolar | yes | Left/right panning (-1=left, 1=right) |
| stereo | float32 | -1.0 to 1.0 | 0.0 | bipolar | yes | Stereo width (-1=mono, 0=normal, 1=max wide) |
| invertL | boolean | - | false | - | yes | Invert left channel phase |
| invertR | boolean | - | false | - | yes | Invert right channel phase |
| swap | boolean | - | false | - | yes | Swap left and right channels |
| panningMixing | int32 | - | EqualPower | enum | yes | Panning algorithm (EqualPower mode) |

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/StereoToolDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/StereoToolDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/StereoToolDeviceEditor.tsx`

---

### Dattorro Reverb

**Purpose:** High-quality algorithmic reverb based on the Dattorro plate reverb algorithm with modulation.

**Factory Reference:** `EffectFactories.AudioNamed.DattorroReverb`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| preDelay | float32 | 0.0 to 1000.0 | 0.0 | ms | yes | Time before first reflection (NOTE: milliseconds, not seconds) |
| bandwidth | float32 | 0.0 to 1.0 | 0.9999 | % | yes | Input bandwidth filter |
| inputDiffusion1 | float32 | 0.0 to 1.0 | 0.75 | % | yes | First input diffusion stage |
| inputDiffusion2 | float32 | 0.0 to 1.0 | 0.625 | % | yes | Second input diffusion stage |
| decay | float32 | 0.0 to 1.0 | 0.75 | % | yes | Reverb decay time |
| decayDiffusion1 | float32 | 0.0 to 1.0 | 0.7 | % | yes | First decay diffusion stage |
| decayDiffusion2 | float32 | 0.0 to 1.0 | 0.5 | % | yes | Second decay diffusion stage |
| damping | float32 | 0.0 to 1.0 | 0.005 | % | yes | High frequency damping (inverted internally: dp = 1.0 - damping) |
| excursionRate | float32 | 0.0 to 1.0 | 0.5 | % | yes | Modulation LFO rate (scaled ×2 internally) |
| excursionDepth | float32 | 0.0 to 1.0 | 0.7 | % | yes | Modulation depth (scaled ×2 internally) |
| wet | float32 | -60.0 to 0.0 | -6.0 | dB | yes | Wet signal level (additionally scaled ×0.6 in DSP) |
| dry | float32 | -60.0 to 6.0 | 0.0 | dB | yes | Dry signal level |

---

### Tidal (LFO Modulator)

**Purpose:** Low-frequency oscillator for amplitude modulation, tremolo, and auto-pan effects.

**Factory Reference:** `EffectFactories.AudioNamed.Tidal`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| slope | float32 | -1.0 to 1.0 | 0.0 | bipolar | yes | Waveform slope (-1=ramp down, 0=triangle/sine, 1=square) |
| symmetry | float32 | 0.0 to 1.0 | 0.5 | % | yes | Waveform symmetry (0.5=symmetric) |
| rate | int32 | 0 to 16 | 3 | index | yes | Rate fraction index into RateFractions array (see table below) |
| depth | float32 | 0.0 to 1.0 | 0.5 | % | yes | Modulation depth |
| offset | float32 | -180.0 to 180.0 | 0.0 | degrees | yes | Phase offset |
| channelOffset | float32 | -180.0 to 180.0 | 0.0 | degrees | yes | Stereo phase offset for auto-pan |

**Rate Fraction Index Mapping:**

| Index | Fraction | Index | Fraction |
|-------|----------|-------|----------|
| 0 | 1/1 (whole) | 9 | 1/16 |
| 1 | 1/2 (half) | 10 | 3/64 |
| 2 | 1/3 (triplet) | 11 | 1/24 |
| 3 | 1/4 (quarter) | 12 | 1/32 |
| 4 | 3/16 (dotted eighth) | 13 | 1/48 |
| 5 | 1/6 | 14 | 1/64 |
| 6 | 1/8 (eighth) | 15 | 1/96 |
| 7 | 3/32 | 16 | 1/128 |
| 8 | 1/12 | | |

**Important:** The `rate` parameter is an integer index into the `RateFractions` array — NOT a frequency in Hz. The processor reads it with `RateFractions[this.#pRate.getValue()]`. Setting rate to 3 selects the 1/4 note fraction. Note: This is a different array from the Delay `Fractions` (17 entries, largest-to-smallest vs 21 entries, smallest-to-largest).

---

### Maximizer (Limiter)

**Purpose:** Brick-wall limiter for loudness maximization and peak control.

**Factory Reference:** `EffectFactories.AudioNamed.Maximizer`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| threshold | float32 | -30.0 to 0.0 | 0.0 | dB | yes | Limiting threshold |
| lookahead | boolean | - | true | - | **no** | Enable lookahead for transparent limiting (not automatable) |

---

### Effect Type Reference in Code

All available audio effects can be accessed via:

```typescript
import { EffectFactories } from "@opendaw/studio-core";

// Audio effects (alphabetical order in AudioNamed)
EffectFactories.AudioNamed.Compressor
EffectFactories.AudioNamed.Crusher
EffectFactories.AudioNamed.DattorroReverb
EffectFactories.AudioNamed.Delay
EffectFactories.AudioNamed.Fold
EffectFactories.AudioNamed.Gate
EffectFactories.AudioNamed.Maximizer
EffectFactories.AudioNamed.NeuralAmp    // display name: "Tone3000"
EffectFactories.AudioNamed.Revamp
EffectFactories.AudioNamed.Reverb       // display name: "Free Reverb"
EffectFactories.AudioNamed.StereoTool
EffectFactories.AudioNamed.Tidal
EffectFactories.AudioNamed.Waveshaper
EffectFactories.AudioNamed.Werkstatt    // scriptable audio effect

// As list
EffectFactories.AudioList // Array of all audio effects
```

**Note:** `Modular` is a standalone factory (`EffectFactories.Modular`) but is NOT included in `AudioNamed` or `AudioList`. Tone3000 (`NeuralAmp`) is the only effect with `external: true` (see [Tone3000](#tone3000)). Werkstatt is a scriptable effect (see [Werkstatt](#werkstatt)).

### Common Parameter Patterns

#### Dry/Wet Mix
Most effects include `dry` and `wet` parameters for blend control:
- **dry**: -60 to 6 dB
- **wet**: -60 to 6 dB
- Set `wet` lower than `dry` for subtle effect
- Set `wet` higher for pronounced effect

#### Filter Parameters
Effects with filtering support these common patterns:
- **frequency**: Center or cutoff frequency
- **q**: Quality factor / resonance (higher = narrower)
- **order**: Filter slope (higher = steeper)

#### Time-Based Parameters
Delay and Reverb use:
- **Milliseconds** for delay time: 0.001 to 0.5 seconds (Reverb) or 0-1000ms (Delay, DattorroReverb)
- **Fractions** for tempo-synced delays: 1/1, 1/2, 1/4, etc. (index into Fractions array)
- **Percentages** for decay/decay time: 0-100%

#### Side-Chain
Compressor and Gate support external side-chain inputs via `Pointers.SideChain` pointer fields. The side-chain signal is used for detection only — the main input is what gets processed.

---

## Creating and Adding Effects

Effects are created through the **EffectFactory** pattern, which provides:
1. Standardized creation process
2. Default parameters and naming
3. Box Graph integration
4. Optional initialization hooks

### Factory Pattern

#### EffectFactory Interface

```typescript
interface EffectFactory {
    readonly defaultName: string
    readonly defaultIcon: IconSymbol
    readonly description: string
    readonly briefDescription: string   // SDK 0.0.129+
    readonly manualPage?: string
    readonly separatorBefore: boolean
    readonly external: boolean           // SDK 0.0.129+
    readonly type: "audio" | "midi"

    create(project: Project, unit: Field<EffectPointerType>, index: int): EffectBox
}
```

#### Accessing Effect Factories

```typescript
import { EffectFactories } from "@opendaw/studio-core";

// Get a specific effect factory
const compressorFactory = EffectFactories.AudioNamed.Compressor;
const delayFactory = EffectFactories.AudioNamed.Delay;
const reverbFactory = EffectFactories.AudioNamed.Reverb;

// Get all audio effects as array
const allAudioEffects = EffectFactories.AudioList;

// Get all MIDI effects as array
const allMidiEffects = EffectFactories.MidiList;

// Access by key
const effectsByName = EffectFactories.MergedNamed;
```

### Creating Effects

#### Method 1: Using ProjectApi.insertEffect()

The recommended approach using the ProjectAPI:

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";

// Assuming you have a project and audioUnitBox
const project: Project = /* ... */;
const audioUnitBox = /* ... */;

// Add an effect to the audio unit's effect chain
project.editing.modify(() => {
    const effectBox = project.api.insertEffect(
        audioUnitBox.audioEffects,  // Field<EffectPointerType>
        EffectFactories.AudioNamed.Delay,
        0  // Insert at beginning (optional, defaults to end)
    );
    
    // Access the effect box if needed
    console.log("Created effect:", effectBox);
});
```

#### Method 2: Direct Factory Call

For more control over parameters during creation:

```typescript
const factory = EffectFactories.AudioNamed.Compressor;

project.editing.modify(() => {
    const effectBox = factory.create(project, audioUnitBox.audioEffects, 0);
    
    // Customize after creation
    effectBox.label.setValue("My Compressor");
    effectBox.threshold.setValue(-15.0);
    effectBox.ratio.setValue(4.0);
});
```

### Effect Box Creation Process

When `factory.create()` is called, the following happens:

1. **Box Creation** - Factory creates a new effect box
2. **Box Wiring** - Box is connected to the Box Graph
3. **Default Values** - Parameters are set to factory defaults
4. **Host Reference** - Effect is linked to its device host
5. **Index Assignment** - Effect is assigned position in chain

#### Example Factory Implementation (Delay)

```typescript
export const Delay: EffectFactory = {
    defaultName: "Delay",
    defaultIcon: IconSymbol.Time,
    description: "Echoes the input signal with time-based repeats",
    separatorBefore: false,
    type: "audio",
    create: ({boxGraph}, unit, index): DelayDeviceBox =>
        DelayDeviceBox.create(boxGraph, UUID.generate(), box => {
            box.label.setValue("Delay")
            box.index.setValue(index)
            box.host.refer(unit)
        })
}
```

### Parameter Initialization

Some effects have specialized default initialization:

```typescript
import { EffectParameterDefaults } from "@opendaw/studio-core";

project.editing.modify(() => {
    const revampBox = factory.create(project, audioUnitBox.audioEffects, 0);
    
    // Apply professional default EQ curve
    EffectParameterDefaults.defaultRevampDeviceBox(revampBox);
});
```

#### Manual Parameter Setting

```typescript
project.editing.modify(() => {
    const compressorBox = EffectFactories.AudioNamed.Compressor
        .create(project, audioUnitBox.audioEffects, 0);
    
    // Customize parameters
    compressorBox.threshold.setInitValue(-20.0);
    compressorBox.ratio.setInitValue(4.0);
    compressorBox.attack.setInitValue(10.0);
    compressorBox.release.setInitValue(100.0);
    compressorBox.makeup.setInitValue(12.0);
});
```

### Effect Box Types

Each effect type has its own Box class:

```typescript
// All importable from @opendaw/studio-boxes
import {
    CompressorDeviceBox,
    DelayDeviceBox,
    ReverbDeviceBox,
    RevampDeviceBox,
    CrusherDeviceBox,
    FoldDeviceBox,
    StereoToolDeviceBox,
    ModularDeviceBox
} from "@opendaw/studio-boxes";
```

Each box contains:
- **Common Fields** (on all devices)
  - `label` (StringField) - Display name
  - `index` (Int32Field) - Position in chain
  - `enabled` (BooleanField) - Active/bypass state
  - `minimized` (BooleanField) - UI collapsed state
  - `host` (PointerField) - Reference to device host

- **Effect-Specific Fields**
  - Named parameters specific to the effect
  - Float32, Int32, Boolean, or nested Object fields
  - Default values defined in box schema

### Complete Example: Creating an Effect Chain

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-core";

async function createInstrumentWithEffects(project: Project) {
    project.editing.modify(() => {
        // Create instrument
        const { audioUnitBox } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        
        // Add reverb (3rd position)
        const reverb = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Reverb,
            2
        );
        reverb.wet.setValue(-3.0);  // Subtle wet signal
        
        // Add delay (2nd position)
        const delay = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Delay,
            1
        );
        delay.wet.setValue(-12.0);
        delay.feedback.setValue(0.4);
        
        // Add compressor (1st position)
        const compressor = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            0
        );
        compressor.threshold.setValue(-15.0);
        compressor.ratio.setValue(4.0);
        
        // Chain order: Compressor -> Delay -> Reverb -> Output
    });
}
```

---

## Track Integration

In OpenDAW, effects are added to tracks by attaching them to the track's **AudioUnitBox**. Each AudioUnit has an `audioEffects` field that stores the chain of audio effects.

### Track Structure

When you create a track with an instrument, you get:

```typescript
type InstrumentProduct = {
    audioUnitBox: AudioUnitBox;  // The audio unit (contains effect chain)
    instrumentBox: any;           // The instrument (Tape, Soundfont, etc.)
    trackBox: TrackBox;           // The UI track representation
};
```

The **AudioUnitBox** is where effects are added.

### Basic Example

```typescript
import { Project, EffectFactories, InstrumentFactories } from "@opendaw/studio-core";

const project = /* ... */;

project.editing.modify(() => {
    // Create a track with an instrument
    const { audioUnitBox, trackBox } = project.api.createInstrument(
        InstrumentFactories.Tape
    );
    
    // Add a reverb effect to the track
    const reverb = project.api.insertEffect(
        audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Reverb
    );

    // The effect is now in the track's effect chain
});
```

### Effect Chain Ordering

Effects are processed in index order, from 0 to N. You can control insertion position:

```typescript
project.editing.modify(() => {
    // Add effects in specific order
    const compressor = project.api.insertEffect(
        audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Compressor,
        0  // First position
    );

    const delay = project.api.insertEffect(
        audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Delay,
        1  // Second position
    );

    const reverb = project.api.insertEffect(
        audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Reverb,
        2  // Third position
    );

    // Chain order: Compressor -> Delay -> Reverb -> Output
});
```

### Accessing Track Effects

```typescript
// Get the adapter for the audio unit
const audioUnitAdapter = project.boxAdapters.adapterFor(
    audioUnitBox,
    AudioUnitBoxAdapter
);

// Get all audio effect adapters
const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);

effectAdapters.forEach(effectAdapter => {
    console.log("Effect:", effectAdapter.labelField.getValue());
    console.log("Type:", effectAdapter.type);
    console.log("Enabled:", effectAdapter.enabledField.getValue());
});
```

### Modifying Track Effects

```typescript
project.editing.modify(() => {
    // Enable/Disable effects
    reverb.enabled.setValue(false);  // bypass
    reverb.enabled.setValue(true);   // re-enable
    
    // Rename effects
    reverb.label.setValue("Plate Reverb");
    
    // Reorder effects (change indices)
    compressor.index.setValue(1);  // Move to second position
    delay.index.setValue(0);       // Move to first position
});
```

### Observable Pattern for Track Effects

```typescript
const { audioUnitBox } = /* ... */;

// Subscribe to effect chain changes
const subscription = project.boxAdapters.audioEffects(audioUnitBox)
    .catchupAndSubscribe({
        onAdd: (effectAdapter) => {
            console.log("Effect added:", effectAdapter.labelField.getValue());
        },
        onRemove: (effectAdapter) => {
            console.log("Effect removed:", effectAdapter.labelField.getValue());
        },
        onReorder: (effectAdapter) => {
            console.log("Effect reordered:", effectAdapter.labelField.getValue());
        }
    });

// Later, cleanup
subscription.terminate();
```

### Effect Chain Signal Flow

```
Audio Input from Instrument
         ↓
Compressor (enabled? no → bypass)
         ↓
Delay (enabled? no → bypass)
         ↓
Reverb (enabled? no → bypass)
         ↓
Volume control (audioUnitBox.volume)
         ↓
Mute check (audioUnitBox.mute)
         ↓
Solo check (audioUnitBox.solo)
         ↓
Audio Output
```

### Removing Effects

```typescript
project.editing.modify(() => {
    // Remove effect by setting enabled to false (soft remove/bypass)
    effectBox.enabled.setValue(false);

    // Or actually remove from chain (hard remove)
    effectBox.delete();
});
```

---

## Master Bus Integration

Master effects are global effects applied to the entire mix after all tracks have been combined. In OpenDAW, these are added to the root audio bus or master channel.

### Master Bus Structure

The master bus is accessed through the root box's output device:

```typescript
// Access the root box
const rootBox = project.rootBox;

// The master audio unit is the first AudioUnitBox connected to the output device
const masterAudioUnit = rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

if (!masterAudioUnit) {
    console.error("Could not find master audio unit");
}
```

### Adding Effects to Master

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";

project.editing.modify(() => {
    const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

    if (!masterAudioUnit) {
        console.error("Could not find master audio unit");
        return;
    }

    // Add a reverb effect to the master
    const masterReverb = project.api.insertEffect(
        masterAudioUnit.audioEffects,  // Master effect chain
        EffectFactories.AudioNamed.Reverb
    );

    masterReverb.label.setValue("Master Reverb");
    masterReverb.wet.setValue(-12.0);  // Subtle master reverb
});
```

### Master Volume Control

```typescript
project.editing.modify(() => {
    const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

    // Set master volume
    masterAudioUnit.volume.setValue(-3.0);  // -3dB

    // Mute master (mutes entire mix)
    masterAudioUnit.mute.setValue(true);
});
```

### Complete Master Bus Example

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";

async function setupMasterBus(project: Project) {
    project.editing.modify(() => {
        const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

        if (!masterAudioUnit) {
            console.error("Could not find master audio unit");
            return;
        }

        // Set overall master volume
        masterAudioUnit.volume.setValue(-6.0);

        // 1. Parametric EQ for tone shaping
        const eq = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.Revamp,
            0
        );
        eq.label.setValue("Master EQ");

        // 2. Compressor for glue
        const compressor = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            1
        );
        compressor.label.setValue("Master Glue");
        compressor.threshold.setValue(-12.0);
        compressor.ratio.setValue(2.0);
        compressor.attack.setValue(20.0);
        compressor.release.setValue(200.0);
        compressor.makeup.setValue(2.0);

        // 3. Limiter for peak protection
        const limiter = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            2
        );
        limiter.label.setValue("Master Limiter");
        limiter.threshold.setValue(-1.0);  // Just below 0dB
        limiter.ratio.setValue(20.0);      // Hard limiting
        limiter.attack.setValue(1.0);      // Fast attack
        limiter.release.setValue(100.0);

        // 4. Stereo enhancement
        const stereoTool = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.StereoTool,
            3
        );
        stereoTool.label.setValue("Master Stereo");
    });
}
```

### Common Master Effect Settings

#### Safety Limiter
```typescript
limiter.threshold.setValue(-0.5);  // Just below maximum
limiter.ratio.setValue(20.0);      // Hard limiting
limiter.attack.setValue(0.5);      // Very fast
limiter.release.setValue(100.0);   // Natural release
```

#### Glue Compressor
```typescript
compressor.threshold.setValue(-12.0);  // Moderate threshold
compressor.ratio.setValue(2.0);        // Subtle compression
compressor.attack.setValue(30.0);      // Musical attack
compressor.release.setValue(300.0);    // Slow release
```

#### Room Reverb
```typescript
reverb.wet.setValue(-12.0);   // Subtle blend
reverb.decay.setValue(0.5);   // Medium room
reverb.damp.setValue(0.5);    // Natural damping
```

### Master Bus Signal Flow

```
All Track Outputs (summed)
         ↓
Master EQ
         ↓
Master Compressor
         ↓
Master Limiter
         ↓
Master Volume Control
         ↓
Master Mute Check
         ↓
Audio Interface Output
```

---

## UI Controls

OpenDAW effects use a reactive UI pattern where:
1. **Device Adapters** wrap effect boxes with observable properties
2. **Device Editors** render React components for the UI
3. **Parameter Controls** provide interactive knobs, sliders, and buttons
4. **Control Builders** create standardized UI components

### Device Adapter Pattern

A Device Adapter wraps an effect box with reactive properties:

```typescript
// Example: CompressorDeviceBoxAdapter
class CompressorDeviceBoxAdapter implements AudioEffectDeviceAdapter {
    readonly type = "audio-effect"
    readonly accepts = "audio"
    
    get box(): CompressorDeviceBox { /* ... */ }
    get uuid(): UUID.Bytes { /* ... */ }
    get address(): Address { /* ... */ }
    get indexField(): Int32Field { /* ... */ }
    get labelField(): StringField { /* ... */ }
    get enabledField(): BooleanField { /* ... */ }
    get minimizedField(): BooleanField { /* ... */ }
    
    readonly namedParameter // Typed parameter object
}
```

Each adapter provides typed parameters:

```typescript
// CompressorDeviceBoxAdapter.namedParameter
{
    lookahead: ParameterAdapter<boolean>,
    automakeup: ParameterAdapter<boolean>,
    autoattack: ParameterAdapter<boolean>,
    autorelease: ParameterAdapter<boolean>,
    inputgain: ParameterAdapter<number>,
    threshold: ParameterAdapter<number>,
    ratio: ParameterAdapter<number>,
    knee: ParameterAdapter<number>,
    attack: ParameterAdapter<number>,
    release: ParameterAdapter<number>,
    makeup: ParameterAdapter<number>,
    mix: ParameterAdapter<number>
}
```

### Parameter Control Components

#### ControlBuilder - Knob Component

```typescript
import { ControlBuilder } from "@/ui/devices/ControlBuilder.tsx";
import { SnapCommonDecibel } from "@/ui/configs.ts";

{ControlBuilder.createKnob({
    lifecycle,
    editing,
    midiLearning: midiLearning,
    adapter,
    parameter: delay,
    options: SnapCommonDecibel  // Optional snap points
})}
```

#### ParameterToggleButton - Boolean Controls

```typescript
import { ParameterToggleButton } from "@/ui/devices/ParameterToggleButton";

{[automakeup, autoattack, autorelease, lookahead]
    .map((parameter) => (
        <ParameterToggleButton
            lifecycle={lifecycle}
            editing={editing}
            parameter={parameter}
        />
    ))
}
```

### Control Builder API

#### createKnob()

```typescript
ControlBuilder.createKnob({
    lifecycle: Lifecycle,        // Required: lifecycle management
    editing: Editing,            // Required: transaction management
    midiLearning: MidiLearning,  // Required: MIDI learning context
    adapter: DeviceAdapter,      // Required: device adapter
    parameter: ParameterAdapter, // Required: the parameter
    options?: SnapArray,         // Optional: snap points
    anchor?: number              // Optional: center value (0-1)
})
```

#### Common Snap Options

```typescript
import { SnapCommonDecibel } from "@/ui/configs.ts";

// Decibel values: -60, -48, -36, -24, -12, -6, 0, +6
SnapCommonDecibel

// Custom snap array
[0, 0.25, 0.5, 0.75, 1.0]

// No snapping
undefined
```

### Parameter Value Mapping

```typescript
// From CompressorDeviceBoxAdapter
threshold: this.#parametric.createParameter(
    box.threshold,
    ValueMapping.linear(-60.0, 0.0),      // Storage range
    StringMapping.decible,                 // Display format
    "Threshold"
)

// From DelayDeviceBoxAdapter
delay: this.#parametric.createParameter(
    box.delay,
    ValueMapping.linearInteger(0, 16),    // Storage as integer index
    DelayDeviceBoxAdapter.OffsetStringMapping,  // Display as fraction
    "delay"
)
```

#### Common Value Mappings

```typescript
ValueMapping.linear(min, max)          // Linear scaling
ValueMapping.linearInteger(min, max)   // Integer linear
ValueMapping.exponential(min, max)     // Exponential (for frequency)
ValueMapping.unipolar()                // 0 to 1
ValueMapping.bipolar()                 // -1 to 1
ValueMapping.DefaultDecibel            // Decibel scaling
```

#### Common String Mappings

```typescript
StringMapping.decible                  // "dB" suffix
StringMapping.percent()                // "%" suffix
StringMapping.numeric({               // Custom formatting
    unit: "ms",
    fractionDigits: 1,
    unitPrefix: true  // μ, m, k prefixes
})
StringMapping.indices(                 // Indexed values
    "",
    ["1/1", "1/2", "1/4", "1/8", ...]
)
```

### Real-Time Metering

```typescript
import { DevicePeakMeter } from "@/ui/devices/panel/DevicePeakMeter.tsx";

<DevicePeakMeter
    lifecycle={lifecycle}
    receiver={project.liveStreamReceiver}
    address={adapter.address}
/>
```

---

## Code Examples

### Example 1: Simple Single Effect on a Track

```typescript
import { Project, EffectFactories } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";

async function addReverbToTrack(project: Project) {
    project.editing.modify(() => {
        // Create a track with an instrument
        const { audioUnitBox } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        
        // Add reverb to the track
        const reverb = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Reverb
        );

        // Customize the reverb
        reverb.label.setValue("Room Reverb");
        reverb.wet.setValue(-6.0);  // Subtle effect
        reverb.decay.setValue(0.5);
    });
}
```

### Example 2: Effect Chain on Single Track

```typescript
async function createTrackWithEffectChain(project: Project) {
    project.editing.modify(() => {
        const { audioUnitBox } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        
        const compressor = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            0
        );
        compressor.label.setValue("Compressor");
        compressor.threshold.setValue(-15.0);
        compressor.ratio.setValue(4.0);

        const delay = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Delay,
            1
        );
        delay.label.setValue("Delay");
        delay.wet.setValue(-12.0);
        delay.feedback.setValue(0.4);

        const reverb = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Reverb,
            2
        );
        reverb.label.setValue("Reverb");
        reverb.wet.setValue(-6.0);
        
        console.log("Effect chain created: Compressor -> Delay -> Reverb");
    });
}
```

### Example 3: Master Bus Effects

```typescript
async function setupMasterEffects(project: Project) {
    project.editing.modify(() => {
        const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

        if (!masterAudioUnit) {
            console.error("Could not find master audio unit");
            return;
        }

        masterAudioUnit.volume.setValue(-6.0);

        const eq = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.Revamp,
            0
        );
        eq.label.setValue("Master EQ");

        const compressor = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            1
        );
        compressor.label.setValue("Master Glue");
        compressor.threshold.setValue(-12.0);
        compressor.ratio.setValue(2.0);
        compressor.attack.setValue(20.0);
        compressor.release.setValue(200.0);

        const limiter = project.api.insertEffect(
            masterAudioUnit.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            2
        );
        limiter.label.setValue("Master Limiter");
        limiter.threshold.setValue(-0.5);
        limiter.ratio.setValue(20.0);
        limiter.attack.setValue(0.5);
    });
}
```

### Example 4: Multiple Tracks with Different Effects

```typescript
async function createMultiTrackSetup(project: Project) {
    project.editing.modify(() => {
        // Track 1: Drums with compression and reverb
        const { audioUnitBox: drumsUnit } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        drumsUnit.volume.setValue(-3.0);
        
        const drumsCompressor = project.api.insertEffect(
            drumsUnit.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            0
        );
        drumsCompressor.label.setValue("Drums Compressor");
        drumsCompressor.threshold.setValue(-20.0);
        drumsCompressor.ratio.setValue(6.0);

        const drumsReverb = project.api.insertEffect(
            drumsUnit.audioEffects,
            EffectFactories.AudioNamed.Reverb,
            1
        );
        drumsReverb.label.setValue("Drums Reverb");
        drumsReverb.wet.setValue(-12.0);

        // Track 2: Bass with compression only
        const { audioUnitBox: bassUnit } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        bassUnit.volume.setValue(-6.0);

        const bassCompressor = project.api.insertEffect(
            bassUnit.audioEffects,
            EffectFactories.AudioNamed.Compressor,
            0
        );
        bassCompressor.label.setValue("Bass Compressor");
        bassCompressor.threshold.setValue(-12.0);
        bassCompressor.ratio.setValue(4.0);

        // Track 3: Vocals with delay and reverb
        const { audioUnitBox: vocalsUnit } = project.api.createInstrument(
            InstrumentFactories.Tape
        );
        vocalsUnit.volume.setValue(-3.0);

        const vocalsDelay = project.api.insertEffect(
            vocalsUnit.audioEffects,
            EffectFactories.AudioNamed.Delay,
            0
        );
        vocalsDelay.label.setValue("Vocals Delay");
        vocalsDelay.wet.setValue(-18.0);
        vocalsDelay.feedback.setValue(0.3);

        const vocalsReverb = project.api.insertEffect(
            vocalsUnit.audioEffects,
            EffectFactories.AudioNamed.Reverb,
            1
        );
        vocalsReverb.label.setValue("Vocals Reverb");
        vocalsReverb.wet.setValue(-6.0);
        vocalsReverb.decay.setValue(0.7);
    });
}
```

### Example 5: Interactive Effect Control with Subscriptions

```typescript
async function createInteractiveEffects(
    project: Project,
    onEffectAdded?: (name: string) => void
) {
    let audioUnitBox: any = null;
    project.editing.modify(() => {
        const result = project.api.createInstrument(InstrumentFactories.Tape);
        audioUnitBox = result.audioUnitBox;
    });
    
    // Subscribe to effect chain changes
    const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
    const chainSubscription = effectAdapters.catchupAndSubscribe({
        onAdd: (effectAdapter) => {
            const effectName = effectAdapter.labelField.getValue();
            console.log("Effect added to track:", effectName);
            onEffectAdded?.(effectName);
            
            // Subscribe to this effect's enable state
            const enableSubscription = effectAdapter.enabledField.catchupAndSubscribe(obs => {
                console.log(`${effectName} ${obs.getValue() ? "enabled" : "disabled"}`);
            });
        },
        onRemove: (effectAdapter) => {
            console.log("Effect removed:", effectAdapter.labelField.getValue());
        }
    });
    
    // Add an effect
    project.editing.modify(() => {
        const delay = project.api.insertEffect(
            audioUnitBox.audioEffects,
            EffectFactories.AudioNamed.Delay
        );
        delay.label.setValue("Interactive Delay");
    });
    
    return {
        audioUnitBox,
        cleanup: () => chainSubscription.terminate()
    };
}
```

### Example 6: Dynamic Effect Creation

```typescript
async function addEffectByName(
    project: Project,
    audioUnitBox: any,
    effectType: string,
    position: number = -1
): Promise<boolean> {
    const factoryMap = {
        "compressor": EffectFactories.AudioNamed.Compressor,
        "delay": EffectFactories.AudioNamed.Delay,
        "reverb": EffectFactories.AudioNamed.Reverb,
        "eq": EffectFactories.AudioNamed.Revamp,
        "crusher": EffectFactories.AudioNamed.Crusher,
        "fold": EffectFactories.AudioNamed.Fold,
        "stereo": EffectFactories.AudioNamed.StereoTool
    };
    
    const factory = factoryMap[effectType.toLowerCase()];
    if (!factory) {
        console.error(`Unknown effect type: ${effectType}`);
        return false;
    }
    
    let success = false;
    project.editing.modify(() => {
        try {
            const effect = position >= 0
                ? project.api.insertEffect(audioUnitBox.audioEffects, factory, position)
                : project.api.insertEffect(audioUnitBox.audioEffects, factory);
            
            effect.label.setValue(`${factory.defaultName}`);
            success = true;
        } catch (error) {
            console.error(`Failed to add effect: ${error}`);
        }
    });
    
    return success;
}
```

### Example 7: Effect Chain Analysis

```typescript
function analyzeEffectChain(project: Project, audioUnitBox: any) {
    const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
    
    console.log("=== Effect Chain Analysis ===");
    console.log(`Total effects: ${effectAdapters.length}`);
    
    effectAdapters.forEach((adapter, index) => {
        const label = adapter.labelField.getValue();
        const enabled = adapter.enabledField.getValue();
        const type = adapter.type;
        
        console.log(`[${index}] ${label} (${type}) - ${enabled ? "ON" : "OFF"}`);
    });
}

function disableAllEffects(project: Project, audioUnitBox: any) {
    const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
    
    project.editing.modify(() => {
        effectAdapters.forEach(adapter => {
            adapter.enabledField.setValue(false);
        });
    });
}

function reorderEffectChain(
    project: Project,
    audioUnitBox: any,
    newOrder: number[]  // Array of current indices in new order
) {
    const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
    
    project.editing.modify(() => {
        newOrder.forEach((currentIndex, newIndex) => {
            const adapter = effectAdapters[currentIndex];
            adapter.indexField.setValue(newIndex);
        });
    });
}
```

### Common Patterns

#### Getting Current Parameter Value
```typescript
const compressor = /* ... */;
const currentThreshold = compressor.threshold.getValue();
```

#### Changing Parameter with Bound Checking
```typescript
project.editing.modify(() => {
    const min = -60.0, max = 0.0;
    const newValue = Math.max(min, Math.min(max, userValue));
    compressor.threshold.setValue(newValue);
});
```

#### Getting All Effects of Specific Type
```typescript
const effectAdapters = project.boxAdapters.audioEffects(audioUnitBox);
const compressors = effectAdapters.filter(
    a => a.box instanceof CompressorDeviceBox
);
```

### Best Practices

1. Always wrap changes in `project.editing.modify()` transaction
2. Use factory references instead of hardcoding effect creation
3. Subscribe to changes for real-time updates
4. Unsubscribe/terminate when done
5. Use adapter pattern for UI binding
6. Keep effect chain order logical (EQ -> Compression -> Reverb)
7. Test with actual audio for parameter ranges
8. Document custom effect presets

---

## Built-in Effect Reference

### Werkstatt

Werkstatt is a scriptable audio effect that lets users write custom DSP code in plain JavaScript. The code runs inside an AudioWorklet. Users define a `Processor` class with a `process()` method that receives stereo audio buffers and outputs processed audio sample by sample.

**WASM is not supported.** The SDK design doc states WASM compilation is a future possibility but is not implemented. Werkstatt is JavaScript only.

#### Factory Reference

```typescript
import { EffectFactories } from "@opendaw/studio-core";

const effectBox = project.api.insertEffect(audioUnitBox.audioEffects, EffectFactories.Werkstatt);
const werkstattBox = effectBox as WerkstattDeviceBox;
```

- `defaultName`: "Werkstatt"
- `defaultIcon`: `IconSymbol.Code`
- `briefDescription`: "Scriptable FX"
- `external`: false
- `type`: "audio"

#### Box Fields

| Field | Type | Description |
|-------|------|-------------|
| code | string | JavaScript source code (with compiled header prepended) |
| parameters | pointer collection | `WerkstattParameterBox` instances from `// @param` declarations |
| samples | pointer collection | `WerkstattSampleBox` instances from `// @sample` declarations |

Parameters are fully automatable (same automation system as built-in effects).

#### User Processor API

The user must define a `class Processor` with a `process(io, block)` method:

```javascript
class Processor {
    // REQUIRED: Called every audio block
    process({src, out}, {s0, s1}) {
        const [srcL, srcR] = src
        const [outL, outR] = out
        for (let i = s0; i < s1; i++) {
            outL[i] = srcL[i]
            outR[i] = srcR[i]
        }
    }

    // OPTIONAL: Called when a @param knob changes
    paramChanged(label, value) { }
}
```

**`io` Object:**

| Property | Type | Description |
|----------|------|-------------|
| `src` | `ReadonlyArray<Float32Array>` | `[leftInput, rightInput]` |
| `out` | `ReadonlyArray<Float32Array>` | `[leftOutput, rightOutput]` |

**`block` Object:**

| Property | Type | Description |
|----------|------|-------------|
| `s0` | number | First sample index (inclusive) |
| `s1` | number | Last sample index (exclusive) |
| `index` | number | Block counter |
| `bpm` | number | Current tempo |
| `p0` | number | Start position in PPQN (960 ppqn per quarter note) |
| `p1` | number | End position in PPQN |
| `flags` | number | Bitmask (see below) |

**`block.flags` Bitmask:**

| Bit | Value | Name | Description |
|-----|-------|------|-------------|
| 0 | 1 | transporting | Engine is running (play or record) |
| 1 | 2 | discontinuous | Position jumped (loop wrap, seek) — use to reset delay lines, filters |
| 2 | 4 | playing | Transport is actively playing audio |
| 3 | 8 | bpmChanged | Tempo changed this block — recalculate tempo-dependent values |

Check with bitwise AND: `if (block.flags & 4)` = "is playing". Generator scripts that produce audio (ignoring `src`) **must** check `!(block.flags & 4)` and silence the output, otherwise they produce continuous output after Stop.

**Output buffers are NOT zeroed between blocks.** The SDK reuses the same `out` buffer across calls. A bare `return` from `process()` leaves the previous block's samples in the buffer, producing a frozen/held signal instead of silence. Always zero the output explicitly:

```javascript
process({src, out}, block) {
    const [, ] = src
    const [outL, outR] = out
    if (!(block.flags & 4)) {
        for (let i = block.s0; i < block.s1; i++) { outL[i] = 0; outR[i] = 0 }
        return
    }
    // ... generate audio
}
```

**Globals Available:** `sampleRate` — the AudioContext sample rate

#### Parameter Declarations (`// @param`)

Declare parameters with comments at the top of the script. Each declaration creates an automatable knob on the device panel.

**Syntax:**
```
// @param <name> [default] [min max type [unit]]
```

**Forms:**

| Declaration | Result |
|---|---|
| `// @param gain` | Unipolar 0-1, default 0 |
| `// @param gain 0.5` | Unipolar 0-1, default 0.5 |
| `// @param gain 0.5 0 1 linear` | Linear 0-1, default 0.5 |
| `// @param time 500 1 2000` | Linear 1-2000, default 500 (auto-linear with 4 tokens) |
| `// @param cutoff 1000 20 20000 exp Hz` | Exponential 20-20000, default 1000, unit "Hz" |
| `// @param steps 4 1 16 int` | Integer 1-16, default 4 |
| `// @param bypass false` | Boolean, default Off |
| `// @param bypass true` | Boolean, default On |
| `// @param bypass bool` | Boolean, default Off |

**Mapping Types:**

| Type | `paramChanged` receives | UI Display |
|------|------------------------|------------|
| *(none/unipolar)* | 0.0-1.0 | percent |
| `linear` | min-max | 2 decimal places |
| `exp` | min-max | 2 decimal places |
| `int` | integer min-max | 0 decimal places |
| `bool` | 0 or 1 | "On"/"Off" |

#### Label Directive (`// @label`) (SDK 0.0.132+)

```
// @label My Custom Filter
```

Sets the device label automatically when the script is compiled. Parsed with `ScriptDeclaration.parseLabel(code): Option<string>`.

#### Parameter Groups (`// @group`) (SDK 0.0.132+)

Organize parameters into visual groups on the device panel with optional colors:

```javascript
// @group Envelope blue
// @param attack 10 1 1000 exp ms
// @param release 100 10 2000 exp ms

// @group Filter
// @param cutoff 1000 20 20000 exp Hz
// @param resonance 0.707 0.1 20 exp
```

Parsed with `ScriptDeclaration.parseGroups(code): ReadonlyArray<DeclarationSection>`.

#### Sample Declarations (`// @sample`)

```
// @sample <name>
```

Creates a file picker drop zone on the device panel. Note: sample data is **not yet wired** to the Werkstatt processor — `@sample` is more fully realized in the Apparat instrument where `this.samples.<name>` provides audio data.

#### Code Compilation (ScriptCompiler)

**CRITICAL:** `werkstattBox.code.setValue(script)` does NOT execute the script. You must use `ScriptCompiler.compile()`.

The compilation pipeline:
1. Parses `// @param` declarations from user code
2. Wraps user code into `globalThis.openDAW.werkstattProcessors[uuid]`
3. Registers via `audioContext.audioWorklet.addModule(blob)`
4. Writes back to `werkstattBox.code` with header: `// @werkstatt js 1 <update-number>\n`
5. The processor subscribes to `box.code`, parses the update number, and loads from the global registry

Without compilation, the processor sees `update === 0` and stays silent.

```typescript
import { ScriptCompiler } from "@opendaw/studio-adapters";

const compiler = ScriptCompiler.create({
    headerTag: "werkstatt",
    registryName: "werkstattProcessors",
    functionName: "werkstatt",
});

// 1. Insert effect inside editing.modify()
let werkstattBox: WerkstattDeviceBox;
project.editing.modify(() => {
    const effectBox = project.api.insertEffect(audioBox.audioEffects, EffectFactories.Werkstatt);
    werkstattBox = effectBox as WerkstattDeviceBox;
    werkstattBox.label.setValue("My Effect");
});

// 2. Compile OUTSIDE the transaction (async)
await compiler.compile(audioContext, project.editing, werkstattBox, userCode);

// 3. Parameters are now available
const paramPointers = werkstattBox.parameters.pointerHub.incoming();
```

Other compiler methods:
- `compiler.stripHeader(code)` — removes `// @werkstatt ...` header to recover user code
- `compiler.load(audioContext, deviceBox)` — reloads already-compiled code (e.g., on page load)

#### Accessing Parameters from Host Code

After `compile()`, the SDK creates `WerkstattParameterBox` instances for each `// @param` declaration:

```typescript
import { WerkstattParameterBox } from "@opendaw/studio-boxes";

const paramPointers = werkstattBox.parameters.pointerHub.incoming();
for (const pointer of paramPointers) {
    const paramBox = pointer.box as WerkstattParameterBox;
    const name = paramBox.label.getValue();        // "cutoff"
    const current = paramBox.value.getValue();      // 1000
    const def = paramBox.defaultValue.getValue();   // 1000

    // Update a parameter value
    project.editing.modify(() => {
        paramBox.value.setValue(500);
    });
    // The SDK automatically calls paramChanged("cutoff", 500) on the processor
}
```

`paramBox.value` is a `Float32Field` that supports `Pointers.Automation` and `Pointers.Modulation` — parameters are fully automatable just like built-in effect fields.

#### Safety Constraints

- Code runs in an AudioWorklet thread — no DOM, no fetch, no setTimeout, no imports
- Only `sampleRate` is available as a global
- Must only read/write sample indices from `s0` to `s1` (exclusive)
- **Never allocate memory inside `process()`** — no `new`, no array/object literals, no closures, no string concatenation (causes GC pauses)
- Output validated every block: NaN or amplitude > 1000 (~60dB) silences the processor

#### Examples

**Default — Simple Gain:**

```javascript
// @param gain 1.0

class Processor {
    gain = 1
    paramChanged(label, value) {
        if (label === "gain") this.gain = value
    }
    process({src, out}, {s0, s1}) {
        const [srcL, srcR] = src
        const [outL, outR] = out
        for (let i = s0; i < s1; i++) {
            outL[i] = srcL[i] * this.gain
            outR[i] = srcR[i] * this.gain
        }
    }
}
```

**Ring Modulator:**

```javascript
// @param frequency 440 20 20000 exp Hz
// @param mix 0.5

class Processor {
    frequency = 440
    mix = 0.5
    phase = 0

    paramChanged(label, value) {
        if (label === "frequency") this.frequency = value
        if (label === "mix") this.mix = value
    }

    process({src, out}, {s0, s1}) {
        const [srcL, srcR] = src
        const [outL, outR] = out
        const phaseInc = this.frequency / sampleRate
        for (let i = s0; i < s1; i++) {
            const mod = Math.sin(this.phase * 2 * Math.PI)
            this.phase = (this.phase + phaseInc) % 1.0
            const wet = this.mix
            const dry = 1 - wet
            outL[i] = srcL[i] * dry + srcL[i] * mod * wet
            outR[i] = srcR[i] * dry + srcR[i] * mod * wet
        }
    }
}
```

**Biquad Lowpass Filter:**

```javascript
// @param cutoff 1000 20 20000 exp Hz
// @param resonance 0.707 0.1 20 exp

class Processor {
    cutoff = 1000
    resonance = 0.707
    b0 = 0; b1 = 0; b2 = 0; a1 = 0; a2 = 0
    xL1 = 0; xL2 = 0; yL1 = 0; yL2 = 0
    xR1 = 0; xR2 = 0; yR1 = 0; yR2 = 0

    constructor() { this.recalc() }

    paramChanged(label, value) {
        if (label === "cutoff") this.cutoff = value
        if (label === "resonance") this.resonance = value
        this.recalc()
    }

    recalc() {
        const w0 = 2 * Math.PI * this.cutoff / sampleRate
        const alpha = Math.sin(w0) / (2 * this.resonance)
        const cosw0 = Math.cos(w0)
        const a0 = 1 + alpha
        this.b0 = ((1 - cosw0) / 2) / a0
        this.b1 = (1 - cosw0) / a0
        this.b2 = this.b0
        this.a1 = (-2 * cosw0) / a0
        this.a2 = (1 - alpha) / a0
    }

    process({src, out}, {s0, s1}) {
        const [srcL, srcR] = src
        const [outL, outR] = out
        for (let i = s0; i < s1; i++) {
            const xL = srcL[i]
            outL[i] = this.b0*xL + this.b1*this.xL1 + this.b2*this.xL2 - this.a1*this.yL1 - this.a2*this.yL2
            this.xL2 = this.xL1; this.xL1 = xL; this.yL2 = this.yL1; this.yL1 = outL[i]
            const xR = srcR[i]
            outR[i] = this.b0*xR + this.b1*this.xR1 + this.b2*this.xR2 - this.a1*this.yR1 - this.a2*this.yR2
            this.xR2 = this.xR1; this.xR1 = xR; this.yR2 = this.yR1; this.yR1 = outR[i]
        }
    }
}
```

#### Built-in Example Scripts (in SDK app)

1. **Hard Clipper** — hard/soft clipping with threshold
2. **Ring Modulator** — frequency-controlled ring modulation
3. **Simple Delay** — time/feedback delay with pre-allocated buffers
4. **Biquad Lowpass** — biquad filter with coefficient recalculation
5. **Alienator** — multi-stage: chaos feedback, wavefolder, bitcrusher, decimator, ring mod
6. **Beautifier** — mastering enhancer: warmth, air, punch, width, output gain

#### Source Code

- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/WerkstattDeviceBox.ts`
- Parameter Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/WerkstattParameterBox.ts`
- Sample Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/WerkstattSampleBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/WerkstattDeviceBoxAdapter.ts`
- Processor: `/openDAW/packages/studio/core-processors/src/devices/audio-effects/WerkstattDeviceProcessor.ts`
- Compiler: `/openDAW/packages/studio/adapters/src/ScriptCompiler.ts`
- Declarations: `/openDAW/packages/studio/adapters/src/ScriptDeclaration.ts`
- Default Code: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/werkstatt-default.js`
- Examples: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/examples/`

---

### Spielwerk

Spielwerk is a scriptable MIDI effect where users write a JavaScript `Processor` class that receives incoming note events and yields transformed or new notes. It sits in the MIDI effect chain before the instrument (e.g., Vaporisateur). Parameters declared via `// @param` comments appear as automatable knobs.

#### Factory Reference

```typescript
import { EffectFactories } from "@opendaw/studio-core";

const effectBox = project.api.insertEffect(audioUnitBox.midiEffects, EffectFactories.Spielwerk);
const spielwerkBox = effectBox as SpielwerkDeviceBox;
```

- `defaultName`: "Spielwerk"
- `defaultIcon`: `IconSymbol.Code`
- `briefDescription`: "Scriptable FX"
- `external`: false
- `type`: "midi"

Listed in `EffectFactories.MidiNamed` alongside Arpeggio, Pitch, Velocity, and Zeitgeist.

#### Box Fields

| Field | Type | Description |
|-------|------|-------------|
| code | string | JavaScript source code (with compiled header prepended) |
| parameters | pointer collection | `WerkstattParameterBox` instances from `// @param` declarations |
| samples | pointer collection | `WerkstattSampleBox` instances from `// @sample` declarations |

Parameters are fully automatable (same automation system as built-in effects).

#### User Processor API

The user must define a `class Processor` with a generator `* process()` method:

```javascript
class Processor {
    // REQUIRED: Generator function called every audio block
    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                yield event  // pass through note-ons
            }
        }
    }

    // OPTIONAL: Called when a @param knob changes
    paramChanged(label, value) { }

    // OPTIONAL: Called on transport jump or play->pause
    reset() { }
}
```

**`block` Object:**

| Property | Type | Description |
|----------|------|-------------|
| `from` | number | Start position in ppqn (inclusive), 480 ppqn = 1 quarter note |
| `to` | number | End position in ppqn (exclusive) |
| `bpm` | number | Current tempo |
| `flags` | number | Bitmask: 1=transporting, 2=discontinuous, 4=playing |

**`events` Iterator** — A unified stream of note-ons and note-offs:

**Note-on** (`gate: true`):

| Property | Type | Description |
|----------|------|-------------|
| `gate` | true | Note-on indicator |
| `id` | number | Unique note instance identifier |
| `position` | number | Position in ppqn |
| `duration` | number | Duration in ppqn |
| `pitch` | number | MIDI pitch 0-127 |
| `velocity` | number | 0.0-1.0 |
| `cent` | number | Fine pitch offset in cents |

**Note-off** (`gate: false`):

| Property | Type | Description |
|----------|------|-------------|
| `gate` | false | Note-off indicator |
| `id` | number | Matches the note-on id |
| `position` | number | Position in ppqn |
| `pitch` | number | MIDI pitch 0-127 |

**Yielded Output Notes:**

Output notes do not need `gate` or `id` — the engine manages note lifecycle:

```javascript
yield { position, duration, pitch, velocity, cent }
```

**Position rules:**
- `position >= block.from` and `< block.to` — emitted immediately
- `position >= block.to` — held in internal scheduler, emitted in future block
- `position < block.from` — **ERROR**, processor silenced

#### Parameter Declarations (`// @param`)

Same syntax as Werkstatt. See the [Werkstatt parameter declarations section](#parameter-declarations--param) for full reference.

**Quick Reference:**

```
// @param <name> [default] [min max type [unit]]
```

| Declaration | Result |
|---|---|
| `// @param amount` | Unipolar 0-1, default 0 |
| `// @param amount 0.5` | Unipolar 0-1, default 0.5 |
| `// @param delay 120 24 480 int ppqn` | Integer 24-480, default 120, unit "ppqn" |
| `// @param freq 440 20 20000 exp Hz` | Exponential 20-20000, default 440 |
| `// @param bypass false` | Boolean, default Off |

Types: `linear`, `exp`, `int`, `bool` (or omit for unipolar 0-1).

#### Safety Constraints

- Code runs in the AudioWorklet thread — no DOM, no fetch, no setTimeout, no imports
- `MAX_NOTES_PER_BLOCK = 128` — silences processor if exceeded
- `MAX_SCHEDULED_NOTES = 128` — silences if scheduler queue overflows
- All yielded notes validated: pitch 0-127, velocity 0.0-1.0, positive duration, position not in past, NaN detection
- Runtime errors caught and reported via `engine.subscribeDeviceMessage(uuid, listener)`
- On transport discontinuity or play-to-pause: all retained notes released, scheduler cleared, `reset()` called

#### Examples

**Default — Passthrough:**

```javascript
class Processor {
    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                yield event
            }
        }
    }
}
```

**Chord Generator:**

```javascript
// @param mode 0 0 3 int

class Processor {
    mode = 0

    paramChanged(label, value) {
        if (label === "mode") this.mode = value
    }

    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                yield event  // root note
                const intervals = [
                    [4, 7],       // major
                    [3, 7],       // minor
                    [4, 7, 11],   // major 7th
                    [3, 7, 10],   // minor 7th
                ][this.mode]
                for (const interval of intervals) {
                    yield {
                        position: event.position,
                        duration: event.duration,
                        pitch: event.pitch + interval,
                        velocity: event.velocity * 0.8,
                        cent: 0
                    }
                }
            }
        }
    }
}
```

**Probability Gate:**

```javascript
// @param chance 0.5

class Processor {
    chance = 0.5

    paramChanged(label, value) {
        if (label === "chance") this.chance = value
    }

    * process(block, events) {
        for (const event of events) {
            if (event.gate && Math.random() < this.chance) {
                yield event
            }
        }
    }
}
```

**Echo / Note Delay:**

```javascript
// @param repeats 3 1 8 int
// @param delay 240 60 960 int ppqn
// @param decay 0.7

class Processor {
    repeats = 3
    delay = 240
    decay = 0.7

    paramChanged(label, value) {
        if (label === "repeats") this.repeats = value
        if (label === "delay") this.delay = value
        if (label === "decay") this.decay = value
    }

    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                yield event  // original note
                let vel = event.velocity
                for (let r = 1; r <= this.repeats; r++) {
                    vel *= this.decay
                    if (vel < 0.01) break
                    yield {
                        position: event.position + this.delay * r,
                        duration: event.duration,
                        pitch: event.pitch,
                        velocity: vel,
                        cent: 0
                    }
                }
            }
        }
    }
}
```

#### Built-in Example Scripts (in SDK app)

1. **Chord Generator** — generates major/minor/7th chords from single notes
2. **Velocity** — target-based velocity mapping with strength, random, offset, dry/wet
3. **Pitch** — transpose by octaves, semitones, and cents
4. **Random Humanizer** — random timing jitter and velocity variation
5. **Probability Gate** — randomly filters notes based on chance parameter
6. **Echo / Note Delay** — repeated delayed copies with decaying velocity
7. **Pitch Range Filter** — only passes notes within a pitch range
8. **303 Sequencer** — autonomous step sequencer with deterministic pseudo-random patterns

#### Source Code

- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/midi-effects/SpielwerkDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/midi-effects/SpielwerkDeviceBoxAdapter.ts`
- Processor: `/openDAW/packages/studio/core-processors/src/devices/midi-effects/SpielwerkDeviceProcessor.ts`
- Compiler: `/openDAW/packages/studio/adapters/src/ScriptCompiler.ts` (shared with Werkstatt)
- Declarations: `/openDAW/packages/studio/adapters/src/ScriptDeclaration.ts` (shared)
- Default Code: `/openDAW/packages/app/studio/src/ui/devices/midi-effects/spielwerk-default.js`
- Examples: `/openDAW/packages/app/studio/src/ui/devices/midi-effects/examples/`
- AI Starter Prompt: `/openDAW/packages/app/studio/src/ui/devices/midi-effects/spielwerk-starter-prompt.txt`

---

### Tone3000

Tone3000 (internally `NeuralAmp`, formerly "Neural Amp") is an AI-powered amplifier/pedal/cab modeling effect that runs Neural Amp Modeler (NAM) models via WebAssembly inside the AudioWorklet. It supports multiple independent instances, mono/stereo processing, and loading models from local `.nam` files or the Tone 3000 online marketplace.

#### Factory Reference

```typescript
import { EffectFactories } from "@opendaw/studio-core";

const effectBox = project.api.insertEffect(audioUnitBox.audioEffects, EffectFactories.NeuralAmp);
const neuralAmpBox = effectBox as NeuralAmpDeviceBox;
```

- `defaultName`: "Tone3000" (changed from "Neural Amp" in SDK 0.0.129)
- `defaultIcon`: `IconSymbol.Tone3000` (changed from `IconSymbol.NeuralAmp`)
- `briefDescription`: "Amp Modeler"
- `external`: true (only effect with this flag — UI displays it with a logo instead of standard icon)
- `type`: "audio"

#### Parameters

| Parameter | Type | Box Default | Adapter Mapping | Range | Description |
|-----------|------|-------------|-----------------|-------|-------------|
| inputGain | float32 | 0.0 dB | `decibel(-72, 0, 12)` | -inf to +12 dB | Input drive level |
| outputGain | float32 | 0.0 dB | `decibel(-72, 0, 12)` | -inf to +12 dB | Output level compensation |
| mix | float32 | 1.0 | `linear(0, 1)` | 0-100% | Dry/wet blend |
| mono | boolean | true | boolean | true/false | Sum L+R to mono for processing |

`inputGain`, `outputGain`, and `mix` are automatable.

The decibel mapping `decibel(-72, 0, 12)` means:
- unitValue 0.0 = -inf (silence)
- unitValue 0.5 = 0 dB (unity)
- unitValue 1.0 = +12 dB

#### Box Fields

| Field ID | Name | Type | Description |
|----------|------|------|-------------|
| 11 | input-gain | float32 | Input gain in dB, automatable |
| 12 | output-gain | float32 | Output gain in dB, automatable |
| 13 | mono | boolean | Mono processing mode |
| 14 | mix | float32 | Dry/wet mix 0.0-1.0, automatable |
| 20 | model | pointer | Points to a `NeuralAmpModelBox` |

#### NeuralAmpModelBox

Models are stored in separate boxes with content-addressable UUIDs (SHA256 of model JSON):

| Field | Type | Description |
|-------|------|-------------|
| label | string | Display name (e.g., "Fender Twin — standard") |
| model | string | Full NAM JSON (uncompressed, 40KB-400KB) |

Multiple `NeuralAmpDeviceBox` instances can share the same model box (deduplication via SHA256).

#### Processing

**Mono Mode (default):**
1. Sum L+R to mono: `(inL + inR) * 0.5 * inputGain`
2. Run through WASM NAM instance
3. Apply output gain and mix: `out = dry * in + wet * processed`

**Stereo Mode:**
1. Apply input gain to each channel independently
2. Run L through instance 0, R through instance 1 (two WASM instances)
3. Apply output gain and mix per channel

**Passthrough:** When no model is loaded or WASM is not ready, audio passes through unchanged.

#### NAM Model File Format

`.nam` files are JSON with this structure:

```typescript
interface NamModel {
    version: string;                    // Semantic version
    architecture: string;               // "WaveNet", "LSTM", "ConvNet"
    config: NamModelConfig;             // Layer configs
    weights: number[];                  // All model weights as flat array
    metadata?: {
        name?: string;                  // Display name
        modeled_by?: string;            // Author
        gear_type?: string;             // "amp"|"pedal"|"pedal_amp"|"amp_cab"|...
        gear_make?: string;             // "Fender", "Marshall", etc.
        gear_model?: string;            // "Deluxe Reverb", "JCM800", etc.
        tone_type?: string;             // "clean"|"overdrive"|"crunch"|"hi_gain"|"fuzz"
        loudness?: number;              // dB
    };
}
```

Model sizes by architecture variant:
- **Standard**: ~400KB, ~8% CPU
- **Lite**: ~200KB, ~5-6% CPU
- **Feather**: ~80KB, ~4-5% CPU
- **Nano**: ~40KB, ~3% CPU

#### Loading Models

**From Local `.nam` File:**

```typescript
import { UUID } from "@opendaw/lib-std";
import { NeuralAmpModelBox } from "@opendaw/studio-boxes";

const modelJson = await fetch("/path/to/model.nam").then(r => r.text());
const jsonBuffer = new TextEncoder().encode(modelJson);
const uuid = await UUID.sha256(jsonBuffer.buffer as ArrayBuffer);

project.editing.modify(() => {
    const modelBox = NeuralAmpModelBox.create(project.boxGraph, uuid, box => {
        box.label.setValue("My Amp Model");
        box.model.setValue(modelJson);
    });
    neuralAmpBox.model.refer(modelBox);
});
```

**From Tone 3000 Marketplace:** The SDK app opens a popup to `https://www.tone3000.com/api/v1/select` where users browse and select tones. The selected model is downloaded and stored via the same SHA256/dedup flow.

#### WASM Runtime (`@opendaw/nam-wasm`)

The `@opendaw/nam-wasm` package (v1.0.3) provides the WASM-based NAM inference engine:

- Compiled from NeuralAmpModelerCore C++ via Emscripten
- Singleton WASM module shared across all Tone3000 instances
- Each processor creates 1-2 WASM instances (1 for mono, 2 for stereo)
- Binary loaded lazily on first use via `engineToClient.fetchNamWasm()`
- `nam.wasm` ships as part of `@opendaw/studio-core` — Vite resolves it automatically

**Key WASM API:**

| Method | Description |
|--------|-------------|
| `createInstance()` | Create NAM instance, returns ID |
| `destroyInstance(id)` | Free instance resources |
| `loadModel(id, jsonString)` | Load .nam JSON into instance |
| `process(id, input, output)` | Process mono audio through model |
| `setSampleRate(rate)` | Set sample rate for all instances |
| `reset(id)` | Reset instance state (call on transport stop) |

#### The `external` Flag

`external: true` is a UI-only concern. In the SDK's DevicesBrowser:
- External effects are separated by a divider
- Displayed with Tone3000 logo instead of standard icon
- Tone3000 is the **only** effect with `external: true`

This flag does NOT affect processing, box creation, or any runtime behavior.

#### Source Code

- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/NeuralAmpDeviceBox.ts`
- Model Box: `/openDAW/packages/studio/forge-boxes/src/schema/std/NeuralAmpModelBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/NeuralAmpDeviceBoxAdapter.ts`
- Processor: `/openDAW/packages/studio/core-processors/src/devices/audio-effects/NeuralAmpDeviceProcessor.ts`
- Migration: `/openDAW/packages/studio/core/src/project/migration/MigrateNeuralAmpDeviceBox.ts`
- WASM Package: `@opendaw/nam-wasm` (npm), source at `https://github.com/andremichelle/nam-wasm`
- Local Loader: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/NeuralAmp/NamLocal.ts`
- Tone3000 Integration: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/NeuralAmp/NamTone3000.ts`
