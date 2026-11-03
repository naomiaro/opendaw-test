# MIDI effects demos — design

Two listed demo pages under `src/demos/midi/`, one for the four stock MIDI effect devices and one
for Spielwerk, the scriptable MIDI effect. Both play a looping note pattern on a Vaporisateur synth
and let the visitor hear and see what the unit's MIDI chain does to the notes before they reach
the instrument.

## Why

The repo documents the five MIDI effects (chapter 16, `documentation/16-midi.md`) and measures
their timing (the unlisted placement audit, every row `as-predicted` from SDK 0.0.176 through
0.0.180, register `debug/2026-10-21-midi-effect-placement/note.md`), but no listed page lets a
visitor hear one. The effects demo covers audio effects only; the scriptable demos cover Werkstatt
(audio) and Apparat (instrument) and leave Spielwerk out. These two pages close that gap and are a
showcase of the general range of what a MIDI chain can do.

## Goals

- A visitor flips one stock device on at a time and hears, and sees, the difference against dry.
- The same visitor then stacks several devices, drags them into an order, and hears that order
  matter.
- A second page shows Spielwerk as the "anything else" device: pre-built scripts to browse, an
  editor that compiles as you type, declared parameters as knobs, and an API reference.
- Both pages follow the console design language (`docs/design/2026-06-11-mastering-console-editorial.md`)
  and the "Adding a New Demo" checklist in CLAUDE.md.

## Non-goals

- No MIDI hardware input on either page (the MIDI recording demo covers that). A later addition
  could route a MIDI device through the chain; the design does not preclude it.
- No audio effects on the unit; the chain under study is the MIDI chain only.
- No persistence of patterns, settings or scripts across loads.
- No new SDK measurement; the placement audit stays the authority on timing.

## Anti-goals

- A page that sounds different from what it shows. The "as emitted" lane must read from the engine,
  never be computed on the main thread from the device's rule; if it cannot be read, it is left out
  (see below), not faked.
- A chain whose order on screen and in the box graph disagree after a drag.
- A device that stays on the chain after its tab is left, so two devices sound while the page says
  one.

## Decisions made in conversation

- Two separate pages, not one: the stock devices on one, Spielwerk on the other.
- The stock page has two areas: one device at a time first (to hear the differences), then a
  stacking area at the bottom with drag-and-drop reordering.
- A set of patterns to switch between, because the devices want different material.
- Vaporisateur as the instrument on both pages.
- The "as emitted" lane is a goal, not a requirement: built if the engine's note broadcast serves
  it (recon says it does; see "Reading the emitted notes"), otherwise dropped for this PR.

## Page 1: MIDI Effects (stock devices)

Files: `midi-effects-demo.html` at the repo root, `src/demos/midi/midi-effects-demo.tsx`, card in
the "Recording & MIDI" group of `src/index.tsx`.

### Layout, top to bottom

1. **Transport bar.** Play/Stop, bpm readout (fixed at 120; the patterns are written for it), the
   pattern picker. Transport loops over the pattern's two bars (`timelineBox.loopArea` enabled,
   from bar 0 to bar 2).
2. **Two piano-roll lanes.** "As written": the pattern's notes from the box graph (a static canvas
   repainted on pattern change). "As emitted": what the chain delivers to the instrument, read
   live from the engine (below). One playhead overlay runs across both lanes, driven from an
   `AnimationFrame` loop that writes `style.left` directly (per the overlay rule in CLAUDE.md).
   Same pitch range on both lanes so a Pitch shift reads as a vertical move. Lane height around
   96 px each; pitch range fixed to the union of all patterns' pitches plus the widest Pitch and
   Arpeggio settings (C2 to C7, clipped and marked when a note falls outside).
3. **One at a time.** Five tabs: Dry, Arpeggio, Pitch, Velocity, Zeitgeist (a segmented control,
   as the Werkstatt demo's source picker). Picking a tab deletes whatever single device is on the
   chain and inserts the new one in one transaction, then re-seeks the transport to the loop
   start if it is playing (the engine drops sounding voices on a chain change; restarting the
   pattern keeps the lanes and the sound in step); Dry leaves the chain empty. Under the tabs,
   the device's card: an enabled toggle, its parameters, two lines of prose (what it does, what to
   listen for), and a collapsible code snippet showing the insert and the parameter writes.
4. **Stack them.** A horizontal row of chips, one per device on the chain, drag handles for
   reordering, a "+ add" menu listing the devices not yet in the stack (each device at most once).
   Clicking a chip expands its parameters in place (the same parameter controls as its card). A
   "Clear stack" button. The stack and the single-device area are the same chain: the page holds
   one chain mode at a time. Adding the first chip switches the page to stack mode (the tabs grey
   out, their device is carried into the stack as the first chip); clearing the stack returns to
   the tabs with Dry selected. This avoids two devices sounding while the tabs claim one.

### Patterns

Four patterns, each two bars at 120 bpm, pitch and velocity per note, written through
`project.api.createNoteRegion` (or the chapter 16 helper) into one note region on the unit's
track. The pattern picker replaces the region's events in a follow-up `editing.append()` per the
transaction-staleness rule in CLAUDE.md.

| id | what | serves |
|---|---|---|
| `chords` | Four held chords, one per half bar (Am, F, C, G as triads around C4), each held its full half bar | Arpeggio (the stack it walks), Zeitgeist (the chord starts are on the cell grid so nothing moves until the off-beat pattern is picked) |
| `sixteenths` | Straight sixteenths on one pitch (C4), two bars, each held a thirty-second, alternating velocities 1.0 / 0.6 | Zeitgeist (off-beat sixteenths move), Velocity (magnet flattens the alternation) |
| `melody` | A one-bar phrase repeated, eight eighth notes, mixed pitches across an octave, velocities ramping 0.4 to 1.0 | Pitch (the transposition is obvious on a tune), Velocity (random and offset audible on a ramp) |
| `bass` | Four quarter-note roots, C2 region, velocity 0.9 | Pitch octaves, Arpeggio with 3+ octaves |

The default pattern is `chords` and the default tab is Dry.

### Devices and parameters

All five devices (the four here plus Spielwerk on page 2) are inserted with
`project.api.insertEffect(midiEffectsFieldOf(project, audioUnitBox), EffectFactories.X)` and
removed with `box.delete()`, both inside `editing.modify()`. Parameter writes go through the
device adapter's `namedParameter` where one exists (it carries the SDK's value and string
mappings, so the UI shows "1/16" and "UpDown" instead of indices), falling back to the box field
otherwise. The controls are the repo's themed Radix sliders and selects bound through
`src/lib/parameterBinding.ts` where it fits.

| device | controls | notes |
|---|---|---|
| Arpeggio | mode (Up / Down / UpDown), rate (the adapter's `RateStringMapping`, default 1/16), octaves 1–5, gate 0–2, repeat 1–16, velocity −1..1 | The arpeggiator free-runs when stopped on held live keys; irrelevant here (no live keys) |
| Pitch | semitones −36..36, cents −50..50, octaves −7..7 | Defaults 0 / 0 / 0 (an identity on insert) |
| Velocity | magnet position 0–1, magnet strength 0–1, random amount 0–1, offset −1..1, mix 0–1; a "reseed" button on `randomSeed` | Factory values are an identity |
| Zeitgeist | amount 0–1, duration (the groove's duration list, default 1/8 = 480) | Written through `ZeitgeistDeviceBoxAdapter.groove()`; the device's own groove box, not the project groove |

Each device's enabled toggle writes its `enabled` field. A disabled device stays in the chain and
in the stack row, drawn dimmed.

### Reordering the stack

The chain is `audioUnitAdapter.midiEffects` (an `IndexedBoxAdapterCollection`). A drop writes the
new order with `IndexedBox.moveIndices(field, startIndices, targetIndex)` inside `editing.modify()`,
the way the studio's device panel does (`DevicePanelDragAndDrop.ts`, a plain reorder within one
chain). The chip row renders from the collection's `catchupAndSubscribe({onAdd, onRemove,
onReorder})`, never from page-held order, so a drag that did not land shows nothing. Drag and
drop uses `@dnd-kit/core` + `@dnd-kit/sortable` (new dependencies; regenerate the lockfile
cleanly per CLAUDE.md), the horizontal sortable strategy, with its pointer and keyboard sensors
so touch and keyboard (space to lift, arrows to move, space to drop) come with it. `onDragEnd`
writes the box graph; the row re-renders from the collection.

### Reading the emitted notes

The engine broadcasts a 128-bit held-note set per audio unit at the unit's address, marked by the
instrument when it resolves a note on and off, which is after the MIDI chain
(`crates/engine/src/audio_unit/mod.rs`, `note_bits`; `crates/engine/src/lib.rs`, `PullContext.note_bits`).
`NoteStreamReceiver` from `@opendaw/studio-adapters`, constructed on `project.liveStreamReceiver`
and bound to the unit's address, exposes it on the main thread per frame (`isNoteOn(pitch)`,
`subscribe`). The studio's note editor reads it the same way.

The "as emitted" lane samples the set every animation frame: a pitch that turns on opens a bar at
the current transport position, a pitch that turns off closes it. Bars are drawn on a canvas and
cleared on loop wrap. The set is the unit's, so it reads the sum of the chain, which is what the
lane claims.

What a frame-sampled held-note set can and cannot show, stated in the lane's caption:

- **Arpeggio** steps (125 ms apart at 1/16, 120 bpm) and **Pitch** transposition (a vertical
  move) show clearly. These are the two devices the lane is for.
- **Velocity** does not show at all: the set carries no loudness. The emitted lane draws every
  bar at one shade; the written lane shades by velocity. The Velocity card says "heard, not seen".
- **Zeitgeist**'s shift at amount 0.6 is about 24 ms, one and a half frame intervals, so the lane
  shows it only roughly and with frame jitter. The Zeitgeist card says so and points at the
  placement audit's register for the measured figure.
- A note shorter than one frame interval (about 16 ms at 60 Hz) can be missed or drawn one frame
  long; the shortest note here is a thirty-second at 120 bpm (62 ms) unless an Arpeggio gate is
  near 0. Repeated hits on one pitch inside a frame merge into one bar.

A second source that would show velocity and fine timing (an offline render of the two bars
through the chain with detected onsets, as the placement audit does, or the per-device note set
the engine also broadcasts at each MIDI effect's address) is NOT in this design; it is an open
question for the user (see the end of this document).

If `NoteStreamReceiver` turns out not to update on this page (hidden-page rules apply: the
`LiveStream` is pumped per frame), the lane is dropped from this PR and noted in the PR body.

### Audio

The unit is one Vaporisateur created with `project.api.createInstrument(InstrumentFactories.Vaporisateur)`;
the page sets a short release and a mellow preset so arpeggio steps read as separate notes. Nothing
else on the unit. Output to master. The first Play click resumes the AudioContext through the
persistent engine facade (already wrapped by `initializeOpenDAW`).

## Page 2: Spielwerk

Files: `spielwerk-demo.html`, `src/demos/midi/spielwerk-demo.tsx`, card beside page 1 in the
"Recording & MIDI" group. The two pages link to each other in their intro prose.

### Layout

1. **Transport bar** with the same pattern picker (same four patterns, default `melody`).
2. **The two lanes**, half the height of page 1's.
3. **Scripts row.** Buttons for the pre-built scripts, plus Blank. Loading one writes it into the
   editor and compiles it.
4. **Editor and reference, side by side** (stacked on narrow screens). The editor is a
   `<textarea>` styled as code (the Werkstatt demo's choice; no CodeMirror dependency). It compiles
   on the Compile button and on Cmd/Ctrl+Enter only, never on a typing pause (a recompile cuts the
   instrument's sounding voices, so it is the visitor's act). Errors from
   `ScriptCompiler.compile` show under the editor with the message as the compiler gives it; the
   device keeps its last good script (the compiler only writes on success; verify this in
   `ScriptCompiler.ts` and, if it writes first, snapshot `code` and restore on failure). Below the
   editor, the parameters the script declares (`// @param`) as sliders, read from the device's
   `parameters` pointer hub as the Werkstatt demo does.
5. **Reference panel.** The Spielwerk entry points: `process(block, events)` as a generator,
   `block.from / to / bpm / flags`, the note-on and note-off event shapes, `yield`, `// @no-pass`,
   `// @param`, `paramChanged`, `reset`, the pulse grid (960 per quarter). Each entry has a short
   runnable example; clicking loads it into the editor (replacing it, with the current text kept
   in an undo slot: one "Restore previous" link). Source of the entry text: the studio's
   `script-entry-points.ts` NOTE entries, rewritten in this repo's words, not copied (AGPL).

### Pre-built scripts

| id | does | declares |
|---|---|---|
| Echo | forwards each note, yields copies at `position + i × delay` with decaying velocity | `delay` (pulses, int 60–960, default 240), `repeats` (int 1–8, default 3), `decay` (unipolar, default 0.6) |
| Chord | yields a third and a fifth above every note-on (`// @no-pass` off: the root is forwarded) | `interval1` (int 1–12, default 4), `interval2` (int 1–12, default 7) |
| Humanize | `// @no-pass`; re-yields each note-on with a random position nudge and velocity scatter | `timing` (pulses, int 0–120, default 30), `velocity` (unipolar, default 0.2) |
| Octave jump | `// @no-pass`; every Nth note-on goes up an octave | `every` (int 2–8, default 3) |
| Strum | `// @no-pass`; note-ons that share a position (a chord) are spread by `spread` pulses each, low to high | `spread` (pulses, int 0–240, default 60) |
| Note filter | `// @no-pass`; forwards only note-ons whose pitch is in a scale (major from `root`), drops the rest | `root` (int 0–11, default 0) |
| Blank | the forwarding shell with comments | none |

Every script is written against the installed SDK's Spielwerk runtime and tested by the builder on
the page before the PR; a script that the runtime rejects is rewritten, not shipped commented out.
The echo script in `src/lib/audit/midiEffectScenarios.ts` is the known-good shape to start from.

## What is shared

- `src/lib/midiEffects/patterns.ts`: the four patterns as data, and `writePattern(project, region,
  pattern)` (create-then-append). Unit tested against a real box graph (fixtures in
  `src/lib/testing/boxGraphFixtures.ts`): the region holds the expected events after a write and
  after a switch.
- `src/lib/midiEffects/chain.ts`: `insertDevice`, `removeDevice`, `reorder`, `setEnabled`, with
  the device registry (factory, label, default settings, the parameter descriptors each card
  renders). Unit tested: insert then remove leaves the chain empty; reorder lands the indices
  `moveIndices` promises; a second insert of the same device is refused.
- `src/lib/midiEffects/emittedNotes.ts`: the frame-sampled bar builder over `NoteStreamReceiver`
  (pure: takes the 128-bit snapshot and the position, returns open and closed bars). Unit tested
  with synthetic snapshots.
- `src/components/NoteLane.tsx`: the piano-roll canvas, used by both lanes on both pages, painted
  through `CanvasPainter` with explicit `requestUpdate()`.
- `src/lib/midiEffects/spielwerkScripts.ts`: the pre-built scripts and the reference entries.

## Constraints

- Follow every rule in CLAUDE.md that applies: `editing.modify()` for all box writes, resolve the
  effects field outside the transaction through `midiEffectsFieldOf`, `editing.append()` for the
  seed-clearing step, adapters not casts, Option API (`isEmpty` / `unwrap`), terminate every
  subscription, no `setState` per frame.
- `npm run typecheck` exits 0; tests in Node except component tests (jsdom header).
- The "Adding a New Demo" checklist for both pages: HTML entry, vite input, index card, sitemap,
  og-image, GoatCounter, README table and tree.
- Verify audio by measuring output, not UI state: at least one check per page that the Arpeggio
  (page 1) and the Echo (page 2) change the output against dry (tap the destination with an
  analyser, compare onset counts over two bars). This is a one-off browser session following the
  CLAUDE.md recipe (monkeypatched `connect`, an `AnalyserNode`, a real click on Play), reported
  in the PR body with its figures; NOT a committed audit harness. The placement audit already
  covers timing.
- Two PRs, stacked: the first carries the shared libraries with their tests and page 1 (with its
  checklist items); the second carries page 2 on top of it, and deletes this spec. Retarget the
  second onto `main` before the first's branch is deleted.

## Left to the builder

- Exact Vaporisateur preset values.
- Visual details within the design language: chip styling, the lanes' grid lines, the pitch-label
  gutter.
- Whether the parameter cards use `useParameterUnit` bindings or plain sliders writing through the
  adapter; prefer the binding where the adapter's `namedParameter` exists.
- Order of work. The suggested order: shared libs with tests, page 1 without the emitted lane,
  the emitted lane, page 2, then checklist items.

## Open questions settled by my call (flag in the PR if wrong)

- Patterns are 120 bpm only; no bpm control. The devices' audible effect does not need tempo
  variation and a fixed tempo keeps the patterns' prose true.
- Each device at most once in the stack. The SDK allows duplicates; the demo's chips would then
  need distinguishing labels and the lesson (order matters) does not need two of one.
- Spielwerk is not in the stock page's stack. It has its own page; a visitor who wants both can
  read the stack's code snippet and the Spielwerk page's.
- A chip can be removed from the stack on its own; removing the last one returns the page to the
  tabs with Dry selected. Page 2's Spielwerk has an enabled toggle in place of a Dry tab.

## Decided after the builder check

- **The silence after a chain change.** Every chain change on page 1 (tab switch, add or remove a
  chip, reorder, enabled toggle) re-seeks the transport to the loop start while it keeps playing,
  so the pattern restarts and no held note is cut mid-way. Page 2 does the same on a compile.
- **Page 2 compiles only on demand.** No compile-on-pause: a Compile button and Cmd/Ctrl+Enter
  compile the editor's text. Loading a pre-built script compiles it at once.
- **A second source for the emitted lane is a follow-up**, not in these PRs. The lane's caption
  says what it cannot show. The follow-up candidates, for the record: an offline render of the two
  bars through the chain with detected onsets, each onset's peak level standing in for velocity
  (the synth scales gain by velocity; deterministic, the placement audit's method); a live tap on
  the unit's output with a peak reading per detected onset (live, but overlapping notes blur it,
  so only the monophonic patterns read cleanly); the per-device note set (on/off only, no
  velocity, so it adds per-device timing and nothing else).
- **A committed semantics audit is the same follow-up.** The placement audit judges timing only;
  nothing checks parameter semantics (Arpeggio modes and octaves, Pitch shifts, Velocity's
  magnet / random / offset / mix on the levels, chain order with two devices), which are the
  claims the demo prose makes. The offline render-and-read library the second source needs
  (onsets, pitch from frequency, velocity from peak) also serves a `midi-effect-semantics`
  standing sweep with a register and a table script. One PR after the two here.
