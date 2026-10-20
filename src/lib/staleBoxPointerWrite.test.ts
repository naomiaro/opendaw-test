// Regression test for debug/2026-10-19-stale-box-pointer-write/note.md (openDAW#480, fixed upstream).
//
// A box instance that undo replaced (same uuid, new instance) reports detached. A write through
// it — scalar or pointer — stays on the detached instance: the live box, the update stream, the
// SDK's own sync mirror and the engine binary never see it. The pointer path once lacked the
// attachment guard the scalar path has (a ghost edge on the target, a pointer update for the
// LIVE address that the mirror and the engine applied, a target that could no longer be
// released); these tests pin the guarded behaviour against the installed lib-box, the sync
// mirror and the installed engine.wasm, and fail if the guard is lost.
import { describe, expect, it } from "vitest";
import { Arrays, Option, UUID } from "@opendaw/lib-std";
import { BoxEditing, BoxGraph, SyncSource, createSyncTarget, type Update } from "@opendaw/lib-box";
import { Messenger } from "@opendaw/lib-runtime";
import { AudioFileBox, BoxIO, type NanoDeviceBox } from "@opendaw/studio-boxes";
import { graphWithSamplers, transact } from "./testing/boxGraphFixtures";

const short = (address: { toString(): string }) => address.toString().slice(0, 8);
const targetOf = (box: NanoDeviceBox) => box.file.targetAddress.mapOr(short, "none");

/** Two samplers; the first is deleted and restored by undo, so `stale` and `live` share a uuid. */
function staleAndLive() {
  const { boxGraph, samplers: [box, other] } = graphWithSamplers(2);
  const editing = new BoxEditing(boxGraph);
  // an AudioFileBox needs an incoming edge: the second sampler holds it alive
  const audioFile = transact(boxGraph, () => {
    const file = AudioFileBox.create(boxGraph, UUID.generate(), (file) => file.fileName.setValue("probe"));
    other.file.refer(file);
    return file;
  });
  editing.modify(() => box.delete());
  expect(boxGraph.findBox(box.address.uuid).isEmpty()).toBe(true);
  expect(editing.undo()).toBe(true);
  const live = boxGraph.findBox<NanoDeviceBox>(box.address.uuid).unwrap("undo did not restore the box");
  expect(live).not.toBe(box);
  expect(box.isAttached()).toBe(false);
  expect(live.isAttached()).toBe(true);
  const updates: Update[] = [];
  const subscription = boxGraph.subscribeToAllUpdates({ onUpdate: (update) => updates.push(update) });
  return { boxGraph, editing, stale: box, live, other, audioFile, updates, subscription };
}

describe("a box instance replaced by undo", () => {
  it("scalar write: the live field and the update stream are untouched", () => {
    const { editing, stale, live, updates } = staleAndLive();
    const before = live.volume.getValue();
    editing.modify(() => stale.volume.setValue(before - 6));
    expect(stale.volume.getValue()).toBe(before - 6); // the field takes the value; the graph ignores it
    expect(live.volume.getValue()).toBe(before);
    expect(updates).toEqual([]);
  });

  it("pointer write: no edge on the target, no update; the stale field keeps its own value", () => {
    const { boxGraph, editing, stale, live, other, audioFile, updates } = staleAndLive();
    expect(live.file.isEmpty()).toBe(true);
    expect(audioFile.pointerHub.size()).toBe(1);
    editing.modify(() => stale.file.refer(audioFile));
    expect(targetOf(live)).toBe("none");
    expect(targetOf(stale)).toBe(short(audioFile.address)); // stored on the detached instance, like a scalar write
    const incoming = boxGraph.edges().incomingEdgesOf(audioFile);
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toBe(other.file);
    expect(incoming).not.toContain(stale.file);
    expect(audioFile.pointerHub.size()).toBe(1);
    expect(updates).toEqual([]);
  });

  it("a mandatory-edge target is still held by its real user alone after a stale write", () => {
    const { editing, stale, live, other, audioFile } = staleAndLive();
    // control: letting go of the last pointer is refused (the box needs an edge)
    expect(() => editing.modify(() => other.file.defer())).toThrow(/requires an edge/);
    expect(audioFile.pointerHub.size()).toBe(1);
    editing.modify(() => stale.file.refer(audioFile));
    // the stale write added no edge, so the same release is refused the same way
    expect(() => editing.modify(() => other.file.defer())).toThrow(/requires an edge/);
    expect(audioFile.isAttached()).toBe(true);
    expect(audioFile.pointerHub.size()).toBe(1);
    expect(targetOf(stale)).toBe(short(audioFile.address));
    expect(targetOf(live)).toBe("none");
    // deleting the target defers its one real pointer; nothing dangles
    editing.modify(() => audioFile.delete());
    expect(audioFile.isAttached()).toBe(false);
    expect(other.file.isEmpty()).toBe(true);
  });

  it("with a target on the live field, a stale write elsewhere leaves both targets deletable", () => {
    const { boxGraph, editing, stale, live, other, audioFile } = staleAndLive();
    editing.modify(() => live.file.refer(audioFile));
    const second = transact(boxGraph, () => {
      const file = AudioFileBox.create(boxGraph, UUID.generate(), (file) => file.fileName.setValue("second"));
      other.file.refer(file);
      return file;
    });
    editing.modify(() => stale.file.refer(second));
    expect(targetOf(live)).toBe(short(audioFile.address));
    expect(second.pointerHub.size()).toBe(1);
    expect(second.pointerHub.incoming()).not.toContain(stale.file);
    expect(boxGraph.edges().isConnected(live.file, audioFile.address)).toBe(true);
    // deleting the stale write's target defers its one real pointer and leaves the live edge alone
    editing.modify(() => second.delete());
    expect(second.isAttached()).toBe(false);
    expect(other.file.isEmpty()).toBe(true);
    expect(targetOf(stale)).toBe(short(second.address)); // the detached instance keeps its dangling value
    expect(targetOf(live)).toBe(short(audioFile.address));
    expect(boxGraph.edges().isConnected(live.file, audioFile.address)).toBe(true);
    // the live field is audioFile's last pointer: releasing it is refused by the mandatory-edge
    // rule, deleting the target is not
    expect(() => editing.modify(() => live.file.defer())).toThrow(/requires an edge/);
    expect(targetOf(live)).toBe(short(audioFile.address));
    editing.modify(() => audioFile.delete());
    expect(audioFile.isAttached()).toBe(false);
    expect(targetOf(live)).toBe("none");
  });

  it("the SDK's sync mirror sees nothing of the stale write, so the graphs stay in checksum", async () => {
    const { editing, stale, live, boxGraph, audioFile } = staleAndLive();
    const mirror = new BoxGraph<BoxIO.TypeMap>(Option.wrap(BoxIO.create));
    const { port1, port2 } = new MessageChannel();
    const target = createSyncTarget(mirror, Messenger.for(port2 as never));
    const source = new SyncSource(boxGraph, Messenger.for(port1 as never), true);
    // the checksum request travels the same port behind the updates, so awaiting it is the settle;
    // the target rejects it with "Checksum mismatch" when the mirror has diverged
    const compare = () => source.checksum(boxGraph.checksum());
    const same = () => Arrays.equals(boxGraph.checksum(), mirror.checksum());
    const mirrorFile = () => targetOf(mirror.findBox<NanoDeviceBox>(live.address.uuid).unwrap("mirror box"));
    try {
      await expect(compare()).resolves.toBeUndefined();
      expect(same()).toBe(true);
      expect(mirrorFile()).toBe("none");
      editing.modify(() => stale.file.refer(audioFile));
      await expect(compare()).resolves.toBeUndefined();
      expect(targetOf(live)).toBe("none");
      expect(mirrorFile()).toBe("none");
      expect(same()).toBe(true);
    } finally {
      source.terminate();
      target.terminate();
      port1.close();
      port2.close();
    }
  });
});

describe("the WASM engine's mirror (apply_updates on the installed engine.wasm)", () => {
  it("receives no update for the stale pointer write: the engine's checksum stays the source's", async () => {
    const { readFileSync } = await import("node:fs");
    const { Communicator } = await import("@opendaw/lib-runtime");
    const { serializeUpdateTasks } = await import("../../node_modules/@opendaw/studio-core-wasm/dist/sync/serialize-update-tasks.js");
    const { createSyncLoopback } = await import("../../node_modules/@opendaw/studio-core-wasm/dist/sync/loopback.js");
    type EngineExports = {
      input_reserve(len: number): number; checksum_ptr(): number; init(sampleRate: number): void; apply_updates(len: number): number;
    };
    const module = await WebAssembly.compile(readFileSync("node_modules/@opendaw/studio-core-wasm/dist/wasm/engine.wasm"));
    const memory = new WebAssembly.Memory({ initial: 256 });
    const table = new WebAssembly.Table({ initial: 512, element: "anyfunc" });
    const engine = new WebAssembly.Instance(module, {
      env: { memory, __indirect_function_table: table, host_perf_now: () => performance.now() * 1000.0 },
    }).exports as unknown as EngineExports;
    engine.init(48000);
    const engineChecksum = () => new Int8Array(memory.buffer, engine.checksum_ptr(), 32).slice();
    const applied: number[] = [];
    const { boxGraph, editing, stale, live, audioFile } = staleAndLive();
    const loopback = createSyncLoopback();
    const executor = Communicator.executor(loopback.target, {
      sendUpdates: (tasks: Parameters<typeof serializeUpdateTasks>[0]) => {
        const bytes = new Uint8Array(serializeUpdateTasks(tasks));
        const pointer = engine.input_reserve(bytes.length);
        new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes);
        applied.push(engine.apply_updates(bytes.length));
      },
      checksum: () => Promise.resolve(),
    });
    const source = new SyncSource<BoxIO.TypeMap>(boxGraph, loopback.source, true);
    try {
      expect(applied).toEqual([0]);
      expect(engineChecksum()).toEqual(boxGraph.checksum());
      editing.modify(() => stale.file.refer(audioFile));
      expect(applied.every((code) => code === 0)).toBe(true); // whatever crossed, the engine accepted
      expect(targetOf(live)).toBe("none");
      expect(engineChecksum()).toEqual(boxGraph.checksum());
    } finally {
      source.terminate();
      executor.terminate();
      loopback.terminate();
    }
  });
});
