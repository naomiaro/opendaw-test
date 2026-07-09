# Engine Demos — OpenDAW SDK Reference

Demos about the audio engine backend itself (as opposed to musical content).

## WASM (Rust) engine — EngineVariant / WasmEngine

The WASM engine is a switchable `AudioWorkletProcessor` that speaks the same message contract
as the built-in TS `"engine-processor"`. `EngineWorklet` reads `EngineVariant.current()` at
**construction time**: null ⇒ built-in TS engine (unchanged); non-null ⇒ boots the WASM processor.

Wire it via the `WasmEngine` façade from `@opendaw/studio-core-wasm` (see `src/lib/wasmEngine.ts`):
- `WasmEngine.install({ processorUrl, offlineWorkerUrl, wasmUrl })` — registers the EngineVariant
  provider (once). `wasmUrl` is a base dir; `loadEngineModules` fetches `${wasmUrl}/wasm/engine.wasm`
  + `${wasmUrl}/wasm/plugins/device_*.wasm`.
- `WasmEngine.ensureReady(ctx)` — `ctx.audioWorklet.addModule(processorUrl)` + compile; returns
  `false` when artifacts are missing (fall back to the TS engine). Must run BEFORE the first
  `startAudioWorklet()` — this repo uses `initializeOpenDAW`'s `onBeforeEngineStart` hook.
- `WasmEngine.setEnabled(bool)` persists a localStorage flag (`opendaw-wasm-engine`, default on);
  the provider returns null while disabled or not-ready.

**Serving the binaries:** the `.wasm` files ship in `@opendaw/studio-core-wasm/dist/wasm/` and are
served under `/wasm-engine` by the `wasm-engine-assets` (dev) / `wasm-engine-emit` (build) Vite
plugins — nothing binary is committed. `loadEngineModules` uses `fetch` + `WebAssembly.compile`,
so no `Content-Type` is required.

## Live engine swap (no reload)

`project.engine` is a persistent `EngineFacade` that outlives worklets. Swap engines with
`releaseWorklet()` → `startAudioWorklet(restart, {})` (re-reads `EngineVariant.current()`), capturing
`engine.position`/`engine.isPlaying` and restoring them so playback is seamless. See
`switchEngine()` in `src/lib/wasmEngine.ts`.

## Performance reporting is itself a cost

DSP-load measurement runs in the audio thread and perturbs the load it measures, so it is
**off by default** (`settings.debug.dspLoadMeasurement`, schema default `false`). Both engines read
it live: the TS engine per render; the WASM engine via a preference-path subscription. Read the
result from `project.engine.cpuLoad` (`ObservableValue<number>`, swap-safe on the facade) and
`project.engine.perfBuffer`. Dropout counts come from the **browser**: `audioContext.playbackStats.underrunEvents`
(Chromium-only — guard with a feature check); the SDK's `BufferUnderrunDetector` exposes no public
getter and logs nothing to the console.

## Reference Files
- WASM wiring + live swap: `src/lib/wasmEngine.ts`
- Content builder: `src/demos/engine/patternContent.ts`
- Demo: `src/demos/engine/wasm-engine-demo.tsx`
