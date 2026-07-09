# Swappable Audio Engine (WASM)

> **Skip if:** the built-in TypeScript engine meets your needs — every demo works on it unchanged, and the WASM engine is entirely opt-in.
> **Prerequisites:** Ch. 00 (System Architecture) for the worklet/engine model, Ch. 15 (Performance & Debugging) for DSP-load context.

## Table of Contents

- [Two Engines, One Contract](#two-engines-one-contract)
- [Enabling the WASM Engine](#enabling-the-wasm-engine)
  - [The WasmEngine Façade](#the-wasmengine-facade)
  - [Serving the WASM Binaries](#serving-the-wasm-binaries)
  - [Low-Level: EngineVariant.install](#low-level-enginevariantinstall)
- [Swapping Engines Live](#swapping-engines-live)
- [Offline Renders Through the Variant](#offline-renders-through-the-variant)
- [Configuring the Engine](#configuring-the-engine)
  - [Engine Preferences](#engine-preferences)
  - [DSP-Load Measurement and Telemetry](#dsp-load-measurement-and-telemetry)
  - [CPU Overload Handling](#cpu-overload-handling)
- [Fallback, Isolation, and Cost](#fallback-isolation-and-cost)
- [Demo](#demo)

---

## Two Engines, One Contract

OpenDAW ships two interchangeable audio backends that speak the **same message contract**:

- The built-in **TypeScript engine** — the default `AudioWorkletProcessor` (`"engine-processor"`).
- The alternative **WASM engine** — a Rust build compiled to WebAssembly, distributed in `@opendaw/studio-core-wasm`.

Selection is global and resolved when the engine boots. `EngineWorklet` reads `EngineVariant.current()` in its constructor:

- `null` → the built-in TypeScript engine (unchanged).
- a non-`null` `EngineWorkletVariant` → the WASM processor is instantiated instead, with the variant's box-graph sync in place of the default `SyncSource`.

Because both engines implement the same contract over the same box graph, they render the **same audio** — the WASM engine is a drop-in replacement chosen for performance, not for a different sound. Nothing changes about how you build a `Project`, create instruments, schedule regions, or read engine state; only the processor behind `project.engine` differs.

```typescript
import { EngineVariant } from "@opendaw/studio-core";

// null unless a variant has been installed → the built-in TypeScript engine
const variant = EngineVariant.current();
```

## Enabling the WASM Engine

### The WasmEngine Façade

`@opendaw/studio-core-wasm` exposes a `WasmEngine` namespace that wires the variant for you:

```typescript
export declare namespace WasmEngine {
  const install: (urls: WasmEngineUrls) => void;
  const ensureReady: (context: BaseAudioContext) => Promise<boolean>;
  const setEnabled: (enabled: boolean) => void;
  const isEnabled: () => boolean;      // localStorage flag; WASM is the default (opt-out)
  const isReady: () => boolean;        // modules compiled + processor registered
  const useForExports: () => boolean;  // enabled && ready && an offline variant is installed
}

export type WasmEngineUrls = {
  processorUrl: string;      // the prebuilt worklet module
  offlineWorkerUrl: string;  // the prebuilt offline render worker
  wasmUrl: string;           // base URL serving the .wasm binaries (see below)
};
```

`install` registers the `EngineVariant` provider (and the offline-render variant); `ensureReady` compiles the WASM modules and registers the processor module on the given `AudioContext`. Both are idempotent.

Wire it up **before the first `project.startAudioWorklet()`**, so the first `EngineWorklet` already boots on WASM. With a bundler such as Vite, resolve the two prebuilt scripts to hashed URLs and point `wasmUrl` at wherever you serve the binaries:

```typescript
import { WasmEngine } from "@opendaw/studio-core-wasm";
import processorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
import offlineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?worker&url";

WasmEngine.install({ processorUrl, offlineWorkerUrl, wasmUrl: "/wasm-engine" });

// ensureReady needs the AudioContext the engine will run on. It returns false when the
// artifacts are unavailable (e.g. a deploy without them) — fall back to the TS engine.
const ready = await WasmEngine.ensureReady(audioContext);
if (!ready) {
  console.warn("WASM engine unavailable — using the TypeScript engine.");
}
```

Enabling the WASM engine is opt-in at the **integration** level — nothing happens until you call `install` and serve the binaries. But *once installed*, the **runtime** flag is opt-out: `isEnabled()` reads a persisted `localStorage` flag that defaults to enabled and records only an explicit opt-out. Toggle it with `setEnabled(true | false)`. While the engine is disabled or its modules are not yet compiled, the `EngineVariant` provider yields `null`, so the next boot uses the TypeScript engine.

### Serving the WASM Binaries

`ensureReady` fetches the WebAssembly binaries from the `wasmUrl` base — one engine module plus one module per device:

```
${wasmUrl}/wasm/engine.wasm
${wasmUrl}/wasm/plugins/device_vaporisateur.wasm
${wasmUrl}/wasm/plugins/device_reverb.wasm
… (one per device box type)
```

The binaries ship inside the package at `@opendaw/studio-core-wasm/dist/wasm/`, and are fetched with plain `fetch` + `WebAssembly.compile` (no streaming), so no special `Content-Type` is required. Serve that `wasm/` subtree at your chosen `wasmUrl` base — copy it into your static assets at build time, or serve it straight from the package in development. If a binary is missing, `ensureReady` resolves to `false` and the engine falls back to TypeScript.

### Low-Level: EngineVariant.install

`WasmEngine.install` is a convenience wrapper over `EngineVariant`. For full control — a custom processor, custom box-graph sync, or a bespoke freeze path — install a provider directly:

```typescript
import { EngineVariant, type EngineWorkletVariant } from "@opendaw/studio-core";

EngineVariant.install((): EngineWorkletVariant | null => {
  if (!shouldUseVariant()) { return null; } // null → built-in TypeScript engine
  return {
    processorName: "engine-wasm-processor",       // processor to instantiate
    attachment: { /* structured-clone extras */ }, // handed to processorOptions.variant
    connectSync: (messenger, project) => wireSync(messenger, project), // returns Terminable
    connectFrozenAudio: (messenger) => makeFrozenWriter(messenger),    // optional freeze-PCM path
  };
});
```

The provider is a function, re-evaluated on every engine construction, so returning `null` under some condition (a feature flag, an unsupported browser) transparently keeps that boot on the TypeScript engine.

## Swapping Engines Live

`project.engine` is a persistent `EngineFacade` that **outlives individual worklets** — its observable state (`position`, `isPlaying`, `bpm`, `cpuLoad`, `preferences`) is re-fed from each worklet as it attaches. That is what makes a live swap possible: flip the selection, then reboot only the `EngineWorklet`.

```typescript
import type { EngineWorklet, RestartWorklet } from "@opendaw/studio-core";

async function swapEngine(project: Project, ctx: BaseAudioContext, wasm: boolean): Promise<void> {
  WasmEngine.setEnabled(wasm);            // change which variant current() will yield
  // Enabling WASM boots the TS engine until the modules are compiled — ensure they are ready
  // first, or the provider yields null and the swap silently stays on TypeScript.
  if (wasm) { await WasmEngine.ensureReady(ctx); }

  const engine = project.engine;
  const wasPlaying = engine.isPlaying.getValue();
  const position = engine.position.getValue();

  const restart: RestartWorklet = {
    unload: async () => {},                       // called on the SDK's error-restart path
    load: (w: EngineWorklet) => engine.setWorklet(w),
  };

  engine.releaseWorklet();                        // terminate the current worklet
  // startAudioWorklet re-reads EngineVariant.current() and sets the new worklet on the facade.
  const worklet = project.startAudioWorklet(restart, {});
  await worklet.isReady();

  engine.setPosition(position);                   // restore transport state
  if (wasPlaying) { engine.play(); }
}
```

`releaseWorklet()` empties the facade's worklet slot before the new one is constructed, so guard the reboot: if `startAudioWorklet` throws (or `isReady()` never settles), recover by re-enabling the TypeScript engine and rebooting, rather than leaving the engine with no worklet. Capturing and restoring `position`/`isPlaying` keeps playback continuous across the swap.

## Offline Renders Through the Variant

Background renders (mixdown, stems, freeze, consolidation) run in a worker, and `OfflineEngineRenderer` mirrors the engine toggle into them:

```typescript
class OfflineEngineRenderer {
  static installVariant(url: string, attachment: Record<string, unknown>): void;
  static installVariantPolicy(policy: () => boolean): void; // default for freeze/consolidation
  static hasVariant(): boolean;
  static getWorkerUrl(): string;

  static start(source: Project, optExportConfiguration: Option<ExportConfiguration>,
               progress: DefaultObservableValue<number>, abortSignal?: AbortSignal,
               sampleRate?: number, variant?: boolean): Promise<AudioData>;
  static create(source: Project, optExportConfiguration: Option<ExportConfiguration>,
                sampleRate?: number, variant?: boolean, abortSignal?: AbortSignal): Promise<OfflineEngineRenderer>;
}
```

`WasmEngine.install` also calls `OfflineEngineRenderer.installVariant(offlineWorkerUrl, { wasmUrl })` and sets a variant policy of `WasmEngine.useForExports()`, so freeze and consolidation renders follow the same toggle as live playback. The trailing `variant?` parameter on `start`/`create` is **optional** and resolves through the installed policy (`variant ??= variantPolicy()`). The default policy is `() => false` (TypeScript engine), but once you call `WasmEngine.install` and `ensureReady` succeeds, the policy is `useForExports()` — true whenever the engine is enabled, ready, and a variant is installed. **So after the setup above, an offline render that omits `variant` defaults to the WASM worker**, matching live playback; pass `variant: false` explicitly to force a render onto the TypeScript engine. See Ch. 10 (Export) for the render protocol and per-stem `AudioData` output.

## Configuring the Engine

Engine configuration is identical across both backends — the same preferences drive the TypeScript and WASM engines. Access them through the facade.

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

Both engines read these live — the TypeScript engine re-reads per render block, and the WASM engine subscribes to the preference path — so changes take effect immediately without a reboot.

### DSP-Load Measurement and Telemetry

Measuring DSP load runs extra work on the audio thread and slightly perturbs the very load it reports, so it is **off by default** (`debug.dspLoadMeasurement`, default `false`). Turn it on only while you need a reading:

```typescript
settings.debug.dspLoadMeasurement = true;
```

With it enabled, read the engine's load and recent history from the facade — both survive an engine swap because they live on the persistent `EngineFacade`:

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

## Fallback, Isolation, and Cost

- **Fallback is graceful.** `ensureReady` returning `false` (missing artifacts, an unsupported environment) leaves the `EngineVariant` provider yielding `null`, so the engine boots on TypeScript with no error. Derive your "active engine" label from `WasmEngine.isReady()` after boot, not from the request, so the UI reflects what actually booted.
- **The provider is per page; the enable flag is per origin.** `EngineVariant.install` registers a provider in the current page's module scope, so code that never installs a variant always gets the TypeScript engine regardless of the persisted flag. The `WasmEngine` enable flag, however, is a single `localStorage` key (`"opendaw-wasm-engine"`) shared across the whole origin — so two pages that both call `WasmEngine.install` share the toggle, and `setEnabled(false)` in one affects the other's next boot.
- **A swap has a cost.** A live swap terminates the worklet, constructs a new one, and re-syncs the full box graph, which takes on the order of seconds. Disable the toggle and show a "switching…" affordance while `startAudioWorklet` → `isReady()` completes, and restore transport state afterward.

## Demo

[WASM Engine A/B Demo](https://opendaw-test.pages.dev/wasm-engine-demo.html) — the same Vaporisateur synth loop through either backend, with a live TypeScript ↔ WASM toggle and an opt-in DSP-load / dropout readout.
