<!-- Draft for andremichelle/openDAW. Not posted. Target: a new issue.
     Written 2026-10-20 and HELD; brought up to date 2026-10-21 after both harnesses ran: the combined
     MIDI + audio cell (2026-10-20, debug/2026-10-20-midi-audio-combined/note.md) measured the two recorders
     together, and the MIDI effect placement audit (2026-10-21, debug/2026-10-21-midi-effect-placement/note.md)
     showed a MIDI effect on the unit changes none of the recorded figures. The title and the audio paragraph
     now rest on the combined measurement, and the order-of-fixes paragraph is in. Waits for the user's read. -->

# Recorded MIDI notes land about 33 ms after the beat the player heard; a sound recorded at the same instant lands on it once the audio input latency is calibrated

**SDK:** `@opendaw/studio-sdk` 0.0.176 (WASM engine), Chrome, macOS, 60 Hz display, `outputLatency` 23 ms.

A MIDI note recorded through `RecordMidi` is written about 33 ms after the position the player heard
when the key went down. The offset is the same at 90, 120 and 140 bpm (so it is a time, not a pulse
count), the same with a count-in, from a mid-timeline start, across a loop wrap, through a 150 ms
main-thread block at the start or in the middle, and the same with a MIDI effect (Pitch, Arpeggio) on
the recorded unit, since the recorder reads the capture's raw note signals before the chain.

Recorded together with audio, the two recorders disagree by that amount. A key on a virtual MIDI bus
and a click out of the laptop speakers were produced at the same heard instant and recorded in one
pass, the key through a Vaporisateur's MIDI capture, the click through a Tape pinned to the
microphone, the speaker-to-microphone round trip measured inside every run. With the Tape's input
latency left at 0, the key lands 31 ms *before* the sound (the audio late by exactly the microphone
path's input part). With the input latency set to that measured round trip, the sound lands on its
position to 0.00 ms and the key 33 ms after it. So by the recorders' own arithmetic, a key and a
sound produced together end up about 33 ms apart in the project once the audio side is calibrated.
The jitter of the pairing (7 to 10 ms) is all on the MIDI side.

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
| nominal-start, Arpeggio on the unit | 120 | +33.3, +33.3 ms | 9.4 ms |
| nominal-start, Pitch on the unit | 120 | +33.3, +33.3 ms | 9.9 ms |

48 of 48 notes on every row; no note missing, doubled or stuck. `outputLatency` 23.0 ms; the lag the
output timestamp pair implies, measured on every row, 22.9 … 25.5 ms; animation frame interval
16.7 ms.

**The combined cell (same machine):**
https://opendaw-test.pages.dev/midi-audio-combined-audit-debug-demo.html?scenario=all&bpm=120&state=both
— click Run; the laptop's built-in microphone and speakers, the room quiet. Six of six cells on the
figure above (key − sound: −31 ms with the Tape's input latency at 0, +33 ms with it at the measured
round trip).

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
same latencies, plus the capture's input latency, to the buffer head it skips, which places a sound at
the heard position once the input latency is set.

**On the order of changes:** with the audio input latency uncalibrated (the default on every machine
measured here), the two parts are 31 ms apart in the other direction, the audio late. A change to the
MIDI recorder alone would move an uncalibrated player's key and sound from 31 ms to about 64 ms apart.
Noted so the two sides can be read together; nothing here asks for a particular remedy.

Write-ups with the method, the per-note rows and the prediction written before the first run:
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-20-midi-input-alignment/note.md
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-20-midi-audio-combined/note.md
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-21-midi-effect-placement/note.md
