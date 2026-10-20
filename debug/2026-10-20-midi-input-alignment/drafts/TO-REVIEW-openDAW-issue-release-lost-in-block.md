<!-- Draft for andremichelle/openDAW. Not posted. Target: a new issue. -->

# A key released during, or just after, a main-thread block is recorded far too short

**SDK:** `@opendaw/studio-sdk` 0.0.176 (WASM engine), Chrome, macOS.

A note whose release arrives during a main-thread block (150 ms here; a GC pause, a heavy layout, a
busy plug-in GUI), or within the frame after it, is written far shorter than the key was held — down to
`RecordMidi`'s minimum length, a 1/128 note. Its note-on lands where every other note does. The MIDI
stamps carry the true release time, so the length is recoverable in principle; it is lost because the
first animation frame after the block reads a playhead position as old as the block, and every release
until the next frame is extrapolated from it.

**Repro page (unlisted, Chrome, needs the macOS IAC Driver online in Audio MIDI Setup):**
https://opendaw-test.pages.dev/midi-input-alignment-audit-debug-demo.html?scenario=janked-mid&bpm=all
— click Run. The page records a pre-scheduled pattern over the IAC bus and fires a 150 ms synchronous
spin from a timer task at the instant of the eighth note in the middle of the pattern's bar two, so that
note's release (an eighth held half its step: 167 ms at 90, 125 ms at 120, 107 ms at 140 bpm) falls
inside the block at 120 and 140 bpm and after it at 90.

| run | bpm | the note at the block instant, both repeats |
|---|---|---|
| 1 | 90 | 252 / 241 pulses (sent 240) |
| 1 | 120 | 240 / 240 |
| 1 | 140 | **30 / 36** (−94 / −91 ms) |
| 2 | 90 | 253 / 247 |
| 2 | 120 | **30 / 30** (−109 / −109 ms) |
| 2 | 140 | 240 / 240 |
| 3 | 90 | **39** / 246 (−140 ms on the first) |
| 3 | 120 | 240 / **30** |
| 3 | 140 | **30 / 30** |

Whether it collapses depends on whether a frame runs before the release handler once the block ends,
which is why it moves between tempi from one run to the next. At 90 bpm the note outlasts the block by
17 ms and was still written at 39 pulses: the release's stamp is later than the post-block frame's
time, so it is not clamped, but the position that frame read is the one from the block's start, and
17 ms of extrapolation from there is all the note gets. The other 47 notes of the same takes are
unaffected.

**Read in the source (0.0.176), consistent with the rows:** `packages/studio/core/src/capture/RecordMidi.ts`
places a release at `writePositionAt(stamp)` = the last per-frame position read, plus the time from
that read to the stamp (a stamp before the read is clamped to it). The main-thread position is a
single-slot handoff the engine refills once after each read (`packages/lib/std/src/sync-stream.ts`), so
the first frame after a block reads the quantum written right after the pre-block read: the position of
the block's start, stamped with the post-block time. A release handled before the next frame is
extrapolated from there — a stamp inside the block is clamped to the block's start (the note-on's own
position, so the length is `MIN_NOTE_DURATION`), a stamp shortly after it gets only that much.

Write-up with the method and the full rows:
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-20-midi-input-alignment/note.md
