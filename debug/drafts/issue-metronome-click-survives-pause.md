# DRAFT — not posted. For review before filing on andremichelle/openDAW.

**Title:** A metronome click in flight when the transport stops resumes at the next play

## Symptom

Stop the transport (pause, stop, or the end of a recording) while a metronome click is
sounding — within its ~50 ms body — and press play again: the remainder of that click plays at
the moment playback resumes, on top of whatever the new position plays. With a metronome-on
count-in or a downbeat at the new position it is heard as a doubled/thickened first click; at
an arbitrary position it is a stray click tail.

## Cause (`crates/engine/src/metronome.rs`, `crates/engine/src/lib.rs`, same on 0.0.170 and 0.0.172)

`Metronome::process` is only called from `render` while `transport.is_playing()`; it keeps its
active clicks in `self.clicks` and advances them in `retain_mut(process_add)` at the end of every
call. `Engine::pause`, `Engine::stop` and `Engine::stop_recording` reset the recording flags and
the transport but never touch the metronome, so a `Click` whose `position` is inside its sound
stays in the list, frozen, until the next `process` call — the first render after play — where
it continues from where it was. In the default monophonic mode the new click's `fade_out()`
shortens it to 5 ms; polyphonic mode sums both.

## Repro

Unit level (a scratch test added to `metronome.rs` at the `@opendaw/studio-sdk@0.0.172` tag,
1 s DC click sounds, gain 0 dB): process one block at pulse 0 (one click starts, output 1.0),
call nothing (the pause), process a block at pulse 0 again — `clicks.len() == 2` and output
sample 0 is `2.0`; with `monophonic` left at its default, sample 0 is `2.0` and sample 127
is `1.47` (the stale click fading).

Studio: metronome on, play, stop right on a beat, play — the tail of the stopped click sounds
at the new start.

## Notes

`stop()` already resets every plugin and clears the bus buffers so play starts clean; the
metronome's click list is the one piece of render state it leaves behind.
