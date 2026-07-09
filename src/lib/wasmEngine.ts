import { WasmEngine } from "@opendaw/studio-core-wasm";
import type { Project, EngineWorklet } from "@opendaw/studio-core";

// Vite serves these from the package dist; ?url / ?worker&url give hashed same-origin URLs.
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?worker&url";

/** Base dir the Vite plugin (wasm-engine-assets) serves the .wasm binaries from. */
const WASM_BASE_URL = "/wasm-engine";

let installed = false;

/** Register the EngineVariant provider + offline variant. Safe to call more than once. */
export function installWasmEngine(): void {
  if (installed) { return; }
  installed = true;
  WasmEngine.install({
    processorUrl: wasmProcessorUrl,
    offlineWorkerUrl: wasmOfflineWorkerUrl,
    wasmUrl: WASM_BASE_URL,
  });
}

/** Compile the wasm modules + register the processor. false ⇒ artifacts unavailable (fall back to TS). */
export function ensureWasmReady(ctx: BaseAudioContext): Promise<boolean> {
  return WasmEngine.ensureReady(ctx);
}

export function setWasmEnabled(enabled: boolean): void { WasmEngine.setEnabled(enabled); }
export function isWasmEnabled(): boolean { return WasmEngine.isEnabled(); }
export function isWasmReady(): boolean { return WasmEngine.isReady(); }

export type EngineStatus = {
  requested: "wasm" | "ts";
  active: "wasm" | "ts";
  fellBack: boolean;
};

/** Pure, UI-facing description of an EngineStatus. */
export function describeEngineStatus(s: EngineStatus): { label: string; sub: string } {
  const label = s.active === "wasm" ? "WASM (Rust)" : "TypeScript";
  const sub = s.fellBack ? "WASM unavailable — using TypeScript" : "ready";
  return { label, sub };
}

/**
 * Swap the audio backend live. Sets the WasmEngine flag, (re)compiles wasm if enabling,
 * then reboots ONLY the EngineWorklet — EngineWorklet reads EngineVariant.current() at
 * construction. Playback position (and play state) are captured and restored so the swap
 * is seamless mid-loop. Returns the engine that ACTUALLY booted.
 */
export async function switchEngine(
  project: Project,
  ctx: BaseAudioContext,
  wasm: boolean,
): Promise<EngineStatus> {
  const engine = project.engine;
  setWasmEnabled(wasm);

  let ready = false;
  if (wasm) {
    ready = await ensureWasmReady(ctx);
  }

  const wasPlaying = engine.isPlaying.getValue();
  const position = engine.position.getValue();

  // Reboot the EngineWorklet (re-reads EngineVariant.current()) and restore transport state.
  const boot = async (): Promise<void> => {
    engine.releaseWorklet();
    const worklet: EngineWorklet = project.startAudioWorklet(
      { unload: async () => {}, load: (w: EngineWorklet) => engine.setWorklet(w) },
      {},
    );
    // Belt-and-suspenders: startAudioWorklet already sets the worklet internally; restart.load only fires on the SDK's error-restart path. Explicit set matches upstream's restart pattern.
    engine.setWorklet(worklet);
    await worklet.isReady();
    engine.setPosition(position);
    if (wasPlaying) { engine.play(); }
  };

  try {
    await boot();
    const active: "wasm" | "ts" = wasm && isWasmReady() ? "wasm" : "ts";
    return { requested: wasm ? "wasm" : "ts", active, fellBack: wasm && !ready };
  } catch (err) {
    // The chosen engine failed to boot and releaseWorklet() already emptied the slot —
    // recover on the built-in TypeScript engine so audio isn't left dead.
    console.warn("[wasmEngine] engine boot failed; falling back to the TypeScript engine:", String(err));
    setWasmEnabled(false);
    await boot(); // if this also throws it is genuinely unrecoverable — let it reject
    return { requested: wasm ? "wasm" : "ts", active: "ts", fellBack: wasm };
  }
}
