# WebAssembly Audio Effects in OpenDAW: Feasibility Analysis

## Executive Summary

This document analyzes the feasibility of integrating **custom audio effects** into OpenDAW, covering both **custom TypeScript effects** and **WebAssembly (WASM)-based effects**. Based on comprehensive research of OpenDAW's current effects architecture and Chrome's recommended WASM+AudioWorklet design patterns, this analysis provides implementation strategies for both approaches.

**TL;DR - Custom TypeScript Effects:**
- ❌ **Current Status**: No custom effects possible - all effects hardcoded at compile time
- ✅ **Extension Points**: Unknown effect fallback and Modular system exist but are incomplete
- ⚠️ **Effort Required**: Major architectural changes needed (months of work)
- ✅ **Recommended Path**: Complete the Modular system first (visual effect builder)

**TL;DR - WASM Effects:**
- ✅ **Feasible**: OpenDAW's architecture is well-suited for WASM integration
- ✅ **Current Status**: All effects are pure TypeScript (no WASM yet)
- ✅ **Recommended Approach**: Pattern B (Async Transfer) for initial implementation
- ⚠️ **Considerations**: Heap copying overhead, parameter marshalling, memory management
- ✅ **Performance**: +5-20% for complex effects with zero GC pauses

---

## Table of Contents

1. [Current OpenDAW Audio Architecture](#1-current-opendaw-audio-architecture)
2. [Custom TypeScript Effects - Current State](#2-custom-typescript-effects---current-state)
3. [Chrome WASM+AudioWorklet Design Patterns](#3-chrome-wasmudioworklet-design-patterns)
4. [Feasibility Analysis](#4-feasibility-analysis)
5. [Integration Approaches](#5-integration-approaches)
6. [Implementation Strategy](#6-implementation-strategy)
7. [Performance Considerations](#7-performance-considerations)
8. [Code Examples](#8-code-examples)
9. [Custom Effect Plugin Architecture](#9-custom-effect-plugin-architecture)
10. [Recommendations](#10-recommendations)

---

## 1. Current OpenDAW Audio Architecture

### 1.1 AudioWorklet Foundation

**Key Files:**
- `/packages/studio/core/src/AudioWorklets.ts` - Worklet factory and management
- `/packages/studio/core/src/EngineWorklet.ts` - Main audio engine node
- `/packages/studio/core-processors/src/EngineProcessor.ts` - Core AudioWorkletProcessor

**Architecture Pattern:**
```typescript
// Main Thread
class AudioWorklets {
    static async createFor(context: BaseAudioContext): Promise<AudioWorklets> {
        await context.audioWorklet.addModule(url)  // Load processor
        return new AudioWorklets(context)
    }

    createEngine({project, exportConfiguration, options}): EngineWorklet {
        return new EngineWorklet(context, project, exportConfiguration, options)
    }
}

// AudioWorklet Thread
class EngineProcessor extends AudioWorkletProcessor {
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        // Process audio in 128-sample blocks
        processors.forEach(processor => processor.process(processInfo))
        return true
    }
}
```

**Current Effect Processing Pattern:**
```typescript
// All effects extend AudioProcessor
class DelayDeviceProcessor extends AudioProcessor {
    readonly #delayLines: DelayDeviceDsp  // Pure JS/TS implementation

    processAudio({bpm, flags}: Block, from: number, to: number): void {
        // Process 128-sample buffer
        this.#delayLines.process(source.channels(), output.channels(), from, to)
    }
}
```

**Key Characteristics:**
- ✅ Already using AudioWorklet (dedicated audio thread)
- ✅ 128-sample render quantum (RenderQuantum constant)
- ✅ SharedArrayBuffer for control flags
- ✅ Float32Array for audio buffers
- ✅ Effect chain with topological sorting
- ✅ Parameter automation system
- ❌ No WASM usage for audio effects (all TypeScript)

### 1.2 Effect Architecture

**Processor Hierarchy:**
```
AudioProcessor (abstract base)
    ├─ AudioEffectDeviceProcessor (interface)
    │   ├─ DelayDeviceProcessor
    │   ├─ ReverbDeviceProcessor
    │   ├─ CompressorDeviceProcessor
    │   ├─ RevampDeviceProcessor (7-band EQ)
    │   └─ [8 more effects]
    ├─ InstrumentDeviceProcessor
    └─ AudioBusProcessor
```

**Processing Flow:**
```
Input Source
    ↓
Effect 1.processAudio(block, from, to)
    ↓
Effect 2.processAudio(block, from, to)
    ↓
Channel Strip (Volume/Pan)
    ↓
Output Bus
```

**Memory Management:**
- Pre-allocated Float32Array buffers (128 samples × 2 channels = 1KB per effect)
- Reused across render cycles (no allocation in audio thread)
- Delay lines and DSP state allocated at initialization

### 1.3 Parameter System

**AutomatableParameter Pattern:**
```typescript
class CompressorDeviceProcessor extends AudioProcessor {
    readonly parameterThreshold: AutomatableParameter<number>
    readonly parameterRatio: AutomatableParameter<number>
    readonly parameterAttack: AutomatableParameter<number>

    parameterChanged(parameter: AutomatableParameter<any>) {
        if (parameter === this.parameterThreshold) {
            this.#updateThreshold()
        }
    }
}
```

**Communication:**
- Main thread → AudioWorklet: Via `Messenger` IPC
- AudioWorklet → Main thread: Via callbacks and state updates
- Real-time: SharedArrayBuffer for urgent controls

---

## 2. Custom TypeScript Effects - Current State

### 2.1 Can Users Create Custom Effects Right Now?

**Answer: ❌ No - Custom effects are NOT currently possible**

OpenDAW's effect system is **completely hardcoded** at compile time. All effects must be:
1. Defined in the codebase
2. Compiled into the application bundle
3. Registered in static factory classes

There is **no runtime plugin system** for loading custom effects.

### 2.2 Current Effect Architecture

OpenDAW uses a sophisticated **three-layer architecture** for effects:

#### Layer 1: Box (Data Schema)

**File**: `/packages/studio/boxes/src/DelayDeviceBox.ts`

Defines the effect's data model with fields for parameters:

```typescript
export class DelayDeviceBox extends Box<...> {
    get host(): PointerField<Pointers.AudioEffectHost> { return this.getField(1) }
    get index(): Int32Field { return this.getField(2) }
    get label(): StringField { return this.getField(3) }
    get enabled(): BoolField { return this.getField(4) }

    // Effect-specific parameters
    get delay(): Float32Field { return this.getField(10) }
    get feedback(): Float32Field { return this.getField(11) }
    get cross(): Float32Field { return this.getField(12) }
    get filter(): Float32Field { return this.getField(13) }
    get dry(): Float32Field { return this.getField(14) }
    get wet(): Float32Field { return this.getField(15) }
}
```

**Schema Definition** (compile-time):
**File**: `/packages/studio/forge-boxes/src/schema/devices/audio-effects/DelayDeviceBox.ts`

```typescript
export const DelayDeviceBox: BoxSchema<Pointers> = DeviceFactory.createAudioEffect("DelayDeviceBox", {
    10: { type: "float32", name: "delay", value: 4, constraints: "any" },
    11: { type: "float32", name: "feedback", value: 0.5, constraints: "unipolar" },
    12: { type: "float32", name: "cross", value: 0.0, constraints: "unipolar" },
    // ...
})
```

#### Layer 2: BoxAdapter (State Management)

**File**: `/packages/studio/adapters/src/devices/audio-effects/DelayDeviceBoxAdapter.ts`

Provides a view over the Box with parameter mapping and UI state:

```typescript
export class DelayDeviceBoxAdapter implements AudioEffectDeviceAdapter {
    readonly #box: DelayDeviceBox

    readonly namedParameter = {
        delay: this.#parametric.createParameter(
            this.#box.delay,
            ValueMapping.linearInteger(0, OffsetFractions.length - 1),
            DelayDeviceBoxAdapter.OffsetStringMapping,
            "delay"
        ),
        feedback: this.#parametric.createParameter(
            this.#box.feedback,
            ValueMapping.unipolar(),
            StringMapping.numeric({unit: "%", fractionDigits: 0}),
            "feedback"
        ),
        // ...
    }
}
```

#### Layer 3: Processor (DSP/Audio Processing)

**File**: `/packages/studio/core-processors/src/devices/audio-effects/DelayDeviceProcessor.ts`

Implements the actual audio processing in the AudioWorklet thread:

```typescript
export class DelayDeviceProcessor extends AudioProcessor implements AudioEffectDeviceProcessor {
    readonly parameterDelay: AutomatableParameter<number>
    readonly parameterFeedback: AutomatableParameter<number>
    readonly #delayLines: DelayDeviceDsp

    constructor(context: EngineContext, adapter: DelayDeviceBoxAdapter) {
        super(context, adapter)
        this.parameterDelay = this.bindParameter(adapter.namedParameter.delay)
        this.parameterFeedback = this.bindParameter(adapter.namedParameter.feedback)
        this.#delayLines = new DelayDeviceDsp(maxFrames, interpolationDuration)
    }

    processAudio({bpm, flags}: Block, from: number, to: number): void {
        // Update delay time if needed
        if (this.#updateDelayTime || Bits.some(flags, BlockFlag.tempoChanged)) {
            const offsetInPulses = Fraction.toPPQN(offsetFractions[offsetIndex])
            this.#delayLines.offset = PPQN.pulsesToSamples(offsetInPulses, bpm, sampleRate)
        }

        // Process audio (128-sample blocks)
        this.#delayLines.process(
            this.source.channels(),
            this.#output.channels(),
            from,
            to
        )
    }
}
```

### 2.3 Effect Registration System

**File**: `/packages/studio/core/src/EffectFactories.ts`

All effects are **hardcoded** in a static namespace:

```typescript
export namespace EffectFactories {
    export const Delay: EffectFactory = {
        defaultName: "Delay",
        defaultIcon: IconSymbol.Time,
        description: "Echoes the input signal with time-based repeats",
        separatorBefore: false,
        type: "audio",
        create: ({boxGraph}, hostField, index): DelayDeviceBox =>
            DelayDeviceBox.create(boxGraph, UUID.generate(), box => {
                box.label.setValue("Delay")
                box.index.setValue(index)
                box.host.refer(hostField)
            })
    }

    export const Compressor: EffectFactory = { /* ... */ }
    export const Reverb: EffectFactory = { /* ... */ }
    // ...10 total audio effects

    export const AudioList: ReadonlyArray<EffectFactory> = [
        StereoTool, Compressor, Delay, Reverb, DattorroReverb,
        Revamp, Crusher, Fold, Tidal, Modular
    ]
}
```

**Effect Discovery** (UI menus):
**File**: `/packages/app/studio/src/ui/devices/menu-items.ts`

```typescript
MenuItem.default({label: "Add Audio Effect"})
    .setRuntimeChildrenProcedure(parent => parent.addMenuItem(
        ...EffectFactories.AudioList.map(entry => MenuItem.default({
            label: entry.defaultName,
            separatorBefore: entry.separatorBefore
        }).setTriggerProcedure(() =>
            api.insertEffect(deviceHost.audioEffects.field(), entry, 0)
        ))
    ))
```

### 2.4 Effect Instantiation - Static Visitor Pattern

**File**: `/packages/studio/core-processors/src/DeviceProcessorFactory.ts`

Effects are instantiated using a **hardcoded visitor pattern**:

```typescript
export namespace AudioEffectDeviceProcessorFactory {
    export const create = (context: EngineContext, box: Box): AudioEffectDeviceProcessor =>
        asDefined(box.accept<BoxVisitor<AudioEffectDeviceProcessor>>({
            visitDelayDeviceBox: (box: DelayDeviceBox) =>
                new DelayDeviceProcessor(
                    context,
                    context.boxAdapters.adapterFor(box, DelayDeviceBoxAdapter)
                ),
            visitCompressorDeviceBox: (box: CompressorDeviceBox) =>
                new CompressorDeviceProcessor(context, ...),
            visitReverbDeviceBox: (box: ReverbDeviceBox) =>
                new ReverbDeviceProcessor(context, ...),
            // ... hardcoded visitor for each effect type
        }), `Could not create audio-effect for '${box.name}'`)
}
```

**Key Issue**: This visitor pattern is **closed** - it cannot handle types that aren't known at compile time.

### 2.5 Potential Extension Points (Currently Non-Functional)

#### Unknown Effect Fallback

**Files**:
- `/packages/studio/boxes/src/UnknownAudioEffectDeviceBox.ts`
- `/packages/studio/core-processors/src/devices/audio-effects/NopDeviceProcessor.ts`

When OpenDAW encounters an unknown effect (e.g., from a project file), it creates an `UnknownAudioEffectDeviceBox`:

```typescript
export class UnknownAudioEffectDeviceBox extends Box<...> {
    get comment(): StringField { return this.getField(10) }  // Only field!
}
```

This renders as a **no-op (pass-through)**:

```typescript
export class NopDeviceProcessor extends AbstractProcessor {
    process(_processInfo: ProcessInfo): void {
        if (this.#source.isEmpty()) return
        const input = this.#source.unwrap()
        const [inpL, inpR] = input.channels()
        const [outL, outR] = this.#output.channels()

        // Just pass audio through
        for (let i = 0; i < RenderQuantum; i++) {
            outL[i] = inpL[i]
            outR[i] = inpR[i]
        }
    }
}
```

**Potential**: This system could be extended to load custom DSP code, but currently it's just a placeholder.

#### Modular Effect System (Incomplete)

**Files**:
- `/packages/studio/boxes/src/ModularDeviceBox.ts`
- `/packages/studio/adapters/src/modular/modular.ts`

The Modular system allows creating effects by wiring together modules:

**Available Modules**:
- ModuleGainBox
- ModuleDelayBox
- ModuleMultiplierBox
- ModularAudioInputBox
- ModularAudioOutputBox

**Current Status**: The Modular processor is **not implemented**:

```typescript
visitModularDeviceBox: (box: ModularDeviceBox) =>
    new NopDeviceProcessor(context, ...)  // Just pass-through!
```

This suggests the modular system is a **future feature** that could enable user-created effects.

### 2.6 Current Limitations Summary

| Aspect | Status | Blocker |
|--------|--------|---------|
| **Runtime effect loading** | ❌ Not possible | Static factory registration |
| **Dynamic Box types** | ❌ Not possible | Compile-time schema generation |
| **Visitor pattern extension** | ❌ Not possible | Hardcoded visitor methods |
| **Custom DSP code** | ❌ Not possible | No sandboxed execution |
| **Effect metadata** | ❌ Hardcoded | Static EffectFactory namespace |
| **UI discovery** | ❌ Static menus | Iterates EffectFactories.AudioList |
| **Plugin packaging** | ❌ No system | No plugin manifest format |

### 2.7 What Would Be Needed for Custom TypeScript Effects

To enable custom effects, OpenDAW would need:

#### Option A: Plugin Architecture (Most Flexible)

1. **Plugin Manifest Format**
   ```json
   {
     "name": "CustomDelay",
     "version": "1.0.0",
     "type": "audio-effect",
     "parameters": [
       {"id": "delayTime", "type": "float", "min": 0, "max": 2000, "default": 500},
       {"id": "feedback", "type": "float", "min": 0, "max": 1, "default": 0.5}
     ],
     "processor": "custom-delay-processor.js"
   }
   ```

2. **Dynamic Box Type System**
   - Runtime Box schema generation
   - Dynamic field allocation
   - Parameter metadata from manifest

3. **Sandboxed DSP Execution**
   ```typescript
   // Plugin processor interface
   interface PluginAudioProcessor {
       initialize(sampleRate: number, maxBlockSize: number): void
       setParameter(id: string, value: number): void
       process(inputs: Float32Array[], outputs: Float32Array[], blockSize: number): void
       terminate(): void
   }
   ```

4. **Plugin Loader**
   ```typescript
   class PluginManager {
       async loadPlugin(url: string): Promise<PluginDescriptor>
       registerPlugin(descriptor: PluginDescriptor): void
       createProcessor(pluginId: string, context: EngineContext): AudioProcessor
   }
   ```

5. **Dynamic Factory Registration**
   ```typescript
   // Extend visitor pattern
   const customVisitors = new Map<string, (box: Box) => AudioProcessor>()

   box.accept({
       // Static visitors for built-in effects
       visitDelayDeviceBox: (box) => new DelayDeviceProcessor(...),

       // Fallback to dynamic registry
       default: (box) => {
           const visitor = customVisitors.get(box.type)
           if (visitor) return visitor(box)
           return new NopDeviceProcessor(...)  // Unknown effect
       }
   })
   ```

#### Option B: Modular System Completion (Simpler)

1. **Implement Modular Processor**
   ```typescript
   class ModularDeviceProcessor extends AudioProcessor {
       #modules: Map<UUID, ModuleProcessor>
       #connections: Array<Connection>

       processAudio(block: Block, from: number, to: number): void {
           // Topological sort of modules
           const sortedModules = this.#topologicalSort()

           // Process in order
           sortedModules.forEach(module => module.process(from, to))
       }
   }
   ```

2. **Add More Module Types**
   - Oscillator, Filter, Envelope, LFO, etc.
   - Each module = simple processing unit

3. **Save/Load Module Chains**
   - Export modular chains as "custom effects"
   - Share between projects
   - Community effect library

4. **Simpler for Users**
   - Visual programming (drag-and-drop modules)
   - No coding required
   - Still limited to available modules

#### Option C: Scripting API Extension

1. **Extend Scripting API**
   ```typescript
   // Current (hardcoded):
   interface AudioEffects {
       "delay": DelayEffect
   }

   // Proposed (dynamic):
   interface AudioEffects {
       "delay": DelayEffect
       [key: string]: CustomEffect  // Allow custom effects
   }

   api.registerCustomEffect({
       name: "MyEffect",
       parameters: {...},
       process: (input, output, params) => {
           // DSP code here
       }
   })
   ```

2. **Safe Execution Context**
   - Sandboxed JavaScript (no DOM access)
   - Limited CPU budget
   - Memory constraints

3. **Built-in DSP Library**
   ```typescript
   import {Filter, Delay, Oscillator} from '@opendaw/dsp'

   api.registerCustomEffect({
       name: "CustomFilter",
       process: (input, output, params) => {
           const filter = new Filter.Lowpass(params.cutoff, params.resonance)
           filter.process(input, output)
       }
   })
   ```

### 2.8 Comparison: Custom TS vs WASM vs Built-in

| Aspect | Built-in TS | Custom TS Plugin | WASM Plugin |
|--------|-------------|------------------|-------------|
| **Development** | Requires codebase access | Plugin manifest + JS | Plugin manifest + C++ |
| **Performance** | Fast (JIT optimized) | Same as built-in | Fastest (AOT) |
| **Debugging** | Excellent | Good | Harder |
| **Distribution** | Compile into app | Load at runtime | Load at runtime |
| **Security** | Trusted | Needs sandbox | Needs sandbox |
| **Complexity** | Medium | Low-Medium | High |
| **Best for** | Core effects | User experiments | Complex DSP |

### 2.9 Recommended Path for Custom Effects

**Phase 1: Complete Modular System** (Easiest)
- Implement ModularDeviceProcessor
- Add more module types (filter, oscillator, envelope)
- Visual module editor
- Save/load module chains

**Phase 2: TypeScript Plugin API** (Medium effort)
- Define plugin manifest format
- Implement plugin loader with sandboxing
- Dynamic Box/Adapter generation
- Built-in DSP library for plugins

**Phase 3: WASM Plugin Support** (Advanced)
- Extend plugin system to support WASM
- C++ plugin template/SDK
- Performance-critical effects

**Reality Check**: Implementing a full plugin system is a **major undertaking** (months of work). The modular system is the most realistic path forward.

---

## 3. Chrome WASM+AudioWorklet Design Patterns

### 3.1 Pattern A: Synchronous WASM Loading

**Source:** [Chrome Blog - Audio Worklet Design Pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern)

**Approach:** Load Emscripten glue code directly into AudioWorkletGlobalScope

```javascript
// Main thread
await audioContext.audioWorklet.addModule('wasm-audio-processor.js')

// wasm-audio-processor.js (in AudioWorklet scope)
// Emscripten glue code with flags:
// -s BINARYEN_ASYNC_COMPILATION=0 (synchronous compilation)
// -s SINGLE_FILE=1 (inline WASM as base64)

class WASMProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        // Module is already compiled and ready
        this.wasmInstance = Module
    }

    process(inputs, outputs) {
        // Call WASM functions directly
        Module._processAudio(inputPtr, outputPtr, 128)
        return true
    }
}
```

**Pros:**
- ✅ Simple setup (single file)
- ✅ No async coordination needed
- ✅ WASM ready immediately in constructor

**Cons:**
- ❌ Requires Emscripten compilation flags
- ❌ WASM bundled as base64 (larger file size)
- ❌ Synchronous compilation may block audio thread briefly
- ❌ Limited browser support for sync compilation in worklets

**Feasibility for OpenDAW:** ⚠️ **Moderate** - Works but not ideal due to sync compilation concerns

---

### 3.2 Pattern B: Asynchronous WASM Transfer

**Approach:** Compile WASM on main thread, transfer via processorOptions

```javascript
// Main thread
const wasmModule = await WebAssembly.compileStreaming(fetch('effect.wasm'))

await audioContext.audioWorklet.addModule('wasm-processor.js')

const wasmProcessor = new AudioWorkletNode(audioContext, 'wasm-processor', {
    processorOptions: {
        wasmModule: wasmModule  // Transfer compiled module
    }
})

// wasm-processor.js (AudioWorklet)
class WASMProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super()
        this.ready = false

        WebAssembly.instantiate(options.processorOptions.wasmModule)
            .then(instance => {
                this.wasmInstance = instance
                this.ready = true
            })
    }

    process(inputs, outputs) {
        if (!this.ready) {
            return true  // Pass through until ready
        }

        // Call WASM
        this.wasmInstance.exports.processAudio(inputPtr, outputPtr, 128)
        return true
    }
}
```

**Pros:**
- ✅ Main thread compilation (no audio thread blocking)
- ✅ Avoids mid-stream glitches
- ✅ Standard WASM compilation (no special flags)
- ✅ Good browser support

**Cons:**
- ⚠️ Async initialization (graceful degradation needed)
- ⚠️ Pass-through until ready

**Feasibility for OpenDAW:** ✅ **High** - Best fit for OpenDAW's architecture

---

### 3.3 Pattern C: Worker + SharedArrayBuffer

**Approach:** Dedicated Worker thread for WASM, communicate via SharedArrayBuffer

```javascript
// Main thread
const worker = new Worker('wasm-worker.js')
const audioSAB = new SharedArrayBuffer(128 * 2 * Float32Array.BYTES_PER_ELEMENT)
const controlSAB = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 10)

worker.postMessage({audioSAB, controlSAB})

await audioContext.audioWorklet.addModule('worker-bridge-processor.js')

const processor = new AudioWorkletNode(audioContext, 'worker-bridge', {
    processorOptions: {audioSAB, controlSAB}
})

// wasm-worker.js (Worker thread)
let wasmInstance
const audioBuffer = new Float32Array(audioSAB)
const controlBuffer = new Int32Array(controlSAB)

WebAssembly.instantiateStreaming(fetch('effect.wasm'))
    .then(module => {
        wasmInstance = module.instance
        processLoop()  // Start processing
    })

function processLoop() {
    // Wait for signal from AudioWorklet
    Atomics.wait(controlBuffer, 0, 0)  // Block until signaled

    // Process audio in WASM
    wasmInstance.exports.processAudio(inputPtr, outputPtr, 128)

    // Signal completion
    Atomics.store(controlBuffer, 1, 1)
    Atomics.notify(controlBuffer, 1)

    processLoop()
}

// worker-bridge-processor.js (AudioWorklet)
class WorkerBridgeProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super()
        this.audioBuffer = new Float32Array(options.processorOptions.audioSAB)
        this.controlBuffer = new Int32Array(options.processorOptions.controlSAB)
    }

    process(inputs, outputs) {
        const input = inputs[0]
        const output = outputs[0]

        // Copy input to SAB
        this.audioBuffer.set(input[0], 0)
        this.audioBuffer.set(input[1], 128)

        // Signal worker
        Atomics.store(this.controlBuffer, 0, 1)
        Atomics.notify(this.controlBuffer, 0)

        // Wait for worker (with timeout to prevent blocking)
        const result = Atomics.wait(this.controlBuffer, 1, 0, 3)  // 3ms timeout

        if (result === 'ok') {
            // Copy output from SAB
            output[0].set(this.audioBuffer.subarray(0, 128))
            output[1].set(this.audioBuffer.subarray(128, 256))
        }

        return true
    }
}
```

**Pros:**
- ✅ Heavy processing off audio thread
- ✅ No 128-sample block size limitation for WASM
- ✅ Can use blocking operations in Worker
- ✅ Better for very expensive effects

**Cons:**
- ❌ Complex coordination with Atomics
- ❌ Latency from SAB copying and synchronization
- ❌ Risk of audio glitches if Worker is slow
- ❌ Requires SharedArrayBuffer (not all contexts support)

**Feasibility for OpenDAW:** ⚠️ **Moderate** - Useful for heavy effects, but complex

---

## 3. Feasibility Analysis

### 3.1 Technical Compatibility

| Aspect | Current OpenDAW | WASM Requirements | Compatibility |
|--------|----------------|-------------------|---------------|
| **AudioWorklet** | ✅ Already used | Required | ✅ Perfect match |
| **128-sample blocks** | ✅ RenderQuantum = 128 | Recommended | ✅ No changes needed |
| **Float32Array** | ✅ All audio buffers | WASM heap format | ✅ Compatible |
| **SharedArrayBuffer** | ✅ Control flags | Recommended for Pattern C | ✅ Already available |
| **Effect processor pattern** | ✅ Well-defined | Needs WASM wrapper | ⚠️ Minor adaptation |
| **Parameter system** | ✅ AutomatableParameter | Needs marshalling | ⚠️ Bridge needed |
| **Memory management** | ✅ Pre-allocated buffers | WASM heap | ⚠️ Heap copying needed |

**Overall Compatibility:** ✅ **Excellent** - No architectural blockers

### 3.2 Integration Points

**Where WASM would fit in OpenDAW:**

```typescript
// Current TypeScript effect
class DelayDeviceProcessor extends AudioProcessor {
    processAudio({bpm}: Block, from: number, to: number): void {
        this.#delayLines.process(source.channels(), output.channels(), from, to)
    }
}

// WASM-enhanced effect
class WASMDelayDeviceProcessor extends AudioProcessor {
    #wasmInstance: WebAssembly.Instance
    #heapInputPtr: number
    #heapOutputPtr: number

    async initialize(wasmModule: WebAssembly.Module) {
        this.#wasmInstance = await WebAssembly.instantiate(wasmModule)
        this.#heapInputPtr = this.#wasmInstance.exports.allocateInputBuffer(128 * 2)
        this.#heapOutputPtr = this.#wasmInstance.exports.allocateOutputBuffer(128 * 2)
    }

    processAudio({bpm}: Block, from: number, to: number): void {
        const [srcL, srcR] = this.source.channels()
        const [outL, outR] = this.#output.channels()

        // Copy to WASM heap
        const wasmHeap = new Float32Array(this.#wasmInstance.exports.memory.buffer)
        wasmHeap.set(srcL.subarray(from, to), this.#heapInputPtr / 4)
        wasmHeap.set(srcR.subarray(from, to), this.#heapInputPtr / 4 + 128)

        // Call WASM
        this.#wasmInstance.exports.processDelay(
            this.#heapInputPtr,
            this.#heapOutputPtr,
            to - from,
            this.parameterDelay.getValue()
        )

        // Copy from WASM heap
        outL.set(wasmHeap.subarray(this.#heapOutputPtr / 4, this.#heapOutputPtr / 4 + 128), from)
        outR.set(wasmHeap.subarray(this.#heapOutputPtr / 4 + 128, this.#heapOutputPtr / 4 + 256), from)
    }
}
```

**Integration changes needed:**
1. ✅ **Factory pattern**: Extend `DeviceProcessorFactory` to handle WASM processors
2. ✅ **Async initialization**: Add initialization step before first process() call
3. ✅ **Memory bridge**: HeapAudioBuffer helper class (like Chrome example)
4. ✅ **Parameter marshalling**: Convert AutomatableParameter values to WASM format

### 3.3 Performance Implications

**Current TypeScript Effect Performance:**
```
Compressor (complex):     ~0.15ms per 128-sample block
Delay (moderate):         ~0.08ms per 128-sample block
EQ (Revamp 7-band):       ~0.12ms per 128-sample block

Budget: 3ms at 44.1kHz (128 samples = 2.9ms)
Actual: ~0.5ms total for typical effect chain (6 effects)
Headroom: ~2.5ms available
```

**WASM Expected Performance:**

| Aspect | TypeScript | WASM | Difference |
|--------|-----------|------|------------|
| **Execution speed** | JIT optimized | AOT compiled | +10-30% faster |
| **GC pauses** | Occasional | None | ✅ More consistent |
| **Heap copying** | N/A | ~0.02ms per effect | ⚠️ -15% overhead |
| **Parameter passing** | Direct | Via heap | ⚠️ -5% overhead |
| **Net performance** | Baseline | **+5-20%** | ✅ Better |

**Conclusion:** WASM likely provides **modest performance improvement** (5-20%) for complex effects, with the benefit of **zero GC pauses** for more consistent timing.

### 3.4 Development Complexity

**Adding WASM effect requires:**

| Task | Complexity | Effort |
|------|-----------|--------|
| **Write C++ effect code** | Medium | 2-5 days |
| **Emscripten compilation setup** | Low | 0.5 day |
| **HeapAudioBuffer helper class** | Low | 0.5 day |
| **WASM processor wrapper** | Medium | 1-2 days |
| **Factory integration** | Low | 0.5 day |
| **Parameter bridge** | Medium | 1-2 days |
| **Testing & debugging** | High | 3-5 days |
| **Total** | **Medium-High** | **8-15 days** |

**Ongoing maintenance:**
- TypeScript effects: Easy to modify, good debugging
- WASM effects: Requires C++ knowledge, harder debugging

**Recommendation:** Use WASM for effects where:
1. Performance critical (e.g., FFT-based processing)
2. Existing C++ library available (e.g., Faust, JUCE)
3. Complex DSP algorithms benefit from low-level control

---

## 5. Integration Approaches

### 4.1 Approach 1: Hybrid TypeScript/WASM Effects

**Strategy:** Keep existing TypeScript effects, add WASM as optional enhancement

**Architecture:**
```typescript
// Abstract base for both TS and WASM effects
abstract class AudioProcessor {
    abstract processAudio(block: Block, from: number, to: number): void
}

// TypeScript implementation (current)
class DelayDeviceProcessor extends AudioProcessor {
    processAudio(block: Block, from: number, to: number): void {
        // Pure TS/JS
    }
}

// WASM implementation (new)
class WASMDelayDeviceProcessor extends AudioProcessor {
    #wasmInstance: WebAssembly.Instance

    processAudio(block: Block, from: number, to: number): void {
        // Bridge to WASM
    }
}

// Factory decides which to use
class DeviceProcessorFactory {
    static create(box: DelayDeviceBox): AudioEffectDeviceProcessor {
        if (box.useWASM.getValue() && wasmSupported()) {
            return new WASMDelayDeviceProcessor(context, adapter)
        }
        return new DelayDeviceProcessor(context, adapter)  // Fallback
    }
}
```

**Pros:**
- ✅ Gradual migration (one effect at a time)
- ✅ Fallback to TypeScript if WASM fails
- ✅ Easy A/B testing of performance
- ✅ No breaking changes

**Cons:**
- ⚠️ Maintaining two implementations per effect
- ⚠️ More complex factory logic

**Recommendation:** ✅ **Best for initial rollout**

---

### 4.2 Approach 2: WASM-Only Custom Effects

**Strategy:** Allow users to load custom WASM effects (plugin system)

**Architecture:**
```typescript
interface WASMEffectDescriptor {
    name: string
    wasmURL: string
    parameterDefinitions: ParameterDefinition[]
}

class CustomWASMEffectProcessor extends AudioProcessor {
    static async loadFromDescriptor(desc: WASMEffectDescriptor): Promise<CustomWASMEffectProcessor> {
        const wasmModule = await WebAssembly.compileStreaming(fetch(desc.wasmURL))
        return new CustomWASMEffectProcessor(wasmModule, desc.parameterDefinitions)
    }
}

// User workflow:
// 1. Compile C++ effect to WASM
// 2. Host .wasm file
// 3. Load in OpenDAW via descriptor JSON
```

**Pros:**
- ✅ Extensibility (user-provided effects)
- ✅ No need to recompile OpenDAW
- ✅ Community effect library potential

**Cons:**
- ❌ Security concerns (arbitrary WASM execution)
- ❌ Need sandboxing/validation
- ❌ Complex API definition

**Recommendation:** ⚠️ **Future enhancement** (after core WASM support stable)

---

### 4.3 Approach 3: Faust Integration

**Strategy:** Use [Faust](https://faust.grame.fr/) to compile DSP code to WASM

**Faust Workflow:**
```bash
# Write effect in Faust DSP language
echo 'import("stdfaust.lib"); process = dm.zita_light;' > reverb.dsp

# Compile to WASM + glue code
faust2wasm reverb.dsp
# Generates: reverb.wasm, reverb-processor.js
```

**Integration:**
```javascript
// Load Faust-generated WASM
await audioContext.audioWorklet.addModule('reverb-processor.js')

const reverbNode = new AudioWorkletNode(audioContext, 'reverb')

// Faust provides parameter API
reverbNode.parameters.get('roomSize').value = 0.8
```

**Pros:**
- ✅ High-level DSP language (easier than C++)
- ✅ Proven audio DSP library
- ✅ Auto-generates WASM + JavaScript glue
- ✅ Built-in parameter mapping

**Cons:**
- ⚠️ New language to learn (Faust)
- ⚠️ May not fit OpenDAW's parameter system
- ⚠️ Less control over implementation

**Recommendation:** ✅ **Excellent for rapid prototyping** of new effects

---

## 6. Implementation Strategy

### 5.1 Recommended Approach: Pattern B with Hybrid System

**Phase 1: Foundation (Week 1-2)**

1. **Create HeapAudioBuffer helper class**
   ```typescript
   class HeapAudioBuffer {
       #wasmMemory: WebAssembly.Memory
       #inputPtr: number
       #outputPtr: number

       constructor(wasmInstance: WebAssembly.Instance, channels: number, frames: number) {
           this.#wasmMemory = wasmInstance.exports.memory as WebAssembly.Memory
           this.#inputPtr = (wasmInstance.exports.allocate as Function)(channels * frames * 4)
           this.#outputPtr = (wasmInstance.exports.allocate as Function)(channels * frames * 4)
       }

       copyToHeap(audioBuffer: ReadonlyArray<Float32Array>, offset: number = 0): void {
           const heap = new Float32Array(this.#wasmMemory.buffer)
           audioBuffer.forEach((channel, i) => {
               heap.set(channel, this.#inputPtr / 4 + i * 128 + offset)
           })
       }

       copyFromHeap(audioBuffer: ReadonlyArray<Float32Array>, offset: number = 0): void {
           const heap = new Float32Array(this.#wasmMemory.buffer)
           audioBuffer.forEach((channel, i) => {
               channel.set(heap.subarray(
                   this.#outputPtr / 4 + i * 128 + offset,
                   this.#outputPtr / 4 + i * 128 + offset + 128
               ))
           })
       }

       free(): void {
           (this.#wasmInstance.exports.free as Function)(this.#inputPtr)
           (this.#wasmInstance.exports.free as Function)(this.#outputPtr)
       }
   }
   ```

2. **Create WASM module loader**
   ```typescript
   class WASMModuleCache {
       private static modules = new Map<string, WebAssembly.Module>()

       static async load(url: string): Promise<WebAssembly.Module> {
           if (this.modules.has(url)) {
               return this.modules.get(url)!
           }

           const module = await WebAssembly.compileStreaming(fetch(url))
           this.modules.set(url, module)
           return module
       }
   }
   ```

3. **Extend AudioWorklets factory**
   ```typescript
   class AudioWorklets {
       #wasmModules = new Map<string, WebAssembly.Module>()

       async loadWASMEffect(name: string, url: string): Promise<void> {
           const module = await WASMModuleCache.load(url)
           this.#wasmModules.set(name, module)
       }

       getWASMModule(name: string): WebAssembly.Module | undefined {
           return this.#wasmModules.get(name)
       }
   }
   ```

**Phase 2: First WASM Effect (Week 3-4)**

1. **Choose simple effect for proof-of-concept**
   - Recommendation: **Crusher** (bit crusher)
   - Simple algorithm, no state, easy to verify

2. **Write C++ implementation**
   ```cpp
   // crusher.cpp
   #include <emscripten/emscripten.h>
   #include <cmath>

   extern "C" {
       EMSCRIPTEN_KEEPALIVE
       void processCrusher(
           float* input,
           float* output,
           int numFrames,
           float bitDepth,      // 1-16
           float sampleRateDivisor  // 1-100
       ) {
           const float quantizationStep = std::pow(2.0f, bitDepth);
           int sampleCounter = 0;
           float heldSample = 0.0f;

           for (int i = 0; i < numFrames * 2; ++i) {  // Stereo
               // Sample rate reduction
               if (sampleCounter % (int)sampleRateDivisor == 0) {
                   heldSample = input[i];
               }

               // Bit depth reduction
               float quantized = std::floor(heldSample * quantizationStep) / quantizationStep;
               output[i] = quantized;

               sampleCounter++;
           }
       }

       EMSCRIPTEN_KEEPALIVE
       float* allocate(int size) {
           return new float[size];
       }

       EMSCRIPTEN_KEEPALIVE
       void free(float* ptr) {
           delete[] ptr;
       }
   }
   ```

3. **Compile with Emscripten**
   ```bash
   emcc crusher.cpp \
       -O3 \
       -s WASM=1 \
       -s EXPORTED_FUNCTIONS='["_processCrusher","_allocate","_free"]' \
       -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
       -o crusher.js
   ```

4. **Create TypeScript wrapper**
   ```typescript
   class WASMCrusherDeviceProcessor extends AudioProcessor {
       #wasmInstance: WebAssembly.Instance | null = null
       #heapBuffer: HeapAudioBuffer | null = null
       #ready: boolean = false

       readonly parameterBitDepth: AutomatableParameter<number>
       readonly parameterSampleRate: AutomatableParameter<number>

       constructor(context: EngineContext, adapter: CrusherDeviceBoxAdapter) {
           super(context, adapter)
           this.parameterBitDepth = this.bindParameter(adapter.bitDepthField)
           this.parameterSampleRate = this.bindParameter(adapter.sampleRateField)

           // Initialize WASM asynchronously
           this.#initWASM().catch(err => {
               console.error("WASM init failed, falling back to passthrough", err)
           })
       }

       async #initWASM(): Promise<void> {
           const wasmModule = await WASMModuleCache.load('/effects/crusher.wasm')
           this.#wasmInstance = await WebAssembly.instantiate(wasmModule)
           this.#heapBuffer = new HeapAudioBuffer(this.#wasmInstance, 2, 128)
           this.#ready = true
       }

       processAudio(_block: Block, from: number, to: number): void {
           if (!this.#ready || !this.#wasmInstance || !this.#heapBuffer) {
               // Passthrough until ready
               this.#output.replaceWith(this.source)
               return
           }

           const [srcL, srcR] = this.source.channels()
           const [outL, outR] = this.#output.channels()

           // Copy to WASM heap
           this.#heapBuffer.copyToHeap([srcL, srcR])

           // Call WASM
           const processCrusher = this.#wasmInstance.exports.processCrusher as Function
           processCrusher(
               this.#heapBuffer.inputPtr,
               this.#heapBuffer.outputPtr,
               to - from,
               this.parameterBitDepth.getValue(),
               this.parameterSampleRate.getValue()
           )

           // Copy from WASM heap
           this.#heapBuffer.copyFromHeap([outL, outR])
       }
   }
   ```

**Phase 3: Integration & Testing (Week 5-6)**

1. **Add factory support**
2. **Performance benchmarking** (TS vs WASM)
3. **Memory leak testing**
4. **Cross-browser validation**

**Phase 4: Advanced Effects (Week 7+)**

1. **Complex effects** (Reverb, Vocoder, etc.)
2. **Ring buffer for non-128 block sizes** (if needed)
3. **Worker pattern** for heavy effects (optional)

---

### 5.2 Emscripten Build Configuration

**Recommended flags:**
```bash
emcc effect.cpp \
    -O3 \                              # Optimize for speed
    -s WASM=1 \                        # Generate WASM
    -s ALLOW_MEMORY_GROWTH=1 \         # Dynamic memory
    -s EXPORTED_FUNCTIONS='[...]' \    # Export C functions
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
    -s MODULARIZE=1 \                  # ES6 module
    -s EXPORT_NAME='createModule' \    # Factory function
    -s ENVIRONMENT='web,worker' \      # Target environments
    --no-entry \                       # No main() needed
    -o effect.js
```

**For Pattern B (Async Transfer), add:**
```bash
    -s WASM_ASYNC_COMPILATION=0        # Allow sync instantiate
```

---

## 7. Performance Considerations

### 6.1 Heap Copying Overhead

**Benchmark: Copying 128 stereo samples**
```typescript
// Copying to WASM heap (256 floats)
const heap = new Float32Array(wasmMemory.buffer)
heap.set(inputL, inputPtr / 4)        // ~0.005ms
heap.set(inputR, inputPtr / 4 + 128)  // ~0.005ms

// Copying from WASM heap
outputL.set(heap.subarray(outputPtr / 4, outputPtr / 4 + 128))      // ~0.005ms
outputR.set(heap.subarray(outputPtr / 4 + 128, outputPtr / 4 + 256))  // ~0.005ms

// Total overhead: ~0.02ms per effect
```

**Impact:**
- 6 WASM effects: ~0.12ms overhead
- Budget: 3ms at 44.1kHz
- Overhead: **4% of budget** (acceptable)

### 6.2 Parameter Passing Optimization

**Option 1: Pass via function arguments** (simple)
```cpp
void processEffect(float* input, float* output, int frames, float param1, float param2)
```
- Overhead: ~0.001ms per call
- Best for: 1-5 parameters

**Option 2: Shared parameter struct** (efficient for many params)
```cpp
struct EffectParams {
    float threshold;
    float ratio;
    float attack;
    // ... 20 more params
};

void processEffect(float* input, float* output, int frames, EffectParams* params)
```
- Overhead: ~0.002ms (single pointer dereference)
- Best for: 5+ parameters

**Recommendation:** Use Option 1 for most effects, Option 2 for complex processors like compressors

### 6.3 Memory Growth Strategy

**Static allocation** (recommended for fixed-size effects):
```cpp
// Allocate once during initialization
float* delayBuffer = new float[MAX_DELAY_SAMPLES];
```

**Dynamic allocation** (for variable-size effects):
```bash
emcc -s ALLOW_MEMORY_GROWTH=1  # Enable dynamic growth
```
- Slightly slower (~2% overhead)
- Necessary for effects with user-configurable buffer sizes

---

### 6.4 Zero-Copy Future: AudioWorklet + SharedArrayBuffer

**Current bottleneck:** Copying between JS Float32Array ↔ WASM heap

**Future proposal** (not yet standardized):
```typescript
// Hypothetical zero-copy API
class WASMProcessor extends AudioWorkletProcessor {
    process(inputs, outputs) {
        // Direct access to WASM linear memory as audio buffer
        const wasmAudioBuffer = new Float32Array(
            this.wasmInstance.exports.memory.buffer,
            this.audioBufferOffset,
            128 * 2
        )

        // Zero-copy: AudioWorklet reads directly from WASM memory
        outputs[0][0] = wasmAudioBuffer.subarray(0, 128)
        outputs[0][1] = wasmAudioBuffer.subarray(128, 256)

        return true
    }
}
```

**When available:** ~2026+ (speculative)
**Performance gain:** Eliminate ~0.02ms overhead per effect

---

## 8. Code Examples

### 7.1 Complete Example: WASM Gain Effect

**C++ Implementation (gain.cpp):**
```cpp
#include <emscripten/emscripten.h>

extern "C" {
    // Simple gain effect
    EMSCRIPTEN_KEEPALIVE
    void processGain(
        float* input,      // Interleaved stereo [L0,R0,L1,R1,...]
        float* output,
        int numFrames,     // 128
        float gainDB       // Gain in decibels
    ) {
        const float gain = std::pow(10.0f, gainDB / 20.0f);  // dB to linear
        const int numSamples = numFrames * 2;  // Stereo

        for (int i = 0; i < numSamples; ++i) {
            output[i] = input[i] * gain;
        }
    }

    EMSCRIPTEN_KEEPALIVE
    float* allocate(int size) {
        return new float[size];
    }

    EMSCRIPTEN_KEEPALIVE
    void deallocate(float* ptr) {
        delete[] ptr;
    }
}
```

**Compile:**
```bash
emcc gain.cpp \
    -O3 \
    -s WASM=1 \
    -s EXPORTED_FUNCTIONS='["_processGain","_allocate","_deallocate"]' \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='createGainModule' \
    -o gain.js
```

**TypeScript Wrapper (WASMGainProcessor.ts):**
```typescript
import {AudioProcessor} from './AudioProcessor'
import {HeapAudioBuffer} from './HeapAudioBuffer'
import {AutomatableParameter} from './AutomatableParameter'
import type {EngineContext} from './EngineContext'
import type {GainDeviceBoxAdapter} from '../adapters'
import type {Block} from './Block'

export class WASMGainDeviceProcessor extends AudioProcessor {
    readonly parameterGain: AutomatableParameter<number>

    #wasmInstance: WebAssembly.Instance | null = null
    #heapBuffer: HeapAudioBuffer | null = null
    #ready: boolean = false

    constructor(
        context: EngineContext,
        adapter: GainDeviceBoxAdapter
    ) {
        super(context, adapter)
        this.parameterGain = this.bindParameter(adapter.gainField)
        this.#initWASM(context)
    }

    async #initWASM(context: EngineContext): Promise<void> {
        try {
            // Get pre-loaded WASM module from context
            const wasmModule = context.audioWorklets.getWASMModule('gain')
            if (!wasmModule) {
                throw new Error('Gain WASM module not loaded')
            }

            // Instantiate
            this.#wasmInstance = await WebAssembly.instantiate(wasmModule)

            // Allocate heap buffers
            this.#heapBuffer = new HeapAudioBuffer(this.#wasmInstance, 2, 128)

            this.#ready = true
        } catch (err) {
            console.error('Failed to initialize WASM gain processor:', err)
            // Will fall back to passthrough
        }
    }

    processAudio(_block: Block, from: number, to: number): void {
        const [srcL, srcR] = this.source.channels()
        const [outL, outR] = this.#output.channels()

        if (!this.#ready || !this.#wasmInstance || !this.#heapBuffer) {
            // Passthrough until WASM ready
            outL.set(srcL.subarray(from, to), from)
            outR.set(srcR.subarray(from, to), from)
            return
        }

        // Copy to WASM heap (interleaved)
        const heap = new Float32Array(this.#wasmInstance.exports.memory.buffer)
        const inputPtr = this.#heapBuffer.inputPtr / 4
        const outputPtr = this.#heapBuffer.outputPtr / 4

        for (let i = 0; i < to - from; i++) {
            heap[inputPtr + i * 2] = srcL[from + i]
            heap[inputPtr + i * 2 + 1] = srcR[from + i]
        }

        // Call WASM
        const processGain = this.#wasmInstance.exports.processGain as CallableFunction
        processGain(
            this.#heapBuffer.inputPtr,
            this.#heapBuffer.outputPtr,
            to - from,
            this.parameterGain.getValue()
        )

        // Copy from WASM heap (deinterleave)
        for (let i = 0; i < to - from; i++) {
            outL[from + i] = heap[outputPtr + i * 2]
            outR[from + i] = heap[outputPtr + i * 2 + 1]
        }
    }

    terminate(): void {
        this.#heapBuffer?.free()
        super.terminate()
    }
}
```

**Main Thread Loading:**
```typescript
// In AudioWorklets initialization
const audioWorklets = await AudioWorklets.createFor(audioContext)

// Pre-load WASM modules
await audioWorklets.loadWASMEffect('gain', '/effects/gain.wasm')
await audioWorklets.loadWASMEffect('crusher', '/effects/crusher.wasm')
// ... more effects
```

---

### 7.2 Parameter Bridge Pattern

**For complex parameter sets:**

```typescript
class WASMParameterBridge {
    #paramStructPtr: number
    #wasmMemory: WebAssembly.Memory

    constructor(wasmInstance: WebAssembly.Instance, paramCount: number) {
        this.#wasmMemory = wasmInstance.exports.memory as WebAssembly.Memory
        const allocate = wasmInstance.exports.allocate as Function
        this.#paramStructPtr = allocate(paramCount * 4)  // 4 bytes per float
    }

    updateParameter(index: number, value: number): void {
        const heap = new Float32Array(this.#wasmMemory.buffer)
        heap[this.#paramStructPtr / 4 + index] = value
    }

    getParameterStructPtr(): number {
        return this.#paramStructPtr
    }

    free(): void {
        const deallocate = (this.#wasmInstance.exports.deallocate as Function)
        deallocate(this.#paramStructPtr)
    }
}

// Usage in processor
class WASMCompressorProcessor extends AudioProcessor {
    #paramBridge: WASMParameterBridge

    parameterChanged(parameter: AutomatableParameter<any>): void {
        // Map parameter to index
        const paramIndex = this.#parameterIndexMap.get(parameter)!
        this.#paramBridge.updateParameter(paramIndex, parameter.getValue())
    }

    processAudio(block: Block, from: number, to: number): void {
        // Pass parameter struct pointer to WASM
        this.#wasmInstance.exports.processCompressor(
            inputPtr,
            outputPtr,
            frames,
            this.#paramBridge.getParameterStructPtr()  // Single pointer!
        )
    }
}
```

---

## 9. Recommendations

### 8.1 Implementation Priority

**Tier 1: High-value WASM candidates** (implement first)
1. ✅ **FFT-based effects** (Vocoder, Phase Vocoder, Spectral processing)
   - Reason: Complex math, significant performance gain
2. ✅ **Convolution Reverb** (impulse response processing)
   - Reason: Heavy computation, existing C++ libraries
3. ✅ **Physical Modeling** (String/Drum synthesis)
   - Reason: Real-time differential equations benefit from WASM

**Tier 2: Moderate-value** (consider after Tier 1)
1. ⚠️ **Compressor with lookahead**
   - Reason: Already fast in TS, marginal gain
2. ⚠️ **Multi-band EQ**
   - Reason: Biquad filters already optimized

**Tier 3: Low-value** (keep as TypeScript)
1. ❌ **Simple effects** (Gain, Pan, Mute)
   - Reason: Heap overhead > execution savings
2. ❌ **State-heavy effects** (Delay with large buffers)
   - Reason: Memory management complexity

### 8.2 Best Practices

**DO:**
- ✅ Use Pattern B (Async Transfer) for initial implementation
- ✅ Always provide TypeScript fallback
- ✅ Pre-allocate WASM heap buffers
- ✅ Measure performance before/after
- ✅ Use Emscripten's optimized math library
- ✅ Leverage existing C++ DSP libraries (Faust, JUCE-based)

**DON'T:**
- ❌ Use Pattern A (Sync Loading) - browser compatibility issues
- ❌ Allocate in audio thread (use pre-allocated buffers)
- ❌ Use Pattern C (Worker) for simple effects (overkill)
- ❌ Convert all effects to WASM (unnecessary for simple ones)
- ❌ Forget to free WASM memory on processor termination

### 8.3 Debugging Strategy

**WASM debugging challenges:**
1. No console.log in C++
2. Stack traces less readable
3. Memory errors harder to diagnose

**Solutions:**
```cpp
// Enable debug logging
#ifdef DEBUG
#include <stdio.h>
#define LOG(fmt, ...) printf(fmt "\n", ##__VA_ARGS__)
#else
#define LOG(fmt, ...)
#endif

void processEffect(...) {
    LOG("Processing %d frames with gain %f", numFrames, gain);
}
```

Compile with debug symbols:
```bash
emcc -g4 effect.cpp ...  # Include DWARF debug info
```

Use browser DevTools:
- Chrome: WASM debugging in Sources panel
- Firefox: WASM debugging with sourcemaps

### 8.4 Security Considerations

**If allowing user-provided WASM:**
1. ⚠️ **Sandboxing**: WASM is already sandboxed, but validate:
   - Memory access bounds
   - No network access
   - CPU time limits
2. ⚠️ **Code signing**: Verify WASM module signatures
3. ⚠️ **Resource limits**:
   - Max memory allocation
   - Max processing time per block

---

## 10. Conclusion

### 9.1 Feasibility Summary

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Technical Feasibility** | ✅ **High** | No architectural blockers |
| **Performance Benefit** | ⚠️ **Moderate** | 5-20% for complex effects |
| **Development Effort** | ⚠️ **Moderate** | 8-15 days for first effect |
| **Maintenance** | ⚠️ **Medium** | C++ debugging harder than TS |
| **Browser Support** | ✅ **Excellent** | WASM+AudioWorklet widely supported |
| **Integration** | ✅ **Clean** | Fits existing architecture well |

**Overall Recommendation:** ✅ **Proceed with Pattern B implementation**

### 9.2 Roadmap

**Q1 2025: Foundation**
- Implement HeapAudioBuffer helper
- Add WASM loader to AudioWorklets
- Create first proof-of-concept (Crusher effect)
- Benchmark performance

**Q2 2025: Expansion**
- Port 2-3 complex effects (FFT-based, Convolution)
- Add Faust integration for rapid prototyping
- Performance optimization

**Q3 2025: Polish**
- User-facing WASM effect loading (if desired)
- Documentation and examples
- Community effect library

### 9.3 Final Thoughts

WASM integration in OpenDAW is **highly feasible** and offers meaningful benefits for specific effect types. The recommended Pattern B (Async Transfer) approach aligns well with OpenDAW's existing architecture while providing a clean migration path. The key is to be **selective** - use WASM where it provides clear value (complex DSP, existing C++ libraries) while keeping simpler effects in TypeScript for maintainability.

The existing AudioWorklet infrastructure, parameter system, and effect chain architecture are all WASM-ready, making this a natural evolution of OpenDAW's capabilities rather than a disruptive change.

---

## Appendix A: Reference Implementation Checklist

**Pre-implementation:**
- [ ] Choose target effect (recommend: Crusher or FFT-based)
- [ ] Set up Emscripten toolchain
- [ ] Create benchmark suite (TS vs WASM comparison)

**Core implementation:**
- [ ] Implement HeapAudioBuffer class
- [ ] Add WASM loader to AudioWorklets
- [ ] Write C++ effect code
- [ ] Compile to WASM with optimizations
- [ ] Create TypeScript processor wrapper
- [ ] Add factory support

**Testing:**
- [ ] Unit tests for WASM processor
- [ ] Memory leak tests (valgrind equivalent)
- [ ] Performance benchmarks
- [ ] Cross-browser validation (Chrome, Firefox, Safari)
- [ ] Audio quality comparison (TS vs WASM output identical?)

**Integration:**
- [ ] Update DeviceProcessorFactory
- [ ] Add UI toggle (WASM vs TS) for A/B testing
- [ ] Documentation
- [ ] Example WASM effects repository

**Optimization:**
- [ ] Profile with Chrome DevTools
- [ ] Optimize heap copying if needed
- [ ] Consider Worker pattern for heavy effects

---

## Appendix B: Further Reading

**Official Documentation:**
- [AudioWorklet Specification](https://webaudio.github.io/web-audio-api/#AudioWorklet)
- [WebAssembly Specification](https://webassembly.github.io/spec/)
- [Emscripten Documentation](https://emscripten.org/docs/)

**Chrome Design Pattern Article:**
- [Audio Worklet Design Pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern)

**Related Projects:**
- [Faust](https://faust.grame.fr/) - DSP language with WASM target
- [JUCE](https://juce.com/) - C++ audio framework (WASM support experimental)
- [AudioWorklet Polyfill](https://github.com/GoogleChromeLabs/audioworklet-polyfill)

**Performance:**
- [WebAssembly Performance](https://v8.dev/blog/webassembly-performance)
- [Audio Rendering Performance](https://webaudio.github.io/web-audio-api/#rendering-loop)
