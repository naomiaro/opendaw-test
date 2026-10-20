<!-- Draft for andremichelle/openDAW. Not posted. Target: a new issue. -->

# A MIDI note played during the count-in is dropped, or snapped to the downbeat; the audio recorder keeps the same pickup

**SDK:** `@opendaw/studio-sdk` 0.0.176 (WASM engine), Chrome, macOS.

With a one-bar count-in, a key pressed and released inside the count-in bar never reaches the recording,
and a key still held when bar 1 starts is written at position 0 with only the part after the downbeat. A
pickup phrase (the notes a player leads in with) either vanishes or lands on the downbeat. The audio
recorder treats the same pickup differently: it captures from before the count-in and keeps that head in
the file behind the region's waveform offset, so a pickup played into a microphone can be revealed by
trimming the region start. The two recorders disagree about what a count-in means for what the player did
during it.

**Repro page (unlisted, Chrome, needs the macOS IAC Driver online in Audio MIDI Setup):**
https://opendaw-test.pages.dev/midi-input-alignment-audit-debug-demo.html?scenario=countin-start&bpm=all
— click Run. A Vaporisateur unit's MIDI capture is pinned to the IAC input; the page starts a recording
with a one-bar count-in and sends three notes on the IAC bus during the count-in bar: two short ones
(pressed at 15 % and 35 % of the bar, held 100 ms) and one pressed at 75 % of the bar and held half a bar,
so it is still down at the downbeat. The page reads the note regions off the box graph when the take ends.

| bpm | repeat | short notes recorded | held note recorded at | held note length (pulses) | expected length after the downbeat |
|---|---|---|---|---|---|
| 90 | 1 / 2 | 0 of 2 / 0 of 2 | position 0 / 0 | 974 / 974 | 960 |
| 120 | 1 / 2 | 0 of 2 / 0 of 2 | position 0 / 0 | 976 / 975 | 960 |
| 140 | 1 / 2 | 0 of 2 / 0 of 2 | position 0 / 0 | 980 / 985 | 960 |

Ten of ten repeats over two runs read the same: 0 of 2 short notes, the held note at 0 with its
post-downbeat part (the few pulses over 960 are the recorder's own placement offset). The pattern the page records after the downbeat is complete on the same rows
(48 of 48 notes), so nothing else about the take is affected.

**Read in the source (0.0.176):** `packages/studio/core/src/capture/RecordMidi.ts` — a note-on before a
take exists goes to `pendingNotes`; a note-off while it is pending deletes the entry; when the first
position tick creates the take, `flushPendingNotes` writes every still-pending key at position 0. The
audio side, `RecordAudio.ts`: the worklet captures from `prepareRecording` (before the count-in), the take
is anchored at `engine.recordingStart` and the head before it goes into `waveformOffset`, which the region
can be trimmed back over.

Write-up with the method and the full rows:
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-20-midi-input-alignment/note.md
