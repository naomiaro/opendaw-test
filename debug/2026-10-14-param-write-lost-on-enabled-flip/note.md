# A parameter write in the same transaction as an effect's `enabled` flip never reaches the engine

Verified against `@opendaw/studio-sdk` 0.0.174 (WASM engine), Chrome, 2026-10-14.
Repro page: `param-write-enabled-flip-debug-demo.html` (unlisted; `src/demos/engine/param-write-enabled-flip-debug-demo.tsx`).

## Symptom

A device parameter field written inside an `editing.modify()` that also flips an effect's `enabled` field
(false→true or true→false) in the same audio unit keeps its new value in the box graph, but the engine
goes on rendering with the old value. A later write of the same value sends no update, so the engine stays
out of sync until the field changes to something else. The same write in a transaction of its own, or next
to writes that are not an `enabled` flip (mute fields on other units, an `enabled` write that does not
change the value), is applied.

## Repro

A Vaporisateur plays one quarter note (0.25–0.75 s) in a 4 s loop at 120 bpm; a StereoTool sits in its
effect chain, bypassed (`enabled` false). The synth's `release` sets how long the note rings after 0.75 s,
and the page reads that length off the engine output (RMS every 50 ms; the tail is the time from note-off
until the level stays under a tenth of the note's own level).

| step | transaction | tail measured |
|---|---|---|
| 1 | `release = 0.5` alone | 400 ms |
| 2 | `stereoTool.enabled false→true` **and** `release = 2.0`, ONE `editing.modify` | **400 ms** (box reads 2.0) |
| 3 | `stereoTool.enabled true→false`, then `release = 2.5` in a SECOND `editing.modify` | 2050 ms |
| 4 | `release = 0.5` alone | 400 ms |

Two runs on 0.0.174, identical figures. The page self-classifies: BUG PRESENT when step 2 reads like step 1
while step 3 reads long, FIXED when step 2 reads long.

The same loss was first seen with a Delay and with a WebCLAP (Basics reverb) device in the chain, in
either write order inside the transaction, and with a write of 0.5 while the engine held 4.0 (the engine
kept 4.0). It does not depend on the transport state: issued while playing, while paused, or right after a
`stop(true)`, the outcome is the same.

## What was not established

The mechanism. An `enabled` toggle re-wires the unit's effect chain in the engine; whether the parameter
update in the same batch is applied to a processor that is then replaced, or skipped during the re-wire, was
not read at runtime. The note stays with the symptom and the repro.

## Workaround

Write parameters and `enabled` flips in separate `editing.modify()` calls (`editing.append()` folds the
second into the same undo step).
