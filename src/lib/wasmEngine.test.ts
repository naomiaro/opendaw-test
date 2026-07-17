import { describe, it, expect, vi } from "vitest";

// `wasmEngine.ts` imports the real `@opendaw/studio-core-wasm` package, which transitively
// imports `@opendaw/studio-core`'s `EngineWorklet` — a class that `extends AudioWorkletNode`
// at module-eval time. `AudioWorkletNode` doesn't exist in vitest's default Node test
// environment, so mock the module purely to neutralize this import-time side effect.
vi.mock("@opendaw/studio-core-wasm", () => ({
  WasmEngine: {
    install: vi.fn(),
    ensureReady: vi.fn(async () => true),
    setEnabled: vi.fn(),
    isReady: vi.fn(() => true),
  },
}));

import { WasmEngine } from "@opendaw/studio-core-wasm";
import { installWasmEngine } from "./wasmEngine";

describe("installWasmEngine", () => {
  it("installs the variant once but force-enables on every call", () => {
    installWasmEngine();
    installWasmEngine();
    expect(vi.mocked(WasmEngine.install)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(WasmEngine.setEnabled)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(WasmEngine.setEnabled)).toHaveBeenCalledWith(true);
  });
});
