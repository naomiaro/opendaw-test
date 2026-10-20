# Combined MIDI + Audio Audit — how far apart a player's two parts land

**Title:** Combined MIDI + Audio Audit — a key on the IAC bus and a click out of the speakers at the same heard instant, recorded by the SDK's MIDI capture and a microphone Tape

**SDK Pin:** `@opendaw/studio-sdk@0.0.176` (installed npm package; WASM engine only)

**Harness:** unlisted debug demo
`midi-audio-combined-audit-debug-demo.html?scenario=<nominal-start|countin-start|janked-mid|all>&bpm=<n>[&repeats=<n>][&state=<default|calibrated|both>][&bus=<substring>][&input=<substring>][&output=<substring>][&audible=1]`
on the dev server, Chrome on macOS, a real click on "Run audit" (microphone permission, MIDI
access, the AudioContext resume). Devices: the laptop's built-in microphone and speakers by
default; `?input=` / `?output=` pick others by label, so an audio interface is a parameter.
The IAC Driver online (as for the MIDI sweep). Keep the room quiet and the Chrome window
uncovered. Summary JSON (`combined-summary-<runToken>.json`) lands in `.verify-output/`;
`node scripts/audit/midi-audio-combined/table.ts [runToken]` prints the table.

**Measurement library:** `src/lib/audit/combinedClicks.ts` (click times, the input-latency
state), `combinedCalibration.ts` (the speaker-to-microphone round trip), `combinedAudio.ts`
(click placement, eighth-anchored matching, the pairs), `combinedVerdict.ts`,
`combinedArtifacts.ts`, `combinedCellRunner.ts` (one repeat); on top of the MIDI sweep's
`midiInput*.ts`, `midiClockMap.ts`, `midiLoopback.ts` and the audio harness's `bandSplit`
and `detectOnsets`.

**The MIDI side's register:** [`../2026-10-20-midi-input-alignment/note.md`](../2026-10-20-midi-input-alignment/note.md).

**Design spec:** `docs/superpowers/specs/2026-10-20-midi-audio-combined-design.md` (deleted
in the PR that completes this work, per repo convention; git history keeps it).

## What a cell measures

For every note of the MIDI sweep's pattern (two bars of eighths, one of 1/32 notes), the page
sends the key on the IAC output at the performance time its heard position is reached, and
schedules a click (8 ms of 6 kHz at −6 dBFS, straight to the context destination) at the
render context time whose heard time is the same instant. A Vaporisateur's MIDI capture,
pinned to the IAC input, records the keys; a Tape's audio capture, pinned to the microphone,
records the room. The master is silenced; the metronome is off in every scenario (the
engine mixes it after the master, so a silenced master would not have silenced it; the
count-in forces it on, so `countin-start` sets its gain to −∞ for the run and the runner
restores the flag and the gain it found).

**Calibration, once per run, before the first repeat:** one worklet, fed from the Tape
capture's own output node (the exact node the take is recorded from; a second microphone
stream would have its own node delay and could sit a quantum or a state away), emits three
6 kHz clicks into its output and records its input; both ends are stamped by the worklet's
own process-call frame counter and never by `currentTime` / `currentFrame` (Chromium
442866743: those stand still for a quantum while the main thread holds the graph lock). The
main thread finds each click with the audio harness's band split and onset detector. The
output latency is read after the clicks have played (Chrome's figure before output starts
is not the running one: 31 ms was read where 23 ms is live). Figures on every row:
`micRoundTripMs`, its spread over the three clicks, `micInputPartMs` = round trip − output
latency, `outputLatencyMs` at that moment.

**Two states, per cell:** the Tape capture box's own `inputLatency` field (seconds; the SDK
resolves it before the engine preference) set to 0 (`default`) or to the run's measured
input part (`calibrated`). **The engine preference `recording.inputLatency` is never written**
(it lives in localStorage, shared by every page on the origin); the page refuses to run if
another page left it non-zero.

**Per repeat:** the MIDI sweep's figures for the keys; for the clicks, the Tape's take read
through its loader, band-split, onsets placed on the timeline through the region position and
waveform offset, matched to the pattern with the eighth bars as the anchor (half a 1/32 step
is 62 ms at 120 bpm and an uncalibrated audio side can be 65 ms late, which would pair every
1/32 click with the next note; the eighth clicks are matched first, their median offset is
subtracted to match the 1/32 bar, every error is reported raw; a lost click stays lost, nothing
is matched by order; onsets outside the pattern's span, with slack of 0.1 s before and 0.25 s
after, are reported as `onsetsOutsideSpan`). Per pair, `partsApartMs` = where the key landed −
where the sound landed.

**Verdict per cell:** `together` when every repeat has no lost or extra click, no MIDI
integrity failure, `|partsApartMedianMs|` within a render quantum and its largest deviation
within a frame plus a quantum. `matches-known-defect` when every repeat sits within ±5 ms of
`expectedPartsApartMs = 2 × (outputLatency + compensation) − (frame − quantum) − (micInputPart −
applied)`, the two recorders' known shapes computed from the row's own figures. Before the
band, a `default`-state row whose audio median disagrees with the run's input part by more
than a frame plus a quantum names the microphone path (the built-in path has sat at 64 ms on
some runs and 88 ms on others), not the SDK. Else `investigate` naming the figure.

## Prediction (written before the first full run, 2026-10-20)

From the MIDI sweep's model (the key lands `2 × outputLatency − (frame − quantum)` past the
heard beat, +32 ms here) and the audio recorder's arithmetic (a sound lands late by exactly
the input latency the SDK was not told about, and on the heard beat when it was):

| state | expected `partsApartMs` at 60 Hz, 23 ms output latency | meaning |
|---|---|---|
| default | about `32 − micInputPart`: −9 ms at a 41 ms input part, −33 ms at 65 ms | the key lands BEFORE the sound |
| calibrated | about +32 ms | the sound is on the beat, the key 32 ms late |

Calibrating the microphone makes the two parts further apart, not closer, if the model holds.
The built-in path's input part has read 39–41 ms on most of the audio campaign's runs and
65 ms on others; this register records every run's value. The two smoke cells before the full
run read −30.6 (expected −33.9, input part 66.1) and +35.7 (expected +32.2) with the audio side
at −2.7 ms calibrated.

## Bring-up (2026-10-20)

Run `1792535824348`: `?scenario=all&bpm=120` (three scenarios, both states, three repeats,
18 rows), Chrome, 44.1 kHz context, display 60 Hz (frame 16.7 ms), `outputLatency` 23.0 ms,
input "MacBook Pro Microphone (Built-in)", output "MacBook Pro Speakers (Built-in)", bus
"IAC Driver Bus 1". Calibration: round trip **87.35 ms**, spread 0.00 over the three clicks,
input part **64.35 ms**, floor −85 dBFS, peak −9 dBFS. Six minutes.

| scenario | state | status | parts apart median ms (r1 / r2 / r3) | max dev ms | clicks found / missing / extra | MIDI median ms | audio median ms | mic round trip / input part / applied ms |
|---|---|---|---|---|---|---|---|---|
| nominal-start | default | matches-known-defect | -31.08 / -31.05 / -31.02 | 9.90 | 144/0/0 | 33.33 / 33.33 / 33.33 | 64.35 / 64.35 / 64.35 | 87.35 / 64.35 / 0.00 |
| nominal-start | calibrated | matches-known-defect | 32.81 / 32.81 / 32.75 | 8.92 | 144/0/0 | 32.82 / 32.82 / 32.81 | 0.06 / 0.00 / 0.00 | 87.35 / 64.35 / 64.35 |
| countin-start | default | matches-known-defect | -31.05 / -31.02 / -31.53 | 9.37 | 144/0/0 | 33.33 / 33.34 / 32.81 | 64.35 / 64.35 / 64.35 | 87.35 / 64.35 / 0.00 |
| countin-start | calibrated | matches-known-defect | 32.81 / 32.81 / 33.27 | 8.91 | 144/0/0 | 32.82 / 32.81 / 33.33 | 0.00 / 0.00 / 0.00 | 87.35 / 64.35 / 64.35 |
| janked-mid | default | matches-known-defect | -31.01 / -28.88 / -28.36 | 9.89 | 144/0/0 | 33.33 / 33.33 / 33.33 | 64.35 / 61.69 / 61.69 | 87.35 / 64.35 / 0.00 |
| janked-mid | calibrated | matches-known-defect | 35.71 / 35.71 / 35.99 | 9.09 | 144/0/0 | 33.07 / 33.07 / 33.34 | -2.65 / -2.65 / -2.65 | 87.35 / 64.35 / 64.35 |

### What the run says

- **Integrity:** 48 pairs on every row, 864 clicks found, none lost, none extra, no onset
  outside the span; the MIDI side 48 of 48 on every row (one lost release per `janked-mid`
  repeat on 5 of 6, its own band).
- **Uncalibrated (the player who never set an input latency):** the key lands **31 ms before
  the sound** (parts apart −31.0 … −31.5 ms on nominal and count-in; −28.4 … −31.0 on
  janked-mid). The audio median is +64.35 ms on 13 of 18 rows: exactly the input part the
  calibration measured, to the hundredth, so the audio recorder lands a sound late by
  precisely the microphone latency it was not told, and nothing else.
- **Calibrated (the input part on the capture box's field):** the audio median is **0.00 ms**
  on nominal and count-in (0.06 on one row): the sound lands on the heard beat. The key
  stays +32.8 ms late, so the parts sit **+32.8 ms apart**; janked-mid +35.7 ms with its
  audio at −2.65. Calibrating the microphone makes the two parts further apart, as the
  model said: the audio recorder is right and the MIDI recorder is not.
- **The prediction held** on every cell: expected −33.9 / +32.2 against measured −31.0 /
  +32.8 (the 2–3 ms residual is the MIDI sweep's known +0…+2.3 ms above its formula plus the
  audio side's quantum, below). 18 of 18 cells `matches-known-defect`; `together` is
  unreachable on this release.
- **Jitter is all on the MIDI side.** The audio side's largest deviation from its median is
  0.05 … 0.06 ms on 17 rows (2.65 on one): the clicks land within a sample or two of each
  other. The parts-apart deviation, 6.8 … 9.9 ms, is the MIDI recorder's clamp jitter
  unchanged from the MIDI sweep.
- **A one-quantum audio state (observed, not judged):** on `janked-mid` the audio median
  sits 2.65 ms earlier than on the other scenarios (−2.65 calibrated on 3 of 3, 61.69 instead
  of 64.35 uncalibrated on 2 of 3). 2.65 ms is 128 frames at 48 kHz, the microphone track's
  own rate on this machine (the audio campaign's real-device section), i.e. one quantum of
  the input chain's state; the jank sits where the chain is built. Inside the band; listed
  for the audio campaign, where the one-quantum lattice lives.
- **The round trip is stable within a run** (spread 0.00 over three clicks) and differs
  between runs: 87.2, 89.1 and 87.4 ms on the three runs today, against 62–65 ms on five of
  the audio campaign's six runs. The calibration is therefore per run, as designed, and
  every row says which value it ran under.
- **One 4.8 s frame gap** on nominal-start / calibrated / r1 (`frameGapMaxMs` 4761) with the
  window uncovered and the figures unaffected; every other row 26 … 166 ms (the 150 ms jank
  rows read 152 … 166). Not attributed; the row is clean and the next one normal.

### The headline, measured

On this machine, a player who records a keyboard part and a microphone part together on
this SDK gets them about 31 ms apart with the microphone uncalibrated and about 33 ms apart
calibrated, in opposite directions; the audio part is placed right, the MIDI part is placed
`2 × outputLatency − (frame − quantum)` late. This is the measurement the MIDI register's
"Against the audio recorder" section called inferred; it is inferred no longer.

### Open items

- The user's hold stands: no issue goes upstream before the MIDI-effects harness has run.
  The MIDI register's placement draft can now cite this section for its audio half.
- The one-quantum audio state under jank: a note for the audio campaign's register.
- The 4.8 s frame gap: watch for it on the next run.
- The interface arm when hardware arrives (`?input=` / `?output=`); a cable loopback would
  separate the air path from the device's delay.
- Manual mode: the user plays the keyboard and claps.
