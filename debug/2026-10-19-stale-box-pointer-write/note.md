# A pointer write through a box instance that undo replaced reaches the live graph

Verified against `@opendaw/studio-sdk` 0.0.175 (`lib-box` 0.0.97) in Node, 2026-10-19.
Repro and regression test: `src/lib/staleBoxPointerWrite.test.ts` (vitest, a real box graph, no
browser). No debug page: every effect is in the box graph, the SDK's own sync, and the engine
binary, all of which run in Node; the studio's restart on a checksum mismatch is the one thing
a page would add, and it is listed under "Inferred" below.

## Symptom

`Box.isAttached()` is instance identity: a box deleted and restored by undo comes back as a new
instance under the same uuid, and the old instance reports detached, so its scalar writes emit
nothing (upstream `f5811409a`, live error 1174). A POINTER write through the old instance is not
guarded the same way. Measured, each in its own test:

1. **A ghost edge.** `stale.file.refer(audioFile)` on a Nano sampler's `file` pointer leaves the
   live box's `file` empty, puts the stale field into the `AudioFileBox`'s incoming edges
   (`pointerHub.size()` 1 → 2, `incomingEdgesOf` lists the stale field), and emits one `pointer`
   update for the LIVE address into the transaction's update stream (undo history, sync, dispatch).
2. **The engine's copy diverges.** Two mirrors, both fed by the SDK's `SyncSource`: a second
   `BoxGraph` behind `createSyncTarget` over a `MessageChannel`, and the installed
   `engine.wasm` run in Node the way upstream's own checksum test runs it (`serializeUpdateTasks`
   → `input_reserve` / `apply_updates`, from the core-wasm dist). Both apply the update to the
   live box: `apply_updates` returns 0 (accepted), the TypeScript mirror's sampler points at the
   file, the main graph's does not, and the engine's 32-byte checksum (`checksum_ptr`) leaves the
   source's `checksum()` — the condition the studio's throttled compare rejects.
3. **The ghost outlives its real user and undo.** Control first: without the ghost, letting go of
   the last real pointer is refused (`other.file.defer()` throws `Target AudioFileBox … requires
   an edge`). After the stale write the same `defer()` is accepted and leaves the `AudioFileBox`
   attached with the ghost as its one incoming edge — a mandatory-edge box kept valid by a field
   that is in no box of the graph. Two undos restore `other.file`; the recorded update's inverse
   goes to the live field (empty throughout), the stale field keeps its target, the hub reads 2.
   Only `audioFile.delete()` clears it (`delete()` defers every pointer at the box, the stale one
   included — because Nano's `file` is a non-mandatory pointer; a mandatory stale pointer would
   drag the stale box into the deletion and `unstage` would fail on the identity check).
4. **With a target on the live field, the graph wedges.** `live.file → audioFile`, then
   `stale.file.refer(second)`: the write is accepted, `second`'s hub reads 2, but the outgoing
   table (keyed by address, which the two fields share) keeps only the live entry. Deleting
   `second` defers the stale pointer: `disconnect` removes the LIVE field's outgoing entry by that
   shared key, then throws `PointerField (file) … not found` looking for the stale source in the
   list that entry points at — the live field's target, `audioFile`. The stale field's own value
   was stored before the throw, so it reads empty from here. From there `live.file.defer()` throws
   `Could not remove …/15` (15 is the `file` field): the field reads empty afterwards but
   `audioFile`'s incoming list still holds it — the release half-succeeds — and
   `audioFile.delete()` throws `has incoming edges from: … (file) …/15`. `second` is wedged the
   same way: the stale defer is a no-op now, its ghost stays, and a repeated `second.delete()`
   throws `has incoming edges`. Neither file box can be released or deleted for the life of the
   graph.

## Repro

```
npx vitest run src/lib/staleBoxPointerWrite.test.ts
```

Six tests: the scalar control (passes on the guard) and five that assert the measured behaviour
and are marked "flips when fixed". Setup: `graphWithSamplers(2)` from
`src/lib/testing/boxGraphFixtures.ts`, an `AudioFileBox` held by the second sampler, the first
sampler deleted in `editing.modify` and restored with `editing.undo()`.

## Where the paths differ (read, then confirmed by the measurements above)

`packages/lib/box/src/graph.ts`: `onPrimitiveValueUpdate` runs only `if (field.isAttached() &&
!this.#constructingBox)`; `onPointerAddressUpdated` has no such condition — it disconnects and
connects edges, records a `PointerUpdate` and dispatches it whatever the field's box.
`packages/lib/box/src/graph-edges.ts` keys `#outgoing` by the source field's ADDRESS
(`removeByKey(source.address)`, `isConnected` by address) and holds the source FIELD OBJECT in
`#incoming`'s lists, so a stale field and the live field collide on the key and diverge on the
object: that is what makes case 4's `disconnect` remove the live entry and then fail to find the
stale one.

## Inferred, not observed

- **The restart.** The engine's checksum diverging is measured (case 2); that the studio's
  throttled compare then rejects ("box-graph checksum mismatch: the engine mirror diverged from
  the source graph", `processor.ts` `#verifyChecksum`) and the studio shows its "Audio-Engine
  Error / Restart Engine" dialog is read from the source, not run — the same checksum compare
  that live error 1174 logged as a warning before its crash.
- **Who writes.** Which studio code paths hold a box across an undo and write a
  pointer through it. The 1174 report named the recorders holding region, collection and event
boxes; whether any of them writes a POINTER on a held instance was not traced.

## Status

Issue draft: `drafts/TO-REVIEW-openDAW-stale-pointer-write.md`.
