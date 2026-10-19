// SDK probe and regression test for debug/2026-10-19-stale-box-pointer-write/note.md.
//
// A box instance that undo replaced (same uuid, new instance) reports detached, and a SCALAR
// write through it reaches nothing. A POINTER write through it takes the graph path that has no
// attachment guard: the edge tables (keyed by address, which the stale and the live field share)
// gain an edge from the stale field, a pointer update for the LIVE address is emitted, and the
// SDK's own sync mirror applies it to the live box. These tests assert the behaviour AS MEASURED
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
  boxGraph.subscribeToAllUpdates({ onUpdate: (update) => updates.push(update) });
  return { boxGraph, editing, stale: box, live, other, audioFile, updates };
}

describe("a box instance replaced by undo", () => {
  it("scalar write: the live field and the update stream are untouched", () => {
    const { editing, stale, live, updates } = staleAndLive();
    const before = live.volume.getValue();
    editing.modify(() => stale.volume.setValue(before - 6));
    expect(live.volume.getValue()).toBe(before);
    expect(updates).toEqual([]);
  });

  it("pointer write: a ghost edge from the stale field, an update for the live address (flips when fixed)", () => {
    const { boxGraph, editing, stale, live, other, audioFile, updates } = staleAndLive();
    expect(live.file.isEmpty()).toBe(true);
    editing.modify(() => stale.file.refer(audioFile));
    expect(targetOf(live)).toBe("none");
    expect(targetOf(stale)).toBe(short(audioFile.address));
    expect(boxGraph.edges().incomingEdgesOf(audioFile)).toEqual([other.file, stale.file]);
    expect(audioFile.pointerHub.size()).toBe(2);
    expect(updates.map((update) => update.type === "pointer" ? `pointer ${update.address.toString()}` : update.type))
      .toEqual([`pointer ${live.file.address.toString()}`]);
  });

  it("the ghost edge keeps the target valid past its last real user, and undo cannot remove it (flips when fixed)", () => {
    const { editing, stale, live, other, audioFile } = staleAndLive();
    editing.modify(() => stale.file.refer(audioFile));
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
    // outgoing entry (same address key) and then fails to find the stale source on the target
    expect(() => editing.modify(() => second.delete())).toThrow(/not found/);
    expect(targetOf(live)).toBe(short(audioFile.address));
    expect(boxGraph.edges().isConnected(live.file, audioFile.address)).toBe(false);
    expect(() => editing.modify(() => live.file.defer())).toThrow(/Could not remove/);
    expect(() => editing.modify(() => audioFile.delete())).toThrow(/has incoming edges/);
  });

  it("the SDK's sync mirror applies the stale write to the live box, so the graphs diverge (flips when fixed)", async () => {
    const { editing, stale, live, boxGraph, audioFile } = staleAndLive();
    const mirror = new BoxGraph<BoxIO.TypeMap>(Option.wrap(BoxIO.create));
    const { port1, port2 } = new MessageChannel();
    createSyncTarget(mirror, Messenger.for(port2 as never));
    const source = new SyncSource(boxGraph, Messenger.for(port1 as never), true);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    const same = () => Arrays.equals(boxGraph.checksum(), mirror.checksum());
    const mirrorFile = () => targetOf(mirror.findBox<NanoDeviceBox>(live.address.uuid).unwrap("mirror box"));
    try {
      await settle();
      expect(same()).toBe(true);
      expect(mirrorFile()).toBe("none");
      editing.modify(() => stale.file.refer(audioFile));
      await settle();
      expect(targetOf(live)).toBe("none");
      expect(mirrorFile()).toBe(short(audioFile.address));
      expect(same()).toBe(false);
    } finally {
      source.terminate();
      port1.close();
      port2.close();
    }
  });
});
