# TO-REVIEW — openDAW issue draft (not posted)

Target: https://github.com/andremichelle/openDAW/issues (new issue)
Status: drafted 2026-10-19 from the Node repro in `src/lib/staleBoxPointerWrite.test.ts`; nothing posted.

---

**Title:** A pointer write through a box instance that undo replaced reaches the live graph: ghost edge, diverged engine mirror, and a target that can no longer be released

**Body:**

Since `f5811409a` (live 1174) `Box.isAttached()` is instance identity, so a box instance kept across an undo reports detached and its scalar writes emit nothing. A pointer write through such an instance still goes through. Measured on `@opendaw/studio-sdk` 0.0.175 (`lib-box` 0.0.97) in Node with a real box graph; the test file is linked below.

**Setup.** Two Nano samplers, an `AudioFileBox` held by the second one's `file` pointer. Delete the first sampler in `editing.modify`, `editing.undo()`: the graph holds a new instance under the same uuid (`live`), the old one (`stale`) reports `isAttached() === false`.

**1. Ghost edge.** `editing.modify(() => stale.file.refer(audioFile))` leaves `live.file` empty, puts `stale.file` into `audioFile.pointerHub.incoming()` (size 1 → 2) and emits one `pointer` update for `live.file`'s address.

**2. The engine's copy diverges.** A second `BoxGraph` fed through `SyncSource` → `createSyncTarget` over a `MessageChannel` applies that update: the mirror's sampler points at the file, the source graph's does not, `checksum()` differs. In the studio that is the checksum mismatch that restarts the engine.

**3. The ghost outlives its real user and undo.** `other.file.defer()` afterwards leaves `audioFile` attached with the ghost as its only incoming edge. Two undos restore `other.file`, but the recorded update's inverse targets the live field (already empty); the stale field keeps its target and the hub still reads 2. `audioFile.delete()` clears it, since `delete()` defers every pointer at the box.

**4. With a target on the live field, the graph wedges.** `live.file → audioFile`, then `stale.file.refer(second)`: accepted, `second.pointerHub.size()` is 2, `isConnected(live.file, audioFile.address)` is still true. `editing.modify(() => second.delete())` throws `{NanoDeviceBox:PointerField (file) <uuid>/15 not found in …`. Afterwards `isConnected(live.file, audioFile.address)` is false while `live.file.targetAddress` still names it, `live.file.defer()` throws `Could not remove <uuid>/15`, and `audioFile.delete()` throws `AudioFileBox <uuid> has incoming edges from: {NanoDeviceBox:PointerField (file) <uuid>/15`. The file box can neither be released nor deleted for the life of the graph.

**Where the paths differ.** `BoxGraph.onPrimitiveValueUpdate` runs only when `field.isAttached()`; `BoxGraph.onPointerAddressUpdated` has no such condition and disconnects, connects, records and dispatches for any field. `GraphEdges` keys `#outgoing` by the source field's address but stores the source field object in `#incoming`, so a stale field and the live field share a key and differ as objects — which is why case 4's `disconnect` removes the live entry and then fails to find the stale one.

**Repro.** https://github.com/naomiaro/opendaw-test/blob/main/src/lib/staleBoxPointerWrite.test.ts (`npx vitest run src/lib/staleBoxPointerWrite.test.ts`; five tests, the four marked "flips when fixed" assert the behaviour above). Write-up: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-19-stale-box-pointer-write/note.md
