# A parameter write in the same transaction as an effect's `enabled` flip never reaches the engine

Filed as [openDAW#459](https://github.com/andremichelle/openDAW/issues/459) on 2026-10-14.
Verified against `@opendaw/studio-sdk` 0.0.174 (WASM engine), Chrome 155 (`navigator.userAgent`), macOS, 2026-10-14.

**Update (2026-10-19): fixed in SDK 0.0.175.** Upstream `0d0b318b9` (closed the issue on
2026-10-15): `crates/engine/src/audio_unit/mod.rs` refreshes a unit's parameters after a chain
reconcile too, not only after a plain field edit, so a write that shares a transaction with an
`enabled` flip (or an effect added, removed or reordered) reaches the surviving device; the
engine test `a_parameter_write_in_the_same_transaction_as_an_enabled_toggle_reaches_the_device`
pins both directions. Re-run on the release, one real click: **FIXED** — step 2 tail 2100 ms,
step 3 tail 400 ms, the controls 400 / 2050 / 2500 / 500 / 1700 ms, every step ok. The page is
the regression test from here on. Changelog: `changelogs/sdk-0.0.174-to-0.0.175-changes.md`.
Repro page: `param-write-enabled-flip-debug-demo.html` (unlisted; `src/demos/engine/param-write-enabled-flip-debug-demo.tsx`).

## Symptom

A device parameter field written inside an `editing.modify()` that also flips an effect's `enabled` field
in the same audio unit (false→true or true→false) keeps its new value in the box graph, but the engine goes
on rendering with the old value. Writing the same value again later changes nothing: lib-box's
`PrimitiveField.setValue` returns before any update when the value is unchanged
(`node_modules/@opendaw/lib-box/dist/primitive.js`, the `equals` guard), so the engine stays out of sync
until the field changes to a third value. The same write in a transaction of its own is applied, with the
effect enabled or bypassed.

## Repro (what the page measures)

A Vaporisateur plays one quarter note (0.25–0.75 s) in a 4 s loop at 120 bpm; a StereoTool sits in its
effect chain, bypassed (`enabled` false). The synth's `release` sets how long the note rings after note-off,
and the page reads that off the engine output: RMS every 50 ms, the onset is the first sample above a tenth
of the capture's peak, note-off is 0.5 s later, the tail is the time from note-off until the level stays
under a tenth of the note's own level. The tail lands at roughly 0.8 × the release value (the −20 dB point
of the envelope), so the steps are judged short (under 1 s) or long (over 1.2 s). Every capture starts
with `stop(true)`, a wait for silence and `play()` from 0; the transport is stopped when each write commits.

| step | transaction | tail measured | reads as |
|---|---|---|---|
| 1 | `release = 0.5` alone (StereoTool off) | 400 ms | control |
| 2 | StereoTool `enabled false→true` **and** `release = 2.5`, ONE `editing.modify` | **400 ms** (box reads 2.5) | write lost |
| 2b | `release = 2.5` alone (the value the box already holds; StereoTool on) | 400 ms | nothing sent, engine still at 0.5 |
| 2c | `release = 3.0` alone (StereoTool on) | 2500 ms | the enabled chain takes a write |
| 3 | StereoTool `enabled true→false` **and** `release = 0.5`, ONE `editing.modify` | **2500 ms** (box reads 0.5) | write lost, engine still at 3.0 |
| 4 | `release = 0.6` alone (StereoTool off) | 500 ms | control |
| 5 | StereoTool `enabled false→true`, THEN `release = 2.0`, SEPARATE `editing.modify` calls | 1650 ms | separate transactions work |

Two runs on 0.0.174 with the same figures within one 50 ms bin (two runs of an earlier four-step version read the same for
steps 1, 2 and the separate-transaction control). The page self-classifies: once the controls (1, 2c, 4, 5)
read as expected and steps 2 and 3 carry a note at step 1's level, BUG PRESENT when step 2 is short and
step 3 long, FIXED when step 2 is long (inside the capture) and step 3 short, INCONCLUSIVE otherwise; HUNG
names the stage whose deadline passed; THREW carries the error, also when the output does not fall silent
before a step, the AudioContext is not running, or the sampling clock drifted (a throttled tab).

### Seen by hand, not recorded by the page

On another build of the same engine generation, earlier the same day, the loss also occurred with a stock
Delay and with a WebCLAP device (Signalsmith Basics reverb) as the toggled effect, with the two writes in
either order inside the transaction, and whether the transaction committed while the transport was
playing, paused or right after `stop(true)`. Those runs were ad hoc (console pokes); the page records only
the StereoTool with the transport stopped.

## What was not established

The mechanism. A disabled effect is skipped in the unit's chain wiring (upstream
`crates/engine/src/audio_unit/mod.rs`, the `DEVICE_ENABLED_KEY` comment: "a disabled audio / midi effect is
bypassed — skipped in the chain wiring"), so an `enabled` toggle re-wires the chain; whether the parameter
update in the same batch is applied to a processor that is then replaced, or skipped during the re-wire,
was not read at runtime. The note stays with the symptom and the repro.

## Workaround

Write parameters and `enabled` flips in separate `editing.modify()` calls (the page's step 5 uses two
`modify` calls; `editing.append()`, which folds the second into the same undo step, was not run).
