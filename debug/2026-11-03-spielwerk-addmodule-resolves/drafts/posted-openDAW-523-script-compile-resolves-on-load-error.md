<!-- Posted 2026-11-03 as https://github.com/andremichelle/openDAW/issues/523 — the body below is as filed (the note link made absolute). CLOSED 2026-11-04, fixed in SDK 0.0.181; see ../note.md. -->

# `ScriptCompiler.compile` resolves for a script that throws at module load; the device keeps the previous script with the new script's parameters

**SDK:** `@opendaw/studio-sdk` 0.0.180 (WASM engine), Chrome 155, macOS.

A Spielwerk (or Werkstatt / Apparat) script whose module body throws while loading, such as a
`class Prozessor` typo with `return Processor` in the wrapper, or a bare `throw` at top level,
compiles without an error: `compile` resolves, the device's `code` field and its parameter boxes are
rewritten for the new script, and the worklet keeps running the previous script. No device message
is sent, because the registry entry never changed.

## Repro

Live page: https://opendaw-test.pages.dev/spielwerk-demo.html (the demo now refuses such a script
before compiling; the SDK behaviour is reproduced with its workaround switched off, or on any page
that calls `compile` directly).

1. Insert a Spielwerk with `project.api.insertEffect(field, EffectFactories.Spielwerk)` and compile a
   working script with `// @param a 1`.
2. Compile `// @param b 2\nclass Prozessor { * process(block, events) {} }`.
3. `compile` resolves. `box.code` holds the second script; `box.parameters` holds one box, `b`.
4. The device still runs the first script (audible; `engine.subscribeDeviceMessage` receives nothing).

## Cause

`compileInto` (`packages/studio/adapters/src/ScriptCompiler.ts`) validates with `new Function(...)`,
which parses only, writes the box fields, then awaits `audioWorklet.addModule(blobUrl)` and handles a
rejection alone. Chrome's `addModule` resolves for a module whose top level throws (checked on a bare
`AudioContext`: `throw new Error("x")` resolves; so does an IIFE that returns an undefined `Processor`).
The wrapper evaluates the user code and `return Processor` at module top level, before the
`globalThis.openDAW.<registry>[uuid] = {...}` assignment, so the throw leaves the registry entry at its
previous `update`, and the bridge's `#ensureProc` swaps nothing.

Measurements and the demo's workaround: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-03-spielwerk-addmodule-resolves/note.md
