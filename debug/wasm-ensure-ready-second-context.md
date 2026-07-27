# `WasmEngine.ensureReady` registers the processor only on the first context

**Update 2026-07-27 (SDK 0.0.162):** upstream removed the TypeScript engine and the `AudioOfflineRenderer` API in SDK 0.0.161. The repro page's former step 3 (deprecated-API route into the bug) is retired — the API no longer exists; its matrix row below is historical. The second-context `ensureReady` behavior itself is unchanged and step 2 still reproduces it.

**Update 2026-07-16:** this repo now boots the WASM engine on every page (TypeScript engine removed here). The "fresh page first run OK" row below is historical — the live boot always consumes the registration, so the second-context throw reproduces on the first click.

**Upstream issue:** [andremichelle/openDAW#315](https://github.com/andremichelle/openDAW/issues/315) (filed 2026-07-15; **closed 2026-07-16 as wontfix** — "Please use `OfflineEngineRenderer` instead of the deprecated `AudioOfflineRenderer`. The Typescript audio-engine will be removed soon."). The `ensureReady` second-context behavior stands as-is; the supported answer for every offline render is `OfflineEngineRenderer`, which this repo already uses (`src/lib/rangeExport.ts`, `src/lib/offlineScan.ts`). This note remains as the reference for WHY the manual `OfflineAudioContext` + wasm combination throws.

**Verified against:** OpenDAW SDK 0.0.159 (`@opendaw/studio-core-wasm@0.0.4`), 2026-07-15.

**Repro page:** [`wasm-ensure-ready-second-context-debug-demo.html`](../wasm-ensure-ready-second-context-debug-demo.html) (unlisted). Audio fixture: [`public/audio/test-440hz.wav`](../public/audio/test-440hz.wav).

## Symptom

`WasmEngine.ensureReady(context)` resolves `true` for a context on which the wasm processor
module was **never registered**. Constructing the WASM `EngineWorklet` on that context then
throws synchronously:

```
InvalidStateError: Failed to construct 'AudioWorkletNode': AudioWorkletNode cannot be
created: The node name 'engine-wasm-processor' is not defined in AudioWorkletGlobalScope.
```

Measured matrix (repro page, 2 s / 96,000-frame render of a 440 Hz sine region):

| Scenario | Outcome |
|---|---|
| TS engine, manual `OfflineAudioContext` + `createEngine` (control) *(historical — TS engine no longer wired in this repo)* | OK — peak 0.4999 |
| WASM variant, **first-ever** `ensureReady` on the offline context *(historical — unreachable now that the live engine always boots WASM first)* | OK — peak 0.4999 |
| WASM variant, any **second** context (now every run, since the live engine's boot always consumes the registration first) | **THREW** after `ensureWasmReady=true` |
| Deprecated **public** `AudioOfflineRenderer.start` with wasm compiled+enabled *(historical — API deleted in SDK 0.0.161)* | **THREW** (same error — its internal context is a second context) |
| `OfflineEngineRenderer` (WASM offline worker) | OK — peak 0.4999 (worker self-loads artifacts; immune) |

## Mechanism (verified in shipped source)

`@opendaw/studio-core-wasm/dist/WasmEngine.js` (simplified — the real code wraps the two
calls in a `Promises.tryCatch` and returns `true` after `modules.wrap(value)`; the
load-bearing part is that the short-circuit skips `addModule`):

```js
WasmEngine.ensureReady = async (context) => {
    if (modules.nonEmpty()) {
        return true;                                    // ← short-circuit: addModule skipped
    }
    ...
    await context.audioWorklet.addModule(processorUrl); // ← only ever runs for the FIRST context
    ...
};
```

Module compilation is rightly once-per-page, but `addModule` is **per
`BaseAudioContext`** — each context has its own `AudioWorkletGlobalScope`. After the first
successful call, `ensureReady` never registers the processor on any new context, yet still
answers `true` for it. `EngineVariant.current()` (also global — it unwraps the compiled
modules) then hands `createEngine` the wasm variant, and the
`new AudioWorkletNode(ctx, "engine-wasm-processor")` constructor throws.

Anyone hitting this: any flow that boots WASM engines on two different contexts — e.g. a
live WASM engine plus a manual `OfflineAudioContext` render, or two offline renders on one
page. (Historically the deprecated `AudioOfflineRenderer.start` was the public-API route
into the bug — its internal `OfflineAudioContext` could never have been registered; the
API was deleted in SDK 0.0.161.)

**Suggested fix:** track registered contexts separately from module compilation — e.g. a
`WeakSet<BaseAudioContext>`; on `ensureReady`, `addModule` for any context not in the set
(compiling modules only once), and only then return `true`.

## Not a hang — correcting an earlier note

An earlier session (2026-07-15, PR #91) recorded this failure as
"`OfflineAudioContext` + `createEngine` hangs with the WASM variant (worklet never reports
ready)". That was a misdiagnosis from unreliable console reads: the failure is this
**synchronous throw**, and the combination itself works fine on the *first* registered
context. `EngineWorklet.isReady()`'s resolve-or-hang (never rejects) behavior is real but
was not the failing step here.

## Workarounds

- Use `OfflineEngineRenderer` for WASM offline renders — the offline worker self-loads
  the wasm artifacts, no per-context registration involved (`src/lib/offlineScan.ts`
  does this).
- *(historical — TS engine removed from the SDK in 0.0.161)* Manual
  `OfflineAudioContext` renders could formerly stay on the TS engine, which
  `AudioWorklets.createFor` registered per-context correctly.

## How to reproduce

```bash
npm run dev
# open https://localhost:5173/wasm-ensure-ready-second-context-debug-demo.html
# Step 2: click "Run (WASM variant)".
# The live engine is always WASM — step 2 throws on the first click.
```
