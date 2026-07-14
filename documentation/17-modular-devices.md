# Modular Devices

> **Skip if:** you don't intend to use scriptable DSP. The built-in instruments and effects (Tape, Vaporisateur, Compressor, Reverb, …) cover almost every common workflow without writing code.
>
> **Prerequisites:** [Ch. 04 (Box System)](./04-box-system-and-reactivity.md), [Ch. 11 (Effects)](./11-effects.md) for the effect-chain mechanics, [Ch. 16 (MIDI)](./16-midi.md) if you're writing an instrument.

Three devices in openDAW are **modular** — their behaviour is defined by a user-supplied JavaScript script, not by hard-coded DSP. They share the same scripting model: a `code` string field on the device box, a `@param` system for automatable parameters, a `@sample` system for asset references, and an SDK-supplied compiler that turns the script into a runtime processor.

| Device | Role | Use when |
|---|---|---|
| **Apparat** | Scriptable **instrument** — receives MIDI notes, produces audio | You want a custom synth |
| **Werkstatt** | Scriptable **audio effect** — receives stereo audio, produces stereo audio | You want a custom effect (filter, distortion, anything DSP) |
| **Spielwerk** | Scriptable **MIDI effect** — receives notes, produces notes | You want a custom MIDI transformer (algorithmic patterns, custom arpeggios, generative sequences) |

This chapter is the cross-cutting reference. The deep dives live elsewhere: Werkstatt and Spielwerk in [Ch. 11](./11-effects.md#werkstatt) / [Ch. 11](./11-effects.md#spielwerk), and Apparat in [Ch. 20](./20-apparat.md) (it's an instrument, not an effect, so it gets its own chapter).

## Picking the right one

A quick decision chart:

```
Your script needs to react to MIDI notes
  ├─ and produce audio?           → Apparat   (an instrument)
  ├─ and produce more notes?      → Spielwerk (a MIDI effect)
  └─ neither / not interested?    → ...

Your script processes audio (no MIDI)
  └─                              → Werkstatt (an audio effect)
```

A few crosscut consequences:

- **Apparat** sits where the instrument sits in an `AudioUnit` — it's the *source* of audio for that track. Same slot as Vaporisateur, Soundfont, Tape, etc.
- **Werkstatt** is inserted on the audio-effect chain, after the instrument or another effect. Same slot as Compressor, Reverb, etc.
- **Spielwerk** is inserted on the MIDI-effect chain, before the instrument. Same slot as Arpeggio, Pitch, etc.

You can stack any combination: a track could have Apparat (instrument) → Werkstatt (effect) with Spielwerk (MIDI effect) feeding the instrument. The chains stay separate; the modular nature doesn't change the wiring.

## The shared scripting model

All three modular devices have three box fields:

| Field | Type | Meaning |
|---|---|---|
| `code` | `StringField` | The JavaScript source |
| `parameters` | `Field<Parameter>` | Points at the auto-generated parameter boxes (one per `// @param` declaration) |
| `samples` | `Field<Sample>` | Points at the auto-generated sample boxes (one per `// @sample` declaration) |

When you assign a new value to `code`, you don't get a runtime update automatically — the SDK has a compile step that:

1. Parses a header line in the script for metadata (name, version, update rate).
2. Reads `// @param` and `// @sample` declarations.
3. Reconciles the existing parameter/sample boxes with the declarations (adds missing ones, removes orphaned ones).
4. Evaluates the script to produce a runtime processor instance.

The compiler lives in `@opendaw/studio-adapters` (`ScriptCompiler.create({...})`); the same machinery powers all three devices. Werkstatt's instance is configured with header tag `werkstatt`, Apparat's with `apparat`, Spielwerk's with `spielwerk`.

### Headers

The first line of a *compiled* device's `code` is a header the **compiler writes** — you never author it, and the source you pass to `compile()` needs none (an existing header is stripped and replaced):

```javascript
// @werkstatt js <compilerVersion> <update>   // audio effects
// @apparat   js <compilerVersion> <update>   // instruments
// @spielwerk js <compilerVersion> <update>   // MIDI effects
```

`<update>` is a monotonically increasing compile counter: the runtime processor watches the `code` field, and a new update number is its cue to swap to the freshly registered script. Headerless code in the field is simply *uncompiled* — the processor ignores it (this is why writing `code` directly does nothing audible; see [Hot reload](#hot-reload)).

### Parameters (`// @param`)

A parameter declaration is a single-line comment with space-separated tokens:

```javascript
// @param cutoff 1000 20 20000 exp Hz
const cutoff = 1000;
```

Format: `// @param <name> <default> <min> <max> [mapping] [unit]`. Tokens are positional:
`mapping` (when supplied) must be one of `linear | exp | int | bool`, optionally followed by
`unit`. Omit `min`/`max` for a 0–1 control — a bare `// @param depth 0.5` defaults to a
unipolar (0–1) mapping (which can't be named explicitly). The compiler registers one
parameter box per declaration on the device — all three devices share the same
`WerkstattParameterBox` class (there are no Apparat/Spielwerk-specific parameter boxes) — which:

- Appears in the device's parameter list (visible to the UI inspector).
- Is *automatable* — automation lanes wire up against the box, same as built-in effect parameters.
- Reaches your script via `paramChanged(label, value)` and/or a per-call object (depending on device).

The exact arg shape varies per device — see [Ch. 11 — Werkstatt parameters](./11-effects.md#werkstatt) for the audio side, [Ch. 20](./20-apparat.md#parameters) for instruments.

### Samples (`// @sample`)

A sample declaration is a plain-token line comment (same style as `@param`, not a function call). It registers a sample slot on the device and makes the loaded audio available to the script:

```javascript
// @sample kick
```

In the script, you access loaded samples via `this.samples.kick` — `null` until audio is loaded, then an `AudioData` with `frames` (one `Float32Array` per channel), `sampleRate`, `numberOfFrames`, and `numberOfChannels`.

Status in current SDK:

- **Apparat** — `@sample` fully wired. `this.samples.<name>` returns audio data the script can consume.
- **Werkstatt** — `@sample` registers a drop target but the data is *not yet* exposed to the processor. Use samples in Apparat for now; the wiring is planned for Werkstatt.
- **Spielwerk** — `@sample` not applicable; MIDI effects don't consume audio.

## Apparat — scriptable instrument

Covered in detail at [Ch. 20 — Apparat](./20-apparat.md). Summary of where Apparat differs from the other two:

- **Slot:** the instrument slot of an `AudioUnit` — created with `project.api.createInstrument(InstrumentFactories.Apparat)`, not `insertEffect`.
- **Input:** MIDI note events. The script's `Processor` class implements `noteOn(pitch, velocity, cent, id)` / `noteOff(id)` alongside `process(output, block)`, and manages its own voices.
- **Output:** stereo audio. The output buffers arrive zero-filled each block; voices *add* into them.
- **Samples:** `@sample` is fully wired — `this.samples.<name>` returns the loaded audio data.

Practical Apparat use cases: custom synths (subtractive, FM, physical modelling), experimental samplers, generative sound sources — anything where notes go in and audio comes out. See the [Apparat Demo](https://opendaw-test.pages.dev/apparat-demo.html) for four working synth engines.

## Werkstatt — scriptable audio effect

Covered in detail at [Ch. 11 — Werkstatt](./11-effects.md#werkstatt). Summary of where Werkstatt differs from Apparat:

- **Header:** compiler-written `// @werkstatt js <compilerVersion> <update>` (see [Headers](#headers)).
- **Input:** receives audio (no MIDI). Your script's `process()` reads from the input buffer and writes to the output.
- **No `noteOn`/`noteOff`.** Audio in, audio out.
- **Sample data:** the `@sample` drop target works but, as noted above, the data isn't currently routed to the processor. Plan around this until upstream fixes it.

Practical Werkstatt use cases: custom filters, wave-shapers, distortion, granular processors, anything where you can express the per-sample (or per-block) transformation in code.

## Spielwerk — scriptable MIDI effect

Covered in detail at [Ch. 11 — Spielwerk](./11-effects.md#spielwerk). Summary:

- **Header:** compiler-written `// @spielwerk js <compilerVersion> <update>` (see [Headers](#headers)).
- **Input/output:** notes only. The engine routes incoming note events (from the region or upstream MIDI effects) through your script, which decides what notes to emit.
- **No audio.** Spielwerk doesn't produce audio; its output feeds the next stage of the MIDI chain (or the instrument).

Practical Spielwerk use cases: custom arpeggios (more flexible than the built-in Arpeggio), algorithmic sequencers (Euclidean rhythms, fractal patterns), generative composition rules ("turn every minor third into a perfect fifth"), live randomisers.

## Hot reload

Recompiling is **not** done by writing `code` directly — `apparatBox.code.setValue(src)` stores
the string but never registers a worklet module, so the processor keeps running the old code.
Use `ScriptCompiler.compile()`, which wraps the source, registers it via `audioWorklet.addModule()`,
and writes the numbered header back to `code`. It is async — call it **outside** `editing.modify()`:

```typescript
import { ScriptCompiler } from "@opendaw/studio-adapters";

const compiler = ScriptCompiler.create({ /* headerTag, registryName, functionName */ });
await compiler.compile(audioContext, project.editing, apparatBox, newScriptText);
```

On compile, the `ScriptCompiler` validates the source, writes the new code + reconciled parameter/sample boxes in one transaction, and registers the worklet module; the runtime processor swaps to the new script between blocks (held voices are cut, current parameter values are re-pushed). Failure modes differ by stage: a **syntax error** throws before the box is touched — the previous script keeps playing; a **post-validation failure** (e.g. a top-level runtime error in the script body) rejects *after* the box was mutated and leaves the device silent until the next successful compile. See [Ch. 20 — compiling, hot-swap, and failure modes](./20-apparat.md#compiling-hot-swap-and-failure-modes) for the details and a recovery pattern.

This means you can build iterative-editor UIs: a code editor in your app, a "compile" button that calls `compiler.compile(...)` with the editor's contents, and the engine just keeps running while the user iterates.

## Parameter automation

Same as any other automatable parameter ([Ch. 09](./09-editing-fades-and-automation.md)). When the user (or a `ValueEventCollectionBox`) drives a `@param`-declared parameter, your script's `paramChanged(label, value)` is called sample-accurately at automation events, and the per-block update-rate ticks. You don't have to do anything extra to make automation work — the SDK's parameter system treats your `@param` declarations exactly like a hard-coded effect parameter.

## Persistence and project-file shape

When a project saves, the modular device's `code` (including the compiler-written header), `parameters`, and `samples` go into the `.od` file alongside the rest of the box graph. There's no "compiled bytecode" cached — the script is the source of truth. After loading a project, call `compiler.load(audioContext, deviceBox)` to re-register already-compiled code with the worklet (it's a no-op for never-compiled code); nothing recompiles automatically.

Two practical consequences:

- **Scripts travel with the project.** Sharing a `.od` file shares your scripts.
- **A broken script doesn't break the project file.** It just makes that device silent (with a console error) until you fix the script.

## When *not* to use a modular device

Almost every common DSP need has a non-modular built-in:

| Need | Built-in | Don't write |
|---|---|---|
| Subtractive synth | Vaporisateur | …a basic VA in Apparat |
| Audio playback | Tape | …a sample player in Werkstatt |
| Sample-based instrument | Soundfont, Playfield | …a soundfont reader in Apparat |
| Compression / EQ / reverb / delay | Compressor / Revamp / Reverb / Delay | …any of those in Werkstatt |
| MIDI transposition / arpeggiation | Pitch / Arpeggio | …a transposer or arpeggio in Spielwerk |

Reach for modular devices when the built-ins genuinely don't cover what you need — custom DSP, algorithmic music, experimental sound. The performance ceiling is lower than the C++/Rust audio plugins in a native DAW (you're running JavaScript in a worklet), so use them where their flexibility matters more than peak performance.

## Further reading

- [Ch. 20 — Apparat](./20-apparat.md) — full Apparat programming model: the `Processor` class, voices, live MIDI input, compile/hot-swap semantics.
- [Ch. 11 — Werkstatt](./11-effects.md#werkstatt) — full Werkstatt programming model, parameter declarations, the `Processor` class shape for audio effects.
- [Ch. 11 — Spielwerk](./11-effects.md#spielwerk) — full Spielwerk programming model for MIDI effects.
- [Ch. 15 — Performance & Debugging](./15-performance-and-debugging.md) — DSP-load profiling for "is my Apparat script too heavy?"
- [Ch. 16 — MIDI Deep Dive](./16-midi.md) — how notes reach Apparat (and how Spielwerk gets between regions and the instrument).
- [internals/05 — Devices and Effects](./internals/05-devices-and-effects.md#modular-devices) — for the implementation side of modular devices.
- [Werkstatt Demo](https://opendaw-test.pages.dev/werkstatt-demo.html) and [Apparat Demo](https://opendaw-test.pages.dev/apparat-demo.html) — runnable examples in this repo.
