# MIDI Output Timing Audit — register & results

**Title:** MIDI Output Timing Audit — when the SDK asks a hardware MIDI output to deliver each note, on the AudioContext clock

**SDK Pin:** `@opendaw/studio-sdk@0.0.177` (installed npm package; WASM engine only)

**Upstream context:** [openDAW#356](https://github.com/andremichelle/openDAW/issues/356) "hardware
midioutput gets desynced all the time" (erratic lateness on a fast 303 pattern, Chrome 144; Andre:
"a regression, probably when implementing the WASM audio engine"), and the capture rewrite plan
[plans/capture.md](https://github.com/andremichelle/openDAW/blob/fe6910fae9e432759e24ebddbbe774db17249535/plans/capture.md)
(finding 4 and principle 1: timing must never be inferred from when the main thread observed
something; its phase 5 "closes #356 for input", and no phase names the output path).

**Posted (2026-10-23):** [Chromium 40726491 comment #16](https://issues.chromium.org/issues/40726491#comment16), the SDK-free signature of the
`getOutputTimestamp` wander this audit first saw (body: `drafts/posted-chromium-40726491-clock-drift-comment.md`).
Also posted 2026-10-23: [the comment on openDAW#356](https://github.com/andremichelle/openDAW/issues/356#issuecomment-6376276217) (body: `drafts/posted-opendaw-356-comment.md`).

**Harness:** unlisted debug demo
`midi-output-timing-audit-debug-demo.html[?arm=both|engine|page][&bpm=<n|all>][&density=32nd|8th|both][&bars=<1-8>][&repeats=<1-10>][&delay=<0-500>][&jank=none|mid|both][&jankMs=<10-500>][&transport=1|0|both][&origin=<2-8>][&bus=<substring>]`
on the dev server, Chrome on macOS, a real click on "Run audit", the IAC Driver online. The
summary JSON (`midiout-summary-<runToken>.json`) lands in `.verify-output/` via `/__verify`;
`node scripts/audit/midi-output-timing/table.ts [runToken]` prints the tables below.

**Measurement library:** `src/lib/audit/midiOutputParams.ts` (parameters, status classification),
`midiOutputPattern.ts` (the pattern, the jank schedule and labels), `midiOutputTiming.ts` (per-note and
per-repeat figures), `midiOutputVerdict.ts` (verdicts, the band table), `midiOutputArtifacts.ts`
(envelope), `midiOutputProject.ts` (the MIDI Output instrument, the `MIDIOutputBox`, the region, the
arm switch), `midiOutputCellRunner.ts` (one repeat); reused: `midiLoopback.ts`, `midiClockMap.ts`,
`midiInputCellRunner.ts` (anchor wait, frame watch).

**Design spec:** `docs/superpowers/specs/2026-10-23-midi-output-timing-design.md` (deleted in the PR
that completes this work, per repo convention; git history keeps it).

## What the SDK does (read off the installed engine and core, 2026-10-23)

1. The engine (Rust, `crates/engine/src/midi_output.rs`) times each outgoing note as its offset inside
   the quantum being rendered, in ms, plus `MIDIOutputBox.delayInMs` (schema default 10, range 0–500),
   and queues it. The worklet drains the queue every quantum into a `SharedArrayBuffer` ring
   (`MIDISender`, `timeMs | 0`) and posts a wake-up on a `MessagePort`.
2. On the main thread `MIDIReceiver` reads the ring in the port's `onmessage`, adds `outputLatency`
   (plus `compensationLatency`, from `EngineWorklet`), and `Project.receivedMIDIFromEngine` sends
   `MIDIOutput.send(data, performance.now() + relativeTimeInMs)`.
3. So the base of every output timestamp is the instant the main thread read the ring, not the
   quantum's render time. The delay between the render and the handler lands on the note as lateness,
   in one direction, and every note drained by one handler call shares one base. `delayInMs` shifts all
   notes equally and absorbs none of it.

## What a cell measures

A cell is one (arm, bpm, density, jank, transport) tuple, `repeats` times; the PAGE arm runs first in
each repeat, then the ENGINE arm, so the control and the figure share conditions.

Per repeat: the transport is reset; the output box's `id` is set for the arm (empty for the page arm,
which the engine interns to device −1 and queues nothing; the IAC output port for the engine arm);
the pattern is written as a note region at `&origin` (default bar 2); a recording is started with
NOTHING armed, which makes the engine stamp `recordingStart` (context time of the first recording
quantum's end + position) and record nothing; ONE `getOutputTimestamp` pair is read; the origin must
still be 300 ms ahead (`anchor-too-late` otherwise). The page arm then schedules every note with
`MIDIOutput.send` at the performance time its heard context time maps to; the engine arm schedules
nothing and the MIDI Output instrument plays the region. A `jank` cell blocks the main thread for
`jankMs` from the pattern's midpoint and every 500 ms until its end. The IAC input listener stamps
every receipt (`MIDIMessageEvent.timeStamp`); transport messages (Clock / Start / Stop / SongPosition)
are counted apart.

Per note: `errorMs` = the receipt stamp mapped back through the pair to the heard context clock,
minus the heard context time of the note's position, in ms. **Nothing is netted out.** The output
and compensation latency, the box delay, the quantum, the frame interval and the measured jank spans
ride on the row for attribution. Per repeat: median, the largest deviation from the median, p5–p95
width, late tail (p95 − median), missing / extra / stuck / velocity mismatches (integrity), the
transport count, the notes inside blocks and their own median.

**What the figure is, and is not.** On the IAC bus Chrome stamps a receipt with the time the sender
ASKED for (the input sweep's `loopbackDelayMs` read 0.000 on every note). So `errorMs` is "the time
the SDK computed for this note" against the correct heard time: exactly the main-thread-base error
described above. It is NOT when the message physically left; a clean row says nothing about whether
Chrome's CoreMIDI backend delivers late or jittery. "Does the hardware actually sound on time" needs a
real interface and an audio capture: a separate hardware session.

**Verdicts.** Page: `bus-true` when every repeat is clean and the median and the spread are within
1 ms; else `investigate` naming the figure, and every engine row of the tuple reads `not-judged: bus`.
Engine: `on-time` when clean, the median within half a quantum of `delayInMs` and the spread within a
quantum; `matches-known-defect` when a band in `MIDI_OUT_KNOWN_DEFECTS` (empty before the first run)
explains every repeat; else `investigate`. `?arm=engine` alone reads `not-judged: no-control`.

## Prediction (written 2026-10-23, before the matrix ran; copied from the design spec)

- PAGE arm: median 0.0 ± 0.1 ms, jitter 0, under jank unchanged (CoreMIDI delivers scheduled sends
  whatever the main thread does).
- ENGINE arm, no jank: median ≈ `delayInMs` + the ring-read hop (a few ms), `lateTailMs` of a few ms,
  `maxAbsDevMs` possibly above a quantum on a run with a GC pause; never early. With transport
  messages on, the same shape; if the handler's load matters, a wider tail than with them off.
- ENGINE arm, jank 80 ms: notes rendered during a block are stamped when the handler finally runs:
  errors up to ≈ 80 ms, several notes sharing one late base, the pattern's 107 ms step at 140 bpm 1/32
  making one or two notes per block late. `medianErrorInsideBlocksMs` ≫ `medianErrorMs`.
  [Correction after the run, the prediction kept as written: a 1/32 step at 140 bpm is 53.6 ms, not
  107, so one to two notes per 80 ms block was right for the wrong reason.]
- If the ENGINE arm reads `on-time` under jank, the mechanism above is wrong and the note says so.

## Harness check (smoke run, 2026-10-23, before the matrix)

`?repeats=1` in the user's Chrome 155 (44 100 Hz), envelope `midiout-summary-1792789473864.json`:

| arm | status | median ms | max dev ms | late tail ms | miss/extra/stuck/vel | transport msgs | heard lag ms |
|---|---|---|---|---|---|---|---|
| page | `bus-true` | 0.00 | 0.00 | 0.00 | 0/0/0/0 | 0 | 24.93 |
| engine | `on-time` | 10.19 | 0.79 | 0.46 | 0/0/0/0 | 485 | 25.40 |

The harness holds: the control reads zero, the engine arm lands on the 10 ms delay plus a 0.19 ms
hop on an idle main thread, 96 of 96 notes paired, the 24-ppq Clock counted apart. One repeat, no
jank: a harness check, not a row of the matrix.

## Harness finding before the matrix could be read: the heard-clock relation drifts within a repeat

The first matrix run (envelope `midiout-summary-1792789580116.json`, before the witness) read the engine arm
with sustained STEPS: in one repeat the last 16 notes all about +4 ms, a stretch mid-pattern about −2.5 ms,
against the one `getOutputTimestamp` pair read after the anchor. A late ring read can only make a note
later, never earlier, so a sustained early stretch cannot be the SDK's hop. The page arm cancels any drift
of the clock relation by construction (its sends and its receipts go through the same pair), the engine
arm does not (it stamps with Chrome's live `performance.now()` and `outputLatency`).

So the page gained a **drift witness**: every animation frame from the record request to the measurement it
reads `getOutputTimestamp()` and `outputLatency`; each note is read a second time against the live pair
nearest before its receipt (`errorLiveMs`), and the row carries the drift range (`pairDrift`). Measured
(`1792789992978`, 44.1 kHz, Chrome 155): the relation moved by up to **−3.26 … +2.88 ms within a repeat**
(10 s), `outputLatency` constant at 23.00 ms throughout, so the movement is in the context ↔ performance
mapping Chrome reports, not in its latency figure. Against the live pair the four engine repeats read
10.13 / 10.68 → **10.16 / 10.18** and 9.91 / 12.90 → **10.17 / 10.22**: on the 10 ms delay within 0.2 ms.

**Decision (ledgered as a ruling against the spec's one-pair rule):** the ENGINE cell is judged against the
live pair when the repeat sampled one; the PAGE cell stays on the one pair, which is what its sends were
built from (it is the bus check: a receipt must carry the time the page asked for). Both figures stay on
every row. The input alignment and combined harnesses use one pair per repeat too; their 3 ms-scale
readings carry this error, noted in "What remains".

## Results

All in the user's Chrome 155.0.8059.85 (macOS 15.6.1), 44 100 Hz, SDK 0.0.177, 2026-10-23, the IAC Driver
bus, `delayInMs` 10, origin bar 2, three bars of 1/32 notes at 140 bpm unless said otherwise. Columns: the
median per repeat against the one pair, the largest deviation from it, the late tail (p95 − median), the
inside-block median, then the LIVE-pair median per repeat and spread, the drift range, the integrity counts
(missing / extra / stuck / velocity, summed over repeats), the transport count.

### Run A — no jank, transport on and off (`1792789992978`)

| arm | transport | status | median ms (r1 / r2) | max dev | late tail | live median (r1 / r2) | live max dev | pair drift ms | miss/extra/stuck/vel | transport msgs |
|---|---|---|---|---|---|---|---|---|---|---|
| page | on | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | 0.02 / 0.02 | 0.02 | −0.01..0.05 | 0/0/0/0 | 1 |
| engine | on | `on-time` | 10.13 / 10.68 | 2.24 | 1.07 | 10.16 / 10.18 | 2.90 | −1.52..2.88 | 0/0/0/0 | 486 |
| page | off | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | −0.50 / 0.42 | 0.81 | −1.51..1.17 | 0/0/0/0 | 3 |
| engine | off | `investigate`* | 9.91 / 12.90 | 1.29 | 0.86 | 10.17 / 10.22 | 1.64 | −3.26..1.15 | 0/0/0/0 | 0 |

\* judged on the one pair at the time of the run (the verdict rule changed after it, see above); on the live
pair every engine repeat of this run is `on-time`.

- **On an idle main thread the SDK's hop is about 0.2 ms.** Live medians 10.16–10.22 against the 10 ms
  delay, spreads 1.6–2.9 ms (under or at a quantum, 2.90 ms at 44.1 kHz). The 24-ppq Clock plus
  Start / SongPosition (about 485 messages per repeat through the same ring and handler) changes nothing
  measurable.
- The page arm's one-pair figure is 0.00 by construction; its LIVE figure (−0.50 … 0.67) is the drift
  witness itself. The few transport messages on page rows (1–3) are the tail of the previous engine
  repeat's Stop / Clock arriving during the reset.

### Run B — jank: an 80 ms main-thread block every 500 ms from the pattern's midpoint (`1792790180843`)

| arm | transport | status | median ms (r1 / r2) | max dev | late tail | inside-block median | live median (r1 / r2) | pair drift ms | miss/extra/stuck/vel | transport msgs |
|---|---|---|---|---|---|---|---|---|---|---|
| page | on | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | −0.00 | 0.02 / 0.02 | −0.01..0.05 | 0/0/0/0 | 3 |
| engine | on | `investigate` | 10.18 / 9.57 | 71.22 | 21.06 | 60.46 | 10.19 / 10.15 | −0.01..2.83 | 0/4/4/0 | 487 |
| page | off | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | −0.00 | −0.46 / 0.67 | −0.46..1.39 | 0/0/0/0 | 2 |
| engine | off | `investigate` | 11.92 / 10.70 | 69.57 | 19.48 | 60.96 | 10.32 / 10.23 | −3.29..1.01 | 0/4/4/0 | 0 |

Per engine repeat (all four the same shape; six blocks of 80.0 ms measured, seven notes inside):

| transport, repeat | inside notes: min / median / max error ms | first-after notes | off-before-on |
|---|---|---|---|
| on, r1 | 25.99 / 60.46 / 81.40 | 10.10, 10.32, 9.91, 9.62, 9.98 | #77, #86 |
| on, r2 | 24.84 / 59.82 / 79.94 | 7.32, 8.27, 8.49, 7.90, 8.12 | #77, #86 |
| off, r1 | 24.75 / 60.96 / 80.88 | 12.80, 13.38, 13.21, 12.08, 12.40 | #77, #86 |
| off, r2 | 25.26 / 60.57 / 80.27 | 10.32, 11.47, 10.24, 9.83, 11.13 | #77, #86 |

- **The prediction held.** A note rendered inside a block is requested when the block ends: its error
  is the rest of the block plus the delay, 25 to 81 ms here, the maximum one block length plus the
  delay. The first note after a block is on the delay again. The page arm, under the same blocks,
  stays at 0.00: CoreMIDI delivers pre-scheduled sends whatever the main thread does.
- **New: a note whose on and off both render inside one block comes out off-before-on.** Both messages
  are drained by the same handler and stamped from the same `performance.now()` base plus their own
  in-quantum offsets; when the off's offset is the smaller, its timestamp precedes the on's, and Chrome
  sends the release before the attack. The page reads these as `stuck` (an on without a later off) plus
  `extra` (an off the pairing could not place): notes #77 and #86 in every repeat, deterministic
  because the blocks sit at fixed places in the pattern. A note whose off renders after the block
  comes out shortened by the on's lateness instead (duration error −16 to −27 ms on a 53.6 ms note).
  On a hardware synth an off-before-on is a hanging note.
- One page row carried a 6.7 s animation-frame gap (`frameGapMaxMs` 6667.98) with the window visible
  and the run unaffected (pre-scheduled sends); the cause was not found. Not an SDK finding.

### Run C — three tempi, two bars of eighths then one bar of 1/32, transport on, no jank (`1792790547367`)

Run with `&frameDriver=hidden-safe` (see "Harness notes"). Columns as in run A.

| bpm | arm | status | median ms (r1 / r2) | max dev | late tail | live median (r1 / r2) | live max dev | pair drift ms | miss/extra/stuck/vel | transport msgs |
|---|---|---|---|---|---|---|---|---|---|---|
| 90 | page | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | 0.04 / 2.26 | 2.25 | −0.01..2.84 | 0/0/0/0 | 2 |
| 90 | engine | `on-time` | 9.99 / 10.00 | 0.93 | 0.69 | 10.03 / 10.16 | 0.83 | −0.58..0.51 | 0/0/0/0 | 486 |
| 120 | page | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | −0.17 / 0.13 | 0.54 | −0.99..0.71 | 0/0/0/0 | 2 |
| 120 | engine | `investigate` | 11.70 / 10.06 | 6.10 | 1.72 | 10.29 / 10.15 | 4.83 | −3.19..0.58 | 0/0/0/0 | 486 |
| 140 | page | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | −2.86 / −0.01 | 3.30 | −5.91..0.58 | 0/0/0/0 | 3 |
| 140 | engine | `on-time` | 9.95 / 9.91 | 0.89 | 0.65 | 10.06 / 10.24 | 1.09 | −0.49..0.64 | 0/0/0/0 | 485 |

- Live medians 10.03–10.29 at every tempo and both densities: the idle-thread hop is tempo-independent.
- The 120 bpm `investigate` is a live spread of 4.83 ms on repeat 1 during a −3.19 ms drift excursion: the
  live pair is read once per frame (16.7 ms), so a step in the relation between two reads lands on the
  one or two notes in between. Its one-pair median (11.70) is the same excursion read the other way. Not
  the SDK: the page arm of the 140 bpm cell saw a −5.91 ms excursion in the same run with the engine arm
  `on-time` beside it.

### SDK 0.0.179 (2026-10-29): Run A again (`1793293547491`)

The release rewrote the engine's MIDI Output wiring (a MIDI Output can be an Instrument Composite
layer; a unit's node hands its held notes over on a rebuild, or ends them when its MIDI chain
changed). Same page and recipe as Run A (`?bpm=140&density=32nd&transport=both&repeats=2&frameDriver=hidden-safe`),
Chrome 156, 44.1 kHz, the IAC bus, a real click by the user.

| arm | transport | status | median ms (r1 / r2) | max dev | late tail | live median (r1 / r2) | live max dev | pair drift ms | miss/extra/stuck/vel | transport msgs |
|---|---|---|---|---|---|---|---|---|---|---|
| page | on | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | 0.03 / 0.02 | 0.02 | −0.00..0.05 | 0/0/0/0 | 3 |
| engine | on | `investigate` | 10.10 / 13.83 | 6.20 | 0.60 | 10.14 / 10.41 | 3.03 | −4.11..2.71 | 0/0/0/0 | 485 |
| page | off | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | −0.05 / 0.04 | 0.52 | −0.23..0.57 | 0/0/0/0 | 3 |
| engine | off | `on-time` | 10.25 / 10.22 | 0.90 | 0.47 | 10.34 / 10.29 | 0.96 | −2.95..0.59 | 0/0/0/0 | 0 |

- **The idle-thread hop is the 0.0.177 hop.** Live medians 10.14–10.41 ms against the 10 ms delay, every
  note delivered once at its velocity, 485 transport messages per repeat as before.
- The one `investigate` (`maxAbsDevLiveMs 3.03 > 2.9` on repeat 2 of the transport-on cell) is the
  one-off this register already reads as the clock relation: it sits in the widest drift range of the
  run (−4.11..2.71 ms), its one-pair median (13.83) is the same excursion read the other way, and its
  live median stays on the delay. Run A on 0.0.177 read that cell's live spread at 2.90 ms, the limit
  itself. Not a change in the SDK.

### SDK 0.0.179 (2026-10-29): Run B again (`1793294347876`)

`…&jank=mid`, 80 ms blocks every 500 ms from the pattern's midpoint, otherwise as Run A.

| arm | transport | status | median ms (r1 / r2) | max dev | late tail | inside-block median | live median (r1 / r2) | pair drift ms | miss/extra/stuck/vel | transport msgs |
|---|---|---|---|---|---|---|---|---|---|---|
| page | on | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | −0.00 | 0.02 / 0.02 | −0.01..0.05 | 0/0/0/0 | 2 |
| engine | on | `matches-known-defect` | 10.12 / 10.49 | 69.64 | 20.56 | 61.10 | 10.15 / 10.21 | −0.86..2.82 | 0/4/4/0 | 486 |
| page | off | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | −0.00 | 0.00 / −3.09 | −11.81..0.56 | 0/0/0/0 | 2 |
| engine | off | `matches-known-defect` | 10.13 / 10.14 | 71.07 | 20.84 | 60.85 | 10.28 / 10.24 | −2.86..0.64 | 0/4/4/0 | 0 |

- **`midi-out-main-thread-base` as on 0.0.177, to the note.** Inside-block medians 61.10 / 60.85 ms
  (0.0.177: 60.46 / 60.96), max deviation 69.64 / 71.07 (71.22 / 69.57), late tail 20.56 / 20.84
  (21.06 / 19.48), the same four off-before-on inversions per cell (extra = stuck = 4), live medians on
  the delay between blocks. The rewritten wiring did not move the timestamp base: it is still the ring
  read on the main thread.

### SDK 0.0.179 (2026-10-29): Run C again (`1793294955242`)

`?bpm=all&density=both&repeats=2&frameDriver=hidden-safe`, transport on, no jank.

| bpm | arm | status | median ms (r1 / r2) | max dev | late tail | live median (r1 / r2) | live max dev | pair drift ms | miss/extra/stuck/vel | transport msgs |
|---|---|---|---|---|---|---|---|---|---|---|
| 90 | page | `bus-true` | −0.00 / −0.00 | 0.01 | 0.00 | 0.05 / −8.92 | 8.94 | −15.47..2.23 | 0/0/0/0 | 2 |
| 90 | engine | `on-time` | 10.11 / 10.13 | 0.65 | 0.48 | 10.16 / 10.23 | 0.84 | −0.19..0.61 | 0/0/0/0 | 485 |
| 120 | page | `bus-true` | −0.00 / −0.00 | 0.01 | 0.01 | −0.03 / 0.01 | 0.52 | −0.24..0.54 | 0/0/0/0 | 1 |
| 120 | engine | `on-time` | 10.17 / 10.25 | 0.78 | 0.46 | 10.18 / 10.25 | 0.82 | −5.87..0.56 | 0/0/0/0 | 486 |
| 140 | page | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | 0.04 / −0.00 | 0.52 | −0.26..0.57 | 0/0/0/0 | 3 |
| 140 | engine | `on-time` | 13.49 / 10.17 | 3.33 | 0.61 | 10.34 / 10.22 | 0.97 | −4.87..0.54 | 0/0/0/0 | 486 |

- Every engine cell `on-time`, live medians 10.16–10.34 ms at every tempo and both densities (0.0.177:
  10.03–10.29, with one drift-driven `investigate` at 120 bpm). The 140 bpm one-pair median 13.49 on
  repeat 1 is a −4.87 ms drift excursion read on the one pair; the live median is 10.34. The 90 bpm page
  arm's −8.92 live figure is the drift witness itself (a −15.47 ms excursion), the page's one-pair figure
  0.00.

**Reading on 0.0.179, all three runs:** the rewritten MIDI Output wiring sends every note on the
`delayInMs` within half a quantum on an idle main thread, and the main-thread timestamp base
(`midi-out-main-thread-base`) is unchanged under jank. Nothing in this register moved.

### SDK 0.0.180 (2026-10-30): Runs A, B and C again

The release does not touch the MIDI Output device or its wiring (it reworks the capture side and adds
transport-jump reports to the engine, which do not change rendering). Same recipes, Chrome 156, 44.1 kHz
context, the IAC bus, the user's real clicks.

**Run A** (`1793397071386`, `?bpm=140&density=32nd&transport=both&repeats=2&frameDriver=hidden-safe`):

| arm | transport | status | median ms (r1 / r2) | max dev | late tail | live median (r1 / r2) | live max dev | pair drift ms | miss/extra/stuck/vel | transport msgs |
|---|---|---|---|---|---|---|---|---|---|---|
| page | on | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | 0.02 / 0.02 | 0.02 | −0.01..0.05 | 0/0/0/0 | 2 |
| engine | on | `investigate` | 10.08 / 10.50 | 2.29 | 0.79 | 10.10 / 10.16 | 3.53 | −1.58..2.26 | 0/0/0/0 | 486 |
| page | off | `bus-true` | −0.00 / −0.00 | 0.00 | 0.00 | −0.09 / −0.12 | 5.91 | −6.17..0.45 | 0/0/0/0 | 3 |
| engine | off | `on-time` | 10.34 / 10.20 | 1.00 | 0.49 | 10.21 / 10.22 | 1.01 | −8.87..0.54 | 0/0/0/0 | 0 |

The transport-on cell's `investigate` is the same one-off as on 0.0.179 (`maxAbsDevLiveMs 3.53 > 2.9` on
repeat 2): live medians on the delay (10.10 / 10.16), the live spread no wider than that repeat's drift
range (−1.58..2.26 ms, 3.84 ms) — the clock relation (Chromium 40726491), not the SDK.

**Run B** (`1793397163901`, `…&jank=mid`): both engine cells `matches-known-defect`
(`midi-out-main-thread-base`), inside-block medians 60.38 / 60.76 ms (0.0.179: 61.10 / 60.85), max
deviation 70.73 / 70.05, late tail 20.58 / 20.15, the same four off-before-on inversions per cell (extra
= stuck = 4), live medians on the delay between blocks (10.08–10.21); page cells `bus-true`.

**Run C** (`1793397256863`, `?bpm=all&density=both&repeats=2&frameDriver=hidden-safe`): every engine cell
`on-time`, live medians 10.10–10.28 ms (0.0.179: 10.16–10.34); every page cell `bus-true`. The 140 bpm
cell's one-pair median 13.02 on repeat 1 is a −3.00 ms drift excursion read on the one pair; its live
median is 10.28.

**Reading on 0.0.180, all three runs:** unchanged from 0.0.179 to within the run-to-run spread. Every note
on the `delayInMs` within half a quantum on an idle main thread; the main-thread timestamp base under jank
as before.

## Findings

1. **Confirmed, SDK: a note rendered during a main-thread block is requested late by the rest of the
   block.** Run B: 25 to 81 ms on 80 ms blocks, median ~60 ms, four repeats, both transport states; the
   first note after a block back on the delay; the page arm at 0.00 under the same blocks. The timestamp
   base is the moment the main thread read the ring (`MIDIReceiver.onmessage` → `performance.now()` in
   `Project.receivedMIDIFromEngine`). This is openDAW#356's mechanism on the output side, measured.
2. **Confirmed, SDK, new: off-before-on.** A note whose on and off both render inside one block comes
   out with the release timestamped before the attack (both drained by one read, stamped from one base
   plus their own in-quantum offsets). Two notes per repeat, the same two (#77, #86), four of four
   repeats. On a hardware synth a hanging note. A note whose off renders after the block comes out
   shortened by the on's lateness (−16 to −27 ms on a 53.6 ms note).
3. **Confirmed, SDK, benign: on an idle main thread the hop is ~0.2 ms** (live medians 10.03–10.32 against
   the 10 ms delay over 14 engine repeats, three tempi, both densities, transport on and off, spread under
   a quantum but for the drift episodes). The 24-ppq Clock and the transport messages on the same device
   change nothing measurable.
4. **Harness / Chrome: the heard-clock relation (`getOutputTimestamp`) moves by up to 6 ms within a 10 s
   repeat** on this machine (44.1 kHz, Chrome 155), `outputLatency` constant at 23.00 ms. Read against one
   pair, that drift is indistinguishable from an SDK offset of the same size; against a per-frame live pair
   it drops to the one or two notes between two reads. The engine's stamps follow the live relation. The
   input alignment and combined harnesses judge on one pair per repeat; their 3 ms-scale constant terms
   carry this. Characterised SDK-free the same day (Chromium 40726491, vendor register): the mechanism is
   the browser's, but the per-repeat frequency seen here was not reproduced without the SDK's engine.

### The band (`midiOutputVerdict.ts`, `MIDI_OUT_KNOWN_DEFECTS`)

`midi-out-main-thread-base`, applies to a janked cell, pinned on run B's four engine repeats (the test
holds their figures, and the verdict detail names the run): median (live where sampled) within a quantum
of `delayInMs`; at least one note inside a block; the inside-block median between `delayInMs + jankMs / 4`
and `delayInMs + jankMs + 1 quantum`; `maxAbsDevMs ≤ jankMs + 1 quantum`; the spread of the notes CLEAR
of every block within two quanta (run B's first-after notes read up to 3.4 ms off), so a second defect
beside the janked notes is not swallowed; no missing note, no velocity mismatch; `stuck == extra ==
stuckInsideBlocks ≤ notesInsideBlocks` (the inversion, and only the inversion). Every bound is computed
from the row's context. A janked cell that reads `on-time` would mean the base changed; a clean cell, a
cell with a late clear note or a stuck note outside the blocks is never swallowed (tests).

### What it does not say

- Nothing about physical delivery: the receipt stamp is the time asked for. A cable loopback into an
  audio input is the hardware session.
- Nothing about the notes right after a transport start (the region starts at bar 2 so the control can
  schedule ahead); a start-burst arm is a follow-up if the reporter's "desync" turns out to live there.
- Nothing about Chrome's CoreMIDI backend (Chromium 327611574).

### Harness notes

- **Keep the window frontmost and uncovered, or run with `&frameDriver=hidden-safe`.** On the SDK's own
  frame driver two runs lost repeats to `[the page was hidden during this repeat]`: `stop: isRecording →
  false timed out` and `record: waitForPositionSettled(0) timed out` are frame-driven waits, and Chrome
  stops frames for a covered window. Run C went through with the hidden-safe driver and no error row.
  One page row of run B carried a 6.7 s frame gap with its figures intact (its sends were pre-scheduled).
- The two pre-witness envelopes (`1792789580116`, `1792789677646`) are read with the live fields null
  (schema 1); their one-pair figures are in the first section. The smoke run is `1792789473864`.
- The page arm's transport count (1–3) is the previous engine repeat's Stop / Clock tail: those messages
  are stamped about `outputLatency + delayInMs` ahead, and the next repeat's reset and `loopback.clear()`
  follow the measurement at once, so the last of them land after the clear. Harmless, noted so it is not
  read as a leak of the arm switch (the page arm's box id is empty, and the engine queues nothing for it).

### What remains

- ~~A draft comment for openDAW#356~~ POSTED 2026-10-23 (https://github.com/andremichelle/openDAW/issues/356#issuecomment-6376276217), with runs A–C, the scope note on
  `plans/capture.md`, and the Chromium 40726491 reference: `drafts/posted-opendaw-356-comment.md`.
- ~~The `getOutputTimestamp` drift on its own page (no SDK)~~ DONE 2026-10-23, with a caveat: the mechanism is
  Chrome's (open tracker 40726491; 40693959 merged in names it) and shows SDK-free on
  `chromium-watched-issues-debug-demo.html?issue=clock-drift` (a 278-frame sawtooth every 4.5 s on a 48 kHz
  context over the 44.1 kHz device; single early steps at the device's rate), entered in the vendor register.
  NOT reproduced SDK-free: this audit's ±3 ms movement within most 10 s repeats at 44.1 kHz, with or without a
  60 % render load on the probe. The attribution of that wander to Chrome rests on the mechanism, not on a
  reproduction; a probe arm with the SDK's engine in the graph would settle it. A decision for the input
  alignment and combined harnesses (a live pair there too) remains.
- **Re-read openDAW#491's jitter sentence before anything new is posted.** #491 states a 7–10 ms jitter and
  attributes it to the MIDI recorder; it was read against one pair per repeat, and the drift measured here
  (±3 ms within a repeat) could be part of that spread. The 33 ms constant term is far larger than the
  drift and stands. If a correction is due, it goes beside the #356 comment so the two public texts agree
  on what Chrome contributes.
- A start-burst arm (an engine-only mode starting at bar 1, which the parser refuses today because the
  control cannot reach it) if the reporter's case points at the first notes after play.
- A cable-loopback hardware session for delivery time.

