import { describe, it, expect, vi } from "vitest";

// `wasmEngine.ts` imports the real `@opendaw/studio-core-wasm` package, which transitively
// imports `@opendaw/studio-core`'s `EngineWorklet` — a class that `extends AudioWorkletNode`
// at module-eval time. `AudioWorkletNode` doesn't exist in vitest's default Node test
// environment, so any import of `./wasmEngine` throws `ReferenceError: AudioWorkletNode is
// not defined` before a single assertion runs. `describeEngineStatus` itself never touches
// `WasmEngine`, so mock the module purely to neutralize this import-time side effect.
vi.mock("@opendaw/studio-core-wasm", () => ({
  WasmEngine: {
    install: vi.fn(),
    ensureReady: vi.fn(async () => true),
    setEnabled: vi.fn(),
    isEnabled: vi.fn(() => true),
    isReady: vi.fn(() => true),
  },
}));

import { describeEngineStatus } from "./wasmEngine";

describe("describeEngineStatus", () => {
  it("labels an active WASM engine", () => {
    const r = describeEngineStatus({ requested: "wasm", active: "wasm", fellBack: false });
    expect(r.label).toBe("WASM (Rust)");
    expect(r.sub).toBe("ready");
  });

  it("labels the TypeScript engine", () => {
    const r = describeEngineStatus({ requested: "ts", active: "ts", fellBack: false });
    expect(r.label).toBe("TypeScript");
    expect(r.sub).toBe("ready");
  });

  it("reports a fallback when WASM was requested but unavailable", () => {
    const r = describeEngineStatus({ requested: "wasm", active: "ts", fellBack: true });
    expect(r.label).toBe("TypeScript");
    expect(r.sub).toBe("WASM unavailable — using TypeScript");
  });
});
