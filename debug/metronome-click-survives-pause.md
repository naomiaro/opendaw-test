# A metronome click in flight when the transport stops resumes at the next play

**Verified against:** `@opendaw/studio-sdk` 0.0.172 (`crates/engine/src/metronome.rs`,
`crates/engine/src/lib.rs` at the `@opendaw/studio-sdk@0.0.172` tag; same code on 0.0.170).
**Status:** latent — found by code reading and a scratch unit test while chasing a listener
report during the 0.0.172 standing sweep (`debug/recording-start-alignment-audit.md`,
"Standing sweep on 0.0.172"); NOT what that listener heard (that was the harness's cell
cadence). No repro page yet; issue draft `drafts/issue-metronome-click-survives-pause.md`
(not posted).

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
sounds at the new start. A deterministic unlisted repro page (stop programmatically a few ms
after a click via the position observable, restart, tap the output) is the missing piece
before filing.

## Fix idea (internal — does not go in the issue)

Clear the click list wherever the transport stops (`pause` / `stop` / `stop_recording`), or
drop clicks in `process` when the block is discontinuous.
