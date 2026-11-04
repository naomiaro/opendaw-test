# Note Filter in the MIDI Effects demo — design

Date: 2026-11-04. Builds on SDK 0.0.181 (PR #201), which brought the stock MIDI effect
Note Filter (`NoteFilterDeviceBox`, `NoteFilterDeviceBoxAdapter`, `EffectFactories.NoteFilter`).
Second PR, not this one: the audits' ROWS (semantics rows and register re-accept, placement rows).
The semantics RULE for the device is in this PR, because the Rendered page predicts through it.

## Intent

The MIDI Effects demo (`midi-effects-demo.html`) and its Rendered sub-demo
(`midi-effects-rendered-demo.html`) show every stock MIDI effect on a looping two-bar pattern.
Since 0.0.181 there are five stock devices and the demo shows four. This adds the fifth so a
reader can hear and see what Note Filter does the way they can for Arpeggio, Pitch, Velocity and
Zeitgeist: one card, the SDK's own parameter strings, copy that says what to listen for, the
insert snippet a visitor would code, and on the Rendered page the predicted notes against the
read-back.

## What the device does (the rule the copy and the rule function must state correctly)

Sources, pinned at the installed release in the sibling checkout: manual
`packages/app/manual/public/devices/midi/note-filter.md`, crate
`crates/stock-devices/device-note-filter/src/lib.rs` (`output_pitch`, `transform`).

- A note-on passes only when `min <= pitch <= max`, both ends included. Min above Max passes nothing.
- A passing note is then either transposed by `transpose` semitones (Set off) or played as `key`
  (Set on). A transposed result outside 0..127 is dropped, not clamped.
- Velocity and cents pass through unchanged. A note-off replays the pitch its note-on was given,
  so a note ends on the key it started with even if the parameters change while it sounds; the
  note-off of a dropped note-on is dropped too.
- Adapter parameters: `min` (0..127, default 0, prints a key name), `max` (default 127, key name),
  `set` (bool, default off, prints On / Off), `transpose` (−127..127, prints "N st"), `key`
  (default 60, key name). Key names follow the SDK's numbering (`MidiKeys.toFullString`: key 0 is
  "C-2", 60 is "C3", 127 is "G8"). The demo's pattern comments call 60 "C4", and so does the MIDI
  recording demo's piano keyboard, while the Cubed demo prints the SDK's names; the MIDI effects pages
  print no key names elsewhere. Decided: the card keeps the SDK's names, as Cubed does, and its `what`
  copy says once that key names are the SDK's, middle C printed as C3. (My call.)

## Goals

- A fifth card, Note Filter, in both pages, registered in `src/lib/midiEffects/devices.ts` like
  the other four: id `"note-filter"`, factory key `"NoteFilter"`, label "Note Filter".
- The card's five parameters through the adapter, in this order: Min, Max, Set, Semitones, Key.
  Min, Max and Key print the SDK's key names ("C3" for 60); Semitones prints "+7 st".
- Copy (what / listen-for / lane note / snippet) that matches the rule above.
- The Rendered page draws a chain holding a Note Filter: a `noteFilterRule` in the semantics rule
  layer, a `DeviceSetting` variant, the settings reader and writer, and the per-device tables, so
  the page's prediction (ghosts, windows) covers the device.
- Tests in Node for the registry and the rule; the demo verified in the browser by ear and by the
  Rendered page's read-back.
- Every "four stock MIDI effects" phrase in the repo's demo copy updated to five, the device named
  wherever the other four are listed.

## Non-goals

- The audits' rows: no new semantics rows, no register change, no placement rows (second PR). The
  row lists are explicit arrays, so adding the rule adds no rows by itself; the audit page's
  `?device=` filter may learn the new name or not, the builder's call.
- The Spielwerk page and its scripting reference.
- A keyboard-split or layer demo with two Note Filters on two units: the stack on this page is
  one unit, one chain.

## Anti-goals

- Copy or a rule that clamps a transposed note, or treats Max as exclusive: both are wrong by the
  crate.
- A control that writes a raw field value past the adapter's mapping (every card write goes
  through `UnitParameter`, as the sliders do; the audit's `applySettings` keeps its raw writes).

## Decided

**Card order.** Second: Arpeggio, Note Filter, Pitch, Velocity, Zeitgeist. This is the SDK's own
order in `EffectFactories.MidiNamed`. `DEVICE_IDS` sets the tab and chip order, so the change is
one line plus the tests that assert the order.

**The Set control.** The existing cards are all `ParamSlider`s. Set is a boolean; it gets a themed
Radix `Switch` bound to the parameter through the same `useParameterUnit` hook the sliders use
(`ValueMapping.bool`: a unit of 0.5 or above reads on; the switch writes 1 or 0; the SDK's bool
string mapping prints On / Off). A `DeviceParameter` says which control it wants (slider by
default, switch for Set); the card renders accordingly. The switch's accessible name is its label,
as the slider thumbs get theirs.

**Dimming the parameter Set ignores.** With Set off the crate ignores Key; with Set on it ignores
Semitones. The card dims the ignored one (reduced opacity, still operable, so a reader can set a
Key before switching Set on). The dependency is declared on the `DeviceParameter` (which other
parameter's on/off state dims it), not hard-coded in the card. (My call.)

**Insert defaults.** The device is inserted at the SDK's defaults (Min C-2, Max G8, Set off,
0 st, Key C3), which pass everything: inserting it changes nothing, like Pitch at zero. The copy
tells the reader what to move.

**The rule layer (this PR).** In `src/lib/audit/midiEffectSemanticsRules.ts`: `NoteFilterSettings
{ min, max, set, transpose, key }`, the `DeviceSetting` variant `{ device: "note-filter" }`, a
`RULE_SENTENCES` entry, and `noteFilterRule(notes, settings)`: keep a note when `min <= pitch <=
max`, then pitch = `set ? key : pitch + transpose`, drop when outside 0..127, duration / cent /
velocity / position unchanged; wired into `applyStage`. Comments cite the crate lines at the
pinned tag the way `pitchRule` does. In `midiEffectSemanticsRows.ts`: `NOTE_FILTER_BASE` at the
defaults, a `noteFilter(settings)` draft helper if the others have one, `FACTORY_KEYS["note-filter"]
= "NoteFilter"`, `NON_IDENTITY["note-filter"]` (a non-identity setting, e.g. Set on at key 60),
`settingsOf` reading the five fields, `applySettings` writing them; `ORDERS` and `disabledRows`
unchanged (rows are the second PR). `QUESTIONS` gains nothing: the out-of-range drop is documented
in this device's own crate header, unlike Pitch's.

**Copy.** The `what` states the rule in two sentences (range both ends included, then transpose or
set; a result outside the keyboard is dropped). The `listenFor` names three moves on the
patterns, stated truthfully against the pattern pitches (`src/lib/midiEffects/patterns.ts`: Chords
triads 57/60/64, 53/57/60, 60/64/67, 55/59/62; Melody 60 64 67 69 67 64 62 71; Bass 45 41 36 43;
Sixteenths 60): on Chords, Min at D3 (62, the slider's name for it) thins the stack to one, none, two and one notes, the F
chord going silent, a keyboard split; on Bass, Set on plays every root as the Key, the
one-shot-trigger use the manual names; on Melody, Semitones moves the tune and a shift past G8
drops a note instead of clamping it. The lane notes: on the effects page, a dropped note simply
vanishes from the emitted lane; on the Rendered page, a dropped note is a written ghost with no
rendered bar and a transposed or set one sits on its new key (final wording is the builder's).
The snippet inserts the device and writes one parameter (`min`) through the adapter, in the shape
of the other four snippets.

**Where the device must appear.** `DEVICES` / `DEVICE_IDS` / `DeviceId` / `FactoryKey` /
`deviceIdOf` / `deviceParameters` in `devices.ts`; the fixture `midiEffectFixture` in
`src/lib/testing/boxGraphFixtures.ts`; the rule-layer files above; the page header copy in
`midi-effects-demo.tsx` ("one of the four stock MIDI effects"); the overview copy in
`midi-effects-overview.tsx`; the card on `src/index.tsx`; the README demo row; the HTML `<title>`
/ meta description of `midi-effects-demo.html`; `devices.ts`'s own header comment; the midi
`CLAUDE.md` demo notes; `documentation/16-midi.md` ("none of the four built-in effects"). The
og-image is not retaken (the card grid is the same page).

**Tests.** `devices.test.ts`: five devices in order with their factory keys; Note Filter's
parameter keys in card order, Set marked as a switch, the dimming dependencies both ways, Min
printing a key name at its default; `deviceIdOf` on a Note Filter fixture.
`midiEffectSemanticsRules.test.ts`: `noteFilterRule` at the defaults is identity; both range ends
included and Min above Max empties; transpose adds and a result outside 0..127 is dropped, not
clamped; Set plays every passing note as Key ignoring transpose; cent and velocity untouched; the
chain composes it with Pitch in both orders. `midiEffectSemanticsRows.test.ts`: `settingsOf` /
`applySettings` round-trip on a Note Filter fixture box. `chain.test.ts` and `pageState.test.ts`
stay green with the wider union. A DOM test for the card's switch is welcome but not required.

**Browser verification (the settings the user chose).** On a fresh load of
`midi-effects-demo.html` (a real click on Play): Melody with Min at E3 (64, the slider's name) — the two lowest notes
(keys 60 and 62) vanish from the emitted lane and the rest sounds; Bass with Set on — every root lands on
the Key. The same two settings on `midi-effects-rendered-demo.html`: the read-back agrees with the
prediction (dropped notes as ghosts, set notes on the Key), status not `error`. Chords is for the
ear only: its chord with two survivors is beyond the one-voice reader. Undo after a switch write
flips the switch back (`project.editing.undo()` from DevTools, project pulled from the React
fiber per CLAUDE.md).

## Constraints

- `devices.ts` must stay loadable in Node: no value import of `@opendaw/studio-core` (the factory
  stays a key; see the file's comment). The rules module keeps `PPQN` as its only SDK import.
- Card writes through `editing.modify()` only, via `writeParameterUnit`.
- Repo style: comments say why; `npm run typecheck` exits 0; `npm test` green.
- The dev server on 5173 is shared; no `vite.config.ts` edits during a browser run, no edits
  under `src/` while a Rendered-page run is on.

## Left to the builder

- The exact `DeviceParameter` shape for the control kind and the dimming dependency.
- Whether the switch is its own component (`ParamSwitch` beside `ParamSlider`) or a branch in the
  card; a component is the repo's habit.
- The final sentences of the copy, within the rule above.
- Whether the semantics audit page's `?device=` filter learns `note-filter` now or in the second PR.
