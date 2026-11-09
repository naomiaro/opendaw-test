# What else in openDAW runs on the frame-read engine state

**SDK:** 0.0.183 (installed release; source read in the checkout at the `@opendaw/studio-sdk@0.0.183` tag, the app
included). **Browser:** Playwright's Chrome, macOS, built-in display at 120 Hz, output device at 44.1 kHz.
**Question (2026-11-09):** [the display-refresh-rate note](../2026-11-09-display-refresh-rate-recording/note.md) found
automation recording frame-dependent because it stamps `engine.position` as the main thread last read it. Does
anything else in openDAW act on that frame-read state in a way that changes sound, the document or timing?

**Answer:** one measured defect, and it is not tied to unusual displays. After Stop, `engine.isPlaying` keeps
reading `true` until the next SDK frame tick. A parameter write in that gap sends `suspendAutomation` to an engine
that has already stopped and cleared its suspensions, and `play` does not clear them. The lane's curve is then
ignored for the whole next playback: the parameter plays at its field value. The gap was about 20–40 ms at
57.6 ticks/s across three runs, and 76–83 ms at 24. Slower ticks widen it, and on a hidden page with no frame driver it lasts until the page is
shown. The other uses found are display only, or are candidates listed below that were not measured.

## How the state reaches the main thread

`EngineWorklet` reads the engine state (`isPlaying`, `isRecording`, `isCountingIn`, `countInBeatsRemaining`,
`position`, `bpm`, `playbackTimestamp`, CPU load) once per SDK `AnimationFrame` tick (`EngineWorklet.ts:118-136`,
`:342`). The tick rate is set out in the display note. `EngineFacade.stop` sends the command and changes no flag
(`EngineFacade.ts:143`). Only `sleep()` sets `isPlaying` false at once (`EngineWorklet.ts`, `sleep`). Transport
starts, jumps and stops arrive by message as well, through `subscribeTransportAnchors`, `recordingStarted`
and `recordingStop`. Code that uses those is frame-independent.

## Measured: a write just after Stop leaves the curve ignored on the next play

Mechanism (source):

- `AutomationSuspension.start` (`studio/core/src/project/AutomationSuspension.ts`) sends
  `engine.suspendAutomation(lane)` the first time a parameter with a lane is written while
  `engine.isPlaying.getValue()` is true. It clears its own dedup set when `isPlaying` turns false.
- The engine clears `SUSPENDED_AUTOMATION` in `stop_recording`, `pause` and `halt` (`crates/engine/src/lib.rs:2181`,
  `:2193`, `:2222`; `stop` and `stop_faded` go through `halt`). `suspend_automation` (`lib.rs:3371`) adds the lane
  whatever the transport state is. `play` (`lib.rs:2122`) does not clear the set.
- Upstream's `docs/automation.md`, "Manual control (#347)", describes the clear on those three exits. It does not
  mention this gap.

Probe: [`suspension-probe.js`](./suspension-probe.js) on `track-automation-demo.html`, with the volume lane set to
the "Fade Out" preset so the loop start is loud. For each row the probe plays from the loop start and calls
`engine.stop(true)`. It then writes the volume's own field to 0 (−96 dB) through
`editing.modify(() => volume.setUnitValue(0), false)`, after a delay or (control) once `isPlaying` reads false.
It plays again from the loop start and reads the engine's master peak meter (`EngineAddresses.PEAKS`) 0.6–3.0 s in.
The first 0.6 s are skipped because the meter is still decaying from the previous playback. A lane that follows its
curve plays at about −17 dB. A suspended lane plays its field value, 0, and reads 40–57 dB lower. Positive control:
the same write during playback, which is the suspension by design, read −17.2 → −50.2 dB (57.6 ticks/s) and
−17.1 → −46.6 dB (24).

57.6 SDK ticks/s (unthrottled, 120 Hz panel):

| Write after Stop | `isPlaying` at the write | `isPlaying` false after | Peak before | Peak on next play | Result |
|---|---|---|---|---|---|
| control (after the flag) | false | 37.7 ms | −17.1 dB | −16.7 dB | curve followed |
| 0.1 ms | true | 30.2 ms | −17.0 | −73.2 | **curve ignored** |
| 10.3 ms | true | 29.7 ms | −16.8 | −57.4 | **curve ignored** |
| 20.8 ms | true | 31.4 ms | −17.0 | −59.1 | **curve ignored** |
| 30.9 ms | false | 31.9 ms | −17.0 | −16.9 | curve followed |
| 41.2 / 61.0 / 80.1 ms | false | — | −16.8 … −16.9 | −16.9 … −17.2 | curve followed |

24 SDK ticks/s (`?frameDriver=throttled&frameEvery=5`):

| Write after Stop | `isPlaying` at the write | `isPlaying` false after | Peak before | Peak on next play | Result |
|---|---|---|---|---|---|
| control (after the flag) | false | 81.0 ms | −17.0 dB | −17.2 dB | curve followed |
| 0.1 ms | true | 81.6 ms | −17.2 | −74.2 | **curve ignored** |
| 20.8 ms | true | 82.6 ms | −17.3 | −59.8 | **curve ignored** |
| 41.5 ms | true | 80.6 ms | −17.2 | −61.6 | **curve ignored** |
| 61.1 ms | true | 76.1 ms | −17.3 | −59.4 | **curve ignored** |
| 81.1 / 120.6 ms | false | — | −17.2 | −17.1 / −17.0 | curve followed |

In both runs the result follows `isPlaying` at the write, row for row. Earlier runs on the same page are left out
of the tables: the default "Fade In" preset sits near the noise floor for the first seconds, so the positive control
did not fire on it. Those runs show the same split by `isPlaying` at the write.

### Repro page

[`automation-suspended-after-stop-debug-demo.html`](../../automation-suspended-after-stop-debug-demo.html) runs the
same rows without the demo's sample and needs no console. A Vaporisateur holds one note through a 4 s loop under a
volume lane that is flat at 0 dB. The level is the RMS of the engine output (`engineTap`) over 1 s, starting 0.5 s
into each play. The page self-classifies: BUG PRESENT / FIXED / INCONCLUSIVE / HUNG / THREW. Runs on 2026-11-09,
Playwright's Chrome:

- Unthrottled: **BUG PRESENT**. The positive control went −19.8 dB → silent. Writes at 0.1, 10.8 and 20.3 ms after
  the stop (`isPlaying` true) gave a silent next play. The control at 32.1 ms and writes at 41.7, 81.2 and 161.7 ms
  (`isPlaying` false) played the curve at −19.8 dB. The flag read false 19.5–33.1 ms after the stop.
- `?frameDriver=throttled&frameEvery=5`: **BUG PRESENT**. Writes at 0.1, 11.8, 21.1 and 41.1 ms gave a silent
  next play. The control at 81.0 ms and writes at 80.9 and 161.1 ms played the curve. The flag read false 64.4–82.0 ms
  after the stop.

Who writes in that gap: a MIDI-learned controller still moving when Stop is pressed (`MIDILearning` writes through
`setUnitValue`), a knob held or a wheel still turning, a script, or the transport stopping by itself (end of the
song, `pauseOnLoopDisabled`) while a hand is on a control. Stop and Pause (`stop(false)`) take the same path. Only
`stop(true)` was measured.

Not measured: a recording stop (`stopRecording`, same clear and same flag lag, inferred to behave the same); a hidden
page; a real display below 60 Hz.

## Other code that reads the frame state

Read in the checkout. **Unmeasured** means the effect follows from the source, and nothing was run.

| Where | What it does with the frame state | Effect |
|---|---|---|
| `capture/RecordAutomation.ts` | stamps writes with `engine.position` | measured in the display note |
| `project/AutomationSuspension.ts` | gates `suspendAutomation` on `isPlaying` | **measured above** |
| `midi/MIDILearning.ts:130-149` | applies a learned CC at once, then at most one more per tick (`AnimationFrame.once`), keeping the last value | unmeasured: a fast CC sweep reaches the engine in steps of one tick (16.7 ms at 60, 41.7 at 24) |
| `capture/CaptureMidi.ts:159-170` | armed while the transport runs: makes a start anchor from `audioContext.currentTime` and `engine.position` | unmeasured: the position is one to two ticks older than the time, so notes captured before the next real anchor would be placed that much early (retrospective capture only) |
| app `ui/pages/TapTempo.tsx:191` | tap-tempo phase correction compares the tap with `engine.position / Quarter` | unmeasured: the phase error carries the frame age, so it locks with a bias of one to two ticks (and no output-latency term) |
| app `software-midi/ChordPadPlayer.ts:100`, `SoftwareMIDIPanel.tsx:69`, `NoteEditor.tsx:112` | the key at `engine.position` for chord pads and the editor's scale | a pad pressed just after a key change can use the old key for one or two ticks |
| `capture/RecordMidi.ts:118` `ignoreNoteRegion` | same engine pattern as the suspension (cleared on pause/stop/stop_recording, not on play) | not examined: whether a take can be created after the engine's stop |
| `RecordAudio`, `RecordMidi`, `RecordingSession` | grow the live region for display; stop on the stop anchor | frame-independent (display note) |
| `OfflineEngineRenderer.ts:443`, `MeterWorklet`, `LiveStreamReceiver`, painters, scrollbars, `Timeline` follow, header displays, `Clip.tsx` progress, `CallService` volumes | progress, meters, display | display only. The live stream writes once per read. The engine's peak meter holds with a 250 ms decay, so a peak between ticks reads at most about 1.5 dB low at 24 ticks/s. Loudness integrates in the worklet. The Velocity device's ring holds 1023 notes between reads |
| `BufferUnderrunDetector` | `isPlaying` starts a 1 s poll | not frame-paced |

## Status

Measured; nothing filed. The upstream tracker had no report (searched 2026-11-09; #347 is the feature itself).
Draft for openDAW, describing a gap after Stop and not a display-rate bug:
[`drafts/TO-REVIEW-openDAW-automation-suspended-after-stop.md`](./drafts/TO-REVIEW-openDAW-automation-suspended-after-stop.md).
