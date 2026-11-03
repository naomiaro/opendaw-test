# MIDI Effect Semantics Audit — register & results

**Title:** MIDI Effect Semantics Audit — does each stock MIDI effect emit what its documented rule
says, across the whole range of every parameter, and has anything changed since the last accepted run

**SDK Pin:** `@opendaw/studio-sdk@0.0.180` (installed npm package; WASM engine only). The crate and
manual citations below are read in the openDAW checkout pinned to that release.

**Filed (2026-11-03):** [openDAW#524](https://github.com/andremichelle/openDAW/issues/524) the Arpeggio's
Velocity control is silent at −100 % and full at 0 % where its manual says full at −100 % and a blend at
0 % (`drafts/posted-openDAW-524-arpeggio-velocity-vs-manual.md`); [openDAW#525](https://github.com/andremichelle/openDAW/issues/525)
the Zeitgeist warps note-offs too, so note lengths change with the groove where its manual says
durations remain unchanged (`drafts/posted-openDAW-525-zeitgeist-warps-note-offs-vs-manual.md`).

**Harness:** unlisted debug demo
`midi-effect-semantics-audit-debug-demo.html[?rate=48000|44100][&rows=all|quick|<id,id,…>][&device=all|arpeggio|pitch|velocity|zeitgeist|order|disabled][&pattern=<id>]`
on the dev server, Chrome, a real click on "Run audit"; deterministic, no hardware, about 35
seconds per rate for the 230 rows. The summary JSON (`midisem-summary-<runToken>.json`, one record
per row with every predicted and read note) lands in `.verify-output/` via the dev server's
`/__verify` sink; `node scripts/audit/midi-effect-semantics/table.ts [runToken] [--accept] [--force]`
prints the table below and, with `--accept`, writes the run as the register
(`register/48000.json`, `register/44100.json` beside this note) the next run is judged against.

**Measurement library:** `src/lib/audit/midiEffectSemanticsReader.ts` (the note reader),
`midiEffectSemanticsRules.ts` (what each device's rule predicts, the known deviations, the
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
  quiet note: the Nano's voice gain is `gain × velocity` (`device-nano/src/voice.rs:129`), so the note
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
a silence one variant predicts, the Arpeggio at −100 % under the velocity matrix, is judged). The
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
| Arpeggio | On the absolute rate grid, one note per step from the notes held at that step, walked up, down or up-down over the octaves, as long as the gate says and no longer than the held note. The walk indexes the ABSOLUTE grid (`step_index = k / repeat`, `k` the absolute grid index; the manual: "syncs to transport position", `arpeggio.md:98`), so a hold from bar 1 at 1/16 starts at grid index 16, not 0: an Up walk over a C major triad starts on E. Velocity per the manual: −100 % full velocity, +100 % the note's own, a blend between (`arpeggio.md:84-92`). | `device-arpeggio/src/lib.rs:240-312` (`process`), `:127-151` (the walk), `:203-206` (`first_index`), `:298` (`step_index`) | `ArpeggioDeviceBoxAdapter.ts:13-19` (`RateFractions`, `floor(3840 / d) × n`) |
| Pitch | Every note moves by `octaves × 12 + semitones`, its cent by the cents setting; a note shifted outside 0..127 is dropped. | `device-pitch/src/lib.rs:101-133` (`transform`), `:8-11` (the drop) | `PitchDeviceBoxAdapter.ts:50-58` (octaves ±7, semitones ±36, cents ±50) |
| Velocity | Every note's velocity is the adapter's `computeVelocity` at the note's absolute position (magnet, random from the seeded generator, offset, clamped, mixed). | `device-velocity/src/lib.rs:70-77` (`compute_velocity`, the adapter's formula ported) | `VelocityDeviceBoxAdapter.ts:31-39` |
| Zeitgeist | Every note starts where the groove warps its position to; durations remain unchanged (`zeitgeist.md:59`). The warp is the cell's Möbius ease at the squashed amount (`0.01 + 0.98 × amount`), read through the device adapter's `groove()` and kept as a float pulse. | `device-zeitgeist/src/lib.rs:124-138` (`process`: warp each record, clamp into the block's range) | `GrooveShuffleBoxAdapter.ts:31-32, 46` |

A chain composes the rules in index order (`crates/engine/src/audio_unit/wiring.rs:1061-1066`); a
disabled device is left out (`wiring.rs:1063`).

## Known deviations

A deviation is a place the engine does something other than the documented rule, named so a row can
be judged with it on and off. Every one below is the crate's arithmetic as written, not a reading
error; a row that matches only with a deviation on reads `matches-known-deviation <name>`.

| name | what the engine does | crate line | first seen | retired on |
|---|---|---|---|---|
| `arpeggio-velocity-matrix` | Fades the note's velocity toward the constant `1 + v` below 0 and toward 1.0 above it (`v ≤ 0 → 1 + v`; `v > 0 → velocity × v + (1 − v)`), where the manual blends full velocity with the note's own: silence at −100 %, 1.0 at 0 %, the note's own only at +100 %. | `device-arpeggio/src/lib.rs:108-118` | 0.0.180 (first run) | — |
| `arpeggio-drops-cent` | Emits every arpeggiated note-on with cent 0, so a source note's detune is lost. | `device-arpeggio/src/lib.rs:304` | 0.0.180 | — |
| `arpeggio-uncapped-note-off` | Ends a step at its position plus its length, never at the end of the source note, so the last step can outlast the held note. | `device-arpeggio/src/lib.rs:303-306` | 0.0.180 | — |
| `zeitgeist-warps-note-off` | Warps the note-off like any other record, so a duration stretches or shrinks with the groove where the manual says durations remain unchanged. | `device-zeitgeist/src/lib.rs:124-138` | 0.0.180 | — |

## Row sampling

230 rows, every one in the register. One parameter at a time across its whole range, the others at
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
- **Zeitgeist**: amounts 0, 0.25, 0.5, 0.75, 1 × every DISTINCT groove duration (8 of the 9 listed
  in `GrooveShuffleBoxAdapter.Durations`; 960 is listed twice), 1/8 to 16 bars, on the sixteenths;
  amounts × 1/8 and 1 bar on the melody.
- **Order** (one row per ordered pair at one non-identity setting each: Arpeggio and Zeitgeist,
  Pitch and Arpeggio, Velocity and Arpeggio, both ways, on the chords) and **disabled** (each device
  off on the sixteenths, expected dry).
- **Gate 1 and gate 2.** At gate 1 the Arpeggio's steps touch: they are `abutting`, read at their
  predicted spans for pitch and velocity; the placement audit holds their timing (every step on its
  grid frame). At gate 2 every step overlaps the next by a whole step: same-pitch overlaps on a held
  note are `overlap` and the rows read `no rule`; they are tracked in the register only.

The patterns (`midiEffectSemanticsRows.ts`): a held C4 (1750 pulses, off the 1/16 grid so a 1/16
step crosses its end at 5590), a held C major triad at velocity 0.8 (the same length), a chromatic
run C4–B4 (sixteenths held a thirty-second), and the MIDI effects demo's chords, sixteenths and
melody.

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
- **The Arpeggio velocity question** is raised only where the manual's blend and the crate's matrix
  give a different velocity for a note that reaches the device: `arp-vel0-held-note` and
  `arp-vel0.5-held-note` (velocity-1 notes, 1.0 under both) are no longer questioned.

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

Verdicts per group, the current registers (both rates alike):

| group | rows | holds | deviation | no rule |
|---|---|---|---|---|
| dry | 4 | 4 | 0 | 0 |
| arpeggio | 88 | 39 | 37 | 12 |
| pitch | 40 | 38 | 0 | 2 |
| velocity | 38 | 38 | 0 | 0 |
| zeitgeist | 50 | 22 | 24 | 4 |
| order | 6 | 4 | 2 | 0 |
| disabled | 4 | 4 | 0 | 0 |

Deviations named, per rate: `arpeggio-uncapped-note-off` 31 rows, `arpeggio-uncapped-note-off +
arpeggio-velocity-matrix` 4, `arpeggio-velocity-matrix` 2, `arpeggio-drops-cent` 1,
`zeitgeist-warps-note-off` 25.

Why each `no rule` row has nothing to judge:

- the nine Arpeggio rows at gate 2: every step overlaps the next by a whole step at one pitch;
- `arp-rate12-gate0.25-held-note`, `arp-rate14-gate0.25-held-note`, `arp-rate14-gate0.5-held-note`:
  steps of 15 or 30 pulses, under the floor;
- `pitch-st-36-chromatic`, `pitch-oct-3-chromatic`: a thirty-second at C1–B1, under the floor;
- `zg-amount0-dur480`, `…15360`, `…30720`, `…61440-sixteenths`: at amount 0 the off-beats ease onto
  the cell start and overlap the on-beats, or the long cells squeeze the notes onto one another.

Rows that hold on an EMPTY prediction, so a sound there reads `rule broken`: the four velocity-0 rows
above; `pitch-oct7-*` and `pitch-oct-7-*`, every note dropped; `arp-vel-1-*` under the velocity
matrix; and `zg-amount1-dur15360-sixteenths`, `…30720` and `…61440`, where the groove at amount 1
(0.99 squashed) pushes every note past the render's end: the first sixteenth, at 3840 pulses, warps to
14908, 28691 and 53356 pulses against the render's 12000 (computed through the cell's ease), and
the render reads nothing in its window.
The table (`node scripts/audit/midi-effect-semantics/table.ts <runToken>`): verdict, the first
mismatch or the questioned behaviours, read / readable (unreadable) of the intent, the largest
deltas where read and readable pair one to one, render time.

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


## Reading

- **The Arpeggio walks the absolute grid, in every mode, at every octave count, rate and repeat,
  exactly as its crate says.** Every step lands on its grid line within 0.1 ms, at the pitch the walk
  names, starting where the absolute grid index puts it (an Up walk over the held triad from bar 1
  begins on E). Three deviations from the documented rule show:
  - `arpeggio-uncapped-note-off` on every row where a step crosses the held note's end (31 rows plus
    the 4 that also show the velocity matrix): the held C4 ends at 2911.5 ms, the 1/16 step from
    2875 ms rings to 2937.5 ms (read 2938.3, the release included).
  - `arpeggio-velocity-matrix` wherever the velocity parameter is below +1 on a note below velocity 1,
    and at −100 % and −50 % on the held note: at −100 % every step is silent (both held rows read
    no note, where the manual plays full velocity), at −50 % the chord reads 0.500 where the manual's
    blend gives 0.950, at 0 % it reads 1.000 where the blend gives 0.900. On a velocity-1 note the
    matrix and the manual agree at 0 % and above, so the held-note rows at 0 and +50 % hold on velocity.
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
  and moves its note-off by the same warp** (`zeitgeist-warps-note-off`, 25 rows: every row where the
  warp changes a judged note's length by more than the 2 ms end tolerance, or changes which notes can be
  read). At 75 % on 1/8 cells
  the on-beat's note-off moves from 2062.5 to 2123.3 ms and the off-beat's from 2248.75 to 2224.4 ms
  (computed through the warp at the squashed amount 0.745; the reads at 48 kHz end at 2124.0 and
  2225.2 ms, the 0.8 ms release later, as the dry notes do). The groove may move a note past the region's end; it sounds there.
- **A disabled device is left out**, all four alike; **order composes** as the chain's index order says
  (Arpeggio and Zeitgeist, Pitch and Arpeggio, Velocity and Arpeggio, both ways, judged as composed).
- **48 and 44.1 kHz read the same verdict on every row**, and a re-run at each rate reproduces the
  register exactly.

## Questions for upstream

Behaviours the rule takes as the engine's, where the documentation does not settle which is meant.
Rows that exercise one carry `questioned: <name>` in the figure column. Whether to raise either is the
user's call. Two behaviours that disagree with the MANUAL outright are filed: openDAW#524 (the
`arpeggio-velocity-manual-gap` question below, `drafts/posted-openDAW-524-arpeggio-velocity-vs-manual.md`)
and openDAW#525 (the `zeitgeist-warps-note-off` deviation: the manual's technical notes say durations
remain unchanged, the engine warps the note-offs, measured as 26.4 / 63.6 ms note lengths at 25 % and
124.0 / 38.9 ms at 75 % for notes held 62.5 ms; `drafts/posted-openDAW-525-zeitgeist-warps-note-offs-vs-manual.md`).
The Pitch drop is not filed: the manual is silent on it.

- **`pitch-drops-out-of-range`.** The engine drops a note shifted outside 0..127, and its note-off
  passes through unshifted; the crate documents this as its deviation from the TS device, which
  yielded the raw pitch (`device-pitch/src/lib.rs:8-11`). The knobs travel ±7 octaves and ±36
  semitones (`pitch.md:26, 38`), ±120 semitones over a 128-note space, so by arithmetic octaves +6
  alone already silences a C4 melody (60 + 72 = 132); no row runs +6, the swept ±7 does. The manual gives the ranges and says nothing about a note pushed out of the key range.
  Rows: `pitch-oct7-chromatic`, `pitch-oct-7-chromatic`, `pitch-oct7-melody`, `pitch-oct-7-melody`
  (silence, as the rule predicts).
- **`arpeggio-velocity-manual-gap`.** The manual: −100 % plays every note at full velocity ignoring
  the input, +100 % keeps the note's own, 0 % a blend (`arpeggio.md:84-92`). The engine: silence at
  −100 %, 1.0 at 0 %, the note's own only at +100 % (`device-arpeggio/src/lib.rs:108-118`, the
  `arpeggio-velocity-matrix` deviation; the crate's comment says it mirrors the TS device). Rows:
  `arp-vel-1-*` and `arp-vel-0.5-*` (held chord and held note), `arp-vel0-held-chord`,
  `arp-vel0.5-held-chord`; on the chord at velocity 0.8 the gap is 1.0 at −100 %, 0.45 at −50 %,
  0.1 at 0 %, 0.05 at +50 %. On the held note (velocity 1) at 0 % and +50 % the blend and the matrix
  both give 1.0, so those two rows are not questioned.

## Status

**Standing regression check after SDK upgrades** (root CLAUDE.md, "Build & Verification"):
`?rows=all` at 48 kHz, then `?rate=44100`; expect every row `as-registered`, `as-registered,
matches-known-deviation …` or `no rule`. A `changed` row is the finding: read its first mismatch
against the crate before anything else. A `matches-known-deviation` the register lists is not a
finding; a deviation that stops showing (the row reads `changed, rule holds`) is a fix landing: retire
the deviation in the table above with the release. `--accept` only after a person's read; a broken
row needs `--force` and a line here naming it; so does a partial run, which then merges into the
register instead of replacing it, and only into a register of the same SDK, bpm and rate. An errored
row is never accepted, forced or not: it keeps its registered entry, or stays out of the register.

## Open items

- **Gate 2 and other true overlaps are tracked only.** A monophonic reader cannot judge two notes
  sounding at once; those rows and notes are in the register, so a change in what they render still
  reads `changed, no rule`, but no rule is checked on them (a read note outside every predicted span
  still reads `rule broken`).
- **The Arpeggio velocity gap** between the manual and the engine (silence at −100 % where the manual
  says full velocity) is a candidate upstream issue, the user's call; drafted under
  `drafts/TO-REVIEW-…` only if asked.
- **The Pitch out-of-range drop** is taken as the rule (the crate documents it); the TS device passed
  the raw pitch.
- **A Zeitgeist before an Arpeggio composes approximately** under `zeitgeist-warps-note-off`: the
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

<details><summary>Accepted 48 kHz table, run 1793744029767 (judged against the first register, so the
rows the re-accept moved read <code>changed</code>)</summary>

```
id | verdict | figure | read / readable (unreadable) | max |Δonset| ms | max |Δcents| | max |Δvel| | render ms
dry-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 149
dry-melody | as-registered | — | 1 / 0 (16) | — | — | — | 140
dry-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 125
dry-held-note | as-registered | — | 1 / 1 (0) | 0.00 | 0.0 | 0.000 | 125
arp-mode0-oct1-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 126
arp-mode0-oct2-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 125
arp-mode0-oct3-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 127
arp-mode0-oct4-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 128
arp-mode0-oct5-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 147
arp-mode1-oct1-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 146
arp-mode1-oct2-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 140
arp-mode1-oct3-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 129
arp-mode1-oct4-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 127
arp-mode1-oct5-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 127
arp-mode2-oct1-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 124
arp-mode2-oct2-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 127
arp-mode2-oct3-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 153
arp-mode2-oct4-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 153
arp-mode2-oct5-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 134
arp-mode0-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 130
arp-mode0-oct2-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 125
arp-mode0-oct3-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 127
arp-mode0-oct4-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 128
arp-mode0-oct5-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 126
arp-mode1-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 150
arp-mode1-oct2-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 147
arp-mode1-oct3-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 137
arp-mode1-oct4-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 134
arp-mode1-oct5-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 128
arp-mode2-oct1-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 128
arp-mode2-oct2-chords | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 130
arp-mode2-oct3-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 126
arp-mode2-oct4-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 149
arp-mode2-oct5-chords | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 153
arp-oct1-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 133
arp-oct2-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 125
arp-oct3-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 124
arp-oct4-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 125
arp-oct5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.10 | 0.0 | 0.000 | 125
arp-rate3-gate0.25-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 124
arp-rate3-gate0.5-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 148
arp-rate3-gate1-held-note | as-registered | — | 1 / 0 (2) | — | — | — | 149
arp-rate3-gate2-held-note | no rule | — | 1 / 0 (2) | — | — | — | 132
arp-rate6-gate0.25-held-note | as-registered | — | 4 / 4 (0) | 0.00 | 0.0 | 0.000 | 127
arp-rate6-gate0.5-held-note | as-registered | — | 4 / 4 (0) | 0.00 | 0.0 | 0.000 | 124
arp-rate6-gate1-held-note | as-registered | — | 1 / 0 (4) | — | — | — | 125
arp-rate6-gate2-held-note | no rule | — | 1 / 0 (4) | — | — | — | 128
arp-rate9-gate0.25-held-note | as-registered | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 133
arp-rate9-gate0.5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 151
arp-rate9-gate1-held-note | as-registered | — | 1 / 0 (8) | — | — | — | 150
arp-rate9-gate2-held-note | no rule | — | 1 / 0 (8) | — | — | — | 131
arp-rate12-gate0.25-held-note | no rule | — | 15 / 0 (15) | — | — | — | 127
arp-rate12-gate0.5-held-note | as-registered | — | 15 / 15 (0) | 0.00 | 0.0 | 0.000 | 132
arp-rate12-gate1-held-note | as-registered | — | 1 / 0 (15) | — | — | — | 127
arp-rate12-gate2-held-note | no rule | — | 1 / 0 (15) | — | — | — | 127
arp-rate14-gate0.25-held-note | no rule | — | 30 / 0 (30) | — | — | — | 125
arp-rate14-gate0.5-held-note | no rule | — | 30 / 0 (30) | — | — | — | 152
arp-rate14-gate1-held-note | as-registered | — | 1 / 0 (30) | — | — | — | 152
arp-rate14-gate2-held-note | no rule | — | 1 / 0 (30) | — | — | — | 129
arp-rate2-gate0.25-held-note | as-registered | — | 2 / 2 (0) | 0.03 | 0.0 | 0.000 | 128
arp-rate2-gate0.5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 2 / 2 (0) | 0.03 | 0.0 | 0.000 | 134
arp-rate2-gate1-held-note | as-registered | — | 1 / 0 (2) | — | — | — | 128
arp-rate2-gate2-held-note | no rule | — | 1 / 0 (2) | — | — | — | 128
arp-rate8-gate0.25-held-note | as-registered | — | 6 / 6 (0) | 0.03 | 0.0 | 0.000 | 129
arp-rate8-gate0.5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 6 / 6 (0) | 0.03 | 0.0 | 0.000 | 153
arp-rate8-gate1-held-note | as-registered | — | 1 / 0 (6) | — | — | — | 153
arp-rate8-gate2-held-note | no rule | — | 1 / 0 (6) | — | — | — | 133
arp-rate4-gate0.25-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 127
arp-rate4-gate0.5-held-note | as-registered | — | 2 / 2 (0) | 0.00 | 0.0 | 0.000 | 128
arp-rate4-gate1-held-note | as-registered | — | 1 / 0 (2) | — | — | — | 128
arp-rate4-gate2-held-note | no rule | — | 1 / 0 (2) | — | — | — | 127
arp-rate7-gate0.25-held-note | as-registered | — | 5 / 5 (0) | 0.00 | 0.0 | 0.000 | 126
arp-rate7-gate0.5-held-note | as-registered | — | 5 / 5 (0) | 0.00 | 0.0 | 0.000 | 151
arp-rate7-gate1-held-note | as-registered | — | 1 / 0 (5) | — | — | — | 152
arp-rate7-gate2-held-note | no rule | — | 1 / 0 (5) | — | — | — | 133
arp-repeat1-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 129
arp-repeat2-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 126
arp-repeat4-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 127
arp-repeat16-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 131
arp-mode0-oct2-gate1-held-chord | as-registered | — | 1 / 0 (8) | — | — | — | 128
arp-mode1-oct2-gate1-held-chord | as-registered | — | 1 / 0 (8) | — | — | — | 155
arp-mode2-oct2-gate1-held-chord | as-registered | — | 1 / 0 (8) | — | — | — | 156
arp-vel-1-held-chord | as-registered, matches-known-deviation arpeggio-velocity-matrix | — questioned: arpeggio-velocity-manual-gap | 0 / 8 (0) | — | — | — | 126
arp-vel-1-held-note | as-registered, matches-known-deviation arpeggio-velocity-matrix | — questioned: arpeggio-velocity-manual-gap | 0 / 8 (0) | — | — | — | 128
arp-vel-0.5-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off+arpeggio-velocity-matrix | — questioned: arpeggio-velocity-manual-gap | 8 / 8 (0) | 0.00 | 0.0 | 0.450 | 128
arp-vel-0.5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off+arpeggio-velocity-matrix | — questioned: arpeggio-velocity-manual-gap | 8 / 8 (0) | 0.00 | 0.0 | 0.500 | 133
arp-vel0-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off+arpeggio-velocity-matrix | — questioned: arpeggio-velocity-manual-gap | 8 / 8 (0) | 0.00 | 0.0 | 0.100 | 130
arp-vel0-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 130
arp-vel0.5-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off+arpeggio-velocity-matrix | — questioned: arpeggio-velocity-manual-gap | 8 / 8 (0) | 0.00 | 0.0 | 0.050 | 157
arp-vel0.5-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 154
arp-vel1-held-chord | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 127
arp-vel1-held-note | as-registered, matches-known-deviation arpeggio-uncapped-note-off | — | 8 / 8 (0) | 0.00 | 0.0 | 0.000 | 128
pitch-st-36-chromatic | no rule | — | 12 / 0 (12) | — | — | — | 130
pitch-st-12-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 134
pitch-st-7-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 129
pitch-st0-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 131
pitch-st7-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 163
pitch-st12-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 154
pitch-st36-chromatic | as-registered | — | 12 / 12 (0) | 0.10 | 0.0 | 0.000 | 131
pitch-oct-7-chromatic | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 129
pitch-oct-3-chromatic | no rule | — | 12 / 0 (12) | — | — | — | 131
pitch-oct-1-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 130
pitch-oct0-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 130
pitch-oct1-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 131
pitch-oct3-chromatic | as-registered | — | 12 / 12 (0) | 0.10 | 0.0 | 0.000 | 159
pitch-oct7-chromatic | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 158
pitch-ct-50-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 100.0 | 0.000 | 130
pitch-ct-12.5-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 131
pitch-ct0-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 130
pitch-ct12.5-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 130
pitch-ct50-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 100.0 | 0.000 | 130
pitch-combined-chromatic | as-registered | — | 12 / 12 (0) | 0.00 | 0.0 | 0.000 | 131
pitch-st-36-melody | as-registered | — | 1 / 0 (16) | — | — | — | 169
pitch-st-12-melody | as-registered | — | 1 / 0 (16) | — | — | — | 159
pitch-st-7-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
pitch-st0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
pitch-st7-melody | as-registered | — | 1 / 0 (16) | — | — | — | 131
pitch-st12-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
pitch-st36-melody | as-registered | — | 1 / 0 (16) | — | — | — | 130
pitch-oct-7-melody | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 130
pitch-oct-3-melody | as-registered | — | 1 / 0 (16) | — | — | — | 161
pitch-oct-1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 156
pitch-oct0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
pitch-oct1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 133
pitch-oct3-melody | as-registered | — | 1 / 0 (16) | — | — | — | 133
pitch-oct7-melody | as-registered | — questioned: pitch-drops-out-of-range | 0 / 0 (0) | — | — | — | 130
pitch-ct-50-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
pitch-ct-12.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 133
pitch-ct0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 172
pitch-ct12.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 159
pitch-ct50-melody | as-registered | — | 1 / 0 (16) | — | — | — | 134
pitch-combined-melody | as-registered | — | 1 / 0 (16) | — | — | — | 134
vel-magnet0x0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 133
vel-magnet0x0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 132
vel-magnet0x1-sixteenths | changed, rule holds | unreadable 0 expected 32 | 0 / 0 (0) | — | — | — | 134
vel-magnet0.5x0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 164
vel-magnet0.5x0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 158
vel-magnet0.5x1-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 132
vel-magnet1x0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 132
vel-magnet1x0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 132
vel-magnet1x1-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 135
vel-random0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 135
vel-random0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.002 | 131
vel-random1-sixteenths | changed, rule holds | unreadable 0 expected 3 | 29 / 29 (0) | 0.30 | 0.0 | 0.002 | 181
vel-offset-1-sixteenths | changed, rule holds | unreadable 0 expected 32 | 0 / 0 (0) | — | — | — | 156
vel-offset-0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.10 | 0.0 | 0.000 | 133
vel-offset0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 132
vel-offset0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 135
vel-mix0-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 132
vel-mix0.5-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 134
vel-mix1-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 168
vel-magnet0x0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 156
vel-magnet0x0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
vel-magnet0x1-melody | changed, rule holds | unreadable 0 expected 16 | 0 / 0 (0) | — | — | — | 132
vel-magnet0.5x0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 131
vel-magnet0.5x0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
vel-magnet0.5x1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 131
vel-magnet1x0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 133
vel-magnet1x0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 169
vel-magnet1x1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 160
vel-random0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 141
vel-random0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 132
vel-random1-melody | changed, rule holds | unreadable 13 expected 16 | 3 / 0 (13) | — | — | — | 134
vel-offset-1-melody | changed, rule holds | unreadable 0 expected 16 | 0 / 0 (0) | — | — | — | 133
vel-offset-0.5-melody | changed, rule holds | unreadable 12 expected 16 | 2 / 0 (12) | — | — | — | 133
vel-offset0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 169
vel-offset0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 154
vel-mix0-melody | as-registered | — | 1 / 0 (16) | — | — | — | 134
vel-mix0.5-melody | as-registered | — | 1 / 0 (16) | — | — | — | 134
vel-mix1-melody | as-registered | — | 1 / 0 (16) | — | — | — | 134
zg-amount0-dur480-sixteenths | no rule | — | 16 / 0 (32) | — | — | — | 135
zg-amount0-dur960-sixteenths | as-registered | — | 16 / 0 (32) | — | — | — | 135
zg-amount0-dur1920-sixteenths | as-registered | — | 16 / 0 (32) | — | — | — | 170
zg-amount0-dur3840-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 16 / 2 (30) | — | — | — | 157
zg-amount0-dur7680-sixteenths | changed, matches-known-deviation zeitgeist-warps-note-off | note 0 velocity 0.960 expected 0.990 | 16 / 3 (29) | — | — | — | 134
zg-amount0-dur15360-sixteenths | no rule | — | 15 / 0 (32) | — | — | — | 135
zg-amount0-dur30720-sixteenths | no rule | — | 1 / 0 (32) | — | — | — | 137
zg-amount0-dur61440-sixteenths | no rule | — | 1 / 0 (32) | — | — | — | 134
zg-amount0.25-dur480-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 0 (32) | — | — | — | 134
zg-amount0.25-dur960-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 16 (16) | — | — | — | 174
zg-amount0.25-dur1920-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 20 (12) | — | — | — | 158
zg-amount0.25-dur3840-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 20 (12) | — | — | — | 134
zg-amount0.25-dur7680-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 22 (10) | — | — | — | 135
zg-amount0.25-dur15360-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 28 (4) | — | — | — | 137
zg-amount0.25-dur30720-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 10 (22) | — | — | — | 133
zg-amount0.25-dur61440-sixteenths | as-registered | — | 32 / 0 (32) | — | — | — | 136
zg-amount0.5-dur480-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 171
zg-amount0.5-dur960-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 157
zg-amount0.5-dur1920-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 134
zg-amount0.5-dur3840-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 137
zg-amount0.5-dur7680-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 143
zg-amount0.5-dur15360-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 135
zg-amount0.5-dur30720-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 136
zg-amount0.5-dur61440-sixteenths | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 175
zg-amount0.75-dur480-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 2 (30) | — | — | — | 157
zg-amount0.75-dur960-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 18 (14) | — | — | — | 140
zg-amount0.75-dur1920-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 21 (11) | — | — | — | 140
zg-amount0.75-dur3840-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 21 (11) | — | — | — | 135
zg-amount0.75-dur7680-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 26 / 16 (10) | — | — | — | 135
zg-amount0.75-dur15360-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 20 / 19 (1) | — | — | — | 136
zg-amount0.75-dur30720-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 8 / 7 (1) | — | — | — | 173
zg-amount0.75-dur61440-sixteenths | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 4 / 4 (0) | 0.04 | 0.0 | 0.000 | 158
zg-amount1-dur480-sixteenths | changed, matches-known-deviation zeitgeist-warps-note-off | note 16 velocity 0.570 expected 0.605 | 17 / 2 (30) | — | — | — | 134
zg-amount1-dur960-sixteenths | changed, matches-known-deviation zeitgeist-warps-note-off | note 2 velocity 0.960 expected 0.990 | 17 / 1 (31) | — | — | — | 135
zg-amount1-dur1920-sixteenths | changed, matches-known-deviation zeitgeist-warps-note-off | note 4 velocity 0.960 expected 0.990 | 17 / 1 (31) | — | — | — | 136
zg-amount1-dur3840-sixteenths | changed, matches-known-deviation zeitgeist-warps-note-off | note 8 velocity 0.960 expected 0.990 | 16 / 3 (29) | — | — | — | 140
zg-amount1-dur7680-sixteenths | changed, rule holds | note 0 velocity 0.960 expected 0.990 | 1 / 0 (17) | — | — | — | 137
zg-amount1-dur15360-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 175
zg-amount1-dur30720-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 160
zg-amount1-dur61440-sixteenths | as-registered | — | 0 / 0 (0) | — | — | — | 133
zg-amount0-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 137
zg-amount0-dur3840-melody | as-registered | — | 1 / 0 (16) | — | — | — | 135
zg-amount0.25-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 134
zg-amount0.25-dur3840-melody | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 1 / 4 (12) | — | — | — | 135
zg-amount0.5-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 177
zg-amount0.5-dur3840-melody | as-registered | — | 1 / 0 (16) | — | — | — | 157
zg-amount0.75-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 137
zg-amount0.75-dur3840-melody | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 1 / 5 (11) | — | — | — | 134
zg-amount1-dur480-melody | as-registered | — | 1 / 0 (16) | — | — | — | 135
zg-amount1-dur3840-melody | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 1 / 1 (15) | 0.00 | 43.7 | 0.000 | 136
order-arpeggio-zeitgeist | as-registered, matches-known-deviation zeitgeist-warps-note-off | — | 32 / 2 (30) | — | — | — | 137
order-zeitgeist-arpeggio | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 178
order-pitch-arpeggio | as-registered, matches-known-deviation arpeggio-drops-cent | — | 32 / 32 (0) | 0.00 | 12.5 | 0.000 | 156
order-arpeggio-pitch | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 137
order-velocity-arpeggio | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 134
order-arpeggio-velocity | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 140
disabled-arpeggio | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 136
disabled-pitch | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 137
disabled-velocity | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 177
disabled-zeitgeist | as-registered | — | 32 / 32 (0) | 0.00 | 0.0 | 0.000 | 156
run 1793744029767 | sdk 0.0.180 | 48000 Hz | 120 bpm | reference peak 0.7078585456111496 | instrument offset 6 frames | register /debug/2026-11-03-midi-effect-semantics/register/48000.json | rows 230 | holds 149 deviation 63 broken 0 none 18 error 0 | as-registered 217 changed 13 unregistered 0
```

</details>

Accepted 44.1 kHz, run 1793744117203: every row read the same rule verdict as at 48 kHz;
`register/44100.json` holds its figures.

```
run 1793744117203 | sdk 0.0.180 | 44100 Hz | 120 bpm | reference peak 0.7078102259681298 | instrument offset 6 frames | register /debug/2026-11-03-midi-effect-semantics/register/44100.json | rows 230 | holds 149 deviation 63 broken 0 none 18 error 0 | as-registered 216 changed 14 unregistered 0
```

The first registers' tables (runs 1793741953204 and 1793742021509) are in this note's history.
