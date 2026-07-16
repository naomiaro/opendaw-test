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

## Offline rendering with the WASM engine

`OfflineAudioContext` + `AudioWorklets.createFor(ctx)` + `createEngine(...)` breaks with
the WASM `EngineVariant` whenever ANY wasm engine booted earlier on another context:
`WasmEngine.ensureReady(ctx)` registers the processor module only on the FIRST context it
is ever called with (`if (modules.nonEmpty()) return true` — no `addModule` for later
contexts), so `createEngine` on a second context throws
`InvalidStateError: 'engine-wasm-processor' is not defined in AudioWorkletGlobalScope`
right after `ensureReady` returned `true`. A single first-boot wasm render on an
OfflineAudioContext DOES work. Repro: `wasm-ensure-ready-second-context-debug-demo.html`;
write-up: `debug/wasm-ensure-ready-second-context.md`. The immune offline path is
`OfflineEngineRenderer` from `@opendaw/studio-core` with `variant: true`, which runs the
WASM offline **worker** (self-loads the wasm artifacts) registered by `WasmEngine.install`'s
`offlineWorkerUrl`:

```typescript
const renderer = await OfflineEngineRenderer.create(project, Option.None, sampleRate, true);
try {
  renderer.setPosition(startPPQN);
  await renderer.play();            // starts transport + one queryLoadingComplete
  await renderer.waitForLoading();  // loops until samples are loaded
  const channels = await renderer.step(numSamples); // Float32Array[] slice
} finally { renderer.stop(); renderer.terminate(); }
```

`Option.None` for the export configuration = 1 stereo master stem. NOTE: `variant` defaults
to `variantPolicy()` — `WasmEngine.install` registers `useForExports()` (= enabled && ready
&& hasVariant) as the policy, so an installed+enabled+**ready** WASM engine makes
`variant`-less renders default to WASM. Two more contract facts:
`renderer.render(config, start, end, progress)` does NOT stop at `end` (worker loop runs to
silence/`maxDurationSeconds`; `end` only drives progress) — use `step(numSamples)` for exact
ranges; and the renderer exposes NO engine-preferences surface. Since SDK 0.0.160 the
metronome travels in `ExportConfiguration.metronome` instead (openDAW#316) — but ONLY the
WASM offline worker consumes it (the TS worker ignores it), so metronome renders must pass
`variant: true` (see `src/lib/rangeExport.ts` and `src/demos/export/CLAUDE.md`). Roadmap
(openDAW#315 closing comment): the TypeScript audio engine will be removed soon. See
`src/lib/offlineScan.ts` for the dual-path (TS OfflineAudioContext / WASM renderer) example.

Live WASM transport quirk (observed on the debug repro pages at 0.0.159): after
`engine.play()` the position can take 20–30 s+ to start advancing (occasionally not at all
until a re-play) while `isPlaying` flips true immediately. Offline renders don't depend on
the live transport — prefer them for measurements.

## Live engine swap (no reload)

`project.engine` is a persistent `EngineFacade` that outlives worklets. Swap engines with
`releaseWorklet()` → `startAudioWorklet(restart, {})` (re-reads `EngineVariant.current()`), capturing
`engine.position`/`engine.isPlaying` and restoring them so playback is seamless. See
`switchEngine()` in `src/lib/wasmEngine.ts`.

## Performance reporting is itself a cost

DSP-load measurement runs in the audio thread and perturbs the load it measures, so it is
**off by default** (`settings.debug.dspLoadMeasurement`, schema default `false`). Both engines read
it live: the TS engine per render; the WASM engine via a preference-path subscription. Read the
result from `project.engine.cpuLoad` (`ObservableValue<number>` — already a 0–100 integer
percentage, do NOT multiply by 100; swap-safe on the facade) and
`project.engine.perfBuffer`. Dropout counts come from the **browser**: `audioContext.playbackStats.underrunEvents`
(Chromium-only — guard with a feature check); the SDK's `BufferUnderrunDetector` exposes no public
getter and logs nothing to the console.

## Programmatic Note Regions Need loopDuration (or they play silently)
A `NoteRegionBox` schedules its events within its loop window `[loopOffset, loopOffset+loopDuration]`.
If `loopDuration` is left at its default **0**, the engine schedules **zero notes** — the region
looks correct (events present, `hasCollection` true, on the right note track, output routed) but is
completely silent, and `region.iterateActiveNotesAt(pos)` yields nothing at every position. Setting
`box.duration` and the timeline `loopArea` is **not** enough; the timeline loop does not drive note
scheduling. Always set `box.loopOffset.setValue(0)` and `box.loopDuration.setValue(contentLenPPQN)`
when building a note region by hand (or use `project.api.createNoteRegion({ ..., loopOffset, loopDuration })`,
which sets them for you). See `patternContent.ts` step 3. NB: verify audio demos by measuring actual
output signal — an `isPlaying === true` transport and a disabled Play button do NOT prove sound.

## Reference Files
- WASM wiring + live swap: `src/lib/wasmEngine.ts`
- Content builder: `src/demos/engine/patternContent.ts`
- Demo: `src/demos/engine/wasm-engine-demo.tsx`
