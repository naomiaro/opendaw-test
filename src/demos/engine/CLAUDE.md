# Engine Demos — OpenDAW SDK Reference

Demos about the audio engine backend itself (as opposed to musical content).

## WASM (Rust) engine — EngineVariant / WasmEngine

The WASM engine is the SDK's ONLY engine (the TypeScript engine was removed upstream in
SDK 0.0.161). `EngineVariant` is the injection seam — studio-core cannot import
studio-core-wasm (circular), so `WasmEngine.install` registers a provider and
`EngineWorklet` resolves it at **construction time**. `EngineVariant.current()` is
non-nullable: a missing provider is a boot error ("No engine installed"), not a fallback.

Wire it via the `WasmEngine` façade from `@opendaw/studio-core-wasm` (see `src/lib/wasmEngine.ts`):
- `WasmEngine.install({ processorUrl, offlineWorkerUrl, wasmUrl })` — registers the EngineVariant
  provider AND the offline engine worker (`OfflineEngineRenderer.install(offlineWorkerUrl,
  {wasmUrl})`). `wasmUrl` is a base dir; `loadEngineModules` fetches `${wasmUrl}/wasm/engine.wasm`
  + `${wasmUrl}/wasm/plugins/device_*.wasm`.
- `WasmEngine.ensureReady(ctx)` — `ctx.audioWorklet.addModule(processorUrl)` + compile; returns
  `false` when artifacts are missing. `initializeOpenDAW()` (`src/lib/projectSetup.ts`) calls
  `installWasmEngine()` then `ensureWasmReady(audioContext)` BEFORE the first
  `startAudioWorklet()` and THROWS if `ensureWasmReady` resolves false — there is no
  fallback engine anywhere.
- The full façade is `install` / `ensureReady` / `isReady` — the old
  `setEnabled`/`isEnabled` localStorage flag (`opendaw-wasm-engine`) and `useForExports()`
  are gone from the SDK (nothing to toggle to).

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
OfflineAudioContext DOES work (unreachable here — `initializeOpenDAW`'s live boot always
consumes the first-context registration). Repro: `wasm-ensure-ready-second-context-debug-demo.html`;
write-up: `debug/wasm-ensure-ready-second-context.md`. The immune offline path is
`OfflineEngineRenderer` from `@opendaw/studio-core`, which runs the WASM offline
**worker** (self-loads the wasm artifacts) registered by `WasmEngine.install`'s
`offlineWorkerUrl`:

```typescript
const renderer = await OfflineEngineRenderer.create(project, Option.None, sampleRate);
try {
  renderer.setPosition(startPPQN);
  await renderer.play();            // starts transport + one queryLoadingComplete
  await renderer.waitForLoading();  // loops until samples are loaded
  const channels = await renderer.step(numSamples); // Float32Array[] slice
} finally { renderer.stop(); renderer.terminate(); }
```

`Option.None` for the export configuration = 1 stereo master stem. There is no
engine-selection (`variant`) parameter — the removed TS engine took the
`installVariant`/`installVariantPolicy`/`useForExports` machinery with it. Two more
contract facts: `renderer.render(config, start, end, progress)` does NOT stop at `end`
(worker loop runs to silence/`maxDurationSeconds`; `end` only drives progress) — use
`step(numSamples)` for exact ranges; and the renderer exposes NO engine-preferences
surface — the metronome travels in `ExportConfiguration.metronome` (openDAW#316; see
`src/lib/rangeExport.ts` and `src/demos/export/CLAUDE.md`).

Live WASM transport quirk (observed on the debug repro pages at 0.0.159): after
`engine.play()` the position can take 20–30 s+ to start advancing (occasionally not at all
until a re-play) while `isPlaying` flips true immediately. Offline renders don't depend on
the live transport — prefer them for measurements. Re-tested at 0.0.160 (2026-07-16): did
not reproduce — position advanced in ~3.3 s.

## Performance reporting is itself a cost

DSP-load measurement runs in the audio thread and perturbs the load it measures, so it is
**off by default** (`settings.debug.dspLoadMeasurement`, schema default `false`). The
engine reads it live via a preference-path subscription. Read the
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
- WASM wiring: `src/lib/wasmEngine.ts`
- Content builder: `src/demos/engine/patternContent.ts`
- Demo: `src/demos/engine/wasm-engine-demo.tsx`
