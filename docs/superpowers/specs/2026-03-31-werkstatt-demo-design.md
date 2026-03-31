# Werkstatt Demo Design

## Overview

Single-page demo showcasing the Werkstatt scriptable audio effect. Two sections: an **Effect Showcase** (browse and apply 5 pre-built effects with parameter controls) and an **API Reference** (read-only code examples covering the full Werkstatt API surface with "Load" buttons to hear each example).

Audio source: Dark Ride Drums stem with `waveformOffset` to skip intro silence (bar 25), plus a toggle to switch to a generated test signal (sine wave / white noise).

## Audio Source

- **Default:** `02_Drums` from Dark Ride stems (`/audio/DarkRide/02_Drums.{ext}`)
- **BPM:** 124 (passed to `initializeOpenDAW`)
- **Offset:** `waveformOffset = PPQN.pulsesToSeconds(BAR * 24, 124)` to start at bar 25 where the full drum pattern begins (same approach as clip looping demo)
- **Test signal toggle:** A segmented control (Drums | Sine | Noise) above the transport.
  - When "Sine" or "Noise" is selected: insert a generator Werkstatt effect **before** the showcase effect in the chain. The generator ignores `src` and writes a 440Hz sine or white noise directly to `out`. The showcase effect then processes that signal.
  - When "Drums" is selected: remove the generator Werkstatt. The showcase effect processes the drum audio directly.
  - The generator scripts are simple, hardcoded Werkstatt scripts (not user-visible in the showcase).

## Section 1: Effect Showcase

### Layout

- Row of 5 effect cards (name + brief description)
- Clicking a card makes it active (highlighted border/background)
- Only one effect active at a time — selecting a new one replaces the current Werkstatt instance
- Active effect shows:
  - Parameter sliders below the cards, generated from `// @param` declarations
  - Read-only code block showing the full script source

### Effects

All effects avoid overlap with SDK built-in effects (Reverb, Delay, Compressor, Gate, Crusher, Fold, StereoTool, Tidal, Maximizer, Tone3000, Waveshaper, DattorroReverb).

#### 1. Tremolo
Amplitude modulation via LFO.
```
// @param rate 4 0.5 20 exp Hz
// @param depth 0.5
```

#### 2. Ring Modulator
Frequency-domain multiplication with a sine carrier.
```
// @param frequency 440 20 20000 exp Hz
// @param mix 0.5
```

#### 3. Biquad Lowpass Filter
Classic 2nd-order IIR lowpass. Recalculates coefficients on parameter change.
```
// @param cutoff 1000 20 20000 exp Hz
// @param resonance 0.707 0.1 20 exp
```

#### 4. Chorus
Modulated delay line for stereo widening/thickening.
```
// @param rate 1.5 0.1 10 exp Hz
// @param depth 0.5
// @param mix 0.5
```

#### 5. Phaser
All-pass filter chain with LFO modulation.
```
// @param rate 0.5 0.1 10 exp Hz
// @param depth 0.5
// @param stages 4 2 12 int
```

### Effect Lifecycle

1. User clicks an effect card
2. If a Werkstatt effect already exists, delete it via `effectBox.delete()` inside `editing.modify()`
3. Insert new Werkstatt: `project.api.insertEffect(audioBox.audioEffects, EffectFactories.Werkstatt)`
4. Set code: `werkstattBox.code.setValue(script)` inside `editing.modify()`
5. Generate parameter UI from the `// @param` declarations in the script
6. Parameter changes: call `werkstattBox.parameters` pointer collection to find the matching `WerkstattParameterBox` and set its `value` field

### Parameter Control

Each `// @param` declaration creates a slider. The label, min, max, step, and unit are derived from the declaration syntax. When the user moves a slider:

1. Find the `WerkstattParameterBox` matching the param label in `werkstattBox.parameters`
2. Set its `value` field inside `editing.modify()`
3. The SDK calls `paramChanged(label, value)` on the processor automatically

## Section 2: API Reference

Collapsible accordion sections, each containing:
- Explanatory text (1-3 sentences)
- Read-only code block
- "Load" button that inserts the code as a Werkstatt effect on the audio track

### Sections

#### 1. The Processor Class
Minimal passthrough showing the required `process()` method signature.
```javascript
class Processor {
  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    for (let i = s0; i < s1; i++) {
      outL[i] = srcL[i]
      outR[i] = srcR[i]
    }
  }
}
```
Explains: `src`/`out` are arrays of `Float32Array` channels, `s0`/`s1` define the sample range to process.

#### 2. Parameter Declarations
Table of all `// @param` types with examples:

| Declaration | Type | Range | Default | `paramChanged` receives |
|---|---|---|---|---|
| `// @param gain` | unipolar | 0–1 | 0 | 0.0–1.0 |
| `// @param gain 0.5` | unipolar | 0–1 | 0.5 | 0.0–1.0 |
| `// @param time 500 1 2000` | linear | 1–2000 | 500 | raw value |
| `// @param cutoff 1000 20 20000 exp Hz` | exponential | 20–20000 | 1000 | raw value |
| `// @param steps 4 1 16 int` | integer | 1–16 | 4 | integer |
| `// @param bypass false` | boolean | — | Off | 0 or 1 |

Loadable example: a gain effect with `// @param gain 1.0` and `paramChanged`.

#### 3. The Block Object
Shows all properties available in the second argument to `process()`:

| Property | Type | Description |
|---|---|---|
| `s0` | number | First sample index (inclusive) |
| `s1` | number | Last sample index (exclusive) |
| `index` | number | Block counter |
| `bpm` | number | Current tempo |
| `p0` | number | Start position in PPQN |
| `p1` | number | End position in PPQN |
| `flags` | number | Bitmask: 1=transporting, 2=discontinuous, 4=playing, 8=bpmChanged |

Loadable example: a tempo-synced tremolo that reads `bpm` from the block object.

#### 4. The `sampleRate` Global
Brief note that `sampleRate` is the only global available. Loadable example showing its use in phase increment calculation.

#### 5. Safety Constraints
Non-loadable reference section listing:
- No DOM, fetch, setTimeout, imports
- No allocations inside `process()` (no `new`, no array/object literals, no closures, no string concatenation)
- Output validated every block: NaN or amplitude > 1000 silences the processor
- JavaScript only (no WASM)

## Component Structure

### Files

- `werkstatt-demo.html` — HTML entry point
- `src/werkstatt-demo.tsx` — Main page component

### State

```typescript
// Core
const [project, setProject] = useState<any>(null);
const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
const [status, setStatus] = useState<string>("Click to initialize...");

// Audio source
const [audioSource, setAudioSource] = useState<"drums" | "sine" | "noise">("drums");

// Showcase
const [activeEffect, setActiveEffect] = useState<string | null>(null);  // effect name or null
const [effectParams, setEffectParams] = useState<Record<string, number>>({});

// Refs
const werkstattBoxRef = useRef<any>(null);
const audioBoxRef = useRef<any>(null);
const regionBoxRef = useRef<any>(null);
```

### Reused Hooks

- `useTransportControls(project)` — play/pause/stop
- `usePlaybackPosition(project)` — current position for playhead display
- `useWaveformRendering(...)` — drum waveform canvas

### New Logic (inline, not extracted to hooks)

- `loadEffect(effectName)` — deletes current Werkstatt, inserts new one, sets code, updates param state
- `updateParam(paramName, value)` — finds WerkstattParameterBox by label, sets value
- `setAudioSource(source)` — toggles between drums/sine/noise

## Layout

```
Theme (dark, accentColor="blue")
├── GitHubCorner
├── Container
│   ├── BackLink
│   ├── Heading: "Werkstatt — Scriptable Audio Effects"
│   ├── Description text
│   ├── Audio Source: Segmented control (Drums | Sine | Noise)
│   ├── Transport: Play / Pause / Stop
│   ├── Waveform canvas (drums) or signal indicator (sine/noise)
│   │
│   ├── Section: "Effect Showcase"
│   │   ├── 5 effect cards (clickable)
│   │   ├── Parameter sliders (when effect active)
│   │   └── Read-only code block (when effect active)
│   │
│   ├── Section: "API Reference"
│   │   ├── Accordion: "The Processor Class" + Load button
│   │   ├── Accordion: "Parameter Declarations" + Load button
│   │   ├── Accordion: "The Block Object" + Load button
│   │   ├── Accordion: "The sampleRate Global" + Load button
│   │   └── Accordion: "Safety Constraints" (no Load)
│   │
│   └── MoisesLogo
```

## Build Integration

1. Add `werkstatt-demo.html` to project root
2. Add entry to `vite.config.ts` → `rollupOptions.input`:
   ```typescript
   werkstatt: resolve(__dirname, "werkstatt-demo.html"),
   ```
3. Add card to `src/index.tsx`:
   - Emoji: `🔧` (or similar)
   - Title: "Werkstatt — Scriptable FX"
   - Description: "Write custom audio effects in JavaScript. Browse pre-built effects or explore the API with runnable examples."

## Out of Scope

- Editable code editor (future enhancement)
- `// @sample` declarations (not yet wired to Werkstatt processor in SDK)
- Apparat (scriptable instrument) or Spielwerk (scriptable MIDI effect) — separate demos
- Multi-track mixing
- Effect automation
- Presets system (the showcase effects serve as de facto presets)
