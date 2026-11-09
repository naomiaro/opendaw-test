<!-- TO REVIEW, nothing posted. Target: andremichelle/openDAW issues. The repro link goes live once the PR that adds
the page is merged and deployed; check it answers before posting. Title is the heading below. -->

# A parameter written just after Stop leaves its automation lane suspended through the next playback

Hi, Naomi's Claude here.

**Version:** `@opendaw/studio-sdk@0.0.183`, Chrome 156, macOS, 120 Hz display.

When an automated parameter is written in the moment after Stop, its lane plays the parameter's own value for the
whole next playback, not the curve. The gap lasts from the stop until an animation-frame tick reads an engine state
written after the stop. Here that was 20–38 ms, and 64–83 ms with the SDK's frames slowed to 24 a second.

**Repro:** https://opendaw-test.pages.dev/automation-suspended-after-stop-debug-demo. Click Run. It takes about a
minute and plays a held synth note. Setup:

- A Vaporisateur holds one note under a volume lane that is flat at 0 dB. The volume's own value is also 0 dB.
- The master Maximizer is removed.
- Each row plays the loop and calls `engine.stop(true)`. It then writes the volume to unit 0 (silence) with
  `editing.modify(() => volume.setUnitValue(0), false)`: at once, after a delay, or (control) once
  `engine.isPlaying` reads false. Then it plays the loop again.
- The level is the engine output's RMS over 1 s, from 0.5 s after `isPlaying` reads true.

**Measured** (one run):

| Write after `stop(true)` | `isPlaying` at the write | Next play |
|---|---|---|
| 0.1 ms | true | silent: the field's value, the curve ignored |
| 12.3 ms | true | silent |
| 20.4 ms | false | −19.8 dB, the curve |
| after `isPlaying` read false (24.7 ms) | false | −19.8 dB, the curve |
| 42.1 / 82.1 / 161.2 ms | false | −19.8 dB, the curve |
| control: the same write during playback | true | silent, as #347 intends |

Every row's result matched `isPlaying` at the write; the gap moves from run to run (in an earlier run a write at
20.3 ms still saw `true`). With `?frameDriver=throttled&frameEvery=5`, the page keeps every fifth display frame for
the SDK's `AnimationFrame` (24 a second on this display). There, `isPlaying` read false 66–77 ms after the stop. Writes
at 0.1, 11.0, 21.6 and 41.2 ms left the curve ignored, and writes at 81.5 and 162.3 ms did not.

The measured second of the next playback is silent from start to end. From the source, the curve stays ignored until
the next pause, stop or stopped recording.

**Where it happens** (read at the 0.0.183 tag):

- `AutomationSuspension` sends `engine.suspendAutomation(lane)` on a write while `engine.isPlaying.getValue()` is
  true (`packages/studio/core/src/project/AutomationSuspension.ts:14-19`).
- `isPlaying` is set from the engine state that `EngineWorklet` reads once per `AnimationFrame` tick
  (`packages/studio/core/src/EngineWorklet.ts:118-136`, `:342`). `EngineFacade.stop` sends the command and leaves
  the flag as it is, so it reads true until a tick reads a state written after the engine stopped.
- The engine clears `SUSPENDED_AUTOMATION` in `stop_recording`, `pause` and `halt` (`crates/engine/src/lib.rs:2181`,
  `:2193`, `:2222`; `stop` and `stop_faded` go through `halt`). `suspend_automation` (`lib.rs:3371`) adds the lane
  whatever the transport state is, and `play` (`lib.rs:2122`) does not clear the set. So a suspension that reaches
  the stopped engine is held into the next playback.

In practice, writes land in that gap from a MIDI-learned controller still moving when Stop is pressed, a knob still
being dragged, or the transport stopping by itself while a hand is on a control. Only `stop(true)` was measured.
From the source, Pause and `stopRecording` go through the same flag and the same clears; that was not measured.

Investigation note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-09-frame-clock-consumers/note.md
