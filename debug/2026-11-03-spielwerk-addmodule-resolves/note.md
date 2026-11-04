# A script that throws at load "compiles": `addModule` resolves, the device keeps the old script, the knobs follow the new one

**Title:** `ScriptCompiler.compile` reports success for a Spielwerk script whose module throws while
loading; the worklet keeps running the previous script, the parameter boxes are those of the new one,
and no device message is sent

**SDK pin:** `@opendaw/studio-sdk@0.0.180` (installed npm package; WASM engine), Chrome 155, macOS.

**Filed (2026-11-03):** [openDAW#523](https://github.com/andremichelle/openDAW/issues/523)
(`drafts/posted-openDAW-523-script-compile-resolves-on-load-error.md`). **Closed 2026-11-04, fixed in SDK
0.0.181** (the maintainer's answer: the wrapper now catches an error thrown while the module loads, so
the registry entry is written and its `create` rethrows; the device is silenced and the error arrives
through `subscribeDeviceMessage`; `compile` still resolves, since the main thread cannot see the worklet
scope, so the demo's preflight stays a valid earlier refusal). **Re-measured 2026-11-04 on the installed
0.0.181** (Chrome 156, the Spielwerk demo): a script whose top level throws only in the worklet
(`if (typeof AudioWorkletGlobalScope !== "undefined") throw …`, so the demo's main-thread preflight lets it
through) compiles without an editor error, and the device message "Failed to instantiate Processor: Error:
boom at worklet load" arrives through `subscribeDeviceMessage` about 0.5 s after Compile, the page reporting
the device silenced — the maintainer's description, to the word. Measured on the Spielwerk demo
(PR #190); worked around in the demo by building and constructing the Processor on the main thread
before compiling (`preflightScript`, `src/lib/midiEffects/spielwerkCompile.ts`).

## What was seen

On the Spielwerk demo (`spielwerk-demo.html`), with the Echo script running (three `@param` sliders):

1. Paste a script whose class is misnamed (`class Prozessor { * process(block, events) {} }`, with
   `// @no-pass` and one `@param spread`) and click Compile.
2. The compile promise resolves: the editor shows no error.
3. The device's `code` field now holds the new script and its parameter boxes are the new script's
   (one slider, `spread`).
4. The output keeps sounding (max RMS 0.262 over two seconds, read through a destination tap): the
   worklet is still running Echo. Under the new script (`@no-pass`, yields nothing) it would be silent.
5. No device message arrives on `engine.subscribeDeviceMessage(uuid, …)` within five seconds.

The same with a script whose top level throws (`throw new Error("boom at load")` before the class).

## Why

- `ScriptCompiler.compileInto` (`packages/studio/adapters/src/ScriptCompiler.ts`, 0.0.180) validates
  the wrapped code with `new Function(wrappedCode)`, a parse only; then writes `code` and reconciles
  the parameter, sample, sidechain, record and buffer boxes in one transaction; then
  `audioContext.audioWorklet.addModule(blobUrl)`, and a rejection is the only failure it handles
  (`registerClaimed` drops the claim and rethrows).
- The wrapper is an IIFE that runs the user code and `return Processor` at module top level
  (`wrapProcessor`), and the registry assignment `globalThis.openDAW.spielwerkProcessors[uuid] = {...}`
  is in the same module body. A `ReferenceError` or a user `throw` at top level stops the module
  before the assignment.
- Chrome's `AudioWorklet.addModule` RESOLVES for a module whose top level throws. Measured in this
  session on a bare `AudioContext`, outside the SDK: a module of `throw new Error("boom at load")`
  resolves; a module of `globalThis.__probe = (function () { class Prozessor {}; return Processor })()`
  resolves. (The spec routes the evaluation error to the worklet global's error event, not to the
  promise.)
- The bridge (`packages/studio/core-wasm/src/script-bridge.ts`, `#ensureProc`) swaps a Processor only
  when `registry.update` changes; the registry entry never changed, so it keeps the old one, and its
  "No Processor registered" message fires only when nothing was ever loaded.

So the SDK's post-write rollback never runs on Chrome for this class of script, and the device's
boxes and the worklet's script disagree until the next successful compile. The studio's own editor has
the same exposure (it calls the same `compile`), so a studio user who renames the class sees a
compiled script that keeps playing the previous one.

## What the demo does

`preflightScript(source)` builds the class with `new Function("use strict"; source; return Processor)`,
constructs it, and checks for a `process` function; it throws with the same message the module would
have logged in the worklet (`Processor is not defined`, `boom at load`). The hook runs it before
`compile`, so nothing is written. The runtime's own checks (a yield in the past, the scheduler) still
happen in the worklet and arrive through `subscribeDeviceMessage`. Verified in the browser: both bad
scripts refused with their message, the three Echo sliders unchanged, the transport playing.

## Not measured

Firefox and Safari `addModule` behaviour on a throwing module; whether the worklet global's `error`
event reaches anything the SDK could listen on.
