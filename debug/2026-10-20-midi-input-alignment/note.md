# MIDI Input Alignment Audit — campaign register & results

**Title:** MIDI Input Alignment Audit — where the SDK places a recorded MIDI note against the heard beat

**SDK Pin:** `@opendaw/studio-sdk@0.0.176` (installed npm package; WASM engine only)

**Harness:** unlisted debug demo
`midi-input-alignment-audit-debug-demo.html?scenario=<name|all>&bpm=<n|all>[&repeats=<n>][&bus=<substring>][&audible=1]`
on the dev server, Chrome on macOS, a real click on "Run audit". The loopback is a virtual
MIDI bus, the macOS IAC Driver (Audio MIDI Setup → Window → Show MIDI Studio → IAC Driver →
"Device is online"); the page refuses to run without an input/output pair whose names
contain `?bus=` (default `IAC`). The summary JSON (`midiaudit-summary-<runToken>.json`,
rows with per-note detail) lands in `.verify-output/` via the dev server's `/__verify` sink;
`node scripts/audit/midi-input-alignment/table.ts [runToken]` prints the table below.

**Measurement library:** `src/lib/audit/midiInputPattern.ts` (the pattern),
`midiClockMap.ts` (performance ↔ heard context clock, the recording anchor),
`midiInputAlignment.ts` (matching, figures, verdict), `midiInputRecorded.ts` (notes off the
box graph), `midiLoopback.ts` (IAC ports, pre-scheduled sender), `midiInputCellRunner.ts`
(one repeat), `midiInputCalibration.ts` (scenarios, tolerances with their derivations).

**Design spec:** `docs/superpowers/specs/2026-10-20-midi-input-alignment-audit-design.md`
(deleted in the PR that completes this work, per repo convention; git history keeps it).

## What a cell measures

Each repeat records a Vaporisateur unit whose MIDI capture is pinned to the IAC input
(a connected keyboard stays out). The page waits for the engine's recording anchor
(`engine.recordingStart`: the first recording quantum's END time on the context clock and
the position at that instant), maps it to the performance clock through
`AudioContext.getOutputTimestamp()` (the HEARD clock: the pair names the context time of
the audio leaving the device), and schedules the pattern on the Web MIDI output with
future timestamps, each note at the performance time its heard position is reached. Two
bars of eighths, one bar of 1/32 notes, every note held for half its step, pitches
cycling over 48 so no pitch is held twice. The main thread sends nothing in real time.

Per note: `expectedPpqn` = the heard position at the note's Web MIDI receipt stamp;
`placementErrorMs` = recorded − expected, in ms at the cell's bpm. Per repeat: the median
(a constant term), the largest deviation from the median and the p5–p95 width (jitter),
duration error, missing / extra / stuck / velocity mismatches (integrity). Per cell:
`aligned` when every repeat is clean and inside every tolerance; `matches-known-defect`
when the medians fall in a band this register pinned; else `investigate` naming the
failing figure.

**Nothing is netted out of the verdict figure.** The SDK's latency term
(`sdkLatencyTermMs` = output + compensation latency, what `RecordMidi` adds to a write
position), the context's output and base latency and the display frame interval ride on
every row for attribution. A constant offset outside tolerance is `investigate` until this
register characterizes it.

**Reported, not judged:** the note scheduled ON a loop end in `loop-wrap` (`wrapAdjacent`;
the SDK knowingly writes a key pressed between the loop end and the wrap update into the
old take) and the two unanchored notes sent during the count-in in `countin-start`.

**`loopbackDelayMs` on an IAC bus reads 0.000 on every note:** Chrome stamps a
`MIDIMessageEvent` from the IAC Driver with the CoreMIDI packet time, which for a
scheduled send is the scheduled time. The column is kept for a bus that delivers with a
delay of its own; here it says that the SDK sees exactly the stamp the page scheduled.

## Prediction (written before the first sweep, 2026-10-20)

Two mechanisms read off the SDK source before any row existed:

1. **Sign and domain of the latency term.** `RecordMidi` writes `enginePosition + latency`
   with `latency = outputLatency + compensationLatency`
   (`packages/studio/core/src/capture/RecordMidi.ts`, the `latency` constant and
   `writePositionAt`). `engine.position` is the RENDERED position (the processor publishes
   the raw state position; `core-wasm/src/processor.ts`). A player hears the rendered
   position `outputLatency` later, so the heard position at a key press is
   `rendered − outputLatency`; the recorder writes `rendered + outputLatency`, twice the
   output latency past the heard beat. `RecordAudio` goes the other way: it adds the same
   latencies to the buffer head it skips, which places a sound AT the heard position, and
   the recording start-alignment sweep measures that as aligned. The two recorders should
   therefore disagree by `2 × outputLatency` for the same performance.
2. **Frame-stale position base.** The engine→main-thread position is a single-slot
   handoff (`packages/lib/std/src/sync-stream.ts`): the engine refills it right after each
   read, the main thread reads once per animation frame, so the value `RecordMidi` stamps
   with `performance.now()` is about one frame old. Notes extrapolated from it land early by
   roughly `frameInterval − quantum`.

| display refresh | predicted median error (heard reference, outputLatency 23 ms) |
|---|---|
| 60 Hz | about +32 ms (46 − (16.7 − 2.9)) |
| 120 Hz | about +40 ms (46 − (8.3 − 2.9)) |

A measured offset that tracks this table across scenarios and tempi is the finding; one
that does not is a different finding. Either way the first sweep reads `investigate`,
which is the harness working.

## Bring-up (2026-10-20)

Run `1792528897972`: `?scenario=all&bpm=all` (two repeats, six scenarios, 90 / 120 / 140 bpm,
36 rows), Chrome, 44.1 kHz context (the device's rate), display 59.7 Hz, `outputLatency`
23.0 ms, `baseLatency` 2.9 ms, compensation 0, `sdkLatencyTermMs` 23.0. Seven minutes.
Smoke run `1792528705566` before it (one cell) read the same.

| scenario | bpm | status | median ms (r1 / r2) | max dev ms | missing / no receipt / extra / stuck | frame ms | detail |
|---|---|---|---|---|---|---|---|
| nominal-start | 90 | investigate | 32.99 / 32.64 | 9.38 | 0/0/0/0 | 16.70 | placementMaxAbsDevMs 9.38 > 3 on repeat 1 |
| nominal-start | 120 | investigate | 32.82 / 33.08 | 9.37 | 0/0/0/0 | 16.69 | placementMaxAbsDevMs 9.37 > 3 on repeat 1 |
| nominal-start | 140 | investigate | 33.26 / 33.04 | 9.38 | 0/0/0/0 | 16.71 | placementMaxAbsDevMs 8.26 > 3 on repeat 1 |
| janked-start | 90 | investigate | 33.34 / 33.33 | 9.72 | 0/0/0/0 | 16.69 | placementMaxAbsDevMs 9.72 > 3 on repeat 1 |
| janked-start | 120 | investigate | 33.08 / 33.34 | 9.90 | 0/0/0/0 | 16.70 | placementMaxAbsDevMs 9.12 > 3 on repeat 1 |
| janked-start | 140 | investigate | 33.04 / 33.04 | 9.82 | 0/0/0/0 | 16.66 | placementMaxAbsDevMs 9.82 > 3 on repeat 1 |
| janked-mid | 90 | investigate | 33.33 / 33.33 | 9.72 | 0/0/0/0 | 16.74 | placementMaxAbsDevMs 9.72 > 3 on repeat 1 |
| janked-mid | 120 | investigate | 32.55 / 32.30 | 9.63 | 0/0/0/0 | 16.75 | placementMaxAbsDevMs 9.63 > 3 on repeat 1 |
| janked-mid | 140 | investigate | 33.04 / 32.59 | 9.38 | 0/0/0/0 | 16.70 | placementMaxAbsDevMs 9.38 > 3 on repeat 1 |
| countin-start | 90 | investigate | 32.64 / 32.64 | 9.72 | 0/0/0/0 | 16.79 | placementMaxAbsDevMs 8.33 > 3 on repeat 1 |
| countin-start | 120 | investigate | 32.82 / 32.82 | 9.38 | 0/0/0/0 | 16.80 | placementMaxAbsDevMs 9.38 > 3 on repeat 1 |
| countin-start | 140 | investigate | 32.15 / 33.04 | 9.38 | 0/0/0/0 | 16.78 | placementMaxAbsDevMs 9.38 > 3 on repeat 1 |
| midtimeline-start | 90 | investigate | 32.64 / 33.33 | 9.72 | 0/0/0/0 | 18.57 | placementMaxAbsDevMs 9.72 > 3 on repeat 1 |
| midtimeline-start | 120 | investigate | 32.82 / 32.29 | 9.38 | 0/0/0/0 | 16.74 | placementMaxAbsDevMs 9.38 > 3 on repeat 1 |
| midtimeline-start | 140 | investigate | 32.15 / 32.59 | 8.93 | 0/0/0/0 | 17.59 | placementMaxAbsDevMs 8.92 > 3 on repeat 1 |
| loop-wrap | 90 | investigate | 32.64 / 32.64 | 9.03 | 0/0/0/0 | 16.83 | placementMaxAbsDevMs 9.03 > 3 on repeat 1 |
| loop-wrap | 120 | investigate | 32.82 / 32.29 | 9.38 | 0/0/0/2 | 17.88 | stuck 1 on repeat 1 |
| loop-wrap | 140 | investigate | 32.59 / 32.59 | 9.38 | 0/0/0/1 | 16.97 | placementMaxAbsDevMs 9.37 > 3 on repeat 1 |

(`stuck` in the three loop-wrap rows was a harness criterion defect, fixed in the same PR:
the pattern's last 1/32 overhung the take's region end by a few pulses because the whole
take sits 33 ms late; its duration was right. The criterion now also requires the recorded
length to exceed twice the sent length.)

### What the sweep says

- **Integrity:** 48 of 48 notes on all 36 rows; no missing, extra or stuck note; no
  velocity mismatch; every receipt arrived. The recording path loses nothing, in any
  scenario, at any of the three tempi, through a 150 ms main-thread block at the start or
  in the middle, across a count-in, from a mid-timeline start, and across two loop wraps
  (three takes each, take order read from the `Take N` labels).
- **Constant term, confirmed:** the median sits at +32.2 … +33.3 ms on every row, the same
  at 90, 120 and 140 bpm, so it is a time term and not a pulse term. The prediction for
  60 Hz was +32: `2 × 23.0 (sign and domain of the latency term) − (16.7 − 2.9) (frame-stale
  base)`. One display rate cannot separate the two mechanisms; the 120 Hz arm below does.
- **Jitter, characterized:** the largest deviation from the median is 7 … 10 ms on every
  row, the p5–p95 width 8 … 9 ms. The distribution is bimodal, not Gaussian: a main cluster
  at +32 … +35 ms and a second mode at +23 … +28 ms (between 1 and 17 of the 48 notes per
  row, the share rising with the note rate and in the scenarios where the main thread is
  busier), whose notes also carry a duration error of +6 … +11 ms because only the
  note-on moved. That is the recorder's clamp: a key whose Web MIDI stamp precedes the
  last per-frame position read is placed AT that read (`Math.max(0, min(stamp, now) −
  lastPositionTime)` in `RecordMidi.writePositionAt`; SDK test "starts a key stamped
  before the last playhead update at that update"), i.e. up to a frame early. Releases
  take the same clamp the other way (duration −7 … −11 ms on a few notes per row).
- **A release during a main-thread block is lost (new finding):** `janked-mid` at 140 bpm,
  both repeats, the eighth note at the jank instant (index 12, held 107 ms, the block
  150 ms) is written at the minimum length, 30 pulses, a duration error of −93 / −91 ms.
  Its note-on landed where the others did (+34 / +25 ms). Mechanism, inferred from the
  source and consistent with the row: the release's stamp fell inside the block; after
  the block a frame ran before the release handler and read the position slot, which
  still held the quantum written right after the pre-block read; the handler then clamped
  the release to that stale read, which is where the note-on had been placed, so the
  length collapsed to the minimum. At 90 and 120 bpm the same note read 240 ± 12 pulses:
  at 90 the note (167 ms) outlasts the block, at 120 (125 ms) the release's handler ran
  before a frame did on both repeats. Not a judged figure in this version (the duration
  tolerance catches it as `durationErrorMaxMs`), listed under open items.
- **Count-in notes** (two per `countin-start` repeat, sent 400 and 800 ms after the record
  request): never recorded, as the SDK intends (a key released inside the count-in is
  dropped). **Wrap-adjacent note** (`loop-wrap`): written into the OLD take at +13 … +16 ms
  on two of six rows and into the new take at +32 ms on the other four, as the SDK's
  `crossesLoopEnd` branch says.
- **`loopbackDelayMs` is 0.000 throughout** (see "What a cell measures").

### Against the audio recorder

The recording start-alignment sweep on this SDK places audio at the heard position
(netted medians within ±2 ms). This sweep places MIDI at the heard position + 32 ms on the
same machine. A key and a sound produced together therefore land about 32 ms apart in the
project at 60 Hz, and the prediction says about 40 ms at 120 Hz. The combined MIDI + audio
cell (follow-ups) is the direct repro.

### Loop-wrap, five repeats

Run `1792529433622`: `?scenario=loop-wrap&bpm=120&repeats=5`, after the `stuck` criterion fix.

| repeat | rec/sent | missing / extra / stuck | median ms | max dev ms | early-mode notes | dur max ms | takes | wrap-adjacent note |
|---|---|---|---|---|---|---|---|---|
| 1 | 48/48 | 0 / 0 / 0 | 32.82 | 10.42 | 12 | 10.94 | 3 | old take, +22.4 |
| 2 | 48/48 | 0 / 0 / 0 | 33.34 | 9.90 | 4 | 10.94 | 3 | new take, +33.9 |
| 3 | 48/48 | 0 / 0 / 0 | 32.82 | 9.38 | 10 | 13.54 | 3 | old take, +16.2 |
| 4 | 48/48 | 0 / 0 / 0 | 32.29 | 8.33 | 10 | 10.94 | 3 | old take, +13.5 |
| 5 | 48/48 | 0 / 0 / 0 | 32.82 | 8.85 | 5 | 9.90 | 3 | new take, +31.8 |

Same shape as the matrix; take order from the labels on every repeat.

### The band this register pins

`midi-late-60hz` in `MIDI_KNOWN_DEFECTS` (`src/lib/audit/midiInputAlignment.ts`): median
+28 … +38 ms, largest deviation up to 12 ms, largest duration error up to 15 ms (the same
clamp on releases), display frame interval 15 … 18 ms, any scenario. Fitted to the 41 rows
above (medians +32.2 … +33.3, max dev 7.0 … 10.4, duration max 7.6 … 13.5 outside the two
collapsed-release rows), with a margin of a quantum on each side of the median and of a
frame on the jitter. The collapsed release (−93 ms) falls outside it and reads
`investigate` on `durationErrorMaxMs`, as it should. A cell
inside it reads `matches-known-defect`; a release that moves the median or tightens the
jitter reads `aligned` or `investigate`, never silently the same. The band is only for
rows at 60 Hz: a row whose frame interval lies outside the range, or has none, misses it.
A 120 Hz band is added once that arm is measured.

### 120 Hz arm

_Not yet run. The display (Liquid Retina XDR) supports 120 Hz; the sweep above ran at
59.7 Hz. Set System Settings → Displays → Refresh Rate to 120 Hertz and re-run
`?scenario=all&bpm=120`; the prediction is a median near +40 ms, the difference to the
60 Hz rows being the frame-stale term._

### Open items

1. **Constant placement offset** (+32 ms at 60 Hz): characterized above, two mechanisms
   read from the source, one display rate measured. Draft an upstream issue once the 120 Hz
   arm has separated the two terms (or, if it cannot be run, with the 60 Hz figures and the
   source reading, labelled as such). The audio recorder's placement is the reference the
   issue can point at.
2. **Release lost inside a main-thread block** (`janked-mid`, 140 bpm, 2 of 2): a judged
   figure of its own (e.g. a `collapsed` count: duration at the minimum while the sent
   length was longer) would make it a verdict instead of a duration-tolerance failure;
   then an upstream issue with the row.
3. **Early-clamp jitter** (up to a frame, 1 … 17 of 48 notes per row): part of band 1's
   shape; whether it gets its own issue depends on how upstream wants the stamp handled.

### Follow-ups (not in this harness)

- Manual keyboard page: enumeration, hot-plug while armed, a played take against the
  metronome grid.
- MIDI output timing page on the same IAC loopback, the repro for
  [openDAW#356](https://github.com/andremichelle/openDAW/issues/356).
- `janked-mid-frame`: the block inside a frame ahead of the SDK's position read (a
  different mechanism from the between-frames block measured here).
- MIDI effects in the chain (arpeggio, pitch, Spielwerk): whether placement survives the
  effect and what each one adds.
- A combined cell: a MIDI capture and an audio tape recording the same pass, judged
  against each other as well as against the grid — the direct repro of the two recorders'
  disagreement.
