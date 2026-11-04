# Note Filter rows for the MIDI effect audits — design

**Date:** 2026-11-04. **SDK:** `@opendaw/studio-sdk@0.0.181`. **One PR.**

## Intent

SDK 0.0.181 added the Note Filter, the fifth stock MIDI effect. PR #203 put it in the MIDI Effects
demo and shipped its semantics RULE (`noteFilterRule`, `NoteFilterSettings`, the `"note-filter"`
`DeviceSetting` variant, `settingsOf` / `applySettings`, `FACTORY_KEYS`, `NOTE_FILTER_BASE`, the
`noteFilter()` draft helper and `NON_IDENTITY["note-filter"]`) because the Rendered page predicts
through the rule layer. Neither standing audit has a Note Filter row yet: the semantics audit (what
comes out) has no group for it, and the placement audit (when a note sounds) does not list it among
its devices. After this PR both audits cover all five devices, so an SDK upgrade that changes the
Note Filter is caught by the standing sweeps like a change to any other device.

The user's one steer: the rows must show that only SOME notes of a melody are filtered out, at
pitches the reader can read. The range window on the melody is the main row, not the out-of-range
drop.

## Goals

- A `note-filter` row group in the semantics audit that samples every parameter of the device (min,
  max, set, transpose, key) with the rule already on main predicting each row, and whose main rows
  are range windows on the demo melody.
- `"note-filter"` in the semantics audit's `?device=` filter, in the order rows (with Pitch and with
  Arpeggio, both ways) and in the disabled rows.
- A pass-through row and its disabled twin in the placement audit, with `"note-filter"` in its
  `?device=` filter.
- Both audits run at both page rates, every new semantics row reading `rule holds, unregistered`
  and every old row unchanged, every placement row `as-predicted`; the semantics registers
  re-accepted after the user's read.
- Row counts, device lists and the "no Note Filter rows yet" clause updated wherever they are stated.

## Non-goals

- No change to the rule, the reader, the verdict, the artifacts schema or the table scripts.
- No partial drop at the 0..127 edge: the survivors would sit at 117–127 (5.9–12.5 kHz) at the top
  and below the reader's four-cycle window at the bottom on every pattern the audit has. The
  out-of-range drop is shown the way the Pitch group shows it, two all-dropped rows judged on
  silence. (The reader is proven to pitch 112; proving it at 127 is a separate piece of work.)
- No new pattern. The melody, the sixteenths and the chromatic run carry every row.
- The crate's `MAX_HELD` 64 cap stays unmodelled (no pattern reaches it), as for Pitch.
- Nothing in the MIDI Effects demo or the Rendered page changes.

## Anti-goals

- A row whose prediction depends on anything but the rule on main: a row that cannot be predicted
  would add a `no rule` entry, not coverage.
- A non-identity setting that is an identity on its row's pattern (the deferred review point from
  #203: `min 60` drops nothing on the melody or the sixteenths). The order and disabled rows must
  carry a setting that changes their pattern.
- A row whose notes outrun the 4 s sample (`duration_s × 2^((pitch − 69)/12) ≤ 4`, the existing
  fit test) or sit under the reader's floor. Every row below was checked against both.
- Accepting a register before the user has read the table.

## Constraints (from the repo)

- The semantics rows live in `src/lib/audit/midiEffectSemanticsRows.ts`; the group list is
  `RowGroup`, the URL filter `DEVICE_FILTERS`, the pairs `ORDERS`, the per-device non-identity
  `NON_IDENTITY`, the quick subset `QUICK_IDS`. Ids are stable strings: a number prints as JavaScript
  prints it. Labels are sentences built from the settings, ending in ` — <pattern label>`.
- `midiEffectSemanticsRows.test.ts` pins the per-group counts, the total (230) and the quick count
  (41); the quick subset must stay within 30–60 and hold every order and disabled row; the group list
  `GROUPS` in the test must gain the new group.
- Key names print as the SDK's (`MidiKeys.toFullString`: key 60 is C3, key 0 is C-2). A row label
  that names a key uses that convention.
- The placement rows live in `src/lib/audit/midiEffectScenarios.ts` (`MIDI_EFFECT_DEVICES`,
  `MIDI_EFFECT_ROW_IDS`, `MIDI_EFFECT_SCENARIOS`, `resolveDevices`); the page's `FACTORIES` map in
  `src/demos/midi/midi-effect-placement-audit-debug-demo.tsx` maps a device id to its
  `EffectFactories` entry (`EffectFactories.NoteFilter` exists in the installed dist).
  `midiEffectScenarios.test.ts` pins 13 rows and the `?device=pitch` selection.
- The semantics page's header comment and the midi CLAUDE.md state the `?device=` values; the
  placement page's header and the midi CLAUDE.md state its list.
- A new semantics row reads `<rule>, unregistered` (amber) until `--accept` writes the register;
  `--accept` on a full run writes every row. `--accept` only after the user's read.
- Editing anything under `src/` reloads the dev server page and loses a run in progress: build and
  test first, run the pages after.
- The dev server on 5173 is the user's; reuse it (`touch vite.config.ts` restarts it when its dep
  cache has gone).

## The semantics rows (the decided part)

Patterns: `melody` (eighths 60, 64, 67, 69, 67, 64, 62, 71 twice, legato, velocities 0.4–1.0),
`sixteenths` (32 at pitch 60, a thirty-second each), `chromatic` (C4..B4, one semitone apart, a
thirty-second each). `NOTE_FILTER_BASE` is the identity: min 0, max 127, set off, transpose 0, key 60.
Every row changes one thing from the base unless said otherwise. Ids below are the builder's to
spell, with the prefix `nf-`; the settings are fixed.

**Range on the melody** (the main rows):

| rows | min | max | what passes | why |
|---|---|---|---|---|
| identity | 0 | 127 | everything | the control |
| window | 62 | 67 | 64, 67, 67, 64, 62 per bar; 60, 69, 71 dropped | some notes filtered out of a melody, survivors readable; gaps open where a note is dropped |
| floor | 65 | 127 | 67, 69, 67, 71 | one end only |
| ceiling | 0 | 64 | 60, 64, 64, 62 | the other end only |
| one key | 64 | 64 | E3 (64) twice per bar | the manual's one-drum case; a range of one key |
| min above max | 67 | 62 | nothing | the manual: "If Min is above Max, no note passes"; predicted silent, judged on silence |

**Inclusive ends on the chromatic run** (C4..B4 = 60..71, one semitone apart):

| rows | min | max | what passes |
|---|---|---|---|
| min at the first note | 60 | 127 | all twelve |
| min one above it | 61 | 127 | eleven, 60 dropped |
| max at the last note | 0 | 71 | all twelve |
| max one below it | 0 | 70 | eleven, 71 dropped |

An off-by-one on either end shows as exactly one dropped note.

**Transpose on the melody:** −12, −7, −1, 0, +1, +7, +12, +24 (eight rows; 0 is the control; +24 puts
the top at 95, 250 ms × 2^(26/12) = 1.1 s of the sample). Plus the two silent rows on the chromatic
run: +68 (results 128..139, every note dropped) and −72 (results −12..−1, every note dropped), both
predicted empty and judged on silence like `pitch-oct7-chromatic`.

**Set:** on the melody and on the sixteenths, set on with key 48, 60, 72 (six rows: every note
collapses to one key; on the melody the shape disappears and the eighths become one abutting line at
the key; on the sixteenths key 60 is the identity in effect and the control for that pattern). Two
more on the melody: set on with the window (min 62, max 67, key 72: the filter runs before the set,
so the dropped notes stay dropped and the survivors play as 72), and set on with transpose +7 and key
72 (the transpose is ignored under set, the manual's "Set off" / "Set on" split).

**Non-identity setting** for the order and disabled rows: the window, min 62, max 67 (set off,
transpose 0). On the chords (triads 57/60/64, 53/57/60, 60/64/67, 55/59/62) it keeps 64; nothing;
64 and 67; 62, so it changes every half bar and empties one; on the melody it keeps five of eight
notes per bar; on the sixteenths (pitch 60) it drops every note. All three are non-identities, which
the guard test below asserts.

**Order rows:** `["pitch", "note-filter"]` and `["note-filter", "pitch"]` on the MELODY;
`["arpeggio", "note-filter"]` and `["note-filter", "arpeggio"]` on the chords. The reader is
one-voice: a note sounding with another pitch is `polyphonic` and never judged. The existing order
rows sit on the chords only because every one holds an Arpeggio, which turns each held triad into
single notes; a Pitch-and-filter pair on the chords would judge one or two notes per row (the window
still passes two keys of most triads at once). On the melody every surviving note is judged, and the
two orders differ plainly: Pitch's non-identity is +7 st +12.5 ct, so Pitch-then-filter keeps only the
shifted 60 (67, twice per row, with the cents) while filter-then-Pitch keeps the window's five notes
per bar shifted up (71, 74, 74, 71, 69, ten notes). Arpeggio-then-filter walks the full triads and
filters the steps; filter-then-Arpeggio walks what is left (silence on the emptied half bar). The
`ORDERS` table therefore carries a pattern per pair.

**Disabled row:** `disabled-note-filter` on the sixteenths at the non-identity, expected dry.

**Quick subset:** the melody window, the chromatic `min 61`, transpose +7 on the melody, set key 72
on the melody (four ids added to `QUICK_IDS`), plus the four order rows and the disabled row that
join automatically: 41 → 50, within the 30–60 band.

**Counts:** range 6 + ends 4 + transpose 10 + set 8 = 28 rows in the `note-filter` group; order
6 → 10; disabled 4 → 5. Total 230 → 263. The builder states the final figures in the test, the midi
CLAUDE.md (two places: the semantics section's row count and the Cards bullet), the root CLAUDE.md's
sweep bullet (230 rows) and the note's Row sampling section.

**Guard test** (deferred from #203): for every order and disabled row, applying its non-identity
settings to the row's pattern through the rule changes the note list (`noteFilterRule(notes,
settings)` is not equal to `notes`); the same check for the other four devices' non-identities is
welcome if it is one loop, not required.

## The placement rows (the decided part)

- `MIDI_EFFECT_DEVICES` gains `"note-filter"`; `MIDI_EFFECT_ROW_IDS` gains `"note-filter"` and
  `"note-filter-disabled"`; `MIDI_EFFECT_SCENARIOS` gains
  `passThrough("note-filter", "Note Filter (C-2..G8, 0 st, Set off)", "note-filter", true)` after
  the Velocity row and `passThrough("note-filter-disabled", "Note Filter, disabled", "note-filter",
  false)` after `velocity-disabled`; expected lag 0 on both. The page's `FACTORIES` gains
  `"note-filter": EffectFactories.NoteFilter`. The page writes each pass-through device's identity
  settings explicitly (its `applySettings` switch, Pitch 0/0/0, Velocity strength 0, …): the
  `"note-filter"` case writes min 0, max 127, set off, transpose 0, key 60 the same way. (The
  factory's defaults are already that identity, the `settingsOf` test on a bare box proves it; the
  explicit write keeps the row's setting in the page, not in a default.)
- `midiEffectScenarios.test.ts`: 13 → 15 rows, `resolveDevices("note-filter")` gives `["dry",
  "note-filter", "note-filter-disabled"]`.

## Runs and the registers

1. Build, `npm run typecheck`, the unit tests.
2. Semantics: `midi-effect-semantics-audit-debug-demo.html` then `?rate=44100`, a real click on Run,
   about 40 s per rate. Read with `node scripts/audit/midi-effect-semantics/table.ts <runToken>`.
   Expect every `nf-*`, the four new order rows and `disabled-note-filter` to read `rule holds,
   unregistered` (the silent rows too: judged on the empty list) and every old row `as-registered`
   (one `matches-known-deviation arpeggio-drops-cent`, the 18 `no rule` as registered). Anything else
   is a finding to investigate before accepting, reader first, then the row, then the crate.
3. The user reads the two tables. Only then `--accept` per rate.
4. Placement: `midi-effect-placement-audit-debug-demo.html?device=all` then `?rate=44100`, a real
   click, about 15 s; expect every row `as-predicted`, both Note Filter rows at lag 0 / score ≥ 0.9.
5. Both audit runs land in the notes' Runs sections with their run tokens, SDK, rate and the Mac's
   device rate (leave it at 44.1 kHz).

## Docs

- `src/demos/midi/CLAUDE.md`: the semantics section's URL (`?device=` values), row count and quick
  count; the placement section's URL and device list; the Cards bullet's last clause ("the audit has
  no Note Filter ROWS yet") retired.
- Root `CLAUDE.md`: the semantics sweep bullet's "230 rows" and the counts-per-rate phrase if stated.
- `debug/2026-11-03-midi-effect-semantics/note.md`: the title line's device list, the Rule sources
  table gains a Note Filter row (crate `device-note-filter/src/lib.rs:45-49` `output_pitch`,
  `:105-118` `transform`; manual `packages/app/manual/public/devices/midi/note-filter.md` sections 1
  and 2; adapter `NoteFilterDeviceBoxAdapter` for the key and transpose mappings, 0..127 and
  −127..127), the Row sampling section gains the group, the Runs section the two runs and the
  re-accept, the Status's counts.
- `debug/2026-10-21-midi-effect-placement/note.md`: the Runs section gains the run; the harness line's
  device list.
- `debug/README.md`: the semantics row's device list and row count; the placement row's device list
  if it names them.
- This spec is deleted in the PR that completes the work (repo convention).

## Left to the builder

- The exact ids and label wording, within the conventions above.
- Whether `noteFilterRows()` is one function with sub-blocks or several; it must slot into
  `SEMANTICS_ROWS` after `zeitgeistRows()` and before `orderRows()`.
- The per-group count array in the test.
- Whether the guard test covers the other devices' non-identities.
- Small label details (a key printed as a name through `MidiKeys.toFullString` or as a number; the
  existing groups print numbers, so numbers are fine).
