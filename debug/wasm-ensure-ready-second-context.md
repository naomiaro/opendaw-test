# `WasmEngine.ensureReady` registers the processor only on the first context

**Upstream issue:** [andremichelle/openDAW#315](https://github.com/andremichelle/openDAW/issues/315) (filed 2026-07-15).

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
| TS engine, manual `OfflineAudioContext` + `createEngine` (control) | OK — peak 0.4999 |
| WASM variant, **first-ever** `ensureReady` on the offline context | OK — peak 0.4999 |
| WASM variant, any **second** context (re-run the step, or `?engine=wasm` so the live boot consumed the registration) | **THREW** after `ensureWasmReady=true` |
| Deprecated **public** `AudioOfflineRenderer.start` with wasm compiled+enabled | **THREW** (same error — its internal context is a second context) |
| `OfflineEngineRenderer` with `variant: true` | OK — peak 0.4999 (worker self-loads artifacts; immune) |

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
answers `true` for it. `EngineVariant.current()` (also global: `isEnabled() &&
modules.nonEmpty()`) then hands `createEngine` the wasm variant, and the
`new AudioWorkletNode(ctx, "engine-wasm-processor")` constructor throws.

Anyone hitting this: any flow that boots WASM engines on two different contexts — e.g. a
live WASM engine plus a manual `OfflineAudioContext` render, or two offline renders on one
page. The deprecated (but still exported) `AudioOfflineRenderer.start` is the public-API
route into the bug: with the wasm engine enabled and compiled it always throws, since its
internal `OfflineAudioContext` can never have been registered.

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

- Use `OfflineEngineRenderer` (`variant: true`) for WASM offline renders — the offline
  worker self-loads the wasm artifacts, no per-context registration involved
  (`src/lib/offlineScan.ts` does this).
- Or keep manual `OfflineAudioContext` renders on the TS engine (`setWasmEnabled(false)`
  around the render re-registration doesn't help — the flag doesn't fix registration, it
  just routes `EngineVariant.current()` back to the TS processor, which `AudioWorklets.createFor`
  registers per-context correctly).

## How to reproduce

```bash
npm run dev
# open https://localhost:5173/wasm-ensure-ready-second-context-debug-demo.html
# Step 2: click "Run (WASM variant)" twice — first OK, second THREW.
# Or open with ?engine=wasm — step 2 throws on the first click.
```
