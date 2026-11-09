# MIDI Effect Semantics Audit — register & results

**Title:** MIDI Effect Semantics Audit — does each stock MIDI effect emit what its documented rule
says, across the whole range of every parameter, and has anything changed since the last accepted run

**SDK Pin:** `@opendaw/studio-sdk@0.0.183` (installed npm package; WASM engine only; first accepted on
0.0.180). The crate and manual citations below are read in the openDAW checkout pinned to the installed release:
the Arpeggio crate and manual were rewritten on 0.0.182 and the Zeitgeist's shortened, so their citations moved, and the Arpeggio's lines
moved again on 0.0.183; Pitch, Velocity, Note Filter and the wiring fold are untouched. **Both registers carry 0.0.183 since the 2026-11-09 accept, on the user's word: 380 rows each.** Citations in the retired deviations and the withdrawn question are the release they were read on, marked "(0.0.181)".

**Filed (2026-11-03) and closed (2026-11-04), the manuals corrected:**
[openDAW#524](https://github.com/andremichelle/openDAW/issues/524) the Arpeggio's Velocity control is
silent at −100 % and full at 0 % where its manual said full at −100 % and a blend at 0 %
(`drafts/posted-openDAW-524-arpeggio-velocity-vs-manual.md`); [openDAW#525](https://github.com/andremichelle/openDAW/issues/525)
the Zeitgeist warps note-offs too, so note lengths change with the groove where its manual said
durations remain unchanged (`drafts/posted-openDAW-525-zeitgeist-warps-note-offs-vs-manual.md`). The
maintainer answered both the same way: the engine behaves as intended and the manual was wrong. The
Arpeggio manual (upstream `0b371e0b3`) now says the lower half plays every note at one fixed velocity
rising from silent at 0 % to full at 50 % (the manual's displayed scale; the parameter, the rules and
the row ids `arp-vel-1…` run −100 % to +100 %, silent at −100 %, full at 0 %), ignoring the input, and
the upper half blends from full toward the input velocity; the Zeitgeist manual (`2922ba25d`) now says it warps time itself, note-ons
and note-offs both move, and the automation clock of the devices after it is warped the same way. The
rules here follow the corrected manuals since 2026-11-04: `arpeggio-velocity-matrix` and
`zeitgeist-warps-note-off` are retired (the engine's arithmetic IS the rule), the
`arpeggio-velocity-manual-gap` question is withdrawn, and both registers were re-accepted on the new
rule (the `unreadable` counts of 24 rows with a Zeitgeist per rate changed, not one note; see the Runs).
Later the same day `arpeggio-uncapped-note-off` was retired as well, on the manual alone: "5. Gate" defines
the note length as a percentage of the step rate and says nothing about the held note's end, so the
cap at the held note was this audit's own reading, not the manual's (the registers did not change:
every row as-registered). The last deviation, `arpeggio-drops-cent`, was the subject of a
question filed 2026-11-04 as [openDAW#526](https://github.com/andremichelle/openDAW/issues/526)
(`drafts/posted-openDAW-526-arpeggio-drops-cent.md`, which also asks about the uncapped step); the
maintainer's answer settled both, the fix shipped on 0.0.182, and the deviation is retired: no deviation is left.

**Harness:** unlisted debug demo
`midi-effect-semantics-audit-debug-demo.html[?rate=48000|44100][&rows=all|quick|<id,id,…>][&device=all|arpeggio|pitch|velocity|zeitgeist|note-filter|order|disabled][&pattern=<id>]`
on the dev server, Chrome, a real click on "Run audit"; deterministic, no hardware, about 70
seconds per rate for the 380 rows. The summary JSON (`midisem-summary-<runToken>.json`, one record
per row with every predicted and read note) lands in `.verify-output/` via the dev server's
`/__verify` sink; `node scripts/audit/midi-effect-semantics/table.ts [runToken] [--accept] [--force]`
prints the table below and, with `--accept`, writes the run as the register
(`register/48000.json`, `register/44100.json` beside this note) the next run is judged against.

**Measurement library:** `src/lib/audit/midiEffectSemanticsReader.ts` (the note reader),
`midiEffectSemanticsRules.ts` and `arpeggioWalk.ts` (what each device's rule predicts, the known deviations, the
questioned behaviours, readability), `midiEffectSemanticsRows.ts` (rows, patterns, constants, the
rules' range), `midiEffectSemanticsVerdict.ts` (the rule and register judgements and the verdict),
`midiEffectSemanticsArtifacts.ts` (summary and register schema), `midiEffectBootstrap.ts` (the Nano
project).

**Design spec and plan:** `docs/superpowers/specs/2026-11-03-midi-effect-semantics-audit-design.md`,
`docs/superpowers/plans/2026-11-03-midi-effect-semantics-audit.md` (deleted in the PR that completes
this work, per repo convention; git history keeps them).

The placement audit (`../2026-10-21-midi-effect-placement/note.md`) asks WHEN a note sounds through
an effect. This audit asks WHAT comes out: which notes, at which pitch, cents, velocity and length.

## What a row measures

One Nano sampler plays a 440 Hz sine sample (4 s, unit amplitude), root key 69, attack and release
at the minimum (1 ms), loop off, the Maximizer removed from the master. The voice renders `sin ×
env²` scaled by velocity, so a note's pitch is the sine's frequency at the note's key and its level is
linear in velocity. One note region at bar 1 (position 3840, two bars long, to 6000 ms at 120 bpm);
bar 0 is silent. Each row writes its pattern into the region, inserts its chain of MIDI effects (one
transaction), writes the settings (a second), renders offline (`renderOfflineSlice` from position 0,
the region plus a quarter second, 6.25 s) at the page's rate, reads the left channel back as notes and
deletes the chain.

**The reader** (`readNotes`): a note opens at the first frame above 0.002 of full scale and ends at
the last one before a run of at least 2 ms at or below it. Pitch is the mean period of the rising zero
crossings between two attacks after the onset and one attack before the end (at least four
crossings); jitter is the spread of those periods in cents, and a note whose periods wander more than
10 cents is read as unstable (two pitches at once). Velocity is the parabola-refined peak of the first
full cycle after the attack over the reference peak. Tested on synthesized voices: pitch within 0.5
cents at 65 Hz, 261.6 Hz and 4186 Hz; velocity within 0.002 at 0.02 and at half level; a quiet
note's onset within 1 ms; two 243 ms notes 4.8 ms apart read as two. Figures round to 0.1 ms, 0.1
cent and half a percent of velocity.

**Calibration from the dry row** (`dry-sixteenths`, 32 notes, must read 32 or the run aborts):
reference peak 0.7079 at 48 kHz and 0.7078 at 44.1 kHz (the sampler's level at velocity 1 with the
master as built); instrument offset 6 frames at both rates (0.13 ms between a note's pulse and its
first frame above 0.002; the placement audit's 12–13 frames are the same ramp read at 0.05). The
threshold crossing does not move measurably with velocity: the dry row's 1.0 and 0.6 notes both read
their onsets on the 0.1 ms grid, and their velocities read 1.000 and 0.600 exactly after rounding,
which is the check that velocity is linear in level.

**Readability** (`markReadability`, on the predicted notes before the judgement). The reader is
monophonic, so each predicted note is marked:

- `overlap` (two notes of one pitch sounding together beyond the 1 ms release) and `polyphonic` (two
  pitches): not judged.
- `too-short`: the note's duration less three attacks does not hold four periods of its pitch, so the
  reader's pitch window cannot be sure of four rising crossings at any phase (18.3 ms at C4, 64.2 ms
  at C2, 4.9 ms at C7). Not judged.
- `too-quiet`: velocity above 0 and below 0.01. Not judged. A velocity of exactly 0 is silence, not a
  quiet note: the Nano's voice gain is `gain × velocity` (`device-nano/src/voice.rs:177`), so the note
  leaves the prediction before anything is marked (it neither sounds nor touches a neighbour), and a row
  whose every note is at 0 is predicted silent and judged on the empty list.
- `abutting`: notes that touch within the 1 ms release (gate 1 in the Arpeggio, gate 1 being a step
  ending where the next begins) or sit less than the reader's 2 ms gap apart. The reader cannot
  separate them, so the judge reads each through `readWindow` at its PREDICTED span and judges
  pitch, cents and velocity, never onset or end.
- `readable`: the rest, judged on onset (±1 ms), pitch and cents together (±2 cents), velocity
  (±0.01) and end (±2 ms).

Precedence: overlap > polyphonic > too-short > too-quiet > abutting. A read note whose onset falls
inside a non-readable predicted span is set aside; one outside every predicted span is an extra note,
in a row with nothing to judge too: a read note outside every predicted span of every variant makes a
row that would read `no rule` read `rule broken`.

**The two judgements.** Against the RULE: the read notes against the rule's intent, then against
each subset of the known deviations of the row's devices, smallest first; the first variant that
matches names the verdict (`rule holds`, `matches-known-deviation <names>`), none matching is `rule
broken` with the first intent mismatch, and a row with no judgeable note in any variant is `no rule`.
Against the REGISTER: the read notes and the intent's unreadable count against the accepted run of the
same rate (`as-registered`, `changed`, `unregistered`). The verdict joins them: `as-registered`,
`as-registered, matches-known-deviation …`, `changed, rule holds|…|rule broken`, `<rule>,
unregistered`, `no rule` (with the register axis: `changed, no rule`, `no rule, unregistered`), `error`
(a failed render, or a render silent at peak 0 where every variant predicts a readable or abutting note;
a silence the rule predicts, the Arpeggio at −100 %, is judged). The
envelope and the table carry the INTENT variant's predicted
notes, so a deviation row's "readable" count is the intent's, not the matching variant's.

**The rules' range.** The rules run over the span the render covers, from the region's start to the
render's end (3840 to 12000 pulses at 120 bpm), and the predictions are clipped to it (a note starting
at or past the end is not in the buffer, one crossing it is read to the buffer's end). The region's
end cuts nothing a device emits: the sequencer reads the region's notes and a device may place them
past its end, where they sound through the tail (measured, run 1793741626351:
`zg-amount0.75-dur61440-sixteenths` reads notes at 6072.7 and 6243.7 ms).

## Rule sources

The rule is what the device documents, read from the crate (`openDAW/crates/stock-devices/`) and the
manual (`openDAW/packages/app/manual/public/devices/midi/<device>.md`); the adapter supplies the value
mappings. Positions are absolute pulses.

| device | rule | crate | adapter |
|---|---|---|---|
| Arpeggio | On the absolute rate grid, one note per step from the notes held at that step, in Played (by start, then pitch) or Pitch order (`arpeggio.md:55-58`), walked by its mode over the octaves as one row of `notes × octaves` (`arpeggio.md:28-51`, `:62`), the walk starting `offset` notes later (`:108`), the random modes following the seed only (`:51`, `:176`), each as long as the gate says, past the held note's end too (`:116`, "Note length as a percentage of the step rate"; `:178`: "lasts its full gate length, even when the held key is released"). A played note keeps the cents of the held note it comes from (`:177`, openDAW#526). The walk indexes the ABSOLUTE grid (`effective / repeat + offset`, the manual: "syncs to transport position", `:175`), so a hold from bar 1 at 1/16 starts at grid index 16, not 0: an Up walk over a C major triad starts on E. Velocity (`arpeggio.md:122-132`): below 0 % one fixed velocity `1 + v` ignoring the input (silent at −100 %, full at 0 %), above it a blend from full toward the note's own (`velocity × v + (1 − v)`). Hold, Retrigger and the step lanes are not in the rule: the rows leave them at their defaults, where the crate's step reduces to this walk (`tests/golden.rs` pins modes 0–2 against the legacy device; the render pins the rest). | `device-arpeggio/src/lib.rs:638-692` (`step`), `:731-739` (the grid loop), `:306-345` (`walk_index`), `:220-230` (`hash`), `:420-423` (`first_index`), `:199-211` (the velocity matrix) | `ArpeggioDeviceBoxAdapter.ts:13-19` (`RateFractions`, `floor(3840 / d) × n`), `:24-26` (`Modes`) |
| Pitch | Every note moves by `octaves × 12 + semitones`, its cent by the cents setting; a note shifted outside 0..127 is dropped. | `device-pitch/src/lib.rs:101-133` (`transform`), `:8-11` (the drop) | `PitchDeviceBoxAdapter.ts:50-58` (octaves ±7, semitones ±36, cents ±50) |
| Velocity | Every note's velocity is the adapter's `computeVelocity` at the note's absolute position (magnet, random from the seeded generator, offset, clamped, mixed). | `device-velocity/src/lib.rs:70-77` (`compute_velocity`, the adapter's formula ported) | `VelocityDeviceBoxAdapter.ts:31-39` |
| Zeitgeist | Every note starts where the groove warps its position to and ends where it warps its note-off to, so its duration changes with its place in the cell (`zeitgeist.md:53`, as corrected for openDAW#525). The warp is the cell's Möbius ease at the squashed amount (`0.01 + 0.98 × amount`), read through the device adapter's `groove()` and kept as a float pulse. | `device-zeitgeist/src/lib.rs:35-49` (`process`: warp each record, clamp into the block's range; the groove reached through the engine's registry) | `GrooveShuffleBoxAdapter.ts:23-26`, `CellGrooveBoxAdapter` (the cell) |
| Note Filter | Only a note between min and max, both included, passes (`note-filter.md` §1: "The lowest key that passes, included", "The highest key that passes, included", "If Min is above Max, no note passes"); it then moves by the transpose semitones, or plays as the key when set is on (§2); a result outside 0..127 is ignored (§2). The 64 held-note cap (`MAX_HELD`) is not modelled; no pattern reaches it. | `device-note-filter/src/lib.rs:45-49` (`output_pitch`), `:105-118` (`transform`) | `NoteFilterDeviceBoxAdapter` (key and min/max 0..127, transpose −127..127) |

A chain composes the rules in index order (`crates/engine/src/audio_unit/wiring.rs:1061-1066`); a
disabled device is left out (`wiring.rs:1063`).

## Known deviations

A deviation is a place the engine does something other than the documented rule, named so a row can
be judged with it on and off. Every one below is the crate's arithmetic as written, not a reading
error; a row that matches only with a deviation on reads `matches-known-deviation <name>`.

| name | what the engine does | crate line | first seen | retired on |
|---|---|---|---|---|
| `arpeggio-velocity-matrix` (retired) | One fixed velocity `1 + v` below 0, a blend `velocity × v + (1 − v)` above it, where the manual of the time blended full velocity with the note's own; the engine still does exactly this, and it is the rule since 2026-11-04. | `device-arpeggio/src/lib.rs:109-119` (0.0.181) | 0.0.180 (first run) | 2026-11-04: openDAW#524 closed, the manual corrected (`0b371e0b3`); the matrix is the rule |
| `arpeggio-drops-cent` (retired) | Emitted every arpeggiated note-on with cent 0, so a source note's detune was lost. Asked upstream as openDAW#526; answered 2026-11-04: the cent was dropped by mistake. | `device-arpeggio/src/lib.rs:310` (0.0.181) | 0.0.180 | 2026-11-06, on 0.0.182: `order-pitch-arpeggio` reads `changed, rule holds` at both rates (12.5 cents on every step); the crate passes `note.cent` (`lib.rs:630,641`) |
| `arpeggio-uncapped-note-off` (retired) | Ends a step at its position plus its length, never at the end of the source note, so the last step outlasts the held note; the engine still does exactly this, and it is the rule since 2026-11-04. | `device-arpeggio/src/lib.rs:309-312` (0.0.181) | 0.0.180 | 2026-11-04: the manual's gate definition (`arpeggio.md:76` then, `:116` now) matches the engine; the cap was this audit's reading. Asked in one line of the dropped-cent question, openDAW#526 |
| `zeitgeist-warps-note-off` (retired) | Warps the note-off like any other record, so a duration stretches or shrinks with the groove, where the manual of the time said durations remain unchanged; the engine still does exactly this, and it is the rule since 2026-11-04. | `device-zeitgeist/src/lib.rs:124-138` (0.0.181) | 0.0.180 | 2026-11-04: openDAW#525 closed, the manual corrected (`2922ba25d`); the warped note-off is the rule |

## Row sampling

380 rows, every one in the register. One parameter at a time across its whole range, the others at
their base, so a miss names its parameter; each parameter's identity setting is a row too, as the
control.

- **Coupled sweeps.** Three pairs are swept together because neither reads alone: the Arpeggio's mode ×
  octaves (Up, Down, Up-Down × 1–5 octaves, on the held chord and on the demo's chords) and rate ×
  gate (the gate is a fraction of the rate's step: nine rates × gates 0.25, 0.5, 1, 2 on a held note),
  and the Velocity magnet's position × strength (a position with no strength moves nothing).
- **Arpeggio rates**: nine of the seventeen are swept (1/3, 1/4, 3/16, 1/8, 3/32, 1/12, 1/16, 1/32,
  1/64), the straight, dotted and triplet kinds from the longest step that falls twice on the
  1750-pulse hold to the first under the reader's floor. Of the eight left out, 1/1 and 1/2 give a
  single step on the hold, 1/6, 3/64, 1/24 and 1/48 repeat a kind already swept between two swept
  neighbours, and 1/96 and 1/128 put a gate-0.5 step (20 and 15 pulses) under the floor at C4, as 1/64's
  30 already does (it reads `no rule`). Repeat 1, 2, 4, 16; velocity −1, −0.5, 0, 0.5, 1 on the
  held chord (velocity 0.8) and the held note (velocity 1).
- **Pitch**: semitones −36, −12, −7, 0, 7, 12, 36; octaves −7, −3, −1, 0, 1, 3, 7; cents −50, −12.5,
  0, 12.5, 50; one combined row; each on the chromatic pattern and the demo melody.
- **Velocity**: magnet 3 × 3, random 0, 0.5, 1, offset −1, −0.5, 0, 0.5, mix 0, 0.5, 1 of a full magnet;
  on the demo sixteenths and melody.
- **Arpeggio walks past the first three, spot-sampled**: modes 3–17 × 1 and 2 octaves on the held chord, and × 1 octave on the demo's
  chords (changing stacks); modes 13–17 (the seeded ones) × seeds 1 and 999999 over two octaves on the held chord (seed 0 is in the rows
  before; a pool of three has too few orders for Random Once to show a seed); Order Played and Pitch on a rolled chord (top note first, so the two orders are opposite);
  Offset 1, 2, 7, and 15 over two octaves (15 is whole passes over three notes); Repeat ×2 with Offset 1 (the offset adds after the division). A test holds each of these
  rows to predict another walk than its reference row.
- **Zeitgeist**: amounts 0, 0.25, 0.5, 0.75, 1 × all 19 groove durations
  (`GrooveShuffleBoxAdapter.DurationPPQNs`, 1/24 to 16 bars) on the sixteenths;
  amounts × 1/8 and 1 bar on the melody. Every Zeitgeist the audit inserts plays the Global Shuffle, which outlives the row; each row writes both fields first.
- **Note Filter**: range windows on the gapped melody (0..127, 62..67, 65..127, 0..64, 64..64, 67..62:
  some notes filtered out, every survivor read on its own) and inclusive ends on the chromatic run (min 60 and 61, max
  71 and 70: an off-by-one drops exactly one note); transpose −12, −7, −1, 0, +1, +7, +12, +24 on the
  gapped melody and +68 / −72 on the chromatic run (every note dropped, predicted silent and judged on
  silence); set on with key 48, 60, 72 on the gapped melody and the sixteenths, plus set under a window
  (62..67, key 72: the filter runs before the set) and set over a transpose (key 72, +7 st: the transpose
  is ignored under set) on the gapped melody.
- **Order** (one row per ordered pair at one non-identity setting each: Arpeggio and Zeitgeist,
  Pitch and Arpeggio, Velocity and Arpeggio, Arpeggio and Note Filter, both ways, on the chords; Pitch
  and Note Filter both ways on the gapped melody, because the one-voice reader cannot judge a held
  triad and the chords pairs are judgeable only through their Arpeggio) and **disabled** (each device
  off on the sixteenths, expected dry). The Note Filter's non-identity is the 62..67 window (min 60
  drops nothing on the sixteenths or the melody).
- **Gate 1 and gate 2.** At gate 1 the Arpeggio's steps touch: they are `abutting`, read at their
  predicted spans for pitch and velocity; the placement audit holds their timing (every step on its
  grid frame). At gate 2 every step overlaps the next by a whole step: same-pitch overlaps on a held
  note are `overlap` and the rows read `no rule`; they are tracked in the register only.

The patterns (`midiEffectSemanticsRows.ts`): a held C4 (1750 pulses, off the 1/16 grid so a 1/16
step crosses its end at 5590), a held C major triad at velocity 0.8 (the same length), a chromatic
run C4–B4 (sixteenths held a thirty-second), the MIDI effects demo's chords, sixteenths and
melody, and the melody gapped (every eighth at 90 %, 432 pulses, a 48-pulse, 25 ms gap). The gapped
melody carries the Note Filter rows: on the legato melody a note the filter should have dropped
between two survivors would run straight on from its neighbour, start no read note of its own and
hide inside the abutting judgement, which reads an abutting note only at its predicted span; a gap
the reader splits on makes a leak an extra note.

## Runs

### 2026-11-03, first runs (SDK 0.0.180, Chrome, macOS, the Mac's output device at 44.1 kHz)

The page renders offline at the asked rate; the output device's rate is recorded because every audio
figure in this repo carries it, not because an offline render reads it.

**Before the full runs.** Run 1793740446771 (the quick subset, 48 kHz) and run 1793740770955 (the
targeted rows) were the page's first runs while it was built; their findings are in the library's
history: the reader's gap went from 5 to 2 ms (a Zeitgeist-warped note-off 4.8 ms before the next
onset merged sixteen notes into one tone), notes closer than the gap became `abutting`, and too-short
and too-quiet came to outrank abutting.

**First full pass, run 1793741626351, 48 kHz:** holds 147, deviation 58, broken 7, no rule 18. Every
broken row was this side's fault, fixed with tests (commit "readability needs four periods in the
reader's window; predictions clip to the render, not the region"):

| row | first mismatch | cause | fix |
|---|---|---|---|
| `pitch-st-36-chromatic`, `pitch-oct-3-chromatic` | note 0 (G#1, 62.5 ms) pitch unreadable | readability admitted two attacks plus three periods; the reader's window, the span less three attacks, needs four rising crossings, and G#1 (19.3 ms period) gave three | `markReadability` asks for three attacks plus four periods; a test synthesizes the sampler's voice at pitches 24–96, durations 8–160 pulses and six phases and checks the reader names every span marked readable. Both rows read `no rule` now: every note in them is too short at C1–B1 |
| `zg-amount1-dur3840-sixteenths` | note 0 end 3523.9 ms expected 2062.5 (the intent's) | the deviation variant failed on its fourth note, 14.2 ms at C4, marked readable and read without a pitch: the same threshold | as above; the row matches `zeitgeist-warps-note-off` |
| `zg-amount0.75-dur7680`, `…15360`, `…30720`, `…61440-sixteenths` | count 16/20/8/4 read, 15/17/6/3 expected | the predictions were clipped at the region's end, 6000 ms, and the engine played the notes the groove moved past it (6072.7 and 6243.7 ms on the 16-bar cell): the chain runs through the render's tail | predictions clip to the render's window (`renderRange`, to 12000 pulses); a test keeps a note moved past the region and clips one crossing the render's end. The four rows match `zeitgeist-warps-note-off` |

The clip to the region's end came from the targeted run 1793740770955, where the last off-beat of
`zg-amount1-dur480-sixteenths` read to 5999.9 ms against an intent end of 6060 ms. The end is the
deviation's own figure, not a cut: at amount 1 (squashed to 0.99) the off-beat's warped note-off lands
at 478.4 of the cell's 480 pulses, 5999.2 ms, and the read end adds the 0.7 ms release (computed; the
note itself is 1.7 ms long, too short to judge).

Two rows moved from `rule holds` to `no rule` with the stricter readability:
`arp-rate12-gate0.25-held-note` and `arp-rate14-gate0.5-held-note`, whose steps are 30 pulses
(15.6 ms) at C4, under the 18.3 ms floor. They held before because the sampler starts every note at
phase 0, which the readability gate does not assume.

**Accepted, 48 kHz: run 1793741953204.** holds 145, deviation 63, broken 0, no rule 22, error 0.
`--accept` without `--force`; the register is `register/48000.json`.

**Accepted, 44.1 kHz: run 1793742021509.** The same verdict on every row as at 48 kHz; reference peak
0.7078, instrument offset 6 frames. `register/44100.json`.

Both registers were accepted by the implementing agent, an AI, after its own read of every row that did
not read `rule holds` against its envelope (the deviation rows' figures and the `no rule` rows'
readability). No person has read the rows yet: the user's review of the pull request is the person's
read the register rule requires.

**Re-runs against the registers:** run 1793742068350 (48 kHz) and run 1793742110233 (44.1 kHz):

| rate | `as-registered` | `as-registered, matches-known-deviation …` | `no rule` | `changed` | `error` |
|---|---|---|---|---|---|
| 48 kHz | 145 | 63 | 22 | 0 | 0 |
| 44.1 kHz | 145 | 63 | 22 | 0 | 0 |

No row changed: the offline render is deterministic at both rates, the Velocity random rows included
(the seed is the box default).

### 2026-11-03, re-accepted after the final review (SDK 0.0.180, Chrome, macOS, the Mac's output device at 44.1 kHz)

The final review of the branch changed the judge and the reader in four ways that move the register,
each with tests:

- **A velocity-0 note is silence** and leaves the prediction (it was `too-quiet`). The four rows whose
  every note lands at velocity 0, `vel-offset-1-sixteenths`, `vel-offset-1-melody`,
  `vel-magnet0x1-sixteenths` and `vel-magnet0x1-melody`, moved from `no rule` to `rule holds` on an
  empty prediction, the render silent; an engine that starts sounding there reads `rule broken`.
  `vel-random1-*` and `vel-offset-0.5-melody` lost their 3 or 4 velocity-0 notes from the unreadable
  count.
- **A `no rule` row keeps both judgements:** it reads the register (`changed, no rule`, `no rule,
  unregistered`), and a read note outside every predicted span of every variant makes it `rule
  broken`. No row reads `rule broken`.
- **The reader's peak refinement stays inside its window.** A max on the window's edge was lifted
  through the parabola of a larger sample outside the window, which overshot (reads of 1.005 at
  44.1 kHz on notes of velocity 1). Read velocities moved on notes the rule does not judge, merged
  polyphonic spans and notes too short under the matching variant: 0.99 to 0.96 at 48 kHz, 1.005 or
  0.97 to 0.955 at 44.1 kHz, one 2.4 ms note of velocity 0.6 from 0.605 to 0.57 (48 kHz) and 0.61
  to 0.565 (44.1 kHz). No judged figure moved.
- **The Arpeggio velocity question** was raised only where the manual's blend and the crate's matrix
  gave a different velocity for a note that reaches the device: `arp-vel0-held-note` and
  `arp-vel0.5-held-note` (velocity-1 notes, 1.0 under both) were no longer questioned. (Withdrawn on
  2026-11-04 with the manual's correction, see below.)

A render silent where every variant predicts a judgeable note is now an `error` row; none reads it.

**Runs against the first registers:** run 1793744029767 (48 kHz) and run 1793744117203 (44.1 kHz),
holds 149, deviation 63, broken 0, no rule 18, error 0 at both rates; 13 rows `changed` at 48 kHz and
14 at 44.1 kHz (the same 13 plus `zg-amount0-dur15360-sixteenths`, `changed, no rule`, a merged note's
velocity 0.97 to 0.955). Every changed row is one of the causes above, and every row reads the same
rule verdict at both rates.

**Accepted, 48 kHz: run 1793744029767; 44.1 kHz: run 1793744117203.** `--accept` without `--force`
(full runs, nothing broken). The diffs it printed:

```
48 kHz   changed: vel-magnet0x1-melody, vel-magnet0x1-sixteenths, vel-offset-0.5-melody, vel-offset-1-melody, vel-offset-1-sixteenths, vel-random1-melody, vel-random1-sixteenths, zg-amount0-dur7680-sixteenths, zg-amount1-dur1920-sixteenths, zg-amount1-dur3840-sixteenths, zg-amount1-dur480-sixteenths, zg-amount1-dur7680-sixteenths, zg-amount1-dur960-sixteenths
44.1 kHz changed: vel-magnet0x1-melody, vel-magnet0x1-sixteenths, vel-offset-0.5-melody, vel-offset-1-melody, vel-offset-1-sixteenths, vel-random1-melody, vel-random1-sixteenths, zg-amount0-dur15360-sixteenths, zg-amount0-dur7680-sixteenths, zg-amount1-dur1920-sixteenths, zg-amount1-dur3840-sixteenths, zg-amount1-dur480-sixteenths, zg-amount1-dur7680-sixteenths, zg-amount1-dur960-sixteenths
```

Both registers were re-accepted by the implementing agent, an AI, after its own read of every row
that did not read `as-registered`: each changed row's read notes against the previous register's,
field by field, with the envelope's predicted notes to say which moved notes the rule judges. No
person has read the rows yet: the user's review of the pull request is the person's read the register
rule requires.

**Re-runs against the new registers:** run 1793744167477 (48 kHz) and run 1793744211868 (44.1 kHz):

| rate | `as-registered` | `as-registered, matches-known-deviation …` | `no rule` | `changed` | `error` |
|---|---|---|---|---|---|
| 48 kHz | 149 | 63 | 18 | 0 | 0 |
| 44.1 kHz | 149 | 63 | 18 | 0 | 0 |

Verdicts per group, the registers accepted 2026-11-03 (both rates alike; superseded by the 2026-11-04
re-accept below, where the two retired deviations read as the rule):

| group | rows | holds | deviation | no rule |
|---|---|---|---|---|
| dry | 4 | 4 | 0 | 0 |
| arpeggio | 88 | 39 | 37 | 12 |
| pitch | 40 | 38 | 0 | 2 |
| velocity | 38 | 38 | 0 | 0 |
| zeitgeist | 50 | 22 | 24 | 4 |
| order | 6 | 4 | 2 | 0 |
| disabled | 4 | 4 | 0 | 0 |

Deviations named then, per rate: `arpeggio-uncapped-note-off` 31 rows, `arpeggio-uncapped-note-off +
arpeggio-velocity-matrix` 4, `arpeggio-velocity-matrix` 2, `arpeggio-drops-cent` 1,
`zeitgeist-warps-note-off` 25 (the last two names retired on 2026-11-04).

Why each `no rule` row has nothing to judge:

- the nine Arpeggio rows at gate 2: every step overlaps the next by a whole step at one pitch;
- `arp-rate12-gate0.25-held-note`, `arp-rate14-gate0.25-held-note`, `arp-rate14-gate0.5-held-note`:
  steps of 15 or 30 pulses, under the floor;
- `pitch-st-36-chromatic`, `pitch-oct-3-chromatic`: a thirty-second at C1–B1, under the floor;
- `zg-amount0-dur480`, `…15360`, `…30720`, `…61440-sixteenths`: at amount 0 the off-beats ease onto
  the cell start and overlap the on-beats, or the long cells squeeze the notes onto one another.

Rows that hold on an EMPTY prediction, so a sound there reads `rule broken`: the four velocity-0 rows
above; `pitch-oct7-*` and `pitch-oct-7-*`, every note dropped; `arp-vel-1-*` by the Arpeggio's velocity
rule; and `zg-amount1-dur15360-sixteenths`, `…30720` and `…61440`, where the groove at amount 1
(0.99 squashed) pushes every note past the render's end: the first sixteenth, at 3840 pulses, warps to
14908, 28691 and 53356 pulses against the render's 12000 (computed through the cell's ease), and
the render reads nothing in its window.
The table (`node scripts/audit/midi-effect-semantics/table.ts <runToken>`): verdict, the first
mismatch or the questioned behaviours, read / readable (unreadable) of the intent, the largest
deltas where read and readable pair one to one, render time.

### 2026-11-04, the rules follow the corrected manuals (SDK 0.0.180, Chrome, macOS, the device at 44.1 kHz)

openDAW#524 and #525 closed with the manuals corrected (see the header), so the Arpeggio's velocity
matrix and the Zeitgeist's warped note-off became the rule and the two deviations were retired. The
first runs on the new rule, judged against the registers accepted above:

```
run 1793770618258 | sdk 0.0.180 | 48000 Hz | 120 bpm | reference peak 0.7078585456111496 | instrument offset 6 frames | register /debug/2026-11-03-midi-effect-semantics/register/48000.json | rows 230 | holds 176 deviation 36 broken 0 none 18 error 0 | as-registered 206 changed 24 unregistered 0
run 1793770665002 | sdk 0.0.180 | 44100 Hz | 120 bpm | reference peak 0.7078102259681298 | instrument offset 6 frames | register /debug/2026-11-03-midi-effect-semantics/register/44100.json | rows 230 | holds 176 deviation 36 broken 0 none 18 error 0 | as-registered 206 changed 24 unregistered 0
```

The 27 rows that matched a retired deviation read `rule holds` now (holds 149 → 176, deviation 63 →
36). The 24 `changed` rows, the same at both rates, are every one `changed, rule holds` on the
`unreadable` count alone (`zg-amount0-dur960` … `zg-amount1-dur3840-melody`, `order-arpeggio-zeitgeist`):
the register stores the INTENT variant's readability count, and the intent now warps the note-off, so
rows whose warped notes abut or overlap count differently (`zg-amount0.25-dur480-sixteenths`: 0
unreadable where the unwarped intent counted 32). Both registers were re-accepted (`--accept`, full
runs, nothing broken) by the implementing agent on this read: the accept's diff names those 24 rows
per rate, and `git diff` on the two register files shows 48 `unreadable` lines and the two header
fields changed and not one note line. The user's review of the pull request is the person's read.
The reference peaks are bit-identical to the earlier runs.

Verdicts per group on the new rule (both rates alike):

| group | rows | holds | deviation | no rule |
|---|---|---|---|---|
| dry | 4 | 4 | 0 | 0 |
| arpeggio | 88 | 41 | 35 | 12 |
| pitch | 40 | 38 | 0 | 2 |
| velocity | 38 | 38 | 0 | 0 |
| zeitgeist | 50 | 46 | 0 | 4 |
| order | 6 | 5 | 1 | 0 |
| disabled | 4 | 4 | 0 | 0 |

Deviations named, per rate: `arpeggio-uncapped-note-off` 35 rows, `arpeggio-drops-cent` 1. The
device-rate pass below predates this re-accept and was not repeated: the sample and render path it
measures did not change.

### 2026-11-04, later: the uncapped step is the rule (SDK 0.0.180, Chrome, macOS, the device at 44.1 kHz)

`arpeggio-uncapped-note-off` retired on the manual's own words ("5. Gate": note length as a percentage
of the step rate; nothing about the held note's end). The runs on that rule, against the registers
accepted above:

```
run 1793772102826 | sdk 0.0.180 | 48000 Hz | 120 bpm | reference peak 0.7078585456111496 | instrument offset 6 frames | register /debug/2026-11-03-midi-effect-semantics/register/48000.json | rows 230 | holds 211 deviation 1 broken 0 none 18 error 0 | as-registered 230 changed 0 unregistered 0
run 1793772168668 | sdk 0.0.180 | 44100 Hz | 120 bpm | reference peak 0.7078102259681298 | instrument offset 6 frames | register /debug/2026-11-03-midi-effect-semantics/register/44100.json | rows 230 | holds 211 deviation 1 broken 0 none 18 error 0 | as-registered 230 changed 0 unregistered 0
```

The 35 rows read `rule holds`; every row `as-registered` at both rates (a step's length does not
change which notes are readable, so the registers were not touched). The one deviation left is
`arpeggio-drops-cent` on `order-pitch-arpeggio`. Verdicts per group on this rule (both rates alike):

| group | rows | holds | deviation | no rule |
|---|---|---|---|---|
| dry | 4 | 4 | 0 | 0 |
| arpeggio | 88 | 76 | 0 | 12 |
| pitch | 40 | 38 | 0 | 2 |
| velocity | 38 | 38 | 0 | 0 |
| zeitgeist | 50 | 46 | 0 | 4 |
| order | 6 | 5 | 1 | 0 |
| disabled | 4 | 4 | 0 | 0 |

### 2026-11-03, the Mac's output device at 48 kHz (SDK 0.0.180, Chrome, macOS)

The device-rate pass the root CLAUDE.md asks of every standing sweep. Both page rates against the
registers accepted above, the device switched to 48 kHz in Audio MIDI Setup first and back to
44.1 kHz afterwards:

```
run 1793744985720 | sdk 0.0.180 | 48000 Hz | 120 bpm | reference peak 0.7078585456111496 | instrument offset 6 frames | register /debug/2026-11-03-midi-effect-semantics/register/48000.json | rows 230 | holds 149 deviation 63 broken 0 none 18 error 0 | as-registered 230 changed 0 unregistered 0
run 1793745032251 | sdk 0.0.180 | 44100 Hz | 120 bpm | reference peak 0.7078102259681298 | instrument offset 6 frames | register /debug/2026-11-03-midi-effect-semantics/register/44100.json | rows 230 | holds 149 deviation 63 broken 0 none 18 error 0 | as-registered 230 changed 0 unregistered 0
```

Every row `as-registered` at both page rates, and each reference peak is bit-identical to the run
with the device at 44.1 kHz (0.7078585456111496 at 48 kHz, 0.7078102259681298 at 44.1 kHz). The
render is offline at the page's rate and the sine sample is generated in memory, not decoded, so the
live context's resampling never reaches a figure; this pass measures that. A `changed` row here would
be a dependence of the sample or render path on the device, not of the engine's rules.


### 2026-11-04, the Note Filter rows (SDK 0.0.181, Chrome, macOS, the Mac's output device at 44.1 kHz)

The 33 rows added for the Note Filter (the `note-filter` group of 28, the four order rows pairing it
with Pitch on the gapped melody and with Arpeggio on the chords, `disabled-note-filter`), run against
the registers accepted on the 0.0.181 upgrade. Every new row reads `rule holds, unregistered` at both
rates: the range windows keep exactly the notes the rule names and nothing else (the gapped melody
would have shown a leak as an extra note), the inclusive ends drop exactly one note one step past each
end, min above max and the two transposes past 127 and below 0 are silent, set collapses every
passing note to the key after the range and ignoring the transpose, the order pairs keep 2 notes with
Pitch first and 10 with the filter first. Every old row as registered; the 18 `no rule` rows unchanged.

| rate | run | `as-registered` | `as-registered, matches-known-deviation …` | `no rule` | `rule holds, unregistered` | `changed` | `error` |
|---|---|---|---|---|---|---|---|
| 48 kHz | 1793823134245 | 211 | 1 (`arpeggio-drops-cent`, `order-pitch-arpeggio`) | 18 | 33 | 0 | 0 |
| 44.1 kHz | 1793823187726 | 211 | 1 (the same row) | 18 | 33 | 0 | 0 |

The verdict column is identical across the two rates, row for row. Reference peak 0.7079 / 0.7078,
instrument offset 6 frames at both rates, as before.

Both runs accepted as the registers (`register/48000.json` from 1793823134245, `register/44100.json`
from 1793823187726): 263 rows each, the 230 earlier entries unchanged entry for entry. Re-run
1793823764790 (48 kHz) against the new register: on the register axis 263 `as-registered`, 0 `changed`, 0
`unregistered` (the verdict column reads 244 `rule holds`, 1 deviation, 18 `no rule`). The 44.1 kHz register has
no re-run yet; its first standing run is the check.

### 2026-11-06, SDK 0.0.182 (Chrome, macOS, the Mac's output device at 44.1 kHz)

The release rewrites the Arpeggio (18 walks, Order, Hold, Retrigger, Offset, Seed, a 64-step sequencer, cents kept) and
makes grooves shared project resources (19 durations, a new Zeitgeist on the Global Shuffle). The rule gained the walks,
Order, Offset and Seed, `arpeggio-drops-cent` was retired BEFORE the run so a still-dropped cent would read `rule broken`,
and the rows grew by 62 Arpeggio and 55 Zeitgeist (11 new durations × 5 amounts): 380.

| rate | run | rule holds | deviation | broken | no rule | as-registered | changed | unregistered | error |
|---|---|---|---|---|---|---|---|---|---|
| 48 kHz | 1793986775632 | 357 | 0 | 0 | 23 | 262 | 1 | 117 | 0 |
| 44.1 kHz | 1793986853296 | 357 | 0 | 0 | 23 | 262 | 1 | 117 | 0 |

- **The one changed row is the fix:** `order-pitch-arpeggio`, `register note 0 cents 12.5 expected 0.0`, at both rates. A
  Pitch's cents now reach every arpeggio step. openDAW#526 closes here.
- **Modes 0–2, every old Zeitgeist row, Pitch, Velocity and Note Filter did not move a note:** the 262 as registered, the
  18 old `no rule` rows among them. The golden claim in the crate holds on the render.
- **The seeded walks match the engine note for note,** which is the check on the rule's port of the hash: Random, Random
  Other, Shuffle, Random Once and Walk at seeds 0, 1 and 999999, on one and two octaves, read `rule holds` inside the
  tolerances. The port also agrees with the crate's own `hash` and `walk_index` compiled with rustc: every mode, 5 seeds, 12 pool sizes, steps −300 to 699,
  1 080 210 values, no mismatch (a review's harness; the test holds a table of those vectors).
- **Five new rows read `no rule, unregistered`,** all Zeitgeist extremes where the warp leaves notes too short for the
  reader, the kind of the registered `zg-amount0-dur480`: `zg-amount0-dur240`, `-dur720`, `-dur23040`, `-dur46080` and
  `zg-amount1-dur11520` on the sixteenths.
- The verdict column is identical across the two rates. Reference peak 0.7079 / 0.7078, instrument offset 6 frames.

**Accepted 2026-11-06 on the user's word** (`register/48000.json` from 1793986775632, `register/44100.json` from 1793986853296): 380 rows each, the
one changed entry `order-pitch-arpeggio`, 117 added, nothing forced. Re-run against the new registers: 1793987489846 (48 kHz) and 1793987550884 (44.1 kHz) each read
357 `as-registered`, 23 `no rule`; on the register axis 380 `as-registered`, 0 `changed`, 0 `unregistered`.

**What these rows cannot see: the loop.** The bootstrap turns the loop off and `renderOfflineSlice` turns it off on its copy, so the groove's loop rule (a
Zeitgeist plays every pass as if it started at the loop start; a note moved across the loop end is not played) has no row here. Measured instead on the live
`midi-effects-demo.html` (Sixteenths, a two-bar loop at bar 1, 3840..11520, note-ons sampled per frame from `NoteStreamReceiver`, Playwright's Chrome; "predicted" counts the
32 notes whose `groove.warp` lands inside the loop):

| amount, duration | predicted | loop on, one pass | loop off, same span |
|---|---|---|---|
| 60 %, 1/8 | 32 | 32 | 32 |
| 75 %, 1/8 | 32 | 32 | 32 |
| 75 %, 1 bar | 32 | 32 | 32 |
| 25 %, 1 bar | 32 | 31 | 31 |
| 75 %, 2 bars | 25 | 24 | 25 |
| 25 %, 2 bars | 24 | 24 | 23 |
| 75 %, 3 bars | 32 | 32 | 32 |
| 25 %, 3 bars | 19 | 19 | 19 |
| 75 %, 16 bars | 3 | 3 | 3 |
| 25 %, 16 bars | 6 | 5 | 5 |

The loop-on column subtracts the wrap's own frame, which catches the next pass's first note in the first four rows (raw 33, 33, 33, 32). Up to 1 bar nothing is lost to the loop: the off-by-one at 25 % reads in both columns, so it is the frame sampling (probably a note under a frame long, not checked). A 2-bar cell loses notes although it is as long as the loop, because cells count from position 0 and the loop starts at bar 1, so it straddles a
cell; a 3-bar cell at 75 % loses none, its warp staying inside this loop. Frame-sampled, so it counts notes and says nothing about their placement; no ear has been on it. The page's Zeitgeist note says this.

### 2026-11-09, SDK 0.0.183 (Chrome, macOS, the Mac's output device at 44.1 kHz)

The release counts the transport's position in frames from an anchor instead of adding pulses per quantum (openDAW#533), so
every rendered note can move at sub-frame level; the Arpeggio gains `followChords` (off in every row) and ends its sounding notes
when the transport starts or stops (no row stops mid-note); the crate's lines moved, and the citations with them (rule-source
table above). Scale Matrix is new and has no rows.

| rate | run | rule holds | deviation | broken | no rule | as-registered | changed | unregistered | error |
|---|---|---|---|---|---|---|---|---|---|
| 48 kHz | 1794245971298 | 357 | 0 | 0 | 23 | 378 | 2 | 0 | 0 |
| 44.1 kHz | 1794246058210 | 357 | 0 | 0 | 23 | 376 | 4 | 0 | 0 |

- **Every changed row reads `changed, rule holds`, and each is a note the reader does not judge**: `vel-random1-melody` (read 3,
  readable 0, unreadable 13: `register note 2 cents −7.8 expected −4.8`, −7.7 at 44.1), `zg-amount0-dur320-sixteenths` (24 / 0 / 32:
  a velocity 0.770 for 0.735 at 48 kHz, 0.715 for 0.750 at 44.1), and at 44.1 kHz `zg-amount1-dur960-sixteenths` (17 / 1 / 31:
  velocity 0.955 for 1.000) and `zg-amount1-dur3840-sixteenths` (17 / 5 / 27: 17 notes read for 16). These are reads of overlapping
  notes, which move when a note-on moves by a frame; the rule verdicts are the 0.0.182 ones row for row.
- **Accepted 2026-11-09 on the user's word** (`register/48000.json` from 1794245971298, `register/44100.json` from 1794246058210, nothing
  forced). Re-run against the new registers: 1794249134609 (48 kHz) and 1794249208718 (44.1 kHz) each read 380 `as-registered`, 0 changed,
  357 holds / 0 deviations / 23 no rule.

## Reading

- **The Arpeggio walks the absolute grid, in every mode, at every octave count, rate and repeat,
  exactly as its crate says.** Every step lands on its grid line within 0.1 ms, at the pitch the walk
  names, starting where the absolute grid index puts it (an Up walk over the held triad from bar 1
  begins on E). Three places where the crate's arithmetic disagreed with the documented rule showed
  (one of them the manual's error, corrected for openDAW#524):
  - `arpeggio-uncapped-note-off` (retired 2026-11-04, the manual's gate definition matching the engine)
    on every row where a step crossed the held note's end (31 rows plus the 4 that also showed the
    velocity matrix): the held C4 ends at 2911.5 ms, the 1/16 step from 2875 ms rings to 2937.5 ms
    (read 2938.3, the release included). These rows hold on the rule now.
  - `arpeggio-velocity-matrix` (retired 2026-11-04) wherever the velocity parameter was below +1 on a
    note below velocity 1, and at −100 % and −50 % on the held note: at −100 % every step is silent
    (both held rows read no note, where the manual of the time played full velocity), at −50 % the
    chord reads 0.500 where that manual's blend gave 0.950, at 0 % it reads 1.000 where the blend gave
    0.900. The corrected manual says exactly what is read, and these rows hold on the rule now.
  - `arpeggio-drops-cent` on `order-pitch-arpeggio`: a Pitch of +12.5 cents before the Arpeggio
    reads 0.0 cents on every step.
- **The Pitch shifts every note by `octaves × 12 + semitones` and adds its cents, at every setting,
  and drops a note shifted outside 0..127.** ±7 octaves on C4–B4 and on the melody read silence: every
  note is dropped, nothing extra sounds (`pitch-drops-out-of-range`, questioned below). Cents read
  exactly at ±12.5; at ±50 a note sits on the half-semitone tie and reads as the next pitch at −50 or
  its own at +50, the same total, which the judge compares (the table's cents column compares the
  residual alone and prints 100 for those rows).
- **The Velocity device computes every note's velocity as the adapter's `computeVelocity`, at every
  magnet, random, offset and mix setting**, the random rows included (seeded, the same at both rates
  and on every run). A velocity-0 result is silence, predicted as such: the four rows whose every
  note lands at 0 hold on a silent render.
- **The Zeitgeist starts every note where the groove warps it, at every amount and every cell length,
  and moves its note-off by the same warp** (read as the `zeitgeist-warps-note-off` deviation on 25
  rows until the manual was corrected, every row where the warp changes a judged note's length by more
  than the 2 ms end tolerance, or changes which notes can be read; the rule since 2026-11-04). At 75 % on 1/8 cells
  the on-beat's note-off moves from 2062.5 to 2123.3 ms and the off-beat's from 2248.75 to 2224.4 ms
  (computed through the warp at the squashed amount 0.745; the reads at 48 kHz end at 2124.0 and
  2225.2 ms, the 0.8 ms release later, as the dry notes do). The groove may move a note past the region's end; it sounds there.
- **The Note Filter does what its manual says on every setting sampled**: a range passes only the notes between
  min and max, both ends included, and nothing when min is above max; a transpose moves every passing note and
  drops a result past 127 or below 0; set replaces every passing note's pitch with the key, after the range and
  ignoring the transpose (33 rows, every one `rule holds` on first measurement, 2026-11-04).
- **A disabled device is left out**, all five alike; **order composes** as the chain's index order says
  (Arpeggio and Zeitgeist, Pitch and Arpeggio, Velocity and Arpeggio, Arpeggio and Note Filter, Pitch and Note
  Filter, both ways, judged as composed).
- **48 and 44.1 kHz read the same verdict on every row**, and a re-run reproduces the register exactly
  (at each rate on the 0.0.180 registers; at 48 kHz on the current ones).

## Questions for upstream

Behaviours the rule takes as the engine's, where the documentation does not settle which is meant.
Rows that exercise one carry `questioned: <name>` in the figure column. Whether to raise one is the
user's call. Two behaviours that disagreed with the MANUAL outright were filed and closed with the
manual corrected: openDAW#524 (the `arpeggio-velocity-manual-gap` question, withdrawn below,
`drafts/posted-openDAW-524-arpeggio-velocity-vs-manual.md`) and openDAW#525 (the
`zeitgeist-warps-note-off` deviation: the manual's technical notes said durations remain unchanged,
the engine warps the note-offs, measured as 26.4 / 63.6 ms note lengths at 25 % and 124.0 / 38.9 ms
at 75 % for notes held 62.5 ms; `drafts/posted-openDAW-525-zeitgeist-warps-note-offs-vs-manual.md`).
The Pitch drop is not filed: the manual is silent on it. Filed 2026-11-04 as a question, openDAW#526
(`drafts/posted-openDAW-526-arpeggio-drops-cent.md`): the dropped cent, and in one line the step that
runs its full gate length past the held note's release. Answered, and the cent fixed on 0.0.182.

- **`pitch-drops-out-of-range`.** The engine drops a note shifted outside 0..127, and its note-off
  passes through unshifted; the crate documents this as its deviation from the TS device, which
  yielded the raw pitch (`device-pitch/src/lib.rs:8-11`). The knobs travel ±7 octaves and ±36
  semitones (`pitch.md:26, 38`), ±120 semitones over a 128-note space, so by arithmetic octaves +6
  alone already silences a C4 melody (60 + 72 = 132); no row runs +6, the swept ±7 does. The manual gives the ranges and says nothing about a note pushed out of the key range.
  Rows: `pitch-oct7-chromatic`, `pitch-oct-7-chromatic`, `pitch-oct7-melody`, `pitch-oct-7-melody`
  (silence, as the rule predicts).
- **`arpeggio-velocity-manual-gap` (withdrawn 2026-11-04).** The manual of the time: −100 % plays
  every note at full velocity ignoring the input, +100 % keeps the note's own, 0 % a blend
  (`arpeggio.md:84-92` before `0b371e0b3`). The engine: silence at −100 %, 1.0 at 0 %, the note's own
  only at +100 % (`device-arpeggio/src/lib.rs:109-119` (0.0.181)). Rows: `arp-vel-1-*` and `arp-vel-0.5-*` (held
  chord and held note), `arp-vel0-held-chord`, `arp-vel0.5-held-chord`; on the chord at velocity 0.8
  the gap was 1.0 at −100 %, 0.45 at −50 %, 0.1 at 0 %, 0.05 at +50 %. openDAW#524's answer: the
  engine is as intended; the corrected manual describes the matrix, which is the rule now.

## Status

**Standing regression check after SDK upgrades** (root CLAUDE.md, "Build & Verification"; the
current registers are the 2026-11-06 accept on 0.0.182, 380 rows; on the rule as it stands they read 357 holds / 0 deviations / 23 no rule per rate):
`?rows=all` at 48 kHz, then `?rate=44100`; expect every row `as-registered`, `as-registered,
matches-known-deviation …` or `no rule`. A `changed` row is the finding: read its first mismatch
against the crate before anything else. A `matches-known-deviation` the register lists is not a
finding; a deviation that stops showing (the row reads `changed, rule holds`) is a fix landing: retire
the deviation in the table above with the release. `--accept` only after a person's read; a broken
row needs `--force` and a line here naming it; so does a partial run, which then merges into the
register instead of replacing it, and only into a register of the same SDK, bpm and rate. An errored
row is never accepted, forced or not: it keeps its registered entry, or stays out of the register.

## Open items

- **Hold, Retrigger and the Arpeggio's step lanes are not judged.** The rule, the rows and the demos' cards leave them at
  their defaults. Nor are the Power, S-Curve, Random, Offset and Stack grooves: every Zeitgeist row runs the Global Shuffle.

- **`disabled-arpeggio` proves nothing.** The Arpeggio's non-identity (Up, 1 octave, 1/16, gate 0.5,
  velocity 1) reproduces the sixteenths exactly (one 120-pulse step at pitch 60 per grid line, the
  note's own velocity), so the row reads dry whether or not the engine skips the disabled device. A
  different non-identity would move the registered order rows; left for a release that changes them
  anyway. The guard test in `midiEffectSemanticsRows.test.ts` covers the Note Filter and Pitch stages.

- **Gate 2 and other true overlaps are tracked only.** A monophonic reader cannot judge two notes
  sounding at once; those rows and notes are in the register, so a change in what they render still
  reads `changed, no rule`, but no rule is checked on them (a read note outside every predicted span
  still reads `rule broken`).
- **The Pitch out-of-range drop** is taken as the rule (the crate documents it); the TS device passed
  the raw pitch.
- **A Zeitgeist before an Arpeggio composes approximately** (the warped note-off being the rule): the
  Arpeggio reads the unwarped duration off the note-on, and only an earlier warped note-off shortens
  the held span, so the real end is `min(warp(p) + d, warp(p + d))` where the rule passes
  `warp(p + d) − warp(p)`. The only such row, `order-zeitgeist-arpeggio` on the chords, has every
  start and end on a 480-pulse cell start, where the warp is the identity, so no row is affected.
- **What ends a note at the render's end** is not observed: the buffer ends there. The sequencer
  releases every retained note when a block is not playing or is discontinuous
  (`crates/engine-env/src/note_sequencer.rs:131-135`); no row puts a note across a transport stop.
- **The Zeitgeist clamps each warped position into the block's range** (`device-zeitgeist/src/lib.rs`,
  `process`). It pulls its upstream over the unwarped range, so a warped position falls inside the
  block by construction; no row reads a clamped event.
- **The register holds the reader's raw notes**, so abutting notes (the legato melody, gate 1) are in it
  as one merged span; each is judged by the rule through `readWindow`, and a change that keeps the rule
  holding (inside its tolerances) does not read `changed`.

## Tables

<details><summary>Accepted 48 kHz table, run 1793770618258 (the rules on the corrected manuals, judged against the
2026-11-03 register, so the 24 rows whose intent readability count moved read <code>changed</code>; the verdict
column is as judged before <code>arpeggio-uncapped-note-off</code> was retired later that day: its 35 rows read
<code>as-registered</code> on runs 1793772102826 / 1793772168668)</summary>

```
id | verdict | figure | read / readable (unreadable) | max |Δonset| ms | max |Δcents| | max |Δvel| | render ms
dry-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 403
dry-melody | as-registered | — | 1 / 0 (16) | — | — | — | 144
dry-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 127
dry-held-note | as-registered | — | 1 / 1 (0) | 0.00 | 0.0 | 0.000 | 125
arp-mode0-oct1-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 127
arp-mode0-oct2-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 142
arp-mode0-oct3-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 148
arp-mode0-oct4-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 147
arp-mode0-oct5-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 141
arp-mode1-oct1-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 131
arp-mode1-oct2-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 132
arp-mode1-oct3-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 130
arp-mode1-oct4-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 123
arp-mode1-oct5-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 122
arp-mode2-oct1-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 146
arp-mode2-oct2-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 149
arp-mode2-oct3-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 136
arp-mode2-oct4-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 125
arp-mode2-oct5-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 125
arp-mode0-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 130
arp-mode0-oct2-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 129
arp-mode0-oct3-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 128
arp-mode0-oct4-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 149
arp-mode0-oct5-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 150
arp-mode1-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 138
arp-mode1-oct2-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 127
arp-mode1-oct3-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 127
arp-mode1-oct4-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 128
arp-mode1-oct5-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 128
arp-mode2-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 134
arp-mode2-oct2-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 149
arp-mode2-oct3-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 150
arp-mode2-oct4-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 135
arp-mode2-oct5-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 128
arp-oct1-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 125
arp-oct2-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 125
arp-oct3-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 124
arp-oct4-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 123
arp-oct5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 146
arp-rate3-gate0.25-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 148
arp-rate3-gate0.5-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 132
arp-rate3-gate1-held-note | as-registered | — | 1 / 0 (2) | — | — | — | 126
arp-rate3-gate2-held-note | no rule | — | 1 / 0 (2) | — | — | — | 130
arp-rate6-gate0.25-held-note | as-registered | — | 4 / 4 (0) | 0.00 | 0.0 | 0.000 | 128
arp-rate6-gate0.5-held-note | as-registered | — | 4 / 4 (0) | 0.00 | 0.0 | 0.000 | 128
arp-rate6-gate1-held-note | as-registered | — | 1 / 0 (4) | — | — | — | 125
arp-rate6-gate2-held-note | no rule | — | 1 / 0 (4) | — | — | — | 149
arp-rate9-gate0.25-held-note | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 150
arp-rate9-gate0.5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 133
arp-rate9-gate1-held-note | as-registered | — | 1 / 0 (8) | — | — | — | 127
arp-rate9-gate2-held-note | no rule | — | 1 / 0 (8) | — | — | — | 126
arp-rate12-gate0.25-held-note | no rule | — | 15 / 0 (15) | — | — | — | 125
arp-rate12-gate0.5-held-note | as-registered | — | 15 / 15 (0) | 0.00 | 0.0 | 0.000 | 128
arp-rate12-gate1-held-note | as-registered | — | 1 / 0 (15) | — | — | — | 125
arp-rate12-gate2-held-note | no rule | — | 1 / 0 (15) | — | — | — | 151
arp-rate14-gate0.25-held-note | no rule | — | 30 / 0 (30) | — | — | — | 150
arp-rate14-gate0.5-held-note | no rule | — | 30 / 0 (30) | — | — | — | 131
arp-rate14-gate1-held-note | as-registered | — | 1 / 0 (30) | — | — | — | 128
arp-rate14-gate2-held-note | no rule | — | 1 / 0 (30) | — | — | — | 125
arp-rate2-gate0.25-held-note | as-registered | — | 2 / 2 (0) | 0.03 | 0.0 | 0.000 | 128
arp-rate2-gate0.5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 2 / 2 (0) | 0.03 | 0.0 | 0.000 | 124
arp-rate2-gate1-held-note | as-registered | — | 1 / 0 (2) | — | — | — | 127
arp-rate2-gate2-held-note | no rule | — | 1 / 0 (2) | — | — | — | 153
arp-rate8-gate0.25-held-note | as-registered | — | 6 / 6 (0) | 0.03 | 0.0 | 0.000 | 153
arp-rate8-gate0.5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 6 / 6 (0) | 0.03 | 0.0 | 0.000 | 132
arp-rate8-gate1-held-note | as-registered | — | 1 / 0 (6) | — | — | — | 125
arp-rate8-gate2-held-note | no rule | — | 1 / 0 (6) | — | — | — | 128
arp-rate4-gate0.25-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 125
arp-rate4-gate0.5-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 126
arp-rate4-gate1-held-note | as-registered | — | 1 / 0 (2) | — | — | — | 126
arp-rate4-gate2-held-note | no rule | — | 1 / 0 (2) | — | — | — | 154
arp-rate7-gate0.25-held-note | as-registered | — | 5 / 5 (0) | 0.00 | 0.0 | 0.000 | 152
arp-rate7-gate0.5-held-note | as-registered | — | 5 / 5 (0) | 0.00 | 0.0 | 0.000 | 128
arp-rate7-gate1-held-note | as-registered | — | 1 / 0 (5) | — | — | — | 127
arp-rate7-gate2-held-note | no rule | — | 1 / 0 (5) | — | — | — | 125
arp-repeat1-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 127
arp-repeat2-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 127
arp-repeat4-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 128
arp-repeat16-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 154
arp-mode0-oct2-gate1-held-chord | as-registered | — | 1 / 0 (8) | — | — | — | 157
arp-mode1-oct2-gate1-held-chord | as-registered | — | 1 / 0 (8) | — | — | — | 128
arp-mode2-oct2-gate1-held-chord | as-registered | — | 1 / 0 (8) | — | — | — | 128
arp-vel-1-held-chord | as-registered | — | 0 / 0 (0) | — | — | — | 123
arp-vel-1-held-note | as-registered | — | 0 / 0 (0) | — | — | — | 128
arp-vel-0.5-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 123
arp-vel-0.5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 127
arp-vel0-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 152
arp-vel0-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 152
arp-vel0.5-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 127
arp-vel0.5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 126
arp-vel1-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 126
arp-vel1-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 130
pitch-st-36-chromatic | no rule | — | 12 / 0 (12) | — | — | — | 125
pitch-st-12-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 131
pitch-st-7-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 157
pitch-st0-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 156
pitch-st7-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 130
pitch-st12-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 129
pitch-st36-chromatic | as-registered | — | 12 / 12 (0) | 0.10 | 0.0 | 0.000 | 130
pitch-oct-7-chromatic | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 126
pitch-oct-3-chromatic | no rule | — | 12 / 0 (12) | — | — | — | 129
pitch-oct-1-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 130
pitch-oct0-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 159
pitch-oct1-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 155
pitch-oct3-chromatic | as-registered | — | 12 / 12 (0) | 0.10 | 0.0 | 0.000 | 127
pitch-oct7-chromatic | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 127
pitch-ct-50-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 100.0 | 0.000 | 128
pitch-ct-12.5-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 128
pitch-ct0-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 128
pitch-ct12.5-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 130
pitch-ct50-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 100.0 | 0.000 | 157
pitch-combined-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 155
pitch-st-36-melody | as-registered | — | 1 / 0 (16) | — | — | — | 130
pitch-st-12-melody | as-registered | — | 1 / 0 (16) | — | — | — | 129
pitch-st-7-melody | as-registered | — | 1 / 0 (16) | — | — | — | 133
pitch-st0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 130
pitch-st7-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
pitch-st12-melody | as-registered | — | 1 / 0 (16) | — | — | — | 129
pitch-st36-melody | as-registered | — | 1 / 0 (16) | — | — | — | 160
pitch-oct-7-melody | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 159
pitch-oct-3-melody | as-registered | — | 1 / 0 (16) | — | — | — | 129
pitch-oct-1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 130
pitch-oct0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 129
pitch-oct1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
pitch-oct3-melody | as-registered | — | 1 / 0 (16) | — | — | — | 130
pitch-oct7-melody | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 128
pitch-ct-50-melody | as-registered | — | 1 / 0 (16) | — | — | — | 160
pitch-ct-12.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 156
pitch-ct0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 128
pitch-ct12.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 130
pitch-ct50-melody | as-registered | — | 1 / 0 (16) | — | — | — | 129
pitch-combined-melody | as-registered | — | 1 / 0 (16) | — | — | — | 133
vel-magnet0x0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 132
vel-magnet0x0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 137
vel-magnet0x1-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 161
vel-magnet0.5x0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 154
vel-magnet0.5x0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 131
vel-magnet0.5x1-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 134
vel-magnet1x0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 131
vel-magnet1x0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 131
vel-magnet1x1-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 130
vel-random0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 133
vel-random0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.002 | 164
vel-random1-sixteenths | as-registered | — | 29 / 29 (0) | 0.30 | 0.0 | 0.002 | 155
vel-offset-1-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 130
vel-offset-0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 133
vel-offset0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 132
vel-offset0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 133
vel-mix0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 132
vel-mix0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 132
vel-mix1-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 166
vel-magnet0x0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 154
vel-magnet0x0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 128
vel-magnet0x1-melody | as-registered | — | 0 / 0 (0) | — | — | — | 129
vel-magnet0.5x0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 131
vel-magnet0.5x0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 129
vel-magnet0.5x1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
vel-magnet1x0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
vel-magnet1x0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 166
vel-magnet1x1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 152
vel-random0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 130
vel-random0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 133
vel-random1-melody | as-registered | — | 3 / 0 (13) | — | — | — | 130
vel-offset-1-melody | as-registered | — | 0 / 0 (0) | — | — | — | 130
vel-offset-0.5-melody | as-registered | — | 2 / 0 (12) | — | — | — | 130
vel-offset0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 144
vel-offset0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 171
vel-mix0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 155
vel-mix0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 133
vel-mix1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 133
zg-amount0-dur480-sixteenths | no rule | — | 16 / 0 (32) | — | — | — | 134
zg-amount0-dur960-sixteenths | changed, rule holds | unreadable 24 expected 32 | 16 / 8 (24) | — | — | — | 131
zg-amount0-dur1920-sixteenths | changed, rule holds | unreadable 28 expected 32 | 16 / 4 (28) | — | — | — | 130
zg-amount0-dur3840-sixteenths | changed, rule holds | unreadable 26 expected 30 | 16 / 6 (26) | — | — | — | 135
zg-amount0-dur7680-sixteenths | changed, rule holds | unreadable 27 expected 29 | 16 / 5 (27) | — | — | — | 169
zg-amount0-dur15360-sixteenths | no rule | — | 15 / 0 (32) | — | — | — | 155
zg-amount0-dur30720-sixteenths | no rule | — | 1 / 0 (32) | — | — | — | 129
zg-amount0-dur61440-sixteenths | no rule | — | 1 / 0 (32) | — | — | — | 136
zg-amount0.25-dur480-sixteenths | changed, rule holds | unreadable 0 expected 32 | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 131
zg-amount0.25-dur960-sixteenths | changed, rule holds | unreadable 0 expected 16 | 32 / 32 (0) | 0.01 | 0.0 | 0.000 | 130
zg-amount0.25-dur1920-sixteenths | changed, rule holds | unreadable 0 expected 12 | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 133
zg-amount0.25-dur3840-sixteenths | changed, rule holds | unreadable 0 expected 12 | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 132
zg-amount0.25-dur7680-sixteenths | changed, rule holds | unreadable 0 expected 10 | 32 / 32 (0) | 0.06 | 0.0 | 0.000 | 168
zg-amount0.25-dur15360-sixteenths | changed, rule holds | unreadable 0 expected 4 | 32 / 32 (0) | 0.06 | 0.0 | 0.000 | 154
zg-amount0.25-dur30720-sixteenths | changed, rule holds | unreadable 0 expected 22 | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 132
zg-amount0.25-dur61440-sixteenths | changed, rule holds | unreadable 0 expected 32 | 32 / 32 (0) | 0.07 | 0.0 | 0.000 | 133
zg-amount0.5-dur480-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 134
zg-amount0.5-dur960-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 133
zg-amount0.5-dur1920-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 133
zg-amount0.5-dur3840-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 134
zg-amount0.5-dur7680-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 169
zg-amount0.5-dur15360-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 152
zg-amount0.5-dur30720-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 131
zg-amount0.5-dur61440-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 133
zg-amount0.75-dur480-sixteenths | changed, rule holds | unreadable 0 expected 30 | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 133
zg-amount0.75-dur960-sixteenths | changed, rule holds | unreadable 0 expected 14 | 32 / 32 (0) | 0.01 | 0.0 | 0.000 | 135
zg-amount0.75-dur1920-sixteenths | changed, rule holds | unreadable 0 expected 11 | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 133
zg-amount0.75-dur3840-sixteenths | changed, rule holds | unreadable 0 expected 11 | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 132
zg-amount0.75-dur7680-sixteenths | changed, rule holds | unreadable 0 expected 10 | 26 / 26 (0) | 0.06 | 0.0 | 0.000 | 171
zg-amount0.75-dur15360-sixteenths | as-registered | — | 20 / 19 (1) | — | — | — | 154
zg-amount0.75-dur30720-sixteenths | as-registered | — | 8 / 7 (1) | — | — | — | 131
zg-amount0.75-dur61440-sixteenths | as-registered | — | 4 / 4 (0) | 0.04 | 0.0 | 0.000 | 131
zg-amount1-dur480-sixteenths | changed, rule holds | unreadable 31 expected 30 | 17 / 1 (31) | — | — | — | 133
zg-amount1-dur960-sixteenths | as-registered | — | 17 / 1 (31) | — | — | — | 135
zg-amount1-dur1920-sixteenths | changed, rule holds | unreadable 27 expected 31 | 17 / 5 (27) | — | — | — | 136
zg-amount1-dur3840-sixteenths | changed, rule holds | unreadable 27 expected 29 | 16 / 5 (27) | — | — | — | 135
zg-amount1-dur7680-sixteenths | as-registered | — | 1 / 0 (17) | — | — | — | 176
zg-amount1-dur15360-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 150
zg-amount1-dur30720-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 131
zg-amount1-dur61440-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 131
zg-amount0-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
zg-amount0-dur3840-melody | as-registered | — | 1 / 0 (16) | — | — | — | 134
zg-amount0.25-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
zg-amount0.25-dur3840-melody | changed, rule holds | unreadable 16 expected 12 | 1 / 0 (16) | — | — | — | 134
zg-amount0.5-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 171
zg-amount0.5-dur3840-melody | as-registered | — | 1 / 0 (16) | — | — | — | 155
zg-amount0.75-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
zg-amount0.75-dur3840-melody | changed, rule holds | unreadable 16 expected 11 | 1 / 0 (16) | — | — | — | 135
zg-amount1-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 134
zg-amount1-dur3840-melody | changed, rule holds | unreadable 16 expected 15 | 1 / 0 (16) | — | — | — | 132
order-arpeggio-zeitgeist | changed, rule holds | unreadable 0 expected 30 | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 133
order-zeitgeist-arpeggio | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 173
order-pitch-arpeggio | as-registered, matches-known-deviation arpeggio-drops-cent | — | 32 / 32 (0) | 0.00 | 12.5 | 0.000 | 153
order-arpeggio-pitch | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 133
order-velocity-arpeggio | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 132
order-arpeggio-velocity | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 133
disabled-arpeggio | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 135
disabled-pitch | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 140
disabled-velocity | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 188
disabled-zeitgeist | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 157
run 1793770618258 (2026-11-04T05:36:58.258Z) | sdk 0.0.180 | 48000 Hz | 120 bpm | reference peak 0.7078585456111496 | instrument offset 6 frames | register /debug/2026-11-03-midi-effect-semantics/register/48000.json | rows 230 | holds 176 deviation 36 broken 0 none 18 error 0 | as-registered 206 changed 24 unregistered 0
```

</details>

Accepted 44.1 kHz, run 1793770665002: every row read the same verdict as at 48 kHz;
`register/44100.json` holds its figures.

```
run 1793770665002 (2026-11-04T05:37:45.002Z) | sdk 0.0.180 | 44100 Hz | 120 bpm | reference peak 0.7078102259681298 | instrument offset 6 frames | register /debug/2026-11-03-midi-effect-semantics/register/44100.json | rows 230 | holds 176 deviation 36 broken 0 none 18 error 0 | as-registered 206 changed 24 unregistered 0
```

The 2026-11-03 tables (runs 1793744029767 and 1793744117203, on the rules before the manuals were
corrected) and the first registers' (runs 1793741953204 and 1793742021509) are in this note's history.

### 2026-11-06, SDK 0.0.182 (Chrome 156, macOS, the Mac's output device at 44.1 kHz)

The re-run against the registers accepted that day; 44.1 kHz reads the same verdict in every row (run 1793987550884). What the release changed and what was read is in the Runs section.

<details><summary>48 kHz table, run 1793987489846 (380 rows)</summary>

```
id | verdict | figure | read / readable (unreadable) | max |Δonset| ms | max |Δcents| | max |Δvel| | render ms
dry-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 158
dry-melody | as-registered | — | 1 / 0 (16) | — | — | — | 143
dry-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 142
dry-held-note | as-registered | — | 1 / 1 (0) | 0.00 | 0.0 | 0.000 | 133
arp-mode0-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 134
arp-mode0-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 134
arp-mode0-oct3-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 138
arp-mode0-oct4-held-chord | as-registered | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 167
arp-mode0-oct5-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 160
arp-mode1-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 136
arp-mode1-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 136
arp-mode1-oct3-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 135
arp-mode1-oct4-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 137
arp-mode1-oct5-held-chord | as-registered | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 136
arp-mode2-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 171
arp-mode2-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 155
arp-mode2-oct3-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 135
arp-mode2-oct4-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 137
arp-mode2-oct5-held-chord | as-registered | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 134
arp-mode0-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 136
arp-mode0-oct2-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 138
arp-mode0-oct3-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 171
arp-mode0-oct4-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 160
arp-mode0-oct5-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 133
arp-mode1-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 136
arp-mode1-oct2-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 136
arp-mode1-oct3-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 136
arp-mode1-oct4-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 136
arp-mode1-oct5-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 173
arp-mode2-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 152
arp-mode2-oct2-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 137
arp-mode2-oct3-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 136
arp-mode2-oct4-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 137
arp-mode2-oct5-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 135
arp-oct1-held-note | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 135
arp-oct2-held-note | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 174
arp-oct3-held-note | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 153
arp-oct4-held-note | as-registered | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 133
arp-oct5-held-note | as-registered | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 135
arp-rate3-gate0.25-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 136
arp-rate3-gate0.5-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 136
arp-rate3-gate1-held-note | as-registered | — | 1 / 0 (2) | — | — | — | 137
arp-rate3-gate2-held-note | no rule | — | 1 / 0 (2) | — | — | — | 171
arp-rate6-gate0.25-held-note | as-registered | — | 4 / 4 (0) | 0.00 | 0.0 | 0.000 | 153
arp-rate6-gate0.5-held-note | as-registered | — | 4 / 4 (0) | 0.00 | 0.0 | 0.000 | 135
arp-rate6-gate1-held-note | as-registered | — | 1 / 0 (4) | — | — | — | 134
arp-rate6-gate2-held-note | no rule | — | 1 / 0 (4) | — | — | — | 134
arp-rate9-gate0.25-held-note | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 135
arp-rate9-gate0.5-held-note | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 136
arp-rate9-gate1-held-note | as-registered | — | 1 / 0 (8) | — | — | — | 174
arp-rate9-gate2-held-note | no rule | — | 1 / 0 (8) | — | — | — | 151
arp-rate12-gate0.25-held-note | no rule | — | 15 / 0 (15) | — | — | — | 136
arp-rate12-gate0.5-held-note | as-registered | — | 15 / 15 (0) | 0.00 | 0.0 | 0.000 | 137
arp-rate12-gate1-held-note | as-registered | — | 1 / 0 (15) | — | — | — | 138
arp-rate12-gate2-held-note | no rule | — | 1 / 0 (15) | — | — | — | 136
arp-rate14-gate0.25-held-note | no rule | — | 30 / 0 (30) | — | — | — | 136
arp-rate14-gate0.5-held-note | no rule | — | 30 / 0 (30) | — | — | — | 176
arp-rate14-gate1-held-note | as-registered | — | 1 / 0 (30) | — | — | — | 154
arp-rate14-gate2-held-note | no rule | — | 1 / 0 (30) | — | — | — | 141
arp-rate2-gate0.25-held-note | as-registered | — | 2 / 2 (0) | 0.03 | 0.0 | 0.000 | 136
arp-rate2-gate0.5-held-note | as-registered | — | 2 / 2 (0) | 0.03 | 0.0 | 0.000 | 137
arp-rate2-gate1-held-note | as-registered | — | 1 / 0 (2) | — | — | — | 136
arp-rate2-gate2-held-note | no rule | — | 1 / 0 (2) | — | — | — | 150
arp-rate8-gate0.25-held-note | as-registered | — | 6 / 6 (0) | 0.03 | 0.0 | 0.000 | 178
arp-rate8-gate0.5-held-note | as-registered | — | 6 / 6 (0) | 0.03 | 0.0 | 0.000 | 152
arp-rate8-gate1-held-note | as-registered | — | 1 / 0 (6) | — | — | — | 137
arp-rate8-gate2-held-note | no rule | — | 1 / 0 (6) | — | — | — | 136
arp-rate4-gate0.25-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 136
arp-rate4-gate0.5-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 137
arp-rate4-gate1-held-note | as-registered | — | 1 / 0 (2) | — | — | — | 136
arp-rate4-gate2-held-note | no rule | — | 1 / 0 (2) | — | — | — | 172
arp-rate7-gate0.25-held-note | as-registered | — | 5 / 5 (0) | 0.00 | 0.0 | 0.000 | 152
arp-rate7-gate0.5-held-note | as-registered | — | 5 / 5 (0) | 0.00 | 0.0 | 0.000 | 136
arp-rate7-gate1-held-note | as-registered | — | 1 / 0 (5) | — | — | — | 134
arp-rate7-gate2-held-note | no rule | — | 1 / 0 (5) | — | — | — | 136
arp-repeat1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 147
arp-repeat2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 139
arp-repeat4-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 176
arp-repeat16-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 150
arp-mode0-oct2-gate1-held-chord | as-registered | — | 1 / 0 (8) | — | — | — | 140
arp-mode1-oct2-gate1-held-chord | as-registered | — | 1 / 0 (8) | — | — | — | 137
arp-mode2-oct2-gate1-held-chord | as-registered | — | 1 / 0 (8) | — | — | — | 138
arp-vel-1-held-chord | as-registered | — | 0 / 0 (0) | — | — | — | 135
arp-vel-1-held-note | as-registered | — | 0 / 0 (0) | — | — | — | 138
arp-vel-0.5-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 178
arp-vel-0.5-held-note | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 151
arp-vel0-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 136
arp-vel0-held-note | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 136
arp-vel0.5-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 142
arp-vel0.5-held-note | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 136
arp-vel1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 139
arp-vel1-held-note | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 177
arp-mode3-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 155
arp-mode3-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode3-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 139
arp-mode4-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 139
arp-mode4-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 137
arp-mode4-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 138
arp-mode5-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 179
arp-mode5-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 153
arp-mode5-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 144
arp-mode6-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 148
arp-mode6-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 138
arp-mode6-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 141
arp-mode7-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 141
arp-mode7-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 178
arp-mode7-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 151
arp-mode8-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode8-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 145
arp-mode8-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode9-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode9-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 138
arp-mode9-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 181
arp-mode10-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 152
arp-mode10-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 138
arp-mode10-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode11-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode11-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 138
arp-mode11-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 137
arp-mode12-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 185
arp-mode12-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 153
arp-mode12-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 141
arp-mode13-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 139
arp-mode13-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode13-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 139
arp-mode14-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 138
arp-mode14-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 185
arp-mode14-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 152
arp-mode15-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode15-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode15-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode16-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 143
arp-mode16-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 139
arp-mode16-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 183
arp-mode17-oct1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 150
arp-mode17-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 139
arp-mode17-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 141
arp-mode13-seed1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 139
arp-mode13-seed999999-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 141
arp-mode14-seed1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 143
arp-mode14-seed999999-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 186
arp-mode15-seed1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 154
arp-mode15-seed999999-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 139
arp-mode16-seed1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 157
arp-mode16-seed999999-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 143
arp-mode17-seed1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode17-seed999999-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 141
arp-order0-held-rolled | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 197
arp-order1-held-rolled | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 152
arp-offset1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 139
arp-offset2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 140
arp-offset7-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 141
arp-offset15-oct2-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 141
arp-repeat2-offset1-held-chord | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 142
pitch-st-36-chromatic | no rule | — | 12 / 0 (12) | — | — | — | 188
pitch-st-12-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 153
pitch-st-7-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 142
pitch-st0-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 148
pitch-st7-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 140
pitch-st12-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 148
pitch-st36-chromatic | as-registered | — | 12 / 12 (0) | 0.10 | 0.0 | 0.000 | 139
pitch-oct-7-chromatic | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 183
pitch-oct-3-chromatic | no rule | — | 12 / 0 (12) | — | — | — | 151
pitch-oct-1-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 145
pitch-oct0-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 146
pitch-oct1-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 145
pitch-oct3-chromatic | as-registered | — | 12 / 12 (0) | 0.10 | 0.0 | 0.000 | 143
pitch-oct7-chromatic | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 141
pitch-ct-50-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 100.0 | 0.000 | 191
pitch-ct-12.5-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 151
pitch-ct0-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 139
pitch-ct12.5-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 141
pitch-ct50-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 100.0 | 0.000 | 140
pitch-combined-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 138
pitch-st-36-melody | as-registered | — | 1 / 0 (16) | — | — | — | 140
pitch-st-12-melody | as-registered | — | 1 / 0 (16) | — | — | — | 190
pitch-st-7-melody | as-registered | — | 1 / 0 (16) | — | — | — | 152
pitch-st0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 142
pitch-st7-melody | as-registered | — | 1 / 0 (16) | — | — | — | 141
pitch-st12-melody | as-registered | — | 1 / 0 (16) | — | — | — | 146
pitch-st36-melody | as-registered | — | 1 / 0 (16) | — | — | — | 147
pitch-oct-7-melody | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 143
pitch-oct-3-melody | as-registered | — | 1 / 0 (16) | — | — | — | 192
pitch-oct-1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 152
pitch-oct0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 141
pitch-oct1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 144
pitch-oct3-melody | as-registered | — | 1 / 0 (16) | — | — | — | 140
pitch-oct7-melody | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 140
pitch-ct-50-melody | as-registered | — | 1 / 0 (16) | — | — | — | 142
pitch-ct-12.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 194
pitch-ct0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 152
pitch-ct12.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 155
pitch-ct50-melody | as-registered | — | 1 / 0 (16) | — | — | — | 141
pitch-combined-melody | as-registered | — | 1 / 0 (16) | — | — | — | 143
vel-magnet0x0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 144
vel-magnet0x0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 146
vel-magnet0x1-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 199
vel-magnet0.5x0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 154
vel-magnet0.5x0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 149
vel-magnet0.5x1-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 145
vel-magnet1x0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 148
vel-magnet1x0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 146
vel-magnet1x1-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 151
vel-random0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 201
vel-random0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.002 | 149
vel-random1-sixteenths | as-registered | — | 29 / 29 (0) | 0.30 | 0.0 | 0.002 | 142
vel-offset-1-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 140
vel-offset-0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 143
vel-offset0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 143
vel-offset0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 144
vel-mix0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 198
vel-mix0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 154
vel-mix1-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 144
vel-magnet0x0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 145
vel-magnet0x0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 142
vel-magnet0x1-melody | as-registered | — | 0 / 0 (0) | — | — | — | 142
vel-magnet0.5x0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 148
vel-magnet0.5x0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 198
vel-magnet0.5x1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 164
vel-magnet1x0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 146
vel-magnet1x0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 143
vel-magnet1x1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 143
vel-random0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 143
vel-random0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 145
vel-random1-melody | as-registered | — | 3 / 0 (13) | — | — | — | 202
vel-offset-1-melody | as-registered | — | 0 / 0 (0) | — | — | — | 148
vel-offset-0.5-melody | as-registered | — | 2 / 0 (12) | — | — | — | 146
vel-offset0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 146
vel-offset0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 144
vel-mix0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 145
vel-mix0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 145
vel-mix1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 200
zg-amount0-dur160-sixteenths | as-registered | — | 32 / 16 (16) | — | — | — | 149
zg-amount0-dur240-sixteenths | no rule | — | 32 / 0 (32) | — | — | — | 146
zg-amount0-dur320-sixteenths | as-registered | — | 24 / 0 (32) | — | — | — | 147
zg-amount0-dur480-sixteenths | no rule | — | 16 / 0 (32) | — | — | — | 149
zg-amount0-dur640-sixteenths | as-registered | — | 20 / 4 (28) | — | — | — | 151
zg-amount0-dur720-sixteenths | no rule | — | 22 / 0 (32) | — | — | — | 147
zg-amount0-dur960-sixteenths | as-registered | — | 16 / 8 (24) | — | — | — | 202
zg-amount0-dur1280-sixteenths | as-registered | — | 16 / 4 (28) | — | — | — | 148
zg-amount0-dur1440-sixteenths | as-registered | — | 17 / 6 (26) | — | — | — | 145
zg-amount0-dur1920-sixteenths | as-registered | — | 16 / 4 (28) | — | — | — | 145
zg-amount0-dur2880-sixteenths | as-registered | — | 18 / 6 (26) | — | — | — | 144
zg-amount0-dur3840-sixteenths | as-registered | — | 16 / 6 (26) | — | — | — | 150
zg-amount0-dur7680-sixteenths | as-registered | — | 16 / 5 (27) | — | — | — | 144
zg-amount0-dur11520-sixteenths | as-registered | — | 23 / 8 (24) | — | — | — | 202
zg-amount0-dur15360-sixteenths | no rule | — | 15 / 0 (32) | — | — | — | 150
zg-amount0-dur23040-sixteenths | no rule | — | 1 / 0 (32) | — | — | — | 145
zg-amount0-dur30720-sixteenths | no rule | — | 1 / 0 (32) | — | — | — | 147
zg-amount0-dur46080-sixteenths | no rule | — | 1 / 0 (32) | — | — | — | 146
zg-amount0-dur61440-sixteenths | no rule | — | 1 / 0 (32) | — | — | — | 144
zg-amount0.25-dur160-sixteenths | as-registered | — | 32 / 32 (0) | 0.02 | 0.0 | 0.000 | 145
zg-amount0.25-dur240-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 202
zg-amount0.25-dur320-sixteenths | as-registered | — | 32 / 32 (0) | 0.07 | 0.0 | 0.000 | 149
zg-amount0.25-dur480-sixteenths | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 150
zg-amount0.25-dur640-sixteenths | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 146
zg-amount0.25-dur720-sixteenths | as-registered | — | 32 / 32 (0) | 0.01 | 0.0 | 0.000 | 149
zg-amount0.25-dur960-sixteenths | as-registered | — | 32 / 32 (0) | 0.01 | 0.0 | 0.000 | 148
zg-amount0.25-dur1280-sixteenths | as-registered | — | 32 / 32 (0) | 0.07 | 0.0 | 0.000 | 147
zg-amount0.25-dur1440-sixteenths | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 202
zg-amount0.25-dur1920-sixteenths | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 152
zg-amount0.25-dur2880-sixteenths | as-registered | — | 32 / 32 (0) | 0.06 | 0.0 | 0.000 | 149
zg-amount0.25-dur3840-sixteenths | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 145
zg-amount0.25-dur7680-sixteenths | as-registered | — | 32 / 32 (0) | 0.06 | 0.0 | 0.000 | 149
zg-amount0.25-dur11520-sixteenths | as-registered | — | 32 / 32 (0) | 0.07 | 0.0 | 0.000 | 145
zg-amount0.25-dur15360-sixteenths | as-registered | — | 32 / 32 (0) | 0.06 | 0.0 | 0.000 | 145
zg-amount0.25-dur23040-sixteenths | as-registered | — | 32 / 32 (0) | 0.07 | 0.0 | 0.000 | 203
zg-amount0.25-dur30720-sixteenths | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 144
zg-amount0.25-dur46080-sixteenths | as-registered | — | 32 / 32 (0) | 0.06 | 0.0 | 0.000 | 147
zg-amount0.25-dur61440-sixteenths | as-registered | — | 32 / 32 (0) | 0.07 | 0.0 | 0.000 | 146
zg-amount0.5-dur160-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 147
zg-amount0.5-dur240-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 146
zg-amount0.5-dur320-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 150
zg-amount0.5-dur480-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 206
zg-amount0.5-dur640-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 148
zg-amount0.5-dur720-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 149
zg-amount0.5-dur960-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 148
zg-amount0.5-dur1280-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 145
zg-amount0.5-dur1440-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 149
zg-amount0.5-dur1920-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 152
zg-amount0.5-dur2880-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 205
zg-amount0.5-dur3840-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 150
zg-amount0.5-dur7680-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 149
zg-amount0.5-dur11520-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 153
zg-amount0.5-dur15360-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 149
zg-amount0.5-dur23040-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 149
zg-amount0.5-dur30720-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 149
zg-amount0.5-dur46080-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 206
zg-amount0.5-dur61440-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 150
zg-amount0.75-dur160-sixteenths | as-registered | — | 32 / 32 (0) | 0.02 | 0.0 | 0.000 | 152
zg-amount0.75-dur240-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 146
zg-amount0.75-dur320-sixteenths | as-registered | — | 32 / 32 (0) | 0.04 | 0.0 | 0.000 | 145
zg-amount0.75-dur480-sixteenths | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 147
zg-amount0.75-dur640-sixteenths | as-registered | — | 32 / 32 (0) | 0.07 | 0.0 | 0.000 | 146
zg-amount0.75-dur720-sixteenths | as-registered | — | 32 / 32 (0) | 0.01 | 0.0 | 0.000 | 204
zg-amount0.75-dur960-sixteenths | as-registered | — | 32 / 32 (0) | 0.01 | 0.0 | 0.000 | 147
zg-amount0.75-dur1280-sixteenths | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 147
zg-amount0.75-dur1440-sixteenths | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 148
zg-amount0.75-dur1920-sixteenths | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 149
zg-amount0.75-dur2880-sixteenths | as-registered | — | 32 / 32 (0) | 0.07 | 0.0 | 0.000 | 150
zg-amount0.75-dur3840-sixteenths | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 149
zg-amount0.75-dur7680-sixteenths | as-registered | — | 26 / 26 (0) | 0.06 | 0.0 | 0.000 | 207
zg-amount0.75-dur11520-sixteenths | as-registered | — | 32 / 32 (0) | 0.07 | 0.0 | 0.000 | 148
zg-amount0.75-dur15360-sixteenths | as-registered | — | 20 / 19 (1) | — | — | — | 148
zg-amount0.75-dur23040-sixteenths | as-registered | — | 11 / 10 (1) | — | — | — | 147
zg-amount0.75-dur30720-sixteenths | as-registered | — | 8 / 7 (1) | — | — | — | 150
zg-amount0.75-dur46080-sixteenths | as-registered | — | 5 / 5 (0) | 0.04 | 0.0 | 0.000 | 148
zg-amount0.75-dur61440-sixteenths | as-registered | — | 4 / 4 (0) | 0.04 | 0.0 | 0.000 | 149
zg-amount1-dur160-sixteenths | as-registered | — | 17 / 2 (30) | — | — | — | 215
zg-amount1-dur240-sixteenths | as-registered | — | 1 / 0 (32) | — | — | — | 147
zg-amount1-dur320-sixteenths | as-registered | — | 17 / 0 (32) | — | — | — | 147
zg-amount1-dur480-sixteenths | as-registered | — | 17 / 1 (31) | — | — | — | 146
zg-amount1-dur640-sixteenths | as-registered | — | 17 / 1 (31) | — | — | — | 149
zg-amount1-dur720-sixteenths | as-registered | — | 11 / 0 (32) | — | — | — | 148
zg-amount1-dur960-sixteenths | as-registered | — | 17 / 1 (31) | — | — | — | 147
zg-amount1-dur1280-sixteenths | as-registered | — | 17 / 5 (27) | — | — | — | 206
zg-amount1-dur1440-sixteenths | as-registered | — | 16 / 0 (32) | — | — | — | 148
zg-amount1-dur1920-sixteenths | as-registered | — | 17 / 5 (27) | — | — | — | 149
zg-amount1-dur2880-sixteenths | as-registered | — | 12 / 2 (30) | — | — | — | 148
zg-amount1-dur3840-sixteenths | as-registered | — | 16 / 5 (27) | — | — | — | 147
zg-amount1-dur7680-sixteenths | as-registered | — | 1 / 0 (17) | — | — | — | 149
zg-amount1-dur11520-sixteenths | no rule | — | 8 / 0 (32) | — | — | — | 148
zg-amount1-dur15360-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 210
zg-amount1-dur23040-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 148
zg-amount1-dur30720-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 148
zg-amount1-dur46080-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 150
zg-amount1-dur61440-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 146
zg-amount0-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 153
zg-amount0-dur3840-melody | as-registered | — | 1 / 0 (16) | — | — | — | 149
zg-amount0.25-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 207
zg-amount0.25-dur3840-melody | as-registered | — | 1 / 0 (16) | — | — | — | 150
zg-amount0.5-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 149
zg-amount0.5-dur3840-melody | as-registered | — | 1 / 0 (16) | — | — | — | 149
zg-amount0.75-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 150
zg-amount0.75-dur3840-melody | as-registered | — | 1 / 0 (16) | — | — | — | 150
zg-amount1-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 149
zg-amount1-dur3840-melody | as-registered | — | 1 / 0 (16) | — | — | — | 206
nf-range0-127-melody-gaps | as-registered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 146
nf-range62-67-melody-gaps | as-registered | — | 10 / 10 (0) | 0.00 | 0.0 | 0.002 | 149
nf-range65-127-melody-gaps | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.002 | 147
nf-range0-64-melody-gaps | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.001 | 149
nf-range64-64-melody-gaps | as-registered | — | 4 / 4 (0) | 0.00 | 0.0 | 0.001 | 151
nf-range67-62-melody-gaps | as-registered | — | 0 / 0 (0) | — | — | — | 146
nf-range60-127-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 206
nf-range61-127-chromatic | as-registered | — | 11 / 11 (0) | 0.00 | 0.0 | 0.000 | 148
nf-range0-71-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 150
nf-range0-70-chromatic | as-registered | — | 11 / 11 (0) | 0.00 | 0.0 | 0.000 | 148
nf-tr-12-melody-gaps | as-registered | — | 16 / 16 (0) | 0.10 | 0.0 | 0.002 | 151
nf-tr-7-melody-gaps | as-registered | — | 16 / 16 (0) | 0.10 | 0.0 | 0.002 | 149
nf-tr-1-melody-gaps | as-registered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 153
nf-tr0-melody-gaps | as-registered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 212
nf-tr1-melody-gaps | as-registered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 152
nf-tr7-melody-gaps | as-registered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 150
nf-tr12-melody-gaps | as-registered | — | 16 / 16 (0) | 0.10 | 0.0 | 0.002 | 152
nf-tr24-melody-gaps | as-registered | — | 16 / 16 (0) | 0.10 | 0.0 | 0.002 | 149
nf-tr68-chromatic | as-registered | — | 0 / 0 (0) | — | — | — | 149
nf-tr-72-chromatic | as-registered | — | 0 / 0 (0) | — | — | — | 149
nf-set-key48-melody-gaps | as-registered | — | 16 / 16 (0) | 0.10 | 0.0 | 0.002 | 211
nf-set-key48-sixteenths | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 158
nf-set-key60-melody-gaps | as-registered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 151
nf-set-key60-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 149
nf-set-key72-melody-gaps | as-registered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 147
nf-set-key72-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 148
nf-set-key72-range62-67-melody-gaps | as-registered | — | 10 / 10 (0) | 0.00 | 0.0 | 0.002 | 148
nf-set-key72-tr7-melody-gaps | as-registered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 209
order-arpeggio-zeitgeist | as-registered | — | 32 / 32 (0) | 0.05 | 0.0 | 0.000 | 150
order-zeitgeist-arpeggio | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 150
order-pitch-arpeggio | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 151
order-arpeggio-pitch | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 151
order-velocity-arpeggio | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 152
order-arpeggio-velocity | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 151
order-pitch-note-filter | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 210
order-note-filter-pitch | as-registered | — | 10 / 10 (0) | 0.00 | 0.0 | 0.002 | 150
order-arpeggio-note-filter | as-registered | — | 11 / 11 (0) | 0.00 | 0.0 | 0.000 | 153
order-note-filter-arpeggio | as-registered | — | 24 / 24 (0) | 0.00 | 0.0 | 0.000 | 152
disabled-arpeggio | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 153
disabled-pitch | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 151
disabled-velocity | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 153
disabled-zeitgeist | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 213
disabled-note-filter | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 150
run 1793987489846 (2026-11-06T17:51:29.846Z) | sdk 0.0.182 | 48000 Hz | 120 bpm | reference peak 0.7078585456111496 | instrument offset 6 frames | register /debug/2026-11-03-midi-effect-semantics/register/48000.json | rows 380 | holds 357 deviation 0 broken 0 none 23 error 0 | as-registered 380 changed 0 unregistered 0
```

</details>

### 2026-11-04, SDK 0.0.181 (Chrome 156, macOS, the Mac's output device at 44.1 kHz)

The upgrade's standing run, before any repo change but the bump, against the registers accepted on
0.0.180. The release changes the Nano (Mono/Poly, Pan, One-Shot, Fixed pitch, voice stealing at 64,
a 5 ms choke fade; the defaults keep the old sound) and the Arpeggio (`release_all` when it leaves
the chain, the discontinuous-block release shared with it); Pitch, Velocity, Zeitgeist and the
wiring fold are untouched (`device_pitch.wasm`, `device_velocity.wasm`, `device_zeitgeist.wasm`
byte-identical; `engine.wasm`, `device_arpeggio.wasm`, `device_nano.wasm` changed).

| rate | run | `as-registered` | `as-registered, matches-known-deviation …` | `no rule` | `changed` | `error` |
|---|---|---|---|---|---|---|
| 48 kHz | 1793808711783 | 211 | 1 (`arpeggio-drops-cent`, `order-pitch-arpeggio`) | 18 | 0 | 0 |
| 44.1 kHz | 1793808780528 | 211 | 1 (the same row) | 18 | 0 | 0 |

No row changed; reference peak 0.7079 / 0.7078, instrument offset 6 frames, as on 0.0.180. The
maintainer answered openDAW#526 the same morning: the dropped cent was a mistake and the fix ships
with the next release, so `arpeggio-drops-cent` stays until `order-pitch-arpeggio` reads `changed,
rule holds` there (the installed crate still emits `cent: 0.0`, `lib.rs:310`).

<details><summary>The 33 Note Filter rows at 48 kHz, run 1793823134245 (accepted 2026-11-04; the 230 earlier rows read as the 0.0.181 block above, and the 44.1 kHz run 1793823187726 reads the same verdict on every row)</summary>

```
id | verdict | figure | read / readable (unreadable) | max |Δonset| ms | max |Δcents| | max |Δvel| | render ms
nf-range0-127-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 136
nf-range62-67-melody-gaps | rule holds, unregistered | — | 10 / 10 (0) | 0.00 | 0.0 | 0.002 | 135
nf-range65-127-melody-gaps | rule holds, unregistered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.002 | 180
nf-range0-64-melody-gaps | rule holds, unregistered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.001 | 153
nf-range64-64-melody-gaps | rule holds, unregistered | — | 4 / 4 (0) | 0.00 | 0.0 | 0.001 | 134
nf-range67-62-melody-gaps | rule holds, unregistered | — | 0 / 0 (0) | — | — | — | 136
nf-range60-127-chromatic | rule holds, unregistered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 135
nf-range61-127-chromatic | rule holds, unregistered | — | 11 / 11 (0) | 0.00 | 0.0 | 0.000 | 134
nf-range0-71-chromatic | rule holds, unregistered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 139
nf-range0-70-chromatic | rule holds, unregistered | — | 11 / 11 (0) | 0.00 | 0.0 | 0.000 | 183
nf-tr-12-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.10 | 0.0 | 0.002 | 154
nf-tr-7-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.10 | 0.0 | 0.002 | 136
nf-tr-1-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 138
nf-tr0-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 138
nf-tr1-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 140
nf-tr7-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 140
nf-tr12-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.10 | 0.0 | 0.002 | 182
nf-tr24-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.10 | 0.0 | 0.002 | 152
nf-tr68-chromatic | rule holds, unregistered | — | 0 / 0 (0) | — | — | — | 133
nf-tr-72-chromatic | rule holds, unregistered | — | 0 / 0 (0) | — | — | — | 136
nf-set-key48-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.10 | 0.0 | 0.002 | 139
nf-set-key48-sixteenths | rule holds, unregistered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 136
nf-set-key60-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 136
nf-set-key60-sixteenths | rule holds, unregistered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 182
nf-set-key72-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 154
nf-set-key72-sixteenths | rule holds, unregistered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 140
nf-set-key72-range62-67-melody-gaps | rule holds, unregistered | — | 10 / 10 (0) | 0.00 | 0.0 | 0.002 | 137
nf-set-key72-tr7-melody-gaps | rule holds, unregistered | — | 16 / 16 (0) | 0.00 | 0.0 | 0.002 | 137
order-pitch-note-filter | rule holds, unregistered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 138
order-note-filter-pitch | rule holds, unregistered | — | 10 / 10 (0) | 0.00 | 0.0 | 0.002 | 138
order-arpeggio-note-filter | rule holds, unregistered | — | 11 / 11 (0) | 0.00 | 0.0 | 0.000 | 137
order-note-filter-arpeggio | rule holds, unregistered | — | 24 / 24 (0) | 0.00 | 0.0 | 0.000 | 186
disabled-note-filter | rule holds, unregistered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 137
```

</details>
