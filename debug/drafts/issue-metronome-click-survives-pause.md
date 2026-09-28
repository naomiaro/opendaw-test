# DRAFT — not posted. For review before filing on andremichelle/openDAW.

Before posting: the repro page below must be deployed (merged to main); the signature was
measured on the dev server (three fresh page loads, Chrome, 48 kHz).

**Title:** A metronome click in flight when the transport stops resumes at the next play

## Symptom

Stop the transport (pause, stop, or the end of a recording) while a metronome click is
sounding — within its ~50 ms body — and press play again: the remainder of that click plays at
the moment playback resumes, on top of whatever the new position plays. With a downbeat at
the new position it is heard as a doubled/thickened first click; at an arbitrary position it
is a stray click tail.

## Repro

- Live page: https://opendaw-test.pages.dev/metronome-stale-click-debug-demo.html — the
  "stale" step stops the transport early inside the beat-2 click, restarts from 0 and reports
  the restart's first-0.5 ms peak over the interrupted click's own level. Measured on
  `@opendaw/studio-sdk@0.0.172` (Chrome, 48 kHz, fresh loads): control (stop between clicks)
  0.14 each time; stale (stop 3.9–9.7 ms into the beat-2 click) 0.47–0.80 — the click's body
  resumes at its release level under the new downbeat.
- Studio: metronome on, play, stop right on a beat, play again.
- Unit level, at the `@opendaw/studio-sdk@0.0.172` tag (`crates/engine/src/metronome.rs`,
  1 s DC click sounds, gain 0 dB, 48 kHz / 120 BPM): process one block at pulse 0 (one click
  starts, output 1.0); call nothing (the pause); process a block at pulse 0 again —
  `clicks.len() == 2`, output sample 0 `2.0`; with `monophonic` at its default, sample 0
  `2.0` and sample 127 `1.47` (the stale click fading).

Write-up: https://github.com/naomiaro/opendaw-test/blob/main/debug/metronome-click-survives-pause.md

## Cause (same on 0.0.170 and 0.0.172)

`Metronome::process` is only called from `render` while `transport.is_playing()`; it keeps its
active clicks in `self.clicks` and advances them in `retain_mut(process_add)` at the end of every
call. `Engine::pause`, `Engine::stop` and `Engine::stop_recording` reset the recording flags and
the transport and re-apply the metronome's enabled state (`apply_metronome()`), but never clear
`self.clicks`, so a `Click` whose `position` is inside its sound
stays in the list, frozen, until the first render after play, where it continues from where it
was. In the default monophonic mode the new click's `fade_out()` shortens it to 5 ms;
polyphonic mode sums both.
