<!-- Draft for andremichelle/openDAW. Not posted. Target: a new issue. -->

# Recorded MIDI notes land about 32 ms after the beat the player heard; recorded audio lands on it

**SDK:** `@opendaw/studio-sdk` 0.0.176 (WASM engine), Chrome, macOS, 60 Hz display, `outputLatency` 23 ms.

A MIDI note recorded through `RecordMidi` is written about 32 ms after the position the player heard
when the key went down. The offset is the same at 90, 120 and 140 bpm (so it is a time, not a pulse
count), the same with a count-in, from a mid-timeline start, across a loop wrap, and through a 150 ms
main-thread block at the start or in the middle. Recorded audio on the same machine lands on the heard
beat (the recording start-alignment sweep, netted medians within ±2 ms), so a key and a sound produced
together end up about 32 ms apart in the project.

Per note the error is not a single value: most notes sit at +32 … +35 ms, and a minority (1 to 17 of 48
per take, more at faster note rates) sit at +23 … +28 ms, up to a display frame earlier, with their
lengths longer by the same amount. The player hears the fast pattern of #356 "swung".

**Repro page (unlisted, Chrome, needs the macOS IAC Driver online in Audio MIDI Setup):**
https://opendaw-test.pages.dev/midi-input-alignment-audit-debug-demo.html?scenario=all&bpm=all
— click Run (about seven minutes). The page sends a pre-scheduled pattern on the IAC bus with future
Web MIDI timestamps (two bars of eighths, one bar of 1/32 notes, each held half its step), each note at
the performance time its heard position is reached: the engine's `recordingStart` stamp (the first
recording quantum's end on the context clock and the position at that instant) is mapped to the heard
clock through `AudioContext.getOutputTimestamp()`. Nothing is sent from a timer or a frame. A note's
expected position is the heard position at its Web MIDI receipt stamp; the error is recorded minus that.

| scenario | bpm | median error (two repeats) | largest deviation from the median |
|---|---|---|---|
| nominal-start | 90 / 120 / 140 | +33.3, +33.0 / +33.1, +33.3 / +33.0, +33.0 ms | 9.7 / 9.4 / 9.4 ms |
| janked-start | 90 / 120 / 140 | +32.6, +33.3 / +32.8, +32.8 / +33.0, +33.0 ms | 9.7 / 8.9 / 8.9 ms |
| janked-mid | 90 / 120 / 140 | +32.6, +32.6 / +32.8, +33.3 / +33.5, +33.0 ms | 9.0 / 8.3 / 9.4 ms |
| countin-start | 140 | +33.0, +33.0 ms | 9.4 ms |
| midtimeline-start | 90 / 120 / 140 | +33.3, +33.3 / +32.8, +33.3 / +33.5, +33.0 ms | 9.7 / 9.9 / 8.9 ms |
| loop-wrap | 90 / 120 / 140 | +32.6, +33.3 / +32.8, +32.8 / +33.5, +33.5 ms | 9.7 / 9.4 / 9.8 ms |

48 of 48 notes on every row; no note missing, doubled or stuck. `outputLatency` 23.0 ms; the lag the
output timestamp pair implies, measured on every row, 22.9 … 25.5 ms; animation frame interval
16.7 ms.

**Read in the source (0.0.176), consistent with the rows:** `packages/studio/core/src/capture/RecordMidi.ts`
writes `enginePosition + latency` with `latency = outputLatency + compensationLatency`, where
`enginePosition` is the rendered position the processor publishes (`core-wasm/src/processor.ts`); a
player hears the rendered position `outputLatency` later, so the heard position at a key press is
`rendered − outputLatency`, and the write lands `2 × outputLatency` past it. The rendered position the
recorder extrapolates from is read once per animation frame off a single-slot handoff the engine refills
right after each read (`packages/lib/std/src/sync-stream.ts`), so it is about a frame old when stamped
with `performance.now()`, which pulls notes early by about a frame less a quantum: 46 − 14 ≈ 32 ms, the
measured median. A note whose MIDI stamp precedes that per-frame read is clamped to the read
(`Math.max(0, min(stamp, now) − lastPositionTime)`), which is the early minority. `RecordAudio.ts` adds the
same latencies to the buffer head it skips, which places a sound at the heard position.

Write-up with the method, the per-note rows and the prediction written before the first run:
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-20-midi-input-alignment/note.md
