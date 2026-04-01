# Werkstatt - Scriptable Audio Effect

Werkstatt is a scriptable audio effect that lets users write custom DSP code in plain JavaScript. The code runs inside an AudioWorklet. Users define a `Processor` class with a `process()` method that receives stereo audio buffers and outputs processed audio sample by sample.

**WASM is not supported.** The SDK design doc states WASM compilation is a future possibility but is not implemented. Werkstatt is JavaScript only.

## Factory Reference

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

## Box Fields

| Field | Type | Description |
|-------|------|-------------|
| code | string | JavaScript source code (with compiled header prepended) |
| parameters | pointer collection | `WerkstattParameterBox` instances from `// @param` declarations |
| samples | pointer collection | `WerkstattSampleBox` instances from `// @sample` declarations |

Parameters are fully automatable (same automation system as built-in effects).

## User Processor API

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

### `io` Object

| Property | Type | Description |
|----------|------|-------------|
| `src` | `ReadonlyArray<Float32Array>` | `[leftInput, rightInput]` |
| `out` | `ReadonlyArray<Float32Array>` | `[leftOutput, rightOutput]` |

### `block` Object

| Property | Type | Description |
|----------|------|-------------|
| `s0` | number | First sample index (inclusive) |
| `s1` | number | Last sample index (exclusive) |
| `index` | number | Block counter |
| `bpm` | number | Current tempo |
| `p0` | number | Start position in PPQN (960 ppqn per quarter note) |
| `p1` | number | End position in PPQN |
| `flags` | number | Bitmask (see below) |

### `block.flags` Bitmask

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

### Globals Available

- `sampleRate` — the AudioContext sample rate

## Parameter Declarations (`// @param`)

Declare parameters with comments at the top of the script. Each declaration creates an automatable knob on the device panel.

### Syntax

```
// @param <name> [default] [min max type [unit]]
```

### Forms

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

### Mapping Types

| Type | `paramChanged` receives | UI Display |
|------|------------------------|------------|
| *(none/unipolar)* | 0.0-1.0 | percent |
| `linear` | min-max | 2 decimal places |
| `exp` | min-max | 2 decimal places |
| `int` | integer min-max | 0 decimal places |
| `bool` | 0 or 1 | "On"/"Off" |

## Label Directive (`// @label`) (SDK 0.0.132+)

```
// @label My Custom Filter
```

Sets the device label automatically when the script is compiled. Parsed with `ScriptDeclaration.parseLabel(code): Option<string>`.

## Parameter Groups (`// @group`) (SDK 0.0.132+)

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

## Sample Declarations (`// @sample`)

```
// @sample <name>
```

Creates a file picker drop zone on the device panel. Note: sample data is **not yet wired** to the Werkstatt processor — `@sample` is more fully realized in the Apparat instrument where `this.samples.<name>` provides audio data.

## Code Compilation (ScriptCompiler)

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

## Accessing Parameters from Host Code

After `compile()`, the SDK creates `WerkstattParameterBox` instances for each `// @param` declaration. Access them via the `parameters` pointer collection:

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

## Safety Constraints

- Code runs in an AudioWorklet thread — no DOM, no fetch, no setTimeout, no imports
- Only `sampleRate` is available as a global
- Must only read/write sample indices from `s0` to `s1` (exclusive)
- **Never allocate memory inside `process()`** — no `new`, no array/object literals, no closures, no string concatenation (causes GC pauses)
- Output validated every block: NaN or amplitude > 1000 (~60dB) silences the processor

## Examples

### Default — Simple Gain

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

### Ring Modulator

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

### Biquad Lowpass Filter

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

## Built-in Example Scripts (in SDK app)

1. **Hard Clipper** — hard/soft clipping with threshold
2. **Ring Modulator** — frequency-controlled ring modulation
3. **Simple Delay** — time/feedback delay with pre-allocated buffers
4. **Biquad Lowpass** — biquad filter with coefficient recalculation
5. **Alienator** — multi-stage: chaos feedback, wavefolder, bitcrusher, decimator, ring mod
6. **Beautifier** — mastering enhancer: warmth, air, punch, width, output gain

## Source Code

- Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/WerkstattDeviceBox.ts`
- Parameter Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/WerkstattParameterBox.ts`
- Sample Box: `/openDAW/packages/studio/forge-boxes/src/schema/devices/audio-effects/WerkstattSampleBox.ts`
- Adapter: `/openDAW/packages/studio/adapters/src/devices/audio-effects/WerkstattDeviceBoxAdapter.ts`
- Processor: `/openDAW/packages/studio/core-processors/src/devices/audio-effects/WerkstattDeviceProcessor.ts`
- Compiler: `/openDAW/packages/studio/adapters/src/ScriptCompiler.ts`
- Declarations: `/openDAW/packages/studio/adapters/src/ScriptDeclaration.ts`
- Default Code: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/werkstatt-default.js`
- Examples: `/openDAW/packages/app/studio/src/ui/devices/audio-effects/examples/`
