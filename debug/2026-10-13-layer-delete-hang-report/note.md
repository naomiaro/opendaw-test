# "Deleting a layer hangs openDAW and loses work" — a Discord report, not reproduced

**Started:** 2026-10-13
**Status:** not reproduced; one minor undo finding; questions for the reporter drafted
**Verified against:** installed `@opendaw/studio-sdk` 0.0.174 (this repo); the openDAW
checkout at `92a9df6a6` (the 2026-10-09 publish of app-studio 0.2.6) for the Node tests;
the deployed studio build `090790ec` of 2026-10-12T18:47:42Z (`/build-info.json`) for
the browser runs. Chrome on macOS.
**Repro page:** [`layer-delete-soak-debug-demo.html`](../../layer-delete-soak-debug-demo.html)
(unlisted; source `src/demos/instruments/layer-delete-soak-debug-demo.tsx`)

## The report

A Discord user says that deleting a "layer" makes openDAW hang or crash, after which their
work is lost. There are no steps, no console content and no project. The maintainer's reply
asks what a layer is to the reporter: a device chain, or in openDAW's terms an audio unit.
As of the morning of 2026-10-13 the thread is still open.

In openDAW itself "layer" is a defined thing: one cell of an Instrument Composite
(`InstrumentCompositeCellBox`, label "Layer n", `src/ui/devices/InstrumentCompositeLayer.tsx`
in the studio). A layer hosts one instrument plus its own midi and audio effect chains.
There are two ways to delete one in the studio:

- the ⊗ icon at the right of a layer row in the Composite's editor
  (`InstrumentCompositeLayer.tsx`): `editing.modify(() => api.deleteCompositeLayer(layer.box))`,
  nothing else;
- "Delete layer" in the context menu of the layer's instrument
  (`menu-items.ts`, `forAudioUnitInput`): the editing pointer is moved to the parent
  (`backTargetOfCell`) and the layer deleted in the same transaction.

Deleting a layer from inside it used to throw (openDAW#389, "DEV / instrument compose /
Deleting layer causes exception", closed 2026-09-20 by `8dba46f97`: the cell head rebuilt its
numbers by asking the deleted layer for its siblings through a pointer the delete had just
cleared; `subscribeSiblings` now resolves the composite once, and `NestedHostExit` moves the
editing pointer off a host deleted from under the user). The reporter of #389 confirmed the
fix. The deployed build carries it.

## What was tried

Everything below ran clean: no throw, no hang, no console error. Where an engine was
involved (the second and third runs, and the page) the engine checksum stayed in step
with the source graph, the transport kept advancing and the output kept sounding; the
first run is the box graph alone.

**Box graph alone, Node, openDAW checkout at the 2026-10-09 publish** (temporary vitest files
in `packages/studio/core`, deleted afterwards): `deleteCompositeLayer` on a layer with a Delay
and a Pitch effect, with the editing pointer on it, five rounds of delete, undo, redo, undo;
a layer whose synth volume and whose cell gain are automated by value lanes with regions (the
lanes go with the layer, come back with undo); a layer whose synth volume and cell gain are
modulated; a nested Composite layer, inner deleted from inside, outer deleted from inside,
all three layers deleted one by one, three undos; a duplicated layer, original and copy
deleted; an empty cell deleted; a deletion with live sibling, effect-chain and cell-collection
subscriptions (finite, well-ordered notifications). The upstream file
`InstrumentCompositeAdapters.test.ts` (17 tests, including the three #389 regression tests)
passes.

**Real WASM engine, Node** (`packages/studio/core-wasm/test`, the installed 0.0.174
`engine.wasm` and plugins symlinked over the checkout's stale `dist/wasm`): a flat Composite
with two Vaporisateur layers (one with Delay and Pitch), a note region, the layers deleted one
after the other while the engine renders, then a layer added again; the same with the first
layer's gain automated by a value region; a nested Composite with the outer layer deleted
first. Every deletion settled through the sync channel with a matching checksum and the
render stayed finite.

**Deployed studio, Chrome, build 2026-10-12T18:47Z** (a new project; a Composite with a
Vaporisateur and a Cubed layer; a note region with three notes; the transport playing at
120 BPM in a loop):

| Action | Result |
|---|---|
| Enter layer 1, "Delete layer" from its menu (stopped) | layer gone, no error |
| ⌘Z | layer back |
| ⊗ on layer 1's row (stopped) | layer gone, no error |
| ⌘Z | layer back |
| Enter layer 1, "Delete layer" while playing | layer gone, transport keeps running, no error |
| Add a second unit (Vaporisateur) with a Compressor side-chained from the Composite unit; "Delete 'Composite'" from the track header while playing | unit gone, side-chain pointer cleared, transport keeps running |
| ⌘Z while playing | unit back, side-chain restored, sound back |
| Enter the last layer, "Delete layer", ⌘Z, ⇧⌘Z, ⌘Z | layer back after the last undo |

The Compressor's side-chain picker also offers a layer's own output ("Composite ▸ Cubed ▸")
as a source; that submenu did not open under the automation and the layer-as-source case is
untested in the studio. The page below covers the unit-as-source case.

**This repo's page, installed SDK 0.0.174, WASM engine, Chrome**: see the next section.

## The repro page

`layer-delete-soak-debug-demo.html` builds, through the SDK, what a user who layers sounds
would have: a Composite with two Vaporisateur layers (the first with a Delay and a Pitch
effect) and a nested Composite as a third layer with its own Vaporisateur; a note region
looping four quarter notes; a value lane with a region automating the first layer's gain;
a modulator on the first layer's synth volume; a second Vaporisateur unit whose Compressor
side-chains from the Composite unit. The transport plays throughout. Each step is raced
against a hang ceiling (30 s for the build, 20 s for the soak, 10 s otherwise) and the
verdict names the last stage reached: OK; FAILED when one of the page's own checks
fails; THREW when the SDK threw; HUNG when the ceiling was overrun or the engine position
stopped advancing. A synchronous main-thread loop would freeze the tab instead, so every
stage is also logged to the console on entry.

What is checked where: after each layer delete, that the deleted box is gone from the
graph and the layer count dropped, `verifyPointers`, that the engine position still
advances, and that the output still sounds (peak RMS over 0.8 s through an
`AnalyserNode` on the engine worklet's output 0); after each undo, that the box is back,
`verifyPointers` and the position check, and every `undo()` / `redo()` return value
(`false` means the SDK rolled the step back). After the unit delete the output is
expected to go silent (the second unit has no notes), so there the checks are the unit
gone, the side-chain pointer cleared, pointers and position, with the sound check after
the undo. The soak asserts the delete and the restore by uuid every cycle and runs the
pointer, position and sound checks every sixth cycle. One run per page load.

Run of 2026-10-13 (fresh load, a real click on Run):

| Step | Outcome | Detail |
|---|---|---|
| Build and play | OK | 3 layers, output peak rms 0.459 |
| Row-icon delete of the edited layer, undo | OK | deleted in 3.8 ms; 37 pointers fine, engine advancing; rms 0.371; **undos to restore: 2** |
| Menu delete, undo, redo, undo | OK | 48 pointers fine; undos after redo: 1 |
| Delete the nested layer from inside it, undo | OK | 48 pointers fine; undos to restore: 2 |
| Delete the side-chain source unit while playing, undo | OK | deleted in 4.5 ms, side-chain pointer cleared; unit back, rms 0.46 after undo |
| Soak, 24 random delete/undo cycles | OK | max `modify` 1.8 ms, max undos 2, engine advancing, pointers fine |

The pointer count is taken where the check runs: with the layer deleted in step 2 (37),
with it restored in steps 3 and 4 (48). That run predates the review fixes (the per-step
sound and uuid assertions, FAILED/HUNG classes); the re-run after them is below.

Re-run of 2026-10-13 after the review fixes (fresh load, window visible, a real click):

| Step | Outcome | Detail |
|---|---|---|
| Build and play | OK | 3 layers, output peak rms 0.481 |
| Row-icon delete of the edited layer, undo | OK | box gone; 37 pointers fine, engine advancing; rms 0.408 after delete; **undos to restore: 2** |
| Menu delete, undo, redo, undo | OK | box gone; 37 pointers fine; rms 0.396 after delete; box back, 48 pointers fine; undos after redo: 1 |
| Delete the nested layer from inside it, undo | OK | outer and inner gone; 44 pointers fine; rms 0.362 after delete; both back, 48 pointers fine; undos to restore: 2 |
| Delete the side-chain source unit while playing, undo | OK | unit gone, side-chain cleared; 48 pointers fine; unit back, side-chain restored; rms 0.444 after undo |
| Soak, 24 random delete/undo cycles | OK | every delete and restore confirmed by uuid; max `modify` 1.8 ms; max undos 2; last rms 0.486 |

Two runs on this page stalled at "wait for position" after the build: `engine.play()`
was issued but the main thread saw `position` stay at 0 and `isPlaying` false. The page
now logs the context state and `document.visibilityState` while it waits, and both
stalls read `visibility hidden`: the Chrome window holding the tab was occluded, which
suspends `requestAnimationFrame` and with it the main thread's view of the engine (the
engine itself keeps running; see the browser-verification notes in CLAUDE.md). The page
names that case in its HUNG message. With the window visible the transport advanced
within a second every time.

## One finding: the row path needs two undos when the deleted layer was being edited

Not a hang and not a loss of work, but reproducible through the SDK and visible on the
page (steps 2 and 4). The states below are measured; the mechanism is inferred from the
cited source and is consistent with them, it was not observed step by step at runtime.

- `UserEditing.edit()` writes the editing pointer through `editing.modify(…, false)`
  (`packages/studio/adapters/src/editing/UserEditing.ts`): the move stays in
  `BoxEditing`'s unmarked pending list, meant to fold into the next marked edit.
- `deleteCompositeLayer` alone (the row icon) deletes the cell, which defers the editing
  pointer that targeted it. After the transaction `NestedHostExit`
  (`packages/studio/core/src/project/NestedHostExit.ts`) moves the pointer to the nearest
  surviving parent in a microtask, through `edit()`, so the move is pending.
- `BoxEditing.undo()` first seals whatever is pending as its own history entry
  (`if (this.#pending.length > 0) {this.mark()}`, `packages/lib/box/src/editing.ts`) and
  undoes that: the first ⌘Z only empties the editing pointer (the device panel goes
  blank), the second brings the layer back.

Measured in Node against the 2026-10-09 publish (`state` = layers, pointer target,
`verifyPointers`): after the delete `layers=1 pointer=<parent> resolved=true`; after one
undo `layers=1 pointer=none resolved=false verify=ok`; after a second `layers=2
pointer=<layer>`. Nothing dangles: the pointer is empty, not broken, and saving or editing
from that state works.

In the studio the row icon is shown in the editor of a Composite in the edited host's
chain (the unit's chain, or the outer layer's for a nested Composite), so it deletes a
child of the edited host, never the host being edited; the menu path moves the pointer
inside the transaction and undoes in one step (studio run and page step 3). The two-undo
state is reached when the edited layer is deleted by something other than the user's own
click: a redo of a row-path delete (measured in the Node probe: delete, undo, undo, redo,
redo, then one undo left the layer deleted with the pointer empty), or a script. A
live-room participant's delete would be another candidate and is untested. Low priority;
not filed.

## Questions for the reporter

Drafted in `drafts/TO-REVIEW-discord-reply.md`. What the thread needs before anything can
be reproduced: what "layer" means to them (a Composite layer, a track, a Playfield pad,
an effect), the exact gesture (icon, menu, Delete key), whether the transport was
running, whether the project was in a live room, the browser console content (a
`[BoxEditing]` warning, a "checksum" message, an engine restart dialog), and whether the
error dialog with the "Recover" button appeared. The studio's error reporting
(`logs.opendaw.studio`, `docs/error-triage.md` upstream) may already hold the stack if a
dialog was shown.

## Files

- `layer-delete-soak-debug-demo.html`, `src/demos/instruments/layer-delete-soak-debug-demo.tsx`
- `drafts/TO-REVIEW-discord-reply.md`
