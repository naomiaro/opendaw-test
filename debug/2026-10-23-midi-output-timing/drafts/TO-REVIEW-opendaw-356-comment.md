# Draft — comment on openDAW#356 (hardware midioutput gets desynced all the time)

Status: TO-REVIEW. Nothing posted. Target: a comment on https://github.com/andremichelle/openDAW/issues/356.
Figures from `debug/2026-10-23-midi-output-timing/note.md` (runs A, B and C, 2026-10-23, SDK 0.0.177, Chrome 155,
macOS 15.6.1, 44.1 kHz). No suggested-fix section, per repo rule; the mechanism is described, the remedy is the
maintainer's. The last paragraph is the scope note the user asked for (the rewrite plan's phases name the input
side only). To read together with this: openDAW#491's jitter sentence (7–10 ms, attributed to the recorder) was
measured against one clock pair per repeat; the drift found here (±3 ms within a repeat) may be part of that
spread, and a short correction there may be due — the user's call, in the same sitting.

---

I measured where the SDK asks a hardware MIDI output to deliver each note, on the AudioContext clock, with a
harness that plays a note region through the MIDI Output instrument into the macOS IAC Driver and reads every
receipt back: https://opendaw-test.pages.dev/midi-output-timing-audit-debug-demo.html (Chrome, the IAC Driver
online, a real click on Run). Write-up with every envelope:
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-23-midi-output-timing/note.md

The reporter's case, 1/32 notes at 140 bpm, `delayInMs` 10, SDK 0.0.177, Chrome 155 on macOS:

**Idle main thread: on time.** Median 10.03–10.32 ms after the heard time of each note at 90, 120 and 140 bpm,
which is the box delay plus about 0.2 ms; spread under a quantum. The 24-ppq Clock, Start and SongPosition on the same device
(about 485 messages per repeat) change nothing measurable.

**Main thread blocked: every note rendered during the block is late by the rest of the block.** With an
80 ms synchronous task every 500 ms, the notes inside a block come out 25–81 ms late (median 60 ms), the
first note after a block is on the delay again. Measured the same in four repeats; the control arm (the same
pattern scheduled by the page with future timestamps) stays at 0.00 ms under the same blocks.

**A note whose on and off both render inside one block comes out off-before-on.** Two notes per repeat,
the same two every time: the release is sent with a timestamp earlier than the attack, so a synth gets the
release first and the note hangs. The others whose off renders after the block come out 16–27 ms shorter.

Why, as far as I can read it: the engine times each message as its offset inside the quantum being rendered
plus `delayInMs` and queues it; the worklet drains the queue into the `MIDISender` ring once per quantum and
posts a wake-up; `MIDIReceiver` reads the ring in that port's `onmessage`, adds the output latency, and
`Project.receivedMIDIFromEngine` sends at `performance.now() + relativeTimeInMs`. The timestamp's base is the
moment the main thread read the ring, so whatever delays that read lands on the note, in one direction, and
every message drained by one read shares the base. `delayInMs` moves all notes equally and absorbs none of
it. On a page with UI work, GC or a heavy frame, that is the erratic swing the report describes.

What the figure is: Chrome stamps an IAC receipt with the time the sender asked for, so this is the time the
SDK requested, not when the message physically left the Mac. A cable loopback into an audio input would add
that half. The engine figures above are read against a per-frame `getOutputTimestamp` pair: Chrome's
context ↔ performance relation moved by up to 6 ms within a single 10 s repeat on this machine, and against
one pair read at the start the same repeats read up to 12.9 ms (the envelopes carry both); the control's
0.00 is against the one pair its sends were built from.

One scope note on `plans/capture.md`: phase 5 says "closes #356 for input" and principle 1 ("the main thread
never infers timing from when it observed something") covers exactly the mechanism above, but no phase names
the output path (`receivedMIDIFromEngine`). As the plan stands, the figures above would still read the same
after it ships.
