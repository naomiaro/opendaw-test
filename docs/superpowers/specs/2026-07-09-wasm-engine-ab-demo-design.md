# WASM Engine A/B Demo — Design Spec

**Date:** 2026-07-09
**SDK:** `@opendaw/studio-sdk@0.0.157` (WASM engine shipped in `@opendaw/studio-core-wasm@0.0.2`)
**Status:** Approved design — ready for implementation planning

## Goal

Add a new demo that showcases the SDK's switchable **WASM (Rust) engine** by letting the
user toggle the audio backend **live during playback** between the built-in TypeScript
engine and the WASM engine, hearing that the output stays identical while a performance
readout shows engine headroom. This is the first demo in the repo that installs an
`EngineVariant`; every existing demo continues to use the TS engine untouched.

## Background — how the WASM engine plugs in (verified against shipped `dist/`)

The WASM engine is a drop-in `AudioWorkletProcessor` that speaks the same message contract
as the built-in `"engine-processor"`. `EngineWorklet` reads `EngineVariant.current()` at
**construction time**: `null` ⇒ built-in TS engine (byte-for-byte unchanged); non-null ⇒
boots the WASM processor with the variant's attachment + sync source.

`@opendaw/studio-core-wasm` ships a high-level `WasmEngine` façade that wires the variant for us:

```typescript
namespace WasmEngine {
  const install: (urls: { processorUrl; offlineWorkerUrl; wasmUrl }) => void  // registers EngineVariant provider (once)
  const setEnabled: (enabled: boolean) => void   // persists to localStorage "opendaw-wasm-engine"
  const isEnabled: () => boolean                  // default true (localStorage !== "false")
  const isReady: () => boolean                    // modules compiled + processor registered
  const ensureReady: (context: BaseAudioContext) => Promise<boolean>  // false ⇒ artifacts missing, fall back to TS
}
```

- `install()` registers an `EngineVariant.install(provider)` whose provider returns `null`
  when `!isEnabled() || modules not loaded` — that's the mechanism our A/B toggle drives.
- `ensureReady(ctx)` runs `ctx.audioWorklet.addModule(processorUrl)` then compiles the wasm
  modules; it is guarded (returns `true` immediately if already ready).
- `loadEngineModules(base)` `fetch`es `${base}/wasm/engine.wasm` + 26 `${base}/wasm/plugins/device_*.wasm`
  via `WebAssembly.compile` (plain `fetch`, **no `Content-Type` requirement**).

The persistent `EngineFacade` (`project.engine`) exposes a **restart** path that re-reads the
variant, plus perf telemetry that survives the swap:

```typescript
project.startAudioWorklet(restart?: RestartWorklet, options?)  // RestartWorklet = { unload, load }
project.engine.releaseWorklet()
project.engine.setWorklet(worklet)
project.engine.cpuLoad: ObservableValue<number>   // live CPU load, swap-safe (facade persists)
project.engine.perfBuffer: Float32Array           // ring buffer of recent perf samples (sparkline)
project.engine.position / isPlaying               // captured + restored across the swap
```

Dropout counts come from the **browser**, not the SDK: `audioContext.playbackStats.underrunEvents`
(Chromium-only; guard with a feature check). The SDK's `BufferUnderrunDetector` reads the same
value but exposes no public getter and writes nothing to the console, so we read the browser
value directly.

## Components

### 1. `src/lib/wasmEngine.ts` (new) — engine wiring helper

Keeps all WASM specifics in one reusable module, engine-agnostic to the rest of the repo.

- Vite URL imports:
  ```typescript
  import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
  import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?worker&url";
  ```
- `installWasmEngine()` — calls `WasmEngine.install({ processorUrl, offlineWorkerUrl, wasmUrl: "/wasm-engine" })`
  exactly once (module-level guard). `wasmUrl` is a base dir; `loadEngineModules` appends `/wasm/...`.
- `ensureWasmReady(ctx): Promise<boolean>` — thin wrapper over `WasmEngine.ensureReady(ctx)`.
- Re-exports `setEnabled` / `isEnabled` / `isReady`.
- `switchEngine(project, ctx, wasmEnabled): Promise<EngineOutcome>` — the live A/B swap (see §4).

### 2. `vite.config.ts` — serve the `.wasm` binaries under `/wasm-engine`

Mirror upstream's approach so **nothing binary is committed** and it survives SDK upgrades.
A small plugin that reads from `node_modules/@opendaw/studio-core-wasm/dist`:

- **Dev** (`apply: "serve"`): `server.middlewares.use("/wasm-engine", ...)` streaming files from
  the package `dist/`. Per the repo dev-server rule, **wrap sync fs calls in try/catch** — a
  throw in a connect middleware runs outside connect's try/catch and would kill the dev server.
  If `dist/wasm/` is absent, log a warning and `next()` (graceful — `ensureReady` then returns
  `false` and the demo falls back to TS).
- **Build** (`generateBundle`/`buildStart` with `emitFile`): walk `dist/wasm/**` and emit each as
  `wasm-engine/wasm/<relpath>` so production serves `/wasm-engine/wasm/engine.wasm` + plugins.

Requests are same-origin, so COOP/COEP (`require-corp`) is satisfied without `crossorigin` juggling.

### 3. `src/lib/projectSetup.ts` — first-boot hook

Add one optional field so the very first `EngineWorklet` already boots the chosen engine:

```typescript
interface ProjectSetupOptions {
  // ...existing...
  onBeforeEngineStart?: (audioContext: AudioContext) => Promise<void>;
}
```

Invoke it immediately before `project.startAudioWorklet()` (currently ~line 236, after
`AudioWorklets.createFor` and project creation). `ensureReady` needs `addModule` on the same
context `initializeOpenDAW` creates, so the hook is the minimal correct injection point.
Default `undefined` ⇒ zero behavior change for every existing demo.

The demo passes:
```typescript
onBeforeEngineStart: async (ctx) => {
  installWasmEngine();
  setEnabled(initialWasm);            // demo decides the starting engine
  if (initialWasm) await ensureWasmReady(ctx);
}
```

### 4. Live A/B swap — `switchEngine(project, ctx, wasmEnabled)`

```
setEnabled(wasmEnabled)
if (wasmEnabled) ready = await ensureWasmReady(ctx)   // false ⇒ report fallback, stay TS-effective
wasPlaying = engine.isPlaying.getValue(); position = engine.position.getValue()
engine.releaseWorklet()
worklet = project.startAudioWorklet({ unload: async () => {}, load: (w) => engine.setWorklet(w) }, {})
await worklet.isReady()
engine.setPosition(position); if (wasPlaying) engine.play()
return outcome  // { requested: wasmEnabled, active: isEnabled() && isReady(), fellBack: wasmEnabled && !ready }
```

- Guarded by an `isSwitchingRef` in the component against double-clicks (a second swap must not
  start mid-reboot).
- Reports the engine that **actually** booted, so a missing-artifact fallback is surfaced
  honestly rather than the badge lying.

### 5. Musical content (built once, after init, inside `editing.modify()`)

Deterministic, no sample files — exercises the WASM instrument + effect plugins:

- `project.api.createInstrument(InstrumentFactories.Vaporisateur)` → `{ audioUnitBox, trackBox }`
  (capture via outer variable — `editing.modify()` doesn't forward returns).
- `project.api.insertEffect(audioUnitBox.audioEffects, EffectFactories.AudioNamed.Reverb)` and
  `...Delay` (verified names: `EffectFactories.AudioNamed.{Reverb,Delay,DattorroReverb}`).
- A looping ~2-bar note region: create a `NoteEventCollectionBox`, populate with a fixed pattern
  via `collection.createEvent({ position, duration, pitch, cent:0, velocity, chance:100, playCount:1 })`,
  then `project.api.createNoteRegion({ trackBox, position:0, duration, loopOffset, loopDuration, eventCollection, ... })`.
- Set `project.timelineBox.loopArea` to the pattern length and enable looping so it repeats
  under the toggle.

### 6. UI — `src/demos/engine/wasm-engine-demo.tsx` (new `engine` category)

Radix UI Theme + console-editorial design language (reference: `src/demos/warp/warp-overview.tsx`),
with `GitHubCorner`, `BackLink`, `MoisesLogo`.

- **Engine badge (prominent):** `ENGINE: WASM (Rust)` / `ENGINE: TypeScript`, plus ready/fallback
  state and sample rate. On fallback: `WASM unavailable — using TypeScript`.
- **TS ↔ WASM toggle switch** — calls `switchEngine`; disabled while `isSwitchingRef` is set.
- **Transport Play/Stop** — **must be a real pointer click** (untrusted `.click()` won't start the
  AudioContext, per repo rule). Stop resets to loop start.
- **Performance readout:**
  - Live **CPU load** number + **sparkline** from `engine.cpuLoad` / `engine.perfBuffer`.
  - **Dropouts: N** from `audioContext.playbackStats.underrunEvents`, feature-gated — shows
    `n/a (Chromium only)` where `playbackStats` is undefined.
  - Painted via `AnimationFrame.add(...)` writing DOM/canvas directly — **no per-frame `setState`**
    (repo perf rule); AnimationFrame scanning limited to when playing.
- Short explanatory copy: what the WASM engine is, that output is identical by design, and that
  CPU load is the leading indicator (dropouts the lagging symptom, usually 0).

### 7. Registration (per CLAUDE.md "Adding a New Demo")

1. `wasm-engine-demo.html` at repo root (copy an existing entry point; update meta + script src to
   `src/demos/engine/wasm-engine-demo.tsx`).
2. `src/demos/engine/CLAUDE.md` — scoped SDK notes (EngineVariant / WasmEngine wiring, restart path,
   perf sources).
3. `vite.config.ts` → `rollupOptions.input` add `wasmEngine: resolve(__dirname, "wasm-engine-demo.html")`.
4. `src/index.tsx` — add a card (new "Engine" grouping or nearest existing section).
5. `public/sitemap.xml` — add the URL.
6. 1200×630 screenshot → `public/og-image-wasm-engine.png` + `og:image`/`twitter:image` tags.
7. GoatCounter snippet before `</body>`.

## Error handling & edge cases

- **Artifacts missing** (`ensureReady` false): badge shows TS + "WASM unavailable"; toggle stays
  usable but re-attempts `ensureReady` each time it's flipped on.
- **Dev middleware** cannot crash the server (try/catch + `next()`), matching the repo rule.
- **Concurrent reboots** blocked by `isSwitchingRef`.
- **Non-Chromium browsers**: dropout counter reads `n/a`; CPU load + everything else works.
- **AudioContext suspended / iOS re-suspend**: resume on the real Play click before `engine.play()`.
- **Cleanup**: terminate `cpuLoad` subscription + `AnimationFrame` on unmount; the facade owns the
  worklet lifecycle.

## Non-goals (YAGNI)

- No offline-render-through-WASM path (`OfflineEngineRenderer` variant) — separate demo if wanted.
- No composite instrument, MIDIOutput, freeze/stems, or cloud/template surface from this cycle.
- No audio-file or multitrack content — a single deterministic synth loop is the clearest A/B.
- No numeric waveform/output equality assertion between engines — "identical by design + by ear"
  is the claim; a rendered-WAV diff would belong to an export-focused demo.

## Verification plan

- `npm run build` (Vite + VitePress) succeeds.
- `npx tsc --noEmit --ignoreDeprecations "6.0"` — **zero new errors** vs parent commit (LSP-verify
  any new `useState` reads; `setFoo` doesn't count as a read).
- Browser smoke on a **fresh page load** (HTTPS dev server):
  - Real-click **Play** → hear the Vaporisateur loop.
  - Toggle to **WASM** → badge = WASM/ready, playback continues seamlessly mid-loop, CPU meter
    live, **network 200s** for `/wasm-engine/wasm/engine.wasm` + device plugins.
  - Toggle back to **TS** → badge = TypeScript, still seamless.
  - Per-navigation **"Console: 0 errors"** (judge on the fresh load, not `all:true` history).
- Confirm existing demos still boot on the TS engine (no `EngineVariant` leakage — install is
  per-page, so this holds by construction; spot-check one demo).

## Open follow-ups (not blocking)

- If the dropout counter reads meaningfully different between engines under a deliberately heavier
  patch, a future "performance" variant could lean into that (was considered, deferred).
- Consider documenting the WASM wiring in `documentation/` once the demo lands.
