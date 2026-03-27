# Audio Effects - Type Reference

This document provides detailed information about each available audio effect type.

## Compressor

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

## Delay

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

## Gate

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

## Reverb (Free Reverb)

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
- ~~**gain** (float32): Output level adjustment (-18 to 18 dB)~~ — removed (deprecated in schema)

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

**Features:**
- Adjustable bit depth (1-16 bits)
- Sample rate reduction via exponential crush mapping
- Pre-emphasis boost for louder quantization artifacts
- Dry/wet mix with exponential adapter mapping for fine control at low values
- Creates lo-fi/retro digital artifacts

---

## Fold

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

**Features:**
- Wavefolder saturation
- Harmonic generation through folding
- Oversampling support for quality
- Natural distortion characteristic

---

## Waveshaper

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

## Stereo Tool

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

**Features:**
- Variable waveform shape (sine to triangle to square)
- Stereo phase offset for panning effects (in degrees, not 0-1)
- Tempo-synced rate via note fraction indices
- Classic amplitude modulation effects

**Important:** The `rate` parameter is an integer index into the `RateFractions` array — NOT a frequency in Hz. The processor reads it with `RateFractions[this.#pRate.getValue()]`. Setting rate to 3 selects the 1/4 note fraction. Note: This is a different array from the Delay `Fractions` (17 entries, largest-to-smallest vs 21 entries, smallest-to-largest).

---

## Maximizer (Limiter)

**Purpose:** Brick-wall limiter for loudness maximization and peak control.

**Factory Reference:** `EffectFactories.AudioNamed.Maximizer`

**Parameters:**

| Parameter | Type | Range | Default | Unit | Automatable | Description |
|-----------|------|-------|---------|------|-------------|-------------|
| threshold | float32 | -30.0 to 0.0 | 0.0 | dB | yes | Limiting threshold |
| lookahead | boolean | - | true | - | **no** | Enable lookahead for transparent limiting (not automatable) |

**Features:**
- True peak limiting
- Lookahead mode for transparent gain reduction
- Simple, effective loudness control
- Essential for mastering chains

---

## Effect Type Reference in Code

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

**Note:** `Modular` is a standalone factory (`EffectFactories.Modular`) but is NOT included in `AudioNamed` or `AudioList`. Tone3000 (`NeuralAmp`) is the only effect with `external: true` (see [09-tone3000.md](./09-tone3000.md)). Werkstatt is a scriptable effect (see [07-werkstatt.md](./07-werkstatt.md)).

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
- **Milliseconds** for delay time: 0.001 to 0.5 seconds (Reverb) or 0-1000ms (Delay, DattorroReverb)
- **Fractions** for tempo-synced delays: 1/1, 1/2, 1/4, etc. (index into Fractions array)
- **Percentages** for decay/decay time: 0-100%

### Side-Chain
Compressor and Gate support external side-chain inputs via `Pointers.SideChain` pointer fields. The side-chain signal is used for detection only — the main input is what gets processed.
