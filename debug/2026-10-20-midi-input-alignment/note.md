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
old take) and the three unanchored notes sent during the count-in in `countin-start`, each
with its own bus receipt so that "not recorded" is told apart from "never sent".

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
   latencies, plus the input latency, to the buffer head it skips, which places a sound AT
   the heard position by its arithmetic; the recording start-alignment sweep validated that
   arithmetic with a synthetic loopback, netted by the output latency (its signal never
   passes through the speakers), not with a sound and a key recorded together. The two
   recorders should therefore disagree by `2 × outputLatency` for the same performance — an
   inference until the combined cell measures it.
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
  row, the p5–p95 width 3 … 11 ms (it collapses to a quantum when fewer than three of the
  48 notes take the early mode). The distribution is bimodal, not Gaussian: a main cluster
  at +32 … +35 ms and a second mode at +23 … +28 ms (between 1 and 17 of the 48 notes per
  row, the share rising with the note rate and in the scenarios where the main thread is
  busier), most of which also carry a duration error of +6 … +11 ms because only the
  note-on moved; the rest had their release clamped as well. That is the recorder's clamp: a key whose Web MIDI stamp precedes the
  last per-frame position read is placed AT that read (`Math.max(0, min(stamp, now) −
  lastPositionTime)` in `RecordMidi.writePositionAt`; SDK test "starts a key stamped
  before the last playhead update at that update"), i.e. up to a frame early. Releases
  take the same clamp the other way (duration −7 … −11 ms on a few notes per row).
- **A release during a main-thread block is lost (new finding):** `janked-mid` at 140 bpm,
  both repeats, the eighth note at the jank instant (index 12, held 107 ms, the block
  150 ms) is written at the minimum length, 30 / 36 pulses, a duration error of −93 / −91 ms.
  Its note-on landed where the others did (+34 / +25 ms). Mechanism, inferred from the
  source and consistent with the row: the release's stamp fell inside the block; after
  the block a frame ran before the release handler and read the position slot, which
  still held the quantum written right after the pre-block read; the handler then clamped
  the release to that stale read, which is where the note-on had been placed, so the
  length collapsed to the minimum. At 90 and 120 bpm the same note read 240 ± 12 pulses:
  at 90 the note (167 ms) outlasts the block, at 120 (125 ms) the release's handler ran
  before a frame did on both repeats. In the re-run it was the 120 bpm cell that collapsed
  (both repeats, −109 ms) and the 140 bpm cell that did not: whether a frame runs before
  the release handler after the block decides it. Since the re-run it is the judged figure
  `collapsed` (a recorded length at the recorder's minimum while the sent length was longer
  than twice that), kept out of the duration figures, with a band of its own for
  `janked-mid` (`midi-late-release-lost`, then named `midi-late-60hz-release-lost`, one per repeat) so the cell no longer flaps
  between verdicts. A third run (`1792531208703`, `janked-mid` only) added the 90 bpm case:
  the note outlasts the block by 17 ms and was still written at 39 pulses (−140 ms), so the
  loss is not "the release fell inside the block" but "the first frame after the block reads
  a position as old as the block, and every release until the next frame extrapolates from
  it". `collapsed` therefore means written at less than half the sent length; 120 and 140
  bpm read the band on that run, 90 read `investigate` before the criterion was widened.
  Issue draft: `drafts/TO-REVIEW-openDAW-issue-release-lost-in-block.md`.
- **Count-in notes (reported, not judged; a finding against the audio recorder):** three
  per `countin-start` repeat since the re-run — two pressed at 15 % and 35 % of the
  count-in bar and held 100 ms, one pressed at 75 % and held half a bar so it is still down
  at the downbeat. On every row (10 of 10 repeats over two runs) the two short notes are
  dropped and the held note is written at position 0 with only its post-downbeat part
  (917 … 985 pulses for 960 expected). `RecordMidi` keeps a key pressed before the take
  exists in `pendingNotes`, deletes it on release, and flushes what is still down to
  position 0 when the take is created. The audio recorder captures from before the
  count-in and keeps that head in the file behind the region's waveform offset, so a
  pickup played into a microphone survives and can be revealed by trimming the region
  start. Issue draft: `drafts/TO-REVIEW-openDAW-issue-countin-pickup-notes.md`.
  **Wrap-adjacent note** (`loop-wrap`): written into the OLD take at +8 … +16 ms on
  four of six rows and into the new take at +32 … +34 ms on the other two, as the SDK's
  `crossesLoopEnd` branch says (the re-run had all six in the old take, the five-repeat
  run three old and two new).
- **`loopbackDelayMs` is 0.000 throughout** (see "What a cell measures").

### Re-run under the band (same day)

Run `1792530368624`, the same matrix after the review fixes (the band pinned, `stuck`
corrected, the count-in notes reported, `heardLagMs` on every row), display 60.0 Hz:

| scenario | bpm | status | median ms (r1 / r2) | max dev ms | missing / no receipt / extra / stuck / collapsed | frame ms | heard lag ms | count-in rec/sent |
|---|---|---|---|---|---|---|---|---|
| nominal-start | 90 | matches-known-defect | 33.33 / 32.99 | 9.72 | 0/0/0/0/— | 16.66 | 25.34 | 0/0 |
| nominal-start | 120 | matches-known-defect | 33.07 / 33.33 | 9.37 | 0/0/0/0/— | 16.70 | 25.39 | 0/0 |
| nominal-start | 140 | matches-known-defect | 33.04 / 33.04 | 9.38 | 0/0/0/0/— | 16.66 | 25.37 | 0/0 |
| janked-start | 90 | matches-known-defect | 32.64 / 33.33 | 9.72 | 0/0/0/0/— | 16.69 | 24.87 | 0/0 |
| janked-start | 120 | matches-known-defect | 32.82 / 32.81 | 8.86 | 0/0/0/0/— | 16.69 | 24.21 | 0/0 |
| janked-start | 140 | matches-known-defect | 33.04 / 33.04 | 8.93 | 0/0/0/0/— | 16.66 | 24.59 | 0/0 |
| janked-mid | 90 | matches-known-defect | 32.64 / 32.64 | 9.03 | 0/0/0/0/— | 16.69 | 25.39 | 0/0 |
| janked-mid | 120 | investigate | 32.82 / 33.33 | 8.33 | 0/0/0/0/— | 16.67 | 25.45 | 0/0 |
| janked-mid | 140 | matches-known-defect | 33.48 / 33.04 | 9.38 | 0/0/0/0/— | 16.70 | 25.40 | 0/0 |
| countin-start | 90 | investigate | 32.64 / — | 9.03 | 0/0/0/0/— | 18.03 | 25.09 | 1/3 |
| countin-start | 120 | investigate | — / 32.81 | 8.85 | 0/0/0/0/— | 16.74 | 25.09 | 1/3 |
| countin-start | 140 | matches-known-defect | 33.03 / 33.04 | 9.38 | 0/0/0/0/— | 16.76 | 25.10 | 2/6 |
| midtimeline-start | 90 | matches-known-defect | 33.33 / 33.33 | 9.72 | 0/0/0/0/— | 16.65 | 25.24 | 0/0 |
| midtimeline-start | 120 | matches-known-defect | 32.81 / 33.33 | 9.90 | 0/0/0/0/— | 16.68 | 25.19 | 0/0 |
| midtimeline-start | 140 | matches-known-defect | 33.48 / 33.04 | 8.93 | 0/0/0/0/— | 16.68 | 25.23 | 0/0 |
| loop-wrap | 90 | matches-known-defect | 32.64 / 33.33 | 9.72 | 0/0/0/0/— | 16.70 | 25.08 | 0/0 |
| loop-wrap | 120 | matches-known-defect | 32.82 / 32.82 | 9.38 | 0/0/0/0/— | 16.69 | 25.10 | 0/0 |
| loop-wrap | 140 | matches-known-defect | 33.48 / 33.48 | 9.82 | 0/0/0/0/— | 16.67 | 25.10 | 0/0 |

(`collapsed` reads `—` in this table: the figure did not exist when the run was written.)
Rows marked `band` carry the late band's detail (then named `midi-late-60hz`, now `midi-late`, computed per row). `janked-mid/120` read `investigate`
on the collapsed release (both repeats −109 ms; at 140 bpm, where run 1 had it, both
repeats read 240 this time) — the figure that is now `collapsed` with its own band. The
two `countin-start` repeats that errored (90 r2 hung in its stop stage for the outer
deadline, 120 r1 then could not settle the position for 30 s) have the shape of a stalled
animation-frame loop, the occluded-window hazard in the root CLAUDE.md; the window was
partly covered at the time (the user's account). A partly covered window keeps
`document.visibilityState` at `visible`, so since that run every row carries
`frameGapMaxMs`, the longest gap between animation frames during the repeat, and an error
row names a stall past one second as such. The cells were re-run with the window
uncovered, run `1792531058883`:

| countin-start | 90 | matches-known-defect | 33.33 / 32.99 | 9.37 | 0/0/0/0/0 | 16.78 | 25.19 | 2/6 |
| countin-start | 120 | matches-known-defect | 33.07 / 33.33 | 8.59 | 0/0/0/0/0 | 16.64 | 25.03 | 2/6 |
| countin-start | 140 | matches-known-defect | 33.04 / 33.04 | 8.93 | 0/0/0/0/0 | 16.80 | 25.26 | 2/6 |

`heardLagMs`, the output lag the clock pair implies, measured on every row: 22.9 … 25.5 ms
against `outputLatency` 23.0 ms, so the heard clock the expectation is built on lags the
render clock by what the SDK's own term says, plus about two milliseconds.

### Against the audio recorder (inferred, not yet measured together)

The recording start-alignment sweep validated the audio recorder's placement arithmetic
with a synthetic loopback, netted by the output latency, which by that arithmetic places a
real sound at the heard position. This sweep places MIDI at the heard position + 32 ms on
the same machine. If both hold, a key and a sound produced together land about 32 ms apart
in the project at 60 Hz. **Nobody has recorded the two together yet**: the combined
MIDI + audio cell (follow-ups) is that measurement, and the user's decision (2026-10-20) is
that no issue goes upstream before it and the MIDI-effects harness have run.

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

### The bands this register pins

`midi-late` (any scenario) and `midi-late-release-lost` (`janked-mid`, the same plus one lost
release per repeat) in `MIDI_KNOWN_DEFECTS` (`src/lib/audit/midiInputAlignment.ts`). They
are computed from each row's OWN figures, so they hold on any device or display: the median
must sit within ±5 ms of `2 × (outputLatencyMs + compensationLatencyMs) − (frameIntervalMs −
quantumMs)` (23 ms and 16.7 ms give 32.2 here; a 120 Hz display gives about 40; a 10 ms
interface at 60 Hz about 6), and the largest deviation and duration error within one frame
plus one quantum (19.6 ms here). The margin is fitted and says so: over the 92 medians in
`.verify-output/` (runs 1792528705566, 1792528897972, 1792529433622, 1792529607519,
1792530368624, 1792531058883, 1792531208703 and the one-cell checks) the measured median
sat 0 … +2.3 ms ABOVE the formula, a one-sided residual, furthest on rows with a slow frame
(18.6 ms); 5 ms is a quantum and change past that. The compensation half of the term was 0
on every row and is read from the engine, not measured. The rest is the mechanism. The
plain band is listed first, so a `janked-mid` cell that lost no release is labelled with it. A median that tracks the
formula on another machine is the same defect; one that does not is a finding, and so is a
release that changes the recorder (it reads `aligned` or `investigate`). The page's
configuration card prints what the formula yields on the machine it runs on.

### 120 Hz arm

_Not yet run. The display (Liquid Retina XDR) supports 120 Hz; the sweeps above ran at
60 Hz. Set System Settings → Displays → Refresh Rate to 120 Hertz and re-run
`?scenario=all&bpm=120`; the formula predicts a median near +40 ms, the difference to the
60 Hz rows being the frame-stale term, and the band follows the row's own frame interval,
so the cells read the band if the mechanism holds and `investigate` if it does not._

### Open items

**Hold (user's decision, 2026-10-20): no issue goes upstream until the combined MIDI + audio
harness and the MIDI-effects harness have been written and run.** The three drafts below
stay `TO-REVIEW` until then; the placement draft's audio half is inferred (above) and the
combined cell is its measurement.

1. **Constant placement offset** (+32 ms at 60 Hz): characterized above, two mechanisms
   read from the source, one display rate measured; the issue draft carries the 60 Hz
   figures and the source reading, labelled as such, and the 120 Hz arm can be added to
   it before posting. The audio recorder's placement is the reference the issue points at.
   Draft: `drafts/TO-REVIEW-openDAW-issue-midi-placement-late.md`.
2. **Release lost inside a main-thread block** (`janked-mid`: 140 bpm 2 of 2 in run 1,
   120 bpm 2 of 2 in run 2, 90 bpm 1 of 2 in run 3 with the release 17 ms after the
   block): judged as `collapsed`; issue draft written.
3. **Count-in pickups** dropped or snapped to the downbeat where the audio recorder keeps
   them: issue draft written.
4. **Early-clamp jitter** (up to a frame, 1 … 17 of 48 notes per row): part of band 1's
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
