# Draft: reply in the Discord thread (for the reporter and André)

Status: TO REVIEW, nothing posted. Target: the Discord thread where a user reports that
deleting a layer hangs or crashes openDAW and loses their work.

---

I tried to reproduce this today against the current deployment (build of 2026-10-12, 18:47
UTC) and could not make it hang. What I covered, with the transport playing where it
mattered:

- Composite layers: "Delete layer" from the layer's menu, the ⊗ on the layer row, deleting
  from inside the layer, deleting a nested Composite layer, undo and redo after each, with
  effects, automation lanes and a modulator on the layer.
- The whole audio unit: "Delete 'Composite'" from the track header while another unit's
  Compressor side-chains from it, then undo while playing.
- A scripted soak of 24 random delete/undo cycles through the SDK with the WASM engine
  running (page: `layer-delete-soak-debug-demo.html` in the opendaw-test repo), checking
  pointer integrity, the engine position and the output level after every step.

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
or by another participant, it takes two ⌘Z to bring it back (the first only empties the
device panel). That is in the SDK's editing-pointer handling and I have the mechanism
written up if it is of interest.
