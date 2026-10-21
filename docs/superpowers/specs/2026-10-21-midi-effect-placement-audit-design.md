# MIDI effect placement audit — design

**Date:** 2026-10-21
**Status:** draft for review; deleted in the PR that completes the work (git history keeps it)
**Register (to be created):** `debug/2026-10-21-midi-effect-placement/note.md`

## Intent

Does a MIDI effect in a unit's chain move where a note sounds, the way the Compressor's
look-ahead moved a track before the engine had delay compensation (openDAW#482)? And does
an effect in the chain move where the recorder *places* a recorded note? The repo has a
harness for the audio-effect question (`plugin-delay-compensation-debug-demo.html`) and a
sweep for recorded-MIDI placement (`midi-input-alignment-audit-debug-demo.html`). This
work adds the MIDI-effect equivalent of the first and an effect arm to the second.

The two MIDI alignment registers hold three upstream drafts until this harness has run
(user's decision, 2026-10-20). Its result either clears them or adds to them.

### What the engine does (read, not measured)

- A MIDI effect is not an audio node. It is a *pull link* in the unit's event chain:
  `instrument ← effect ← … ← sequencer`. When the instrument pulls events for a pulse
  range, each effect pulls its own upstream and returns transformed events
  (`crates/engine/src/plugin_midi_effect.rs`, `audio_unit/wiring.rs`). Everything happens
  in pulse positions; the instrument resolves pulses to sample offsets.
- A live key reaches the engine as a note signal and is pushed into the *same* sequencer
  that plays the note regions (`audio_unit/params.rs`, `note_signal_to_unit` →
  `push_raw_note_on`). So live playing and recorded playback go through the identical
  effect chain. One offline render measures both.
- The recorder (`RecordMidi`) subscribes to the capture's raw note signals on the main
  thread and writes them to the region. It never sees an effect. An effect in the chain
  can only change what is *heard* while recording, not what is *written*.
- A disabled effect is left out of the pull chain entirely (bypassed).

These are the predictions the harness tests. Where a row disagrees with them, the
disagreement is the finding.

## Goals

1. A page that renders one note pattern offline, dry and through each stock MIDI effect,
   and reads how far each effect moved every note against the position its own rule
   predicts. Deterministic, no hardware, runnable after every SDK upgrade in seconds.
2. An `&effect=` arm on the MIDI input alignment sweep that inserts a MIDI effect on the
   recorded unit and shows the recorded rows unchanged (or not).
3. A register that states, per device, what the effect is *expected* to do to timing (from
   the device's rule) and what it *did*, so a future row that differs is read as a change.

## Non-goals

- The live *heard* arm (a key pressed, the sound measured through speakers or an output
  tap, with an effect in the chain). The engine routes live notes through the same chain
  the offline render exercises; if a listener ever hears a live-only effect delay, the
  combined MIDI + audio harness can take the same `&effect=` flag. Not in this PR.
- Judging a device's *musical* output (which pitch the arpeggiator picks, what velocity
  curve applies). Only timing is judged. Pitch and velocity are read for matching, not
  for correctness.
- Automation of effect parameters during the render.
- WebCLAP or Werkstatt devices (audio-side; covered by the delay-compensation page).
- Composite (layered) instruments and per-cell effect replicas.

## Anti-goals

- A verdict that depends on a fitted number. Every tolerance names its mechanism.
- Reporting an arpeggiator's wait for its next grid line as a "delay". The expectation
  comes from the device's rule; the deviation from the expectation is the figure.
- Judging an effect row against an absolute frame. Every effect row is judged against the
  dry row of the same run, so the instrument's own onset offset nets out.

## Part 1 — the offline placement page

### Page

`midi-effect-placement-audit-debug-demo.html` (unlisted, `noindex, nofollow`, not in
`src/index.tsx` or the sitemap), source `src/demos/midi/midi-effect-placement-audit-debug-demo.tsx`.
One button, "Run audit". URL parameters:

- `?rate=48000|44100` (default 48000) — the render sample rate. The live `AudioContext` is
  created at the same rate (`audioContextSampleRate`, as the delay-compensation page does)
  and the burst sample is built at it.
- `?bpm=<n>` (default 120).
- `?device=all|pitch|velocity|arpeggio|zeitgeist|spielwerk` (default `all`).

DOM contract as the other audit pages: `#audit-state[data-audit-state]` walking
`setup → running:<row> → done | error:<message>`. Results in a `TestStep` table with
expected rows (the PDC page's pattern) plus a per-row detail table. The summary JSON is
PUT to the dev server's `/__verify` sink as `midifx-summary-<runToken>.json`;
`node scripts/audit/midi-effect-placement/table.ts [runToken]` prints the register table.

### Source material

One **Nano** sampler unit (`InstrumentFactories.Nano`, created with an `AudioFileBox`
attachment registered in `localAudioBuffers`, the way the Nano demo does). The sample is
a 20 ms burst at the render rate: a full-scale step for the first 10 ms, then a 10 ms
linear fall to zero, so each note has a hard, repeatable onset and dies well before the
next sixteenth at any bpm the page accepts. **Not a single-sample impulse**: Nano's
attack envelope (minimum 1 ms) would multiply a lone sample by the ramp's starting value
and the note would be silent. Nano is chosen over Vaporisateur because a sample burst
has the same onset shape at every note; a synth's oscillator phase differs per note.

Nano settings, in one transaction after creation: `attack` at its minimum (0.001 s),
`release` at its minimum (0.001 s), `rootKey` 60, loop off.

**Every note in every scenario has pitch 60**, so Nano never repitches and every onset has
the identical shape. The Arpeggio scenario holds one note with one octave so its steps
all repeat pitch 60; the Pitch device's transposition is 0 (see below).

### The pattern

One note region on the unit's track starting at bar 1 (position `BAR_PPQN`, so nothing
sounds in the first bar and the render's start is clear of every onset). The pattern
inside the region depends on the device, because each device has one rule to test:

| device | notes in the region | the rule under test |
|---|---|---|
| dry | eight sixteenths on the sixteenth grid of bar 1's first two beats, each held a thirty-second | the reference |
| Pitch | same as dry | pass-through timing (octaves 0, semitones 0, cents 0) |
| Velocity | same as dry | pass-through timing (magnet strength 0, random amount 0, offset 0, mix 0) |
| Arpeggio | one note at bar 1 beat 1, held two beats | step `k` lands on absolute grid line `k × rate` (mode Up, 1 octave, rate 1/16 = rate index 9, gate 1, repeat 1) |
| Zeitgeist | same as dry | downbeats of each `duration` cell stay put; off-beats move to `warp(position)` (amount 0.6, duration 480: the factory defaults) |
| Spielwerk, forward | same as dry | a script whose generator yields nothing: the bridge forwards the input verbatim, timing 0 |
| Spielwerk, yield | same as dry | `// @no-pass` plus a generator that yields every event unchanged: the scheduler path, timing 0 |
| Spielwerk, echo | one note at bar 1 beat 1, held a thirty-second | the echo example's rule: the original is forwarded and copies are yielded at `position + i × delay` for `i = 1 … repeats−1` (delay 120 pulses, 3 repeats), so onsets at `i = 0, 1, 2` |

Spielwerk forwards its input and *adds* the generator's yields unless the script declares
`// @no-pass` (`core-wasm/src/script-spielwerk.ts`, the device crate's header). A script
that yields each event unchanged without that directive sounds every note twice; hence two
pass-through rows, one per path.

Eight sixteenths over two beats at 120 bpm span one second; the render is bar 0 to the
end of bar 1 plus a quarter-second tail (`renderOfflineSlice` from position 0).

### Rows and how each is judged

The page renders the dry pattern once, then for each device: inserts the device via
`project.api.insertEffect(midiEffectsFieldOf(project, audioUnitBox), EffectFactories.X)`
in one transaction, sets its parameters in a second transaction (the repo's
pointer-staleness rule), compiles the Spielwerk script on the live context outside any
transaction (`ScriptCompiler` with the `spielwerk` tag; the offline renderer re-registers
the compiled code from the box, verified in `OfflineEngineRenderer.ts`), renders, then
deletes the device (`box.delete()`) before the next. Zeitgeist's `GrooveShuffleBox` is the
*target* of the device's pointer, not a dependent, so `delete()` leaves it behind: the page
deletes the groove box explicitly after the device, or every later render copies an orphan. For Arpeggio and Spielwerk-echo the
region's events are replaced too (the region is created once; events are cleared and
rewritten per scenario in `editing.append()` after the device transaction).

Two kinds of row:

- **Pass-through rows** (Pitch, Velocity, Spielwerk forward, Spielwerk yield, and each
  device once more with `enabled` false; the disabled Spielwerk row carries the *echo*
  script, since a disabled forward script is indistinguishable from an enabled one): judged by `bestLag(dry, effect, ±2400)` on the left channel,
  as the PDC page does. Expected `lag 0`, `score ≥ 0.9`. A non-zero lag with a high score
  is the Compressor-shaped finding. A low score means the render differs in shape (a
  dropped or added note), reported as such.
- **Rule rows** (Arpeggio, Zeitgeist, Spielwerk echo): judged by onsets. Onsets are read
  with `firstOnsetIndex`, stepping past each detected onset by the burst length plus a
  margin (30 ms, bpm-independent; the echo copies are 120 pulses apart, 62.5 ms at 120 bpm,
  so a musical step would land on the next copy), threshold 0.05 of full scale. The dry row's
  first onset gives `instrumentOffsetFrames` = onset − `round(ppqnToSeconds(position) ×
  rate)`. For every expected position `p` the rule predicts, the expected frame is
  `round(ppqnToSeconds(p) × rate) + instrumentOffsetFrames`; the figure is `onset −
  expected` in frames and ms. Count checks ride along: onsets found versus notes the rule
  predicts (an arpeggiator that emits twice, an echo that drops a copy).

The expected positions come from pure functions in `src/lib/audit/midiEffectRules.ts`,
each mirroring the device's documented rule:

- `arpeggioSteps(holdFrom, holdTo, ratePpqn)` → `k × rate` for every `k` with
  `holdFrom ≤ k × rate < holdTo` (the device's `index * rate` absolute grid; a note whose
  start is at or before a grid line is in the stack at that line, so a two-beat hold from
  a grid line predicts eight steps including the first).
- `zeitgeistWarped(positions, amount, duration)` → each position through the SDK's own
  `GrooveShuffleBoxAdapter` / groove `warp`, read through the Zeitgeist device box's
  `groove` pointer so the page uses the exact mapping the engine ports. Downbeats of a
  cell map to themselves.
- `echoCopies(position, delay, repeats)` → `position + i × delay` for `i` in `0 … repeats−1`.

Tolerances, with their mechanism:

- Pass-through: `lag === 0`. The chain works in pulses and the instrument resolves the
  same pulses to the same frames in both renders; there is no rounding difference to allow.
- Rule rows: `|onset − expected| ≤ 1` frame. One frame is the pulse-to-frame rounding of
  the expected position; the burst's onset shape is identical across notes (same pitch,
  same attack), so the detector's crossing is at the same offset in every note. Anything
  past one frame is `investigate`, with the figure. If the first run shows the engine
  starts a voice at the quantum boundary rather than the sub-quantum offset, the register
  records that as the instrument's behaviour (it would appear in the *dry* row's own
  spacing too) and the tolerance is revisited with its cause named, never widened to fit.

Verdict per row: `as-predicted`, `investigate <figure>`, or `error <message>`. The page
also prints, for every row, `instrumentOffsetFrames` from the dry row so a reader sees
what the sampler itself adds (informative, not judged here).

### Measurement library (Node-testable, `src/lib/audit/`)

- `midiEffectRules.ts` — the expected-position functions above, plus `expectedFramesFor`.
  Tests: grid arithmetic at three bpm, Zeitgeist identity at amount 0.5 and the downbeat
  fixed point at 0.6, echo copies.
- `midiEffectPlacement.ts` — `onsetsOf(channel, rate, stepPpqn, bpm)`, `judgePassThrough`,
  `judgeRule`, `classifyRow`. Tests with synthetic bursts at known frames: a shifted burst
  reads its shift; a missing burst reads the count mismatch; a burst one frame off is
  `as-predicted`, two frames is `investigate`.
- `midiEffectScenarios.ts` — the device list, each device's parameter settings and its
  pattern builder, the Spielwerk scripts as string constants, the render length.
- `midiEffectArtifacts.ts` — row and summary types, `summaryFileName`, parser with a
  schema version.

Reuse, not duplicate: `bestLag` (`lagEstimate.ts`), `firstOnsetIndex` (`clickHead.ts`),
`renderOfflineSlice`, `midiEffectsFieldOf`, `createNoteRegion` / `createNoteEvent` through
the builders in `auditBuilders.ts` where they fit.

## Part 2 — the `&effect=` arm on the MIDI input alignment sweep

`midi-input-alignment-audit-debug-demo.html?scenario=…&bpm=…&effect=pitch|arpeggio`.

- `createMatrixContext` inserts the named device on the recorded Vaporisateur unit after
  the unit exists, in its own transaction, parameters in the next: Pitch at zero shift,
  Arpeggio at the factory defaults. Arpeggio is the device that rewrites the stream most
  (one held key becomes a run of sixteenths): if the recorder read post-effect, every row
  would show extra notes and wrong durations. Pitch is the pass-through control.
- The row and summary carry `effect: "none" | "pitch" | "arpeggio"` (summary schema bump;
  `parseMidiAuditSummary` reads the previous version with `effect` defaulting to `"none"`).
  `scripts/audit/midi-input-alignment/table.ts` prints the effect in the run line and
  in each cell label when it is not `none`.
- Verdicts are the existing ones, unchanged. The expectation is that an `effect` run's
  cell verdicts and medians match the same cell without the effect, inside the sweep's own
  repeat spread, and `notesRecorded === notesSent` on every row.
- Standing run: `?scenario=nominal-start&bpm=120&effect=arpeggio` then `&effect=pitch`
  (two cells, two repeats each, under a minute). Listed in root CLAUDE.md beside the MIDI
  sweep, and in `src/demos/midi/CLAUDE.md`'s reading recipe.
- The monitored sound during these runs is the effect's output; the page stays silent
  (master at the floor) as it does now, so this changes nothing a listener would notice.

## Register and docs

- `debug/2026-10-21-midi-effect-placement/note.md`: SDK pin, what a row measures, the
  per-device rule table above, the first run's table, status. Newest-first row in
  `debug/README.md`. The page's `DebugLinkBar` links the note.
- A section in `debug/2026-10-20-midi-input-alignment/note.md` for the `effect` cells, and
  the "Open items" line about MIDI effects updated with what was measured.
- Root CLAUDE.md "Build & Verification": one bullet for the placement page (run after SDK
  upgrades, expect every row `as-predicted`) and the `&effect=` addition to the MIDI sweep
  bullet. `src/demos/midi/CLAUDE.md`: a short section on MIDI effects as pull links, live
  notes entering at the sequencer, the recorder reading pre-effect, and where the harness
  lives. No version qualifiers outside `changelogs/` and `debug/`.
- README demo table is untouched (unlisted pages are not listed there); the source-tree
  listing gains the new lib files if it lists the audit libs individually.

## Constraints

- Repo rules apply: `editing.modify()` for box changes; effect insertion and parameter
  writes in separate transactions; the Spielwerk compile outside any transaction;
  `box.delete()` for a device with dependents (Zeitgeist's `GrooveShuffleBox`,
  Spielwerk's parameter boxes); Option API, no `?.` on Options; integer PPQN positions;
  `strict` TypeScript; tests in Node (jsdom only for components, none expected here).
- No edits under `src/` or `public/` while a browser run is in progress.
- Nothing in the PR names the fork or its trackers.
- `npm run typecheck`, `npx vitest run`, `npm run build` clean before the PR; the
  comprehensive PR review runs once the PR is open and Critical/Important findings are
  fixed before merge.

## Left to the builder

- Exact row ordering and labels in the `TestStep` table.
- Whether the five `enabled: false` rows share one render each or the page skips them
  behind a `?bypass=0` parameter when a run is slow; default is to run them.
- The burst's exact shape beyond "hard onset, over within 20 ms".
- Internal module boundaries inside `src/lib/audit/`, as long as the pure parts stay
  Node-testable and the page holds no measurement logic.
- Whether `scripts/audit/midi-effect-placement/table.ts` shares a reader with the MIDI
  sweep's table script.

## Open to the user

- Whether this PR acts on the three held upstream drafts (renames, "Waiting for a read"
  rows) or only records the result in the registers. Default: records only; the drafts
  wait for the user's read, per the repo's draft rule.

## Decisions made in the conversation

- Two arms, not three: offline render for the heard path (live and recorded are one chain
  in the engine), an `&effect=` control on the recording sweep for the recorder; the live
  heard arm is deferred.
- Devices judged against their own rule, never against the dry render's timing when the
  device is meant to move notes.
- Nano with a burst sample as the instrument (builder's call, stated here as the design's
  default; the reason is the identical onset shape per note).
