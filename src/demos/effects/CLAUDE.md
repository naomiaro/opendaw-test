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
