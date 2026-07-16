import { WasmEngine } from "@opendaw/studio-core-wasm";

// Vite serves these from the package dist; ?url / ?worker&url give hashed same-origin URLs.
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?worker&url";

/** Base dir the Vite plugin (wasm-engine-assets) serves the .wasm binaries from. */
const WASM_BASE_URL = "/wasm-engine";

let installed = false;

/**
 * Register the EngineVariant provider + offline variant. Safe to call more than once.
 * The WASM (Rust) engine is the ONLY engine these demos run — the TypeScript engine
 * is deprecated upstream and no longer wired here; initializeOpenDAW() calls this and
 * throws if the engine cannot compile.
 */
export function installWasmEngine(): void {
  // Force-enable on every call: `opendaw-wasm-engine` in localStorage is a persisted
  // opt-out shared across the whole origin (the retired A/B demo could leave it false),
  // and a stale `false` makes EngineVariant.current() return null — the boot would
  // silently come up with no engine variant.
  WasmEngine.setEnabled(true);
  if (installed) { return; }
  installed = true;
  WasmEngine.install({
    processorUrl: wasmProcessorUrl,
    offlineWorkerUrl: wasmOfflineWorkerUrl,
    wasmUrl: WASM_BASE_URL,
  });
}

/** Compile the wasm modules + register the processor. false ⇒ artifacts unavailable. */
export function ensureWasmReady(ctx: BaseAudioContext): Promise<boolean> {
  return WasmEngine.ensureReady(ctx);
}

export function isWasmReady(): boolean { return WasmEngine.isReady(); }
