import { afterEach, describe, expect, it, vi } from "vitest";
import { Option } from "@opendaw/lib-std";
import { OfflineEngineRenderer, type Project } from "@opendaw/studio-core";
import { isWasmReady } from "@/lib/wasmEngine";
import { renderOfflineSlice } from "./offlineScan";

// The offline renderer needs the WASM worker, which Node has not (and `studio-core` itself needs `AudioWorkletNode` at
// module load): the renderer is a stub that records what it was created on and answers the frames asked for, so the
// contract around it (the copy, its loop write, `mutateCopy`) is testable.
vi.mock("@/lib/wasmEngine", () => ({ isWasmReady: vi.fn(() => true) }));
vi.mock("@opendaw/studio-core", () => ({ OfflineEngineRenderer: { create: vi.fn() } }));

const RATE = 1000;

interface Fake { live: Project; copy: Project; log: string[] }

/** A live project whose `copy()` yields a second fake; every write and call lands in `log` in order. */
function fakeProject(): Fake {
  const log: string[] = [];
  const timeline = (name: string) => ({
    loopArea: { enabled: { setValue: (value: boolean) => log.push(`${name}.loop=${value}`) } },
    bpm: { getValue: () => 120 },
  });
  const copy = {
    editing: { modify: (fn: () => void) => { fn(); return Option.None; } },
    timelineBox: timeline("copy"),
    terminate: () => log.push("copy.terminate"),
  } as unknown as Project;
  const live = {
    editing: { modify: () => { throw new Error("the live project must not be written"); } },
    timelineBox: timeline("live"),
    copy: () => { log.push("copy"); return copy; },
  } as unknown as Project;
  return { live, copy, log };
}

function stubRenderer(log: string[]) {
  vi.mocked(OfflineEngineRenderer.create).mockImplementation(async (project) => {
    log.push("create");
    return {
      setPosition: () => {},
      play: async () => {},
      waitForLoading: async () => {},
      step: async (frames: number) => [new Float32Array(frames), new Float32Array(frames)],
      stop: () => log.push("renderer.stop"),
      terminate: () => log.push("renderer.terminate"),
      project,
    } as unknown as OfflineEngineRenderer;
  });
}

describe("renderOfflineSlice", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("runs mutateCopy on the copy, after the loop-disable write and before the renderer is created, never on the live project", async () => {
    const { live, copy, log } = fakeProject();
    stubRenderer(log);
    const seen: Project[] = [];
    await renderOfflineSlice(live, 0, 1, RATE, { mutateCopy: (project) => { seen.push(project); log.push("mutateCopy"); } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(copy);
    expect(log).toEqual(["copy", "copy.loop=false", "mutateCopy", "create", "renderer.stop", "renderer.terminate", "copy.terminate"]);
    expect(vi.mocked(OfflineEngineRenderer.create)).toHaveBeenCalledWith(copy, Option.None, RATE);
  });

  it("a mutateCopy that throws ends the render before a renderer exists and still terminates the copy", async () => {
    const { live, log } = fakeProject();
    stubRenderer(log);
    await expect(renderOfflineSlice(live, 0, 1, RATE, { mutateCopy: () => { throw new Error("no master"); } })).rejects.toThrow("no master");
    expect(log).toEqual(["copy", "copy.loop=false", "copy.terminate"]);
    expect(vi.mocked(OfflineEngineRenderer.create)).not.toHaveBeenCalled();
  });

  it("keepLoopEnabled skips the loop write; mutateCopy still runs on the copy", async () => {
    const { live, copy, log } = fakeProject();
    stubRenderer(log);
    const seen: Project[] = [];
    await renderOfflineSlice(live, 0, 1, RATE, { keepLoopEnabled: true, mutateCopy: (project) => { seen.push(project); } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(copy);
    expect(log).toEqual(["copy", "create", "renderer.stop", "renderer.terminate", "copy.terminate"]);
  });

  it("refuses before copying when the WASM engine is not ready", async () => {
    vi.mocked(isWasmReady).mockReturnValueOnce(false);
    const { live, log } = fakeProject();
    stubRenderer(log);
    await expect(renderOfflineSlice(live, 0, 1, RATE)).rejects.toThrow("WASM engine is not ready");
    expect(log).toEqual([]);
  });
});
