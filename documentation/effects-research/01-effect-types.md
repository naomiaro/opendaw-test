# Audio Effects - Type Reference

This document provides detailed information about each available audio effect type.

## Compressor

**Purpose:** Reduces the dynamic range of audio by attenuating signals above a threshold.

**Factory Reference:** `EffectFactories.AudioNamed.Compressor`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Description |
|-----------|------|-------|---------|------|-------------|
| lookahead | boolean | - | false | - | Enable lookahead mode for pre-processing |
| automakeup | boolean | - | true | - | Automatically adjust makeup gain |
| autoattack | boolean | - | false | - | Automatically adjust attack time |
| autorelease | boolean | - | false | - | Automatically adjust release time |
| inputgain | float32 | -30.0 to 30.0 | 0.0 | dB | Input signal level adjustment |
| threshold | float32 | -60.0 to 0.0 | -10.0 | dB | Level above which compression applies |
| ratio | float32 | 1.0 to 24.0 | 2.0 | ratio | Compression ratio (1:1 to infinity:1) |
| knee | float32 | 0.0 to 24.0 | 0.0 | dB | Soft knee width |
| attack | float32 | 0.0 to 100.0 | 0.0 | ms | Time to reach compression |
| release | float32 | 5.0 to 1500.0 | 5.0 | ms | Time to release compression |
| makeup | float32 | -40.0 to 40.0 | 0.0 | dB | Makeup gain to compensate for reduction |
| mix | float32 | 0.0 to 1.0 | 1.0 | % | Dry/Wet mix percentage |

**Source Code:** 
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/CompressorDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/CompressorDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/CompressorDeviceEditor.tsx`

**Features:**
- Visual compression curve display
- Real-time metering (input, output, gain reduction)
- Toggle buttons for automatic parameter adjustment
- Based on CTAG DRC algorithm

---

## Delay

**Purpose:** Creates echoing effects by repeating the input signal at specific time intervals.

**Factory Reference:** `EffectFactories.AudioNamed.Delay`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Description |
|-----------|------|-------|---------|------|-------------|
| delayMusical | float32 | 0 to 16 | 4 | indices | Delay time as note fraction (1/1, 1/2, 1/3, 1/4, etc.) |
| feedback | float32 | 0.0 to 1.0 | 0.5 | % | Amount of output fed back to input |
| cross | float32 | 0.0 to 1.0 | 0.0 | % | Cross-channel feedback (0=none, 1=full) |
| filter | float32 | -1.0 to 1.0 | 0.0 | % | Filter on feedback (negative=low-pass, positive=high-pass) |
| dry | float32 | -60.0 to 6.0 | 0.0 | dB | Dry signal level |
| wet | float32 | -60.0 to 6.0 | -6.0 | dB | Wet signal level |

**Available Delay Time Fractions:**
1/1, 1/2, 1/3, 1/4, 3/16, 1/6, 1/8, 3/32, 1/12, 1/16, 3/64, 1/24, 1/32, 1/48, 1/64, 1/96, 1/128

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/DelayDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/DelayDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/DelayDeviceEditor.tsx`

**Features:**
- Tempo-synced delay time
- Stereo cross-feedback for spacious effects
- Optional filtering on feedback loop
- Easy-to-use knob-based interface

---

## Reverb

**Purpose:** Simulates acoustic spaces by creating reflections and decay.

**Factory Reference:** `EffectFactories.AudioNamed.Reverb`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Description |
|-----------|------|-------|---------|------|-------------|
| decay | float32 | 0.0 to 1.0 | 0.5 | % | Room size / reverb decay time |
| preDelay | float32 | 0.001 to 0.5 | 0.0 | s | Time before first reflection |
| damp | float32 | 0.0 to 1.0 | 0.5 | % | Damping of high frequencies |
| filter | float32 | -1.0 to 1.0 | 0.0 | % | Additional filtering |
| dry | float32 | -60.0 to 6.0 | 0.0 | dB | Dry signal level |
| wet | float32 | -60.0 to 6.0 | -3.0 | dB | Wet signal level |

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/ReverbDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/ReverbDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/ReverbDeviceEditor.tsx`

**Features:**
- Physical room simulation
- Pre-delay for spacious effects
- High-frequency damping control
- Decay time from 0.001s to 0.5s

---

## Revamp (Parametric EQ)

**Purpose:** Shapes frequency balance with multiple filter types and curves.

**Factory Reference:** `EffectFactories.AudioNamed.Revamp`

**Filter Sections:**

### High-Pass Filter
- **enabled** (boolean)
- **frequency** (float32): 0.0 to ∞
- **order** (int32): 1-4 (filter steepness)
- **q** (float32): Resonance

### Low Shelf
- **enabled** (boolean)
- **frequency** (float32): Low shelf center frequency
- **gain** (float32): Boost/cut amount

### Low Bell (Peaking EQ)
- **enabled** (boolean)
- **frequency** (float32): Center frequency
- **gain** (float32): Boost/cut amount
- **q** (float32): Bandwidth

### Mid Bell (Peaking EQ)
- **enabled** (boolean)
- **frequency** (float32): Center frequency
- **gain** (float32): Boost/cut amount
- **q** (float32): Bandwidth

### High Bell (Peaking EQ)
- **enabled** (boolean)
- **frequency** (float32): Center frequency
- **gain** (float32): Boost/cut amount
- **q** (float32): Bandwidth

### High Shelf
- **enabled** (boolean)
- **frequency** (float32): High shelf center frequency
- **gain** (float32): Boost/cut amount

### Low-Pass Filter
- **enabled** (boolean)
- **frequency** (float32): 0.0 to ∞
- **order** (int32): 1-4 (filter steepness)
- **q** (float32): Resonance

### Global
- **gain** (float32): Output level adjustment

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/RevampDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/RevampDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/RevampDeviceEditor.tsx`

**Features:**
- Professional parametric EQ
- Multiple simultaneous filter types
- Visual curve display
- Individually enable/disable each section

---

## Crusher

**Purpose:** Reduces bit depth and resolution for degradation/distortion effects.

**Factory Reference:** `EffectFactories.AudioNamed.Crusher`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Description |
|-----------|------|-------|---------|------|-------------|
| crush | float32 | 0.0 to ∞ | 0.0 | - | Amount of bit reduction |
| bits | int32 | 1 to 16 | 16 | bits | Target bit depth for reduction |
| boost | float32 | 0.0 to ∞ | 0.0 | - | Output level boost |
| mix | float32 | 0.0 to 1.0 | 1.0 | % | Dry/Wet mix percentage |

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/CrusherDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/CrusherDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/CrusherDeviceEditor.tsx`

**Features:**
- Adjustable bit depth
- Crushing amount control
- Output boost for compensation
- Creates lo-fi/retro digital artifacts

---

## Fold

**Purpose:** Waveshaping effect that folds signals back into audio range when overdriven.

**Factory Reference:** `EffectFactories.AudioNamed.Fold`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Description |
|-----------|------|-------|---------|------|-------------|
| drive | float32 | -∞ to ∞ | 0.0 | - | Input drive amount |
| overSampling | int32 | - | 0 | - | Oversampling factor for quality |
| volume | float32 | -∞ to ∞ | 0.0 | - | Output volume compensation |

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/FoldDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/FoldDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/FoldDeviceEditor.tsx`

**Features:**
- Wavefolder saturation
- Harmonic generation through folding
- Oversampling support for quality
- Natural distortion characteristic

---

## Stereo Tool

**Purpose:** Manipulates stereo imaging, panning, and phase relationships.

**Factory Reference:** `EffectFactories.AudioNamed.StereoTool`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Description |
|-----------|------|-------|---------|------|-------------|
| volume | float32 | - | (default) | dB | Master volume level |
| panning | float32 | -1.0 to 1.0 | 0.0 | bipolar | Left/right panning (-1=left, 1=right) |
| stereo | float32 | 0.0 to ∞ | (default) | % | Stereo width (0=mono, >1=wider) |
| invertL | boolean | - | false | - | Invert left channel phase |
| invertR | boolean | - | false | - | Invert right channel phase |
| swap | boolean | - | false | - | Swap left and right channels |
| panningMixing | int32 | - | EqualPower | enum | Panning algorithm (EqualPower mode) |

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/StereoToolDeviceBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/StereoToolDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/StereoToolDeviceEditor.tsx`

**Features:**
- Stereo matrix transformation
- Phase inversion per channel
- Channel swapping
- Equal power panning algorithm
- Volume, panning, and width in single effect

---

## Dattorro Reverb

**Purpose:** High-quality algorithmic reverb based on the Dattorro plate reverb algorithm with modulation.

**Factory Reference:** `EffectFactories.AudioNamed.DattorroReverb`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Description |
|-----------|------|-------|---------|------|-------------|
| preDelay | float32 | 0.0 to 0.1 | 0.0 | s | Time before first reflection |
| bandwidth | float32 | 0.0 to 1.0 | 0.9995 | % | Input bandwidth filter |
| inputDiffusion1 | float32 | 0.0 to 1.0 | 0.75 | % | First input diffusion stage |
| inputDiffusion2 | float32 | 0.0 to 1.0 | 0.625 | % | Second input diffusion stage |
| decay | float32 | 0.0 to 1.0 | 0.5 | % | Reverb decay time |
| decayDiffusion1 | float32 | 0.0 to 1.0 | 0.7 | % | First decay diffusion stage |
| decayDiffusion2 | float32 | 0.0 to 1.0 | 0.5 | % | Second decay diffusion stage |
| damping | float32 | 0.0 to 1.0 | 0.005 | % | High frequency damping |
| excursionRate | float32 | 0.0 to 1.0 | 0.5 | % | Modulation LFO rate |
| excursionDepth | float32 | 0.0 to 1.0 | 0.7 | % | Modulation depth |
| wet | float32 | -60.0 to 6.0 | -6.0 | dB | Wet signal level |
| dry | float32 | -60.0 to 6.0 | 0.0 | dB | Dry signal level |

**Features:**
- True stereo reverb algorithm
- Modulation for lush, animated tails
- Extensive control over diffusion stages
- Excellent for ambient and atmospheric effects
- Based on Jon Dattorro's 1997 plate reverb design

---

## Tidal (LFO Modulator)

**Purpose:** Low-frequency oscillator for amplitude modulation, tremolo, and auto-pan effects.

**Factory Reference:** `EffectFactories.AudioNamed.Tidal`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Description |
|-----------|------|-------|---------|------|-------------|
| slope | float32 | 0.0 to 1.0 | 0.5 | % | Waveform slope (0=triangle, 1=square) |
| symmetry | float32 | 0.0 to 1.0 | 0.5 | % | Waveform symmetry (0.5=symmetric) |
| rate | float32 | 0.01 to 20.0 | 1.0 | Hz | LFO frequency |
| depth | float32 | 0.0 to 1.0 | 0.5 | % | Modulation depth |
| offset | float32 | 0.0 to 1.0 | 0.0 | phase | Phase offset (0-1 = 0-360°) |
| channelOffset | float32 | 0.0 to 1.0 | 0.0 | phase | Stereo phase offset for auto-pan |

**Features:**
- Variable waveform shape (sine to triangle to square)
- Stereo phase offset for panning effects
- Wide rate range from slow drift to fast tremolo
- Classic amplitude modulation effects

---

## Maximizer (Limiter)

**Purpose:** Brick-wall limiter for loudness maximization and peak control.

**Factory Reference:** `EffectFactories.AudioNamed.Maximizer`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Description |
|-----------|------|-------|---------|------|-------------|
| threshold | float32 | -30.0 to 0.0 | 0.0 | dB | Limiting threshold |
| lookahead | boolean | - | true | - | Enable lookahead for transparent limiting |

**Features:**
- True peak limiting
- Lookahead mode for transparent gain reduction
- Simple, effective loudness control
- Essential for mastering chains

---

## Modular (Custom Audio Effects)

**Purpose:** Creates custom audio effects through visual module patching.

**Factory Reference:** `EffectFactories.AudioNamed.Modular`

**Features:**
- Visual modular environment
- Connect processing modules
- Drag-and-drop interface
- Save custom effects as presets

**Source Code:**
- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/modular.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/ModularDeviceBoxAdapter.ts`
- Editor: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/ModularDeviceEditor.tsx`

---

## Effect Type Reference in Code

All available audio effects can be accessed via:

```typescript
import { EffectFactories } from "@opendaw/studio-core";

// Audio effects
EffectFactories.AudioNamed.Compressor
EffectFactories.AudioNamed.Delay
EffectFactories.AudioNamed.Reverb
EffectFactories.AudioNamed.DattorroReverb
EffectFactories.AudioNamed.Revamp
EffectFactories.AudioNamed.Crusher
EffectFactories.AudioNamed.Fold
EffectFactories.AudioNamed.StereoTool
EffectFactories.AudioNamed.Tidal
EffectFactories.AudioNamed.Maximizer
EffectFactories.AudioNamed.Modular

// As list
EffectFactories.AudioList // Array of all audio effects
```

## Common Parameter Patterns

### Dry/Wet Mix
Most effects include `dry` and `wet` parameters for blend control:
- **dry**: -60 to 6 dB
- **wet**: -60 to 6 dB
- Set `wet` lower than `dry` for subtle effect
- Set `wet` higher for pronounced effect

### Filter Parameters
Effects with filtering support these common patterns:
- **frequency**: Center or cutoff frequency
- **q**: Quality factor / resonance (higher = narrower)
- **order**: Filter slope (higher = steeper)

### Time-Based Parameters
Delay and Reverb use:
- **Milliseconds** for delay time: 0.001 to 0.5 seconds
- **Fractions** for tempo-synced delays: 1/1, 1/2, 1/4, etc.
- **Percentages** for decay/decay time: 0-100%

