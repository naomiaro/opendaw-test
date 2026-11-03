<!-- Draft for the user's read. Target: a new issue on andremichelle/openDAW. Not posted. -->

# Zeitgeist moves note-offs as well as note-ons, so note durations change with the groove; the manual says they stay

**SDK:** `@opendaw/studio-sdk` 0.0.180 (WASM engine), Chrome, macOS.

The Zeitgeist manual's technical notes say (`packages/app/manual/public/devices/midi/zeitgeist.md`,
"3. Technical Notes"):

> Only note positions are affected, durations remain unchanged

The engine warps every event it passes, note-offs included, so a note's length changes with its place
in the groove cell: a note starting on the cell's downbeat gets longer when the groove swings (its
note-off sits in the stretched first half of the cell), the off-beat note gets shorter, and below 50 %
the reverse.

**Measured** (a Nano playing a sine, straight sixteenths each held a thirty-second — 62.5 ms at
120 bpm — through a Zeitgeist with Duration 1/8, the render read back note by note; the first four
notes of the bar):

| Amount | on-beat note, read length | off-beat note, read length | expected if durations stayed |
|---|---|---|---|
| 25 % | 26.4 ms | 63.6 ms | 62.5 ms |
| 50 % | 63.3 ms | 63.3 ms | 62.5 ms |
| 75 % | 124.0 ms | 38.9 ms | 62.5 ms |

The 0.8 ms above 62.5 at 50 % is the instrument's 1 ms release tail; the lengths at 25 % and 75 % are
not. The note positions move as the manual describes (the off-beat at 75 % lands 186.3 ms after the
downbeat instead of 125 ms); it is the note-offs that also move.

**Where it comes from:** `crates/stock-devices/device-zeitgeist/src/lib.rs`, `process` (lines
124–138 in the 0.0.180 tag): every record's position goes through `warp` regardless of its kind,
and the note-on's `duration` field is left as it was, so the instrument's note-off arrives at the
warped position of the original note-off. The TS `ZeitgeistDeviceProcessor` the crate mirrors did the
same, as far as the port's comments say.

**Repro page (unlisted, Chrome; deterministic, no hardware):**
https://opendaw-test.pages.dev/midi-effect-semantics-audit-debug-demo.html?rows=dry-sixteenths,zg-amount0.25-dur480-sixteenths,zg-amount0.5-dur480-sixteenths,zg-amount0.75-dur480-sixteenths
— a real click on Run; the 25 % and 75 % rows read `matches-known-deviation zeitgeist-warps-note-off`
against the manual's rule, the 50 % row holds. (The page goes live when the branch that carries it
merges.)

**Register and method:**
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-03-midi-effect-semantics/note.md
("Known deviations", `zeitgeist-warps-note-off`).
