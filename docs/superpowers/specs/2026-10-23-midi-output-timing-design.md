# MIDI output timing audit — design

Status: design, 2026-10-23. Nothing built. Deleted in the PR that completes the work (git history keeps it).

## Intent

A generic harness that measures WHEN the SDK asks a hardware MIDI output to deliver each note, judged
on the AudioContext clock, so a claim like [openDAW#356](https://github.com/andremichelle/openDAW/issues/356)
("hardware midioutput gets desynced all the time", erratic lateness on a fast 303 pattern, Chrome 144)
can be validated with a figure instead of an ear, and so the upstream capture rewrite
([plans/capture.md](https://github.com/andremichelle/openDAW/blob/fe6910fae9e432759e24ebddbbe774db17249535/plans/capture.md),
finding 4 and principle 1: timing must never be inferred from when the main thread observed something)
has a measurement of the output side before and after it lands.

### What the SDK does today (read off the installed engine and core, 2026-10-23)

1. The engine (Rust, `crates/engine/src/midi_output.rs`) times each outgoing note as its offset inside the
   quantum being rendered, in ms, plus the `MIDIOutputBox.delayInMs` (schema default 10, range 0–500). It
   queues the message; the worklet drains the queue every quantum into a `SharedArrayBuffer` ring
   (`MIDISender`, which truncates `timeMs | 0`) and posts a wake-up on a `MessagePort`.
2. On the main thread `MIDIReceiver` reads the ring in the port's `onmessage`, adds `outputLatency`, and
   `Project.receivedMIDIFromEngine` (core `project/Project.ts`) sends
   `MIDIOutput.send(data, performance.now() + relativeTimeInMs)`.
3. So the base of every output timestamp is the instant the main thread read the ring, not the quantum's
   render time. The delay between the render and the handler (message latency, a busy main thread, GC) lands
   on the note as lateness, in one direction only, and every note drained by one handler call shares one
   base. `delayInMs` shifts all notes equally and absorbs nothing of it.

The harness measures that lateness and its spread. It does not change the SDK.

**What the figure is, and is not.** Chrome stamps a receipt from the IAC Driver with the timestamp the
sender ASKED for (the input sweep's `loopbackDelayMs` read 0.000 on every note). So the figure per note
is "the time the SDK computed for this note" against the correct heard time: exactly the main-thread-base
error behind #356. It is NOT when the message physically left, and a clean row says nothing about whether
Chrome's rewritten CoreMIDI backend (Chromium 327611574) delivers late or jittery. "Does the hardware
actually sound on time" needs a real interface and an audio capture: a separate hardware session.

## Goals

- Per note: the time the SDK asked the output to deliver it, read on the IAC loopback and mapped to the
  AudioContext clock, minus the heard context time of the note's timeline position. In ms, nothing netted.
- Two arms over one bus and one judgement: the ENGINE arm (the SDK's MIDI Output instrument playing a note
  region) and the PAGE arm (the same pattern sent by the page at the heard times, the control that proves
  the bus and the clock mapping).
- The reporter's case as the default cell: 1/32 notes at 140 bpm. Tempo, density, repeats, the box delay
  and a main-thread block as parameters.
- A verdict word per cell with the figures it was judged on, an envelope per run, the same run mechanics as
  the MIDI input alignment page.
- A prediction written in the note before the first run; the first run's rows pin the known-defect band.

## Non-goals

- No change or monkeypatch to the SDK (the user's decision, 2026-10-23): the engine arm runs the installed
  path as it is.
- No hardware delivery time: Chrome stamps an IAC receipt with the time the send asked for, so the page
  judges what the SDK REQUESTED. When a synth actually sounds needs a cable and an audio capture; a
  hardware session, out of scope.
- No audio capture, no analyser, no reference synth.
- No note-off accuracy beyond a duration column (reported, not judged).
- No MIDI transport messages (Start / Clock / SongPosition) judged; they are counted per repeat, and a
  parameter switches them off.
- Chrome only (Web MIDI; Safari has none, Firefox needs an add-on and sees no IAC toggle without a
  restart). Not a standing sweep yet; it joins the SDK-upgrade list once the first measurement is in the
  register.

## Anti-goals (what would make it a failure)

- A figure that nets the main-thread hop out, or any term, before the verdict. The raw figure is the finding.
- A page arm that does not read zero. If the control is off, nothing the engine arm says can be read.
- A verdict that reads `on-time` because the band was fitted to the run it classifies without saying so.
- Judging anything off `performance.now()` read by the page outside the one clock pair per repeat.

## Constraints

- Everything is judged on the AudioContext clock. Web MIDI forces the performance clock on `send()` and on
  `MIDIMessageEvent.timeStamp`; ONE `AudioContext.getOutputTimestamp()` pair per repeat, read right after the
  anchor, bridges both ways (`src/lib/audit/midiClockMap.ts`: `perfMsAtHeardContextSec`,
  `heardContextSecAt`). The pair is the heard clock: output latency is inside it, never added. `heardLagMs`
  rides on every row as the check on the pair, as on the input page.
- The anchor is the engine's recording-start stamp (`engine.recordingStart`: context time of the first
  recording quantum's end + position). The page starts a recording with NOTHING armed: `Recording.start`
  reaches `engine.prepareRecordingState` with zero captures (verified in core `capture/Recording.ts`), the
  engine enters recording, stamps the start and records nothing. Count-in off. `waitForRecordingStart` and
  `isFreshAnchor` from `midiInputCellRunner.ts` are reused.
- The IAC Driver is the bus (`pickIacPorts`, `midiLoopback.ts`): the page listens on the IAC input and
  stamps every receipt; the engine's `MIDIOutputBox.id` is the IAC OUTPUT port id, as the studio's
  `DeviceSelector` sets it. `sendTransportMessages` follows `&transport` (default on, the schema's and the studio's default); the Clock
  ticks are filtered by status byte and counted.
- No SDK patch, no `receivedMIDIFromEngine` override, no intercepted `MIDIOutput.send`, no read of
  `project.midiOutNotifier`: the IAC receipt is the only instrument, so the page measures what a hardware
  output would be asked for.
- Repo rules apply: real click on Run, `#audit-state[data-audit-state]`, verdict in `#verdict[data-verdict]`,
  envelope through `/__verify`, pure logic in `src/lib/audit/`, Node tests for every judgement, `strict`
  TypeScript, `npm run typecheck` clean, no edits under `src/` while a run is on.

## The page

`midi-output-timing-audit-debug-demo.html` (unlisted, `noindex`), source
`src/demos/midi/midi-output-timing-audit-debug-demo.tsx`, in the layout of
`midi-input-alignment-audit-debug-demo.tsx` (same theme, DebugLinkBar, Run button, status line, rows table,
per-cell verdict badge). DebugLinkBar links: the debug note, openDAW#356, the capture plan (the commit URL
above), the MIDI input alignment page.

### Parameters

```
?arm=both|engine|page        default both: the page arm runs first in each repeat, then the engine arm
&bpm=140                     any tempo 60–220; "all" = 90,120,140 (like the input page)
&density=32nd|8th|both       default 32nd (the reporter's case); "both" = two bars of eighths then one bar of 1/32
&bars=3                      pattern length in bars (1–8)
&repeats=2                   repeats per cell (1–10)
&delay=10                    MIDIOutputBox.delayInMs written for the run (0–500); the schema default is the default
&jank=none|mid               "mid": a synchronous 80 ms block on the main thread at the pattern's midpoint,
                             repeated every 500 ms until the end (so several notes fall inside blocks)
&jankMs=80                   block length (10–500)
&bus=IAC                     substring of the IAC bus name, as on the input page
&transport=1|0               default 1 (the schema default and what the studio leaves on, so the reporter's
                             configuration): the engine's Start / SongPosition / 24-ppq Clock go through the same
                             ring, handler and base as the notes; counted per repeat, never judged. 0 switches them
                             off for the minimal-mechanism row. The first run covers both.
&origin=2                    the bar the pattern starts on (1–8), both arms; see "Pattern origin" below
```

Refused combinations throw before the run and show the reason (as the other pages do).

### Pattern origin

The page arm can only schedule once it holds the anchor, which reaches the page an engine write and at
least one animation frame after the first recording quantum, plus the pair read. A note at position 0 is
in the past by then; Chrome sends a past timestamp at once and the control would read late through no
fault of the bus. So the region starts at `&origin` (default bar 2: 1.71 s at 140 bpm, 2.67 s at 90) for
BOTH arms, which keeps the arms identical and the control honest. The notes right after a transport start
(the first drain after `prepareRecordingState`, the Start / SongPosition burst) are therefore NOT judged by
this design; if the first run's figures point there, a start-burst arm is a follow-up, not a parameter of
this page. A repeat whose anchor arrives later than the origin minus 300 ms is an error row
(`anchor-too-late`), never a late control.

### A cell

One (arm, bpm, density, jank, transport) tuple, `repeats` times. Per repeat:

1. **Project state.** One audio unit with `InstrumentFactories.MIDIOutput` (adapters
   `factories/InstrumentFactories`), its `MIDIOutputDeviceBox.device` referring to a `MIDIOutputBox` under
   `rootBox.outputMidiDevices` with `id` = the IAC output port id, `label` = its name, `delayInMs` = `&delay`,
   `sendTransportMessages` = `&transport`. A note region on the unit's track holding the pattern from
   position 0: pitches cycling over 48 so no pitch is held twice, each note held for half its step,
   velocities varied so a receipt can be matched to its note by pitch and compared by velocity, starting at
   `&origin`. Loop off.
   Built once per page load; a repeat rewinds and plays again. The PAGE arm uses the same project but the
   region's track is muted (or the unit's `MIDIOutputBox.id` set empty, which makes the engine skip
   queueing: an empty id interns to device −1); the builder picks whichever leaves the engine's timing
   path untouched for the ENGINE arm.
2. **Anchor.** `project.startRecording(false)` with nothing armed; wait for a fresh `recordingStart`;
   read ONE `getOutputTimestamp` pair; compute `heardLagMs`.
3. **Expected per note.** `expectedHeardCtxSec = contextSecAtPosition(anchor, bpm, note.onPpqn)`.
4. **PAGE arm.** Schedule every note with `MIDIOutput.send(data, perfMsAtHeardContextSec(pair,
   expectedHeardCtxSec))` (and its release), as `midiLoopback.ts` does today. Nothing else sends.
5. **ENGINE arm.** Nothing is scheduled by the page; the engine's MIDI Output instrument plays the region
   through the installed path.
6. **Jank.** With `&jank=mid`, the page blocks the main thread synchronously (`while (performance.now() <
   until)`) for `jankMs` starting at the pattern's midpoint and every 500 ms after, until the pattern ends.
   Each block's start and end (perf and mapped context time) is persisted so a note can be labelled
   "inside a block" / "first after a block" / "clear".
7. **Receipts.** The IAC input listener stamps every `midimessage` (`event.timeStamp`); transport
   messages (status 0xF8 / 0xFA / 0xFC / 0xF2) are counted apart. Receipts pair to notes by pitch within a
   window of the expected time (`pairReceipts`; the window covers `delayInMs` plus a full jank block plus one
   quantum, since the engine arm is late by the delay by design and `&delay=500` must still pair).
8. **Stop.** `engine.stopRecording()` after the pattern plus a bar; then `engine.stop(true)`.

### Figures per note (persisted in the row)

- `expectedHeardCtxSec`, `receiptPerfMs`, `receiptHeardCtxSec = heardContextSecAt(pair, receiptPerfMs)`
- `errorMs = (receiptHeardCtxSec − expectedHeardCtxSec) · 1000` — THE figure, raw
- `durationErrorMs` (release receipt minus expected release), reported
- `velocityMatch`, `jankLabel`

### Figures per repeat

- `medianErrorMs`, `maxAbsDevMs` (largest deviation from the median), `p5p95WidthMs` (jitter)
- `lateTailMs` = p95 − median (the hop's shape is one-sided)
- `missing`, `extra`, `stuck` (a note-on without its off), `velocityMismatches`, `transportMessages`
- `heardLagMs`, `outputLatencyMs`, `compensationLatencyMs` (the worklet adds both to the relative time;
  compensation is 0 unless delay compensation is active), `delayInMs`, `quantumMs`, `frameIntervalMs`
  (attribution, never netted)
- `jankBlocks` with their spans; `notesInsideBlocks`, `medianErrorInsideBlocksMs`

### Verdicts per cell (`midiOutputVerdict.ts`, pure, tested)

- **PAGE arm:** `bus-true` when every repeat is clean (no missing / extra / stuck / velocity mismatch) and
  `maxAbsDevMs` ≤ 1 ms (Chrome stamps a scheduled IAC send with the time asked for: measured 0.000 on the
  input page); else `investigate` naming the figure. A PAGE arm that is not `bus-true` marks every ENGINE row
  of the same run as `not-judged: bus`. A run with `?arm=engine` alone has no control: its engine cells
  carry their figures and read `not-judged: no-control`; the mode exists for debugging the page, not for a
  figure that goes into a note or a register.
- **ENGINE arm:** `on-time` when clean and `|medianErrorMs − delayInMs| ≤ ½ quantum` and `maxAbsDevMs` ≤ 1
  quantum; `matches-known-defect` when a band in `MIDI_OUT_KNOWN_DEFECTS` explains the repeat's median
  and tail; else `investigate`. The bands are EMPTY in the first commit. The note's prediction section
  (written before the first run) says what is expected; after the first run the bands are added from the
  measured rows, computed from the row's own figures (delay, quantum, jank length), and the note says which
  rows they were pinned on. A band never nets anything; it classifies a raw figure.
- A cell whose anchor was not fresh, whose pair was unusable, or whose receipts were empty is an error row
  with the stage named.

### Prediction (to be copied into the note before the first run)

- PAGE arm: median 0.0 ± 0.1 ms, jitter 0, under jank unchanged (CoreMIDI delivers scheduled sends
  whatever the main thread does).
- ENGINE arm, no jank: median ≈ `delayInMs` + the ring-read hop (a few ms), `lateTailMs` of a few ms,
  `maxAbsDevMs` possibly above a quantum on a run with a GC pause; never early. With transport messages on,
  the same shape; if the handler's load matters, a wider tail than with them off.
- ENGINE arm, jank 80 ms: notes rendered during a block are stamped when the handler finally runs: errors
  up to ≈ 80 ms, several notes sharing one late base, the pattern's 107 ms step at 140 bpm 1/32 making one
  or two notes per block late. `medianErrorInsideBlocksMs` ≫ `medianErrorMs`.
- If the ENGINE arm reads `on-time` under jank, the mechanism above is wrong and the note says so.

### Envelope

`midiout-summary-<runToken>.json` via `/__verify` (dev server only; saved name shown on the page):
`schemaVersion: 1`, `sdkVersion`, `chrome`, `date`, `runToken`, `params`, `sampleRate`, `cells[]` each with
`params`, `verdict`, `detail`, `repeats[]` (figures above + `notes[]`). A reader script
`node scripts/audit/midi-output-timing/table.ts [runId …]` prints the cell table (as the other audits have).

## Docs and registers (in the same PR)

- `debug/2026-10-23-midi-output-timing/note.md`: what a cell measures, the prediction (dated, before the
  first run), the first run's tables, findings with status, the band derivation, what remains. Index in
  `debug/README.md`.
- `src/demos/midi/CLAUDE.md`: the page, its parameters, the reading recipe, the clock rule.
- Root `CLAUDE.md` Build & Verification: one bullet, "after SDK upgrades, also run …", once the first
  measurement is in.
- `docs/known-vendor-issues.md`: no entry unless a run shows a Chrome behaviour; the hop is the SDK's.
- Upstream: a draft comment for openDAW#356 with the measured signature and the mechanism, as
  `debug/2026-10-23-midi-output-timing/drafts/TO-REVIEW-opendaw-356-comment.md`, listed under "Waiting for a
  read" in `debug/README.md`. No suggested-fix section. Not posted without the user's read.

## Left to the builder

- File names under `src/lib/audit/`: `midiOutputTiming.ts` (figures, pure), `midiOutputVerdict.ts`
  (verdicts, bands), `midiOutputCellRunner.ts` (browser: project state, anchor, arms, receipts),
  `midiOutputArtifacts.ts` (envelope types). Tests beside each pure file; the cell runner's browser half is
  not unit-tested, by repo convention.
- Reuse over rewrite: `midiLoopback.ts` (ports, scheduled sender, receipts), `midiClockMap.ts`,
  `midiInputCellRunner.ts` helpers (`waitForRecordingStart`, the jank blocker, the frame-interval witness),
  the input page's envelope upload and table components.
- The pattern builder (pitch cycle, velocities, 8th/32nd steps) can be the input page's with the velocity
  variation added; the builder checks before writing a second one.
- Whether the PAGE arm silences the engine by muting the track or by an empty `MIDIOutputBox.id`.
- The first run's band derivation and the note's tables.
