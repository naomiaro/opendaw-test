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

export function isWasmInstalled(): boolean { return installed; }

/**
 * True when the page was loaded with `?engine=wasm`. The debug/repro pages use this
 * to opt into the WASM (Rust) engine for re-verifying upstream fixes that are scoped
 * to it (openDAW#311/#312 were closed with "make sure to run the wasm audio engine").
 */
export function wasmRequestedByUrl(): boolean {
  return new URLSearchParams(window.location.search).get("engine") === "wasm";
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

// A worklet reboot (release + reconstruct + full box-graph re-sync) legitimately takes ~10-15s,
// so this ceiling is generous — it exists only to catch a boot that NEVER settles (e.g. a WASM
// processor that errors at construction: EngineWorklet.isReady() resolves-or-hangs, it never
// rejects). Without it, `await worklet.isReady()` could hang forever, leaving the switch UI stuck
// on "Switching…". A timeout throws → the catch below recovers on the TS engine.
const REBOOT_TIMEOUT_MS = 30_000;

function withTimeout(promise: Promise<void>, ms: number, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      () => { clearTimeout(timer); resolve(); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Swap the audio backend live. Sets the WasmEngine flag, (re)compiles wasm if enabling,
 * then reboots ONLY the EngineWorklet — EngineWorklet reads EngineVariant.current() at
 * construction. Playback position (and play state) are captured and restored so the swap
 * is seamless mid-loop. Returns the engine that ACTUALLY booted. If the chosen engine fails
 * to boot (synchronous throw OR a never-settling isReady, caught by REBOOT_TIMEOUT_MS), it
 * recovers on the built-in TS engine rather than leaving audio dead or the UI hung.
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
    await withTimeout(worklet.isReady(), REBOOT_TIMEOUT_MS, "engine boot");
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
