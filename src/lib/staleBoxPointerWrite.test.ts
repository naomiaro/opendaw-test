// SDK probe and regression test for debug/2026-10-19-stale-box-pointer-write/note.md (openDAW#480).
//
// A box instance that undo replaced (same uuid, new instance) reports detached, and a SCALAR
// write through it reaches neither the live box nor the update stream. A POINTER write through it
// takes the graph path that has no attachment guard: the target's incoming list gains the stale
// field (the outgoing table, keyed by source address, which the stale and the live field share,
// keeps whichever entry came first), a pointer update for the LIVE address is emitted, and the
// SDK's own sync mirror and the engine binary apply it to the live box. These tests assert the behaviour AS MEASURED
// on the installed SDK; the ones marked "flips when fixed" fail on a release that guards the
// pointer path, which is the signal to invert them.
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

  it("pointer write: a ghost edge from the stale field, an update for the live address (flips when fixed)", () => {
    const { boxGraph, editing, stale, live, other, audioFile, updates } = staleAndLive();
    expect(live.file.isEmpty()).toBe(true);
    expect(audioFile.pointerHub.size()).toBe(1);
    editing.modify(() => stale.file.refer(audioFile));
    expect(targetOf(live)).toBe("none");
    expect(targetOf(stale)).toBe(short(audioFile.address));
    const incoming = boxGraph.edges().incomingEdgesOf(audioFile);
    expect(incoming).toHaveLength(2);
    expect(incoming[0]).toBe(other.file);
    expect(incoming[1]).toBe(stale.file);
    expect(incoming).not.toContain(live.file);
    expect(audioFile.pointerHub.size()).toBe(2);
    expect(updates.map((update) => update.type === "pointer" ? `pointer ${update.address.toString()}` : update.type))
      .toEqual([`pointer ${live.file.address.toString()}`]);
  });

  it("the ghost edge keeps the target valid past its last real user, and undo cannot remove it (flips when fixed)", () => {
    const { editing, stale, live, other, audioFile } = staleAndLive();
    // control: without the ghost, letting go of the last pointer is refused (the box needs an edge)
    expect(() => editing.modify(() => other.file.defer())).toThrow(/requires an edge/);
    expect(audioFile.pointerHub.size()).toBe(1);
    editing.modify(() => stale.file.refer(audioFile));
    // AudioFileBox is a mandatory-edge target: that this modify is accepted is the defect
    editing.modify(() => other.file.defer());
    expect(audioFile.isAttached()).toBe(true);
    expect(audioFile.pointerHub.size()).toBe(1);
    expect(editing.undo()).toBe(true);
    expect(editing.undo()).toBe(true);
    // the inverse of the recorded update goes to the live field (already empty); the stale edge stays
    expect(audioFile.pointerHub.size()).toBe(2);
    expect(targetOf(stale)).toBe(short(audioFile.address));
    expect(targetOf(live)).toBe("none");
    // only deleting the target clears it: delete() defers every pointer at it, the stale one included
    // (it is a non-mandatory pointer; a mandatory stale pointer would drag the stale box into the deletion)
    editing.modify(() => audioFile.delete());
    expect(audioFile.isAttached()).toBe(false);
  });

  it("with a target on the live field, the edge tables corrupt and the target can no longer be released (flips when fixed)", () => {
    const { boxGraph, editing, stale, live, other, audioFile } = staleAndLive();
    editing.modify(() => live.file.refer(audioFile));
    const second = transact(boxGraph, () => {
      const file = AudioFileBox.create(boxGraph, UUID.generate(), (file) => file.fileName.setValue("second"));
      other.file.refer(file);
      return file;
    });
    editing.modify(() => stale.file.refer(second));
    expect(targetOf(live)).toBe(short(audioFile.address));
    expect(second.pointerHub.size()).toBe(2);
    expect(boxGraph.edges().isConnected(live.file, audioFile.address)).toBe(true);
    // deleting the ghost's target defers the stale pointer: disconnect removes the LIVE field's
    // outgoing entry (same address key) and then fails to find the stale source in the list that
    // entry points at — the live field's target, audioFile
    expect(() => editing.modify(() => second.delete())).toThrow(/PointerField.*not found/);
    expect(targetOf(stale)).toBe("none"); // the stale field's own value was stored before the throw
    expect(targetOf(live)).toBe(short(audioFile.address));
    expect(boxGraph.edges().isConnected(live.file, audioFile.address)).toBe(false);
    expect(() => editing.modify(() => live.file.defer())).toThrow(/Could not remove/);
    // the release half-succeeds: the field reads empty, the target's incoming list still holds it
    expect(targetOf(live)).toBe("none");
    expect(audioFile.pointerHub.incoming()).toContain(live.file);
    expect(() => editing.modify(() => audioFile.delete())).toThrow(/has incoming edges/);
    // `second` is wedged the same way: the stale defer is a no-op now, its ghost stays
    expect(second.pointerHub.incoming()).toContain(stale.file);
    expect(() => editing.modify(() => second.delete())).toThrow(/has incoming edges/);
  });

  it("the SDK's sync mirror applies the stale write to the live box, so the graphs diverge (flips when fixed)", async () => {
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
      await expect(compare()).rejects.toBe("Checksum mismatch");
      expect(targetOf(live)).toBe("none");
      expect(mirrorFile()).toBe(short(audioFile.address));
      expect(same()).toBe(false);
    } finally {
      source.terminate();
      target.terminate();
      port1.close();
      port2.close();
    }
  });
});

describe("the WASM engine's mirror (apply_updates on the installed engine.wasm)", () => {
  it("applies the stale pointer write to the live box: the engine's checksum leaves the source's (flips when fixed)", async () => {
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
      expect(applied).toEqual([0, 0]); // the engine accepted the update for the live address
      expect(targetOf(live)).toBe("none");
      expect(engineChecksum()).not.toEqual(boxGraph.checksum());
    } finally {
      source.terminate();
      executor.terminate();
      loopback.terminate();
    }
  });
});
