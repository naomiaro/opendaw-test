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

This chapter is the cross-cutting reference. The deep dives for Werkstatt and Spielwerk live in [Ch. 11](./11-effects.md#werkstatt) and [Ch. 11](./11-effects.md#spielwerk); the Apparat coverage that's missing from Ch. 11 (because Apparat is an instrument, not an effect) lives here.

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

Each device requires a header on the first line of its `code`:

```javascript
// @werkstatt <name> <version> <updateRate>   // audio effects
// @apparat   <name> <version> <updateRate>   // instruments
// @spielwerk <name> <version> <updateRate>   // MIDI effects
```

- `<name>` — any identifier, used for the compiled processor's registry slot.
- `<version>` — integer; bumping forces a recompile.
- `<updateRate>` — how often the engine calls back into the script for parameter updates, in samples (e.g. `64` for sub-block updates, `128` for once per quantum).

The compiler rejects scripts missing the header.

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
`*ParameterBox` per declaration (`WerkstattParameterBox`, `ApparatParameterBox`, etc.) on the device, which:

- Appears in the device's parameter list (visible to the UI inspector).
- Is *automatable* — automation lanes wire up against the box, same as built-in effect parameters.
- Reaches your script via `paramChanged(label, value)` and/or a per-call object (depending on device).

The exact arg shape varies per device — see [Ch. 11 — Werkstatt parameters](./11-effects.md#werkstatt) for the audio side, the Apparat example below for instruments.

### Samples (`// @sample`)

A sample declaration registers a drop-target on the device's UI panel and makes the loaded audio available to the script:

```javascript
// @sample("kick")
```

In the script, you access loaded samples via `this.samples.kick` — a `Nullable<AudioData>` (the result is `null` until the user drops a file). The audio is `Float32Array[]` per channel with a known `sampleRate` and `numberOfFrames`.

Status in current SDK:

- **Apparat** — `@sample` fully wired. `this.samples.<name>` returns audio data the script can consume.
- **Werkstatt** — `@sample` registers a drop target but the data is *not yet* exposed to the processor. Use samples in Apparat for now; the wiring is planned for Werkstatt.
- **Spielwerk** — `@sample` not applicable; MIDI effects don't consume audio.

## Apparat — scriptable instrument

Apparat is the synth slot. You write a script that responds to MIDI note events and produces stereo audio per render block.

### The user-processor contract

Your script must export a default class implementing this shape:

```typescript
interface UserProcessor {
  process(output: ReadonlyArray<Float32Array>, block: Block): void
  noteOn?(pitch: number, velocity: number, cent: number, id: number): void
  noteOff?(id: number): void
  reset?(): void
  paramChanged?(label: string, value: number): void
  samples: Record<string, Nullable<AudioData>>
}
```

| Method | Required? | When called |
|---|---|---|
| `process(output, block)` | yes | Once per render block; write audio into `output[channel][sample]` |
| `noteOn(pitch, velocity, cent, id)` | no | When a MIDI note-on arrives. `pitch` is 0–127, `velocity` is 0–1, `cent` is fine-tune in cents, `id` is a unique ID for the note-off pairing |
| `noteOff(id)` | no | When the matching note-off arrives. Use the `id` to find the voice to release |
| `reset()` | no | On transport stop or panic — clear voices, reset state |
| `paramChanged(label, value)` | no | When a `@param` value changes (interactive or automation) |

`block` exposes:

- `block.s0`, `block.s1` — start and end sample indices within the output buffer (you write to `output[ch][s0..s1]`).
- `block.bpm` — the current BPM (for tempo-synced effects).
- `block.flags` — bitfield: transporting / playing / discontinuous / bpmChanged.

### Anatomy of a minimal Apparat synth

A two-voice sine synth:

```javascript
// @apparat sine 1 64
// @param("Decay", linear, 0.01, 2.0, 0.5, "s", "Note decay time")

class Voice {
  constructor(pitch, velocity) {
    this.freq = 440 * Math.pow(2, (pitch - 69) / 12);
    this.phase = 0;
    this.amp = velocity;
    this.released = false;
    this.envelope = 1.0;
  }

  step(decay, sampleRate) {
    this.phase += (this.freq / sampleRate) * Math.PI * 2;
    if (this.released) this.envelope -= 1.0 / (decay * sampleRate);
    return Math.sin(this.phase) * this.amp * Math.max(0, this.envelope);
  }
}

export default class SineSynth {
  constructor() {
    this.voices = new Map();
    this.decay = 0.5;
  }

  noteOn(pitch, velocity, cent, id) {
    this.voices.set(id, new Voice(pitch, velocity));
  }

  noteOff(id) {
    const v = this.voices.get(id);
    if (v) v.released = true;
  }

  paramChanged(label, value) {
    if (label === "Decay") this.decay = value;
  }

  process(output, block) {
    const sr = sampleRate; // global from the worklet
    for (let i = block.s0; i < block.s1; i++) {
      let sum = 0;
      for (const [id, voice] of this.voices) {
        const sample = voice.step(this.decay, sr);
        sum += sample;
        if (voice.envelope <= 0) this.voices.delete(id);
      }
      output[0][i] = sum;
      output[1][i] = sum;
    }
  }
}
```

The header is `// @apparat sine 1 64` — name `sine`, version `1`, update rate `64` samples. Adjust the update rate down for high-rate parameter automation, up for less overhead.

### Apparat performance constraints

Apparat scripts run in the AudioWorklet, on the audio thread. That means:

- **No allocations in `process()`.** `new` and array literals trigger GC, which causes audio dropouts. Allocate voice slots up front, reuse them. The example above uses a `Map<id, Voice>` — fine because allocations only happen on `noteOn`, not in the hot loop.
- **No async or Promises.** The worklet has no `await`.
- **No DOM access.** You're not in a browser context — `document`, `window`, etc. are unavailable.
- **Heavy DSP is your problem.** A 32-voice oscillator with cubic interpolation per sample is going to spike the DSP load. Profile with the load meter (see [Ch. 15](./15-performance-and-debugging.md)).

The SDK does its part: it pre-instantiates your class, schedules `noteOn`/`noteOff` sample-accurately, and clamps your output if you produce NaN or out-of-range samples (it'll log a warning to the main-thread console).

### Adding an Apparat to a track

Same shape as any other instrument — `project.api.createInstrument(InstrumentFactories.Apparat)`:

```typescript
import { InstrumentFactories } from "@opendaw/studio-adapters";

project.editing.modify(() => {
  const { audioUnitBox, trackBox } = project.api.createInstrument(
    InstrumentFactories.Apparat,
  );
  trackBox.label.setValue("Synth Lead");
  // ... place note regions on trackBox as usual (Ch. 16 — MIDI)
});
```

You then assign code to the device via its `ApparatDeviceBox.code` field — same as setting any string field, inside a transaction. The `ScriptCompiler` machinery compiles it on demand; once compiled, the processor is hot-swapped on the audio thread without a click.

### Apparat sample handling

When you declare `// @sample("kick")`, an `ApparatSampleBox` gets added to the device. The user (or your UI) drops an audio file into that slot, and the engine loads it asynchronously (see [Ch. 05 — Sample loading](./05-samples-peaks-and-looping.md)). On the audio thread, your script accesses it via `this.samples.kick`:

```javascript
// @apparat sampler 1 64
// @sample("kick")

export default class Sampler {
  constructor() {
    this.voices = new Map();
  }

  noteOn(pitch, velocity, cent, id) {
    if (!this.samples.kick) return;     // sample not loaded yet
    this.voices.set(id, {
      sample: this.samples.kick,
      position: 0,
      rate: Math.pow(2, (pitch - 60) / 12),  // C4 = original pitch
      gain: velocity,
    });
  }

  noteOff(id) {
    this.voices.delete(id);
  }

  process(output, block) {
    for (let i = block.s0; i < block.s1; i++) {
      let l = 0, r = 0;
      for (const [id, voice] of this.voices) {
        const data = voice.sample;
        const pos = voice.position;
        if (pos >= data.numberOfFrames) {
          this.voices.delete(id);
          continue;
        }
        const left = data.frames[0][Math.floor(pos)] || 0;
        const right = data.frames[1]?.[Math.floor(pos)] ?? left;
        l += left * voice.gain;
        r += right * voice.gain;
        voice.position += voice.rate;
      }
      output[0][i] = l;
      output[1][i] = r;
    }
  }
}
```

This is a one-shot pitch-shifted sampler — no envelope, no looping, no interpolation. Real-world samplers add all of those, but the contract is the same.

## Werkstatt — scriptable audio effect

Covered in detail at [Ch. 11 — Werkstatt](./11-effects.md#werkstatt). Summary of where Werkstatt differs from Apparat:

- **Header:** `// @werkstatt <name> <version> <updateRate>`
- **Input:** receives audio (no MIDI). Your script's `process()` reads from the input buffer and writes to the output.
- **No `noteOn`/`noteOff`.** Audio in, audio out.
- **Sample data:** the `@sample` drop target works but, as noted above, the data isn't currently routed to the processor. Plan around this until upstream fixes it.

Practical Werkstatt use cases: custom filters, wave-shapers, distortion, granular processors, anything where you can express the per-sample (or per-block) transformation in code.

## Spielwerk — scriptable MIDI effect

Covered in detail at [Ch. 11 — Spielwerk](./11-effects.md#spielwerk). Summary:

- **Header:** `// @spielwerk <name> <version> <updateRate>`
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

On compile, the `ScriptCompiler` reconciles parameter and sample boxes (added / removed / renamed), and the audio thread swaps the running processor without dropping audio. If the script throws or has a header parse error, the device falls silent and a console error appears on the main thread.

This means you can build iterative-editor UIs: a code editor in your app, a "compile" button that calls `compiler.compile(...)` with the editor's contents, and the engine just keeps running while the user iterates.

## Parameter automation

Same as any other automatable parameter ([Ch. 09](./09-editing-fades-and-automation.md)). When the user (or a `ValueEventCollectionBox`) drives a `@param`-declared parameter, your script's `paramChanged(label, value)` is called sample-accurately at automation events, and the per-block update-rate ticks. You don't have to do anything extra to make automation work — the SDK's parameter system treats your `@param` declarations exactly like a hard-coded effect parameter.

## Persistence and project-file shape

When a project saves, the modular device's `code`, `parameters`, and `samples` go into the `.od` file alongside the rest of the box graph. Loading the project recompiles the script on demand. There's no "compiled bytecode" cached — the script is the source of truth and is re-evaluated each open.

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

- [Ch. 11 — Werkstatt](./11-effects.md#werkstatt) — full Werkstatt programming model, parameter declarations, the `Processor` class shape for audio effects.
- [Ch. 11 — Spielwerk](./11-effects.md#spielwerk) — full Spielwerk programming model for MIDI effects.
- [Ch. 15 — Performance & Debugging](./15-performance-and-debugging.md) — DSP-load profiling for "is my Apparat script too heavy?"
- [Ch. 16 — MIDI Deep Dive](./16-midi.md) — how notes reach Apparat (and how Spielwerk gets between regions and the instrument).
- [internals/05 — Devices and Effects](./internals/05-devices-and-effects.md#modular-devices) — for the implementation side of modular devices.
- [`src/demos/effects/werkstatt-demo.tsx`](https://github.com/naomiaro/opendaw-test/tree/main/src/demos/effects) — runnable Werkstatt examples in this repo.
