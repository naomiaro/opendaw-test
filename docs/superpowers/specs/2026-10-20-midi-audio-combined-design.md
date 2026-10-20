# Combined MIDI + audio harness — design

Status: approved 2026-10-20 (builder check applied). Follows the MIDI input alignment audit
(`debug/2026-10-20-midi-input-alignment/note.md`).

## Intent

Show how far apart a player's two parts end up when they play a key and make a sound at
the same instant: the key recorded through the SDK's MIDI capture, the sound through a
microphone into an audio Tape. The MIDI sweep measured the key side (+32 ms late at 60 Hz)
and inferred the audio side from the audio recorder's arithmetic; nobody has recorded the
two together. This page does, through the air, the way a singer with a keyboard would,
and its figure is the one the user and a maintainer will read first: `partsApartMs`.

## Goals

- One unlisted page that runs unattended in Chrome on the laptop's built-in microphone and
  speakers, with the input and output devices as URL parameters so an interface is a
  parameter later.
- For each cell, a recorded key and a recorded click produced at the same heard instant,
  matched pairwise, with the distance between where they landed as the verdict figure,
  beside each recorder's own error against the heard grid.
- The microphone's path measured inside every run (a click-to-microphone round trip before
  the first repeat) and written on every row; no constant per machine.
- Each cell in two states: the SDK's recording input-latency preference at its default of
  zero, and set to the run's measured input part. The register says how far apart the parts
  are for a player who never calibrated and for one who did.
- A prediction written before the first run, from the MIDI sweep's model: about 8 ms apart
  uncalibrated and about 32 ms apart calibrated at 60 Hz with 23 ms output latency.

## Non-goals

- A manual mode where the user plays the keyboard and claps (follow-up; the deterministic
  page comes first).
- MIDI effects in the chain (its own harness, next).
- Judging the SDK's microphone input-latency handling beyond the two states above.
- Firefox and Safari.
- Filing anything upstream: the user's hold stands until this and the MIDI-effects harness
  have run.

## Anti-goals

- A calibration that reads the worklet clock. Chromium issue 442866743 (the worklet's
  `currentTime` / `currentFrame` stand still for a quantum while the main thread holds the
  graph lock; `process()` keeps its true rate) would put a quantum into the round trip at
  random. The routine stamps nothing with that clock.
- A figure that depends on the page's main-thread timing. Clicks are scheduled on the audio
  clock, MIDI notes on the Web MIDI clock, both ahead of time.
- A verdict that hides a lost note or a missing click behind a median.
- A click the metronome or the synth can be mistaken for.

## Constraints

- Chrome, HTTPS dev server, a real click to start; microphone permission is requested on
  that click. The IAC Driver online (as for the MIDI sweep). The room quiet enough for a
  6 kHz click at the laptop's speaker-to-microphone distance to stand 20 dB above the floor
  (the audio campaign's real-device runs saw 30 to 38 dB).
- Keep the Chrome window uncovered for the run (rows carry `frameGapMaxMs`).
- Unlisted page conventions, strict TypeScript, Node tests for every pure function, no SDK
  version numbers outside `debug/` and `changelogs/`, `npm run typecheck` clean, the repo's
  Option and adapter rules.
- Reuse before writing: the MIDI sweep's pattern, clock map, matching, figures, loopback
  sender, recorded-note reader and cell runner stages; the audio harness's onset detector,
  band split, take placement math (`measureTakeAlignment` or its pieces), loader waits and
  cleanup; the shared `buildFeatures` probe and `/__verify` sink.
- A full run (three scenarios, three repeats, two states) in one page load in under ten
  minutes.

## How it works (decided)

### Page and parameters

`midi-audio-combined-audit-debug-demo.html`, source in `src/demos/midi/`, library files in
`src/lib/audit/` named `combined*.ts`.

```
?scenario=<nominal-start|countin-start|janked-mid|all>&bpm=<n>[&repeats=<n>][&state=<default|calibrated|both>]
 [&bus=<substring>][&input=<substring>][&output=<substring>][&audible=1]
```

- `bpm` default 120 (one tempo; the MIDI sweep showed the term is a time, not pulses).
- `repeats` default 3. `state` default `both`.
- `input` / `output`: substrings of the audio input and output device labels; defaults
  pick the device whose label contains "MacBook" and "Built-in", else the first device.
  `output` is applied with `setSinkId` when the browser has it; the page refuses an
  `output` it cannot apply.

### Units

A Vaporisateur unit with its MIDI capture pinned to the IAC input (as the MIDI sweep), and
a Tape unit with its audio capture pinned to the chosen microphone, one channel, monitoring
off. The master is silenced unless `audible=1`.

**The metronome is off, in every scenario (my call, corrected after review).** The engine
sums the metronome into the output AFTER the master strip, so a −96 dB master does not
silence it; through the speakers it would be a broadband click on every beat, in the
microphone's take, at the same instants as half the pattern's clicks, and no band split
separates two clicks from one speaker. The count-in forces the metronome on regardless, so
`countin-start` also sets the metronome gain to the schema's floor for the run, and the
audio side counts onsets only inside the pattern's span (origin to the last click's
release); anything outside it is reported as `onsetsOutsideSpan`, not as extra clicks.
The MIDI sweep ran with an audible metronome under copy that said "silent"; this PR fixes
that copy and turns its metronome off outside the count-in too.

### The click and the key

The pattern is the MIDI sweep's (two bars of eighths, one of 1/32 notes). For each note the
page schedules the MIDI note on the IAC output at the performance time its heard position
is reached, and a click from its own oscillator on the SDK's AudioContext at the render
context time whose heard time is the same instant (the clock map's `contextSecAtPosition`
for the note's `onPpqn`; the heard time of a render time is that time plus the output
latency, which the two mappings share). The click is 8 ms of 6 kHz at −6 dBFS, the audio
harness's reference-click shape, connected straight to the context destination, bypassing
the master. The 1/32 bar's clicks are 107 ms apart at 140 bpm and 125 ms at 120, well
over the detector's resolution.

### The round-trip calibration (before the first repeat, once per run)

**It measures the path the Tape records through (my call, corrected after review).** A
source node's delay is set per node instance (the audio campaign's node-delay finding: two
nodes on one stream can sit a quantum apart, and the built-in path sat at 64 ms on some runs
and 88 ms on others), so a calibration through a second `getUserMedia` stream and its own
source node could differ from the SDK's chain by up to 24 ms inside one run, and the
calibrated state would be mis-set by exactly that. The calibration worklet therefore takes
its input from the armed capture's own output node (`CaptureAudio.outputNode`, the record
gain node, public in the installed release; the chain is armed at setup and kept pulled by
the SDK's keep-alive sink), the exact node the take is recorded from, and opens no second
microphone stream (which would also need the SDK's constraints — echo cancellation, noise
suppression and gain control off — or the speaker click reads as echo and is removed).

One `AudioWorkletNode` with one input (that node) and one output (to the context
destination). It emits three 6 kHz clicks a second apart by writing them into its output at
process-call indices it chooses, and detects each click's return on its input by the audio
harness's onset rule (band-split above 3 kHz, threshold relative to the noise floor measured
over the preceding half second). The round trip of a click is
`(detectCall − emitCall) × 128 + sampleOffset` frames, from the worklet's own call counter
and the sample index inside the detecting quantum. No `currentTime` or `currentFrame` is
read anywhere in the routine (Chromium 442866743). The worklet is connected, left to settle
for a second, measured, and disconnected; the SDK's chain is not touched. As attribution,
every default-state row prints its audio median beside `micInputPartMs`: the two should
agree to within the clamp jitter, and a row where they do not names the calibration, not
the SDK.

Figures: `micRoundTripMs` (median of three; the spread of the three on the row too),
`micInputPartMs = micRoundTripMs − outputLatencyMs`, and `micCalibrationClicksFound`
(a run with fewer than three found refuses to start; the card names the floor and the peak).

### The two states

The SDK resolves a take's input latency from the capture box's own `inputLatency` field
(seconds; −2 = inherit the preference) before the engine preference
(`InputLatency.resolve` in the SDK). The page writes the Tape's capture box field and
**never touches the engine preference**: the preference lives in the browser's
localStorage, shared by every page on the origin, and a leaked 40 ms would place every
other recording demo's takes early. The field lives in this page's in-memory project
and dies with it.

- `state=default`: the capture box's `inputLatency` set to `0` in a transaction.
- `state=calibrated`: set to `micInputPartMs / 1000`.

The state and the value applied (`inputLatencyAppliedMs`) are columns on every row; a cell
is (scenario, state). At page load the page reads the engine preference's current value
and refuses to run if it is not 0, naming it, so a preference some other page left behind
cannot colour the "default" state either; it does not change it.

### Scenarios

`nominal-start`, `countin-start`, `janked-mid`, as the MIDI sweep defines them (the jank is
the same between-frames block). Two captures record each repeat.

### Figures per repeat

From the MIDI side, the MIDI sweep's `RepeatFigures` unchanged (its own placement error
against the heard grid). From the audio side: each click found in the Tape's take (the
take's file read through its loader, band-split, onsets), placed on the timeline through
the region position and waveform offset the way the audio harness does, then matched to
its pattern note. **Matching anchors on the eighth bars (my call, after review):** in the
1/32 bar half a step is 62 ms at 120 bpm, and an uncalibrated audio side can be 65 ms late,
which would match every 1/32 click to the next note. So the eighth-note clicks are matched
first (half a step there is 125 ms), the median audio offset is taken from them, and the
1/32 clicks are matched with that offset subtracted; every error is then reported raw. A
lost click stays a lost click (no matching by order). Per click `audioErrorMs` against the
heard grid, and per matched pair
`partsApartMs = midiRecordedPpqn − audioRecordedPpqn` in ms. Per repeat: `clicksFound`,
`clicksMissing`, `clicksExtra`, `audioMedianMs`, `audioMaxAbsDevMs`, `partsApartMedianMs`,
`partsApartMaxAbsDevMs`, `partsApartP5P95Ms`, `micRoundTripMs`, `micInputPartMs`,
`inputLatencyPrefMs`, plus the MIDI sweep's provenance (`outputLatencyMs`, `heardLagMs`,
`frameIntervalMs`, `frameGapMaxMs`, `sampleRate`).

### Verdict per cell

`together` when every repeat has no missing or extra click and no MIDI integrity failure,
`|partsApartMedianMs|` within one render quantum, and `partsApartMaxAbsDevMs` within one
frame plus a quantum. `matches-known-defect` when every repeat sits inside a band computed
from the row: the MIDI side's expected late median (the MIDI sweep's formula) minus the
audio side's expected offset (`micInputPartMs − inputLatencyPrefMs`, i.e. what the SDK was
not told), with the MIDI sweep's margin; the band carries the clamp jitter. Else
`investigate` naming the figure. The audio side alone gets no verdict; its error is a
column.

### Artifacts and register

- Summary JSON to `/__verify/` as `combined-summary-<runToken>.json`, schema version 1,
  per-row counts validated on read; a table script
  `scripts/audit/midi-audio-combined/table.ts`.
- `debug/2026-10-20-midi-audio-combined/note.md`: harness, reading recipe, the prediction
  written before the first run, the bring-up tables for both states, the mic round-trip
  figures run by run (the audio campaign saw the built-in path jump between 64 and 88 ms
  between runs; this register records every run's value). A row in `debug/README.md`.
  Cross-links to and from the MIDI register.
- A Build & Verification bullet in the root CLAUDE.md; a section in `src/demos/midi/CLAUDE.md`.
- In the same PR: the MIDI sweep's metronome turned off outside the count-in and its
  "silent by default" copy corrected (the engine mixes the metronome after the master).

## Left to the builder

- File layout and how much of `midiInputCellRunner.ts` is shared versus mirrored for a
  two-capture repeat.
- The onset rule's exact threshold and the click-to-note matching window, within the audio
  harness's conventions.
- How the Tape's take is read back (loader wait, buffer, band split) — the audio harness's
  cell runner has every piece.
- Whether `setSinkId` is applied to the SDK's context or the page refuses a non-default
  output on a browser without it.
- The worklet's exact framing of the three calibration clicks and its noise-floor window.

## Follow-ups (not in this design)

- Manual mode: the user plays the keyboard and claps; the page reports the spacing it
  recorded.
- The interface arm once hardware arrives: `input=` / `output=` already name it; a cable
  loopback would separate the air path from the device's delay.
- MIDI effects harness.
