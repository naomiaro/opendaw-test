# MIDI effect semantics audit — design

A standing sweep that renders the four stock MIDI effects offline across their whole parameter
space, reads the output back as notes (when, which pitch, how loud), and judges every row against
the device's rule and against the last recorded figures, so an SDK upgrade reports a behaviour change
and says whether it looks like a regression. Third PR after the MIDI Effects (#189) and Spielwerk
(#190) demos. The emitted lane's second source on the demo page comes AFTER this, in its own PR,
on the library this one builds.

## Why

The placement audit (`debug/2026-10-21-midi-effect-placement/note.md`) judges timing only: a
pass-through device at lag 0, a note-moving device on its rule's frame. Nothing checks what the
devices DO: which pitches an Arpeggio walks in each mode and octave range, what a Velocity magnet
lands on, that Pitch moves a block, that Zeitgeist advances below 50 %, that chain order matters.
The MIDI Effects demo's cards state those as sentences. An SDK release can change any of them
without the timing audit noticing, and the engine already carries one quirk of that class on record
(Arpeggio at velocity 0 emitting every step at 1.0).

## What the user asked for

A run that notifies a behaviour change and says whether it is a possible regression. Not pass/fail:
a change the device's rule still allows is a notice; a change that breaks the rule is a regression
candidate; a figure with no rule is tracked only. Full parameter space from the start, not just the
cards' claims. Audit first; the demo lane's second source after.

## Goals

- One row per (device, parameter setting, pattern, and for order rows a device pair), rendered
  offline, deterministic, no hardware, runnable in about a minute at both sample rates.
- Each row read back as a note list: onset time (frames), pitch (from the fundamental's frequency),
  velocity (from the onset's peak level), note end where the material allows.
- Each row judged twice: against the device's RULE (a function from the input notes and the
  settings to the expected note list, read from the engine's device crate and the adapter's mapping,
  cited by `crate/file:line` in the register), and against the REGISTER (the figures the last run on
  the previous release recorded).
- Verdicts: `as-registered`, `changed, rule holds`, `changed, rule broken`, `no rule` (tracked), and
  `error`. The page's status column and the table script print the verdict and, for a broken rule,
  the rule's sentence and the first figure that broke it.
- A standing-sweep entry in CLAUDE.md's upgrade list, a register note under `debug/`, a table script
  under `scripts/audit/`.

## Non-goals

- No live-transport rows: offline render only (the placement audit covers the live path's timing).
- No Spielwerk rows: the scripts are the user's; their corner sweep lives in PR 2's tests.
- No change to the demo pages in this PR. The lane's second source is the next PR.
- No automatic register update: a change is read by a person and the register edited by hand, as the
  other sweeps do.

## Anti-goals

- A verdict that calls a change a regression when the rule still holds, or passes a broken rule
  because the register happened to agree.
- A rule that is the previous run's output in disguise. A rule is derived from the device's code and
  documentation, never fitted to a render.
- A reader whose own error is bigger than the effect it judges: velocity steps of 0.01 and timing
  steps of one frame must be resolvable, or the row says so.

## The instrument and the reader

- **Instrument:** a Nano sampler playing a one-second sine sample (440 Hz at root key 69, attack and
  release at the minimum, loop off), the placement audit's bootstrap shape with a tone instead of a
  burst. The sampler repitches by playback rate (`crates/stock-devices/device-nano`), so a note's
  frequency is `440 × 2^((pitch − 69)/12)` with cents, and scales gain by velocity linearly
  (`device-nano/src/voice.rs:129`, `gain = playback.gain * velocity`), so the onset's peak is the
  velocity times one constant.
- **Onsets:** the first frame above a threshold after a gap, as the placement audit reads them, with
  the attack long enough to make the peak readable and short enough to keep onsets apart (the builder
  measures both on the dry row and records them in the register's calibration section).
- **Pitch:** the fundamental's frequency over the note's sustained part, by autocorrelation or a
  zero-crossing count over whole cycles, to better than 5 cents (the Pitch device's `cents` field has
  a 0.1 print step; the audit judges cents to ±2).
- **Velocity:** the peak absolute sample within the attack, divided by the dry row's peak at velocity
  1.0; resolution 0.005 or better.
- **End:** where the material has gaps (short notes), the last frame above the threshold; where notes
  overlap, not read (`no rule` for duration on those rows).
- **Readability.** The reader is monophonic: it cannot read a chord's three fundamentals, two notes of
  one pitch that overlap (their phases add or cancel), or a note shorter than its attack plus one
  cycle of its fundamental (the sampler's `(k/attack)²` ramp means a 440 Hz note needs about 3 ms
  before its peak means anything, a 65 Hz note about 5 ms). So: the audit's material is written for
  the reader (notes held a fraction of their step, chords only where the device under test turns
  them into single notes, no two same-pitch notes overlapping in the PREDICTED output), and the
  reader marks a note `unreadable` with a reason (`overlap`, `too-short`, `polyphonic`) instead of
  guessing. A row judges its readable notes and counts the unreadable ones; a row whose rule
  predicts unreadable notes everywhere (Zeitgeist at amount 0 or 1 squashes the off-beat to under 2
  ms; Arpeggio gate 2 on one pitch) is tracked, not judged, and the register says why.
- **Timing tolerance.** A sine's threshold crossing moves with pitch and velocity, so this audit
  judges onsets at ±1 ms (about 48 frames at 48 kHz; every device's timing effect is tens of pulses,
  a pulse being about 1 ms at 120 bpm). Frame accuracy belongs to the placement audit.
- **The master's Maximizer is off** in this project (`auto-create-output-maximizer` false, or the
  skeleton created without it, as the test fixtures do): a limiter before the tap would bend the
  peak the velocity reading depends on. The sine sample is long enough for the longest note at the
  highest pitch the rows produce (the sampler plays it faster as pitch rises): four seconds.
- The reader lives in `src/lib/audit/midiEffectSemanticsReader.ts`, pure over `Float32Array`s, with
  Node tests on synthetic tones (a sine at a known pitch and level, two overlapping notes, a note at
  velocity 0.02).

## The rows

Patterns are the demo's four (`src/lib/midiEffects/patterns.ts`) plus two audit patterns: a single
held note (the Arpeggio and Velocity base case) and a chromatic run of twelve sixteenths (pitch rows).
Every row renders bar 0 silent and the pattern from bar 1, as the placement audit does.

| device | settings swept | pattern(s) | what the rule predicts |
|---|---|---|---|
| Arpeggio | mode × {Up, Down, UpDown} × octaves 1..5 × rate {1/4, 1/8, 1/16, 1/32, two triplets, two dotted} × gate {0.25, 1, 2} × repeat {1, 2, 4} × velocity {−1, 0, 0.5, 1} | held chord; held note; chords | the pitch sequence per step on the absolute grid, each step's velocity, each step's length (gate × rate, capped by the note end); the engine's velocity-0 quirk is part of the rule as recorded |
| Pitch | semitones {−36, −7, 0, 7, 36} × octaves {−7, −1, 0, 1, 7} × cents {−50, −12.5, 0, 12.5, 50} | chromatic run; melody | every onset's pitch moved by `octaves × 12 + semitones`, its frequency by `cents`; timing unchanged; pitches outside 0..127 clamped or dropped as the crate does (read it) |
| Velocity | magnet position {0, 0.5, 1} × strength {0, 0.5, 1} × random amount {0, 0.5, 1} × offset {−1, 0, 0.5} × mix {0, 0.5, 1}, seed fixed | sixteenths (alternating 1 / 0.6); melody (ramp) | each note's velocity from `VelocityDeviceBoxAdapter.computeVelocity` with the per-note seed `randomSeed + position` (the TS formula the crate ports, so the expected value is exact); timing unchanged |
| Zeitgeist | amount {0, 0.25, 0.5, 0.75, 1} × duration {every entry of `GrooveShuffleBoxAdapter.DurationPPQNs`} | sixteenths; melody | each onset through `groove().warp(position)` kept as a float pulse; 50 % identity; pitch and velocity unchanged |
| order | {Arpeggio, Zeitgeist}, {Zeitgeist, Arpeggio}, {Pitch, Arpeggio}, {Arpeggio, Pitch}, {Velocity, Arpeggio}, {Arpeggio, Velocity} at one setting each | chords | the composition of the two rules in that order; the pairs that commute predicted equal |
| disabled | each device at one non-identity setting, `enabled` false | sixteenths | identical to dry |

**Full range on every parameter, the Cartesian product only where the rule couples parameters.**
A row's render costs about a second (the placement audit's figure), so the product of every
Arpeggio dimension (13 000 rows) is hours. Each parameter is swept over its full range at the
device's base setting; two parameters are swept together only when the rule makes one depend on the
other (Arpeggio mode × octaves, since the walk's shape is their product; rate × gate, since a step's
length is their product); the rest vary one at a time. That is a few hundred rows, a run of five
to ten minutes at one rate, which is the standing sweep. `?device=`, `?pattern=` and `?rows=`
narrow a run as the other audits do, and `?rows=quick` names a ~50-row subset for a fast look.

## The two judgements and the verdicts

- **Rule:** the predicted note list is matched to the read list by onset within one frame plus the
  sampler's own offset (read off the dry row, as the placement audit does); pitch within ±2 cents;
  velocity within the reader's resolution; counts must match. `rule holds` or `rule broken`, with the
  first failing note and figure.
- **Register:** the row's figure (the note list, rounded to the reader's resolution) compared with the
  register's stored figure for the same row id. `as-registered` when equal within tolerance;
  `changed` otherwise.
- **Verdict:** `as-registered` requires the rule to hold too (a first run has no register and reads
  `rule holds, unregistered`); `changed, rule holds`; `changed, rule broken`; `no rule` for the
  tracked-only figures (durations under overlap, levels of a sustained part); `error` for a failed
  render, or a silent one when the rule predicts sound. A render the rule predicts SILENT (Arpeggio
  velocity −1, Velocity offset −1 at mix 1, a Pitch shift that drops every note) reads `rule holds`
  on an empty list, so an engine that starts sounding there reads `changed, rule broken`.
- **What the rule is, and where the engine's own quirks go.** The rule is the device's documented
  intent: the adapter's mapping, the manual, chapter 16, what the demo card says. Where the engine
  today deviates from that intent (the Arpeggio emits every step at velocity 1 when its velocity
  parameter is 0, and emits `cent: 0` so an upstream Pitch's cents are lost; its note-offs are not
  capped at the source note's end; Zeitgeist warps note-offs too; Pitch drops an out-of-range note
  instead of clamping), the deviation is listed in the register as a KNOWN DEVIATION with the crate
  line it was read from, the way the other audits carry `matches-known-defect` bands. A row then
  reads `rule holds` (the engine matches intent), `matches-known-deviation <name>` (the engine
  matches a listed deviation: a notice, not a regression), or `changed, rule broken` (neither).
  When a release fixes a deviation, the row reads `changed, rule holds` and the register retires the
  entry with the release. This keeps the rule from being fitted to the render while still telling
  the user whether a change is a regression.
- The register stores figures as JSON under `debug/<date>-midi-effect-semantics/register/<rate>.json`
  (one object per row id), written by the table script from a run's envelope when a person accepts the
  run (`node scripts/audit/midi-effect-semantics/table.ts <runToken> --accept`); the note records
  what was accepted and why. The envelope (`midisem-summary-<runToken>.json`) lands in
  `.verify-output/` through the dev server's `/__verify` sink like the others.

## Where it lives

- Page: `midi-effect-semantics-audit-debug-demo.html` + `src/demos/midi/midi-effect-semantics-audit-debug-demo.tsx`
  (unlisted; `noindex`; `#audit-state[data-audit-state]` ending in `done`; a real click on Run).
- Library: `src/lib/audit/midiEffectSemantics{Rules,Reader,Rows,Verdict,Artifacts}.ts`, each with
  Node tests; the rules tested against hand-computed expectations, the reader against synthetic
  signals, the verdict against constructed figure pairs.
- Register and note: `debug/2026-11-xx-midi-effect-semantics/note.md` (register layout, calibration
  figures, the first runs at 48 and 44.1 kHz, the rule sources cited).
- Table script: `scripts/audit/midi-effect-semantics/table.ts` (prints the table, `--accept` writes
  the register).
- CLAUDE.md: a standing-sweep bullet after the placement audit's; `src/demos/midi/CLAUDE.md`: a
  section with the URL parameters, the reading recipe and the verdict meanings.

## Constraints

- Reuse the placement audit's bootstrap (sample load, Nano settings, offline render through
  `renderOfflineSlice`, device insert and settings in separate transactions, deletion after the row)
  rather than duplicating it: extract what both need into `src/lib/audit/midiEffectBootstrap.ts`
  if the placement page's code can move without changing its rows.
- The rules are derived from the engine's device crates and the adapters' mappings and cite them;
  where a rule needs the adapter's own function (`computeVelocity`, `groove().warp`), call that
  function rather than re-implementing it.
- Every repo rule in CLAUDE.md: Option API, adapter layer, transactions, no value import of
  `@opendaw/studio-core` in anything tested in Node (the factory-key pattern from
  `src/lib/midiEffects/devices.ts`).
- Both sample rates in the first runs; the device rate noted; the usual "edit `.md` only during a run".

## Left to the builder

- The exact onset threshold and attack length, measured on the dry row.
- The pitch estimator (autocorrelation vs zero-crossing) and its tested accuracy.
- The row sampling where the full product is too large, stated in the register.
- The envelope schema's fields beyond the figure and the verdict.
- The order of work: reader and rules with tests first, then rows and the page, then the register
  from the first accepted runs, then the docs.

## Open questions settled by my call (flag in the PR if wrong)

- Known engine deviations are register entries beside the rule, not part of the rule (see "What
  the rule is"); the Arpeggio velocity-0 quirk is the first entry.
- The reader is monophonic and says `unreadable` rather than guessing; the material is written for
  it (see "Readability").
- Timing here is ±1 ms; frame accuracy stays with the placement audit.
- Full range per parameter, Cartesian product only where the rule couples parameters; a run is
  minutes, not hours.
- The register is JSON, not prose: figures are note lists, too long for a markdown table.
- A person accepts a changed run; the table script never writes the register on its own.
