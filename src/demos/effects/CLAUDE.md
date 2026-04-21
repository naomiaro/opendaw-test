# Effects Demos — OpenDAW SDK Reference

### EffectBox Is a Union Type
`project.api.insertEffect()` returns `EffectBox` which is a union of device box types
(`ReverbDeviceBox | CompressorDeviceBox | WerkstattDeviceBox | SpielwerkDeviceBox | ...`), not a wrapper. Cast directly:
`const reverbBox = effectBox as ReverbDeviceBox;`
Automatable fields: `reverbBox.wet`, `reverbBox.dry`, etc.

### WavFile Moved to lib-dsp (SDK 0.0.129+)
`WavFile` was removed from `@opendaw/studio-core` and moved to `@opendaw/lib-dsp`.
```typescript
// Before (0.0.128)
import { WavFile } from "@opendaw/studio-core";
// After (0.0.129)
import { WavFile } from "@opendaw/lib-dsp";
```
Now supports 24-bit PCM WAV decoding in addition to 16-bit PCM and 32-bit float.

### Scriptable Devices (SDK 0.0.129+)
Three new scriptable device types powered by `ScriptCompiler`:
- **Apparat** — scriptable instrument (`InstrumentFactories.Apparat`), accepts MIDI, runs JS DSP
- **Werkstatt** — scriptable audio effect (`EffectFactories.Werkstatt`), runs JS audio DSP
- **Spielwerk** — scriptable MIDI effect (`EffectFactories.Spielwerk`), processes MIDI via JS
All use `// @param` and `// @sample` comment declarations in code for parameters/samples.
Box types: `ApparatDeviceBox`, `WerkstattDeviceBox`, `SpielwerkDeviceBox`.
SDK 0.0.132 adds `// @label <name>` (auto-sets device label) and `// @group <name> [color]` (groups params visually).
`ScriptParamDeclaration` was renamed to `ScriptDeclaration` in 0.0.132.

### Scriptable Device Code: Must Use ScriptCompiler.compile()
**CRITICAL:** `deviceBox.code.setValue(script)` does NOT execute the script. You must use
`ScriptCompiler.compile()` which wraps the code, registers it via `audioWorklet.addModule()`,
and writes back a header (`// @werkstatt js 1 <update-number>`) that the processor detects.
Without compilation, the processor sees `update === 0` and stays silent.
```typescript
import { ScriptCompiler } from "@opendaw/studio-adapters";

const compiler = ScriptCompiler.create({
  headerTag: "werkstatt",       // or "apparat" or "spielwerk"
  registryName: "werkstattProcessors",  // or "apparatProcessors" or "spielwerkProcessors"
  functionName: "werkstatt",    // or "apparat" or "spielwerk"
});

// Insert the effect first (in editing.modify), then compile OUTSIDE the transaction:
let werkstattBox: WerkstattDeviceBox;
project.editing.modify(() => {
  const effectBox = project.api.insertEffect(audioBox.audioEffects, EffectFactories.Werkstatt);
  werkstattBox = effectBox as WerkstattDeviceBox;
  werkstattBox.label.setValue("My Effect");
});
await compiler.compile(audioContext, project.editing, werkstattBox, userCode);
// Parameters are now available via werkstattBox.parameters.pointerHub.incoming()
```
`compiler.stripHeader(code)` removes the `// @werkstatt ...` header to recover user code.
`compiler.load(audioContext, deviceBox)` reloads already-compiled code (e.g., on page load).

### Werkstatt Parameter Access
Parameters are created by `ScriptCompiler.compile()`. Access via:
`werkstattBox.parameters.pointerHub.incoming()` → `pointer.box` as `WerkstattParameterBox`
Fields: `.label` (StringField), `.value` (Float32Field, automatable), `.defaultValue` (Float32Field).

### Werkstatt Generator Scripts Must Check Transport
Scripts that generate audio (ignoring `src`) must check `block.flags & 4` (playing flag)
and return early when stopped, otherwise they produce continuous output after Stop is pressed:
```javascript
process({src, out}, block) {
  const [, ] = src
  const [outL, outR] = out
  if (!(block.flags & 4)) {
    // Must zero output — the SDK does NOT clear buffers between blocks
    for (let i = block.s0; i < block.s1; i++) { outL[i] = 0; outR[i] = 0 }
    return
  }
  // ... generate audio
}
```

### Parsing Werkstatt Script Declarations (SDK 0.0.132+)
Use `ScriptDeclaration.parseGroups(code)` from `@opendaw/studio-adapters` to get structured
param metadata (min, max, mapping, unit, defaultValue) grouped by `// @group` directives.
Prefer this over manual `// @param` string parsing. Returns `DeclarationSection[]` with
`group: { label, color } | null` and `items: DeclarationItem[]`.

### Device Type Discriminators
Use type-safe checks instead of `instanceof` for effect/device adapters:
```typescript
import { Devices } from "@opendaw/studio-adapters";

Devices.isAudioEffect(adapter)  // → AudioEffectDeviceAdapter
Devices.isMidiEffect(adapter)   // → MidiEffectDeviceAdapter
Devices.isInstrument(adapter)   // → InstrumentDeviceBoxAdapter
Devices.isHost(adapter)         // → DeviceHost (AudioUnitBoxAdapter or ModularAdapter)
```
Navigate from device back to parent: `device.deviceHost()` → `device.audioUnitBoxAdapter()`.

### Built-In Audio Effect Adapters
All adapters implement `DeviceBoxAdapter` with `.type`, `.labelField`, `.enabledField`,
`.minimizedField`, `.host`, and `.terminate()`.

**CompressorDeviceBoxAdapter** parameters:
| Parameter | Type | Range |
|-----------|------|-------|
| `lookahead` | boolean | on/off |
| `automakeup` | boolean | on/off |
| `autoattack` | boolean | on/off |
| `autorelease` | boolean | on/off |
| `inputgain` | dB | -30 to +30 |
| `threshold` | dB | -60 to 0 |
| `ratio` | exponential | 1 to 24 |
| `knee` | dB | 0 to 24 |
| `attack` | ms | 0 to 100 |
| `release` | ms | 5 to 1500 |
| `makeup` | dB | -40 to +40 |
| `mix` | unitValue | 0-1 (wet/dry) |

**Other audio effect adapters** (each with typed parameter sets):
- `DelayDeviceBoxAdapter` — 21-entry Fractions array (Off→1/1)
- `ReverbDeviceBoxAdapter` ("Free Reverb") — wet, dry, roomSize, damping, width
- `DattorroReverbDeviceBoxAdapter` — preDelay (ms, 0-1000), wet/dry use DefaultDecibel
- `GateDeviceBoxAdapter` — threshold, attack, hold, release, range
- `MaximizerDeviceBoxAdapter` — ceiling, release
- `CrusherDeviceBoxAdapter` — crush (inverted: higher value = MORE crushing), downsample
- `FoldDeviceBoxAdapter` — waveshaper fold amount
- `WaveshaperDeviceBoxAdapter` — custom waveshaper curve
- `StereoToolDeviceBoxAdapter` — stereo width is bipolar (-1..1), NOT 0-2
- `VocoderDeviceBoxAdapter` — carrier/modulator routing
- `TidalDeviceBoxAdapter` — 17-entry RateFractions (1/1→1/128), different from Delay
- `NeuralAmpDeviceBoxAdapter` ("Tone3000") — neural amp modeling with NAM files

### Modular Synth System (ModularAdapter)
`ModularDeviceBoxAdapter` wraps a modular synth/effect graph:
```typescript
import { ModularAdapter } from "@opendaw/studio-adapters";

modularAdapter.modules      // BoxAdapterCollection of ModuleAdapter
modularAdapter.connections   // BoxAdapterCollection of ModuleConnectionAdapter
modularAdapter.catchupAndSubscribe(listener)
```
Module types: `ModuleGainAdapter`, `ModuleDelayAdapter`, `ModuleMultiplierAdapter`,
`ModularAudioInputAdapter`, `ModularAudioOutputAdapter`.
Each module has `.box`, `.uuid`. Connections link module outputs to inputs.

### MIDI Effect Adapters
Available MIDI effect adapters (process MIDI before instruments):
- `ArpeggioDeviceBoxAdapter` — arpeggiator patterns
- `PitchDeviceBoxAdapter` — pitch transpose/shift
- `VelocityDeviceBoxAdapter` — velocity curve/mapping
- `SpielwerkDeviceBoxAdapter` — scriptable MIDI effect (JS)
- `ZeitgeistDeviceBoxAdapter` — step sequencer/pattern generator

### Effect Display Name Changes (SDK 0.0.129+)
- `EffectFactories.Reverb` display name changed from "Cheap Reverb" to "Free Reverb" (API name unchanged)
- `EffectFactories.NeuralAmp` display name changed to "Tone3000" (`IconSymbol.Tone3000`)
- `EffectFactories.AudioNamed` now alphabetically ordered; `includeNeuralAmp` flag removed

## Reference Files
- Effects demo: `src/demos/effects/effects-demo.tsx`
- Werkstatt demo: `src/demos/effects/werkstatt-demo.tsx`
- Effect hook: `src/hooks/useDynamicEffect.ts`
- Effect chain hook: `src/hooks/useEffectChain.ts`
- Effect presets: `src/lib/effectPresets.ts`
- Werkstatt DSP scripts: `src/lib/werkstattScripts.ts`
- Effects docs: `documentation/11-effects.md`
