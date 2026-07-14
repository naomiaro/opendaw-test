# Apparat — Scriptable Instrument

> **Skip if:** the built-in instruments (Vaporisateur, Soundfont, Nano, Playfield, Tape) cover your needs. Apparat is for custom synthesis in user-supplied JavaScript.
>
> **Prerequisites:** [Ch. 16 (MIDI)](./16-midi.md) for how notes reach an instrument, [Ch. 17 (Modular Devices)](./17-modular-devices.md) for the shared scripting model, [Ch. 11 — Werkstatt](./11-effects.md#werkstatt) if you're coming from the audio-effect side.

Apparat is the scriptable **instrument**: a device that occupies the instrument slot of an `AudioUnit` (same slot as Vaporisateur or Soundfont), receives MIDI note events, and produces stereo audio from a JavaScript `Processor` class you supply. The script runs on the AudioWorklet thread inside the engine — both on the TypeScript engine and on the [WASM engine](./19-wasm-engine.md), where a thin wasm bridge calls the same JavaScript once per block over shared memory.

Its siblings are [Werkstatt](./11-effects.md#werkstatt) (scriptable audio effect) and [Spielwerk](./11-effects.md#spielwerk) (scriptable MIDI effect). All three share the compiler, the `// @param` declaration system, and the parameter/sample box machinery — this chapter covers what is specific to writing an *instrument*.

**Runnable demo:** [Apparat Demo](https://opendaw-test.pages.dev/apparat-demo.html) — four synth engines (sine, supersaw, FM bell, Karplus-Strong pluck) hot-swapped over a looping chord pattern, with parameter sliders and an on-screen keyboard.

## Quick start

Create the instrument, then compile a script onto its box:

```typescript
import { InstrumentFactories, ScriptCompiler } from "@opendaw/studio-adapters";

const compiler = ScriptCompiler.create({
  headerTag: "apparat",
  registryName: "apparatProcessors",
  functionName: "apparat",
});

// createInstrument returns { audioUnitBox, instrumentBox, trackBox };
// editing.modify forwards the modifier's return value as Option<R>.
const { audioUnitBox, instrumentBox, trackBox } = project.editing
  .modify(() => project.api.createInstrument(InstrumentFactories.Apparat))
  .unwrap();

// Compile OUTSIDE the transaction — it awaits audioWorklet.addModule().
await compiler.compile(audioContext, project.editing, instrumentBox, script);
```

`script` is plain JavaScript source defining a class named `Processor` (see next section). Place note regions on `trackBox` to drive it from the timeline ([Ch. 16](./16-midi.md)), or arm its capture to play it live (below).

> **Setting `code` directly does nothing audible.** `instrumentBox.code.setValue(src)` stores the string but never registers a worklet module — the processor keeps running the old script. Always go through `ScriptCompiler.compile()`.

## The Processor contract

The compiler wraps your source in a registration function that ends with `return Processor` — so the script **must define a class (or function) named `Processor`**, without `export`:

```javascript
// @param attack 0.01 0.001 1.0 exp s
// @param release 0.3 0.01 2.0 exp s

class Processor {
  voices = []
  attack = 0.01
  release = 0.3

  paramChanged(label, value) {
    if (label === "attack") this.attack = value
    if (label === "release") this.release = value
  }

  noteOn(pitch, velocity, cent, id) {
    this.voices.push({
      id, velocity,
      freq: 440 * Math.pow(2, (pitch - 69 + cent / 100) / 12),
      phase: 0, gain: 0, gate: true, releaseTime: this.release
    })
  }

  noteOff(id) {
    const voice = this.voices.find(v => v.id === id)
    if (voice) voice.gate = false
  }

  reset() {
    for (const voice of this.voices) {
      voice.gate = false
      voice.releaseTime = 0.005
    }
  }

  process(output, block) {
    const [outL, outR] = output
    const attackRate = 1 / (this.attack * sampleRate)
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i]
      const releaseRate = 1 / (voice.releaseTime * sampleRate)
      for (let s = block.s0; s < block.s1; s++) {
        if (voice.gate) {
          voice.gain += (voice.velocity - voice.gain) * attackRate
        } else {
          voice.gain -= voice.gain * releaseRate
          if (voice.gain < 0.001) {
            this.voices.splice(i, 1)
            break
          }
        }
        const sample = Math.sin(voice.phase * Math.PI * 2) * voice.gain * 0.3
        outL[s] += sample
        outR[s] += sample
        voice.phase += voice.freq / sampleRate
      }
    }
  }
}
```

The engine instantiates the class and calls:

| Member | Required? | Called when |
|---|---|---|
| `process(output, block)` | yes | Once per render block. `output` is `[outL, outR]` (`Float32Array`s); render `[block.s0, block.s1)`. The buffers arrive **zero-filled** — voices **add** into them. |
| `noteOn(pitch, velocity, cent, id)` | no | A note starts. `pitch` 0–127, `velocity` 0–1, `cent` is microtuning (−50…+50), `id` is unique per note — key your voice on it. |
| `noteOff(id)` | no | The note with that `id` releases. Fade the voice out; never cut it hard. |
| `reset()` | no | Transport **reset** — `engine.stop(true)`, Stop pressed while already stopped (rewind), or the device being disabled. A plain Stop while playing does *not* call it; held notes end via `noteOff` and decay through their release. **Fast-fade contract:** collapse envelopes to a few milliseconds and drop pending state — a lazy `reset()` leaves tails ringing after a rewind/reset. |
| `paramChanged(label, value)` | no | A `// @param` value changed. Values arrive already mapped to the declared range. The engine also pushes **every current value once after (re)instantiation**, which is how a hot-swapped script picks up existing slider/automation positions. |
| `samples` | assigned by engine | Object mapping each `// @sample` label to its audio data (`null` until loaded) — see below. |

`sampleRate` is a global in the worklet scope. `block` carries `{index, p0, p1, s0, s1, bpm, flags}` — the same shape Werkstatt receives; see [Ch. 11 — the Block object](./11-effects.md#werkstatt) for the field and flag tables. Unlike a Werkstatt generator, an Apparat script normally doesn't need to check `block.flags & 4` (playing): it only sounds when notes arrive — Stop releases every held note via `noteOff`, and `reset()` covers transport reset.

### Output validation and the limiter

After every block the engine validates the script's output: a `NaN` or a sample beyond ±1000 (~60 dB over full scale) **silences the device** and reports the error to the main thread as a device message. A `SimpleLimiter` then runs over the validated output. A runtime exception thrown by the script silences the device the same way — the error text arrives on the main thread, the audio thread keeps running.

### Performance constraints

The script runs on the audio thread:

- **No allocation in `process()`** — GC pauses glitch audio. Per-*note* allocation in `noteOn` (e.g. a Karplus-Strong delay line sized to the pitch) is fine; per-*block* allocation is not.
- **No async, no DOM.** The worklet has neither.
- **Watch the DSP load** for heavy per-sample work ([Ch. 15](./15-performance-and-debugging.md)).
- **Blocks can be tiny.** The engine splits render quanta at event boundaries, so `process()` may be called with a handful of samples (the sub-block boundaries are how notes and automation land sample-accurately). Never base a decision (like voice removal) on a single block's samples — accumulate across blocks.

## Parameters

Declared as line comments, positional tokens (full grammar in [Ch. 11 — parameter declarations](./11-effects.md#werkstatt)):

```javascript
// @param cutoff 2500 100 12000 exp Hz
// @param detune 14 0 50 linear ct
// @param voices 4 1 16 int
```

Note the grammar trap: `mapping` comes before `unit`, so a unit **requires** an explicit mapping — `// @param detune 14 0 50 ct` fails to compile because `ct` is parsed as an (unknown) mapping.

`ScriptCompiler.compile()` reconciles one parameter box per declaration onto the device's `parameters` field. All three script devices share the **same** box classes — an Apparat parameter is a `WerkstattParameterBox` (there is no Apparat-specific parameter box class). Each is automatable like any built-in device parameter ([Ch. 09](./09-editing-fades-and-automation.md)).

Reading and writing them from the app:

```typescript
import { asInstanceOf } from "@opendaw/lib-std";
import { WerkstattParameterBox } from "@opendaw/studio-boxes";

const cutoff = instrumentBox.parameters.pointerHub.incoming()
  .map((pointer) => asInstanceOf(pointer.box, WerkstattParameterBox))
  .find((box) => box.label.getValue() === "cutoff");
if (cutoff) {
  project.editing.modify(() => cutoff.value.setValue(8000));
}
```

`ScriptDeclaration.parseGroups(source)` (from `@opendaw/studio-adapters`) returns structured metadata — label, min/max, mapping, unit, default, `// @group` sections — which is how the demo builds its sliders without re-parsing `@param` lines by hand. `// @label <name>` in the script sets the device label on compile.

## Samples

A sample slot is declared with plain tokens (not a function call):

```javascript
// @sample kick
```

Each declaration reconciles a `WerkstattSampleBox` child onto the device's `samples` field; pointing its `file` field at an `AudioFileBox` loads the audio asynchronously. On the audio thread the engine assigns `this.samples.kick` — `null` until loaded, then an `AudioData`:

```typescript
type AudioData = {
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  frames: ReadonlyArray<Float32Array>; // one per channel, backed by shared memory (Float32Array<SharedArrayBuffer>)
};
```

Guard for `null` in `noteOn`/`process` — the note may arrive before the file finishes loading. The engine re-delivers sample data after a hot-swap, so a recompiled script sees its slots again without user action.

## Playing it live

Notes reach an instrument two ways: note regions on its track ([Ch. 16](./16-midi.md)), or live MIDI through the audio unit's capture. For live input, arm the capture — resolve it **after** the creation transaction commits; `armed` is a runtime observable, not a box field, so no `editing.modify()`:

```typescript
import { MidiDevices } from "@opendaw/studio-core";

const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap();
capture.armed.setValue(true);

// The software keyboard needs no permission prompt:
MidiDevices.softwareMIDIInput.sendNoteOn(60, 0.8);
MidiDevices.softwareMIDIInput.sendNoteOff(60);
```

An armed capture voices notes immediately — transport running or stopped — and records them into note regions during recording, exactly like any other synth ([Ch. 08](./08-recording.md), [Ch. 16](./16-midi.md)).

## Compiling, hot-swap, and failure modes

`compile(audioContext, editing, deviceBox, source)` does three things in order:

1. **Validates** the wrapped source (`new Function` parse). A syntax error throws **here — before the box is touched**; the previous script keeps playing.
2. **Writes** the new code (prefixed with a compiler-managed header) plus the reconciled parameter/sample boxes in **one** `editing.modify` transaction.
3. **Registers** the wrapped module via `audioWorklet.addModule()`. The processor notices the code field's new update number, silences itself, and swaps to the new `Processor` as soon as the registry entry lands — effectively between blocks.

The header — e.g. `// @apparat js 1 7` — is **written by the compiler**, never by you. Its third number is the compile counter the processor uses to detect a new script; it is not a user-tunable rate. Scripts you pass to `compile()` need no header at all (one already present is stripped and replaced).

Consequences worth designing around:

- **Hot-swap cuts held voices.** The old `Processor` instance is discarded; the engine re-pushes all current parameter values to the new one. Expect a brief gap, not seamless voice continuity.
- **A post-validation failure leaves the box mutated.** If `addModule` rejects (e.g. a top-level runtime error in the script body — the wrapper executes it at module load), the code field and parameter boxes already reflect the *failed* script, while the audible processor is silenced waiting for a registry update that never arrives. Recover by recompiling the last-known-good source — a fresh update number reloads it. (`editing.undo()` is **not** a fix: it restores the old code at the update number the processor already has, so the swap subscription never re-fires and the processor keeps waiting for the failed update — it stays silent.)
- **Persistence:** the compiled header travels with the project inside `code`. On load, the processor sees a header whose update number has no registry entry yet — call `compiler.load(audioContext, deviceBox)` to re-register already-compiled code without bumping the update.

The [Apparat demo](https://opendaw-test.pages.dev/apparat-demo.html) exercises all of this: its instrument cards recompile onto one box while the pattern plays, and its error path restores the previous script when a compile fails after mutation.

## Further reading

- [Ch. 17 — Modular Devices](./17-modular-devices.md) — the cross-cutting scripting model shared with Werkstatt and Spielwerk.
- [Ch. 11 — Werkstatt](./11-effects.md#werkstatt) — parameter-declaration grammar, the `Block` tables, and the audio-effect side of the same machinery.
- [Ch. 16 — MIDI Deep Dive](./16-midi.md) — note regions, captures, and recording.
- [Ch. 19 — Swappable Audio Engine](./19-wasm-engine.md) — how the same script runs under the WASM engine.
- [Apparat Demo](https://opendaw-test.pages.dev/apparat-demo.html) / [source](https://github.com/naomiaro/opendaw-test/blob/main/src/demos/effects/apparat-demo.tsx) — the four showcase instruments live in [`apparatScripts.ts`](https://github.com/naomiaro/opendaw-test/blob/main/src/lib/apparatScripts.ts).
