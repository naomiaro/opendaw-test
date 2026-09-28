# A metronome click in flight when the transport stops resumes at the next play

**Verified against:** `@opendaw/studio-sdk` 0.0.172 (`crates/engine/src/metronome.rs`,
`crates/engine/src/lib.rs` at the `@opendaw/studio-sdk@0.0.172` tag; same code on 0.0.170).
**Status:** latent — found by code reading and a scratch unit test while chasing a listener
report during the 0.0.172 standing sweep (`debug/recording-start-alignment-audit.md`,
"Standing sweep on 0.0.172"); NOT what that listener heard (that was the harness's cell
cadence). **Repro page:** [`metronome-stale-click-debug-demo.html`](../metronome-stale-click-debug-demo.html)
(unlisted, self-classifying: control stop between clicks vs. stop inside a click, restart
head ratio). Issue draft `drafts/issue-metronome-click-survives-pause.md` (not posted).

## Symptom

Stop the transport (pause, stop, or the end of a recording) while a metronome click is
sounding — inside its ~50 ms body — and press play again: the remainder of that click plays
at the moment playback resumes, on top of whatever the new position plays. With a downbeat at
the new position it is heard as a doubled/thickened first click; elsewhere as a stray click
tail.

## Mechanism

`Metronome::process` is called from `render` only while `transport.is_playing()`. It keeps
active clicks in `self.clicks` and advances them in `retain_mut(process_add)` at the end of
every call. `Engine::pause`, `Engine::stop` and `Engine::stop_recording` reset the recording
flags and the transport (and `stop` resets every plugin and clears the bus buffers) and re-apply
the metronome's enabled state (`apply_metronome()`), but never clear `self.clicks`, so a `Click` whose `position` is inside its sound stays in the list,
frozen, until the first render after play — where it continues from where it was. In the
default monophonic mode the new click's `fade_out()` shortens the stale one to 5 ms;
polyphonic mode sums both.

## Evidence

Scratch unit test appended to `metronome.rs` at the 0.0.172 tag (not committed; the checkout
was reverted), 1 s DC click sounds at 0 dB, 48 kHz, 120 BPM: process one block at pulse 0
(one click starts, output 1.0 for the block); call nothing (the pause); process a block at
pulse 0 again — `clicks.len() == 2` and output sample 0 is `2.0`. With `monophonic` left at
its default, sample 0 is `2.0` and sample 127 is `1.47` (the stale click fading over 5 ms).

Not exercised by the standing sweep: the harness's stop requests land 11–53 ms after a beat
click and the stop round trip adds ~30–70 ms, so the click has ended by the time the transport
stops; every cell head in the sweep's speaker-feed tee and in an acoustic recording is a single
click.

## Repro (manual, studio)

Metronome on, play, press stop as a beat sounds, press play again — the stopped click's tail
sounds at the new start.

## Repro (page)

`metronome-stale-click-debug-demo.html` (source `src/demos/engine/metronome-stale-click-debug-demo.tsx`,
helpers `src/lib/audit/clickHead.ts`) records the engine's output through `initializeOpenDAW`'s
`engineTap` (an AudioWorklet recorder on output 0, chunks stamped with context time) and runs
two steps at 120 BPM with the metronome on: **control** stops a quarter beat after the beat-2
click and restarts from 0; **stale** sends the stop with a lead before beat 2 (40 ms to start, adapted from each
attempt's recording — a stop that landed before the click shortens it, one that landed too deep
lengthens it; the position observable ticks per animation frame and the stop command
round-trips through the worklet) so the transport halts early inside that click, then restarts. Per run it reports the cut click's rendered body before the stop (0.5–12 ms accepted
for the stale step), the interrupted click's own peak (its attack completes 2 ms in), and the
**restart head ratio** (peak of the first 0.5 ms after the restart's first non-silent sample over
that level). A click starting from silence ramps linearly for 2 ms, so 0.5 ms in reads ≤ 0.35; a
stale body resuming at its release level (≥ 80 % when cut within 12 ms) reads ≥ 0.45 — any
0.5 ms window of the 440 Hz beat click sees ≥ 64 % of the sine's peak whatever its phase. Page verdict: BUG PRESENT /
FIXED / INCONCLUSIVE. Measured 2026-09-28 on 0.0.172 (Chrome, 48 kHz, three fresh loads):
control 0.14 / 0.14 / 0.14; stale 0.57 / 0.66 / 0.80 with the stop 1.0 / 3.9 / 6.8 ms into the
click — **BUG PRESENT** each time.

## Fix idea (internal — does not go in the issue)

Clear the click list wherever the transport stops (`pause` / `stop` / `stop_recording`), or
drop clicks in `process` when the block is discontinuous.
