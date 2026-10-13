# Draft: reply in the Discord thread (for the reporter and André)

Status: TO REVIEW, nothing posted. Target: the Discord thread where a user reports that
deleting a layer hangs or crashes openDAW and loses their work.

---

I tried to reproduce this today and could not make it hang. What I covered:

- In the current deployment (build of 2026-10-12, 18:47 UTC), by hand: a Composite with
  two layers, "Delete layer" from the layer's menu and the ⊗ on the layer row, from inside
  the layer, stopped and while playing, undo and redo after each; "Delete 'Composite'"
  from the track header while another unit's Compressor side-chains from it, then undo
  while playing.
- Through the SDK with the WASM engine running (page `layer-delete-soak-debug-demo.html`
  in the opendaw-test repo): the same two layer gestures on a Composite with effects, a
  value lane and a modulator on the layer and a nested Composite layer deleted from inside
  it, the unit delete, and a soak of 24 random delete/undo cycles, with the deleted box,
  pointer integrity, engine position and output level checked after each delete.

Everything stayed clean, so the hang needs more detail to be found. Could you share:

1. What you deleted: a layer of a Composite instrument, a track (audio unit), a Playfield
   pad, or an effect? And how: the ⊗ icon, a context menu item, or the Delete key?
2. Was the transport playing, and was the project open in a live room?
3. The browser console content right after it froze (Chrome: ⌥⌘J), in particular any
   line with `[BoxEditing]`, `checksum`, `panic` or an engine restart.
4. Did an error dialog appear (the one with "Report" and "Recover")? If so, the report id
   is in the studio's error log and André can pull the stack from there.
5. If the project still opens: does the hang come back with the same steps on it?

One small thing I did find, not a hang: if the layer you are editing is deleted by a redo
(or by a script), it takes two ⌘Z to bring it back; the first only empties the device
panel. That is in the SDK's editing-pointer handling and I have it written up if it is of
interest.
