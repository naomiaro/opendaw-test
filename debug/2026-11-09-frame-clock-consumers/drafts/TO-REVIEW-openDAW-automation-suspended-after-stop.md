<!-- TO REVIEW, nothing posted. Target: andremichelle/openDAW issues. The repro link goes live once the PR that adds
the page is merged and deployed; check it answers before posting. Title is the heading below. -->

# A parameter written just after Stop leaves its automation lane suspended through the next playback

Hi, Naomi's Claude here.

**Version:** `@opendaw/studio-sdk@0.0.183`, Chrome 156, macOS.

When an automated parameter is written in the moment after Stop, its lane plays the parameter's own value for
the whole next playback, not the curve. The gap is from the stop until the main thread next reads the engine state:
about 20–40 ms at 60 updates a second, and longer when updates are slower.

**Repro:** https://opendaw-test.pages.dev/automation-suspended-after-stop-debug-demo. Click Run. It takes about a
minute and plays a held synth note. A Vaporisateur holds one note under a volume lane that is flat at 0 dB, and the
volume's own value is also 0 dB. Each row plays the loop, calls `engine.stop(true)`, and writes the volume to 0
(−96 dB) with `editing.modify(() => volume.setUnitValue(0), false)`. The write comes at once, after a delay, or
(control) once `engine.isPlaying` reads false. Then the row plays the loop again. The level is the engine output's
RMS over 1 s.

**Measured** (one run each; a row's result matched `isPlaying` at the write in every row):

| Write after `stop(true)` | `isPlaying` at the write | Next play | 
|---|---|---|
| 0.1 ms | true | silent: the field's value, the curve ignored |
| 10.8 ms | true | silent |
| 20.3 ms | true | silent |
| after `isPlaying` read false (32.1 ms) | false | −19.8 dB, the curve |
| 41.7 / 81.2 / 161.7 ms | false | −19.8 dB, the curve |
| control: the same write during playback | — | silent, as #347 intends |

With `?frameDriver=throttled&frameEvery=5` (the page drives the SDK's `AnimationFrame` at 24 Hz), `isPlaying`
read false 64–82 ms after the stop. Writes at 0.1, 11.8, 21.1 and 41.1 ms then left the curve ignored, and writes at
80.9 and 161.1 ms did not.

The measured second, 0.5–1.5 s into the next playback, is silent from start to end. From the source, the curve
stays ignored until the next pause, stop or stopped recording.

**Where it happens** (read at the 0.0.183 tag):

- `AutomationSuspension` sends `engine.suspendAutomation(lane)` on a write while `engine.isPlaying.getValue()` is
  true (`packages/studio/core/src/project/AutomationSuspension.ts:14-19`).
- `isPlaying` is set from the engine state that `EngineWorklet` reads once per `AnimationFrame` tick
  (`packages/studio/core/src/EngineWorklet.ts:118-136`, `:342`). `EngineFacade.stop` sends the command and leaves
  the flag as it is, so it reads true until the next tick after the engine has stopped.
- The engine clears `SUSPENDED_AUTOMATION` in `stop_recording`, `pause` and `halt` (`crates/engine/src/lib.rs:2181`,
  `:2193`, `:2222`; `stop` and `stop_faded` go through `halt`). `suspend_automation` (`lib.rs:3371`) adds the lane
  whatever the transport state is, and `play` (`lib.rs:2122`) does not clear the set. So a suspension that reaches
  the stopped engine is held into the next playback.

Who writes in that gap in practice: a MIDI-learned controller still moving when Stop is pressed, a knob still
being dragged, or the transport stopping by itself while a hand is on a control. Only `stop(true)` was measured.
Pause and `stopRecording` go through the same flag and the same clears.

Investigation note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-09-frame-clock-consumers/note.md
