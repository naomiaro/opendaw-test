# MIDI Output Timing Audit — register & results

**Title:** MIDI Output Timing Audit — when the SDK asks a hardware MIDI output to deliver each note, on the AudioContext clock

**SDK Pin:** `@opendaw/studio-sdk@0.0.177` (installed npm package; WASM engine only)

**Upstream context:** [openDAW#356](https://github.com/andremichelle/openDAW/issues/356) "hardware
midioutput gets desynced all the time" (erratic lateness on a fast 303 pattern, Chrome 144; Andre:
"a regression, probably when implementing the WASM audio engine"), and the capture rewrite plan
[plans/capture.md](https://github.com/andremichelle/openDAW/blob/fe6910fae9e432759e24ebddbbe774db17249535/plans/capture.md)
(finding 4 and principle 1: timing must never be inferred from when the main thread observed
something; its phase 5 "closes #356 for input", and no phase names the output path).

**Harness:** unlisted debug demo
`midi-output-timing-audit-debug-demo.html[?arm=both|engine|page][&bpm=<n|all>][&density=32nd|8th|both][&bars=<1-8>][&repeats=<1-10>][&delay=<0-500>][&jank=none|mid|both][&jankMs=<10-500>][&transport=1|0|both][&origin=<1-8>][&bus=<substring>]`
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

## Results

(filled by the matrix runs below)
