# What else in openDAW runs on the frame-read engine state

**Upstream:** [openDAW#537](https://github.com/andremichelle/openDAW/issues/537) (filed 2026-11-09). **FIXED in SDK 0.0.184**
(`e6bac5c64`, measured here 2026-11-10: the page reads FIXED, [below](#fixed-in-0-0-184)).
**SDK:** 0.0.183 (installed release; source read in the checkout at the `@opendaw/studio-sdk@0.0.183` tag, the app
included). **Browser:** Playwright's Chrome, macOS, built-in display at 120 Hz, output device at 44.1 kHz.
**Question (2026-11-09):** [the display-refresh-rate note](../2026-11-09-display-refresh-rate-recording/note.md) found
automation recording frame-dependent because it stamps `engine.position` as the main thread last read it. Does
anything else in openDAW act on that frame-read state in a way that changes sound, the document or timing?

**Answer:** one measured defect, and it is not tied to unusual displays. After Stop, `engine.isPlaying` keeps
reading `true` until a frame tick reads a state the engine wrote after it stopped, one to two ticks later. A
parameter write in that gap sends `suspendAutomation` to an engine that has already stopped and cleared its
suspensions, and `play` does not clear them. The lane's curve is then ignored for the whole next playback: the
parameter plays at its field value. The flag read false 20–38 ms after the stop unthrottled (about 54–58 ticks a
second, four runs), and 64–83 ms at 24 ticks a second (three runs). From the source, on a hidden page with no frame
driver the gap would last until the page is shown (not measured). The other uses found are display only, or are
candidates listed below that were not measured.

## How the state reaches the main thread

`EngineWorklet` reads the engine state (`isPlaying`, `isRecording`, `isCountingIn`, `countInBeatsRemaining`,
`position`, `bpm`, `playbackTimestamp`, CPU load) once per SDK `AnimationFrame` tick (`EngineWorklet.ts:118-136`,
`:342`). The tick rate is set out in the display note. `EngineFacade.stop` sends the command and changes no flag
(`EngineFacade.ts:143`). Only `sleep()` sets `isPlaying` false at once (`EngineWorklet.ts`, `sleep`). Transport
starts, jumps and stops arrive by message as well, through `subscribeTransportAnchors`, `recordingStarted`
and `recordingStop`. Code that uses those is frame-independent.

## Measured: a write just after Stop leaves the curve ignored on the next play

Mechanism (source):

- `AutomationSuspension.start` (`studio/core/src/project/AutomationSuspension.ts:14-19`) sends
  `engine.suspendAutomation(lane)` the first time a parameter with a lane is written while
  `engine.isPlaying.getValue()` is true. Playing or recording, it checks only that flag. It clears its own dedup set
  when `isPlaying` turns false (`:22`).
- The engine clears `SUSPENDED_AUTOMATION` in `stop_recording`, `pause` and `halt` (`crates/engine/src/lib.rs:2181`,
  `:2193`, `:2222`; `stop` and `stop_faded` go through `halt`). `suspend_automation` (`lib.rs:3371`) adds the lane
  whatever the transport state is. `play` (`lib.rs:2122`) does not clear the set.
- Upstream's `docs/automation.md`, "Manual control (#347)", describes the clear on those three exits. It does not
  mention this gap.

Every row below writes the volume's own field to unit 0 with `editing.modify(() => volume.setUnitValue(0), false)`.
Unit 0 is −∞ dB (`VolumeMapper` is `decibel(-96, -9, +6)`, and lib-std's `y(x)` returns −∞ for `x ≤ 0`). A lane
left suspended therefore plays true silence. The write comes after a delay or, as the control, once `isPlaying` reads
false. The row then plays again from the loop start.

### Repro page

[`automation-suspended-after-stop-debug-demo.html`](../../automation-suspended-after-stop-debug-demo.html) runs the
rows on its own, without the demo's sample or a console. Setup:

- A Vaporisateur holds one note through a 4 s loop under a volume lane that is flat at 0 dB.
- The master Maximizer is removed first.
- The level is the RMS of the engine output (`engineTap`) over 1 s, starting 0.5 s after `isPlaying` reads true.
- The positive control writes during playback, which is the suspension by design.

The page reports BUG PRESENT, FIXED, INCONCLUSIVE, HUNG or THREW. It reports FIXED only when at least one write
saw `isPlaying` true, so a run that never reaches the gap cannot pass as fixed. Runs on 2026-11-09:

| Run | Positive control | Rows that saw `isPlaying` true (write ms after stop) | Their next play | Rows that saw it false | Flag false after | Verdict |
|---|---|---|---|---|---|---|
| unthrottled 1 (Maximizer still on) | −19.8 dB → silent | 0.1, 10.8, 20.3 | silent | control 32.1, then 41.7, 81.2, 161.7: −19.8 dB | 19.5–33.1 ms | BUG PRESENT |
| unthrottled 2 | −19.8 dB → silent | 0.1, 12.3 | silent | control 24.7, then 20.4, 42.1, 82.1, 161.2: −19.8 dB | 20.4–33.0 ms | BUG PRESENT |
| `frameEvery=5`, 1 (Maximizer still on) | −19.8 dB → silent | 0.1, 11.8, 21.1, 41.1 | silent | control 81.0, then 80.9, 161.1: −19.8 dB | 64.4–81.9 ms | BUG PRESENT |
| `frameEvery=5`, 2 | −19.8 dB → silent | 0.1, 11.0, 21.6, 41.2 | silent | control 68.9, then 81.5, 162.3: −19.8 dB | 66.4–76.6 ms | BUG PRESENT |

The levels match to 0.1 dB with and without the Maximizer. `?frameDriver=throttled&frameEvery=5` keeps every fifth
display frame, which is 24 ticks a second on this 120 Hz panel. The page does not count its own ticks.

### Console probe

[`suspension-probe.js`](./suspension-probe.js) is for the dev server only, on `track-automation-demo.html` with the
volume lane on its "Fade Out" preset. It reads the engine's master peak meter (`EngineAddresses.PEAKS`, 250 ms
decay) 0.6–3.0 s after `isPlaying` reads true. The first 0.6 s are skipped while the meter decays from the previous
playback. The default "Fade In" preset sits near the noise floor at the loop start: the positive control did not fire
on it, and those runs are left out. The probe now runs the positive control first and returns "blind" when it does
not fire.

SDK ticks measured by the probe in each run. Unthrottled rows used delays `[control, 0, 10, 20, 30, 40, 60, 80]`; the
24-tick rows used `[control, 0, 20, 40, 60, 80, 120]`.

| Run | Positive control | Rows that saw `isPlaying` true (write ms after stop) | Their next play | Rows that saw it false | Flag false after |
|---|---|---|---|---|---|
| 57.6 ticks/s | −17.2 → −50.2 dB | 0.1, 10.3, 20.8 | −73.2, −57.4, −59.1 dB | control 36.3, then 30.9, 41.2, 61.0, 80.1: −16.7 … −17.0 dB | 29.7–37.7 ms |
| 53.7 ticks/s (probe as committed) | −16.8 → −49.2 dB | 0.1, 11.6, 22.0 | −73.1, −57.1, −55.5 dB | control 29.5, then 32.2, 40.9, 60.8, 81.7: −17.0 … −17.2 dB | 27.9–30.7 ms |
| 24.0 ticks/s | −17.1 → −46.6 dB | 0.1, 20.8, 41.5, 61.1 | −74.2, −59.8, −61.6, −59.4 dB | control 80.1, then 81.1, 120.6: −17.0 … −17.2 dB | 76.1–82.6 ms |

At 24 ticks the probe's positive control fell 29.5 dB, just short of the 30 dB the rows are judged by. Its rows still
fell 42–57 dB. The residual −55 … −74 dB on the "silent" rows is the meter's leftover decay, not sound: the page's RMS
reads true silence on the same rows.

Who writes in that gap: a MIDI-learned controller still moving when Stop is pressed (`MIDILearning` writes through
`setUnitValue`), a knob held or a wheel still turning, a script, or the transport stopping by itself (end of the
song, `pauseOnLoopDisabled`) while a hand is on a control. Only `stop(true)` was measured. From the source, Pause
(`stop(false)`) and `stopRecording` go through the same flag and the same clears.

Not measured: Pause, a recording stop, a hidden page, a real display below 60 Hz.

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

**FILED as [openDAW#537](https://github.com/andremichelle/openDAW/issues/537)** on 2026-11-09, described as a gap after
Stop, not a display-rate bug ([body as filed](./drafts/posted-openDAW-537-automation-suspended-after-stop.md)). The
upstream tracker had no earlier report (#347 is the feature itself). Before posting, the deployed page read BUG
PRESENT (writes at 0.0 and 11.1 ms silent on the next play, the control at 33.4 ms and later writes on the curve).

### Fixed in 0.0.184

Upstream `e6bac5c64` (2026-11-10, "fixes #537"): the engine's `suspend_automation` returns unless its transport is
playing (`crates/engine/src/lib.rs`, `Engine::suspend_automation`), with a crate test
`a_suspension_reaching_the_stopped_engine_is_ignored`. The main thread still sends the suspension in the gap; the
stopped engine refuses it. **Measured 2026-11-10 on 0.0.184** (Playwright's Chrome, unthrottled, output device at
44.1 kHz): `automation-suspended-after-stop-debug-demo.html` reads **FIXED**. The positive control still suspends
during playback (−19.8 dB → silent); the writes at 0.2 and 10.7 ms after Stop saw `isPlaying` true (it read false
after 20.9 and 29.7 ms) and both played −19.8 dB on the next play, the curve; the control and the writes at 21.0,
41.4, 81.1 and 160.8 ms likewise. The suspension DURING playback is unchanged, by design
(`docs/known-sdk-limitations.md`).
