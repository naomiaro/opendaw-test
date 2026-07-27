# The WASM Audio Engine

> **Prerequisites:** Ch. 00 (System Architecture) for the worklet/engine model, Ch. 15 (Performance & Debugging) for DSP-load context.

The SDK's audio engine is a Rust build compiled to WebAssembly, distributed in
`@opendaw/studio-core-wasm`. It is the **only** engine — there is no built-in fallback
processor, so an application must install and boot it before the first `EngineWorklet`,
and a failed boot is an error to surface, not a degraded mode to continue in.

## Table of Contents

- [One Engine, Injected](#one-engine-injected)
- [Installing the WASM Engine](#installing-the-wasm-engine)
  - [The WasmEngine Façade](#the-wasmengine-facade)
  - [Serving the WASM Binaries](#serving-the-wasm-binaries)
  - [Low-Level: EngineVariant.install](#low-level-enginevariantinstall)
- [Offline Renders](#offline-renders)
- [Configuring the Engine](#configuring-the-engine)
  - [Engine Preferences](#engine-preferences)
  - [DSP-Load Measurement and Telemetry](#dsp-load-measurement-and-telemetry)
  - [CPU Overload Handling](#cpu-overload-handling)
- [Boot Failure, Isolation, and Cost](#boot-failure-isolation-and-cost)
- [Demo](#demo)

---

## One Engine, Injected

`studio-core` owns `EngineWorklet` (the live engine node) and `OfflineEngineRenderer`
(the offline render worker), but it cannot import `studio-core-wasm` — that package
depends on `studio-core`, and the import would be circular. So the engine arrives by
**injection**: `WasmEngine.install` registers a provider with `EngineVariant`, and
`EngineWorklet` resolves it at construction time. The provider is the engine; there is
nothing to fall through to:

```typescript
import { EngineVariant } from "@opendaw/studio-core";

// Throws "No engine installed (WasmEngine.install must run before an engine boots)"
// until WasmEngine.install has registered the provider.
const variant = EngineVariant.current();
```

Nothing about *using* the engine is WASM-specific: you build a `Project`, create
instruments, schedule regions, and read engine state exactly as the other chapters
describe — the injection seam only decides what processor `project.engine` runs.

## Installing the WASM Engine

### The WasmEngine Façade

`@opendaw/studio-core-wasm` exposes a `WasmEngine` namespace that wires everything for you:

```typescript
export declare namespace WasmEngine {
  const install: (urls: WasmEngineUrls) => void;
  const ensureReady: (context: BaseAudioContext) => Promise<boolean>;
  const isReady: () => boolean;        // modules compiled + processor registered
}

export type WasmEngineUrls = {
  processorUrl: string;      // the prebuilt worklet module
  offlineWorkerUrl: string;  // the prebuilt offline render worker
  wasmUrl: string;           // base URL serving the .wasm binaries (see below)
};
```

`install` registers the `EngineVariant` provider and the offline render worker;
`ensureReady` compiles the WASM modules and registers the processor module on the given
`AudioContext`. Both are idempotent.

Wire it up **before the first `project.startAudioWorklet()`**, so the first
`EngineWorklet` has an engine to boot. With a bundler such as Vite, resolve the two
prebuilt scripts to hashed URLs and point `wasmUrl` at wherever you serve the binaries:

```typescript
import { WasmEngine } from "@opendaw/studio-core-wasm";
import processorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
import offlineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?worker&url";

WasmEngine.install({ processorUrl, offlineWorkerUrl, wasmUrl: "/wasm-engine" });

// ensureReady needs the AudioContext the engine will run on. It resolves false when the
// artifacts are unavailable (e.g. a deploy without them) or compilation fails. There is
// no other engine — a caller that gets false has no working engine and must say so:
const ready = await WasmEngine.ensureReady(audioContext);
if (!ready) {
  throw new Error("WASM engine failed to initialize — no audio engine available.");
}
```

### Serving the WASM Binaries

`ensureReady` fetches the WebAssembly binaries from the `wasmUrl` base — one engine
module plus one module per device:

```
${wasmUrl}/wasm/engine.wasm
${wasmUrl}/wasm/plugins/device_vaporisateur.wasm
${wasmUrl}/wasm/plugins/device_reverb.wasm
… (one per device box type)
```

The binaries ship inside the package at `@opendaw/studio-core-wasm/dist/wasm/`, and are
fetched with plain `fetch` + `WebAssembly.compile` (no streaming), so no special
`Content-Type` is required. Serve that `wasm/` subtree at your chosen `wasmUrl` base —
copy it into your static assets at build time, or serve it straight from the package in
development. If a binary is missing, `ensureReady` resolves to `false` and no engine can
boot.

### Low-Level: EngineVariant.install

`WasmEngine.install` is a convenience wrapper over `EngineVariant`. For full control — a
custom processor, custom box-graph sync, or a bespoke freeze path — install a provider
directly:

```typescript
import { EngineVariant, type EngineWorkletVariant } from "@opendaw/studio-core";

EngineVariant.install((): EngineWorkletVariant => ({
  processorName: "engine-wasm-processor",       // processor to instantiate
  attachment: { /* structured-clone extras */ }, // handed to processorOptions.variant
  connectSync: (messenger, project) => wireSync(messenger, project), // returns Terminable
  connectFrozenAudio: (messenger) => makeFrozenWriter(messenger),    // optional freeze-PCM path
}));
```

The provider is a function, re-evaluated on every engine construction, so a re-install
takes effect on the next boot. It must return a variant — there is no `null` escape
hatch, because there is no built-in engine to escape to; a provider that cannot supply an
engine should throw a descriptive error instead.

## Offline Renders

Background renders (mixdown, stems, freeze, consolidation) run in a dedicated Worker that
self-loads the wasm artifacts. `OfflineEngineRenderer` holds the worker registration:

```typescript
class OfflineEngineRenderer {
  // attachment travels to the worker as config.variant (the wasm artifacts base url);
  // WasmEngine.install calls this for you with its offlineWorkerUrl.
  static install(url: string, attachment: Record<string, unknown>): void;
  static isInstalled(): boolean;

  static start(source: Project, optExportConfiguration: Option<ExportConfiguration>,
               progress: DefaultObservableValue<number>, abortSignal?: AbortSignal,
               sampleRate?: number): Promise<AudioData>;
  static create(source: Project, optExportConfiguration: Option<ExportConfiguration>,
                sampleRate?: number, abortSignal?: AbortSignal): Promise<OfflineEngineRenderer>;
}
```

Every offline render runs this worker — there is no engine selection parameter. Because
the worker self-loads its artifacts, offline renders are immune to the second-context
`addModule` bookkeeping that bites `AudioWorklets`-based rendering (see Ch. 10 / Export).

## Configuring the Engine

### Engine Preferences

```typescript
const preferences = project.engine.preferences; // Preferences<EngineSettings>
const settings = preferences.settings;          // a mutable settings object
```

`settings` groups the tunable engine state:

| Group | Fields |
|---|---|
| `metronome` | `enabled`, `gain` (dB), `beatSubDivision` (`1` \| `2` \| `4` \| `8`), `monophonic` |
| `playback` | `timestampEnabled`, `pauseOnLoopDisabled`, `truncateNotesAtRegionEnd` |
| `recording` | `countInBars` (`1`–`8`), `allowTakes`, `automationEnabled`, `olderTakeAction`, `olderTakeScope`, `inputLatency` |
| `debug` | `dspLoadMeasurement` |

Write a value by assigning to the settings object, and observe changes by path:

```typescript
settings.metronome.enabled = true;
settings.metronome.gain = -6;         // dB
settings.metronome.beatSubDivision = 2; // eighth-note clicks

// React to a specific field (path-based). catchupAndSubscribe fires immediately with the current value.
const sub = preferences.catchupAndSubscribe(
  (enabled) => updateMetronomeButton(enabled),
  "metronome", "enabled",
);

// Or bind a field to a UI control as an observable value:
const gain = preferences.createMutableObservableValue("metronome", "gain");
```

The engine subscribes to the preference paths, so changes take effect immediately without
a reboot.

### DSP-Load Measurement and Telemetry

Measuring DSP load runs extra work on the audio thread and slightly perturbs the very load it reports, so it is **off by default** (`debug.dspLoadMeasurement`, default `false`). Turn it on only while you need a reading:

```typescript
settings.debug.dspLoadMeasurement = true;
```

With it enabled, read the engine's load and recent history from the facade — both live on the persistent `EngineFacade`, so they survive an engine restart:

```typescript
// cpuLoad is ALREADY a rounded integer percentage — do NOT multiply by 100. It can exceed
// 100 under overload, and updates at most ~once per second.
const cpuSub = project.engine.cpuLoad.catchupAndSubscribe((obs) => {
  showLoad(obs.getValue());       // e.g. 14 → "14%"
});

// perfBuffer is a Float32Array ring buffer of recent per-render-quantum processing times (ms);
// perfIndex is the write cursor.
const history = project.engine.perfBuffer;
```

Actual audio **dropouts** are reported by the browser, not the engine, via `AudioContext.playbackStats.underrunEvents` (a running count; Chromium-only — feature-detect it):

```typescript
const stats = (audioContext as { playbackStats?: { underrunEvents: number } }).playbackStats;
const dropouts = stats?.underrunEvents ?? null; // null where unsupported
```

`BufferUnderrunDetector` (from `@opendaw/studio-core`) wraps that same browser stat to escalate sustained dropouts; it exposes no public getter, so read `playbackStats.underrunEvents` directly if you want a number to display.

### CPU Overload Handling

When the audio thread can't keep up, `project.handleCpuOverload()` puts the engine to sleep — it calls `engine.sleep()` (which **stops playback**) and posts a non-blocking notification. It is gated on `StudioPreferences.settings.engine["stop-playback-when-overloading"]` (default `true`); when that flag is off, `handleCpuOverload()` returns without stopping. Note that `StudioPreferences` (from `@opendaw/studio-core`) is a **separate** preferences object from `project.engine.preferences` — this behavior lives with the studio settings, not the engine settings.

Two independent triggers escalate to that handler:

- **Engine-side load:** while `debug.dspLoadMeasurement` is on, the engine tracks sustained over-budget render blocks (the perf buffer only advances when measurement is enabled).
- **Browser dropouts:** `BufferUnderrunDetector` watches `AudioContext.playbackStats.underrunEvents` and escalates sustained growth.

Both call `engine.sleep()` + notify under the same `stop-playback-when-overloading` flag, so sustained overload stops playback rather than glitching indefinitely.

## Boot Failure, Isolation, and Cost

- **There is no fallback engine.** `ensureReady` returning `false` (missing artifacts, an
  unsupported environment) means no engine can boot — `EngineVariant.current()` throws on
  the next construction attempt rather than silently downgrading. Surface the failure to
  the user; derive any "engine ready" UI state from `WasmEngine.isReady()` after boot,
  not from the request.
- **The provider is per page.** `EngineVariant.install` registers a provider in the
  current page's module scope — every page that boots an engine must run
  `WasmEngine.install` itself.
- **A restart has a cost.** The SDK's `EngineFacade` supports a live engine restart —
  terminate the worklet, construct a new one, and re-sync the full box graph, which takes
  on the order of seconds. Install once, before the first worklet, and reboot only when
  you must.

## Demo

[WASM Engine](https://opendaw-test.pages.dev/wasm-engine-demo.html) — a Vaporisateur synth loop running on the WASM engine, with WASM readiness status and an opt-in DSP-load / dropout readout.
