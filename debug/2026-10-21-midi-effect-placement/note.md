# MIDI Effect Placement Audit — register & results

**Title:** MIDI Effect Placement Audit — does a MIDI effect in a unit's chain move where a note
sounds, and does one move where the recorder places a recorded note

**SDK Pin:** `@opendaw/studio-sdk@0.0.176` (installed npm package; WASM engine only)

**Harness:** unlisted debug demo
`midi-effect-placement-audit-debug-demo.html[?rate=48000|44100][&bpm=<n>][&device=all|pitch|velocity|arpeggio|zeitgeist|spielwerk][&sampleMs=<n>][&importMs=<n>]`
on the dev server, Chrome, a real click on "Run audit"; deterministic, no hardware, about
fifteen seconds. The summary JSON (`midifx-summary-<runToken>.json`, one record per row with
every onset) lands in `.verify-output/` via the dev server's `/__verify` sink;
`node scripts/audit/midi-effect-placement/table.ts [runToken]` prints the table below.
The recorded side is the MIDI input alignment sweep's `&effect=` arm
(`midi-input-alignment-audit-debug-demo.html?scenario=nominal-start&bpm=120&effect=arpeggio`,
then `&effect=pitch`), whose rows are in the second table.

**Measurement library:** `src/lib/audit/midiEffectRules.ts` (what each device's rule predicts),
`midiEffectPlacement.ts` (onsets, the two judgements), `midiEffectScenarios.ts` (rows,
patterns, Spielwerk scripts, the burst, every constant with its mechanism),
`midiEffectChain.ts` (device removal), `midiEffectArtifacts.ts` (summary schema). The sweep's
arm: `midiInputCalibration.ts` (`MIDI_EFFECT_ARMS`), `midiInputArtifacts.ts` (schema 3).

**Design spec:** `docs/superpowers/specs/2026-10-21-midi-effect-placement-audit-design.md`
(deleted in the PR that completes this work, per repo convention; git history keeps it).

## What a row measures

One Nano sampler plays a burst: a full-scale step for 10 ms, then a 10 ms linear fall to zero,
at the head of a one-second sample (the rest silence; see "Observation: a short sample never
loads" below for why it is not a 20 ms sample). Attack and release at the sampler's minimum
(1 ms), root key 60, loop off. Every note has pitch 60 and velocity 1, so the sampler never
repitches and every onset has the same shape. One note region at bar 1 (position 3840, two
beats long); bar 0 is silent, so the render's start is clear of every onset. The render is
offline (`renderOfflineSlice` from position 0, two bars plus a quarter second) at the page's
rate, with the live `AudioContext` created at the same rate.

The dry pattern is eight sixteenths on bar 1's first two beats, each held a thirty-second. It
is rendered once with no device, then once per row with the row's device inserted on the
unit's MIDI chain (one transaction), its settings written (a second), a Spielwerk script
compiled outside any transaction, and the device deleted after the render. A live key is
pushed into the same sequencer that plays the region (`crates/engine/src/audio_unit/params.rs`,
`note_signal_to_unit` → `push_raw_note_on`), so one render covers the effect side of live
playing as well as of playback.

Two judgements, by what the device is meant to do:

- **Pass-through rows** (Pitch at zero shift; Velocity at the factory values, which the engine's
  own formula makes an identity; a Spielwerk whose generator yields nothing, so the bridge
  forwards the input; a Spielwerk with `// @no-pass` that re-yields every note-on, the
  scheduler path; and every device once more with `enabled` false, the Spielwerk carrying the
  echo script since a disabled forward script is indistinguishable from an enabled one): the
  left channel against the dry render of the same run by normalized cross-correlation
  (`bestLag`, ±2400 frames). **Expected lag 0 at a score of at least 0.9.** The mechanism: the
  chain works in pulses and the instrument resolves the same pulses to the same frames in both
  renders, so there is no rounding to allow. A non-zero lag at a high score would be the
  Compressor-shaped finding (openDAW#482); a low score is a different render (a note dropped or
  added), reported as such. A silent render is an error, not a reading.
- **Rule rows** (Arpeggio, Zeitgeist, a Spielwerk echo): onsets, read as the first frame above
  0.05 of full scale and again 30 ms past each one, against the frames the device's rule
  predicts. The dry row's first onset gives `instrumentOffsetFrames` (what the sampler itself
  adds between a note's pulse and its first audible frame; 12–13 frames here, 0.25–0.27 ms),
  which is added to every expected frame. The count must match before any figure is read.
  **Tolerance 1 frame.** The mechanism, read in the engine: an instrument's render loop splits
  the quantum at each event's sample offset, computed as `s0 + floor(pulses_to_samples(position −
  p0))` (`crates/abi/src/lib.rs`, `render_instrument` → `dispatch_range`; the arithmetic in
  `crates/engine/src/lib.rs`, `sample_offset`), while the rule rounds the expected position to
  the nearest frame; a position whose fractional frame is at or past one half reads one frame
  late by that difference (at 44.1 kHz a sixteenth at 120 bpm is 5512.5 frames, so every
  other onset does), and the block start `p0` accumulates as a float sum per quantum, which
  can truncate an exact-frame position one frame early. Nothing in the pull chain quantizes an
  event to the quantum: there is no minimum sub-block, and a MIDI effect's output is resolved
  with the same offset arithmetic as a region note. The only events placed at a block start by
  design are raw live keys and audition notes (`crates/engine-env/src/note_sequencer.rs`,
  `position: from`).

The expected positions come from the device's documented rule, never from the dry render:

| device | notes in the region | rule | settings |
|---|---|---|---|
| dry | eight sixteenths, each held 120 pulses | the reference; its own deltas show the sampler's spacing | — |
| Pitch | as dry | timing passes through | semitones 0, cents 0, octaves 0 |
| Velocity | as dry | timing passes through | magnet strength 0, random amount 0, offset 0, mix 1 (factory) |
| Spielwerk, forward | as dry | the generator yields nothing; the bridge forwards the input verbatim | script in `midiEffectScenarios.ts` |
| Spielwerk, yield | as dry | `// @no-pass`, every note-on re-yielded unchanged: the scheduler path | script in `midiEffectScenarios.ts` |
| Arpeggio | one note at beat 1 held two beats | step `k` lands on the absolute grid `k × 240` for every `k` with `3840 ≤ k × 240 < 5760`: eight steps, the first on the note's own start (a note whose start is at or before a grid line is in the stack at that line; `crates/stock-devices/device-arpeggio/src/lib.rs`) | Up, 1 octave, rate index 9 (1/16 = 240 pulses), gate 1, repeat 1, velocity 0 (the engine then emits every step at velocity 1) |
| Zeitgeist | as dry | each position through the groove the device points at: cell starts (every 480 pulses) stay put, the off-beat sixteenth moves to the cell's Möbius-eased midpoint (`h` = 0.598 at amount 0.6: 240 → 287.04 pulses, 47 pulses = 24.5 ms later at 120 bpm). The page reads the warp through `ZeitgeistDeviceBoxAdapter.groove()`, the mapping the engine ports, and keeps the warped pulse as a float: the engine places the event at the float pulse, and a pulse is 33 frames at 90 bpm | amount 0.6, duration 480 (the factory's) |
| Spielwerk, echo | one note at beat 1 held 120 pulses | the studio's echo example with its parameters fixed: the original is forwarded, copies yielded at `position + i × 120` for `i = 1, 2`: onsets at 3840, 3960, 4080 | delay 120, 3 repeats, no decay |
| each device, disabled | as dry (the Spielwerk with the echo script) | left out of the pull chain entirely (`crates/engine/src/audio_unit/wiring.rs`, `wire_cluster`: a disabled MIDI effect is skipped) | as above, `enabled` false |

Verdict per row: `as-predicted`, `investigate <figure>`, or `error <message>`.

## Runs

### 2026-10-21, first runs (SDK 0.0.176, Chrome, macOS)

Run 1792609103407, 48 kHz, 120 bpm, every device:

```
row | status | figure | lag frames / score | onsets found / expected | max |delta| frames (ms)
dry | as-predicted | — | 0 / 1.000 | 8 / 8 | 0 (0.00)
pitch | as-predicted | — | 0 / 1.000 | 8 / 8 | —
velocity | as-predicted | — | 0 / 1.000 | 8 / 8 | —
spielwerk-forward | as-predicted | — | 0 / 1.000 | 8 / 8 | —
spielwerk-yield | as-predicted | — | 0 / 1.000 | 8 / 8 | —
arpeggio | as-predicted | — | — | 8 / 8 | 0 (0.00)
zeitgeist | as-predicted | — | — | 8 / 8 | 1 (0.02)
spielwerk-echo | as-predicted | — | — | 3 / 3 | 0 (0.00)
pitch-disabled | as-predicted | — | 0 / 1.000 | 8 / 8 | —
velocity-disabled | as-predicted | — | 0 / 1.000 | 8 / 8 | —
arpeggio-disabled | as-predicted | — | 0 / 1.000 | 8 / 8 | —
zeitgeist-disabled | as-predicted | — | 0 / 1.000 | 8 / 8 | —
spielwerk-disabled | as-predicted | — | 0 / 1.000 | 8 / 8 | —
run 1792609103407 | sdk 0.0.176 | 48000 Hz | 120 bpm | instrument offset 13 frames (0.27 ms) | device all | rows 13
```

Run 1792609158160, 44.1 kHz, 120 bpm: every row `as-predicted`; the dry, arpeggio, zeitgeist
and echo rows read a largest delta of −1 frame (−0.02 ms), the floor-versus-round case above
(5512.5 frames per sixteenth); instrument offset 12 frames (0.27 ms).

Run 1792609237227, 48 kHz, 90 bpm: every row `as-predicted`; the Zeitgeist off-beats +1 frame,
everything else 0; instrument offset 12 frames (0.25 ms). (An earlier 90 bpm run,
1792609179570, read the Zeitgeist off-beats 2 frames late because the page's rule rounded the
warped position to a whole pulse, 33 frames at 90 bpm; the rule now keeps the float pulse the
engine places the event at. A reading error on this side, not a finding.)

Peaks: every pass-through row's channel peak equals the dry row's (0.708), so the re-yielding
Spielwerk did not also forward (that would double each note's amplitude at an unchanged
correlation), and the disabled Spielwerk with the echo script yielded nothing.

### 2026-10-21, the sweep's effect arm (one session, nominal-start, 120 bpm, 44.1 kHz context)

| run | effect | status | median ms (per repeat) | max dev ms | missing/no-receipt/extra/stuck/collapsed | sent / recorded | duration error median ms |
|---|---|---|---|---|---|---|---|
| 1792609389351 | arpeggio | matches-known-defect | 33.33 / 33.34 | 9.37 | 0/0/0/0/0 | 48 / 48, 48 / 48 | 0.00, 0.00 |
| 1792609420445 | pitch | matches-known-defect | 33.33 / 33.33 | 9.89 | 0/0/0/0/0 | 48 / 48, 48 / 48 | −0.52, 0.00 |
| 1792609600837 | none | matches-known-defect | 33.33 / 33.07 | 10.41 | 0/0/0/0/0 | 48 / 48, 48 / 48 | −0.26, −0.52 |

With the Arpeggio on the recorded unit — the device that rewrites the stream the most, one
held key becoming a run of sixteenths — every row still records exactly the 48 notes sent, at
their sent lengths, on the same band and within the sweep's own repeat spread of the control.
The recorder reads the capture's raw note signals before the chain
(`packages/studio/core/src/capture/RecordMidi.ts`); what is heard while recording is the
effect's output, what is written is the key.

## Reading

- **No MIDI effect moves a note it is meant to pass through**, enabled or disabled: every
  pass-through row at lag 0, score 1.000, at both rates and at 90 bpm. There is no
  Compressor-shaped delay on the MIDI side.
- **Each device that moves notes moves them exactly where its rule says**, to the frame: the
  arpeggiator on the absolute grid including the first step on the note's own start, Zeitgeist
  to the groove's eased midpoint with the cell starts fixed, the Spielwerk echo's copies through
  the scheduler at `position + i × delay`. The one-frame deltas are the floor-versus-round
  mechanism named above and appear in the dry row's own spacing too.
- **An effect in the chain does not change where the recorder writes a note.**
- The sampler adds 12–13 frames (a quarter of a millisecond) between a note's pulse and its
  first frame above 0.05: one frame at envelope zero, then the 1 ms attack's quadratic ramp
  (`(k / attack)²`, `crates/stock-devices/device-nano/src/voice.rs`). Informative, the same for
  every note, netted out by the dry row.

## Observation: a short sample never loads (2026-10-21)

The first attempt used a 960-frame sample (the 20 ms burst alone). The sample manager's fetch
succeeded and the peaks stage fit returned no stage: `Peaks.findBestFit(numFrames, width =
1200)` returns an empty array when `numFrames / width ≤ 1` (`packages/lib/fusion/src/peaks/Peaks.ts`),
and the peak worker then reads `stages[0].shift` of nothing (`SamplePeakWorker.ts`,
`generatePeaks`: `const minMask = (1 << stages[0].shift) - 1`), which surfaces on the main
thread as `Unexpected error loading sample: TypeError: Cannot read properties of undefined
(reading 'shift')`, the loader in state `error`, the live worklet and the offline engine both
reporting `sample load failed`, and the render silent. Any sample of 1200 frames or fewer (25 ms
at 48 kHz, 27 ms at 44.1 kHz) is refused this way: a one-shot click, a short drum hit, or a
burst like this one cannot be used in a Nano, a Tape or a Playfield. The harness pads the burst
into a one-second sample.

Measured on two paths (2026-10-21, 48 kHz):

| switch | path | result |
|---|---|---|
| `?sampleMs=20` | the fetch path (`GlobalSampleLoaderManager`, the sample provider's buffer) | `#audit-state` = `error:sample load failed: Cannot read properties of undefined (reading 'shift')` before any render |
| `?importMs=20` | the recording import path (`SampleService.importRecording` → `importFile`, what a finished take goes through), a synthetic 960-frame take | `error:recording import of 20 ms (960 frames) failed: Cannot read properties of undefined (reading 'shift')` |
| `?importMs=1000` | the same, 48 000 frames | `recording import of 1000 ms (48000 frames): ok`, the audit runs |

The other two callers of the stage fit (`SampleStorage`, `CloudBackupSamples`) are read, not
run. Draft: `drafts/TO-REVIEW-openDAW-issue-short-sample-never-loads.md`.

## Status

**Standing regression check after SDK upgrades** (root CLAUDE.md, "Build & Verification"):
`?device=all` at the default rate, then `?rate=44100`; expect every row `as-predicted`. The
sweep's effect arm runs beside the MIDI input alignment sweep. First run clean on every row;
no placement finding to file.

## Open items

- The live *heard* arm (a key pressed, the sound measured through speakers or an output tap,
  with an effect in the chain) is not measured here. The engine routes live notes through the
  chain this page exercises, and places a raw live key at the start of the quantum it arrives
  in (2.67 ms at 48 kHz), which is the same with or without an effect. If a listener ever hears
  a live-only effect delay, the combined MIDI + audio harness can take the same `&effect=` flag.
- Composite (layered) instruments and per-cell effect replicas: not covered.
- The short-sample observation above is the one upstream draft from this harness.
