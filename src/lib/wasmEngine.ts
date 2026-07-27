import { WasmEngine } from "@opendaw/studio-core-wasm";

// Vite serves these from the package dist; ?url / ?worker&url give hashed same-origin URLs.
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?worker&url";

/** Base dir the Vite plugin (wasm-engine-assets) serves the .wasm binaries from. */
const WASM_BASE_URL = "/wasm-engine";

let installed = false;

/**
 * Register the EngineVariant provider + offline engine worker. Safe to call more than
 * once. The WASM (Rust) engine is the ONLY engine — upstream removed the TypeScript
 * engine in SDK 0.0.161, so there is no fallback; initializeOpenDAW() calls this and
 * throws if the engine cannot compile. (The old `WasmEngine.setEnabled` localStorage
 * opt-out is gone with it — nothing to force-enable anymore.)
 */
export function installWasmEngine(): void {
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
